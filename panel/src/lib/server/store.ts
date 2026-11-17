import { createHash, randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import type { FxSnapshot, Job, MarketData, Offer, ScanResult, Source } from "../contracts";
import { all, db, getSetting, one, run, transaction } from "./db";
import { workerOnline } from "./config";

export const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const now = () => new Date().toISOString();
export function sources() { return all<Source>(`SELECT s.*, (SELECT count(*) FROM offers o WHERE o.source_id=s.id) AS offer_count, NULL AS active_job FROM sources s ORDER BY s.created_at DESC`); }
export function sourceById(id: string) { const source = one<Source>("SELECT * FROM sources WHERE id=?", id); if (!source) throw new Error("Источник не найден"); return source; }
export function enqueue(kind: Job["kind"], sourceId: string | null = null) {
  if (sourceId) sourceById(sourceId);
  const dedupe = `${kind}:${sourceId || "all"}`, id = randomUUID();
  run("INSERT OR IGNORE INTO jobs(id,source_id,kind,dedupe,created_at) VALUES(?,?,?,?,?)", id, sourceId, kind, dedupe, now());
  return one<Job>("SELECT * FROM jobs WHERE dedupe=? AND state IN ('queued','running')", dedupe)!;
}
export function jobs() { return all<Job>("SELECT j.*,s.name AS source_name FROM jobs j LEFT JOIN sources s ON s.id=j.source_id ORDER BY j.created_at DESC LIMIT 100"); }
export function claimJob(): Job | undefined {
  return transaction(() => {
    const job = one<Job>("SELECT * FROM jobs WHERE state='queued' ORDER BY created_at LIMIT 1");
    if (!job) return;
    run("UPDATE jobs SET state='running',started_at=?,heartbeat_at=? WHERE id=? AND state='queued'", now(), now(), job.id);
    return { ...job, state: "running" };
  });
}
export function persistScan(source: Source, result: ScanResult, origin?: { id: string; name: string }) {
  return transaction(() => {
    const timestamp = now(), seenIds = new Set<string>(); let changed = 0;
    for (const offer of result.offers) {
      const id = hash([source.id, offer.key]); seenIds.add(id);
      const old = one<Offer & { raw_json: string }>("SELECT * FROM offers WHERE id=?", id);
      const observedAt = origin ? offer.observedAt || source.created_at : timestamp;
      if (origin && old && old.last_seen_at >= observedAt) {
        run("INSERT OR REPLACE INTO offer_origins VALUES(?,?,?)", id, origin.id, observedAt);
        continue;
      }
      const sourceHash = hash([offer.title, offer.description, offer.category]);
      const change = !old || old.price !== offer.price || old.currency !== offer.currency || old.stock_status !== offer.stockStatus || old.stock_count !== offer.stockCount;
      const invalidate = !old || old.source_hash !== sourceHash;
      run(`INSERT INTO offers(id,source_id,product_key,title_original,description_original,category_original,url,price,currency,
        stock_status,stock_count,minimum_quantity,raw_json,source_hash,created_at,last_seen_at,last_changed_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        title_original=excluded.title_original,description_original=excluded.description_original,category_original=excluded.category_original,
        url=excluded.url,price=excluded.price,currency=excluded.currency,stock_status=excluded.stock_status,stock_count=excluded.stock_count,
        minimum_quantity=excluded.minimum_quantity,raw_json=excluded.raw_json,source_hash=excluded.source_hash,
        missing_count=0,last_seen_at=excluded.last_seen_at,last_changed_at=excluded.last_changed_at`,
        id, source.id, offer.key, offer.title, offer.description, offer.category, offer.url, offer.price, offer.currency,
        offer.stockStatus, offer.stockCount, offer.minimumQuantity, JSON.stringify(offer.raw), sourceHash,
        timestamp, observedAt, change ? observedAt : old.last_changed_at);
      run("UPDATE offers SET data_origin=? WHERE id=?", origin?.name || "Магазин", id);
      if (origin) run("INSERT OR REPLACE INTO offer_origins VALUES(?,?,?)", id, origin.id, observedAt);
      if (invalidate) run("UPDATE offers SET title_ru=NULL,description_ru=NULL,category_ru=NULL,translation_state='pending',translation_error=NULL,translation_hash=NULL WHERE id=?", id);
      if (change) {
        changed++;
        run("INSERT INTO observations(offer_id,price,currency,stock_status,stock_count,observed_at) VALUES(?,?,?,?,?,?)", id, offer.price, offer.currency, offer.stockStatus, offer.stockCount, timestamp);
      }
    }
    if (result.complete && !origin) {
      for (const old of all<Offer & { missing_count: number }>("SELECT * FROM offers WHERE source_id=?", source.id)) {
        if (seenIds.has(old.id)) continue;
        const missing = old.missing_count + 1;
        run("UPDATE offers SET missing_count=? WHERE id=?", missing, old.id);
        if (missing >= 2 && old.stock_status !== "unavailable") {
          run("UPDATE offers SET stock_status='unavailable',last_changed_at=? WHERE id=?", timestamp, old.id);
          run("INSERT INTO observations(offer_id,price,currency,stock_status,stock_count,observed_at) VALUES(?,?,?,?,?,?)", old.id, old.price, old.currency, "unavailable", old.stock_count, timestamp);
          changed++;
        }
      }
    }
    if (!origin) run("UPDATE sources SET platform=?,state=?,error=?,last_success_at=?,next_run_at=? WHERE id=?", result.platform, result.complete ? "success" : "partial", result.note || null,
      timestamp, new Date(Date.now() + source.interval_minutes * 60000).toISOString(), source.id);
    return changed;
  });
}
export function toRub(price: string | null, currency: string, fx: FxSnapshot | null) {
  if (price === null) return null;
  if (currency === "RUB") return new Decimal(price).toFixed(2);
  return fx?.rates[currency] ? new Decimal(price).mul(fx.rates[currency]).toFixed(2) : null;
}
export function market(params: URLSearchParams): MarketData {
  const fx = getSetting<FxSnapshot | null>("fx", null);
  const counts = one<MarketData["counts"]>(`SELECT count(*) AS total,
    coalesce(sum(stock_status='in_stock'),0) AS in_stock,coalesce(sum(translation_state IN ('ready','review')),0) AS translated,
    (SELECT count(*) FROM sources) AS sources FROM offers`)!;
  const total = counts.total, pageSize = 50;
  const requested = Math.floor(Number(params.get("page")) || 1);
  const page = Math.max(1, Math.min(requested, Math.max(1, Math.ceil(total / pageSize))));
  const offers = all<Offer>(`SELECT o.id,o.source_id,o.product_key,o.title_original,o.category_original,
    o.title_ru,o.category_ru,o.translation_state,o.translation_provider,o.url,o.price,o.currency,
    o.stock_status,o.stock_count,o.minimum_quantity,o.last_seen_at,o.last_changed_at,o.data_origin,s.name AS source_name
    FROM offers o JOIN sources s ON s.id=o.source_id ORDER BY o.last_seen_at DESC,o.id LIMIT ? OFFSET ?`, pageSize, (page - 1) * pageSize)
    .map(offer => ({ ...offer, rub_price: toRub(offer.price, offer.currency, fx) }));
  return { offers, total, page, page_size: pageSize, sources: [], counts: { ...counts }, fx, worker_online: workerOnline() };
}
export function offerDetail(id: string) {
  const offer = one<Offer & { raw_json: string }>("SELECT o.*,s.name AS source_name FROM offers o JOIN sources s ON s.id=o.source_id WHERE o.id=?", id);
  if (!offer) throw new Error("Товар не найден");
  return { ...offer, raw_json: undefined, rub_price: toRub(offer.price, offer.currency, getSetting<FxSnapshot | null>("fx", null)),
    history: all<{ price: string | null; currency: string; stock_status: string; stock_count: number | null; observed_at: string }>("SELECT price,currency,stock_status,stock_count,observed_at FROM observations WHERE offer_id=? ORDER BY id DESC LIMIT 100", id) };
}
export function checkpoint() { db().exec("PRAGMA wal_checkpoint(PASSIVE)"); }

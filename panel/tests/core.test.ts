import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RawOffer, Source } from "../src/lib/contracts";

const dir = mkdtempSync(path.join(tmpdir(), "private-panel-test-"));
process.env.PANEL_DATA_DIR = dir;
let collectors: typeof import("../src/lib/server/collectors");
let database: typeof import("../src/lib/server/db");
let store: typeof import("../src/lib/server/store");
let config: typeof import("../src/lib/server/config");
let translation: typeof import("../src/lib/server/translation");
let network: typeof import("../src/lib/server/network");
let fx: typeof import("../src/lib/server/fx");
before(async () => {
  collectors = await import("../src/lib/server/collectors"); database = await import("../src/lib/server/db");
  store = await import("../src/lib/server/store"); config = await import("../src/lib/server/config");
  translation = await import("../src/lib/server/translation"); network = await import("../src/lib/server/network"); fx = await import("../src/lib/server/fx");
});
after(() => { database.db().close(); rmSync(dir, { recursive: true, force: true }); });
const source: Source = { id: "test-source", name: "Test", url: "https://example.com/shop/public", platform: "shopapi", transport: "http", enabled: 1, interval_minutes: 60, state: "idle", error: null, last_attempt_at: null, last_success_at: null, next_run_at: null, created_at: "2026-01-01T00:00:00Z" };
const offer: RawOffer = { key: "one", title: "ChatGPT Plus", description: "Monthly", category: "AI", url: "https://example.com/item/one", price: "0.7", currency: "CNY", stockStatus: "in_stock", stockCount: 3, minimumQuantity: 1, raw: {} };

test("money: exact decimal arithmetic and CBR nominal", () => {
  const parsed = fx.parseCbr('<ValCurs Date="12.11.2026"><Valute><CharCode>CNY</CharCode><Nominal>10</Nominal><Value>130,1234</Value></Valute><Valute><CharCode>USD</CharCode><Nominal>1</Nominal><Value>90,0000</Value></Valute></ValCurs>');
  assert.equal(parsed.rates.CNY, "13.01234"); assert.equal(parsed.date, "2026-11-12");
  assert.equal(store.toRub("0.7", "CNY", parsed), "9.11"); assert.equal(store.toRub("12", "JPY", parsed), null);
  assert.equal(collectors.amount(0), "0"); assert.equal(collectors.amount(""), null); assert.equal(collectors.amount(-1), null);
});
test("unknown stock stays distinct from zero or unlimited supply", () => {
  assert.equal(collectors.quantity(-1), null); assert.equal(collectors.quantity(""), null);
  assert.equal(collectors.stock(null), "unknown"); assert.equal(collectors.stock(0), "out_of_stock");
  assert.equal(collectors.stock(null, false, true), "in_stock"); assert.equal(collectors.stock(5, true), "unavailable");
});
test("shopApi pagination and original zero price", async () => {
  const pages: number[] = [];
  const scan = await collectors.collect(source, async (endpoint, body) => {
    if (endpoint.endsWith("/info")) return { code: 1, data: { nickname: "Shop" } };
    if (endpoint.endsWith("/categoryList")) return { code: 1, data: [] };
    const current = (body as { current: number }).current; pages.push(current);
    return { code: 1, data: { total: 2, list: [{ goods_key: String(current), name: "Plus", price: current === 1 ? 0 : 10, extend: { stock_count: current === 1 ? -1 : 0 } }] } };
  });
  assert.deepEqual(pages, [1, 2, 1, 2, 1, 2, 1, 2]); assert.equal(scan.complete, true); assert.equal(scan.offers[0].price, "0"); assert.equal(scan.offers[0].stockStatus, "unknown");
});
test("repeated pagination is partial, not a complete catalogue", async () => {
  const scan = await collectors.collect(source, async endpoint => endpoint.endsWith("/info") ? { code: 1, data: {} } : endpoint.endsWith("/categoryList") ? { code: 1, data: [] } : { code: 1, data: { total: 10, list: [{ goods_key: "same", name: "Plus", price: "2" }] } });
  assert.equal(scan.complete, false); assert.equal(scan.offers.length, 4);
});
test("Dujiao SKU identities do not collapse different durations", async () => {
  const scan = await collectors.collect({ ...source, url: "https://example.com", platform: "dujiao" }, async () => ({ code: 0, data: [{ id: 1, slug: "plus", name: "Plus", skus: [{ id: 10, name: "1 month", price_amount: "10", auto_stock_available: 2 }, { id: 20, name: "1 year", price_amount: "100", auto_stock_available: 0 }] }] }));
  assert.deepEqual(scan.offers.map(o => o.key), ["1:10", "1:20"]); assert.equal(scan.offers[1].stockStatus, "out_of_stock");
});
test("only two complete misses remove an offer; unchanged scans do not duplicate history", () => {
  database.run("INSERT INTO sources(id,name,url,platform,created_at) VALUES(?,?,?,?,?)", source.id, source.name, source.url, source.platform, source.created_at);
  store.persistScan(source, { offers: [offer], complete: true, platform: "shopapi" });
  const id = store.hash([source.id, offer.key]);
  store.persistScan(source, { offers: [offer], complete: true, platform: "shopapi" });
  assert.equal(database.one<{ n: number }>("SELECT count(*) n FROM observations")?.n, 1);
  store.persistScan(source, { offers: [], complete: false, platform: "shopapi" });
  assert.equal(database.one<{ n: number }>("SELECT missing_count n FROM offers WHERE id=?", id)?.n, 0);
  store.persistScan(source, { offers: [], complete: true, platform: "shopapi" });
  assert.equal(database.one<{ state: string }>("SELECT stock_status state FROM offers WHERE id=?", id)?.state, "in_stock");
  store.persistScan(source, { offers: [], complete: true, platform: "shopapi" });
  assert.equal(database.one<{ state: string }>("SELECT stock_status state FROM offers WHERE id=?", id)?.state, "unavailable");
  assert.equal(database.one<{ n: number }>("SELECT count(*) n FROM observations")?.n, 2);
});
test("source text changes invalidate old translations without losing favourites", () => {
  const id = store.hash([source.id, offer.key]);
  database.run("UPDATE offers SET title_ru='Старый перевод',translation_state='ready',starred=1 WHERE id=?", id);
  store.persistScan(source, { offers: [{ ...offer, title: "New title" }], complete: true, platform: "shopapi" });
  const row = database.one<{ title_ru: string | null; starred: number; translation_state: string }>("SELECT * FROM offers WHERE id=?", id)!;
  assert.equal(row.title_ru, null); assert.equal(row.starred, 1); assert.equal(row.translation_state, "pending");
});
test("job enqueue is idempotent and claims are exclusive", () => {
  const a = store.enqueue("scan", source.id), b = store.enqueue("scan", source.id);
  assert.equal(a.id, b.id); assert.equal(store.claimJob()?.id, a.id); assert.equal(store.claimJob(), undefined);
});
test("keys are encrypted at rest and never returned by settings", () => {
  config.saveKey("gemini", "test-secret-value"); assert.equal(config.readKey("gemini"), "test-secret-value");
  const row = database.one<{ value: string }>("SELECT value FROM settings WHERE key='secret:gemini'")!;
  assert.equal(row.value.includes("test-secret-value"), false);
  assert.equal(JSON.stringify(config.publicSettings()).includes("test-secret-value"), false);
});
test("network rejects private addresses, unsafe URLs, and HTTP 200 challenge HTML", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "::ffff:127.0.0.1", "fc00::1", "0.0.0.0"]) assert.equal(network.publicAddress(ip), false);
  assert.equal(network.publicAddress("1.1.1.1"), true);
  assert.throws(() => network.publicUrl("https://user:password@example.com"));
  assert.throws(() => network.publicUrl("http://example.com"));
  assert.throws(() => network.parseJsonResponse({ status: 200, text: "<html><title>Verification</title></html>" }), (e: unknown) => e instanceof network.CollectorError && e.code === "challenge_required");
});
test("glossary applies longest matches and UTF-8 chunks never split code points", () => {
  const segments = translation.glossarySegments("无质保 接🐎", [{ source: "质保", target: "гарантия" }, { source: "无质保", target: "без гарантии" }, { source: "接🐎", target: "приём SMS" }]);
  assert.equal(segments.filter(s => s.protected).map(s => s.value).join(";"), "без гарантии;приём SMS");
  const original = "中文🐎".repeat(300), chunks = translation.chunksByBytes(original);
  assert.equal(chunks.join(""), original); assert.ok(chunks.every(c => Buffer.byteLength(c) <= 450));
});
test("market response omits raw payload and respects translated Russian search", () => {
  const id = store.hash([source.id, offer.key]); database.run("UPDATE offers SET title_ru='Готовый аккаунт',translation_state='review' WHERE id=?", id);
  const data = store.market(new URLSearchParams({ q: "АККАУНТ" }));
  assert.equal(data.total, 1); assert.equal("raw_json" in data.offers[0], false);
});

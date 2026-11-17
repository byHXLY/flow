import "./env";
import { collect } from "../src/lib/server/collectors";
import { all, getSetting, one, run, setSetting } from "../src/lib/server/db";
import { readKey, settings } from "../src/lib/server/config";
import { browserContext, browserFetcher, openStore } from "../src/lib/server/browser";
import { CollectorError, requestJson, sleep } from "../src/lib/server/network";
import { now, persistScan } from "../src/lib/server/store";
import { updateFx } from "../src/lib/server/fx";
import { translatePending } from "../src/lib/server/translation";
import { directories, importDirectory, initializeCatalog } from "../src/lib/server/catalog";
import type { FxSnapshot, Source } from "../src/lib/contracts";

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
const hosts = new Set<string>();
const hostRequestTime = new Map<string, number>();
const interrupted = () => { if (stopping) throw new CollectorError("Сервис остановлен"); };
const later = (ms: number) => new Date(Date.now() + ms).toISOString();
function message(error: unknown) { return error instanceof CollectorError ? error.message : "Источник недоступен"; }

async function scan(source: Source) {
  const host = new URL(source.url).hostname;
  run("UPDATE sources SET state='running',last_attempt_at=?,next_run_at=?,error=NULL WHERE id=?", now(), later(source.interval_minutes * 60000), source.id);
  const transport = source.transport === "browser" || getSetting(`browser_host:${host}`, false);
  const browser = transport ? await browserFetcher(source) : null;
  try {
    const result = await collect(source, async (endpoint, body) => {
      interrupted();
      await sleep(Math.max(0, settings().request_interval_ms - (Date.now() - (hostRequestTime.get(host) || 0))));
      hostRequestTime.set(host, Date.now());
      return browser ? browser.fetch(endpoint, body) : requestJson(new URL(endpoint, source.url).href, { body });
    });
    persistScan(source, result);
  } finally { await browser?.close(); }
}
async function sellerLoop() {
  while (!stopping) {
    const available = all<Source>("SELECT * FROM sources WHERE enabled=1 AND platform!='index' AND (next_run_at IS NULL OR next_run_at<=?) ORDER BY last_attempt_at IS NOT NULL,last_attempt_at LIMIT 100", now());
    const batch: Source[] = [];
    for (const source of available) {
      const host = new URL(source.url).hostname;
      if (hosts.has(host) || Date.now() < getSetting(`host_cooldown:${host}`, 0)) continue;
      hosts.add(host); batch.push(source); if (batch.length >= 3) break;
    }
    await Promise.all(batch.map(async source => {
      const host = new URL(source.url).hostname;
      try { await scan(source); }
      catch (error) {
        const state = error instanceof CollectorError ? error.code : "failed";
        run("UPDATE sources SET state=?,error=?,next_run_at=? WHERE id=?", state, message(error), later(3600000), source.id);
        if (["challenge_required", "rate_limited"].includes(state)) setSetting(`host_cooldown:${host}`, Date.now() + 1800000);
      } finally { hosts.delete(host); }
    }));
    await sleep(1000);
  }
}
async function catalogLoop() {
  while (!stopping) {
    const candidates = directories().filter(d => !d.next_run_at || d.next_run_at <= now());
    const offset = candidates.length ? getSetting<number>("catalog_cursor", 0) % candidates.length : 0;
    const rotated = candidates.length ? [...candidates.slice(offset), ...candidates.slice(0, offset)] : [];
    const pending = rotated.slice(0, 3);
    if (candidates.length) setSetting("catalog_cursor", offset + pending.length);
    await Promise.all(pending.map(async directory => {
      try {
        if (directory.next_run_at) {
          run("UPDATE directories SET cursor=0,received=0,next_run_at=NULL,state='idle' WHERE id=?", directory.id);
          directory.cursor = 0; directory.received = 0;
        }
        await importDirectory(directory);
      } catch (error) {
        run("UPDATE directories SET state='unavailable',error=?,checked_at=?,next_run_at=? WHERE id=?", message(error), now(), later(3600000), directory.id);
      }
    }));
    await sleep(2000);
  }
}
async function translationLoop() {
  while (!stopping) {
    const config = settings();
    if (!config.auto_translate || (config.provider !== "mymemory" && !readKey(config.provider))) { await sleep(5000); continue; }
    const backoffUntil = getSetting<number>("translation_backoff_until", 0);
    if (backoffUntil > Date.now()) { await sleep(Math.min(5000, backoffUntil - Date.now())); continue; }
    try {
      const pending = one<{ n: number }>("SELECT count(*) n FROM offers WHERE translation_state='pending'")?.n || 0;
      if (pending) {
        setSetting("translation_runtime", { state: "running", message: "", at: now() });
        await translatePending(null, () => { interrupted(); });
        setSetting("translation_backoff_until", 0);
        setSetting("translation_runtime", { state: "success", message: "", at: now() });
      }
    } catch (error) {
      setSetting("translation_runtime", { state: "failed", message: message(error), at: now() });
      setSetting("translation_backoff_until", Date.now() + 300000);
      await sleep(5000);
    }
    await sleep(3000);
  }
}
async function maintenanceLoop() {
  while (!stopping) {
    setSetting("worker_heartbeat", now());
    const fx = getSetting<FxSnapshot | null>("fx", null), attempt = getSetting("fx_attempt", "1970-01-01");
    if ((!fx || Date.now() - Date.parse(fx.fetched_at) > 6 * 3600000 || getSetting("refresh_fx", false)) && Date.now() - Date.parse(attempt) > 60000) {
      setSetting("fx_attempt", now()); setSetting("refresh_fx", false);
      try { await updateFx(); } catch (error) { setSetting("fx_error", message(error)); }
    }
    await sleep(3000);
  }
}
async function verificationLoop() {
  while (!stopping) {
    const requested = getSetting<string | null>("verify_source", null);
    if (!requested) { await sleep(1000); continue; }
    setSetting("verify_source", null); setSetting("verify_finish", false);
    const source = one<Source>("SELECT * FROM sources WHERE id=?", requested);
    if (!source) continue;
    const host = new URL(source.url).hostname;
    if (hosts.has(host)) { setSetting("verify_source", requested); await sleep(1000); continue; }
    hosts.add(host);
    try {
      const context = await browserContext(source, true);
      setSetting("verification", { source_id: source.id, state: "running" });
      try {
        await openStore(context, source.url);
        const deadline = Date.now() + 600000;
        while (!stopping && Date.now() < deadline && context.pages().length && !getSetting("verify_finish", false)) await sleep(1000);
      } finally { await context.close(); }
      setSetting(`browser_host:${host}`, true); setSetting(`host_cooldown:${host}`, 0);
      run("UPDATE sources SET transport='browser',enabled=1,next_run_at=NULL WHERE id=?", source.id);
      setSetting("verification", { source_id: source.id, state: "success" });
    } catch (error) { setSetting("verification", { source_id: source.id, state: "failed", message: message(error) }); }
    finally { hosts.delete(host); }
  }
}
async function main() {
  initializeCatalog();
  if (!getSetting("automatic_catalog_v1", false)) {
    setSetting("settings", { ...settings(), auto_translate: true }); setSetting("automatic_catalog_v1", true);
  }
  run("UPDATE sources SET state='catalog' WHERE state='running'");
  const heartbeat = setInterval(() => setSetting("worker_heartbeat", now()), 5000);
  console.log("Automatic market service ready");
  await Promise.all([catalogLoop(), sellerLoop(), translationLoop(), maintenanceLoop(), verificationLoop()]);
  clearInterval(heartbeat); setSetting("worker_heartbeat", "1970-01-01");
}
main().catch(error => { console.error(message(error)); process.exitCode = 1; });

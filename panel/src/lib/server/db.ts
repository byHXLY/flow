import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const dataDir = path.resolve(/* turbopackIgnore: true */ process.env.PANEL_DATA_DIR || path.join(os.homedir(), ".local", "state", "private-panel"));
const globalDb = globalThis as typeof globalThis & { panelDb?: DatabaseSync };
export function db() {
  if (globalDb.panelDb) return globalDb.panelDb;
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const connection = new DatabaseSync(path.join(dataDir, "panel.sqlite"));
  chmodSync(path.join(dataDir, "panel.sqlite"), 0o600);
  connection.exec(`
    PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE, platform TEXT NOT NULL,
      transport TEXT NOT NULL DEFAULT 'http', enabled INTEGER NOT NULL DEFAULT 1,
      interval_minutes INTEGER NOT NULL DEFAULT 60, state TEXT NOT NULL DEFAULT 'idle', error TEXT,
      last_attempt_at TEXT, last_success_at TEXT, next_run_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS offers (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      product_key TEXT NOT NULL, title_original TEXT NOT NULL, description_original TEXT NOT NULL,
      category_original TEXT NOT NULL, url TEXT NOT NULL, price TEXT, currency TEXT NOT NULL,
      stock_status TEXT NOT NULL, stock_count INTEGER, minimum_quantity INTEGER NOT NULL,
      raw_json TEXT NOT NULL, source_hash TEXT NOT NULL, title_ru TEXT, description_ru TEXT, category_ru TEXT,
      translation_state TEXT NOT NULL DEFAULT 'pending', translation_provider TEXT, translation_error TEXT,
      translation_hash TEXT, starred INTEGER NOT NULL DEFAULT 0, missing_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, last_changed_at TEXT NOT NULL,
      UNIQUE(source_id, product_key)
    );
    CREATE INDEX IF NOT EXISTS offers_source ON offers(source_id);
    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
      price TEXT, currency TEXT NOT NULL, stock_status TEXT NOT NULL, stock_count INTEGER, observed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS observations_offer ON observations(offer_id, observed_at);
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, source_id TEXT REFERENCES sources(id) ON DELETE CASCADE, kind TEXT NOT NULL,
      dedupe TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued', message TEXT, processed INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
      heartbeat_at TEXT, finish_requested INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS jobs_active ON jobs(dedupe) WHERE state IN ('queued', 'running');
    CREATE TABLE IF NOT EXISTS translation_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS translation_usage (day TEXT NOT NULL, provider TEXT NOT NULL, characters INTEGER NOT NULL,
      PRIMARY KEY(day, provider));
    CREATE TABLE IF NOT EXISTS glossary (source TEXT PRIMARY KEY, target TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS directories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, strategy TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'idle', cursor INTEGER NOT NULL DEFAULT 0, total INTEGER,
      received INTEGER NOT NULL DEFAULT 0, error TEXT, checked_at TEXT, next_run_at TEXT
    );
    CREATE TABLE IF NOT EXISTS seller_origins (
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      directory_id TEXT NOT NULL REFERENCES directories(id), PRIMARY KEY(source_id,directory_id)
    );
    CREATE TABLE IF NOT EXISTS source_keys (identity TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS offer_origins (
      offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
      directory_id TEXT NOT NULL REFERENCES directories(id), observed_at TEXT,
      PRIMARY KEY(offer_id,directory_id)
    );
    CREATE INDEX IF NOT EXISTS offers_url ON offers(url);
    CREATE INDEX IF NOT EXISTS offers_seen ON offers(last_seen_at DESC);
  `);
  if (!(connection.prepare("PRAGMA table_info(offers)").all() as { name: string }[]).some(row => row.name === "data_origin")) connection.exec("ALTER TABLE offers ADD COLUMN data_origin TEXT NOT NULL DEFAULT 'Магазин'");
  globalDb.panelDb = connection;
  return connection;
}
export function all<T>(sql: string, ...args: SQLInputValue[]): T[] { return db().prepare(sql).all(...args) as T[]; }
export function one<T>(sql: string, ...args: SQLInputValue[]): T | undefined { return db().prepare(sql).get(...args) as T | undefined; }
export function run(sql: string, ...args: SQLInputValue[]) { return db().prepare(sql).run(...args); }
export function transaction<T>(fn: () => T): T {
  db().exec("BEGIN IMMEDIATE");
  try { const value = fn(); db().exec("COMMIT"); return value; }
  catch (error) { db().exec("ROLLBACK"); throw error; }
}
export function getSetting<T>(key: string, fallback: T): T {
  const row = one<{ value: string }>("SELECT value FROM settings WHERE key=?", key);
  return row ? JSON.parse(row.value) as T : fallback;
}
export function setSetting(key: string, value: unknown) {
  run("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, JSON.stringify(value));
}

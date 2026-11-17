import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { GlossaryTerm, Provider, Settings, SettingsView, FxSnapshot } from "../contracts";
import { all, dataDir, db, getSetting, one, run, setSetting } from "./db";

export const settingsSchema = z.object({
  provider: z.enum(["mymemory", "gemini", "deepl", "openai_compatible"]),
  gemini_model: z.string().regex(/^[\w.-]+$/).max(100),
  mymemory_email: z.union([z.literal(""), z.email()]),
  daily_character_limit: z.number().int().min(100).max(10000000),
  auto_translate: z.boolean(), translation_batch_size: z.number().int().min(1).max(100),
  request_interval_ms: z.number().int().min(1000).max(60000),
  compatible_base_url: z.union([z.literal(""), z.url()]).refine(value => !value || new URL(value).protocol === "https:", "Нужен HTTPS-адрес"),
  compatible_model: z.string().trim().min(1).max(200),
  translate_titles_only: z.boolean(),
});
export const defaults: Settings = {
  provider: "mymemory", gemini_model: "gemini-3.5-flash-lite", mymemory_email: "",
  daily_character_limit: 2000000, auto_translate: false, translation_batch_size: 20, request_interval_ms: 1500,
  compatible_base_url: "", compatible_model: "Qwen/Qwen3.5-27B", translate_titles_only: true,
};
export function settings(): Settings { return { ...defaults, ...getSetting<Partial<Settings>>("settings", {}) }; }
function encryptionKey() {
  db();
  const file = path.join(dataDir, "secret.key");
  if (!existsSync(file)) {
    try { writeFileSync(file, randomBytes(32), { mode: 0o600, flag: "wx" }); }
    catch (error) { if (!existsSync(file)) throw error; }
  }
  return readFileSync(file);
}
export function saveKey(provider: Provider, value: string) {
  if (!value) { run("DELETE FROM settings WHERE key=?", `secret:${provider}`); return; }
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  setSetting(`secret:${provider}`, Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64"));
}
export function readKey(provider: Provider) {
  const encoded = getSetting<string | null>(`secret:${provider}`, null);
  if (!encoded) return "";
  const data = Buffer.from(encoded, "base64"), decipher = createDecipheriv("aes-256-gcm", encryptionKey(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}
const initialGlossary: GlossaryTerm[] = [
  { source: "成品号", target: "готовый аккаунт" }, { source: "半成品", target: "аккаунт с незавершённой настройкой" },
  { source: "质保", target: "гарантия продавца" }, { source: "无质保", target: "без гарантии продавца" },
  { source: "首登", target: "первый вход" }, { source: "独享", target: "индивидуальный доступ" },
  { source: "共享", target: "общий доступ" }, { source: "代充", target: "пополнение продавцом" },
  { source: "直充", target: "прямое пополнение вашего аккаунта" }, { source: "卡密", target: "код или данные для активации" },
  { source: "自动发货", target: "автоматическая выдача" }, { source: "手动发货", target: "ручная выдача" },
  { source: "售后", target: "поддержка после покупки" }, { source: "换绑", target: "смена привязки" },
  { source: "翻车", target: "потеря доступа или блокировка" }, { source: "掉订阅", target: "отмена подписки" },
  { source: "月抛", target: "аккаунт на месяц без дальнейшего продления" }, { source: "满血", target: "полнофункциональный по заявлению продавца" },
  { source: "接码", target: "приём SMS-кода" }, { source: "接马", target: "приём SMS-кода" },
  { source: "接🐎", target: "приём SMS-кода" }, { source: "车位", target: "место в общей подписке" },
  { source: "上车", target: "подключение к общей подписке" },
];
export function glossary() {
  if (!getSetting("glossary_initialized", false)) {
    for (const term of initialGlossary) run("INSERT OR IGNORE INTO glossary VALUES(?,?)", term.source, term.target);
    setSetting("glossary_initialized", true);
  }
  return all<GlossaryTerm>("SELECT source,target FROM glossary ORDER BY length(source) DESC,source");
}
export function usageDay() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date()); }
export function usage(provider: Provider) { return one<{ characters: number }>("SELECT characters FROM translation_usage WHERE day=? AND provider=?", usageDay(), provider)?.characters || 0; }
export function workerOnline() { return Date.now() - Date.parse(getSetting("worker_heartbeat", "1970-01-01")) < 30000; }
export function publicSettings(): SettingsView {
  const config = settings();
  return { ...config, keys: { mymemory: Boolean(readKey("mymemory")), gemini: Boolean(readKey("gemini")), deepl: Boolean(readKey("deepl")), openai_compatible: Boolean(readKey("openai_compatible")) },
    usage: usage(config.provider), fx: getSetting<FxSnapshot | null>("fx", null), worker_online: workerOnline(), glossary: glossary() };
}

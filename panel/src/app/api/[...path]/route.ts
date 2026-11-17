import { randomUUID } from "node:crypto";
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { one, run, setSetting, transaction } from "@/lib/server/db";
import { glossary, publicSettings, saveKey, settingsSchema, workerOnline } from "@/lib/server/config";
import { market, now, offerDetail, sourceById, sources } from "@/lib/server/store";
import { directories } from "@/lib/server/catalog";
import { identifyPlatform } from "@/lib/server/collectors";
import { CollectorError, publicUrl, resolvePublic } from "@/lib/server/network";
import { translateOffer } from "@/lib/server/translation";

export const runtime = "nodejs";
const sourceSchema = z.object({ name: z.string().trim().min(1).max(100), url: z.url().max(2000),
  platform: z.enum(["auto", "shopapi", "kami", "dujiao", "16688", "feed"]), transport: z.enum(["http", "browser"]),
  interval_minutes: z.number().int().min(5).max(10080), enabled: z.boolean() });
function guard(request: NextRequest, write: boolean) {
  const url = new URL(request.url), host = request.headers.get("host") || url.host;
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) throw new CollectorError("Панель доступна только локально");
  if (write) {
    if (request.headers.get("x-panel-request") !== "1") throw new CollectorError("Некорректный запрос");
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== host) throw new CollectorError("Недопустимый источник запроса");
  }
}
async function body(request: NextRequest) {
  if (Number(request.headers.get("content-length") || 0) > 100000) throw new CollectorError("Слишком большой запрос");
  const text = await request.text(); if (text.length > 100000) throw new CollectorError("Слишком большой запрос");
  return text ? JSON.parse(text) : {};
}
function json(value: unknown) { return NextResponse.json(value, { headers: { "Cache-Control": "no-store" } }); }
function errorResponse(error: unknown) {
  const message = error instanceof z.ZodError ? error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") : error instanceof CollectorError ? error.message : error instanceof Error && /не найден|Источник|Товар/.test(error.message) ? error.message : "Не удалось выполнить запрос";
  return NextResponse.json({ error: message }, { status: 400 });
}
type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: NextRequest, context: Context) {
  try {
    guard(request, false); const { path } = await context.params;
    if (path[0] === "market") return json(market(request.nextUrl.searchParams));
    if (path[0] === "sources") return json({ sources: sources(), worker_online: workerOnline() });
    if (path[0] === "directories") return json({ directories: directories(), worker_online: workerOnline() });
    if (path[0] === "settings") return json(publicSettings());
    if (path[0] === "offers" && path[1]) return json(offerDetail(path[1]));
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    guard(request, true); const { path } = await context.params, input = await body(request);
    if (path[0] === "sources") {
      const data = sourceSchema.parse(input), url = publicUrl(data.url); await resolvePublic(url);
      url.pathname = url.pathname.replace(/\/$/, "") || "/";
      const id = randomUUID(), platform = data.platform === "auto" ? identifyPlatform(url.href) : data.platform;
      if (one("SELECT id FROM sources WHERE url=?", url.href)) throw new CollectorError("Этот источник уже добавлен");
      run("INSERT INTO sources(id,name,url,platform,transport,enabled,interval_minutes,state,next_run_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", id, data.name, url.href, platform, data.transport, Number(data.enabled), data.interval_minutes, "catalog", null, now());
      return json({ id });
    }
    if (path[0] === "verification" && path[1] === "finish") { setSetting("verify_finish", true); return json({ ok: true }); }
    if (path[0] === "verification") {
      const source = sourceById(z.object({ source_id: z.string() }).parse(input).source_id);
      setSetting("verify_source", source.id); return json({ ok: true });
    }
    if (path[0] === "settings" && path[1] === "test") {
      const translated = await translateOffer({ title_original: "ChatGPT Plus 成品号 独享 质保30天", description_original: "", category_original: "" });
      return json({ title: translated.title, state: translated.uncertain ? "review" : "ready" });
    }
    if (path[0] === "settings" && path[1] === "refresh-fx") { setSetting("refresh_fx", true); return json(publicSettings()); }
    if (path[0] === "settings") {
      const data = settingsSchema.parse(input), key = z.string().max(4096).optional().parse(input.api_key), clear = z.boolean().optional().parse(input.clear_key);
      transaction(() => { setSetting("settings", data); if (clear) saveKey(data.provider, ""); else if (key) saveKey(data.provider, key); });
      return json(publicSettings());
    }
    if (path[0] === "glossary") {
      const data = z.object({ source: z.string().trim().min(1).max(100), target: z.string().trim().min(1).max(500) }).parse(input);
      run("INSERT INTO glossary VALUES(?,?) ON CONFLICT(source) DO UPDATE SET target=excluded.target", data.source, data.target); return json({ glossary: glossary() });
    }
    if (path[0] === "translations" && path[1] === "reset") {
      run("UPDATE offers SET translation_state='pending',translation_error=NULL WHERE translation_state IN ('ready','review','error')"); return json({ ok: true });
    }
    if (path[0] === "directories" && path[1] === "reset") {
      run("UPDATE directories SET state='idle',cursor=0,received=0,next_run_at=NULL,error=NULL"); run("DELETE FROM settings WHERE key LIKE 'directory_page_hash:%' OR key LIKE 'directory_pages:%'"); return json({ directories: directories() });
    }
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: NextRequest, context: Context) {
  try {
    guard(request, true); const { path } = await context.params, input = await body(request);
    if (path[0] === "offers" && path[1]) { const { starred } = z.object({ starred: z.boolean() }).parse(input); run("UPDATE offers SET starred=? WHERE id=?", Number(starred), path[1]); return json({ ok: true }); }
    if (path[0] === "sources" && path[1]) {
      const existing = sourceById(path[1]);
      if (Object.keys(input).length === 1 && input.enabled !== undefined) { const { enabled } = z.object({ enabled: z.boolean() }).parse(input); run("UPDATE sources SET enabled=? WHERE id=?", Number(enabled), existing.id); return json({ ok: true }); }
      const data = sourceSchema.parse(input); if (data.url !== existing.url) throw new CollectorError("Для другого URL добавьте новый источник");
      run("UPDATE sources SET name=?,platform=?,transport=?,enabled=?,interval_minutes=?,next_run_at=? WHERE id=?", data.name, data.platform, data.transport, Number(data.enabled), data.interval_minutes, existing.last_success_at ? new Date(Date.now() + data.interval_minutes * 60000).toISOString() : null, existing.id); return json({ ok: true });
    }
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: NextRequest, context: Context) {
  try {
    guard(request, true); const { path } = await context.params;
    if (path[0] === "sources" && path[1]) { run("DELETE FROM sources WHERE id=?", path[1]); return json({ ok: true }); }
    if (path[0] === "glossary" && path[1]) { run("DELETE FROM glossary WHERE source=?", decodeURIComponent(path[1])); return json({ glossary: glossary() }); }
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  } catch (error) { return errorResponse(error); }
}

import { chromium, type BrowserContext } from "playwright-core";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Source } from "../contracts";
import { dataDir } from "./db";
import { CollectorError, parseJsonResponse, publicUrl, resolvePublic } from "./network";

export async function browserContext(source: Source, headed: boolean) {
  await resolvePublic(publicUrl(source.url));
  const executablePath = process.env.PANEL_CHROMIUM_PATH || ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find(existsSync);
  if (!executablePath) throw new CollectorError("Укажите PANEL_CHROMIUM_PATH для браузерной сессии");
  const profile = new URL(source.url).hostname.replace(/[^a-z0-9.-]/gi, "_");
  const context = await chromium.launchPersistentContext(path.join(dataDir, "profiles", profile), {
    executablePath, headless: !headed, acceptDownloads: false, locale: "zh-CN", serviceWorkers: "block",
  });
  // Block local network requests even if a shop redirects or embeds a local URL.
  await context.route("**/*", async route => {
    const request = route.request();
    try {
      if (["image", "media", "font"].includes(request.resourceType()) && !headed) return await route.abort();
      await resolvePublic(publicUrl(request.url())); await route.continue();
    } catch { await route.abort(); }
  });
  return context;
}
export async function browserFetcher(source: Source) {
  const context = await browserContext(source, false);
  try {
    const page = await openStore(context, source.url);
    const content = await page.content();
    if (/captcha|verification|just a moment|验证/i.test(await page.title()) || /cf-chl-|challenge-platform/.test(content.slice(0, 4000))) throw new CollectorError("Нужна проверка в браузере", "challenge_required");
    return { close: () => context.close(), fetch: async (endpoint: string, body?: unknown) => {
      const response = await page.evaluate(async ({ endpoint, body }) => {
        const res = await fetch(endpoint, { method: body === undefined ? "GET" : "POST", credentials: "include",
          headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(25000) });
        const reader = res.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
        if (reader) { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 5 * 1024 * 1024) { await reader.cancel(); throw new Error("Ответ превышает лимит"); } chunks.push(value); } }
        const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        return { status: res.status, text: new TextDecoder().decode(bytes) };
      }, { endpoint, body });
      return parseJsonResponse(response);
    } };
  } catch (error) { await context.close(); throw error; }
}
export async function openStore(context: BrowserContext, url: string) {
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  return page;
}

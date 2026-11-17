import https from "node:https";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

export class CollectorError extends Error {
  constructor(message: string, public code = "failed") { super(message); }
}
export function publicUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new CollectorError("Некорректный URL"); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new CollectorError("Нужен публичный HTTPS-адрес");
  url.hash = "";
  return url;
}
export function publicAddress(address: string) {
  try { return ipaddr.process(address).range() === "unicast"; } catch { return false; }
}
export async function resolvePublic(url: URL) {
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true });
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new CollectorError("Локальные и служебные адреса недоступны");
  return addresses.find(a => a.family === 4) || addresses[0];
}
export async function requestText(value: string, options: { body?: unknown; headers?: Record<string, string>; maxBytes?: number; timeout?: number } = {}) {
  const url = publicUrl(value), address = await resolvePublic(url);
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Promise<{ text: string; status: number; contentType: string }>((resolve, reject) => {
    const req = https.request(url, {
      method: body ? "POST" : "GET", agent: false, family: address.family,
      lookup: (_host, _options, callback) => callback(null, address.address, address.family),
      headers: { "User-Agent": "PrivateMarketPanel/1.0", Accept: "application/json", ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}), ...options.headers },
    }, res => {
      const chunks: Buffer[] = []; let bytes = 0;
      res.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > (options.maxBytes || 5 * 1024 * 1024)) { req.destroy(new CollectorError("Ответ превышает лимит")); } else chunks.push(chunk); });
      res.on("error", reject);
      res.on("end", () => resolve({ text: Buffer.concat(chunks).toString("utf8"), status: res.statusCode || 0, contentType: String(res.headers["content-type"] || "") }));
    });
    const timer = setTimeout(() => req.destroy(new CollectorError("Превышено время запроса", "network_error")), options.timeout || 25000);
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
export function parseJsonResponse(response: { text: string; status: number }) {
  if (response.status === 429) throw new CollectorError("Источник ограничил частоту запросов", "rate_limited");
  if (response.status === 403 || /<title>[^<]*(verification|just a moment|verify|检查|验证)/i.test(response.text) || /captcha|cf-chl-|challenge-platform/i.test(response.text.slice(0, 3000))) throw new CollectorError("Нужна проверка в браузере", "challenge_required");
  if (response.status < 200 || response.status >= 300) throw new CollectorError(`Источник вернул HTTP ${response.status}`, response.status >= 500 ? "upstream_error" : "failed");
  try { return JSON.parse(response.text) as unknown; } catch { throw new CollectorError("Источник вернул не JSON", "parse_error"); }
}
export async function requestJson(value: string, options?: Parameters<typeof requestText>[1]) { return parseJsonResponse(await requestText(value, options)); }
export async function requestSseJson(value: string, options: { body?: unknown; headers?: Record<string, string>; maxBytes?: number; timeout?: number } = {}) {
  const url = publicUrl(value), address = await resolvePublic(url), body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Promise<unknown[]>((resolve, reject) => {
    const req = https.request(url, {
      method: body ? "POST" : "GET", agent: false, family: address.family,
      lookup: (_host, _options, callback) => callback(null, address.address, address.family),
      headers: { "User-Agent": "PrivateMarketPanel/1.0", Accept: "text/event-stream", ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}), ...options.headers },
    }, res => {
      let bytes = 0, buffer = ""; const events: unknown[] = [];
      const flush = (block: string) => {
        const data = block.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
        if (!data || data === "[DONE]") return;
        try { events.push(JSON.parse(data)); } catch { /* keep malformed events for the caller's parse error */ }
      };
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > (options.maxBytes || 5 * 1024 * 1024)) { req.destroy(new CollectorError("Ответ превышает лимит")); return; }
        buffer += chunk.toString("utf8");
        let split = buffer.indexOf("\n\n");
        while (split >= 0) { flush(buffer.slice(0, split)); buffer = buffer.slice(split + 2); split = buffer.indexOf("\n\n"); }
      });
      res.on("error", reject);
      res.on("end", () => {
        if (buffer.trim()) flush(buffer);
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          try { parseJsonResponse({ text: JSON.stringify(events[0] || {}), status: res.statusCode }); }
          catch (error) { reject(error); return; }
        }
        resolve(events);
      });
    });
    const timer = setTimeout(() => req.destroy(new CollectorError("Превышено время запроса", "network_error")), options.timeout || 90000);
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

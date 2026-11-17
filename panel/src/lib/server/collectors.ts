import { Decimal } from "decimal.js";
import { decodeHTML } from "entities";
import type { Platform, RawOffer, ScanResult, Source, StockStatus } from "../contracts";
import { CollectorError, publicUrl } from "./network";

export type Fetcher = (path: string, body?: unknown) => Promise<unknown>;
type Row = Record<string, unknown>;
export const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
export const list = (value: unknown): Row[] => Array.isArray(value) ? value.map(record) : [];
export function text(value: unknown) {
  return decodeHTML(String(value ?? "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<\/?(?:p|div|br|li|h[1-6])\b[^>]*>/gi, "\n").replace(/<[^>]*>/g, " ")).replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
export function amount(value: unknown): string | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  try { const n = new Decimal(String(value).trim()); return n.isFinite() && n.gte(0) ? n.toFixed() : null; } catch { return null; }
}
export function quantity(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const n = Number(value); return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
const flag = (value: unknown) => value === true || value === 1 || value === "1";
function safeLink(value: unknown, fallback: string) {
  try { return publicUrl(new URL(String(value || fallback), fallback).href).href; } catch { return fallback; }
}
export function stock(count: number | null, unavailable = false, available?: boolean): StockStatus {
  return unavailable ? "unavailable" : count === 0 || available === false ? "out_of_stock" : (count !== null && count > 0) || available === true ? "in_stock" : "unknown";
}
export function identifyPlatform(value: string): Platform {
  const url = publicUrl(value);
  if (/(^|\.)16688\.com\.cn$/.test(url.hostname)) return "16688";
  if (/^\/shop\/[^/]+/.test(url.pathname)) return "shopapi";
  if (/\.json$/.test(url.pathname)) return "feed";
  return "auto";
}
function payload(value: unknown) {
  const data = record(value);
  if (data.code !== undefined && ![0, 1, 200, "0", "1", "200"].includes(data.code as string | number)) throw new CollectorError(`API: ${text(data.msg || data.message || "ошибка").slice(0, 200)}`);
  return data;
}
function baseOffer(row: Row, origin: string, key: string): RawOffer {
  const price = amount(row.price);
  return { key, title: text(row.name || row.title), description: text(row.description || row.content), category: text(record(row.category).name),
    url: safeLink(row.link || row.url, `${origin}/item/${encodeURIComponent(key)}`), price,
    currency: /^[A-Z]{3}$/.test(String(row.currency || "")) ? String(row.currency) : "CNY",
    stockCount: null, stockStatus: "unknown", minimumQuantity: 1, raw: row };
}
export async function collect(source: Source, fetcher: Fetcher): Promise<ScanResult> {
  const url = publicUrl(source.url), origin = url.origin;
  let platform = source.platform === "auto" ? identifyPlatform(source.url) : source.platform;
  if (platform === "auto") {
    for (const [candidate, endpoint] of [["kami", "/user/api/index/commodity?limit=1&page=1"], ["dujiao", "/api/v1/public/products?page=1&page_size=1"]] as const) {
      try {
        const probe = payload(await fetcher(endpoint));
        if (Array.isArray(probe.data) || Array.isArray(record(probe.data).list) || Array.isArray(record(probe.data).items)) { platform = candidate; break; }
      } catch (error) { if (error instanceof CollectorError && ["challenge_required", "rate_limited"].includes(error.code)) throw error; }
    }
    if (platform === "auto") throw new CollectorError("Платформа не определена. Выберите её в настройках источника.");
  }
  const offers: RawOffer[] = [];
  let complete = false, expectedCount: number | undefined, name: string | undefined;
  const seenPages = new Set<string>();
  if (platform === "shopapi") {
    const token = decodeURIComponent(url.pathname.split("/")[2] || "");
    if (!token) throw new CollectorError("Нужна ссылка /shop/идентификатор");
    const info = record(payload(await fetcher("/shopApi/Shop/info", { token, category_key: "" })).data);
    name = text(info.nickname || info.name || info.shop_name) || undefined;
    // LDXP exposes separate catalogues for cards, knowledge, resources and rights.
    for (const goodsType of ["card", "article", "resource", "equity"] as const) {
      let categories: Row[] = [];
      try { categories = list(payload(await fetcher("/shopApi/Shop/categoryList", { token, goods_type: goodsType, category_key: "" })).data); } catch (error) {
        if (error instanceof CollectorError && ["parse_error", "challenge_required", "rate_limited"].includes(error.code)) throw error;
      }
      const categoryById = new Map(categories.map(c => [String(c.id), text(c.name)]));
      const typeKeys = new Set<string>(); let typeReceived = 0;
      for (let current = 1; current <= 30; current++) {
        const data = record(payload(await fetcher("/shopApi/Shop/goodsList", { token, keywords: "", category_id: 0, goods_type: goodsType, current, pageSize: 100 })).data);
        if (!Array.isArray(data.list)) { if (current === 1) break; throw new CollectorError("Изменилась структура goodsList", "parse_error"); }
        const items = list(data.list); typeReceived += items.length; if (current === 1) expectedCount = (expectedCount || 0) + (quantity(data.total) || 0);
        const pageKeys = items.map(i => String(i.goods_key || i.id || "")).join("|");
        if (items.length && seenPages.has(`${goodsType}:${pageKeys}`)) { complete = false; break; }
        seenPages.add(`${goodsType}:${pageKeys}`);
        for (const item of items) {
          const rawKey = String(item.goods_key || item.id || ""); if (!rawKey || typeKeys.has(rawKey)) continue; typeKeys.add(rawKey);
          const key = `${goodsType}:${rawKey}`, extend = record(item.extend), offer = baseOffer(item, origin, key);
          offer.stockCount = quantity(extend.stock_count ?? item.stock_count);
          offer.stockStatus = stock(offer.stockCount, item.status !== undefined && ![1, "1"].includes(item.status as number));
          offer.minimumQuantity = quantity(extend.limit_count) || 1;
          offer.category = text(offer.category) || categoryById.get(String(item.category_id)) || goodsType;
          offers.push(offer);
        }
        if (!items.length || (quantity(data.total) === null ? items.length < 100 : typeReceived >= Number(data.total))) break;
      }
    }
    complete = expectedCount === undefined || offers.length >= expectedCount;
  } else if (platform === "16688") {
    const alias = decodeURIComponent(url.pathname.split("/")[2] || "");
    if (!alias) throw new CollectorError("Нужна ссылка на магазин 16688");
    const info = record(payload(await fetcher("/shopApi/shop/detail", { shop_no: alias })).data);
    const shopNo = String(info.shop_no || ""); if (!shopNo) throw new CollectorError("Не найден постоянный номер магазина");
    name = text(info.name) || undefined;
    const data = record(payload(await fetcher("/shopApi/goods/list", { shop_no: shopNo, sort: "default" })).data);
    if (!Array.isArray(data.list)) throw new CollectorError("Изменилась структура каталога 16688", "parse_error");
    const categories = list(payload(await fetcher("/shopApi/goodsCategory/list", { shop_no: shopNo })).data);
    const categoryById = new Map(categories.map(c => [String(c.goods_category_no), text(c.name)]));
    for (const item of list(data.list)) {
      const key = String(item.goods_no || ""); if (!key) throw new CollectorError("У товара нет goods_no", "parse_error");
      const offer = baseOffer(item, origin, key);
      offer.url = `${origin}/goods/${encodeURIComponent(key)}`;
      offer.stockCount = quantity(item.stock_available_quantity);
      const state = String(item.stock_available_status || "");
      offer.stockStatus = stock(offer.stockCount, ["offline", "closed", "unavailable"].includes(state), state === "out" ? false : ["in", "available", "sufficient", "high", "normal", "low"].includes(state) ? true : undefined);
      offer.minimumQuantity = quantity(item.limit_quantity) || 1;
      offer.category = categoryById.get(String(item.goods_category_no)) || "";
      offers.push(offer);
    }
    complete = true; expectedCount = offers.length;
  } else if (platform === "kami") {
    for (let page = 1; page <= 30; page++) {
      const result = payload(await fetcher(`/user/api/index/commodity?limit=100&page=${page}`));
      if (!Array.isArray(result.data)) throw new CollectorError("Изменилась структура commodity", "parse_error");
      const items = list(result.data); expectedCount = quantity(result.total) ?? expectedCount;
      const pageKeys = items.map(i => i.id).join("|"); if (items.length && seenPages.has(pageKeys)) break;
      seenPages.add(pageKeys);
      for (const item of items) {
        const key = String(item.id ?? ""); if (!key) throw new CollectorError("У товара нет id", "parse_error");
        const offer = baseOffer(item, origin, key);
        offer.price = amount(item.user_price ?? item.price);
        offer.stockCount = flag(item.inventory_hidden) ? null : quantity(item.stock);
        offer.stockStatus = stock(offer.stockCount, flag(item.hide) || (item.status !== undefined && ![1, "1"].includes(item.status as number)));
        offers.push(offer);
      }
      if (!items.length || (expectedCount !== undefined ? offers.length >= expectedCount : items.length < 100)) { complete = expectedCount === undefined || offers.length >= expectedCount; break; }
    }
  } else if (platform === "dujiao") {
    for (let page = 1; page <= 30; page++) {
      const root = payload(await fetcher(`/api/v1/public/products?page=${page}&page_size=100`)), data = record(root.data);
      const candidate = Array.isArray(root.data) ? root.data : data.list ?? data.items;
      if (!Array.isArray(candidate)) throw new CollectorError("Изменилась структура Dujiao-Next", "parse_error");
      const items = list(candidate), pageKeys = items.map(i => i.id || i.slug).join("|");
      if (items.length && seenPages.has(pageKeys)) break; seenPages.add(pageKeys);
      for (const item of items) {
        const productKey = String(item.id ?? item.slug ?? ""); if (!productKey) throw new CollectorError("У товара нет id", "parse_error");
        const skus = list(item.skus);
        for (const sku of skus.length ? skus : [item]) {
          const key = skus.length ? `${productKey}:${String(sku.id || sku.sku_id || sku.sku_code || "")}` : productKey;
          if (key.endsWith(":")) throw new CollectorError("У варианта товара нет идентификатора", "parse_error");
          const offer = baseOffer(item, origin, key);
          offer.title = [text(item.name || item.title), skus.length ? text(sku.name || sku.title) : ""].filter(Boolean).join(" · ");
          offer.price = amount(sku.price_amount ?? item.price_amount);
          offer.url = `${origin}/products/${encodeURIComponent(String(item.slug || productKey))}`;
          offer.stockCount = quantity(sku.auto_stock_available ?? sku.manual_stock_available ?? item.auto_stock_available ?? item.manual_stock_available);
          offer.stockStatus = stock(offer.stockCount, false, sku.sold_out === true || item.sold_out === true ? false : undefined);
          offer.raw = { product: item, sku }; offers.push(offer);
        }
      }
      const total = quantity(data.total ?? record(root.pagination).total);
      if (!items.length || items.length < 100 || (total !== null && page * 100 >= total)) { complete = true; break; }
    }
  } else if (platform === "feed") {
    const root = await fetcher(url.pathname + url.search), data = record(root);
    const items = Array.isArray(root) ? root : data.items;
    if (!Array.isArray(items)) throw new CollectorError("В JSON-фиде нужен массив items");
    name = text(record(data.shop).name) || undefined;
    for (const item of list(items)) {
      const key = String(item.id ?? ""); if (!key || !item.name || !item.url) throw new CollectorError("В товаре нужны id, name и url");
      const offer = baseOffer(item, origin, key);
      offer.category = text(item.category); offer.stockCount = quantity(item.stock_count ?? item.stock);
      offer.stockStatus = stock(offer.stockCount); offers.push(offer);
    }
    complete = true; expectedCount = offers.length;
  }
  if (offers.some(o => !o.title)) throw new CollectorError("Получен товар без названия", "parse_error");
  const unique = [...new Map(offers.map(o => [o.key, o])).values()];
  if (expectedCount !== undefined && unique.length < expectedCount) complete = false;
  return { offers: unique, complete, expectedCount, name, platform, note: complete ? undefined : "Каталог получен не полностью; отсутствующие товары сохранены" };
}

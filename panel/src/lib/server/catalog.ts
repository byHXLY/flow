import { decodeHTML } from "entities";
import type { Directory, Platform, RawOffer, Source } from "../contracts";
import { all, getSetting, one, run, setSetting } from "./db";
import { amount, identifyPlatform, list, quantity, record, stock, text } from "./collectors";
import { CollectorError, publicUrl, requestJson, requestText } from "./network";
import { hash, now, persistScan } from "./store";

const definitions = [
  ["aihaotan", "AIhaotan", "https://aihaotan.com/", "aihaotan"],
  ["findai", "FindAI", "https://findai8.com/", "findai"],
  ["cardnav", "CardNav", "https://cardnav.xyz/", "cardnav"],
  ["aibijia", "AIbijia", "https://aibijia.org/", "aibijia"],
  ["aideal", "AIDeal", "https://closeman.asia/", "aideal"],
  ["taokayou", "Taokayou", "https://taokayou.com/shops", "taokayou"],
  ["lowb", "Lowb", "https://lowb.cc/", "lowb"],
  ["apinav", "ApiNav", "https://apinav.cc/", "html"],
  ["openprice", "OpenPrice", "https://www.openprice.cc/", "openprice"],
  ["priceai", "PriceAI", "https://priceai.cc/", "priceai"],
  ["pricememory", "AI Price Memory", "https://ai.pricememo.cn/", "pricememory"],
] as const;
const indexHosts = new Set(definitions.map(d => new URL(d[2]).hostname.replace(/^www\./, "")));
const ldxpHosts = new Set(["ldxp.cn", "www.ldxp.cn", "pay.ldxp.cn", "wzyp.cn", "www.wzyp.cn"]);
export function canonicalProduct(url: string) {
  const parsed = publicUrl(url);
  if (ldxpHosts.has(parsed.hostname)) parsed.hostname = "wzyp.cn";
  parsed.search = ""; parsed.hash = ""; return parsed.href.replace(/\/$/, "");
}
function merchantIdentity(value: string) {
  const url = publicUrl(value);
  if (ldxpHosts.has(url.hostname)) return `ldxp:${url.pathname.split("/")[2]?.toLowerCase()}`;
  return url.href.replace(/\/$/, "");
}
export function initializeCatalog() {
  for (const [id, name, url, strategy] of definitions) { run("INSERT OR IGNORE INTO directories(id,name,url,strategy) VALUES(?,?,?,?)", id, name, url, strategy); run("UPDATE directories SET name=?,url=?,strategy=? WHERE id=?", name, url, strategy, id); }
  if (!getSetting("source_keys_v1", false)) {
    for (const source of all<Source>("SELECT * FROM sources")) run("INSERT OR IGNORE INTO source_keys VALUES(?,?)", merchantIdentity(source.url), source.id);
    setSetting("source_keys_v1", true);
  }
}
export function directories() {
  initializeCatalog();
  return all<Directory>(`SELECT d.*,
    (SELECT count(*) FROM seller_origins so WHERE so.directory_id=d.id) seller_count,
    (SELECT count(*) FROM offer_origins oo WHERE oo.directory_id=d.id) offer_count
    FROM directories d ORDER BY CASE WHEN d.strategy IN ('findai','aihaotan') THEN 0 ELSE 1 END,d.name`);
}
export function upsertSeller(urlValue: string, name: string, directoryId: string, platform?: Platform) {
  const url = publicUrl(urlValue); url.hash = "";
  const identity = merchantIdentity(url.href), id = hash(["seller", identity]);
  let seller = one<Source>("SELECT * FROM sources WHERE url=? OR id=?", url.href, id);
  if (!seller) seller = one<Source>("SELECT s.* FROM sources s JOIN source_keys k ON s.id=k.source_id WHERE k.identity=?", identity);
  if (!seller) {
    const detected = platform || identifyPlatform(url.href), timestamp = now();
    run("INSERT OR IGNORE INTO sources(id,name,url,platform,enabled,state,next_run_at,created_at) VALUES(?,?,?,?,?,?,?,?)", id, name || url.pathname.split("/").pop() || url.hostname, url.href, detected, detected === "index" ? 0 : 1, "catalog", detected === "index" ? null : timestamp, timestamp);
    seller = one<Source>("SELECT * FROM sources WHERE id=? OR url=?", id, url.href)!;
  }
  run("INSERT OR IGNORE INTO seller_origins VALUES(?,?)", seller.id, directoryId);
  run("INSERT OR IGNORE INTO source_keys VALUES(?,?)", identity, seller.id);
  return seller;
}
function sourceDate(value: unknown) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) && timestamp <= Date.now() + 86400000 ? new Date(timestamp).toISOString() : "1970-01-01T00:00:00.000Z";
}
function ingestRows(directory: Directory, rows: Record<string, unknown>[]) {
  const groups = new Map<string, { seller: Source; offers: RawOffer[] }>();
  for (const row of rows) {
    const link = String(row.linkUrl || row.link || "");
    if (!link) continue;
    let canonical: string;
    try { canonical = canonicalProduct(link); } catch { continue; }
    const existing = one<{ source_id: string; product_key: string }>("SELECT source_id,product_key FROM offers WHERE url=?", canonical);
    let seller: Source;
    if (existing) {
      seller = one<Source>("SELECT * FROM sources WHERE id=?", existing.source_id)!;
      // A directory listing may reveal the real shop URL after the first index pass.
      if (seller.platform === "index" && row.shopUrl) {
        try {
          const directUrl = publicUrl(String(row.shopUrl));
          run("UPDATE sources SET name=?,url=?,platform=?,enabled=1,state='catalog',next_run_at=NULL WHERE id=?", text(row.shopName) || seller.name, directUrl.href.replace(/\/$/, ""), identifyPlatform(directUrl.href), seller.id);
          seller = one<Source>("SELECT * FROM sources WHERE id=?", seller.id)!;
          run("INSERT OR IGNORE INTO source_keys VALUES(?,?)", merchantIdentity(directUrl.href), seller.id);
        } catch {}
      }
      run("INSERT OR IGNORE INTO seller_origins VALUES(?,?)", seller.id, directory.id);
    } else if (row.shopUrl) seller = upsertSeller(String(row.shopUrl), text(row.shopName), directory.id, (row.shopPlatform as Platform | undefined));
    else if (row.shop_name) seller = upsertSeller(`https://${directory.id}.local/?seller=${encodeURIComponent(text(row.shop_name))}`, text(row.shop_name), directory.id, "index");
    else if (row.shop_id) seller = upsertSeller(`https://findai8.com/?shop=${encodeURIComponent(String(row.shop_id))}`, text(row.shop_name), directory.id, "index");
    else continue;
    const key = existing?.product_key || String(row.key || new URL(canonical).pathname.split("/").pop() || row.id);
    const count = quantity(row.stock), title = text(row.title || row.name);
    if (!title || !key) continue;
    const offer: RawOffer = { key, title, description: text(row.desc || row.description), category: text(record(row.category).name || row.category || ""),
      url: canonical, price: amount(row.price), currency: /^[A-Z]{3}$/.test(String(row.currency || "")) ? String(row.currency) : "CNY", stockCount: count, stockStatus: typeof row.stockStatus === "string" ? (row.stockStatus === "in_stock" || row.stockStatus === "low_stock" ? "in_stock" : row.stockStatus === "out_of_stock" ? "out_of_stock" : stock(count)) : stock(count), minimumQuantity: 1,
      observedAt: sourceDate(row.updateTime || row.updated_at), raw: { origin: directory.name, remote_id: row.id || row.guid, remote_updated_at: row.updateTime || row.updated_at } };
    const group = groups.get(seller.id) || { seller, offers: [] }; group.offers.push(offer); groups.set(seller.id, group);
  }
  for (const { seller, offers } of groups.values()) persistScan(seller, { offers, complete: false, platform: seller.platform }, directory);
}
export function extractStoreLinks(content: string) {
  const unescaped = decodeHTML(content.replace(/\\u002[fF]/g, "/").replace(/\\\//g, "/").replace(/\\"/g, '"'));
  const found = new Set<string>();
  for (const match of unescaped.matchAll(/https:\/\/[^\s"'<>\\]+/g)) {
    try {
      const url = publicUrl(match[0].replace(/[),.;]+$/, ""));
      if (indexHosts.has(url.hostname.replace(/^www\./, ""))) continue;
      const shop = url.pathname.match(/^\/shop\/([\w.~%-]+)\/?$/);
      if (!shop || /^(xxx|token|slug|example)$/i.test(shop[1])) continue;
      url.search = ""; found.add(url.href);
    } catch {}
  }
  return [...found];
}
async function discoveryPage(directory: Directory) {
  let content = "", next = false;
  if (directory.strategy === "cardnav") {
    content = JSON.stringify(await requestJson("https://cardnav.xyz/api/shop-products.json", { maxBytes: 30 * 1024 * 1024 }));
  } else if (directory.strategy === "aibijia") {
    content = JSON.stringify(await requestJson("https://aibijia.org/live-data/catalog.json", { maxBytes: 30 * 1024 * 1024 }));
  } else if (directory.strategy === "aideal") {
    const release = record(await requestJson("https://closeman.asia/release.json")), initial = record(release.files).initial;
    if (!initial || typeof initial !== "string") throw new CollectorError("Каталог не указан в манифесте");
    content = JSON.stringify(await requestJson(new URL(initial, directory.url).href, { maxBytes: 30 * 1024 * 1024 }));
  } else {
    const pages = getSetting<string[]>(`directory_pages:${directory.id}`, [directory.url]);
    const url = pages[directory.cursor] || directory.url;
    const response = await requestText(url, { maxBytes: 10 * 1024 * 1024 });
    if (response.status !== 200) throw new CollectorError(`HTTP ${response.status}`);
    content = response.text;
    if (directory.id === "taokayou") {
      for (const m of content.matchAll(/href="([^"#]+)"/g)) {
        const link = new URL(decodeHTML(m[1]), directory.url);
        if (link.origin === new URL(directory.url).origin && (/^\/shop\/\d+$/.test(link.pathname) || (link.pathname === "/shops" && link.searchParams.has("page")))) {
          if (!pages.includes(link.href) && pages.length < 5000) pages.push(link.href);
        }
      }
      setSetting(`directory_pages:${directory.id}`, pages); next = directory.cursor + 1 < pages.length;
    }
  }
  const links = extractStoreLinks(content);
  for (const link of links) upsertSeller(link, "", directory.id);
  return { received: links.length, next };
}
async function packedRows(directory: Directory): Promise<Record<string, unknown>[]> {
  if (directory.strategy === "openprice") {
    const pages = getSetting<string[]>(`directory_pages:${directory.id}`, [`${directory.url}card-products`]);
    const url = pages[directory.cursor] || pages[0], response = await requestText(url, { maxBytes: 15 * 1024 * 1024 });
    if (response.status !== 200) throw new CollectorError(`HTTP ${response.status}`);
    const normalized = response.text.replace(/\\"/g, '"').replace(/\\\\n/g, " ");
    if (directory.cursor === 0) {
      for (const match of normalized.matchAll(/\"slug\":\"([a-z0-9_-]+)\"/gi)) { const page = `${directory.url}card-products/${match[1]}`; if (!pages.includes(page) && pages.length < 5000) pages.push(page); }
      for (const match of normalized.matchAll(/"slug":"([a-z0-9_-]+)"/gi)) { const page = `${directory.url}card-products/${match[1]}`; if (!pages.includes(page) && pages.length < 5000) pages.push(page); }
      setSetting(`directory_pages:${directory.id}`, pages);
    }
    const rows: Record<string, unknown>[] = [], seen = new Set<string>();
    for (const match of normalized.matchAll(/https:\/\/[^\s"'<>\\]+/g)) {
      try {
        const link = publicUrl(match[0].replace(/[),.;]+$/, "")), path = link.pathname.toLowerCase();
        if (indexHosts.has(link.hostname.replace(/^www\./, "")) || !/(?:\/products?\/|\/item\/|\/goods\/|\/shop\/)/.test(path) || seen.has(link.href)) continue;
        seen.add(link.href); const origin = `${link.origin}/`; let platform: Platform = "index"; try { const detected = identifyPlatform(origin); if (detected !== "auto") platform = detected; } catch {}
        rows.push({ id: link.href, title: decodeHTML(link.pathname.split("/").pop() || link.hostname), linkUrl: link.href, shop_name: link.hostname, shopUrl: origin, shopPlatform: platform });
      } catch {}
    }
    return rows;
  }
  if (directory.strategy === "pricememory") {
    const root = record(await requestJson(`https://ai.pricememo.cn/api/v1/catalog/groups?limit=100&offset=${directory.cursor}`, { maxBytes: 20 * 1024 * 1024 }));
    setSetting(`directory_total:${directory.id}`, quantity(root.total));
    return list(root.items).map(item => { const representative = record(item.representative); const token = text(representative.shop_token), shopUrl = token ? `https://wzyp.cn/shop/${encodeURIComponent(token)}` : ""; return { id: representative.id || item.fingerprint, title: representative.original_name || item.product_name, description: representative.original_description, category: representative.original_category, linkUrl: representative.source_url, price: representative.price, stock: representative.stock_count, stockStatus: representative.stock_status, shop_name: representative.shop_name, shopUrl, shopPlatform: token ? "shopapi" : "index", updated_at: representative.observed_at || root.last_updated_at }; });
  }
  if (directory.strategy === "priceai") {
    const response = await requestText(directory.url + "channels", { maxBytes: 30 * 1024 * 1024 });
    if (response.status !== 200) throw new CollectorError(`HTTP ${response.status}`);
    const rows: Record<string, unknown>[] = [];
    const normalized = response.text.replace(/\\"/g, '"').replace(/\\\\n/g, " ");
    const pattern = /"url":"(https:[^"]+)","price":(null|[0-9.]+),"status":"([^"]+)","currency":"([^"]+)","sourceId":"([^"]+)","sourceName":"([^"\\]*)","sourceTitle":"([^"\\]*)","collectorKind":"([^"\\]*)","sourceStoreName":"([^"\\]*)"/g;
    for (const match of normalized.matchAll(pattern)) rows.push({ id: match[1], title: match[7], linkUrl: match[1], price: match[2] === "null" ? null : match[2], stockStatus: match[3], currency: match[4], shop_name: match[8] || match[6], shopPlatform: "index" });
    return rows;
  }
  if (directory.strategy === "lowb") {
    const page = directory.cursor + 1, response = await requestText(`${directory.url}${page > 1 ? `?page=${page}` : ""}`, { maxBytes: 12 * 1024 * 1024 });
    if (response.status !== 200) throw new CollectorError(`HTTP ${response.status}`);
    const match = response.text.match(/<script[^>]+data-seo="collection-page"[^>]*>([\s\S]*?)<\/script>/i);
    if (!match) return [];
    try {
      const root = JSON.parse(match[1]), items = list(record(root.mainEntity).itemListElement);
      return items.map((item, index) => ({ id: item.url || index, title: item.name, linkUrl: item.url, shop_name: "Lowb.cc", shopUrl: directory.url, shopPlatform: "index" }));
    } catch { throw new CollectorError("Изменился формат каталога Lowb", "parse_error"); }
  }
  if (directory.strategy === "aibijia") {
    const root = record(await requestJson("https://aibijia.org/live-data/catalog.json", { maxBytes: 30 * 1024 * 1024 }));
    return list(root.products).flatMap(product => list(product.offers).map((offer, index) => ({ ...offer, id: `${text(product.slug)}:${index}`, title: offer.source_title || offer.title, linkUrl: offer.url, shop_name: offer.source_store_name || offer.platform_name, stockStatus: offer.status === "in_stock" || offer.status === "low_stock" ? "in_stock" : offer.status === "out_of_stock" ? "out_of_stock" : undefined })));
  }
  if (directory.strategy === "aideal") {
    const release = record(await requestJson("https://closeman.asia/release.json")), initial = record(release.files).initial;
    if (!initial || typeof initial !== "string") throw new CollectorError("Каталог не указан в манифесте");
    const root = record(await requestJson(new URL(initial, directory.url).href, { maxBytes: 30 * 1024 * 1024 })), shops = list(record(root.dict).shops), categories = Array.isArray(record(root.dict).categories) ? record(root.dict).categories as unknown[] : [];
    return list(root.rows).map(row => { const shop = shops[quantity(row[14]) || 0] || {}; const host = text(shop.host); return { id: row[0], title: row[15], linkUrl: row[17], price: row[7], category: text(categories[quantity(row[1]) || 0]), shop_name: shop.name, shopUrl: host ? `https://${host}/` : "", shopPlatform: "index", updated_at: root.updatedAt }; });
  }
  const root = record(await requestJson("https://cardnav.xyz/api/shop-products.json", { maxBytes: 30 * 1024 * 1024 })), sellers = new Map(list(root.s).map(row => [String(row[0]), row]));
  return list(root.p).map((row, index) => { const seller = sellers.get(String(row[10])) || {}; const shopUrl = text(seller[2]); let platform: Platform = "index"; try { const detected = identifyPlatform(shopUrl); if (detected !== "auto") platform = detected; } catch {} return { id: row[0] ?? index, title: row[2], price: row[3], linkUrl: row[5], stock: row[6], shop_name: seller[1], shopUrl, shopPlatform: platform, updated_at: new Date(Number(row[8] || Date.now())).toISOString() }; });
}
export async function importDirectory(directory: Directory) {
  run("UPDATE directories SET state='importing',error=NULL WHERE id=?", directory.id);
  if (directory.strategy === "findai") {
    const page = directory.cursor + 1;
    const root = record(await requestJson(`https://findai8.com/api/goods?page=${page}&limit=100&only_stock=false&only_warranty=false&only_coupon=false`, { maxBytes: 10 * 1024 * 1024 }));
    if (!Array.isArray(root.goods)) throw new CollectorError("Изменился формат каталога FindAI");
    const rows = list(root.goods), pagination = record(root.pagination), limit = quantity(pagination.limit) || 100;
    const total = quantity(pagination.total), done = !rows.length || (total !== null && page * limit >= total);
    ingestRows(directory, rows);
    run("UPDATE directories SET cursor=?,total=?,received=received+?,state=?,checked_at=?,next_run_at=? WHERE id=?", page, total, rows.length, done ? "connected" : "importing", now(), done ? new Date(Date.now() + 6 * 3600000).toISOString() : null, directory.id);
  } else if (directory.strategy === "aihaotan") {
    const rows = await requestJson(`https://aihaotan.com/api/goods?limit=100&offset=${directory.cursor}&sortBy=default`, { maxBytes: 15 * 1024 * 1024 });
    if (!Array.isArray(rows)) throw new CollectorError("Изменился формат каталога AIhaotan");
    const signature = hash(list(rows).map(row => row.guid));
    if (rows.length && getSetting(`directory_page_hash:${directory.id}`, "") === signature) throw new CollectorError("Источник повторяет страницу каталога");
    setSetting(`directory_page_hash:${directory.id}`, signature);
    ingestRows(directory, list(rows));
    const done = rows.length < 100;
    run("UPDATE directories SET cursor=cursor+?,received=received+?,state=?,checked_at=?,next_run_at=? WHERE id=?", rows.length, rows.length, done ? "connected" : "importing", now(), done ? new Date(Date.now() + 6 * 3600000).toISOString() : null, directory.id);
  } else if (["aibijia", "aideal", "cardnav"].includes(directory.strategy)) {
    const rows = await packedRows(directory);
    ingestRows(directory, rows);
    run("UPDATE directories SET cursor=1,total=?,received=?,state='connected',checked_at=?,next_run_at=? WHERE id=?", rows.length, rows.length, now(), new Date(Date.now() + 12 * 3600000).toISOString(), directory.id);
  } else if (directory.strategy === "taokayou") {
    const rows = await packedRows(directory);
    ingestRows(directory, rows);
    const pages = getSetting<string[]>(`directory_pages:${directory.id}`, []), done = directory.cursor + 1 >= pages.length;
    run("UPDATE directories SET cursor=cursor+1,total=?,received=received+?,state=?,checked_at=?,next_run_at=? WHERE id=?", pages.length, rows.length, done ? "connected" : "importing", now(), done ? new Date(Date.now() + 12 * 3600000).toISOString() : null, directory.id);
  } else if (directory.strategy === "openprice") {
    const rows = await packedRows(directory);
    ingestRows(directory, rows);
    const pages = getSetting<string[]>(`directory_pages:${directory.id}`, []), done = directory.cursor + 1 >= pages.length;
    run("UPDATE directories SET cursor=cursor+1,total=?,received=received+?,state=?,checked_at=?,next_run_at=? WHERE id=?", pages.length, rows.length, done ? "connected" : "importing", now(), done ? new Date(Date.now() + 12 * 3600000).toISOString() : null, directory.id);
  } else if (directory.strategy === "pricememory") {
    const rows = await packedRows(directory);
    ingestRows(directory, rows);
    const total = getSetting<number>(`directory_total:${directory.id}`, directory.total || 0);
    const done = rows.length < 100;
    run("UPDATE directories SET cursor=cursor+?,total=?,received=received+?,state=?,checked_at=?,next_run_at=? WHERE id=?", rows.length, total, rows.length, done ? "connected" : "importing", now(), done ? new Date(Date.now() + 12 * 3600000).toISOString() : null, directory.id);
  } else if (directory.strategy === "priceai") {
    const rows = await packedRows(directory);
    ingestRows(directory, rows);
    run("UPDATE directories SET cursor=1,total=?,received=?,state='connected',checked_at=?,next_run_at=? WHERE id=?", rows.length, rows.length, now(), new Date(Date.now() + 12 * 3600000).toISOString(), directory.id);
  } else if (directory.strategy === "lowb") {
    const rows = await packedRows(directory);
    ingestRows(directory, rows);
    const done = rows.length === 0;
    run("UPDATE directories SET cursor=cursor+1,total=coalesce(total,?),received=received+?,state=?,checked_at=?,next_run_at=? WHERE id=?", rows.length || directory.total, rows.length, done ? "connected" : "importing", now(), done ? new Date(Date.now() + 12 * 3600000).toISOString() : null, directory.id);
  } else {
    const result = await discoveryPage(directory);
    run("UPDATE directories SET cursor=cursor+1,received=received+?,state=?,checked_at=?,next_run_at=? WHERE id=?", result.received, result.next ? "importing" : directory.received + result.received ? "connected" : "no_links", now(), result.next ? null : new Date(Date.now() + 12 * 3600000).toISOString(), directory.id);
  }
}
export function resetCatalog() {
  initializeCatalog();
  run("UPDATE directories SET state='idle',cursor=0,received=0,next_run_at=NULL,error=NULL WHERE state!='importing'");
}

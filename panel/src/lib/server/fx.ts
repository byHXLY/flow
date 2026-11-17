import { XMLParser } from "fast-xml-parser";
import { Decimal } from "decimal.js";
import type { FxSnapshot } from "../contracts";
import { setSetting } from "./db";
import { requestText, CollectorError } from "./network";
import { now } from "./store";

export function parseCbr(xml: string): FxSnapshot {
  const root = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(xml).ValCurs;
  if (!root || !root["@_Date"] || !root.Valute) throw new CollectorError("Некорректный ответ ЦБ");
  const rates: Record<string, string> = { RUB: "1" };
  const rows = Array.isArray(root.Valute) ? root.Valute : [root.Valute];
  for (const row of rows) {
    const nominal = new Decimal(String(row.Nominal).replace(",", ".")), value = new Decimal(String(row.Value).replace(",", "."));
    if (nominal.gt(0) && value.gt(0) && /^[A-Z]{3}$/.test(row.CharCode)) rates[row.CharCode] = value.div(nominal).toFixed();
  }
  if (!rates.CNY || !rates.USD) throw new CollectorError("В ответе ЦБ нет CNY или USD");
  const [day, month, year] = String(root["@_Date"]).split(".");
  return { date: `${year}-${month}-${day}`, fetched_at: now(), rates };
}
export async function updateFx() {
  const response = await requestText("https://www.cbr.ru/scripts/XML_daily.asp", { maxBytes: 1000000 });
  if (response.status !== 200) throw new CollectorError(`ЦБ вернул HTTP ${response.status}`);
  const snapshot = parseCbr(response.text); setSetting("fx", snapshot); return snapshot;
}

"use client";
import { useCallback, useEffect, useState } from "react";
export async function api<T = unknown>(path: string, data?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(`/api/${path}`, data === undefined && method === "POST" ? { cache: "no-store" } : {
    method, headers: { "Content-Type": "application/json", "x-panel-request": "1" }, ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || "Ошибка запроса"); return result as T;
}
export function useResource<T>(path: string, interval = 5000, initial: T | null = null) {
  const [data, setData] = useState<T | null>(initial), [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    let active = true; let loading = false;
    const load = async () => {
      if (loading) return; loading = true;
      try { const value = await api<T>(path); if (active) { setData(value); setError(""); } }
      catch (e) { if (active) setError(e instanceof Error ? e.message : "Ошибка загрузки"); }
      finally { loading = false; }
    };
    void load(); const timer = interval ? setInterval(load, interval) : undefined;
    return () => { active = false; clearInterval(timer); };
  }, [path, interval, revision]);
  return { data, error, refresh };
}
export function money(value: string | null, currency = "RUB") {
  if (value === null) return "—";
  try { return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value)); }
  catch { return `${value} ${currency}`; }
}
export function dateTime(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
}

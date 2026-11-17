export const platforms = {
  auto: "Авто", shopapi: "LDXP / CatFK", kami: "Kami / ACG-Faka",
  dujiao: "Dujiao-Next", "16688": "16688", feed: "JSON-фид", index: "Агрегатор",
} as const;
export type Platform = keyof typeof platforms;
export type StockStatus = "in_stock" | "out_of_stock" | "unknown" | "unavailable";
export const stockLabels: Record<StockStatus, string> = {
  in_stock: "В наличии", out_of_stock: "Нет в наличии", unknown: "Неизвестно", unavailable: "Снят",
};
export const jobLabels = { scan: "Сбор", translate: "Перевод", fx: "Курс валют", verify: "Сессия браузера" } as const;
export const stateLabels: Record<string, string> = {
  idle: "Не проверен", queued: "В очереди", running: "В работе", success: "Готово", partial: "Частично",
  failed: "Ошибка", cancelled: "Отменено", challenge_required: "Проверка", rate_limited: "Лимит",
  pending: "Не переведён", ready: "Переведён", review: "Проверить перевод", error: "Ошибка перевода",
  catalog: "Каталог", importing: "Загрузка", connected: "Подключён", unavailable: "Недоступен", no_links: "Нет прямых ссылок",
};
export type Source = {
  id: string; name: string; url: string; platform: Platform; transport: "http" | "browser";
  enabled: number; interval_minutes: number; state: string; error: string | null;
  last_attempt_at: string | null; last_success_at: string | null; next_run_at: string | null;
  created_at: string; offer_count?: number; active_job?: string | null;
};
export type Offer = {
  id: string; source_id: string; source_name: string; product_key: string;
  title_original: string; description_original: string; category_original: string;
  title_ru: string | null; description_ru: string | null; category_ru: string | null;
  translation_state: string; translation_provider: string | null; translation_error: string | null;
  url: string; price: string | null; currency: string; rub_price: string | null;
  stock_status: StockStatus; stock_count: number | null; minimum_quantity: number;
  starred: number; last_seen_at: string; last_changed_at: string; source_hash: string;
  data_origin?: string;
};
export type RawOffer = {
  key: string; title: string; description: string; category: string; url: string;
  price: string | null; currency: string; stockStatus: StockStatus; stockCount: number | null;
  minimumQuantity: number; raw: unknown; observedAt?: string;
};
export type ScanResult = { offers: RawOffer[]; complete: boolean; expectedCount?: number; name?: string; platform: Platform; note?: string };
export type Job = {
  id: string; source_id: string | null; source_name?: string; kind: keyof typeof jobLabels;
  state: string; message: string | null; processed: number; total: number;
  created_at: string; started_at: string | null; finished_at: string | null; finish_requested: number;
};
export type Provider = "mymemory" | "gemini" | "deepl" | "openai_compatible";
export type Settings = {
  provider: Provider; gemini_model: string; mymemory_email: string; daily_character_limit: number;
  auto_translate: boolean; translation_batch_size: number; request_interval_ms: number;
  compatible_base_url: string; compatible_model: string; translate_titles_only: boolean;
};
export type GlossaryTerm = { source: string; target: string };
export type FxSnapshot = { date: string; fetched_at: string; rates: Record<string, string> };
export type SettingsView = Settings & {
  keys: Record<Provider, boolean>; usage: number; fx: FxSnapshot | null;
  worker_online: boolean; glossary: GlossaryTerm[];
};
export type MarketData = {
  offers: Offer[]; total: number; page: number; page_size: number; sources: Source[];
  counts: { total: number; in_stock: number; translated: number; sources: number };
  fx: FxSnapshot | null; worker_online: boolean;
};
export type Directory = { id: string; name: string; url: string; strategy: string; state: string; cursor: number; total: number | null; received: number; error: string | null; checked_at: string | null; next_run_at: string | null; seller_count: number; offer_count: number };

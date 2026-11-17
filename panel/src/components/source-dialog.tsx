"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { AsyncButton, ErrorNotice, SelectField } from "@/components/workspace-ui";
import { platforms, type Platform, type Source } from "@/lib/contracts";
import { api } from "@/lib/client";

export function SourceDialog({ source, onClose, onSaved }: { source: Source | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: source?.name || "", url: source?.url || "", platform: source?.platform || "auto" as Platform,
    transport: source?.transport || "http", interval_minutes: source?.interval_minutes || 60, enabled: source ? Boolean(source.enabled) : true });
  const [error, setError] = useState("");
  const save = async () => {
    setError("");
    if (!form.url.trim()) { setError("Укажите URL"); return; }
    try { const data = { ...form, name: form.name.trim() || new URL(form.url).hostname }; await api(source ? `sources/${source.id}` : "sources", data, source ? "PATCH" : "POST"); toast.success(source ? "Источник сохранён" : "Источник добавлен"); onSaved(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "Ошибка"); }
  };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent>
    <DialogHeader><DialogTitle>{source ? "Источник" : "Добавить источник"}</DialogTitle></DialogHeader>
    <div className="grid gap-4">
      <ErrorNotice message={error} />
      <div className="grid gap-2"><Label htmlFor="source-url">URL магазина</Label><Input id="source-url" type="url" value={form.url} readOnly={Boolean(source)} placeholder="https://" onChange={e => setForm({ ...form, url: e.target.value })} /></div>
      <div className="grid gap-2"><Label htmlFor="source-name">Название</Label><Input id="source-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
      <div className="grid gap-2"><Label>Платформа</Label><SelectField label="Платформа" value={form.platform} onChange={value => setForm({ ...form, platform: value as Platform })} className="w-full" options={Object.entries(platforms).map(([value, label]) => ({ value, label }))} /></div>
      <div className="grid gap-2"><Label>Подключение</Label><SelectField label="Подключение" value={form.transport} onChange={value => setForm({ ...form, transport: value as "http" | "browser" })} className="w-full" options={[{ value: "http", label: "Прямой запрос" }, { value: "browser", label: "Сессия браузера" }]} /></div>
      <div className="grid gap-2"><Label htmlFor="source-interval">Интервал, мин.</Label><Input id="source-interval" type="number" min={5} max={10080} value={form.interval_minutes} onChange={e => setForm({ ...form, interval_minutes: Number(e.target.value) })} /></div>
      <div className="flex items-center justify-between"><Label htmlFor="source-enabled">Автообновление</Label><Switch id="source-enabled" checked={form.enabled} onCheckedChange={enabled => setForm({ ...form, enabled })} /></div>
    </div>
    <DialogFooter><Button variant="outline" onClick={onClose}>Отмена</Button><AsyncButton action={save}>{source ? "Сохранить" : "Добавить"}</AsyncButton></DialogFooter>
  </DialogContent></Dialog>;
}

"use client";
import { useState } from "react";
import { LoaderCircle, CircleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { stateLabels } from "@/lib/contracts";

export function SelectField({ value, onChange, options, label, className }: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; label: string; className?: string }) {
  return <Select items={options} value={value} onValueChange={value => { if (value !== null) onChange(value); }}>
    <SelectTrigger aria-label={label} className={className}><SelectValue /></SelectTrigger>
    <SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
  </Select>;
}
export function AsyncButton({ action, children, ...props }: Omit<React.ComponentProps<typeof Button>, "onClick"> & { action: () => Promise<unknown> }) {
  const [pending, setPending] = useState(false);
  return <Button {...props} disabled={pending || props.disabled} onClick={async () => {
    setPending(true); try { await action(); } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка"); } finally { setPending(false); }
  }}>{pending && <LoaderCircle className="animate-spin" />}{children}</Button>;
}
export function StateBadge({ state }: { state: string }) {
  return <Badge variant={["failed", "error", "challenge_required"].includes(state) ? "destructive" : ["success", "ready"].includes(state) ? "secondary" : "outline"}>
    {state === "running" && <LoaderCircle className="size-3 animate-spin" />}{stateLabels[state] || state}
  </Badge>;
}
export function ErrorNotice({ message }: { message: string }) {
  if (!message) return null;
  return <Alert variant="destructive"><CircleAlert /><AlertTitle>{message}</AlertTitle></Alert>;
}
export function WorkerNotice({ online }: { online: boolean | undefined }) {
  return online === false ? <ErrorNotice message="Фоновый процесс остановлен" /> : null;
}
export function LoadingRows() { return <div className="space-y-3">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>; }
export function PageHeading({ title, count, children }: { title: string; count?: number; children?: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{count !== undefined && <Badge variant="secondary">{count.toLocaleString("ru-RU")}</Badge>}</div><div className="flex flex-wrap items-center gap-2">{children}</div></div>;
}

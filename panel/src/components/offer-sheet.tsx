"use client";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ErrorNotice, LoadingRows, StateBadge } from "@/components/workspace-ui";
import { dateTime, money, useResource } from "@/lib/client";
import { stockLabels, type Offer, type StockStatus } from "@/lib/contracts";
type OfferDetails = Offer & { history: { price: string | null; currency: string; stock_status: StockStatus; stock_count: number | null; observed_at: string }[] };
export function OfferSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error } = useResource<OfferDetails>(`offers/${id}`);
  return <Sheet open onOpenChange={open => { if (!open) onClose(); }}><SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
    <SheetHeader><SheetTitle className="pr-6">{data?.title_ru || data?.title_original || "Товар"}</SheetTitle></SheetHeader>
    <div className="space-y-5 px-4 pb-6"><ErrorNotice message={error} />{!data ? <LoadingRows /> : <>
      <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{data.source_name}</Badge><StateBadge state={data.translation_state} /><Button variant="ghost" size="icon-sm" nativeButton={false} render={<a href={data.url} target="_blank" rel="noreferrer" />} aria-label="Открыть товар"><ExternalLink /></Button></div>
      <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-2xl font-semibold tabular-nums">{money(data.rub_price)}</div><div className="text-sm text-muted-foreground">{money(data.price, data.currency)}{data.minimum_quantity > 1 ? ` · от ${data.minimum_quantity} шт.` : ""}</div></div><Badge variant="outline">{stockLabels[data.stock_status]}{data.stock_count !== null ? ` · ${data.stock_count}` : ""}</Badge></div>
      <Tabs defaultValue={data.title_ru ? "translation" : "original"}><TabsList><TabsTrigger value="translation">Перевод</TabsTrigger><TabsTrigger value="original">Оригинал</TabsTrigger><TabsTrigger value="history">История</TabsTrigger></TabsList>
        <TabsContent value="translation" className="space-y-3 pt-3">{data.translation_error && <p className="text-sm text-muted-foreground">{data.translation_error}</p>}<p className="font-medium">{data.title_ru || "Перевод ещё не выполнен"}</p>{data.category_ru && <Badge variant="outline">{data.category_ru}</Badge>}<p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{data.description_ru}</p></TabsContent>
        <TabsContent value="original" className="space-y-3 pt-3"><p className="font-medium">{data.title_original}</p>{data.category_original && <Badge variant="outline">{data.category_original}</Badge>}<p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{data.description_original || "—"}</p></TabsContent>
        <TabsContent value="history" className="pt-3"><Table><TableHeader><TableRow><TableHead>Дата</TableHead><TableHead>Цена</TableHead><TableHead>Наличие</TableHead></TableRow></TableHeader><TableBody>{data.history.map((row, i) => <TableRow key={i}><TableCell>{dateTime(row.observed_at)}</TableCell><TableCell className="tabular-nums">{money(row.price, row.currency)}</TableCell><TableCell>{stockLabels[row.stock_status]}{row.stock_count !== null ? ` · ${row.stock_count}` : ""}</TableCell></TableRow>)}</TableBody></Table></TabsContent>
      </Tabs>
      <div className="text-xs text-muted-foreground">Проверено {dateTime(data.last_seen_at)}</div>
    </>}</div>
  </SheetContent></Sheet>;
}

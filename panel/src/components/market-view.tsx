"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ErrorNotice, PageHeading, StateBadge } from "@/components/workspace-ui";
import { OfferSheet } from "@/components/offer-sheet";
import { dateTime, money, useResource } from "@/lib/client";
import { stockLabels, type MarketData } from "@/lib/contracts";

export function MarketView({ initial }: { initial: MarketData }) {
  const [page, setPage] = useState(1), [selected, setSelected] = useState<string | null>(null);
  const { data: loaded, error } = useResource<MarketData>(`market?page=${page}`, 5000, initial);
  const data = loaded || initial;
  return <>
    <PageHeading title="Товары" count={data.total}><span className="text-sm text-muted-foreground">{data.counts.sources.toLocaleString("ru-RU")} продавцов</span></PageHeading>
    <ErrorNotice message={error} />
    {!data.offers.length ? <Empty className="border"><EmptyHeader><EmptyTitle>Загрузка каталога</EmptyTitle></EmptyHeader></Empty> : <div className="rounded-lg border"><Table><TableHeader><TableRow><TableHead>Товар</TableHead><TableHead>Продавец</TableHead><TableHead className="text-right">Цена</TableHead><TableHead>Наличие</TableHead><TableHead>Перевод</TableHead><TableHead>Дата данных</TableHead></TableRow></TableHeader><TableBody>
      {data.offers.map(offer => <TableRow key={offer.id}>
        <TableCell className="min-w-64"><Button variant="link" className="h-auto max-w-lg justify-start whitespace-normal p-0 text-left" onClick={() => setSelected(offer.id)}><span className="line-clamp-2">{offer.title_ru || offer.title_original}</span></Button>{(offer.category_ru || offer.category_original) && <div className="mt-1 max-w-md truncate text-xs text-muted-foreground">{offer.category_ru || offer.category_original}</div>}</TableCell>
        <TableCell className="max-w-48 truncate text-muted-foreground">{offer.source_name}</TableCell><TableCell className="text-right tabular-nums"><div className="font-medium">{money(offer.rub_price)}</div><div className="text-xs text-muted-foreground">{money(offer.price, offer.currency)}</div>{offer.minimum_quantity > 1 && <div className="text-xs text-muted-foreground">от {offer.minimum_quantity} шт.</div>}</TableCell>
        <TableCell><Badge variant={offer.stock_status === "in_stock" ? "secondary" : "outline"}>{stockLabels[offer.stock_status]}{offer.stock_count !== null ? ` · ${offer.stock_count}` : ""}</Badge></TableCell><TableCell><StateBadge state={offer.translation_state} /></TableCell><TableCell className="text-xs text-muted-foreground">{dateTime(offer.last_seen_at)}</TableCell>
      </TableRow>)}
    </TableBody></Table></div>}
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"><span>{data.fx ? `ЦБ · ${new Date(`${data.fx.date}T12:00:00Z`).toLocaleDateString("ru-RU")}` : "Курс загружается"}</span><div className="flex items-center gap-3"><span>{data.total ? `${(data.page - 1) * data.page_size + 1}–${Math.min(data.page * data.page_size, data.total)} из ${data.total.toLocaleString("ru-RU")}` : "0"}</span><Button variant="outline" size="icon-sm" aria-label="Предыдущая страница" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}><ChevronLeft /></Button><Button variant="outline" size="icon-sm" aria-label="Следующая страница" disabled={data.page * data.page_size >= data.total} onClick={() => setPage(data.page + 1)}><ChevronRight /></Button></div></div>
    {selected && <OfferSheet id={selected} onClose={() => setSelected(null)} />}
  </>;
}

"use client";
import { useResource } from "@/lib/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ErrorNotice, LoadingRows, PageHeading, StateBadge, WorkerNotice } from "@/components/workspace-ui";
import { dateTime } from "@/lib/client";
import { platforms, type Source } from "@/lib/contracts";
export default function SellersPage() {
  const { data, error } = useResource<{ sources: Source[]; worker_online: boolean }>("sources");
  return <><PageHeading title="Продавцы" count={data?.sources.length} /><ErrorNotice message={error} /><WorkerNotice online={data?.worker_online} />
    {!data ? <LoadingRows /> : !data.sources.length ? <Empty className="border"><EmptyHeader><EmptyTitle>Продавцы появятся после обхода каталогов</EmptyTitle></EmptyHeader></Empty> : <div className="rounded-lg border"><Table><TableHeader><TableRow><TableHead>Продавец</TableHead><TableHead>Платформа</TableHead><TableHead className="text-right">Товары</TableHead><TableHead>Последний сбор</TableHead><TableHead>Состояние</TableHead></TableRow></TableHeader><TableBody>{data.sources.map(source => <TableRow key={source.id}><TableCell><div>{source.name}</div><div className="max-w-sm truncate text-xs text-muted-foreground">{source.url}</div></TableCell><TableCell>{platforms[source.platform]}</TableCell><TableCell className="text-right tabular-nums">{source.offer_count?.toLocaleString("ru-RU")}</TableCell><TableCell className="text-muted-foreground">{dateTime(source.last_success_at)}</TableCell><TableCell><StateBadge state={source.state} />{source.error && <p className="mt-1 max-w-xs whitespace-normal text-xs text-muted-foreground">{source.error}</p>}</TableCell></TableRow>)}</TableBody></Table></div>}
  </>;
}

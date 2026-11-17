"use client";
import { useState } from "react";
import { MoreHorizontal, Plus, Pencil, Trash2, Globe } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyHeader, EmptyTitle, EmptyContent } from "@/components/ui/empty";
import { Switch } from "@/components/ui/switch";
import { AsyncButton, ErrorNotice, LoadingRows, PageHeading, StateBadge, WorkerNotice } from "@/components/workspace-ui";
import { SourceDialog } from "@/components/source-dialog";
import { api, dateTime, useResource } from "@/lib/client";
import { platforms, type Directory, type Source } from "@/lib/contracts";
export default function SourcesPage() {
  const { data, error, refresh } = useResource<{ sources: Source[]; worker_online: boolean }>("sources");
  const { data: catalogData } = useResource<{ directories: Directory[] }>("directories", 3000);
  const [editing, setEditing] = useState<Source | null | undefined>(), [deleting, setDeleting] = useState<Source | null>(null);
  const verify = async (source: Source) => { await api("verification", { source_id: source.id }); toast.success("Браузерная сессия открывается"); };
  return <><PageHeading title="Источники" count={data?.sources.length}><Button onClick={() => setEditing(null)}><Plus />Добавить</Button></PageHeading><ErrorNotice message={error} /><WorkerNotice online={data?.worker_online} />
    {catalogData?.directories.length ? <div className="rounded-lg border"><Table><TableHeader><TableRow><TableHead>Каталог</TableHead><TableHead>Способ</TableHead><TableHead className="text-right">Продавцы</TableHead><TableHead className="text-right">Товары</TableHead><TableHead>Состояние</TableHead></TableRow></TableHeader><TableBody>{catalogData.directories.map(directory => <TableRow key={directory.id}><TableCell>{directory.name}</TableCell><TableCell className="text-muted-foreground">{directory.strategy}</TableCell><TableCell className="text-right tabular-nums">{directory.seller_count.toLocaleString("ru-RU")}</TableCell><TableCell className="text-right tabular-nums">{directory.offer_count.toLocaleString("ru-RU")}</TableCell><TableCell><StateBadge state={directory.state} />{directory.error && <p className="mt-1 max-w-xs whitespace-normal text-xs text-muted-foreground">{directory.error}</p>}</TableCell></TableRow>)}</TableBody></Table></div> : null}
    {!data ? <LoadingRows /> : !data.sources.length ? <Empty className="border"><EmptyHeader><EmptyTitle>Нет источников</EmptyTitle></EmptyHeader><EmptyContent><Button onClick={() => setEditing(null)}><Plus />Добавить источник</Button></EmptyContent></Empty> :
      <div className="rounded-lg border"><Table><TableHeader><TableRow><TableHead>Источник</TableHead><TableHead>Платформа</TableHead><TableHead className="text-right">Товары</TableHead><TableHead>Последний сбор</TableHead><TableHead>Состояние</TableHead><TableHead>Авто</TableHead><TableHead><span className="sr-only">Действия</span></TableHead></TableRow></TableHeader><TableBody>{data.sources.map(source => <TableRow key={source.id}>
        <TableCell><Button variant="link" className="h-auto p-0" onClick={() => setEditing(source)}>{source.name}</Button><div className="max-w-xs truncate text-xs text-muted-foreground">{source.url}</div></TableCell><TableCell>{platforms[source.platform]}</TableCell><TableCell className="text-right tabular-nums">{source.offer_count?.toLocaleString("ru-RU")}</TableCell><TableCell className="text-muted-foreground">{dateTime(source.last_success_at)}</TableCell><TableCell><StateBadge state={source.state} />{source.error && <p className="mt-1 max-w-xs whitespace-normal text-xs text-muted-foreground">{source.error}</p>}</TableCell><TableCell><Switch aria-label={`Автообновление ${source.name}`} checked={Boolean(source.enabled)} onCheckedChange={async enabled => { try { await api(`sources/${source.id}`, { enabled }, "PATCH"); refresh(); } catch (e) { toast.error((e as Error).message); } }} /></TableCell>
        <TableCell><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Действия ${source.name}`} />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => setEditing(source)}><Pencil />Изменить</DropdownMenuItem><DropdownMenuItem onClick={() => verify(source)}><Globe />Открыть сессию</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => setDeleting(source)}><Trash2 />Удалить</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell>
      </TableRow>)}</TableBody></Table></div>}
    {editing !== undefined && <SourceDialog source={editing} onClose={() => setEditing(undefined)} onSaved={refresh} />}
    <Dialog open={Boolean(deleting)} onOpenChange={open => { if (!open) setDeleting(null); }}><DialogContent><DialogHeader><DialogTitle>Удалить {deleting?.name}?</DialogTitle><DialogDescription>Товары и история источника будут удалены.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleting(null)}>Отмена</Button><AsyncButton variant="destructive" action={async () => { await api(`sources/${deleting?.id}`, {}, "DELETE"); setDeleting(null); refresh(); }}>Удалить</AsyncButton></DialogFooter></DialogContent></Dialog>
  </>;
}

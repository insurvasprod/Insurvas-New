"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AdminPageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { ViewTabs } from "@/components/ui/view-tabs";
import { FILE_TYPE_LABELS, FILE_TYPES, type CarrierFileType } from "@/lib/ingestion/constants";
import { isKeptEntry } from "@/lib/ingestion/layout";
import type { AssignmentView, CarrierOption, LayoutMapView } from "@/lib/ingestion/layoutAdmin";
import { notify } from "@/lib/notify";

import { STATUS, call, groupLayouts, layoutHref } from "./shared";

type View = "layouts" | "carriers";

/**
 * LA-4.3 (Notion sprint) · the platform's layout maps: how each carrier's files are read. The list;
 * a layout opens on its own page (redesign 2026-10-14, owner request: "go into another page").
 * The second tab is every carrier and which layout reads each of its file types.
 */
export function LayoutList({ maps, assignments, carriers, notice }: { maps: LayoutMapView[]; assignments: AssignmentView[]; carriers: CarrierOption[]; notice?: string }) {
  const router = useRouter();
  const [view, setView] = useState<View>("layouts");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"" | CarrierFileType>("");
  const [state, setState] = useState<"" | "live" | "draft" | "none" | "deleted">("");
  const [page, setPage] = useState(1);
  const [carrierQuery, setCarrierQuery] = useState("");
  const [carrierPage, setCarrierPage] = useState(1);
  const pageSize = useFittingPageSize(420, 45);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const layouts = useMemo(() => groupLayouts(maps), [maps]);
  const usedBy = (key: string) => assignments.filter((row) => row.layoutKey === key);
  const filtered = layouts.filter((layout) => {
    const words = `${layout.name} ${layout.key} ${usedBy(layout.key).map((row) => row.carrierName).join(" ")}`.toLowerCase();
    if (query.trim() && !words.includes(query.trim().toLowerCase())) return false;
    if (type && layout.fileType !== type) return false;
    if (state === "live" && !layout.live) return false;
    if (state === "draft" && !layout.draft) return false;
    if (state === "none" && usedBy(layout.key).length > 0) return false;
    // A deleted layout (no live version, no draft) is shown only when asked for.
    const deleted = !layout.live && !layout.draft;
    if ((state === "deleted") !== deleted) return false;
    return true;
  });
  const shown = paginate(filtered, page, pageSize);

  // Every active carrier, one row each, with the layout per file type.
  const carrierRows = carriers
    .filter((carrier) => !carrierQuery.trim() || carrier.name.toLowerCase().includes(carrierQuery.trim().toLowerCase()))
    .map((carrier) => ({ carrier, byType: Object.fromEntries(FILE_TYPES.map((fileType) => [fileType, assignments.find((row) => row.carrierId === carrier.id && row.fileType === fileType) ?? null])) as Record<CarrierFileType, AssignmentView | null> }));
  const shownCarriers = paginate(carrierRows, carrierPage, pageSize);

  const figures = {
    live: layouts.filter((layout) => layout.live).length,
    drafts: layouts.filter((layout) => layout.draft).length,
    columns: layouts.reduce((sum, layout) => sum + (layout.live?.entries.length ?? 0), 0),
    noPolicies: carriers.filter((carrier) => !assignments.some((row) => row.carrierId === carrier.id && row.fileType === "policies")).length,
    noCommissions: carriers.filter((carrier) => !assignments.some((row) => row.carrierId === carrier.id && row.fileType === "commissions")).length,
  };

  async function refresh() {
    setRefreshing(true);
    router.refresh();
    setTimeout(() => setRefreshing(false), 600);
  }

  async function unassign(row: AssignmentView) {
    setBusy(row.id);
    try {
      await call(`/api/admin/layout-maps/assignments?id=${row.id}`, { method: "DELETE" });
      notify.done(`${row.carrierName}'s ${FILE_TYPE_LABELS[row.fileType].toLowerCase()} no longer have a layout.`);
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title="Layout maps" subtitle="How each carrier's files are read, column by column." actions={<Button asChild disabled={Boolean(notice)}><Link href="/admin/layout-maps/new">New layout</Link></Button>} />

      <StatStrip label="Layout map totals">
        <StatTile label="Live layouts" value={figures.live.toLocaleString("en-US")} footnote={`${layouts.length.toLocaleString("en-US")} in all`} />
        <StatTile label="Open drafts" value={figures.drafts.toLocaleString("en-US")} valueTone={figures.drafts > 0 ? "warning" : undefined} footnote="waiting to be published" />
        <StatTile label="Columns listed" value={figures.columns.toLocaleString("en-US")} footnote="across the live layouts" />
        <StatTile label="No policy layout" labelTitle="Active carriers with no layout for policy files" value={figures.noPolicies.toLocaleString("en-US")} valueTone={figures.noPolicies > 0 ? "warning" : undefined} footnote="active carriers" />
        <StatTile label="No commission layout" labelTitle="Active carriers with no layout for commission files" value={figures.noCommissions.toLocaleString("en-US")} valueTone={figures.noCommissions > 0 ? "warning" : undefined} footnote="active carriers" />
      </StatStrip>

      {notice && <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">{notice}</div>}

      <ViewTabs label="Layout map views" value={view} onChange={setView} tabs={[{ key: "layouts", label: "Layouts", count: layouts.filter((layout) => layout.live || layout.draft).length }, { key: "carriers", label: "Carriers", count: carriers.length }]} />

      {view === "layouts" ? (
        <TableCard
          toolbar={
            <DataToolbar actions={<RefreshButton onClick={() => void refresh()} refreshing={refreshing} />}>
              <ToolbarSearch value={query} onChange={(next) => { setQuery(next); setPage(1); }} placeholder="Search layouts or carriers" />
              <select aria-label="File type" className={toolbarControl} value={type} onChange={(event) => { setType(event.target.value as "" | CarrierFileType); setPage(1); }}>
                <option value="">Every file type</option>
                {FILE_TYPES.map((key) => <option key={key} value={key}>{FILE_TYPE_LABELS[key]}</option>)}
              </select>
              <select aria-label="State" className={toolbarControl} value={state} onChange={(event) => { setState(event.target.value as typeof state); setPage(1); }}>
                <option value="">Any state</option>
                <option value="live">Live</option>
                <option value="draft">With an open draft</option>
                <option value="none">Used by no carrier</option>
                <option value="deleted">Deleted</option>
              </select>
            </DataToolbar>
          }
          footer={filtered.length > 0 ? <Pager page={shown.current} pageSize={pageSize} total={filtered.length} noun="layouts" onPage={setPage} /> : undefined}
        >
          {layouts.every((layout) => !layout.live && !layout.draft) && !query.trim() && !type && !state ? (
            <EmptyState title={layouts.length ? "Every layout is deleted" : "No layout maps yet"} hint="Start one from a carrier's sample file, or type its columns one by one." action={<Button asChild><Link href="/admin/layout-maps/new">New layout</Link></Button>} />
          ) : filtered.length === 0 ? (
            <NoMatches noun="layouts" onClear={() => { setQuery(""); setType(""); setState(""); }} />
          ) : (
            <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr>
                  <th>Layout</th>
                  <th className="w-[130px]">File type</th>
                  <th className="w-[150px]">Columns</th>
                  <th className="w-[150px]">Version</th>
                  <th>Carriers</th>
                  <th className="w-[90px] text-right"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.rows.map((layout) => {
                  const current = layout.live ?? layout.draft ?? layout.versions[0];
                  const kept = current.entries.filter(isKeptEntry).length;
                  const using = usedBy(layout.key).map((row) => row.carrierName);
                  return (
                    <tr key={layout.key}>
                      <td><Link href={layoutHref(layout.key)} className="block font-semibold text-foreground hover:underline">{layout.name}</Link><span className="block font-mono text-xs text-muted-foreground">{layout.key}</span></td>
                      <td>{FILE_TYPE_LABELS[layout.fileType] ?? layout.fileType}</td>
                      <td className="tabular-nums">{current.entries.length}<span className="block text-xs text-muted-foreground">{current.entries.length - kept} used · {kept} kept</span></td>
                      <td>
                        <span className="flex flex-wrap items-center gap-1.5">
                          {layout.live && <StatusChip tone={STATUS.published.tone}>v{layout.live.version} live</StatusChip>}
                          {layout.draft && <StatusChip tone={STATUS.draft.tone}>v{layout.draft.version} draft</StatusChip>}
                          {!layout.live && !layout.draft && <StatusChip tone="neutral">Deleted</StatusChip>}
                        </span>
                      </td>
                      <td className="max-w-[280px] truncate" title={using.join(", ")}>{using.length ? using.join(", ") : <span className="text-muted-foreground">None</span>}</td>
                      <td className="text-right"><Button asChild variant="outline" size="sm"><Link href={layoutHref(layout.key)}>Open</Link></Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : (
        <TableCard
          toolbar={<DataToolbar actions={<RefreshButton onClick={() => void refresh()} refreshing={refreshing} />}><ToolbarSearch value={carrierQuery} onChange={(next) => { setCarrierQuery(next); setCarrierPage(1); }} placeholder="Search carriers" /></DataToolbar>}
          footer={carrierRows.length > 0 ? <Pager page={shownCarriers.current} pageSize={pageSize} total={carrierRows.length} noun="carriers" onPage={setCarrierPage} /> : undefined}
        >
          {carrierRows.length === 0 ? <NoMatches noun="carriers" by="search" onClear={() => setCarrierQuery("")} /> : (
            <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
              <thead><tr><th>Carrier</th>{FILE_TYPES.map((fileType) => <th key={fileType}>{FILE_TYPE_LABELS[fileType]}</th>)}</tr></thead>
              <tbody>
                {shownCarriers.rows.map(({ carrier, byType }) => (
                  <tr key={carrier.id}>
                    <td className="font-semibold text-foreground">{carrier.name}</td>
                    {FILE_TYPES.map((fileType) => {
                      const row = byType[fileType];
                      const layout = row ? layouts.find((item) => item.key === row.layoutKey) : null;
                      return (
                        <td key={fileType}>
                          {row ? (
                            <span className="flex flex-wrap items-center gap-2">
                              <Link href={layoutHref(row.layoutKey)} className="font-medium text-foreground hover:underline">{layout?.name ?? row.layoutKey}</Link>
                              {!layout?.live && <StatusChip tone="warning">No live version</StatusChip>}
                              <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => void unassign(row)}>{busy === row.id ? "Removing…" : "Remove"}</Button>
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      )}
    </div>
  );
}

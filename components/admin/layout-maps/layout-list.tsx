"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ActiveFilters, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl, type ActiveFilter } from "@/components/ui/data-toolbar";
import { patchQuery } from "@/components/admin/catalog/layout-url";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { FILE_TYPE_LABELS, FILE_TYPES, type CarrierFileType } from "@/lib/ingestion/constants";
import { isKeptEntry } from "@/lib/ingestion/layout";
import type { AssignmentView, CarrierOption, LayoutMapView } from "@/lib/ingestion/layoutAdmin";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

import { STATUS, call, carrierHref, groupLayouts, layoutHref } from "./shared";

type State = "" | "live" | "draft" | "none" | "deleted";
const STATES: readonly State[] = ["live", "draft", "none", "deleted"];
const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);

/**
 * LA-4.3 (Notion sprint) · the platform's layout maps: how each carrier's files are read, inside the Catalog frame
 * (admin round 1, catalog screen 10). The page draws the title line (Layouts | Carriers as links, New layout) and the
 * status line; this draws the tiles and the view's table. Every filter is in the URL (`q`, `type`, `state`, `cq`,
 * `missing`, `page`), and `?carrier=<code>` narrows both views to one carrier. A layout opens on its own page
 * (redesign 2026-10-14). The Carriers view is every carrier and which layout reads each of its file types.
 */
export function LayoutList({ view, maps, assignments, carriers, pending = false }: { view: "layouts" | "carriers"; maps: LayoutMapView[]; assignments: AssignmentView[]; carriers: CarrierOption[]; pending?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const pageSize = useFittingPageSize(420, 45);

  const query = params.get("q") ?? "";
  const type = pick<"" | CarrierFileType>(params.get("type"), FILE_TYPES, "");
  const state = pick<State>(params.get("state"), STATES, "");
  const page = Math.max(1, Number(params.get("page")) || 1);
  const carrierQuery = params.get("cq") ?? "";
  const missing = pick<"" | CarrierFileType>(params.get("missing"), FILE_TYPES, "");
  const carrierPage = Math.max(1, Number(params.get("cpage")) || 1);
  const carrierCode = params.get("carrier") ?? "";
  const focus = carrierCode ? carriers.find((item) => item.code.toLowerCase() === carrierCode.toLowerCase()) ?? null : null;

  const set = (patch: Record<string, string | null>) => patchQuery(patch);
  const codeOf = useMemo(() => new Map(carriers.map((item) => [item.id, item.code])), [carriers]);

  const layouts = useMemo(() => groupLayouts(maps), [maps]);
  const usedBy = (key: string) => assignments.filter((row) => row.layoutKey === key);
  const filtered = layouts.filter((layout) => {
    const using = usedBy(layout.key);
    const words = `${layout.name} ${layout.key} ${using.map((row) => row.carrierName).join(" ")}`.toLowerCase();
    if (query.trim() && !words.includes(query.trim().toLowerCase())) return false;
    if (type && layout.fileType !== type) return false;
    if (carrierCode && !using.some((row) => row.carrierId === focus?.id)) return false;
    if (state === "live" && !layout.live) return false;
    if (state === "draft" && !layout.draft) return false;
    if (state === "none" && using.length > 0) return false;
    // A deleted layout (no live version, no draft) is shown only when asked for.
    const deleted = !layout.live && !layout.draft;
    if ((state === "deleted") !== deleted) return false;
    return true;
  });
  const shown = paginate(filtered, page, pageSize);

  // Every active carrier, one row each, with the layout per file type. The carrier the page is narrowed to comes first.
  const carrierRows = carriers
    .filter((item) => !carrierQuery.trim() || `${item.name} ${item.code}`.toLowerCase().includes(carrierQuery.trim().toLowerCase()))
    .map((item) => ({ carrier: item, byType: Object.fromEntries(FILE_TYPES.map((fileType) => [fileType, assignments.find((row) => row.carrierId === item.id && row.fileType === fileType) ?? null])) as Record<CarrierFileType, AssignmentView | null> }))
    .filter((row) => !missing || !row.byType[missing])
    .sort((a, b) => Number(b.carrier.id === focus?.id) - Number(a.carrier.id === focus?.id));
  const shownCarriers = paginate(carrierRows, carrierPage, pageSize);

  const figures = {
    live: layouts.filter((layout) => layout.live).length,
    drafts: layouts.filter((layout) => layout.draft).length,
    columns: layouts.reduce((sum, layout) => sum + (layout.live?.entries.length ?? 0), 0),
    noPolicies: carriers.filter((item) => !assignments.some((row) => row.carrierId === item.id && row.fileType === "policies")).length,
    noCommissions: carriers.filter((item) => !assignments.some((row) => row.carrierId === item.id && row.fileType === "commissions")).length,
  };

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

  const refresh = <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />;
  const carrierFilter: ActiveFilter[] = carrierCode ? [{ key: "carrier", label: "Carrier", value: focus?.name ?? carrierCode, onRemove: () => set({ carrier: null, page: null, cpage: null }) }] : [];
  const carrierLink = (id: string, name: string) => {
    const code = codeOf.get(id);
    return code ? <Link href={carrierHref(code)} className="text-foreground hover:underline">{name}</Link> : <span>{name}</span>;
  };

  return (
    <>
      <StatStrip label="Layout map totals">
        <StatTile label="Live layouts" value={figures.live.toLocaleString("en-US")} footnote={`${layouts.length.toLocaleString("en-US")} in all`} href="/admin/layout-maps?state=live" />
        <StatTile label="Open drafts" value={figures.drafts.toLocaleString("en-US")} footnote="waiting to be published" href="/admin/layout-maps?state=draft" />
        <StatTile label="Columns listed" value={figures.columns.toLocaleString("en-US")} footnote="across the live layouts" />
        <StatTile label="No policy layout" labelTitle="Active carriers with no layout for policy files" value={figures.noPolicies.toLocaleString("en-US")} footnote="active carriers" href="/admin/layout-maps?view=carriers&missing=policies" />
        <StatTile label="No commission layout" labelTitle="Active carriers with no layout for commission files" value={figures.noCommissions.toLocaleString("en-US")} footnote="active carriers" href="/admin/layout-maps?view=carriers&missing=commissions" />
      </StatStrip>

      {view === "layouts" ? (
        <TableCard
          className="min-w-0"
          toolbar={
            <DataToolbar actions={refresh}>
              <ToolbarSearch value={query} onChange={(next) => set({ q: next || null, page: null })} placeholder="Search layouts or carriers" />
              <select aria-label="File type" className={toolbarControl} value={type} onChange={(event) => set({ type: event.target.value || null, page: null })}>
                <option value="">Every file type</option>
                {FILE_TYPES.map((key) => <option key={key} value={key}>{FILE_TYPE_LABELS[key]}</option>)}
              </select>
              <select aria-label="State" className={toolbarControl} value={state} onChange={(event) => set({ state: event.target.value || null, page: null })}>
                <option value="">Any state</option>
                <option value="live">Live</option>
                <option value="draft">With an open draft</option>
                <option value="none">Used by no carrier</option>
                <option value="deleted">Deleted</option>
              </select>
              <ActiveFilters inline filters={carrierFilter} onClear={() => set({ carrier: null, q: null, type: null, state: null, page: null })} />
            </DataToolbar>
          }
          footer={filtered.length > 0 ? <Pager page={shown.current} pageSize={pageSize} total={filtered.length} noun="layouts" onPage={(next) => set({ page: next > 1 ? String(next) : null })} /> : undefined}
        >
          {layouts.every((layout) => !layout.live && !layout.draft) && !query.trim() && !type && !state && !carrierCode ? (
            <EmptyState
              title={pending ? "Layout maps are not set up yet" : layouts.length ? "Every layout is deleted" : "No layout maps yet"}
              hint={pending ? "The database update in the status line comes first." : "Start one from a carrier's sample file, or type its columns one by one."}
              action={pending ? undefined : <Button asChild><Link href="/admin/layout-maps/new">New layout</Link></Button>}
            />
          ) : filtered.length === 0 ? (
            <NoMatches noun="layouts" onClear={() => set({ q: null, type: null, state: null, carrier: null, page: null })} />
          ) : (
            <table className="portal-lead-table w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr>
                  <th>Layout</th>
                  <th className="w-[130px]">File type</th>
                  <th className="w-[100px] text-right">Columns</th>
                  <th className="w-[130px]">Version</th>
                  <th className="min-w-[160px]">Carriers</th>
                  <th className="w-[110px]">State</th>
                  <th className="w-[80px] text-right"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.rows.map((layout) => {
                  const current = layout.live ?? layout.draft ?? layout.versions[0];
                  const kept = current.entries.filter(isKeptEntry).length;
                  const using = usedBy(layout.key);
                  const chip = layout.live ? { tone: STATUS.published.tone, label: "Live" } : layout.draft ? { tone: STATUS.draft.tone, label: "Draft" } : { tone: "neutral" as const, label: "Deleted" };
                  return (
                    <tr key={layout.key}>
                      <td className="max-w-[320px] truncate" title={layout.key}><Link href={layoutHref(layout.key)} className="font-semibold text-foreground hover:underline">{layout.name}</Link></td>
                      <td>{FILE_TYPE_LABELS[layout.fileType] ?? layout.fileType}</td>
                      <td className="text-right tabular-nums" title={`${current.entries.length - kept} used · ${kept} kept as information`}>{current.entries.length}</td>
                      <td className="whitespace-nowrap tabular-nums">
                        {layout.live ? `v${layout.live.version}` : layout.draft ? `v${layout.draft.version}` : `v${layout.versions[0].version}`}
                        {layout.live && layout.draft && <span className="text-muted-foreground"> · v{layout.draft.version} draft</span>}
                      </td>
                      <td className="max-w-[280px] truncate" title={using.map((row) => row.carrierName).join(", ")}>
                        {using.length === 0 ? <span className="text-muted-foreground">None</span> : (
                          <>
                            {using.slice(0, 2).map((row, index) => <span key={row.id}>{index > 0 && ", "}{carrierLink(row.carrierId, row.carrierName)}</span>)}
                            {using.length > 2 && <span className="text-muted-foreground"> +{using.length - 2}</span>}
                          </>
                        )}
                      </td>
                      <td><StatusChip tone={chip.tone}>{chip.label}</StatusChip></td>
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
          className="min-w-0"
          toolbar={
            <DataToolbar actions={refresh}>
              <ToolbarSearch value={carrierQuery} onChange={(next) => set({ cq: next || null, cpage: null })} placeholder="Search carriers" />
              <select aria-label="Missing a layout for" className={toolbarControl} value={missing} onChange={(event) => set({ missing: event.target.value || null, cpage: null })}>
                <option value="">Any carrier</option>
                {FILE_TYPES.map((key) => <option key={key} value={key}>No {FILE_TYPE_LABELS[key].toLowerCase()} layout</option>)}
              </select>
              <ActiveFilters inline filters={carrierFilter} onClear={() => set({ carrier: null, cq: null, missing: null, cpage: null })} />
            </DataToolbar>
          }
          footer={carrierRows.length > 0 ? <Pager page={shownCarriers.current} pageSize={pageSize} total={carrierRows.length} noun="carriers" onPage={(next) => set({ cpage: next > 1 ? String(next) : null })} /> : undefined}
        >
          {carriers.length === 0 ? (
            <EmptyState title="No active carriers" hint="Carriers are added in Catalog › Carriers." />
          ) : carrierRows.length === 0 ? <NoMatches noun="carriers" onClear={() => set({ cq: null, missing: null, cpage: null })} /> : (
            <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
              <thead><tr><th>Carrier</th>{FILE_TYPES.map((fileType) => <th key={fileType}>{FILE_TYPE_LABELS[fileType]}</th>)}</tr></thead>
              <tbody>
                {shownCarriers.rows.map(({ carrier, byType }) => (
                  <tr key={carrier.id} className={cn(carrier.id === focus?.id && "bg-[var(--primary-soft)]")} aria-current={carrier.id === focus?.id ? "true" : undefined}>
                    <td className="font-semibold"><Link href={carrierHref(carrier.code)} className="text-foreground hover:underline">{carrier.name}</Link></td>
                    {FILE_TYPES.map((fileType) => {
                      const row = byType[fileType];
                      const layout = row ? layouts.find((item) => item.key === row.layoutKey) : null;
                      return (
                        <td key={fileType} className="whitespace-nowrap">
                          {row ? (
                            <span className="inline-flex items-center gap-2">
                              <Link href={layoutHref(row.layoutKey)} className="max-w-[220px] truncate font-medium text-foreground hover:underline" title={layout?.name ?? row.layoutKey}>{layout?.name ?? row.layoutKey}</Link>
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
    </>
  );
}

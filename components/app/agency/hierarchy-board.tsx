"use client";

import { useCallback, useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { Card } from "@/components/ui/card";
import { BarSeries, ChartHeading, LineSeries } from "@/components/ui/chart";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { ActiveFilters, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl, type ActiveFilter } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, NoMatches } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { MoreMenu } from "@/components/ui/more-menu";
import { ViewTabs } from "@/components/ui/view-tabs";
import { useShow } from "@/components/ui/view-switch";
import { ReportsSlot } from "@/components/app/reports/reports-slot";
import { bpsToPercent, dollars } from "@/lib/agency/constants";
import { showHref } from "@/lib/reports/show";
import {
  HIERARCHY_PATH, HIERARCHY_TABS, buildTree, filterRows, hierarchyCsv, inTab, isMissing, isNegative, monthOf, rowState, tabParam,
  type HierarchyMonth, type HierarchyRow, type HierarchyTab, type TreeNode,
} from "@/lib/agency/hierarchyView";
import { HierarchyTree } from "./hierarchy-tree";
import { ChangeManagerDialog } from "./hierarchy-manager-dialog";

/** One month of the six-month line and the cards' small charts (OverrideMonthPoint, lib/agency/overrideStore.ts). */
export type HierarchyTrendPoint = HierarchyMonth & { overrideCents: number; missing: number; negative: number; producers: number };

const n = (value: number) => value.toLocaleString("en-US");
const LINK = "whitespace-nowrap text-sm text-foreground underline-offset-2 hover:underline";
const RATE_CARD = "/app/rate-card";

/**
 * AG-1.2 · Reports › Hierarchy & overrides, round 7 (owner pick 6 · "B and C together", 2026-11-11;
 * docs/la4/mockups-r7/reports.html §6). The server page reads the month (`?month=`) and hands in its rows and the six
 * months ending with it; this board draws both views of the "Table · Chart" switch (`?show=`, chart first):
 *
 * - Chart: the four cards, each with the same figure's six months as a small line; then 6·3 B, who reports to whom
 *   with each producer's override on his box; then 6·3 C, the override over six months (a line, or bars when a month
 *   went below zero). Every box, point and card opens the table view filtered to the rows behind it.
 * - Table (6·1): one line a row, six columns, one chip; the row opens the level page.
 *
 * The tabs (All · Missing levels · Negative spreads, `?tab=`) and the filters a chart's link sets (`?producer=`,
 * `?manager=`, `?carrier=`, `?q=`) are in the address and shared by both views. The override is COMPUTED (agency level
 * minus the producer's, on what the statements said); nobody types one. Change a manager is on the title line's More.
 */
export function HierarchyBoard({ rows, trend, month, currentMonth, months, canChangeManager, readOnly, canEdit, error = null }: {
  rows: HierarchyRow[];
  trend: HierarchyTrendPoint[];
  month: string;
  currentMonth: string;
  months: HierarchyMonth[];
  /** The owner: Change a manager is on More (disabled while the account is read-only). */
  canChangeManager: boolean;
  readOnly: boolean;
  /** The owner on a writable account: rows carry their next step ("Set level ›"). */
  canEdit: boolean;
  error?: string | null;
}) {
  const router = useRouter();
  const query = useSearchParams();
  const show = useShow("chart");
  const [refreshing, startRefresh] = useTransition();
  const [, startMonth] = useTransition();
  const [moving, setMoving] = useState(false);

  const tab = tabParam(query.get("tab"));
  const filters = { producer: query.get("producer") ?? "", manager: query.get("manager") ?? "", carrier: query.get("carrier") ?? "", q: query.get("q") ?? "" };
  // The tab and the filters change the address in place (no server round trip): Next follows replaceState.
  const setParams = useCallback((next: Record<string, string | null>) => {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(next)) {
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    }
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const base = month === currentMonth ? HIERARCHY_PATH : `${HIERARCHY_PATH}?month=${month}`;
  const monthLong = monthOf(month).long;
  const carriers = useMemo(() => [...new Map(rows.map((r) => [r.carrierId, r.carrierName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const people = useMemo(() => [...new Map(rows.map((r) => [r.producerId, { id: r.producerId, name: r.producerName, managerId: r.managerProducerId }])).values()], [rows]);
  const kept = useMemo(() => filterRows(rows, filters), [rows, filters.producer, filters.manager, filters.carrier, filters.q]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => kept.filter((r) => inTab(r, tab)), [kept, tab]);
  const counts = { all: kept.length, missing: kept.filter(isMissing).length, negative: kept.filter(isNegative).length };
  const producerCount = new Set(shown.map((r) => r.producerId)).size;
  const carrierCount = new Set(shown.map((r) => r.carrierId)).size;

  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "A producer";
  const active: ActiveFilter[] = [
    filters.producer && { key: "producer", label: "Producer", value: nameOf(filters.producer), onRemove: () => setParams({ producer: null }) },
    filters.manager && { key: "manager", label: "Reports to", value: filters.manager === "owner" ? "Owner" : nameOf(filters.manager), onRemove: () => setParams({ manager: null }) },
  ].filter(Boolean) as ActiveFilter[];
  const clear = () => setParams({ producer: null, manager: null, carrier: null, q: null });

  const download = () => {
    const csv = hierarchyCsv(shown, bpsToPercent, dollars);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `hierarchy-and-overrides-${month}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const top = (
    <>
      <ReportsSlot slot="lead">
        <ViewTabs
          label="Rows"
          value={tab}
          onChange={(key: HierarchyTab) => setParams({ tab: key === "all" ? null : key })}
          tabs={HIERARCHY_TABS.map((t) => ({ ...t, count: rows.length ? counts[t.key] : null, tone: t.key === "all" ? undefined : ("danger" as const) }))}
        />
      </ReportsSlot>
      <ReportsSlot slot="corner">
        <select
          aria-label="Month"
          className={toolbarControl}
          value={month}
          onChange={(e) => {
            const url = new URL(window.location.href);
            if (e.target.value === currentMonth) url.searchParams.delete("month"); else url.searchParams.set("month", e.target.value);
            startMonth(() => router.replace(`${url.pathname}${url.search}`, { scroll: false }));
          }}
        >
          {months.map((m) => <option key={m.key} value={m.key}>{m.long}</option>)}
        </select>
        <MoreMenu items={[
          canChangeManager && people.length > 0 && { label: readOnly ? "Change a manager (paused while the account is read-only)" : "Change a manager", disabled: readOnly, onSelect: () => setMoving(true) },
          shown.length > 0 && { label: "Download CSV", onSelect: download },
        ]} />
      </ReportsSlot>
      {moving && <ChangeManagerDialog people={people} open onOpenChange={setMoving} onDone={() => router.refresh()} />}
    </>
  );

  const toolbar = (
    <DataToolbar actions={<>
      <span className="text-sm text-muted-foreground">{n(producerCount)} producer{producerCount === 1 ? "" : "s"} · {n(carrierCount)} carrier{carrierCount === 1 ? "" : "s"} · reported basis</span>
      <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
    </>}>
      <ToolbarSearch value={filters.q} onChange={(v) => setParams({ q: v })} placeholder="Producer or carrier" label="Search" />
      <select aria-label="Carrier" className={toolbarControl} value={filters.carrier} onChange={(e) => setParams({ carrier: e.target.value || null })}>
        <option value="">All carriers</option>
        {carriers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
      <ActiveFilters inline filters={active} onClear={clear} />
    </DataToolbar>
  );

  if (error) return <>{top}<Card><ErrorState detail={error} /></Card></>;
  if (rows.length === 0) {
    return (
      <>
        {top}
        <Card>
          <EmptyState title="Nothing to show yet" hint="Add your carrier contracts on the rate card and your producers' levels on each producer's Carriers tab." action={<Button asChild variant="outline"><Link href={RATE_CARD}>Open the rate card</Link></Button>} />
        </Card>
      </>
    );
  }

  return (
    <>
      {top}
      {show === "chart"
        ? <ChartView rows={shown} trend={trend} base={base} monthLong={monthLong} toolbar={toolbar} onClear={clear} filtered={Boolean(active.length || filters.carrier || filters.q || tab !== "all")} carriers={carriers.length} />
        : <TableView rows={shown} toolbar={toolbar} canEdit={canEdit} onClear={() => { clear(); setParams({ tab: null }); }} onManager={(id) => setParams({ manager: id ?? "owner", producer: null })} />}
    </>
  );
}

/* ── Chart view: the cards, 6·3 B (the tree) over 6·3 C (six months) ─────────────────────────────────── */

function ChartCard({ title, period, link, children }: { title: string; period: string; link: { label: string; href: string }; children: ReactNode }) {
  return (
    <Card className="px-4">
      <ChartHeading title={title} period={period} action={<Link href={link.href} className={LINK}>{link.label} ›</Link>} />
      {children}
    </Card>
  );
}

function ChartView({ rows, trend, base, monthLong, toolbar, onClear, filtered, carriers }: {
  rows: HierarchyRow[]; trend: HierarchyTrendPoint[]; base: string; monthLong: string; toolbar: ReactNode; onClear: () => void; filtered: boolean; carriers: number;
}) {
  const now = trend[trend.length - 1];
  const first = trend[0];
  const tree = useMemo(() => buildTree(rows), [rows]);
  const span = `${first.label}${first.key.slice(0, 4) !== now.key.slice(0, 4) ? ` ${first.key.slice(0, 4)}` : ""} – ${now.label} ${now.key.slice(0, 4)}`;
  const sixMonths = trend.reduce((sum, t) => sum + t.overrideCents, 0);
  const anyBelow = trend.some((t) => t.overrideCents < 0);
  const allZero = trend.every((t) => t.overrideCents === 0);
  const monthHref = (key: string) => showHref(`${HIERARCHY_PATH}?month=${key}`, "table");
  const usd = (value: number) => dollars(Math.round(value * 100));
  const line = (pick: (t: HierarchyTrendPoint) => number) => trend.map(pick);
  const nodeHref = (node: TreeNode) => showHref(base, "table", { producer: node.id });

  return (
    <div className="grid gap-4">
      <StatStrip label="Overrides">
        <StatTile
          label={`Override · ${now.label} · reported`}
          value={dollars(now.overrideCents)}
          href={showHref(base, "table")}
          trend={{ points: line((t) => t.overrideCents / 100), tone: "primary", placement: "under" }}
          footnote={now.overrideCents < 0 ? <StatusChip tone="danger">Paying out more than received</StatusChip> : undefined}
          reserveFootnote
        />
        <StatTile
          label="Missing levels"
          value={n(now.missing)}
          href={showHref(base, "table", { tab: "missing" })}
          trend={{ points: line((t) => t.missing), tone: "primary", placement: "under" }}
          footnote={now.missing ? <StatusChip tone="warning">No override until each is set</StatusChip> : undefined}
          reserveFootnote
        />
        <StatTile
          label="Negative spreads"
          value={n(now.negative)}
          href={showHref(base, "table", { tab: "negative" })}
          trend={{ points: line((t) => t.negative), tone: "primary", placement: "under" }}
          footnote={now.negative ? <StatusChip tone="danger">Paying out more than received</StatusChip> : undefined}
          reserveFootnote
        />
        <StatTile
          label="Producers"
          value={n(now.producers)}
          href={showHref(base, "table")}
          trend={{ points: line((t) => t.producers), tone: "primary", placement: "under" }}
          footnote={`${n(carriers)} carrier${carriers === 1 ? "" : "s"}`}
          reserveFootnote
        />
      </StatStrip>

      <Card className="px-4 py-3">{toolbar}</Card>

      <ChartCard title="Who reports to whom" period={`${monthLong} · the override on each producer, reported`} link={{ label: "Open the rows", href: showHref(base, "table") }}>
        {rows.length === 0
          ? <NoMatches noun="producers" onClear={onClear} />
          : <HierarchyTree roots={tree.roots} ownerLabel="Owner" ownerCents={tree.overrideCents} ownerHref={showHref(base, "table", { manager: "owner" })} hrefFor={nodeHref} />}
      </ChartCard>

      <ChartCard title={`Override over six months · ${dollars(sixMonths)}`} period={`${span} · reported${filtered ? " · every producer you see, whatever the filters" : ""}`} link={{ label: "Open the month", href: showHref(base, "table") }}>
        {anyBelow ? (
          <BarSeries
            bars={trend.map((t) => ({ key: t.key, label: t.label, value: t.overrideCents / 100 }))}
            summary={`Override by month, ${span}`}
            format={usd}
            labels="all"
            names={{ value: "Override" }}
            hrefFor={(bar) => monthHref(bar.key)}
          />
        ) : (
          <LineSeries
            points={trend.map((t) => ({ key: t.key, label: t.label, value: t.overrideCents / 100 }))}
            summary={`Override by month, ${span}`}
            format={usd}
            labels="all"
            legend={{ label: "Override, reported", figure: dollars(sixMonths), href: showHref(base, "table") }}
            hrefFor={(point) => monthHref(point.key)}
          />
        )}
        {allZero && <p className="m-0 mt-2 text-xs text-muted-foreground">No statement line carried an override in these six months, so the line lies at $0.00.</p>}
      </ChartCard>
    </div>
  );
}

/* ── Table view (6·1): six columns, one line, one chip ───────────────────────────────────────────────── */

function TableView({ rows, toolbar, canEdit, onClear, onManager }: { rows: HierarchyRow[]; toolbar: ReactNode; canEdit: boolean; onClear: () => void; onManager: (managerId: string | null) => void }) {
  const router = useRouter();
  return (
    <PagedTableCard
      toolbar={toolbar}
      total={rows.length}
      noun="rows"
      footer={rows.length ? <span className="text-sm text-muted-foreground">Override = agency level − producer level, on what the carriers&apos; statements said</span> : undefined}
    >
      {rows.length === 0 ? <NoMatches noun="rows" onClear={onClear} /> : (
        <table className="portal-lead-table w-full text-left text-sm">
          <thead>
            <tr>
              <th>Producer</th>
              <th>Reports to</th>
              <th>Carrier</th>
              <th className="text-right">Spread</th>
              <th className="text-right">Override</th>
              <th>Level</th>
            </tr>
          </thead>
          <PagedBody>
            {rows.map((r) => {
              const href = `/app/producers/${r.producerId}/carrier/${r.carrierId}`;
              const state = rowState(r);
              return (
                <tr key={`${r.producerId}-${r.carrierId}`} className="cursor-pointer" onClick={() => router.push(href)}>
                  <td className="whitespace-nowrap font-medium text-foreground"><Link href={`/app/producers/${r.producerId}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{r.producerName}</Link></td>
                  <td className="whitespace-nowrap">
                    <button type="button" className="hover:underline" onClick={(e) => { e.stopPropagation(); onManager(r.managerProducerId); }}>{r.managerName}</button>
                  </td>
                  <td className="whitespace-nowrap">{r.carrierName}</td>
                  <td className="whitespace-nowrap text-right tabular-nums" title={`Agency ${bpsToPercent(r.agencyLevelBps)} · producer ${bpsToPercent(r.producerLevelBps)}`}>
                    {r.spreadBps === null ? <span className="text-muted-foreground">—</span> : bpsToPercent(r.spreadBps)}
                  </td>
                  <td className="whitespace-nowrap text-right tabular-nums">{r.overrideCents === null ? <span className="text-muted-foreground">—</span> : dollars(r.overrideCents)}</td>
                  <td className="whitespace-nowrap">
                    <StatusChip tone={state.tone}>{state.text}</StatusChip>
                    {canEdit && state.next && <Link href={href} className="ml-2 hover:underline" onClick={(e) => e.stopPropagation()}>{state.next} ›</Link>}
                  </td>
                </tr>
              );
            })}
          </PagedBody>
        </table>
      )}
    </PagedTableCard>
  );
}

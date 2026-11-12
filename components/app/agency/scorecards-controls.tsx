"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ActiveFilters, RefreshButton } from "@/components/ui/data-toolbar";
import { PeriodPicker, type Period } from "@/components/app/reports/period-picker";
import { downloadCsv } from "@/components/app/partner-quality-parts";

/**
 * Producer scorecards' client islands (Reports round 7): the shared period, which re-reads the server page with
 * `?from&to` (every other parameter, the Table · Chart choice and a filter included, stays), Export CSV of the
 * rows the server handed in, and Refresh. Everything else on the page is drawn on the server.
 */
export function ScorecardsPeriod({ value }: { value: Period }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const change = (next: Period) => {
    const url = new URL(window.location.href);
    url.searchParams.set("from", next.from);
    url.searchParams.set("to", next.to);
    start(() => router.push(`${url.pathname}${url.search}${url.hash}`));
  };
  return <span aria-busy={pending || undefined} className={pending ? "opacity-70" : undefined}><PeriodPicker value={value} onChange={change} /></span>;
}

export function ScorecardsCsv({ name, header, rows }: { name: string; header: string[]; rows: Array<Array<string | number | null>> }) {
  if (!rows.length) return null;
  return <Button type="button" variant="outline" onClick={() => downloadCsv(name, header, rows)}>Export CSV</Button>;
}

export function ScorecardsRefresh() {
  const router = useRouter();
  const [refreshing, start] = useTransition();
  return <RefreshButton onClick={() => start(() => router.refresh())} refreshing={refreshing} />;
}

/** The table's one filter (`?has=`, from a legend row or a card), with its ✕ back to every producer. */
export function ScorecardsFilter({ value }: { value: string | null }) {
  const router = useRouter();
  const [, start] = useTransition();
  if (!value) return null;
  const clear = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("has");
    start(() => router.push(`${url.pathname}${url.search}${url.hash}`));
  };
  return <ActiveFilters filters={[{ key: "has", label: "Showing", value, onRemove: clear }]} onClear={clear} />;
}

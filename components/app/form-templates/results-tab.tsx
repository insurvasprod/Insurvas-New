"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { TableCard } from "@/components/ui/table-card";
import { SectionLoading } from "@/components/ui/page-states";
import { st } from "@/components/app/settings/primitives";
import { FormStatusLine, NeedsUpdate } from "@/components/app/form-templates/status-line";

type Results = {
  days: number;
  sent: number;
  started: number;
  finishedPct: number | null;
  previousPct: number | null;
  stops: Array<{ field_key: string; label: string; page: number; reached: number; stopped: number }>;
  bySource: Array<{ source: string; sent: number }>;
  fromEvents: boolean;
  opened: number | null;
};

const n = (value: number) => value.toLocaleString("en-US");

/**
 * The Results tab (board A10): starts, sends and where people stop, by question and by source. Today
 * it counts what is real: every lead the form made, and every form started but not sent (its last
 * answer is where it stopped). Opened and time to finish come with the events of 20261112200000.
 */
export function ResultsTab({ copyId, version, days }: { copyId: string; version: number; days: 7 | 30 | 90 }) {
  const [results, setResults] = useState<Results | null>(null);
  const [failed, setFailed] = useState("");

  const load = useCallback(async () => {
    setFailed("");
    setResults(null);
    const response = await fetch(`/api/app/templates/${copyId}/results?days=${days}`, { cache: "no-store" }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    if (!response?.ok) { setFailed(body?.error ?? "The results didn’t load."); return; }
    setResults(body.results as Results);
  }, [copyId, days]);
  // External state into the tab.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  if (failed) return <FormStatusLine tone="danger" action={<Button type="button" variant="ghost" size="sm" onClick={() => void load()}>Try again</Button>}>{failed}</FormStatusLine>;
  if (!results) return <SectionLoading rows={6} columns={4} label="Counting this form’s results" />;
  const most = results.stops.reduce((top, row) => (row.stopped > (top?.stopped ?? 0) ? row : top), null as Results["stops"][number] | null);
  const rise = results.finishedPct !== null && results.previousPct !== null ? results.finishedPct - results.previousPct : null;
  const top = Math.max(1, ...results.stops.map((row) => row.reached));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <FormStatusLine tone="neutral" action={results.fromEvents ? undefined : <NeedsUpdate />}>
        Last {results.days} days · version {version} · counted from partner and agent forms{results.fromEvents ? "" : ". Opened and time to finish come with the next database update"}
      </FormStatusLine>
      <StatRow>
        <StatCard label="Opened" value={results.opened === null ? "—" : n(results.opened)} period={results.opened === null ? "needs a database update" : `${results.days} days`} />
        <StatCard label="Started" value={n(results.started)} period={`${results.days} days`} />
        <StatCard label="Sent" value={n(results.sent)} period={`${results.days} days`} />
        <StatCard label="Finished" value={results.finishedPct === null ? "—" : `${results.finishedPct}%`} period="of those who started" delta={rise !== null && rise !== 0 ? { value: rise, unit: " pts", goodWhen: "up" } : undefined} />
      </StatRow>
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <TableCard title="Where people stop" description={`Of ${n(results.started)} who started`} className="min-h-0 min-w-0 flex-1">
          <div className="min-h-0 overflow-y-auto">
            <table className={st.table}>
              <thead className={st.headRow}><tr><th className={st.th}>Question</th><th className={st.th}>Page</th><th className={`${st.th} text-right`}>Reached</th><th className={`${st.th} text-right`}>Stopped here</th><th className={st.th}><span className="sr-only">Share reached</span></th></tr></thead>
              <tbody>
                {results.stops.map((row) => {
                  const pct = results.started ? Math.round((row.stopped / results.started) * 100) : 0;
                  const worst = most?.field_key === row.field_key && row.stopped > 0;
                  return (
                    <tr key={row.field_key}>
                      <td className={st.td}><span className="block max-w-[280px] truncate">{row.label}</span></td>
                      <td className={st.td}>{row.page}</td>
                      <td className={`${st.td} ${st.num}`}>{n(row.reached)}</td>
                      <td className={`${st.td} ${st.num}`}>{worst ? <StatusChip tone="warning">{pct}% · most</StatusChip> : `${pct}%`}</td>
                      <td className={`${st.td} w-[140px]`}><span className="block h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]"><span className={`block h-full rounded-full ${worst ? "bg-[var(--warning)]" : "bg-[var(--primary)]"}`} style={{ width: `${Math.round((row.reached / top) * 100)}%` }} /></span></td>
                    </tr>
                  );
                })}
                {results.stops.length === 0 && <tr><td className={st.td} colSpan={5}>This form has no questions yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </TableCard>
        <TableCard title="By source" className="shrink-0 lg:w-[340px]">
          <table className={st.table}>
            <thead className={st.headRow}><tr><th className={st.th}>Source</th><th className={`${st.th} text-right`}>Sent</th></tr></thead>
            <tbody>
              {results.bySource.map((row) => <tr key={row.source}><td className={st.td}>{row.source}</td><td className={`${st.td} ${st.num}`}>{n(row.sent)}</td></tr>)}
            </tbody>
          </table>
        </TableCard>
      </div>
    </div>
  );
}

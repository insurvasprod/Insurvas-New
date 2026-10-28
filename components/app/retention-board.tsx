"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ClearFiltersButton, DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { fileDay } from "@/lib/ingestion/constants";
import { GROUP_LABELS, OUTCOME_LABELS, OUTCOMES, REASON_LABELS, REASONS, urgency, type Group } from "@/lib/ingestion/retentionBoard";
import type { BoardEntry } from "@/lib/ingestion/retentionStore";
import { notify } from "@/lib/notify";

const money = (cents: number | null) => {
  if (cents === null) return null;
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return `$${Number(digits.slice(0, -2)).toLocaleString("en-US")}.${digits.slice(-2)}`;
};
const phoneText = (raw: string) => {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
};
const RESULT_WORD: Record<string, string> = { saved: "saved", lost: "lost", still_at_risk: "still at risk" };
const URGENCY_CLASS = { red: "text-[var(--error-ink)]", amber: "text-[var(--warning-ink)]", plain: "text-foreground" } as const;

type Rate = { label: string; saved: number; lost: number; open: number; rate: number | null };

/**
 * LA-4.16 (Notion sprint) · the call list. Soonest deadline first, then the most money; the phone
 * number on the row; one click to log what happened. Nothing here is a prediction: every reason
 * and every countdown is read from the carrier's files and rules.
 */
export function RetentionBoard({ rows, rates, readOnly }: { rows: BoardEntry[]; rates: { calls: number; byReason: Rate[]; byCarrier: Rate[]; byAgent: Rate[] } | null; readOnly: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [reason, setReason] = useState("");
  const [carrier, setCarrier] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const carriers = useMemo(() => [...new Map(rows.map((r) => [r.carrierId, r.carrierName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const visible = useMemo(() => rows.filter((r) => (!reason || r.reason === reason) && (!carrier || r.carrierId === carrier)), [rows, reason, carrier]);
  const shown = paginate(visible, page, 10);
  const today = rows.filter((r) => r.daysLeft !== null && r.daysLeft <= 3).length;
  const atRisk = rows.reduce((sum, r) => sum + (r.atRiskCents ?? 0), 0);
  const unknownRisk = rows.filter((r) => r.atRiskCents === null && r.group !== "prevention").length;
  const knownRisk = rows.some((r) => r.atRiskCents !== null);
  const noWindow = rows.filter((r) => r.group === "no_window").length;
  const overall = rates ? rates.byReason.reduce((acc, r) => ({ saved: acc.saved + r.saved, lost: acc.lost + r.lost }), { saved: 0, lost: 0 }) : null;

  async function log(row: BoardEntry, outcome: string) {
    setBusy(row.key);
    try {
      const response = await fetch("/api/app/retention", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "log_outcome", carrier_id: row.carrierId, policy_number: row.policyNumber, outcome, note: null }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "The call could not be logged.");
      notify.done("Logged. The next carrier file will show whether it was saved.");
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "The call could not be logged.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {rows.length > 0 && (
        <StatStrip label="Retention">
          <StatTile label="Call today" value={today.toLocaleString("en-US")} valueTone={today ? "danger" : undefined} footnote="3 days or fewer left, or past the window" />
          <StatTile label="Advance at risk" value={knownRisk ? money(atRisk) : "Unknown"} footnote={!knownRisk ? "no advance from these carriers is on file yet" : unknownRisk ? `${unknownRisk} more with no advance on file yet` : "unearned, on the policies listed"} />
          <StatTile label="Save rate" value={overall && overall.saved + overall.lost ? `${Math.floor((overall.saved * 100) / (overall.saved + overall.lost))}%` : "—"} footnote={overall && overall.saved + overall.lost ? `${overall.saved} saved of ${overall.saved + overall.lost} decided by the files` : rates && rates.calls ? `${rates.calls} logged ${rates.calls === 1 ? "call is" : "calls are"} waiting for the next carrier file` : "after your first logged calls"} />
          <StatTile label="No carrier window" value={noWindow.toLocaleString("en-US")} valueTone={noWindow ? "warning" : undefined} footnote={noWindow ? "set it in Carrier rules" : "every listed carrier has one"} />
        </StatStrip>
      )}

      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {(reason || carrier) && <ClearFiltersButton onClick={() => { setReason(""); setCarrier(""); setPage(1); }} />}
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>}>
            <select aria-label="Filter by reason" className={toolbarControl} value={reason} onChange={(e) => { setReason(e.target.value); setPage(1); }}>
              <option value="">Every reason</option>
              {REASONS.map((r) => <option key={r} value={r}>{REASON_LABELS[r]}</option>)}
            </select>
            {carriers.length > 1 && (
              <select aria-label="Filter by carrier" className={toolbarControl} value={carrier} onChange={(e) => { setCarrier(e.target.value); setPage(1); }}>
                <option value="">All carriers</option>
                {carriers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            )}
            <span className="text-sm text-muted-foreground">Soonest deadline first, then the most money</span>
          </DataToolbar>
        }
        footer={visible.length > 10 ? <Pager page={shown.current} pageSize={10} total={visible.length} noun="policies" onPage={setPage} /> : undefined}
      >
        {rows.length === 0 ? (
          <EmptyState title="Nobody to call" hint="Policies appear here when a carrier file shows a missed or bounced draft, a conservation notice, a request to cancel, a recent lapse that can still be reinstated, or a mailed bill worth converting." />
        ) : visible.length === 0 ? (
          <NoMatches noun="policies" onClear={() => { setReason(""); setCarrier(""); setPage(1); }} />
        ) : (
          <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
            <thead>
              <tr>
                <th>Client</th>
                <th className="w-[190px]">Why</th>
                <th className="w-[100px] text-right">Due</th>
                <th className="w-[100px] text-right">Days left</th>
                <th className="w-[130px] text-right" title="Unearned advance the carrier takes back if this policy dies (from the commission ledger)">Advance at risk</th>
                <th className="w-[170px]">Last contact</th>
                <th className="w-[190px] text-right"><span className="sr-only">Log the call</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.rows.flatMap((row, index) => {
                const out = [];
                // A group heading before the first row of each group (the rows arrive grouped).
                if (index === 0 || shown.rows[index - 1].group !== row.group) {
                  if (row.group !== "deadline") {
                    out.push(<tr key={`group-${row.group}`}><td colSpan={7} className="bg-[var(--surface-muted,transparent)] text-xs font-semibold uppercase tracking-wide text-muted-foreground">{GROUP_LABELS[row.group]}{row.group === "no_window" && <> · <span className="normal-case">Insurvas sets the windows per carrier</span></>}</td></tr>);
                  }
                }
                const u = urgency(row.daysLeft);
                out.push(
                  <tr key={row.key}>
                    <td>
                      <span className="block font-semibold text-foreground">{row.clientName ?? "No client linked"}</span>
                      {row.phone ? <span className="block select-all font-medium tabular-nums text-foreground" title="Check the calling window and do-not-call list before dialling">{phoneText(row.phone)}</span> : <span className="block text-xs text-muted-foreground">No phone on file</span>}
                      <Link href={`/app/policies/carrier/${row.carrierId}/${encodeURIComponent(row.policyNumber)}`} className="block text-xs text-muted-foreground hover:underline">{row.carrierName} · {row.policyNumber}</Link>
                    </td>
                    <td>
                      <span className="text-foreground">{row.reason === "recently_lapsed" && row.daysLeft === null ? "Lapsed in the latest file" : REASON_LABELS[row.reason]}</span>
                      {row.reason === "recently_lapsed" && row.daysLeft === null && <span className="block text-xs text-muted-foreground">whether it can be reinstated depends on the carrier&apos;s window</span>}
                      {row.daysPastDue ? <span className="block text-xs text-muted-foreground">{row.daysPastDue} days past due</span> : null}
                    </td>
                    <td className="text-right tabular-nums">{money(row.amountDueCents) ?? "—"}{row.premiumMode && row.premiumMode !== "monthly" && <span className="block text-xs text-muted-foreground">{row.premiumMode}</span>}</td>
                    <td className={`text-right text-base font-semibold tabular-nums ${URGENCY_CLASS[u]}`}>{row.daysLeft === null ? <span className="text-sm font-normal text-muted-foreground">—</span> : row.daysLeft}</td>
                    <td className="text-right tabular-nums">{money(row.atRiskCents) ?? <span className="text-muted-foreground" title="No advance from this carrier on file yet">Unknown</span>}</td>
                    <td className="text-xs">
                      {row.lastAction ? (
                        <>
                          <span className="block text-foreground">{OUTCOME_LABELS[row.lastAction.outcome] ?? row.lastAction.outcome}</span>
                          <span className="block text-muted-foreground">{fileDay(row.lastAction.at.slice(0, 10))}{row.lastAction.by ? ` · ${row.lastAction.by}` : ""}</span>
                          {row.lastAction.result && <StatusChip tone={row.lastAction.result === "saved" ? "good" : row.lastAction.result === "lost" ? "danger" : "warning"}>{RESULT_WORD[row.lastAction.result]}</StatusChip>}
                        </>
                      ) : <span className="text-muted-foreground">Never</span>}
                    </td>
                    <td className="text-right">
                      {!readOnly && (
                        <select aria-label={`Log the call to ${row.clientName ?? row.policyNumber}`} className={`${toolbarControl} w-[180px]`} value="" disabled={busy !== null} onChange={(e) => { if (e.target.value) void log(row, e.target.value); }}>
                          <option value="">{busy === row.key ? "Logging…" : "Log the call…"}</option>
                          {OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>)}
                        </select>
                      )}
                    </td>
                  </tr>,
                );
                return out;
              })}
            </tbody>
          </table>
        )}
      </TableCard>

      {rates && rates.calls > 0 && (
        <TableCard title="Save rate" description="From the files, not from opinion: a call counts as saved when the next file shows the paid-to date moved, lost when it shows the policy lapsed.">
          <div className="grid gap-6 px-4 py-4 sm:grid-cols-3">
            {([["By reason", rates.byReason, (l: string) => REASON_LABELS[l as keyof typeof REASON_LABELS] ?? l], ["By carrier", rates.byCarrier, (l: string) => l], ["By agent", rates.byAgent, (l: string) => l]] as const).map(([title, list, label]) => (
              <div key={title}>
                <h3 className="m-0 mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
                <ul className="m-0 grid list-none gap-1 p-0 text-sm">
                  {list.map((r) => (
                    <li key={r.label} className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate">{label(r.label)}</span>
                      <span className="shrink-0 tabular-nums"><span className="font-semibold">{r.rate === null ? "—" : `${r.rate}%`}</span> <span className="text-xs text-muted-foreground">{r.saved}/{r.saved + r.lost}{r.open ? ` · ${r.open} waiting` : ""}</span></span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </TableCard>
      )}
    </>
  );
}

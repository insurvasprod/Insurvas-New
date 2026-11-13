"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ClearFiltersButton, DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
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
/** The row's one chip carries its urgency (owner 2026-11-11: colour only in a chip, never a coloured number). */
const URGENCY_TONE = { red: "danger", amber: "warning", plain: "neutral" } as const;

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
  const pageSize = useFittingPageSize(480, 45);
  const shown = paginate(visible, page, pageSize);
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
          <StatTile label="Call today" value={today.toLocaleString("en-US")} footnote={today ? <StatusChip tone="danger" title="3 days or fewer left, or past the window">Call today</StatusChip> : "3 days or fewer left, or past the window"} />
          <StatTile label="Advance at risk" value={knownRisk ? money(atRisk) : "Unknown"} footnote={!knownRisk ? "no advance from these carriers is on file yet" : unknownRisk ? `${unknownRisk} more with no advance on file yet` : "unearned, on the policies listed"} />
          <StatTile label="Save rate" value={overall && overall.saved + overall.lost ? `${Math.floor((overall.saved * 100) / (overall.saved + overall.lost))}%` : "—"} footnote={overall && overall.saved + overall.lost ? `${overall.saved} saved of ${overall.saved + overall.lost} decided by the files` : rates && rates.calls ? `${rates.calls} logged ${rates.calls === 1 ? "call is" : "calls are"} waiting for the next carrier file` : "after your first logged calls"} />
          <StatTile label="No carrier window" value={noWindow.toLocaleString("en-US")} footnote={noWindow ? <StatusChip tone="warning" title="Set it in Carrier terms">No window</StatusChip> : "every listed carrier has one"} />
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
            <span className="text-sm text-foreground">Soonest deadline first, then the most money</span>
          </DataToolbar>
        }
        footer={visible.length ? <Pager page={shown.current} pageSize={pageSize} total={visible.length} noun="policies" onPage={setPage} /> : undefined}
      >
        {rows.length === 0 ? (
          <EmptyState title="Nobody to call" hint="Policies appear here when a carrier file shows a missed or bounced draft, a conservation notice, a request to cancel, a recent lapse that can still be reinstated, or a mailed bill worth converting." />
        ) : visible.length === 0 ? (
          <NoMatches noun="policies" onClear={() => { setReason(""); setCarrier(""); setPage(1); }} />
        ) : (
          <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
            <thead>
              {/*
                Owner 2026-11-11 (one-line tables): six columns, one line, one colour, one chip. The phone has its own
                column (it is what the row is for); why and the days left are the one chip, toned by urgency; the amount
                due, the premium mode and the carrier · policy are tooltips; the client opens the policy.
              */}
              <tr>
                <th>Client</th>
                <th>Phone</th>
                <th>Why</th>
                <th className="text-right" title="Unearned advance the carrier takes back if this policy dies (from the commission ledger)">Advance at risk</th>
                <th>Last contact</th>
                <th>{readOnly ? <span className="sr-only">Log the call</span> : "Next step"}</th>
              </tr>
            </thead>
            <tbody>
              {shown.rows.flatMap((row, index) => {
                const out = [];
                // A group heading before the first row of each group (the rows arrive grouped).
                if (index === 0 || shown.rows[index - 1].group !== row.group) {
                  if (row.group !== "deadline") {
                    out.push(<tr key={`group-${row.group}`}><td colSpan={6} className="bg-[var(--surface-muted,transparent)] text-xs font-semibold text-muted-foreground">{GROUP_LABELS[row.group]}{row.group === "no_window" && <> · <span className="normal-case">Insurvas sets the windows per carrier</span></>}</td></tr>);
                  }
                }
                const u = urgency(row.daysLeft);
                const lapsedNoWindow = row.reason === "recently_lapsed" && row.daysLeft === null;
                const why = lapsedNoWindow ? "Lapsed in the latest file" : REASON_LABELS[row.reason];
                const whyDetail = [
                  money(row.amountDueCents) ? `${money(row.amountDueCents)} due${row.premiumMode && row.premiumMode !== "monthly" ? ` (${row.premiumMode})` : ""}` : null,
                  row.daysPastDue ? `${row.daysPastDue} days past due` : null,
                  lapsedNoWindow ? "whether it can be reinstated depends on the carrier's window" : null,
                ].filter(Boolean).join(" · ");
                const last = row.lastAction;
                out.push(
                  <tr key={row.key}>
                    <td className="whitespace-nowrap font-medium text-foreground" title={`${row.carrierName} · ${row.policyNumber}`}>
                      <Link href={`/app/policies/carrier/${row.carrierId}/${encodeURIComponent(row.policyNumber)}`} className="hover:underline">{row.clientName ?? "No client linked"}</Link>
                    </td>
                    <td className="whitespace-nowrap tabular-nums">{row.phone ? <span className="select-all" title="Check the calling window and do-not-call list before dialling">{phoneText(row.phone)}</span> : <span className="text-muted-foreground" title="No phone on file">—</span>}</td>
                    <td><StatusChip tone={URGENCY_TONE[u]} title={whyDetail || undefined}>{why}{row.daysLeft !== null ? ` · ${row.daysLeft} ${row.daysLeft === 1 ? "day" : "days"} left` : ""}</StatusChip></td>
                    <td className="whitespace-nowrap text-right tabular-nums" title={money(row.atRiskCents) ? undefined : "No advance from this carrier on file yet"}>{money(row.atRiskCents) ?? "Unknown"}</td>
                    <td className="whitespace-nowrap" title={last ? `${fileDay(last.at.slice(0, 10))}${last.by ? ` · ${last.by}` : ""}` : undefined}>
                      {last ? `${OUTCOME_LABELS[last.outcome] ?? last.outcome}${last.result ? ` · ${RESULT_WORD[last.result]}` : ""}` : "Never"}
                    </td>
                    <td>
                      {/* A menu of outcomes (§11 row actions): choosing one is the deliberate act that logs, never a select's change. */}
                      {!readOnly && (
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <button type="button" className="whitespace-nowrap text-sm text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline" disabled={busy !== null} aria-label={`Log the call to ${row.clientName ?? row.policyNumber}`} title="Log what happened on the call">
                              {busy === row.key ? "Logging…" : "Log ›"}
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>What happened</DropdownMenuLabel>
                            {OUTCOMES.map((o) => <DropdownMenuItem key={o} onSelect={() => void log(row, o)}>{OUTCOME_LABELS[o]}</DropdownMenuItem>)}
                          </DropdownMenuContent>
                        </DropdownMenu>
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
                <h3 className="m-0 mb-2 text-xs font-semibold text-muted-foreground">{title}</h3>
                <ul className="m-0 grid list-none gap-1 p-0 text-sm">
                  {list.map((r) => (
                    <li key={r.label} className="flex items-baseline justify-between gap-2" title={r.open ? `${r.open} waiting for the next carrier file` : undefined}>
                      <span className="whitespace-nowrap">{label(r.label)}</span>
                      <span className="shrink-0 whitespace-nowrap tabular-nums">{r.rate === null ? <span className="text-muted-foreground">—</span> : `${r.rate}%`} · {r.saved}/{r.saved + r.lost}</span>
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

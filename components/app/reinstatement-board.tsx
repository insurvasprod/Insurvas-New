"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Callout } from "@/components/app/settings/primitives";
import { personName } from "@/lib/format/personName";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { fileDay } from "@/lib/ingestion/constants";
import { CASE_STATUS_LABELS, DECLINES, FORWARD, canMove, type CaseStatus, type Urgency } from "@/lib/retention/reinstatement";
import type { CaseRow, Reinstatement } from "@/lib/retention/reinstatementStore";
import { notify } from "@/lib/notify";

const money = (cents: number | null) => (cents === null ? null : `$${Math.round(cents / 100).toLocaleString("en-US")}`);
const phoneText = (raw: string) => {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
};
const DAYS_CLASS: Record<Urgency, string> = {
  pinned: "text-[var(--error-ink)]",
  red: "text-[var(--error-ink)]",
  amber: "text-[var(--warning-ink)]",
  plain: "text-foreground",
  no_window: "text-muted-foreground",
};
const TONE: Record<CaseStatus, StatusTone> = {
  identified: "action", contacted: "info", client_agreed: "info", submitted: "warning",
  reinstated: "good", declined_by_client: "neutral", declined_by_carrier: "neutral", expired: "danger",
};
const NEXT_LABEL: Partial<Record<CaseStatus, string>> = { contacted: "Called them", client_agreed: "Client agreed", submitted: "Sent to the carrier" };
const field = `${toolbarControl} w-full`;
const labelClass = "grid gap-1.5 text-sm font-medium text-foreground";

/**
 * LA-5.6 (Notion sprint) · reinstatement. Fewest days first; red inside a week, pinned inside the
 * pin threshold; a carrier with no window sits in its own labelled group with no countdown — never a
 * guessed one. "Reinstated" comes from the carrier file, "Window closed" from the calendar.
 *
 * 2026-11-02 tidy (owner): Open and Closed are chips with their counts, a search finds a client, each fact is
 * one line, the table fits its card, and a window about to close goes to the bell rather than the page.
 */
export function ReinstatementBoard({ data, readOnly }: { data: Reinstatement; readOnly: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [view, setView] = useState<"open" | "closed">("open");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [working, setWorking] = useState<CaseRow | null>(null);
  const needle = search.trim().toLowerCase();
  const rows = useMemo(() => (view === "open" ? data.open : data.closed).filter((r) => !needle || [r.clientName, r.policyNumber, r.phone, r.carrierName].some((v) => v?.toLowerCase().includes(needle))), [data, view, needle]);
  const pageSize = useFittingPageSize(480, 57);
  const shown = paginate(rows, page, pageSize);
  const { counts } = data;
  const advance = money(counts.advanceOpenCents);
  const pinned = useMemo(() => data.open.filter((r) => r.urgency === "pinned"), [data.open]);

  return (
    <>
      {pinned.length > 0 && <Callout tone="error" title={`${pinned.length === 1 ? "1 reinstatement window closes" : `${pinned.length} reinstatement windows close`} within ${data.settings.reinstatementPinDays} days. After that the policy is gone for good.`} />}
      {(data.open.length > 0 || data.closed.length > 0) && (
        <StatStrip label="Reinstatement">
          <StatTile label="Open cases" value={counts.open.toLocaleString("en-US")} footnote={counts.noWindow ? `${counts.noWindow} with no carrier window` : "every one has a deadline"} />
          <StatTile label={`Within ${data.settings.reinstatementRedDays} days`} value={data.open.filter((r) => r.urgency === "pinned" || r.urgency === "red").length.toLocaleString("en-US")} valueTone={pinned.length ? "danger" : undefined} footnote={`${pinned.length} within ${data.settings.reinstatementPinDays}`} />
          <StatTile label="Advance that revives" value={counts.advanceOpenCents > 0 ? advance : "Unknown"} footnote={counts.advanceUnknown ? `${counts.advanceUnknown} with no advance on file` : "if every case comes back"} />
          <StatTile label="Last 90 days" value={`${counts.reinstated90} back`} footnote={`${counts.expired90} window closed · ${counts.declined90} declined`} />
        </StatStrip>
      )}

      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {needle && <ClearFiltersButton onClick={() => { setSearch(""); setPage(1); }} />}
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>}>
            <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Client, policy or phone" />
            <ToggleChip role="radio" selected={view === "open"} count={data.open.length} countTone={pinned.length ? "danger" : undefined} onClick={() => { setView("open"); setPage(1); }}>Open</ToggleChip>
            <ToggleChip role="radio" selected={view === "closed"} count={data.closed.length} onClick={() => { setView("closed"); setPage(1); }}>Closed, 90 days</ToggleChip>
          </DataToolbar>
        }
        footer={rows.length ? <Pager page={shown.current} pageSize={pageSize} total={rows.length} noun="cases" onPage={setPage} /> : undefined}
      >
        {rows.length === 0 ? (
          needle ? <NoMatches noun="cases" onClear={() => { setSearch(""); setPage(1); }} /> : <EmptyState title={view === "open" ? "Nothing to reinstate" : "Nothing closed lately"} hint={view === "open" ? "A case opens when a carrier file shows a lapse the carrier still takes back." : "Closed cases show here for 90 days."} />
        ) : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead>
              <tr>
                <th>Client</th>
                <th className="w-[120px] text-right">{view === "open" ? "Days left" : "Closed"}</th>
                <th>Reinstate</th>
                <th>Where it stands</th>
                <th className="w-[150px] text-right"><span className="sr-only">Work it</span></th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {shown.rows.flatMap((r, i) => {
                const out = [];
                // The labelled group starts at the first case with no carrier window (they sort last).
                if (view === "open" && r.urgency === "no_window" && (i === 0 || shown.rows[i - 1].urgency !== "no_window")) {
                  out.push(<tr key="group-no-window"><td colSpan={5} className="text-xs font-semibold text-muted-foreground">No reinstatement window yet · <span className="normal-case">Insurvas sets it per carrier</span></td></tr>);
                }
                const c = r.comparison.reinstate;
                const next = FORWARD.find((s) => canMove(r.status, s));
                out.push(
                  <tr key={r.id} className="m-row">
                    <td>
                      <span className="block truncate font-semibold text-foreground" title={data.showOwners && r.owner ? `Owner: ${r.owner.name}${r.owner.escalated ? " · moved to the writing agent" : ""}` : undefined}>{r.clientName ? personName(r.clientName) : "No client linked"}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.phone ? <span className="select-all tabular-nums text-foreground" title="Check the calling window and do-not-call list before dialling">{phoneText(r.phone)}</span> : "No phone"}
                        {" · "}
                        <Link href={`/app/policies/carrier/${r.carrierId}/${encodeURIComponent(r.policyNumber)}`} className="hover:underline">{r.carrierName} {r.policyNumber}</Link>
                      </span>
                    </td>
                    <td className="text-right">
                      {view === "open" ? (
                        r.daysRemaining === null ? <span className="text-sm text-muted-foreground">—</span> : (
                          <span className={`block text-base font-semibold tabular-nums ${DAYS_CLASS[r.urgency]}`}>{r.daysRemaining <= 0 ? "Today" : r.daysRemaining}</span>
                        )
                      ) : <span className="tabular-nums">{r.resolvedAt ? fileDay(r.resolvedAt.slice(0, 10)) : "—"}</span>}
                      <span className="block whitespace-nowrap text-xs text-muted-foreground" title={`Lapsed ${fileDay(r.lapsedOn)}`}>{r.deadline && view === "open" ? `closes ${fileDay(r.deadline)}` : `lapsed ${fileDay(r.lapsedOn)}`}</span>
                    </td>
                    <td>
                      <span className="block truncate text-foreground">{c.owedCents === null ? "Ask the carrier what is owed" : `Owes ${c.owedIsEstimate ? "about " : ""}${money(c.owedCents)}${c.months ? ` · ${c.months} ${c.months === 1 ? "month" : "months"}` : ""}`}</span>
                      {(c.advanceRevivesCents !== null || r.comparison.sellNew.olderNow) && (
                        <span className="block truncate text-xs text-muted-foreground" title={r.comparison.sellNew.olderNow ? `A new policy prices at ${r.comparison.sellNew.ageNow}, not ${r.comparison.sellNew.ageThen}` : undefined}>
                          {[c.advanceRevivesCents !== null ? `${money(c.advanceRevivesCents)} advance revives` : null, r.comparison.sellNew.olderNow ? `new policy at age ${r.comparison.sellNew.ageNow}` : null].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </td>
                    <td>
                      <StatusChip tone={TONE[r.status]}>{CASE_STATUS_LABELS[r.status]}</StatusChip>
                      {(() => {
                        const line = [r.requiresHealthQuestions ? "Health questions" : null, r.requiresSignedForm ? "Signed form" : null, r.declineReason, r.workedBy].filter(Boolean).join(" · ");
                        return line ? <span className="mt-1 block truncate text-xs text-muted-foreground" title={line}>{line}</span> : null;
                      })()}
                    </td>
                    <td className="text-right">
                      {!readOnly && view === "open" && (
                        <Button type="button" variant="outline" size="sm" onClick={() => setWorking(r)}>{next && NEXT_LABEL[next] ? "Work the case" : "Update"}</Button>
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

      {working && <CaseDialog row={working} onClose={() => setWorking(null)} onDone={() => { setWorking(null); router.refresh(); }} />}
    </>
  );
}

function CaseDialog({ row, onClose, onDone }: { row: CaseRow; onClose: () => void; onDone: () => void }) {
  const steps = [...FORWARD.filter((s) => canMove(row.status, s)), ...DECLINES];
  const [step, setStep] = useState<CaseStatus | "">("");
  const [reason, setReason] = useState("");
  const [owed, setOwed] = useState(row.comparison.reinstate.owedIsEstimate ? "" : String((row.comparison.reinstate.owedCents ?? 0) / 100));
  const [months, setMonths] = useState(row.comparison.reinstate.owedIsEstimate || row.comparison.reinstate.months === null ? "" : String(row.comparison.reinstate.months));
  const [health, setHealth] = useState<string>(row.requiresHealthQuestions === null ? "" : row.requiresHealthQuestions ? "yes" : "no");
  const [form, setForm] = useState<string>(row.requiresSignedForm === null ? "" : row.requiresSignedForm ? "yes" : "no");
  const [requirements, setRequirements] = useState(row.requirementsNote ?? "");
  const [reference, setReference] = useState(row.carrierReference ?? "");
  const [note, setNote] = useState(row.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const declining = step === "declined_by_client" || step === "declined_by_carrier";
  const ready = !declining || reason.trim().length >= 3;
  const c = row.comparison;
  const yesNo = (v: string) => (v === "" ? null : v === "yes");

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const owedCents = owed.trim() === "" ? null : Math.round(Number(owed.replace(/[$,]/g, "")) * 100);
      if (owedCents !== null && !Number.isFinite(owedCents)) throw new Error("Enter the amount the carrier quoted, in dollars.");
      const response = await fetch("/api/app/retention/reinstatement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id, ...(step ? { status: step } : {}), ...(declining ? { decline_reason: reason.trim() } : {}),
          amount_owed_cents: owedCents, months_owed: months.trim() === "" ? null : Number(months),
          requires_health_questions: yesNo(health), requires_signed_form: yesNo(form),
          requirements_note: requirements.trim() || null, carrier_reference: reference.trim() || null, note: note.trim() || null,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "That could not be saved.");
      notify.done(step === "submitted" ? "Sent. The case closes as reinstated when a carrier file shows the policy back in force." : "Saved.");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Reinstate {row.clientName ?? row.policyNumber}</DialogTitle>
          <DialogDescription>
            {row.carrierName} · {row.policyNumber} · lapsed {fileDay(row.lapsedOn)}{row.deadline ? ` · the carrier takes it back until ${fileDay(row.deadline)}` : " · no reinstatement window set for this carrier"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 rounded-lg border border-border p-3 text-sm sm:grid-cols-2">
            <div>
              <span className="block font-semibold text-foreground">Reinstate</span>
              <ul className="m-0 mt-1 grid list-none gap-0.5 p-0 text-muted-foreground">
                <li>{c.reinstate.owedCents === null ? "Back premium: ask the carrier" : `Pays ${c.reinstate.owedIsEstimate ? "about " : ""}${money(c.reinstate.owedCents)} back premium${c.reinstate.owedIsEstimate ? " (estimate)" : ""}`}</li>
                <li>Coverage resumes as it was</li>
                <li>{c.reinstate.advanceRevivesCents !== null ? `Your advance revives: ${money(c.reinstate.advanceRevivesCents)}` : "The original advance revives"}</li>
                <li>No new chargeback window</li>
                {c.reinstate.needsHealthQuestions && <li>A short health questionnaire</li>}
              </ul>
            </div>
            <div>
              <span className="block font-semibold text-foreground">Sell a new policy</span>
              <ul className="m-0 mt-1 grid list-none gap-0.5 p-0 text-muted-foreground">
                <li>{c.sellNew.ageNow !== null ? `Priced at age ${c.sellNew.ageNow}${c.sellNew.olderNow ? `, not ${c.sellNew.ageThen}` : ""}: quote it` : "Priced at today's age: quote it"}</li>
                <li>A new application, two to three weeks</li>
                <li>A new advance, and a new twelve-month risk</li>
                <li>The lead cost is spent either way</li>
              </ul>
            </div>
          </div>

          <label htmlFor="case-step" className={labelClass}>
            What happened
            <select id="case-step" className={field} value={step} onChange={(e) => setStep(e.target.value as CaseStatus | "")}>
              <option value="">No change of step — {CASE_STATUS_LABELS[row.status].toLowerCase()}</option>
              {steps.map((s) => <option key={s} value={s}>{NEXT_LABEL[s] ?? CASE_STATUS_LABELS[s]}</option>)}
            </select>
          </label>
          {declining && <label htmlFor="case-reason" className={labelClass}>Why<input id="case-reason" autoComplete="off" maxLength={500} className={field} value={reason} onChange={(e) => setReason(e.target.value)} /></label>}

          <div className="grid gap-3 sm:grid-cols-2">
            <label htmlFor="case-owed" className={labelClass}>Back premium the carrier quoted ($)<input id="case-owed" inputMode="decimal" autoComplete="off" className={field} value={owed} onChange={(e) => setOwed(e.target.value)} placeholder={c.reinstate.owedIsEstimate && c.reinstate.owedCents !== null ? `about ${money(c.reinstate.owedCents)}` : ""} /></label>
            <label htmlFor="case-months" className={labelClass}>Months owed<input id="case-months" inputMode="numeric" autoComplete="off" className={field} value={months} onChange={(e) => setMonths(e.target.value.replace(/\D/g, ""))} /></label>
            <label htmlFor="case-health" className={labelClass}>
              Health questions
              <select id="case-health" className={field} value={health} onChange={(e) => setHealth(e.target.value)}><option value="">Not known</option><option value="yes">Yes</option><option value="no">No</option></select>
            </label>
            <label htmlFor="case-form" className={labelClass}>
              Signed form
              <select id="case-form" className={field} value={form} onChange={(e) => setForm(e.target.value)}><option value="">Not known</option><option value="yes">Yes</option><option value="no">No</option></select>
            </label>
            <label htmlFor="case-ref" className={labelClass}>Carrier reference<input id="case-ref" autoComplete="off" maxLength={120} className={field} value={reference} onChange={(e) => setReference(e.target.value)} /></label>
            <label htmlFor="case-req" className={labelClass}>What else they need<input id="case-req" autoComplete="off" maxLength={1000} className={field} value={requirements} onChange={(e) => setRequirements(e.target.value)} /></label>
          </div>
          <label htmlFor="case-note" className={labelClass}>Note<textarea id="case-note" className={`${field} min-h-16 py-2`} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          {error && <Callout tone="error" title={error} />}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!ready || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

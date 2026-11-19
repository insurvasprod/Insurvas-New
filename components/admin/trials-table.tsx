"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, Download } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { st, type PillTone, pillTone } from "@/components/app/settings/primitives";
import { BulkBar, RowCheckbox, SelectAllCheckbox, useRowSelection } from "@/components/ui/bulk-bar";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { DetailPanel } from "@/components/ui/detail-panel";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FactTable } from "@/components/ui/fact-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { EmptyState, ErrorState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { Meter } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { notify } from "@/lib/notify";
import type { TrialBoardRow, TrialEngagement } from "@/lib/trials/board";
import { ENDING_SOON_DAYS, SIGNAL_KEYS, SIGNAL_LABELS, SIGNAL_MEANINGS, type MonthConversion } from "@/lib/trials/boardModel";
import { cardReminderEmail } from "@/lib/trials/cardReminder";
import { filterTrials, readTrialFilters, trialFilterParams, trialsCsv, type TrialFilters } from "@/lib/trials/filters";
import { cn } from "@/lib/utils";

type PendingAction = { trials: TrialBoardRow[]; kind: "extend" | "cancel" | "convert" | "remind" } | null;

const ENGAGEMENT_TONE: Record<TrialEngagement["level"], PillTone> = { at_risk: "error", quiet: "warning", engaged: "success" };

/**
 * The trials list (admin round 1, billing-r2 screen 3): one TableCard, its toolbar inside, the pager at its foot.
 *
 * Every trial in flight is on the client (tens, not thousands), so search, filters and paging are instant and the
 * counts exact. The filters live in the address (`?ends=week&card=no_card` lands filtered). A row opens its sheet
 * (the owner, the card, the trial day, the activation signals, and Extend, Convert now, Cancel); ticking rows
 * extends or reminds several at once. Every action is confirmed, and goes through the existing routes.
 */
export function TrialsTable({
  rows,
  canManage,
  signalsAvailable,
  listError,
  history,
}: {
  rows: TrialBoardRow[];
  /** CAN_MANAGE_SUBSCRIPTIONS — the same list the action routes check. */
  canManage: boolean;
  signalsAvailable: boolean;
  listError: boolean;
  /** Conversion over the last six months, for the sheet's foot; null when it could not be read. */
  history: MonthConversion[] | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const id = useId();
  const [refreshing, startRefresh] = useTransition();
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const [pending, setPending] = useState<PendingAction>(null);
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const filters = useMemo(() => readTrialFilters(params), [params]);
  const plans = useMemo(() => [...new Set(rows.map((r) => r.planName))].sort((a, b) => a.localeCompare(b)), [rows]);
  const filtered = useMemo(() => filterTrials(rows, filters, ENDING_SOON_DAYS), [rows, filters]);
  const selection = useRowSelection(useMemo(() => filtered.map((row) => row.subscriptionId), [filtered]));

  const pageSize = useFittingPageSize(480, 45);
  const { current, rows: shown } = paginate(filtered, page, pageSize);
  const anyFilter = filters.ends !== "any" || filters.signal !== "any" || filters.card !== "any" || filters.plan !== "all" || filters.q !== "";
  const openRow = openId ? rows.find((row) => row.subscriptionId === openId) ?? null : null;
  const chosen = useMemo(() => rows.filter((row) => selection.isSelected(row.subscriptionId)), [rows, selection]);

  function setFilters(patch: Partial<TrialFilters>) {
    setParamsInPlace(trialFilterParams({ ...filters, ...patch }));
    setPage(1);
  }
  function clearAll() {
    setFilters({ q: "", plan: "all", ends: "any", signal: "any", card: "any" });
  }

  function closeDialog() {
    if (busy) return;
    setPending(null);
    setReason("");
  }

  async function call(trial: TrialBoardRow, body: Record<string, unknown>): Promise<string | null> {
    const res = await fetch(`/api/admin/trials/${trial.subscriptionId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const result = res ? await res.json().catch(() => null) : null;
    return res?.ok ? null : result?.error ?? "That did not work";
  }

  /** Runs the action on each trial in turn, through the existing one-trial route, and says what happened. */
  async function run(trials: TrialBoardRow[], body: Record<string, unknown>, done: (count: number) => string) {
    setBusy(true);
    const failures: string[] = [];
    for (const [index, trial] of trials.entries()) {
      if (trials.length > 1) setProgress(`${index + 1} of ${trials.length}`);
      const error = await call(trial, body);
      if (error) failures.push(`${trial.displayName}: ${error}`);
    }
    setBusy(false);
    setProgress(null);
    const ok = trials.length - failures.length;
    if (failures.length === 0) notify.done(done(ok));
    else if (ok === 0) notify.block(failures.join(" · "));
    else notify.warn(`${done(ok)}. ${failures.length} did not: ${failures.join(" · ")}`);
    setPending(null);
    setReason("");
    selection.clear();
    router.refresh();
  }

  async function remind(trials: TrialBoardRow[]) {
    setBusy(true);
    const res = await fetch("/api/admin/trials/card-reminders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriptionIds: trials.map((t) => t.subscriptionId) }) }).catch(() => null);
    const result = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res?.ok) {
      notify.block(result?.error ?? "The reminders could not be sent");
      return;
    }
    const skipped = (result?.skipped ?? []) as { reason: string }[];
    const failed = (result?.notDelivered ?? []) as { reason: string }[];
    const parts = [`${result?.sent ?? 0} sent`, failed.length ? `${failed.length} not delivered` : null, skipped.length ? `${skipped.length} skipped (${[...new Set(skipped.map((s) => s.reason))].join(", ")})` : null].filter(Boolean).join(" · ");
    if (failed.length || (result?.sent ?? 0) === 0) notify.warn(`Card reminders: ${parts}`);
    else notify.done(`Card reminders: ${parts}`);
    setPending(null);
    selection.clear();
    router.refresh();
  }

  function exportCsv() {
    const csv = trialsCsv(selection.count > 0 ? chosen : filtered);
    const url = URL.createObjectURL(new Blob([`﻿${csv}\r\n`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `trials-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const reasonValid = reason.trim().length >= 5;
  const daysNumber = Number(days);
  const daysValid = Number.isInteger(daysNumber) && daysNumber >= 1 && daysNumber <= 90;
  const many = (pending?.trials.length ?? 0) > 1;
  const subject = pending ? (many ? `${pending.trials.length} trials` : `the trial for ${pending.trials[0]?.displayName}`) : "";
  const remindable = pending?.kind === "remind" ? pending.trials.filter((t) => !t.hasPaymentMethod && t.ownerEmail) : [];
  const preview = remindable[0]
    ? cardReminderEmail({ ownerName: remindable[0].ownerName, businessName: remindable[0].displayName, planName: remindable[0].planName, trialEndsAt: remindable[0].trialEndsAt, daysLeft: remindable[0].daysLeft, billingUrl: "(the customer's Plan & billing link)" })
    : null;
  const pageIds = shown.map((row) => row.subscriptionId);

  return (
    <>
      <TableCard
        className="min-w-0"
        footer={<Pager page={current} pageSize={pageSize} total={filtered.length} noun="trials" suffix="fewest days remaining first" onPage={setPage} />}
        toolbar={
          <DataToolbar
            actions={
              <>
                <Button type="button" variant="outline" onClick={exportCsv} disabled={filtered.length === 0} title={selection.count > 0 ? "The ticked trials, as a CSV" : "The trials the filters show, as a CSV"}>
                  <Download aria-hidden="true" />
                  Export
                </Button>
                <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
              </>
            }
          >
            <SearchBox value={filters.q} onChange={(q) => setFilters({ q })} />
            <select aria-label="Plan" value={filters.plan} onChange={(event) => setFilters({ plan: event.target.value })} className={cn(toolbarControl, "max-w-56")}>
              <option value="all">All plans</option>
              {plans.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <select aria-label="Ends" value={filters.ends} onChange={(event) => setFilters({ ends: event.target.value as TrialFilters["ends"] })} className={toolbarControl}>
              <option value="any">Ends any time</option>
              <option value="soon">Ends within {ENDING_SOON_DAYS} days</option>
              <option value="week">Ends within 7 days</option>
            </select>
            <select
              aria-label="Activation"
              value={filters.signal}
              disabled={!signalsAvailable}
              title={!signalsAvailable ? "The activation signals could not be read" : undefined}
              onChange={(event) => setFilters({ signal: event.target.value as TrialFilters["signal"] })}
              className={toolbarControl}
            >
              <option value="any">Any activation</option>
              <option value="no_leads">No leads imported</option>
              <option value="no_team">No second user</option>
              <option value="no_carrier">No carrier added</option>
              <option value="neither">Neither leads nor a second user</option>
            </select>
            <select aria-label="Card on file" value={filters.card} onChange={(event) => setFilters({ card: event.target.value as TrialFilters["card"] })} className={toolbarControl}>
              <option value="any">Any card status</option>
              <option value="card">Card on file</option>
              <option value="no_card">No card on file</option>
            </select>
            {anyFilter && <Button type="button" variant="ghost" onClick={clearAll}>Clear</Button>}
          </DataToolbar>
        }
        filters={
          canManage ? (
            <BulkBar
              count={selection.count}
              noun={["trial", "trials"]}
              onClear={selection.clear}
              selectAll={<SelectAllCheckbox selection={selection} ids={pageIds} />}
              actions={
                <>
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setPending({ trials: chosen, kind: "extend" })}>Extend {selection.count}…</Button>
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setPending({ trials: chosen, kind: "remind" })}>Email a card reminder…</Button>
                </>
              }
            />
          ) : undefined
        }
      >
        <table className={cn(st.table, "min-w-[1060px]")}>
          <thead>
            <tr className={st.headRow}>
              {canManage && <th scope="col" className={cn(st.th, "w-10")}><SelectAllCheckbox selection={selection} ids={pageIds} /></th>}
              <th scope="col" className={st.th}>Customer</th>
              <th scope="col" className={cn(st.th, "w-[120px]")}>Plan</th>
              <th scope="col" className={cn(st.th, "w-[90px]")}>Started</th>
              <th scope="col" className={cn(st.th, "w-[90px]")}>Ends</th>
              <th scope="col" className={cn(st.th, st.num, "w-[90px]")}>Days left</th>
              <th scope="col" className={cn(st.th, "w-[220px]")}>Activation</th>
              <th scope="col" className={cn(st.th, "w-[110px]")}>Card</th>
              <th scope="col" className={cn(st.th, "w-10")}><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {listError && (
              <tr><td colSpan={9} className="border-t border-[var(--border)] p-0">
                <ErrorState title="The trials could not be read" detail="The list of trials in flight did not load. Reload the page; if it keeps failing, the error is in the server log." />
              </td></tr>
            )}
            {!listError && rows.length === 0 && (
              <tr><td colSpan={9} className="border-t border-[var(--border)] p-0"><EmptyState title="No trials in flight" hint="A trial appears here the moment a customer starts one." /></td></tr>
            )}
            {rows.length > 0 && filtered.length === 0 && (
              <tr><td colSpan={9} className="border-t border-[var(--border)] p-0"><NoMatches noun="trials" onClear={anyFilter ? clearAll : undefined} /></td></tr>
            )}
            {shown.map((row) => {
              const selected = openId === row.subscriptionId || selection.isSelected(row.subscriptionId);
              return (
                <tr key={row.subscriptionId} className={cn("m-row cursor-pointer hover:bg-[var(--hover-wash)]", selected && "bg-[var(--hover-wash)]")} onClick={() => setOpenId(row.subscriptionId)}>
                  {canManage && (
                    <td className={st.td} onClick={(event) => event.stopPropagation()}>
                      <RowCheckbox selection={selection} id={row.subscriptionId} label={`Choose ${row.displayName}`} />
                    </td>
                  )}
                  <td className={cn(st.td, "max-w-0")}>
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      onClick={(event) => { event.stopPropagation(); setOpenId(row.subscriptionId); }}
                      title={row.ownerEmail ? `Owner: ${row.ownerEmail}` : undefined}
                      className="block w-full cursor-pointer truncate rounded-sm border-0 bg-transparent p-0 text-left font-semibold text-[var(--ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                    >
                      {row.displayName}
                    </button>
                  </td>
                  <td className={cn(st.td, "truncate")}>{row.planName}</td>
                  <td className={st.td}><TrialDate iso={row.startedAt} text={row.startedLabel} full={row.startedFull} /></td>
                  <td className={st.td}><TrialDate iso={row.trialEndsAt} text={row.endsLabel} full={row.endsFull} /></td>
                  <td className={cn(st.td, st.num)} title={row.overdue ? "The trial end has passed; the subscription is still marked as on trial" : undefined}>{row.daysLeft}</td>
                  <td className={cn(st.td, "truncate")}><ActivationText row={row} /></td>
                  <td className={st.td}>
                    {row.hasPaymentMethod ? <StatusChip tone="good">Card</StatusChip> : <StatusChip tone="warning">No card</StatusChip>}
                  </td>
                  <td className={st.td}><ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableCard>

      {openRow && (
        <DetailPanel
          mode="overlay"
          className="lg:w-[min(560px,calc(100vw-80px))]"
          title={openRow.displayName}
          subtitle={`${openRow.planName} · ${openRow.billingCycle} · day ${openRow.daysElapsed} of ${openRow.daysElapsed + openRow.daysLeft}`}
          status={openRow.hasPaymentMethod ? <StatusChip tone="good">Card on file</StatusChip> : <StatusChip tone="warning">No card on file</StatusChip>}
          onClose={() => setOpenId(null)}
          closeLabel="Close the trial"
          footer={
            <>
              <Link href={`/admin/tenants/${openRow.tenantId}`} className="rounded-sm text-sm font-semibold text-[var(--accent-ink)] no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
                Open customer record ›
              </Link>
              <span className="flex-1" />
              <Button type="button" variant="outline" onClick={() => setOpenId(null)}>Close</Button>
            </>
          }
        >
          <TrialSheet
            row={openRow}
            canManage={canManage}
            busy={busy}
            history={history}
            onExtend={() => setPending({ trials: [openRow], kind: "extend" })}
            onConvert={() => setPending({ trials: [openRow], kind: "convert" })}
            onCancel={() => setPending({ trials: [openRow], kind: "cancel" })}
            onRemind={() => setPending({ trials: [openRow], kind: "remind" })}
          />
        </DetailPanel>
      )}

      <Dialog open={pending !== null} onOpenChange={(value) => !value && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.kind === "remind" ? `Email a card reminder to ${many ? `${pending.trials.length} owners` : pending?.trials[0]?.displayName ?? ""}` : `${pending?.kind === "extend" ? "Extend" : pending?.kind === "convert" ? "Convert" : "Cancel"} ${subject}`}
            </DialogTitle>
            <DialogDescription>
              {pending?.kind === "extend"
                ? `Pushes the charge date and every reminder with it, here and at the payment provider.${many ? " Each trial is extended on its own; one that fails does not stop the rest." : ""}`
                : pending?.kind === "convert"
                  ? "Ends the trial now by charging the card on file for the plan's price. The payment webhook turns the subscription active when the charge succeeds."
                  : pending?.kind === "cancel"
                    ? "Stops the provider collecting and ends the trial. The reason is recorded."
                    : `${remindable.length === 0 ? "None of these can be sent: each already has a card on file or has no owner email." : `${remindable.length} of ${pending?.trials.length ?? 0} will be sent${remindable.length < (pending?.trials.length ?? 0) ? " (the rest have a card on file or no owner email)" : ""}. Each is recorded in the audit log.`}`}
            </DialogDescription>
          </DialogHeader>

          {pending?.kind === "remind" && preview && (
            <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
              <p className="m-0 text-xs text-muted-foreground">To {remindable[0].ownerEmail}{remindable.length > 1 ? ` and ${remindable.length - 1} more, each with their own name and dates` : ""}</p>
              <p className="m-0 text-sm font-semibold text-foreground">{preview.subject}</p>
              <p className="m-0 max-h-48 overflow-y-auto whitespace-pre-wrap text-sm text-[var(--body)]">{preview.text}</p>
            </div>
          )}

          {(pending?.kind === "extend" || pending?.kind === "cancel") && (
            <div className="space-y-3">
              {pending.kind === "extend" && (
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-days`}>Extend by (days)</Label>
                  <Input id={`${id}-days`} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} aria-describedby={`${id}-days-hint`} />
                  <p id={`${id}-days-hint`} className="text-xs leading-[1.5] text-[var(--muted)]">Between 1 and 90 whole days.</p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-reason`}>Reason</Label>
                <Input id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={pending.kind === "extend" ? "Onboarding call slipped a week" : "Customer asked to stop"} />
                <p className="text-xs leading-[1.5] text-[var(--muted)]">At least 5 characters. Recorded in the audit log{many ? " for each trial" : ""}.</p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeDialog} disabled={busy}>Close</Button>
            <Button
              type="button"
              disabled={
                busy ||
                (pending?.kind === "extend" && (!reasonValid || !daysValid)) ||
                (pending?.kind === "cancel" && !reasonValid) ||
                (pending?.kind === "remind" && remindable.length === 0)
              }
              onClick={() => {
                if (!pending) return;
                if (pending.kind === "extend") void run(pending.trials, { action: "extend", days: daysNumber, reason: reason.trim() }, (n) => (n === 1 ? "Trial extended" : `${n} trials extended`));
                else if (pending.kind === "convert") void run(pending.trials, { action: "convert" }, () => "Charged — the payment webhook will convert it");
                else if (pending.kind === "cancel") void run(pending.trials, { action: "cancel", reason: reason.trim() }, () => "Trial cancelled");
                else void remind(remindable);
              }}
            >
              {busy
                ? progress ? `Working… ${progress}` : "Working…"
                : pending?.kind === "extend"
                  ? many ? `Extend ${pending.trials.length} trials` : "Extend trial"
                  : pending?.kind === "convert"
                    ? "Charge and convert"
                    : pending?.kind === "cancel"
                      ? "Cancel trial"
                      : remindable.length > 1 ? `Send ${remindable.length} reminders` : "Send reminder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The activation signals in words: which were reached, the rest on hover. One line, no chips. */
function ActivationText({ row }: { row: TrialBoardRow }) {
  if (!row.signals) return <span className="text-muted-foreground" title="The activation signals could not be read">Couldn&apos;t read</span>;
  const reached = SIGNAL_KEYS.filter((key) => row.signals?.[key]);
  const title = SIGNAL_KEYS.map((key) => `${SIGNAL_MEANINGS[key]}: ${row.signals?.[key] ? row.signalDates[key] ?? "yes" : "not yet"}`).join("\n");
  return (
    <span title={`${row.engagement.label}\n${title}`}>
      {row.engagement.label}
      <span className="text-muted-foreground"> · {reached.length ? reached.map((key) => SIGNAL_LABELS[key]).join(", ") : "nothing set up"}</span>
    </span>
  );
}

/** What the sheet shows: the facts the old expanded row showed, the signals, the actions, and conversion over time. */
function TrialSheet({ row, canManage, busy, history, onExtend, onConvert, onCancel, onRemind }: {
  row: TrialBoardRow;
  canManage: boolean;
  busy: boolean;
  history: MonthConversion[] | null;
  onExtend: () => void;
  onConvert: () => void;
  onCancel: () => void;
  onRemind: () => void;
}) {
  const total = row.daysElapsed + row.daysLeft;
  const facts: Array<[string, ReactNode]> = [
    ["Owner", row.ownerEmail ? <span title={row.ownerName ? `${row.ownerName} · ${row.ownerEmail}` : row.ownerEmail}>{row.ownerName ? `${row.ownerName} · ` : ""}{row.ownerEmail}</span> : "No owner yet"],
    ["Owner sign-in", <span key="e" title={row.lastLoginFull ? `Last signed in ${row.lastLoginFull}` : "The owner has never signed in"}><StatusChip dot={false} tone={pillTone(ENGAGEMENT_TONE[row.engagement.level])}>{row.engagement.label}</StatusChip></span>],
    ["Trial day", `Day ${row.daysElapsed} of ${total} · ${row.daysLeft} left`],
    ["Card on file", row.hasPaymentMethod ? "Yes" : "No card on file"],
    ["Started", <TrialDate key="s" iso={row.startedAt} text={row.startedFull} full={row.startedFull} />],
    ["Ends", <TrialDate key="n" iso={row.trialEndsAt} text={row.endsFull} full={row.endsFull} />],
    ["Billing", <span key="b" className="capitalize">{row.billingCycle}</span>],
    ...SIGNAL_KEYS.map((key): [string, ReactNode] => [SIGNAL_LABELS[key], `${SIGNAL_MEANINGS[key]}: ${!row.signals ? "could not be read" : row.signals[key] ? row.signalDates[key] : "not yet"}`]),
  ];

  return (
    <>
      <FactTable rows={facts} labelWidth={130} />
      <div className="flex flex-wrap items-center gap-2">
        {canManage ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={onExtend} disabled={busy}>Extend trial…</Button>
            <Button type="button" variant="outline" size="sm" onClick={onConvert} disabled={busy || !row.hasPaymentMethod} title={row.hasPaymentMethod ? undefined : "There is no card on file to charge"}>Convert now…</Button>
            {!row.hasPaymentMethod && <Button type="button" variant="outline" size="sm" onClick={onRemind} disabled={busy || !row.ownerEmail} title={row.ownerEmail ? undefined : "There is no owner email to send to"}>Email a card reminder…</Button>}
            <Button type="button" variant="outline" size="sm" className="text-[var(--error-ink)]" onClick={onCancel} disabled={busy}>Cancel trial…</Button>
          </>
        ) : (
          <span className="text-xs leading-[1.5] text-[var(--muted)]">Only super admins and billing admins can change a trial.</span>
        )}
      </div>
      {canManage && !row.hasPaymentMethod && <p className="m-0 text-xs text-muted-foreground">Convert now is off: there is no card on file to charge.</p>}
      <ConversionFoot history={history} />
    </>
  );
}

/** Conversion over six months: converted of trials that ended, a month a line. */
function ConversionFoot({ history }: { history: MonthConversion[] | null }) {
  return (
    <section aria-label="Conversion over six months" className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
      <h3 className="m-0 text-xs font-semibold text-muted-foreground">Conversion over six months</h3>
      {history === null ? (
        <p className="m-0 text-xs text-muted-foreground">Couldn&apos;t be read just now.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {history.map((month) => {
            const ended = month.converted + month.lapsed;
            return (
              <li key={month.key} className="grid grid-cols-[36px_minmax(0,1fr)_120px] items-center gap-2 text-xs">
                <span className="text-muted-foreground">{month.label}</span>
                {ended === 0 ? <span className="text-muted-foreground">no trial ended</span> : <Meter value={month.converted} max={ended} tone="good" label={`${month.label}: ${month.converted} of ${ended} converted`} />}
                <span className="text-right tabular-nums text-foreground">{ended === 0 ? "—" : `${month.converted} of ${ended} · ${Math.round((month.converted / ended) * 100)}%`}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The search box, typed into freely and written to the address a beat after typing stops. */
function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value);
  const timer = useRef<number | undefined>(undefined);
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) { last.current = value; setText(value); }
  }, [value]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <ToolbarSearch
      value={text}
      onChange={(next) => {
        setText(next);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => { last.current = next.trim(); onChange(next.trim()); }, 200);
      }}
      placeholder="Search customer or owner"
    />
  );
}

/** A UTC date printed by the server, with the reader's local time added to the hover after mount. */
function TrialDate({ iso, text, full }: { iso: string; text: string; full: string }) {
  const ref = useRef<HTMLTimeElement>(null);
  useEffect(() => {
    const date = new Date(iso);
    if (ref.current && !Number.isNaN(date.getTime())) {
      ref.current.title = `${full} · ${date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })} your time`;
    }
  }, [iso, full]);
  return <time ref={ref} dateTime={iso} title={full} className="whitespace-nowrap">{text}</time>;
}

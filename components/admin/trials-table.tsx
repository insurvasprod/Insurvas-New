"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { BoardTableFooter } from "@/components/admin/board-table-footer";
import { EmptyState, NoMatches } from "@/components/admin/empty-state";
import { Pill, st, type PillTone } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { notify } from "@/lib/notify";
import type { TrialBoardRow, TrialEngagement } from "@/lib/trials/board";
import { ENDING_SOON_DAYS, SIGNAL_KEYS, SIGNAL_LABELS, SIGNAL_MEANINGS } from "@/lib/trials/boardModel";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

type EndsFilter = "any" | "soon" | "week";
type SignalFilter = "any" | "no_leads" | "no_team" | "no_carrier" | "neither";
type CardFilter = "any" | "card" | "no_card";
type PendingAction = { trial: TrialBoardRow; kind: "extend" | "cancel" | "convert" } | null;

const ENGAGEMENT_TONE: Record<TrialEngagement["level"], PillTone> = {
  at_risk: "error",
  quiet: "warning",
  engaged: "success",
};

/**
 * The trials list (board p-adm-trials): one TableCard, its toolbar inside, the pager at its foot.
 *
 * Every trial in flight is on the client already (there are tens, not thousands), so search,
 * filters and paging are instant and the counts exact. A row opens in place to show the owner, the
 * card on file, the dates to the second, and the three things staff can do to a trial — Extend,
 * Convert now, Cancel — which the page before this one had as row buttons.
 */
export function TrialsTable({
  rows,
  canManage,
  signalsAvailable,
  listError,
}: {
  rows: TrialBoardRow[];
  /** CAN_MANAGE_SUBSCRIPTIONS — the same list the action route checks. */
  canManage: boolean;
  signalsAvailable: boolean;
  listError: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [refreshing, startRefresh] = useTransition();
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState("all");
  const [ends, setEnds] = useState<EndsFilter>("any");
  const [signal, setSignal] = useState<SignalFilter>("any");
  const [card, setCard] = useState<CardFilter>("any");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  const [pending, setPending] = useState<PendingAction>(null);
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const plans = useMemo(() => [...new Set(rows.map((r) => r.planName))].sort((a, b) => a.localeCompare(b)), [rows]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (plan !== "all" && row.planName !== plan) return false;
      if (ends === "soon" && row.daysLeft > ENDING_SOON_DAYS) return false;
      if (ends === "week" && row.daysLeft > 7) return false;
      if (card === "card" && !row.hasPaymentMethod) return false;
      if (card === "no_card" && row.hasPaymentMethod) return false;
      if (signal !== "any") {
        if (!row.signals) return false;
        if (signal === "no_leads" && row.signals.leads) return false;
        if (signal === "no_team" && row.signals.team) return false;
        if (signal === "no_carrier" && row.signals.carrier) return false;
        if (signal === "neither" && (row.signals.leads || row.signals.team)) return false;
      }
      if (!needle) return true;
      return [row.displayName, row.tenantName, row.ownerEmail ?? "", row.ownerName ?? ""].some((v) =>
        v.toLowerCase().includes(needle),
      );
    });
  }, [rows, search, plan, ends, signal, card]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(Math.max(page, 1), pages);
  const shown = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const anyFilter = ends !== "any" || signal !== "any" || card !== "any" || plan !== "all" || search.trim() !== "";

  function clearAll() {
    setEnds("any");
    setSignal("any");
    setCard("any");
    setSearch("");
    setPlan("all");
    setPage(1);
  }

  function closeDialog() {
    if (busy) return;
    setPending(null);
    setReason("");
  }

  async function act(trial: TrialBoardRow, body: Record<string, unknown>, success: string) {
    setBusy(true);
    const res = await fetch(`/api/admin/trials/${trial.subscriptionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const result = res ? await res.json().catch(() => null) : null;
    setBusy(false);

    if (!res || !res.ok) {
      notify.block(result?.error ?? "That did not work");
      return;
    }

    notify.done(success);
    setPending(null);
    setReason("");
    router.refresh();
  }

  const reasonValid = reason.trim().length >= 5;
  const daysNumber = Number(days);
  const daysValid = Number.isInteger(daysNumber) && daysNumber >= 1 && daysNumber <= 90;

  return (
    <>
      <TableCard
        className="min-w-0"
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
            <ToolbarSearch
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              placeholder="Search tenant"
            />
            <select
              aria-label="Plan"
              value={plan}
              onChange={(event) => {
                setPlan(event.target.value);
                setPage(1);
              }}
              className={cn(toolbarControl, "max-w-56")}
            >
              <option value="all">All plans</option>
              {plans.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select
              aria-label="Ends"
              value={ends}
              onChange={(event) => {
                setEnds(event.target.value as EndsFilter);
                setPage(1);
              }}
              className={toolbarControl}
            >
              <option value="any">Ends any time</option>
              <option value="soon">Ends within {ENDING_SOON_DAYS} days</option>
              <option value="week">Ends within 7 days</option>
            </select>
            <select
              aria-label="Activation"
              value={signal}
              disabled={!signalsAvailable}
              title={!signalsAvailable ? "The activation signals could not be read" : undefined}
              onChange={(event) => {
                setSignal(event.target.value as SignalFilter);
                setPage(1);
              }}
              className={toolbarControl}
            >
              <option value="any">Any activation</option>
              <option value="no_leads">No leads imported</option>
              <option value="no_team">No second user</option>
              <option value="no_carrier">No carrier added</option>
              <option value="neither">Neither leads nor a second user</option>
            </select>
            <select
              aria-label="Card on file"
              value={card}
              onChange={(event) => {
                setCard(event.target.value as CardFilter);
                setPage(1);
              }}
              className={toolbarControl}
            >
              <option value="any">Any card status</option>
              <option value="card">Card on file</option>
              <option value="no_card">No card on file</option>
            </select>
            {anyFilter && (
              <Button type="button" variant="ghost" onClick={clearAll}>
                Clear
              </Button>
            )}
          </DataToolbar>
        }
      >
          <table className={cn(st.table, "min-w-[860px]")}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={st.th}>Tenant</th>
                <th scope="col" className={cn(st.th, "w-[110px]")}>Plan</th>
                <th scope="col" className={cn(st.th, "w-[110px]")}>Started</th>
                <th scope="col" className={cn(st.th, "w-[110px]")}>Ends</th>
                <th scope="col" className={cn(st.th, "w-[110px] text-right")}>Days left</th>
                <th scope="col" className={cn(st.th, "w-[280px]")}>Activation signals</th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {listError && (
                <tr>
                  <td colSpan={6} className="border-t border-[var(--border)] p-0">
                    <ErrorState
                      title="The trials could not be read"
                      detail="The list of trials in flight did not load. Reload the page; if it keeps failing, the error is in the server log."
                    />
                  </td>
                </tr>
              )}
              {!listError && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="border-t border-[var(--border)] p-0">
                    <EmptyState
                      title="No trials in flight"
                      hint="A trial appears here the moment a tenant starts one."
                    />
                  </td>
                </tr>
              )}
              {rows.length > 0 && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="border-t border-[var(--border)] p-0">
                    <NoMatches noun="trials" onClear={clearAll} />
                  </td>
                </tr>
              )}
              {shown.map((row) => {
                const expanded = open === row.subscriptionId;
                const detailId = `${id}-detail-${row.subscriptionId}`;
                return (
                  <Fragment key={row.subscriptionId}>
                    <tr
                      className={cn("m-row cursor-pointer hover:bg-[var(--brand-50)]", expanded && "bg-[var(--brand-50)]")}
                      onClick={() => setOpen(expanded ? null : row.subscriptionId)}
                    >
                      <td className={st.td}>
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-controls={detailId}
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpen(expanded ? null : row.subscriptionId);
                          }}
                          title={row.ownerEmail ? `Owner: ${row.ownerEmail}` : undefined}
                          className="cursor-pointer rounded-sm border-0 bg-transparent p-0 text-left text-inherit hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                        >
                          {row.displayName}
                        </button>
                      </td>
                      <td className={st.td}>{row.planName}</td>
                      <td className={st.td}>
                        <TrialDate iso={row.startedAt} text={row.startedLabel} full={row.startedFull} />
                      </td>
                      <td className={st.td}>
                        <TrialDate iso={row.trialEndsAt} text={row.endsLabel} full={row.endsFull} />
                      </td>
                      <td
                        className={cn(st.td, st.num)}
                        title={row.overdue ? "The trial end has passed; the subscription is still marked as on trial" : undefined}
                      >
                        {row.daysLeft}
                      </td>
                      <td className={st.td}>
                        <SignalPills row={row} />
                      </td>
                    </tr>
                    {expanded && (
                      <tr id={detailId} className="bg-[var(--canvas)]">
                        <td colSpan={6} className="border-t border-[var(--border)] px-4 py-4">
                          <TrialDetail
                            row={row}
                            canManage={canManage}
                            busy={busy}
                            onExtend={() => setPending({ trial: row, kind: "extend" })}
                            onConvert={() => setPending({ trial: row, kind: "convert" })}
                            onCancel={() => setPending({ trial: row, kind: "cancel" })}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        <BoardTableFooter
          page={current}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          itemLabel="trials"
          order="fewest days remaining first"
          onPageChange={setPage}
        />
      </TableCard>

      <Dialog open={pending !== null} onOpenChange={(value) => !value && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.kind === "extend" ? "Extend" : pending?.kind === "convert" ? "Convert" : "Cancel"} the trial for{" "}
              {pending?.trial.displayName}
            </DialogTitle>
            <DialogDescription>
              {pending?.kind === "extend"
                ? "Pushes the charge date and every reminder with it, here and at the payment provider."
                : pending?.kind === "convert"
                  ? "Ends the trial now by charging the card on file for the plan's price. The payment webhook turns the subscription active when the charge succeeds."
                  : "Stops the provider collecting and ends the trial. The reason is recorded."}
            </DialogDescription>
          </DialogHeader>

          {pending?.kind !== "convert" && (
            <div className="space-y-3">
              {pending?.kind === "extend" && (
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-days`}>Extend by (days)</Label>
                  <Input
                    id={`${id}-days`}
                    inputMode="numeric"
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    aria-describedby={`${id}-days-hint`}
                  />
                  <p id={`${id}-days-hint`} className="text-[12px] leading-[1.5] text-[var(--muted)]">
                    Between 1 and 90 whole days.
                  </p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-reason`}>Reason</Label>
                <Input
                  id={`${id}-reason`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={pending?.kind === "extend" ? "Onboarding call slipped a week" : "Customer asked to stop"}
                />
                <p className="text-[12px] leading-[1.5] text-[var(--muted)]">At least 5 characters. Recorded in the audit log.</p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeDialog} disabled={busy}>
              Close
            </Button>
            <Button
              type="button"
              disabled={
                busy ||
                (pending?.kind === "extend" && (!reasonValid || !daysValid)) ||
                (pending?.kind === "cancel" && !reasonValid)
              }
              onClick={() => {
                if (!pending) return;
                if (pending.kind === "extend") {
                  void act(pending.trial, { action: "extend", days: daysNumber, reason: reason.trim() }, "Trial extended");
                } else if (pending.kind === "convert") {
                  void act(pending.trial, { action: "convert" }, "Charged — the payment webhook will convert it");
                } else {
                  void act(pending.trial, { action: "cancel", reason: reason.trim() }, "Trial cancelled");
                }
              }}
            >
              {busy
                ? "Working…"
                : pending?.kind === "extend"
                  ? "Extend trial"
                  : pending?.kind === "convert"
                    ? "Charge and convert"
                    : "Cancel trial"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The three activation pills: green when reached, grey when not, with when on hover. */
function SignalPills({ row }: { row: TrialBoardRow }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {SIGNAL_KEYS.map((key) => {
        const done = row.signals?.[key] ?? false;
        const title = !row.signals
          ? `${SIGNAL_MEANINGS[key]}: could not be read`
          : done
            ? `${SIGNAL_MEANINGS[key]} · ${row.signalDates[key] ?? ""}`
            : `${SIGNAL_MEANINGS[key]}: not yet`;
        return (
          <span key={key} title={title}>
            <Pill tone={done ? "success" : "neutral"}>
              {SIGNAL_LABELS[key]}
              <span className="sr-only">{!row.signals ? " unknown" : done ? " done" : " not yet"}</span>
            </Pill>
          </span>
        );
      })}
    </span>
  );
}

/** What opens under a row: the facts the old table showed as columns, and the actions. */
function TrialDetail({
  row,
  canManage,
  busy,
  onExtend,
  onConvert,
  onCancel,
}: {
  row: TrialBoardRow;
  canManage: boolean;
  busy: boolean;
  onExtend: () => void;
  onConvert: () => void;
  onCancel: () => void;
}) {
  const total = row.daysElapsed + row.daysLeft;
  const facts: { label: string; value: ReactNode }[] = [
    {
      label: "Owner",
      value: row.ownerEmail ? (
        <span title={row.ownerName ? `${row.ownerName} · ${row.ownerEmail}` : row.ownerEmail}>{row.ownerEmail}</span>
      ) : (
        "No owner yet"
      ),
    },
    {
      label: "Owner sign-in",
      value: (
        <span title={row.lastLoginFull ? `Last signed in ${row.lastLoginFull}` : "The owner has never signed in"}>
          <Pill tone={ENGAGEMENT_TONE[row.engagement.level]}>{row.engagement.label}</Pill>
        </span>
      ),
    },
    { label: "Trial day", value: `Day ${row.daysElapsed} of ${total}` },
    {
      label: "Card on file",
      value: row.hasPaymentMethod ? (
        <Pill tone="success">Card on file</Pill>
      ) : (
        <Pill tone="warning">No card on file</Pill>
      ),
    },
    { label: "Started", value: <TrialDate iso={row.startedAt} text={row.startedFull} full={row.startedFull} /> },
    { label: "Ends", value: <TrialDate iso={row.trialEndsAt} text={row.endsFull} full={row.endsFull} /> },
    { label: "Billing", value: <span className="capitalize">{row.billingCycle}</span> },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">{fact.label}</dt>
            <dd className="m-0 mt-1 truncate text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--ink)] tabular-nums">{fact.value}</dd>
          </div>
        ))}
      </dl>

      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
        {SIGNAL_KEYS.map((key) => (
          <li key={key}>
            <span className="font-semibold text-[var(--ink)]">{SIGNAL_LABELS[key]}</span> — {SIGNAL_MEANINGS[key].toLowerCase()}:{" "}
            {!row.signals ? "could not be read" : row.signals[key] ? row.signalDates[key] : "not yet"}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        {canManage ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={onExtend} disabled={busy}>
              Extend trial
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onConvert}
              disabled={busy || !row.hasPaymentMethod}
              aria-describedby={row.hasPaymentMethod ? undefined : `convert-reason-${row.subscriptionId}`}
            >
              Convert now
            </Button>
            <Button type="button" variant="outline" size="sm" className="text-[var(--error-ink)]" onClick={onCancel} disabled={busy}>
              Cancel trial
            </Button>
          </>
        ) : (
          <span className="text-[12px] leading-[1.5] text-[var(--muted)]">Only super admins and billing admins can change a trial.</span>
        )}
        <Link
          href={`/admin/tenants/${row.tenantId}`}
          className="ml-auto rounded-sm text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--accent-ink)] no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
        >
          Open tenant record
        </Link>
      </div>
      {canManage && !row.hasPaymentMethod && (
        <p id={`convert-reason-${row.subscriptionId}`} className="m-0 text-[12px] leading-[1.5] text-[var(--muted)]">
          Convert now is off: there is no card on file to charge.
        </p>
      )}
    </div>
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
  return (
    <time ref={ref} dateTime={iso} title={full} className="whitespace-nowrap">
      {text}
    </time>
  );
}

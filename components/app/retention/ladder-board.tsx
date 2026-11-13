"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ActiveFilters, ClearFiltersButton, DataToolbar, FilterField, FilterPopover, RefreshButton, ToolbarSearch, toolbarControl, type ActiveFilter } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { HoverPeek } from "@/components/ui/hover-peek";
import { Pager, paginate } from "@/components/ui/pager";
import { TableCard } from "@/components/ui/table-card";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { LinkRow } from "@/components/app/book/setup/link-row";
import { whyLine } from "@/components/app/retention/ladder-mark";
import { personName } from "@/lib/format/personName";
import { fileDay } from "@/lib/ingestion/constants";
import { CLOSED_DAYS, REASON_LABELS, STEP_LABELS, type Reason } from "@/lib/retention/cases/ladder";
import { GROUP_LABELS, TOUCHES, byPerson, caseHref, filterCases, groupOf, parseListFilters, visibleCases, type Group, type ListFilters, type Touch } from "@/lib/retention/cases/listOrder";
import { CONTACT_OUTCOME_LABELS, type ContactOutcome } from "@/lib/retention/constants";
import type { CaseRow, Ladder } from "@/lib/retention/cases/store";

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const cents2 = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const phoneText = (raw: string) => {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
};

/**
 * Retention › Cases (round 7, owner pick 1·A, 2026-11-10; docs/la4/mockups-r7/retention.html). The ladder's steps
 * are the tabs on the title line (the page draws them); here, the step's cases fill the window, grouped by urgency.
 * A row is a link to its case: no button in it, the next step said in words. Quick filters are chips on the
 * toolbar (Mine · Past due · This week · No carrier window · No phone · Opened by a person); the rest are in
 * Filters. A search looks across every step. "Work the next case" (the title line) opens this list's first case.
 */
export function LadderBoard({ data, isOwner, viewerId }: { data: Ladder; isOwner: boolean; viewerId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const f = parseListFilters((key) => params.get(key));
  const hrefWith = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) if (value) next.set(key, value); else next.delete(key);
    return next.size ? `${pathname}?${next}` : pathname;
  };
  const setParam = (changes: Record<string, string | null>) => { setPage(1); router.replace(hrefWith(changes), { scroll: false }); };
  const toggle = (key: keyof ListFilters, value: string) => setParam({ [key]: f[key] === value ? null : value });

  const rows = data.open;
  const owners = useMemo(() => [...new Map(rows.filter((r) => r.ownerId).map((r) => [r.ownerId!, r.ownerName ?? ""])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const carriers = useMemo(() => [...new Map(rows.map((r) => [r.carrierId, r.carrierName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const reasons = useMemo(() => [...new Set(rows.map((r) => r.reason))].sort(), [rows]);
  const needle = search.trim().toLowerCase();
  const visible = useMemo(() => visibleCases(rows, f, viewerId, needle), [rows, f.step, f.owner, f.carrier, f.reason, f.deadline, f.touch, f.phone, f.by, f.all, viewerId, needle]); // eslint-disable-line react-hooks/exhaustive-deps
  // A chip's count: this tab's cases under every other filter, with the chip's own one set.
  // A search, or a reason link with no step (?reason= from Settings), looks across every step.
  const across = Boolean(needle) || f.all;
  const chipCount = (changes: Partial<ListFilters>) => filterCases((across ? rows : rows.filter((r) => r.step === f.step)), { ...f, ...changes }, viewerId).length;
  const grouped = !across && f.step !== "lost" && f.step !== "paperwork";
  const groupCount = (g: Group) => visible.filter((r) => groupOf(r) === g).length;
  const atStake = visible.reduce((sum, r) => sum + (r.monthlyCents ?? 0), 0);
  const pageSize = useFittingPageSize(400, 45);
  const shown = paginate(visible, page, pageSize);

  const chips: ActiveFilter[] = [
    ...(f.owner && f.owner !== "me" ? [{ key: "owner", label: "Owner", value: owners.find(([id]) => id === f.owner)?.[1] ?? "Someone", onRemove: () => setParam({ owner: null }) }] : []),
    ...(f.carrier ? [{ key: "carrier", label: "Carrier", value: carriers.find(([id]) => id === f.carrier)?.[1] ?? "Carrier", onRemove: () => setParam({ carrier: null }) }] : []),
    ...(f.reason ? [{ key: "reason", label: "Why", value: REASON_LABELS[f.reason as Reason] ?? f.reason, onRemove: () => setParam({ reason: null }) }] : []),
    ...(f.touch ? [{ key: "touch", label: "Last touch", value: TOUCHES[f.touch], onRemove: () => setParam({ touch: null }) }] : []),
  ];
  const anyFilter = Boolean(f.owner || f.carrier || f.reason || f.deadline || f.touch || f.phone || f.by);
  const clear = () => { setSearch(""); setParam({ owner: null, carrier: null, reason: null, deadline: null, touch: null, phone: null, by: null }); };
  const people = rows.filter(byPerson).length;

  if (f.step === "closed" && !across) return <ClosedTable rows={data.closed} />;

  return (
    <TableCard
      className="lg:flex-1"
      toolbar={
        <DataToolbar actions={<>
          {/* The tab's money, said once (it was on the ladder cards). */}
          {visible.length > 0 && f.step !== "lost" && f.step !== "paperwork" && <span className="whitespace-nowrap text-sm text-foreground tabular-nums">{money(atStake)}/mo at stake</span>}
          {(anyFilter || needle) && <ClearFiltersButton onClick={clear} />}
          <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
        </>}>
          <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Client, policy or phone" />
          <ToggleChip selected={f.owner === "me"} onClick={() => toggle("owner", "me")} count={chipCount({ owner: "me" })}>Mine</ToggleChip>
          {f.step !== "lost" && f.step !== "paperwork" && <>
            <ToggleChip selected={f.deadline === "over"} onClick={() => toggle("deadline", "over")} count={chipCount({ deadline: "over" })} countTone="danger">Past due</ToggleChip>
            <ToggleChip selected={f.deadline === "week"} onClick={() => toggle("deadline", "week")} count={chipCount({ deadline: "week" })} countTone="warning">This week</ToggleChip>
            <ToggleChip selected={f.deadline === "none"} onClick={() => toggle("deadline", "none")} count={chipCount({ deadline: "none" })}>No carrier window</ToggleChip>
          </>}
          <ToggleChip selected={f.phone === "none"} onClick={() => toggle("phone", "none")} count={chipCount({ phone: "none" })} countTone="warning">No phone</ToggleChip>
          {(people > 0 || f.by) && <ToggleChip selected={f.by === "person"} onClick={() => toggle("by", "person")} count={chipCount({ by: "person" })}>Opened by a person</ToggleChip>}
          {/* The rest are a pop-over over the table; applied ones are chips on this line (owner 2026-11-06). */}
          <FilterPopover count={chips.length} onClear={clear}>
            {isOwner && owners.length > 1 && <FilterField label="Owner" htmlFor="ld-owner"><select id="ld-owner" className={toolbarControl} value={f.owner === "me" ? "" : f.owner} onChange={(e) => setParam({ owner: e.target.value || null })}>
              <option value="">Everyone</option>
              {owners.map(([id, name]) => <option key={id} value={id}>{id === viewerId ? `${name} (you)` : name}</option>)}
            </select></FilterField>}
            {carriers.length > 1 && <FilterField label="Carrier" htmlFor="ld-carrier"><select id="ld-carrier" className={toolbarControl} value={f.carrier} onChange={(e) => setParam({ carrier: e.target.value || null })}>
              <option value="">All carriers</option>
              {carriers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select></FilterField>}
            <FilterField label="Why" htmlFor="ld-reason"><select id="ld-reason" className={toolbarControl} value={f.reason} onChange={(e) => setParam({ reason: e.target.value || null })}>
              <option value="">Any reason</option>
              {reasons.map((r) => <option key={r} value={r}>{REASON_LABELS[r]}</option>)}
            </select></FilterField>
            <FilterField label="Last touch" htmlFor="ld-touch"><select id="ld-touch" className={toolbarControl} value={f.touch} onChange={(e) => setParam({ touch: e.target.value || null })}>
              <option value="">Any</option>
              {(Object.keys(TOUCHES) as Touch[]).map((t) => <option key={t} value={t}>{TOUCHES[t]}</option>)}
            </select></FilterField>
          </FilterPopover>
          <ActiveFilters inline filters={chips} onClear={clear} />
        </DataToolbar>
      }
      footer={visible.length ? (
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">{across ? "Every step, in working order · from the carrier files" : grouped ? "By urgency: past due, this week, later, no carrier window · from the carrier files" : "Highest step first, then the nearest deadline · from the carrier files"}</span>
          <Pager page={shown.current} pageSize={pageSize} total={visible.length} noun="cases" onPage={setPage} />
        </div>
      ) : undefined}
    >
      {rows.length === 0 ? (
        <EmptyState title="Nothing needs care" hint="A policy shows here when an uploaded policy or commission file shows a missed payment, a lapse, a chargeback or paperwork." />
      ) : visible.length === 0 ? (
        <NoMatches noun="cases" onClear={clear} />
      ) : (
        <table className="portal-lead-table w-full text-left text-sm">
          <thead>
            <tr>
              <th>Client</th>
              <th>Why</th>
              <th className="text-right">$/mo</th>
              <th>{f.step === "lost" && !across ? "Lost since" : "Deadline"}</th>
              <th>Last touch</th>
              <th>Next step</th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {shown.rows.map((r, i) => {
              const g = groupOf(r);
              const head = grouped && (i === 0 || groupOf(shown.rows[i - 1]) !== g);
              return (
                <Fragment key={r.id}>
                  {head && (
                    <tr aria-label={`${GROUP_LABELS[g]}: ${groupCount(g)} cases`}>
                      <td colSpan={6} className="bg-[var(--surface-alt)] py-1.5">
                        <span className="inline-flex items-center gap-2 text-xs font-semibold text-foreground">
                          {GROUP_LABELS[g]}
                          <span className="tabular-nums">{groupCount(g).toLocaleString("en-US")}</span>
                        </span>
                      </td>
                    </tr>
                  )}
                  <Row r={r} f={f} isOwner={isOwner} viewerId={viewerId} acrossSteps={across} />
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

const OUTCOME: Record<string, { label: string; tone: StatusTone }> = {
  saved: { label: "Saved", tone: "good" },
  lost: { label: "Lost", tone: "danger" },
  closed_no_save: { label: "Closed without a save", tone: "neutral" },
};

/** The Closed tab: what left Retention in the last 90 days, and how (a file's save, a loss, or a person's close). */
function ClosedTable({ rows }: { rows: CaseRow[] }) {
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(400, 45);
  const shown = paginate(rows, page, pageSize);
  return (
    <TableCard className="lg:flex-1" footer={rows.length ? (
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">Closed in the last {CLOSED_DAYS} days, newest first · saved only when a carrier file proved it</span>
        <Pager page={shown.current} pageSize={pageSize} total={rows.length} noun="cases" onPage={setPage} />
      </div>
    ) : undefined}>
      {rows.length === 0 ? (
        <EmptyState title="Nothing closed yet" hint={`A case shows here for ${CLOSED_DAYS} days after it leaves Retention: saved when a later file shows it fixed, lost when the files show it gone, or closed without a save by a person.`} />
      ) : (
        <table className="portal-lead-table w-full text-left text-sm">
          <thead><tr><th>Client</th><th>Policy</th><th>It was</th><th>How it ended</th><th className="w-[140px] text-right">Closed</th></tr></thead>
          <tbody className="m-seq">
            {shown.rows.map((r) => {
              const outcome = OUTCOME[r.status] ?? { label: r.status, tone: "neutral" as StatusTone };
              return (
                <LinkRow key={r.id} href={`/app/retention/${r.id}?tab=history`} className="m-row">
                  <td className="whitespace-nowrap font-medium text-foreground"><Link href={`/app/retention/${r.id}?tab=history`} className="underline-offset-2 hover:underline">{r.clientName ? personName(r.clientName) : "No client linked"}</Link></td>
                  <td className="whitespace-nowrap"><Link href={`/app/policies/carrier/${r.carrierId}/${encodeURIComponent(r.policyNumber)}`} className="text-foreground hover:underline">{r.carrierName} {r.policyNumber}</Link></td>
                  <td className="whitespace-nowrap" title={STEP_LABELS[r.step]}>{REASON_LABELS[r.reason]}</td>
                  <td><StatusChip tone={outcome.tone} title={r.outcomeReason ?? undefined}>{outcome.label}</StatusChip></td>
                  <td className="whitespace-nowrap text-right tabular-nums text-muted-foreground">{r.resolvedAt ? fileDay(r.resolvedAt.slice(0, 10)) : "—"}</td>
                </LinkRow>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

/** Urgent: past its date or inside 3 days (critique B2): the row's deadline chip reads danger. */
export const isUrgent = (r: Pick<CaseRow, "daysLeft" | "step" | "status">) =>
  r.status !== "waiting_on_carrier" && r.step !== "lost" && r.step !== "paperwork" && r.daysLeft !== null && r.daysLeft <= 3;

/** What is owed now, in words: the month due, the first premium, or the carrier's quote for a lapse. */
function owedText(r: CaseRow): string | null {
  if (r.step === "lapsed_reinstatable") return "back premium: ask";
  if (r.step === "lost" || r.step === "paperwork" || r.monthlyCents === null) return null;
  return r.reason === "first_draft_failed" ? "first premium due" : "1 month due";
}
/** What the agency loses if it dies: the chargeback already taken, else the unearned advance. */
function stakeText(r: CaseRow): string | null {
  const cb = r.evidence?.chargeback;
  if (cb?.amount_cents) return `${money(Math.abs(Number(cb.amount_cents)))} charged back`;
  return r.atRiskCents ? `${money(r.atRiskCents)} advance` : null;
}
function touchText(r: CaseRow): string {
  if (r.lastCall) return `${CONTACT_OUTCOME_LABELS[r.lastCall.outcome as ContactOutcome] ?? "Called"} · ${fileDay(r.lastCall.at.slice(0, 10))}`;
  if (r.lastContactAt) return `Called · ${fileDay(r.lastContactAt.slice(0, 10))}`;
  return "Not called yet";
}

/** The row's next step as one short verb (owner 2026-11-11); the full sentence is its tooltip. */
const NEXT_VERB: Record<Reason, string> = {
  first_draft_failed: "Call", later_draft_failed: "Call", bounced_draft: "Fix", banking_problem: "Fix",
  pending_lapse: "Call", lapse_notice: "Call", lapsed_reinstatable: "Reinstate",
  lapsed_lost: "Close", chargeback: "Close",
  cancellation_request: "Call", pending_manual_action: "Review", payment_date_change: "Change", mailed_bill: "Switch",
};

/**
 * The deadline as the row's one chip (owner 2026-11-11: colour only in a chip). A passed one reads "Window closed"
 * (round 7): the case is still on the ladder, so the carrier hasn't closed the policy yet; ask the carrier.
 */
function deadlineState(r: CaseRow): { text: string; tone: StatusTone; title: string } | null {
  if (r.daysLeft === null || !r.deadline) return null;
  const day = fileDay(r.deadline);
  if (r.daysLeft < 0) return { text: "Window closed", tone: "danger", title: `The carrier's window closed ${day}; its files still show the policy. Ask the carrier where it stands.` };
  const tone: StatusTone = r.status === "waiting_on_carrier" ? "neutral" : isUrgent(r) ? "danger" : r.daysLeft <= 7 ? "warning" : "neutral";
  return { text: r.daysLeft === 0 ? "Due today" : `${r.daysLeft} ${r.daysLeft === 1 ? "day" : "days"} left`, tone, title: day };
}

function Row({ r, f, isOwner, viewerId, acrossSteps }: { r: CaseRow; f: ListFilters; isOwner: boolean; viewerId: string; acrossSteps: boolean }) {
  const href = caseHref(r.id, f);
  const name = r.clientName ? personName(r.clientName) : "No client linked";
  const why = whyLine(r.reason, r.evidence);
  const owed = owedText(r);
  const stake = stakeText(r);
  const product = [r.product, r.faceCents ? `$${Math.round(r.faceCents / 100).toLocaleString("en-US")}` : null].filter(Boolean).join(" · ");
  const waiting = r.status === "waiting_on_carrier";
  const next = waiting ? "Check the case" : r.nextAction;
  const chip = deadlineState(r);
  // The second lines that went (owner 2026-11-11: one line per row) are the cells' tooltips.
  const nameTitle = [`${r.carrierName} ${r.policyNumber}`, product, r.phone ? phoneText(r.phone) : "No phone on file"].filter(Boolean).join(" · ");
  const whose = isOwner ? (r.ownerId ? (r.ownerId === viewerId ? "you" : r.ownerName ?? "someone") : "nobody yet") : null;
  const touchTitle = [r.contactAttempts > 0 ? `${r.contactAttempts} ${r.contactAttempts === 1 ? "try" : "tries"}` : null, whose ? `owner: ${whose}` : null].filter(Boolean).join(" · ");
  return (
    <LinkRow href={href} className="m-row">
      <td className="whitespace-nowrap font-medium text-foreground">
        {/* The name is the case page; resting on it shows a read-only peek of the facts one line leaves out. */}
        <HoverPeek trigger={<Link href={href} className="underline-offset-2 hover:underline">{name}</Link>}>
          <b className="text-sm text-foreground">{name} · {STEP_LABELS[r.step]}</b>
          <span className="text-foreground">{nameTitle}</span>
          <span className="text-muted-foreground">Last: {touchText(r)}{r.contactAttempts ? ` · ${r.contactAttempts} ${r.contactAttempts === 1 ? "try" : "tries"}` : ""}</span>
        </HoverPeek>
      </td>
      <td className="whitespace-nowrap" title={`${acrossSteps ? `${STEP_LABELS[r.step]} · ` : ""}${why}${waiting ? " · with the carrier" : ""}`}>{REASON_LABELS[r.reason]}</td>
      <td className="whitespace-nowrap text-right tabular-nums" title={[owed, stake].filter(Boolean).join(" · ") || undefined}>{r.monthlyCents === null ? <span className="text-muted-foreground">—</span> : cents2(r.monthlyCents)}</td>
      <td className="whitespace-nowrap">
        {r.step === "lost"
          ? <span className="tabular-nums text-muted-foreground" title="Lost since, then win-back">{fileDay(r.stepChangedAt.slice(0, 10))}</span>
          : chip ? <StatusChip tone={chip.tone} title={chip.title}>{chip.text}</StatusChip>
            : <span className="text-muted-foreground" title="No carrier window">—</span>}
      </td>
      <td className="whitespace-nowrap" title={touchTitle || undefined}>{r.unreachable ? "Unreachable" : touchText(r)}</td>
      {/* The next step as a short verb (no button in the row); the sentence is its tooltip. */}
      <td className="whitespace-nowrap" title={next}>{waiting ? "Check" : NEXT_VERB[r.reason] ?? "Open"} ›</td>
    </LinkRow>
  );
}

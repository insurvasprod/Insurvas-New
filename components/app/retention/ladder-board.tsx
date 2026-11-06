"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ActiveFilters, ClearFiltersButton, DataToolbar, FilterField, FilterPopover, RefreshButton, ToolbarSearch, toolbarControl, type ActiveFilter } from "@/components/ui/data-toolbar";
import { HoverPeek } from "@/components/ui/hover-peek";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { LadderMark, whyLine } from "@/components/app/retention/ladder-mark";
import { LEVEL_INK, RiskCards, type RiskCard } from "@/components/app/retention/risk-cards";
import { personName } from "@/lib/format/personName";
import { fileDay } from "@/lib/ingestion/constants";
import { CLOSED_DAYS, REASON_LABELS, STEP_LABELS, STEP_SLUG, stepFromSlug, type Reason, type Step } from "@/lib/retention/cases/ladder";
import { CONTACT_OUTCOME_LABELS, type ContactOutcome } from "@/lib/retention/constants";
import type { CaseRow, Ladder } from "@/lib/retention/cases/store";

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const cents2 = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const phoneText = (raw: string) => {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
};

/** The urgency groups inside a step (owner pick 2026-11-06, "table B"): what to do first is the first group. */
type Group = "over" | "week" | "later" | "none";
const GROUPS: Array<{ key: Group; label: string; ink: string }> = [
  { key: "over", label: "Past due", ink: "var(--error-ink)" },
  { key: "week", label: "Due this week", ink: "var(--warning-ink)" },
  { key: "later", label: "Later", ink: "var(--success-ink)" },
  { key: "none", label: "No carrier window", ink: "var(--muted-foreground)" },
];
const groupOf = (r: Pick<CaseRow, "daysLeft">): Group => (r.daysLeft === null ? "none" : r.daysLeft < 0 ? "over" : r.daysLeft <= 7 ? "week" : "later");
const LADDER: Array<{ step: Step; level: 1 | 2 | 3 | 4; tag: string }> = [
  { step: "payment_problem", level: 1, tag: "Fixable" },
  { step: "pending_lapse", level: 2, tag: "Act now" },
  { step: "lapsed_reinstatable", level: 3, tag: "Last chance" },
  { step: "lost", level: 4, tag: "Gone" },
];
const DEADLINES = { over: "Past due", week: "Due this week", later: "Later", none: "No carrier window" } as const;
const TOUCHES = { never: "Not called yet", called: "Called", unreachable: "Unreachable" } as const;

/**
 * Retention › Cases (owner 2026-11-05, pick A; docs/retention/SPEC.md; round 3 2026-11-06: header A + table B).
 * On top the risk ladder: four cards, each heavier than the last (Fixable › Act now › Last chance › Gone), with
 * the count, the money at stake and what in it is past due; Paperwork and Closed beside it. A card is the step
 * (`?step=`). Under it, the step's cases grouped by urgency, each row: who and which policy, the risk point and
 * why, the money, the deadline, the last touch and the next action. Nothing opens inside the table: the name is
 * the case page (with a read-only peek on hover), and Filters is a pop-over.
 */
export function LadderBoard({ data, isOwner, viewerId }: { data: Ladder; isOwner: boolean; viewerId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const step = stepFromSlug(params.get("step"));
  const owner = params.get("owner") ?? "";
  const carrier = params.get("carrier") ?? "";
  const reason = params.get("reason") ?? "";
  const deadline = (params.get("deadline") ?? "") as Group | "";
  const touch = (params.get("touch") ?? "") as keyof typeof TOUCHES | "";
  const hrefWith = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) if (value) next.set(key, value); else next.delete(key);
    return next.size ? `${pathname}?${next}` : pathname;
  };
  const setParam = (changes: Record<string, string | null>) => { setPage(1); router.replace(hrefWith(changes), { scroll: false }); };

  const rows = data.open;
  const owners = useMemo(() => [...new Map(rows.filter((r) => r.ownerId).map((r) => [r.ownerId!, r.ownerName ?? ""])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const carriers = useMemo(() => [...new Map(rows.map((r) => [r.carrierId, r.carrierName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const reasons = useMemo(() => [...new Set(rows.map((r) => r.reason))].sort(), [rows]);
  const needle = search.trim().toLowerCase();
  // "me" is the viewer (the title line's Mine tab).
  const ownerId = owner === "me" ? viewerId : owner;
  const touchOf = (r: CaseRow): keyof typeof TOUCHES => (r.unreachable ? "unreachable" : r.lastContactAt || r.lastCall ? "called" : "never");
  // Everything but the step: the cards count what the filters leave, so a card never promises rows it won't show.
  const filtered = useMemo(() => rows.filter((r) => (!ownerId || r.ownerId === ownerId) && (!carrier || r.carrierId === carrier) && (!reason || r.reason === reason)
    && (!deadline || groupOf(r) === deadline) && (!touch || touchOf(r) === touch)
    && (!needle || [r.clientName, r.policyNumber, r.phone, r.carrierName].some((v) => v?.toLowerCase().includes(needle)))), [rows, ownerId, carrier, reason, deadline, touch, needle]);
  // Inside a step, by urgency; the step order and nearest deadline (caseOrder) hold inside each group.
  const visible = useMemo(() => {
    const these = filtered.filter((r) => !step || r.step === step);
    const order = GROUPS.map((g) => g.key);
    return step === "lost" || step === "paperwork" ? these : [...these].sort((a, b) => order.indexOf(groupOf(a)) - order.indexOf(groupOf(b)));
  }, [filtered, step]);
  const grouped = step !== "lost" && step !== "paperwork";
  const groupCount = (g: Group) => visible.filter((r) => groupOf(r) === g).length;
  const pageSize = useFittingPageSize(470, 57);
  const shown = paginate(visible, page, pageSize);

  const chips: ActiveFilter[] = [
    ...(owner && owner !== "me" ? [{ key: "owner", label: "Owner", value: owners.find(([id]) => id === owner)?.[1] ?? "Someone", onRemove: () => setParam({ owner: null }) }] : []),
    ...(carrier ? [{ key: "carrier", label: "Carrier", value: carriers.find(([id]) => id === carrier)?.[1] ?? "Carrier", onRemove: () => setParam({ carrier: null }) }] : []),
    ...(reason ? [{ key: "reason", label: "Why", value: REASON_LABELS[reason as Reason] ?? reason, onRemove: () => setParam({ reason: null }) }] : []),
    ...(deadline ? [{ key: "deadline", label: "Deadline", value: DEADLINES[deadline], onRemove: () => setParam({ deadline: null }) }] : []),
    ...(touch ? [{ key: "touch", label: "Last touch", value: TOUCHES[touch], onRemove: () => setParam({ touch: null }) }] : []),
  ];
  const clear = () => { setSearch(""); setParam({ owner: owner === "me" ? "me" : null, carrier: null, reason: null, deadline: null, touch: null }); };

  // The ladder: each card is the step's link; clicking the open one shows every step again.
  const cards: RiskCard[] = LADDER.map(({ step: s, level, tag }) => {
    const these = filtered.filter((r) => r.step === s);
    const split = { over: these.filter((r) => groupOf(r) === "over").length, week: these.filter((r) => groupOf(r) === "week").length, later: these.filter((r) => groupOf(r) === "later").length, none: these.filter((r) => groupOf(r) === "none").length };
    const atStake = these.reduce((sum, r) => sum + (r.monthlyCents ?? 0), 0);
    return {
      key: s, level, tag, name: STEP_LABELS[s], count: these.length, ink: LEVEL_INK[level],
      line: s === "lost" ? "this month" : `${money(atStake)}/mo at stake`,
      split: s === "lost" ? undefined : split,
      foot: s === "lost" ? "close them to win-back" : [split.over && `${split.over.toLocaleString("en-US")} past due`, split.week && `${split.week} this week`, split.none && `${split.none.toLocaleString("en-US")} no window`].filter(Boolean).join(" · ") || "nothing due yet",
      warn: split.over > 0, on: step === s, href: hrefWith({ step: step === s ? null : STEP_SLUG[s] }),
    };
  });
  const paperwork = filtered.filter((r) => r.step === "paperwork").length;
  const closedView = params.get("step") === "closed";

  return (
    <>
      <RiskCards label="Risk ladder" cards={cards} side={[
        { key: "paperwork", label: "Paperwork", count: paperwork, line: "beside the ladder", ink: "var(--info-ink)", href: hrefWith({ step: step === "paperwork" ? null : "paperwork" }), on: step === "paperwork" },
        { key: "closed", label: "Closed", count: data.closed.length, line: `${data.savedThisMonth.count} saved this month`, ink: "var(--success-ink)", href: hrefWith({ step: closedView ? null : "closed" }), on: closedView },
      ]} />

      {closedView ? <ClosedTable rows={data.closed} /> : (
      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {(chips.length > 0 || needle) && <ClearFiltersButton onClick={clear} />}
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>}>
            <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Client, policy or phone" />
            {/* Filters is a pop-over over the table; applied ones are chips on this line (owner 2026-11-06). */}
            <FilterPopover count={chips.length} onClear={clear}>
              {isOwner && owners.length > 1 && <FilterField label="Owner" htmlFor="ld-owner"><select id="ld-owner" className={toolbarControl} value={owner === "me" ? "" : owner} onChange={(e) => setParam({ owner: e.target.value || null })}>
                <option value="">Everyone</option>
                {owners.map(([id, name]) => <option key={id} value={id}>{id === viewerId ? `${name} (you)` : name}</option>)}
              </select></FilterField>}
              {carriers.length > 1 && <FilterField label="Carrier" htmlFor="ld-carrier"><select id="ld-carrier" className={toolbarControl} value={carrier} onChange={(e) => setParam({ carrier: e.target.value || null })}>
                <option value="">All carriers</option>
                {carriers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select></FilterField>}
              <FilterField label="Why" htmlFor="ld-reason"><select id="ld-reason" className={toolbarControl} value={reason} onChange={(e) => setParam({ reason: e.target.value || null })}>
                <option value="">Any reason</option>
                {reasons.map((r) => <option key={r} value={r}>{REASON_LABELS[r]}</option>)}
              </select></FilterField>
              <FilterField label="Deadline" htmlFor="ld-deadline"><select id="ld-deadline" className={toolbarControl} value={deadline} onChange={(e) => setParam({ deadline: e.target.value || null })}>
                <option value="">Any</option>
                {(Object.keys(DEADLINES) as Group[]).map((g) => <option key={g} value={g}>{DEADLINES[g]}</option>)}
              </select></FilterField>
              <FilterField label="Last touch" htmlFor="ld-touch"><select id="ld-touch" className={toolbarControl} value={touch} onChange={(e) => setParam({ touch: e.target.value || null })}>
                <option value="">Any</option>
                {(Object.keys(TOUCHES) as Array<keyof typeof TOUCHES>).map((t) => <option key={t} value={t}>{TOUCHES[t]}</option>)}
              </select></FilterField>
            </FilterPopover>
            <ActiveFilters inline filters={chips} onClear={clear} />
          </DataToolbar>
        }
        footer={visible.length ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{grouped ? "By urgency: past due, this week, later, no carrier window · from the carrier files" : "Highest step first, then the nearest deadline · from the carrier files"}</span>
            <Pager page={shown.current} pageSize={pageSize} total={visible.length} noun="cases" onPage={setPage} />
          </div>
        ) : undefined}
      >
        {rows.length === 0 ? (
          <EmptyState title="Nothing needs care" hint="A policy shows here when an uploaded policy or commission file shows a missed payment, a lapse, a chargeback or paperwork." />
        ) : visible.length === 0 ? (
          <NoMatches noun="cases" onClear={() => { clear(); router.replace(hrefWith({ step: null })); }} />
        ) : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead>
              <tr>
                <th>Client · policy</th>
                <th>Risk point · why</th>
                <th className="w-[120px] text-right">$/mo · at stake</th>
                <th className="w-[140px] text-right">{step === "lost" ? "Lost since" : "Deadline"}</th>
                <th className="w-[130px]">Last touch</th>
                <th className="w-[170px] text-right"><span className="sr-only">Next action</span></th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {shown.rows.map((r, i) => {
                const g = groupOf(r);
                const head = grouped && (i === 0 || groupOf(shown.rows[i - 1]) !== g);
                const meta = GROUPS.find((x) => x.key === g)!;
                return (
                  <Fragment key={r.id}>
                    {head && (
                      <tr aria-label={`${meta.label}: ${groupCount(g)} cases`}>
                        <td colSpan={6} className="bg-[var(--surface-alt)] py-1.5">
                          <span className="inline-flex items-center gap-2 text-xs font-bold" style={{ color: meta.ink }}>
                            <i aria-hidden="true" className="block size-2 rounded-full" style={{ background: meta.ink }} />{meta.label}
                            <span className="rounded-full bg-[var(--surface)] px-1.5 text-foreground tabular-nums">{groupCount(g).toLocaleString("en-US")}</span>
                          </span>
                        </td>
                      </tr>
                    )}
                    <Row r={r} viewerId={viewerId} showOwner={isOwner && owners.length > 1} />
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>
      )}
    </>
  );
}

const OUTCOME: Record<string, { label: string; tone: string }> = {
  saved: { label: "Saved", tone: "text-[var(--success-ink)]" },
  lost: { label: "Lost", tone: "text-[var(--error-ink)]" },
  closed_no_save: { label: "Closed without a save", tone: "text-muted-foreground" },
};

/** The Closed tab: what left Retention in the last 90 days, and how (a file's save, a loss, or a person's close). */
function ClosedTable({ rows }: { rows: CaseRow[] }) {
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(480, 57);
  const shown = paginate(rows, page, pageSize);
  return (
    <TableCard footer={rows.length ? (
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">Closed in the last {CLOSED_DAYS} days, newest first · saved only when a carrier file proved it</span>
        <Pager page={shown.current} pageSize={pageSize} total={rows.length} noun="cases" onPage={setPage} />
      </div>
    ) : undefined}>
      {rows.length === 0 ? (
        <EmptyState title="Nothing closed yet" hint={`A case shows here for ${CLOSED_DAYS} days after it leaves Retention: saved when a later file shows it fixed, lost when the files show it gone, or closed without a save by a person.`} />
      ) : (
        <table className="portal-lead-table w-full text-left text-sm">
          <thead><tr><th>Client</th><th>It was</th><th>How it ended</th><th className="w-[140px] text-right">Closed</th></tr></thead>
          <tbody className="m-seq">
            {shown.rows.map((r) => (
              <tr key={r.id} className="m-row">
                <td>
                  <Link href={`/app/retention/${r.id}?tab=history`} className="block font-semibold text-foreground underline-offset-2 hover:underline">{r.clientName ? personName(r.clientName) : "No client linked"}</Link>
                  <span className="block text-xs text-muted-foreground">{r.carrierName} {r.policyNumber}</span>
                </td>
                <td><LadderMark step={r.step} /><span className="mt-1 block text-xs text-foreground">{REASON_LABELS[r.reason]}</span></td>
                <td>
                  <span className={`block text-sm font-semibold ${OUTCOME[r.status]?.tone ?? ""}`}>{OUTCOME[r.status]?.label ?? r.status}</span>
                  {r.outcomeReason ? <span className="block max-w-[360px] truncate text-xs text-muted-foreground" title={r.outcomeReason}>{r.outcomeReason}</span> : null}
                </td>
                <td className="text-right tabular-nums">{r.resolvedAt ? fileDay(r.resolvedAt.slice(0, 10)) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

/** Urgent enough to be the one filled button on the page: past its date or inside 3 days (critique B2). */
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

/** The deadline in the row, compact: the days, then "over" or "left" and the date without this year's year. */
function Due({ days, deadline }: { days: number | null; deadline: string | null }) {
  if (days === null || !deadline) return <span className="text-xs text-muted-foreground">No carrier window</span>;
  const tone = days <= 3 ? "text-[var(--error-ink)]" : days <= 7 ? "text-[var(--warning-ink)]" : "text-foreground";
  const date = fileDay(deadline).replace(`, ${new Date().getFullYear()}`, "");
  return (
    <span className="inline-flex flex-col items-end" title={fileDay(deadline)}>
      <span className={`text-base font-semibold tabular-nums ${tone}`}>{days === 0 ? "Today" : Math.abs(days)}</span>
      <span className="whitespace-nowrap text-xs text-muted-foreground">{days < 0 ? "over" : days === 0 ? "due" : "left"} · {date}</span>
    </span>
  );
}

function Row({ r, viewerId, showOwner }: { r: CaseRow; viewerId: string; showOwner: boolean }) {
  const href = `/app/retention/${r.id}`;
  const name = r.clientName ? personName(r.clientName) : "No client linked";
  const why = whyLine(r.reason, r.evidence);
  const owed = owedText(r);
  const stake = stakeText(r);
  const product = [r.product, r.faceCents ? `$${Math.round(r.faceCents / 100).toLocaleString("en-US")}` : null].filter(Boolean).join(" · ");
  return (
    <tr className="m-row">
      <td>
        <span className="flex max-w-[220px] items-baseline gap-2">
          {/* The name is the case page; resting on it shows a read-only peek (nothing opens in the table). */}
          <HoverPeek trigger={<Link href={href} className="min-w-0 truncate font-semibold text-foreground underline-offset-2 hover:underline">{name}</Link>}>
            <b className="text-sm text-foreground">{name} · {STEP_LABELS[r.step]}</b>
            <span className="text-foreground">{why}</span>
            {owed && <span className="text-muted-foreground">{owed[0].toUpperCase() + owed.slice(1)}{stake ? ` · ${stake}` : ""}</span>}
            <span className="text-muted-foreground">Last: {touchText(r)}{r.contactAttempts ? ` · ${r.contactAttempts} ${r.contactAttempts === 1 ? "try" : "tries"}` : ""}</span>
            <span className="font-semibold text-[var(--accent-ink)]">Open the case ›</span>
          </HoverPeek>
          {r.phone
            // Plain text, copyable: a call goes through the dialer's gates, never a raw tel: link.
            ? <span className="shrink-0 select-all text-xs tabular-nums text-muted-foreground">{phoneText(r.phone)}</span>
            : <span className="shrink-0 text-xs text-[var(--warning-ink)]" title="No phone on file">No phone</span>}
        </span>
        {/* The policy number is how the carrier finds it: never cut off. */}
        <span className="block max-w-[220px] truncate text-xs text-muted-foreground" title={`${r.carrierName} ${r.policyNumber}${product ? ` · ${product}` : ""}`}>{r.carrierName} {r.policyNumber}{product ? ` · ${product}` : ""}</span>
      </td>
      <td>
        <LadderMark step={r.step} />
        <span className="mt-1 block max-w-[230px] truncate text-xs text-foreground" title={why}>
          {why}
          {r.status === "waiting_on_carrier" ? <span className="text-muted-foreground"> · with the carrier</span> : null}
        </span>
      </td>
      <td className="text-right">
        <span className="block text-sm tabular-nums text-foreground">{r.monthlyCents === null ? "—" : cents2(r.monthlyCents)}</span>
        {owed && <span className="block truncate text-xs text-muted-foreground">{owed}</span>}
        {stake && <span className="block truncate text-xs text-[var(--warning-ink)]">{stake}</span>}
      </td>
      <td className="text-right">
        {r.step === "lost"
          ? <span className="inline-flex flex-col items-end"><span className="text-sm tabular-nums text-foreground">{fileDay(r.stepChangedAt.slice(0, 10))}</span><span className="text-xs text-muted-foreground">then win-back</span></span>
          : <Due days={r.daysLeft} deadline={r.deadline} />}
      </td>
      <td>
        <span className={`block max-w-[130px] truncate text-xs font-semibold ${r.unreachable ? "text-[var(--warning-ink)]" : "text-foreground"}`}>{r.unreachable ? "Unreachable" : touchText(r)}</span>
        <span className="block truncate text-xs text-muted-foreground">{[r.contactAttempts ? `${r.contactAttempts} ${r.contactAttempts === 1 ? "try" : "tries"}` : null, showOwner ? (r.ownerId === viewerId ? "you" : r.ownerName ?? "nobody") : null].filter(Boolean).join(" · ")}</span>
      </td>
      <td className="text-right">
        <Button asChild size="sm" variant={isUrgent(r) ? "default" : "outline"}><Link href={`${href}?tab=do`}>{r.status === "waiting_on_carrier" ? "Check the case" : r.nextAction}</Link></Button>
      </td>
    </tr>
  );
}

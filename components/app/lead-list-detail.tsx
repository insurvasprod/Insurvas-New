import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, Check } from "lucide-react";

import { LeadListAssignDrawer } from "@/components/app/lead-list-assign-drawer";
import { LeadListClaimButton } from "@/components/app/lead-list-claim-button";
import { Button } from "@/components/ui/button";
import { LinkArrow } from "@/components/ui/link-arrow";
import { PageHeader } from "@/components/ui/page-header";
import { Meter, StatTile, type MeterTone } from "@/components/ui/stat";
import type { LeadListDetail, PoolBlocker, PoolBlockers, RemovalReason } from "@/lib/leadLists/detail";
import { cn } from "@/lib/utils";

/**
 * One bought list, from the file that was committed to the policies it turned into — the board's
 * p-app-lead-list-detail. Rendered on the server: nothing here changes without a new read, and
 * every action is a place to go (export, edit the mapping), not a state to hold — except assigning,
 * whose drawer (lead-list-assign-drawer) is the one client island and refreshes the page when done.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const REMOVAL: Record<RemovalReason, { label: string; chip: string; tone: "error" | "neutral" }> = {
  tcpa_litigator: { label: "TCPA litigator", chip: "litigator", tone: "error" },
  // The scrub answers "on a do-not-call list", not which one, so federal and state stay one row.
  dnc: { label: "Federal or state DNC", chip: "suppressed", tone: "error" },
  internal_dnc: { label: "Your own internal DNC", chip: "suppressed", tone: "error" },
  invalid: { label: "Invalid or disconnected", chip: "invalid", tone: "error" },
  duplicate_in_file: { label: "Repeated inside the file", chip: "duplicate", tone: "neutral" },
  suppressed: { label: "Suppressed", chip: "suppressed", tone: "error" },
};

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const wholeMoney = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const perRecord = (cents: number | null) => (cents == null ? "—" : `$${(cents / 100).toFixed(3)}`);
const count = (value: number) => value.toLocaleString("en-US");

function parts(iso: string, timeZone: string | null) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const read = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone ?? "UTC", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => read.find((part) => part.type === type)?.value ?? "";
  return { year: get("year"), month: Number(get("month")) - 1, day: get("day"), time: `${get("hour")}:${get("minute")}` };
}
/** "18 August" */
function longDay(iso: string, timeZone: string | null) {
  const p = parts(iso, timeZone);
  return p ? `${Number(p.day)} ${MONTHS[p.month]}` : "";
}
/** "18 Aug 09:14" — the time only when the agency's clock is known; a UTC time would mislead. */
function stamp(iso: string, timeZone: string | null) {
  const p = parts(iso, timeZone);
  if (!p) return "";
  return `${Number(p.day)} ${MONTHS[p.month].slice(0, 3)}${timeZone ? ` ${p.time}` : ` ${p.year}`}`;
}
function fullDay(iso: string, timeZone: string | null) {
  const p = parts(iso, timeZone);
  return p ? `${Number(p.day)} ${MONTHS[p.month].slice(0, 3)} ${p.year}` : "—";
}
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((100 * part) / whole) : 0);

function Chip({ tone, dot, children }: { tone: "error" | "neutral" | "good"; dot?: boolean; children: ReactNode }) {
  const look = {
    error: { chip: "bg-[var(--error-surface)] text-[var(--error-ink)]", dot: "bg-[var(--error)]" },
    neutral: { chip: "bg-[var(--surface-alt)] text-[var(--body)]", dot: "bg-[var(--muted-foreground)]" },
    good: { chip: "bg-[var(--success-surface)] text-[var(--success-ink)]", dot: "bg-[var(--success)]" },
  }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold leading-normal tracking-[-0.01em]", look.chip)}>
      {dot && <span className={cn("size-1.5 shrink-0 rounded-full", look.dot)} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** The card with the grey title bar the board gives every table on this screen. */
function BarCard({ title, action, footnote, children }: { title: string; action?: ReactNode; footnote?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgba(16,20,26,.05)]">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-[var(--surface-alt)] px-4 py-3">
        <h2 className="text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">{title}</h2>
        {action && <div className="flex items-center gap-2.5">{action}</div>}
      </div>
      <div className="overflow-x-auto">{children}</div>
      {footnote && <div className="border-t border-border bg-[var(--canvas)] px-4 py-3 text-xs leading-normal tracking-[-0.01em] text-[var(--body)]">{footnote}</div>}
    </section>
  );
}

type Step = { label: string; detail: string; state: "done" | "here" | "open" };

function Chain({ steps }: { steps: Step[] }) {
  return (
    <div className="rounded-lg border border-border bg-card p-[18px] shadow-[0_1px_2px_rgba(16,20,26,.05)]">
      {/* One line from lg up, as the board draws it; below that the six steps sit two to a row and
          the connectors, which no longer connect anything, are dropped. */}
      <ol className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:flex lg:items-center lg:gap-0" aria-label="Where this list is">
        {steps.map((step, index) => (
          <li key={step.label} className={cn("flex min-w-0 items-center", index > 0 && "lg:flex-grow")} aria-current={step.state === "here" ? "step" : undefined}>
            {index > 0 && <span className="m-track mx-2.5 hidden h-0.5 min-w-6 flex-grow bg-border lg:block" aria-hidden="true" />}
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                className={cn(
                  "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  step.state === "done" && "bg-[var(--success)] text-white",
                  step.state === "here" && "bg-[var(--primary)] text-[var(--primary-foreground)]",
                  step.state === "open" && "bg-[var(--surface-alt)] text-[var(--body)]",
                )}
              >
                {step.state === "done" ? <Check className="size-[13px]" strokeWidth={3} aria-label="done" /> : index + 1}
              </span>
              <span>
                <span className={cn("block text-sm font-semibold leading-normal tracking-[-0.02em]", step.state === "here" ? "text-[var(--accent-ink)]" : "text-foreground")}>{step.label}</span>
                <span className="block text-xs leading-normal tracking-[-0.01em] tabular-nums text-muted-foreground">{step.detail}</span>
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function HealthRow({ label, value, of, tone }: { label: string; value: number | null; of: number; tone: MeterTone }) {
  const ink: Record<MeterTone, string> = {
    neutral: "text-[var(--body)]", good: "text-[var(--success-ink)]", info: "text-[var(--info-ink)]",
    warning: "text-[var(--warning-ink)]", danger: "text-[var(--error-ink)]", primary: "text-[var(--accent-ink)]",
  };
  return (
    <div className="flex items-center gap-3.5 border-t border-border py-[11px]">
      <span className="w-[42%] shrink-0 text-sm sm:w-[210px] leading-normal tracking-[-0.02em] text-[var(--body)]">{label}</span>
      <span className="flex-grow">
        <Meter value={value ?? 0} max={of} tone={tone} label={`${label}: ${value == null ? "unknown" : `${value} of ${of}`}`} className="h-1.5 bg-[var(--border)] [&>span]:h-1.5" />
      </span>
      <span className={cn("w-16 shrink-0 text-right text-sm font-semibold sm:w-[110px] tabular-nums leading-normal tracking-[-0.02em]", value == null ? "text-muted-foreground" : ink[tone])}>
        {value == null ? "—" : count(value)}
      </span>
    </div>
  );
}

/** The day repeats inside a file started being ledgered (20260925703100). */
const REPEATS_COUNTED_FROM = "25 Sep 2026";

const BLOCKER_ORDER: PoolBlocker[] = [
  "ready", "campaign", "no_agent", "at_capacity", "no_state", "rules_stale", "outside_window",
  "waiting", "unscheduled", "suppressed", "exhausted", "lead_state",
];

const BLOCKER: Record<PoolBlocker, { label: string; dot: string }> = {
  ready: { label: "Ready — served now", dot: "bg-[var(--success)]" },
  campaign: { label: "List not servable", dot: "bg-[var(--error)]" },
  no_agent: { label: "Nobody may work that state", dot: "bg-[var(--error)]" },
  at_capacity: { label: "Everyone eligible is full", dot: "bg-[var(--warning)]" },
  no_state: { label: "Missing a state — no timezone", dot: "bg-[var(--info)]" },
  rules_stale: { label: "Calling rules out of date", dot: "bg-[var(--error)]" },
  outside_window: { label: "Outside their window right now", dot: "bg-[var(--muted-foreground)]" },
  waiting: { label: "Waiting for the next attempt", dot: "bg-[var(--muted-foreground)]" },
  unscheduled: { label: "No next attempt scheduled", dot: "bg-[var(--warning)]" },
  suppressed: { label: "Suppressed since import", dot: "bg-[var(--error)]" },
  exhausted: { label: "Out of attempts", dot: "bg-[var(--muted-foreground)]" },
  lead_state: { label: "Not a status the dialer serves", dot: "bg-[var(--muted-foreground)]" },
};

/** "Thu 8:00 AM CDT" in the lead's own zone — the moment its window opens, as the customer's clock reads it. */
function localOpening(iso: string, zone: string | null) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone ?? "UTC", weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
  } catch {
    return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }
}

/** "MI 400 · WI 212 · +2 more" — the states behind one reason, largest first. */
function statesLine(groups: PoolBlockers["groups"], limit = 4) {
  const byState = new Map<string, number>();
  for (const group of groups) if (group.state) byState.set(group.state, (byState.get(group.state) ?? 0) + group.count);
  const sorted = [...byState.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = sorted.slice(0, limit).map(([state, n]) => `${state} ${count(n)}`).join(" · ");
  return sorted.length > limit ? `${shown} · +${sorted.length - limit} more` : shown;
}

function unblocks(blocker: PoolBlocker, groups: PoolBlockers["groups"], pool: PoolBlockers): ReactNode {
  const states = statesLine(groups);
  const link = "font-semibold text-foreground underline underline-offset-2";
  switch (blocker) {
    case "ready":
      return "Nothing. Serve next hands these out to anyone who may work the state — they do not need assigning first.";
    case "campaign": {
      const why = [
        pool.campaign.status && pool.campaign.status !== "active" ? `is ${pool.campaign.status}` : null,
        pool.campaign.scrubStatus !== "scrubbed" ? "has not been scrubbed" : null,
      ].filter(Boolean).join(" and ") || "is not servable";
      return <>This list {why}, so Serve next hands out none of it. Change it on <Link href="/app/campaigns" className={link}>Vendors &amp; campaigns</Link>.</>;
    }
    case "no_agent":
      return <>{states}. Nobody here holds a current licence there, and no setter is active. <Link href="/app/settings#states-licences" className={link}>Add a licence</Link> to work them.</>;
    case "at_capacity":
      return <>{states}. Everyone who may work them is at their open-lead ceiling. <Link href="/app/assignments" className={link}>Raise a capacity</Link> on Lead assignment.</>;
    case "no_state":
      return "Without a state there is no legal calling window. Add the state to the lead.";
    case "rules_stale":
      return "The calling-window rules are past their refresh date, so nothing is dialed until they are refreshed.";
    case "outside_window": {
      const openings = [...groups]
        .filter((group) => group.state)
        .sort((a, b) => (a.nextAt ?? "9").localeCompare(b.nextAt ?? "9"));
      const shown = openings.slice(0, 4).map((group) => `${group.state} ${group.nextAt ? `opens ${localOpening(group.nextAt, group.zone)}` : "does not open in the next 8 days"}`);
      return `${shown.join(" · ")}${openings.length > 4 ? ` · +${openings.length - 4} more` : ""}. They are served when their window opens.`;
    }
    case "waiting": {
      const next = groups.map((group) => group.nextAt).filter((value): value is string => Boolean(value)).sort()[0];
      const zone = groups.find((group) => group.nextAt === next)?.zone ?? null;
      return `The cadence has them waiting between attempts${next ? `; the first is due ${localOpening(next, zone)}` : ""}.`;
    }
    case "unscheduled":
      return <>A retry or recycled lead with no next attempt set, so no tier ever reaches it. <Link href="/app/nurture" className={link}>Lead recycling</Link> can reschedule them.</>;
    case "suppressed":
      return "Their number went onto a do-not-call or suppression list after import. They are never dialed.";
    case "exhausted":
      return <>Every attempt the cadence allows has been made. <Link href="/app/nurture" className={link}>Lead recycling</Link> can bring them back.</>;
    case "lead_state": {
      const statuses = [...new Set(groups.map((group) => group.detail).filter(Boolean))].join(", ");
      return `Lead status ${statuses || "unknown"}, which Serve next does not hand out.`;
    }
  }
}

function PoolBlockersCard({ pool }: { pool: PoolBlockers }) {
  const byBlocker = new Map<PoolBlocker, PoolBlockers["groups"]>();
  for (const group of pool.groups) byBlocker.set(group.blocker, [...(byBlocker.get(group.blocker) ?? []), group]);
  const rows = BLOCKER_ORDER.filter((blocker) => byBlocker.has(blocker)).map((blocker) => {
    const groups = byBlocker.get(blocker) ?? [];
    return { blocker, groups, leads: groups.reduce((n, group) => n + group.count, 0) };
  });
  const held = pool.total - (rows.find((row) => row.blocker === "ready")?.leads ?? 0);
  return (
    <BarCard
      title="Why these aren't being served"
      action={<Chip tone={held > 0 ? "error" : "good"}>{count(pool.total)} in the pool{held > 0 ? ` · ${count(held)} held` : ""}</Chip>}
      footnote={
        <>
          Pool leads are served by Serve next without being assigned, so nothing here needs releasing — a list is paused on Vendors &amp; campaigns. Each lead is counted once, under the first check Serve next would refuse it on, as of now.
        </>
      }
    >
      <table className="portal-lead-table w-full min-w-[620px]! text-left text-sm">
        <thead>
          <tr>
            <th scope="col" className="w-[260px]">Reason</th>
            <th scope="col" className="w-[80px] text-right">Leads</th>
            <th scope="col">What unblocks it</th>
          </tr>
        </thead>
        <tbody className="m-seq">
          {rows.map((row) => (
            <tr key={row.blocker} className="m-row">
              <td>
                <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                  <span className={cn("size-[7px] shrink-0 rounded-full", BLOCKER[row.blocker].dot)} aria-hidden="true" />
                  {BLOCKER[row.blocker].label}
                </span>
              </td>
              <td className={cn("text-right font-semibold tabular-nums", row.blocker !== "ready" && row.blocker !== "waiting" && "text-[var(--error-ink)]")}>{count(row.leads)}</td>
              <td className="text-[var(--body)]">{unblocks(row.blocker, row.groups, pool)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </BarCard>
  );
}

export function LeadListDetailView({
  detail,
  eyebrow,
  money: canSeeMoney,
  timeZone,
  assign = { manager: false, blocked: null },
  claimBlocked = null,
}: {
  detail: LeadListDetail;
  eyebrow?: string;
  money: boolean;
  timeZone: string | null;
  /** manager: owner or producer. blocked: why assigning is off for them (plan, read-only), or null. */
  assign?: { manager: boolean; blocked: string | null };
  /** Why drafting a claim is off (a read-only plan), or null. */
  claimBlocked?: string | null;
}) {
  const d = detail;
  const unassigned = Math.max(0, d.leadsReceived - d.assigned);
  const removed = d.removals.reduce((sum, row) => sum + row.rows, 0);
  const claimableCents = d.removals.reduce((sum, row) => sum + (row.claimableCents ?? 0), 0);
  // Rows a later re-scrub found stay "removed" but are never claimable (20260925707900).
  const claimableRows = d.removals.reduce((sum, row) => sum + (row.claimableCents != null ? row.claimableRows : 0), 0);
  const windowOpen = d.returnDaysLeft == null || d.returnDaysLeft > 0;
  const netSpend = d.totalSpendCents - d.creditsReceivedCents;
  const contactRate = d.dialed > 0 ? (100 * d.contacted) / d.dialed : null;
  const settled = d.leadsReceived > 0 && d.workable === 0;
  const exportHref = `/api/app/vendor-returns/import-removals?campaign_id=${d.campaignId}`;
  // What each usable record costs once the credit still being argued lands: net spend less that
  // credit, over the same usable rows. Not "back to the invoice price" — rows on your own list are
  // never credited, so the two only meet when every removal is creditable.
  const postCreditCents = d.recordsUsable > 0 ? (netSpend - d.claims.pendingCents) / d.recordsUsable : null;

  const subtitle = [
    d.vendorName,
    d.productName ?? d.productCode,
    `${money(d.totalSpendCents)} for ${count(d.recordsPurchased)} records${d.firstImportAt ? `, imported ${longDay(d.firstImportAt, timeZone)}` : ", nothing imported yet"}`,
  ].filter(Boolean).join(" · ");

  const steps: Step[] = [
    {
      label: "CSV import",
      detail: d.firstImportAt ? `Committed ${stamp(d.firstImportAt, timeZone)} · ${d.imports > 1 ? `${d.imports} files` : "transactional"}` : "Nothing committed yet",
      state: d.firstImportAt ? "done" : "open",
    },
    { label: "Lead list", detail: `${count(d.recordsUsable)} usable · ${perRecord(d.costPerUsableCents)} each`, state: "here" },
    {
      label: "Assignment",
      detail: `${count(d.assigned)} routed · licence checked first`,
      state: d.leadsReceived > 0 && unassigned === 0 ? "done" : "open",
    },
    {
      label: "Dialer",
      detail: `${count(d.dialed)} dialed · ${count(d.neverDialed)} never tried`,
      state: d.leadsReceived > 0 && d.neverDialed === 0 ? "done" : "open",
    },
    { label: "Disposition", detail: `${count(d.outcomesRecorded)} outcomes recorded`, state: settled ? "done" : "open" },
    {
      label: "Pipeline",
      detail: d.outcome
        ? `${count(d.outcome.issued)} issued · ${d.outcome.costPerIssuedCents == null ? "no policy yet" : `${money(d.outcome.costPerIssuedCents)} per policy`}`
        : "Outcomes live in True CPA",
      state: settled ? "done" : "open",
    },
  ];

  return (
    <div className="m-stagger flex flex-col gap-6">
      <div>
        <div className="mb-2.5 flex items-center gap-2 text-sm font-semibold leading-[1.43] tracking-[-0.01em] text-foreground">
          <ArrowLeft className="size-[13px]" strokeWidth={2.4} aria-hidden="true" />
          <Link href="/app/lead-lists" className="text-inherit no-underline hover:underline">Back to lead lists</Link>
        </div>
        <PageHeader
          eyebrow={eyebrow}
          title={d.campaignName}
          description={subtitle}
          actions={
            <>
              {canSeeMoney && d.claims.supported && d.claims.unclaimedRows > 0 && (
                <LeadListClaimButton campaignId={d.campaignId} rows={d.claims.unclaimedRows} amount={money(d.claims.unclaimedCents)} blocked={claimBlocked} />
              )}
              {canSeeMoney && claimableRows > 0 && (
                <Button asChild type="button" variant="outline" className="h-11 border-[var(--border-strong)] px-4">
                  <a href={exportHref} download>Export claimable rows</a>
                </Button>
              )}
              {/* Owners and producers assign the whole pool remainder at once in the drawer. Everyone
                  else — and any list whose unassigned leads are not in the pool — keeps the per-lead
                  view, which the index opens from the hash (lead-list-workspace). */}
              {assign.manager && d.assignable > 0 && !assign.blocked && (
                <LeadListAssignDrawer campaignId={d.campaignId} listName={d.campaignName} assignable={d.assignable} />
              )}
              {assign.manager && d.assignable > 0 && assign.blocked && (
                <span className="flex flex-col items-end gap-1">
                  <Button type="button" className="h-11 px-4" disabled aria-describedby="assign-blocked">Assign the {count(d.assignable)}</Button>
                  <span id="assign-blocked" className="max-w-[260px] text-right text-xs leading-normal tracking-[-0.01em] text-muted-foreground">{assign.blocked}</span>
                </span>
              )}
              {(!assign.manager || d.assignable === 0) && unassigned > 0 && (
                <Button asChild type="button" variant="outline" className="h-11 border-[var(--border-strong)] px-4">
                  <Link href={`/app/lead-lists#${d.campaignId}`}>See the {count(unassigned)} unassigned</Link>
                </Button>
              )}
            </>
          }
        />
      </div>

      <Chain steps={steps} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Paid per record" value={perRecord(d.costPerRecordCents)} footnote={`${wholeMoney(d.totalSpendCents)} / ${count(d.recordsPurchased)} rows`} />
        <StatTile
          label="Cost per usable record"
          labelTitle={`From ${REPEATS_COUNTED_FROM} a number repeated inside a file counts as removed, so it no longer counts as usable.`}
          value={perRecord(d.costPerUsableCents)}
          valueTone="primary"
          footnote={`${wholeMoney(netSpend)} / ${count(d.recordsUsable)} after scrub`}
        />
        <StatTile
          label="Contact rate"
          value={contactRate == null ? "—" : `${contactRate.toFixed(1)}%`}
          valueTone={contactRate == null ? undefined : "good"}
          footnote={d.dialed > 0 ? `${count(d.contacted)} of ${count(d.dialed)} dialed` : "nobody dialed yet"}
        />
        <StatTile
          label="Issued"
          value={d.outcome ? count(d.outcome.issued) : "—"}
          valueTone={d.outcome ? "good" : undefined}
          footnote={d.outcome ? `of ${count(d.outcome.applications)} applications` : canSeeMoney ? "scorecard unavailable" : "needs True CPA"}
        />
        <StatTile
          label="Cost per issued policy"
          value={d.outcome?.costPerIssuedCents != null ? money(d.outcome.costPerIssuedCents) : "—"}
          valueTone={d.outcome?.costPerIssuedCents != null ? "primary" : undefined}
          footnote="the number that decides the re-buy"
        />
      </div>

      <div className="flex flex-col gap-6 xl:flex-row">
        <div className="flex min-w-0 flex-grow flex-col gap-6">
          <BarCard
            title={`Where the ${count(removed)} went`}
            action={
              claimableCents > 0 ? (
                <Chip tone={windowOpen ? "good" : "neutral"}>
                  {money(claimableCents)} claimable
                  {d.returnDaysLeft != null && ` · ${windowOpen ? `${d.returnDaysLeft} ${d.returnDaysLeft === 1 ? "day" : "days"} left` : "window closed"}`}
                </Chip>
              ) : undefined
            }
            footnote={
              removed > 0 && d.costPerRecordCents != null && d.costPerUsableCents != null ? (
                <>
                  Until credits are tracked the cost per lead is fiction. Paying {wholeMoney(d.totalSpendCents)} for {count(d.recordsPurchased)} records of which {count(removed)} were never usable makes the real cost of the usable ones <strong>{perRecord(d.costPerUsableCents)}</strong>, not {perRecord(d.costPerRecordCents)}
                  {postCreditCents != null && d.claims.pendingCents > 0
                    ? <> — and if the {money(d.claims.pendingCents)} still claimable is credited it falls to <strong>{perRecord(postCreditCents)}</strong>.</>
                    : "."}
                  <span className="mt-1 block">Repeats inside a file count as removed and claimable from {REPEATS_COUNTED_FROM}; duplicates of leads you already had stay usable.</span>
                </>
              ) : (
                <>Nothing was removed at import, so what you paid per record is what each usable one cost. Repeats inside a file count as removed from {REPEATS_COUNTED_FROM}; duplicates of leads you already had stay usable and are not counted here.</>
              )
            }
          >
            <table className="portal-lead-table w-full min-w-[620px]! text-left text-sm">
              <thead>
                <tr>
                  <th>Removed at import</th>
                  <th className="w-[140px]">Outcome</th>
                  <th className="w-[74px] text-right">Rows</th>
                  <th className="w-[100px] text-right">Claimable</th>
                  <th className="w-[100px] text-right"><span className="sr-only">Claim</span></th>
                </tr>
              </thead>
              <tbody className="m-seq">
                {d.removals.map((row) => {
                  const ui = REMOVAL[row.reason];
                  return (
                    <tr key={row.reason} className="m-row">
                      <td>{ui.label}{row.rescrubRows > 0 && <span className="block text-[12px] text-[var(--muted)]">{count(row.rescrubRows)} found by a later re-scrub · not claimable</span>}</td>
                      <td><Chip tone={ui.tone}>{ui.chip}</Chip></td>
                      <td className="text-right tabular-nums">{count(row.rows)}</td>
                      <td className="text-right tabular-nums">{row.claimableCents == null ? "—" : money(row.claimableCents)}</td>
                      <td className="text-right">
                        {canSeeMoney && row.claimableCents != null && row.claimableRows > 0 && windowOpen && (
                          <LinkArrow href={`${exportHref}&reason=${row.reason}`} download aria-label={`Claim: download the ${row.claimableRows} ${ui.label} rows for the vendor`}>Claim</LinkArrow>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-[var(--surface-alt)] text-sm font-semibold text-foreground [&>td]:border-t [&>td]:border-[var(--border-strong)] [&>td]:px-3 [&>td]:py-2.5">
                  <td>{count(d.recordsUsable)} usable + {count(removed)} removed</td>
                  <td />
                  <td className="text-right tabular-nums">{count(d.recordsUsable + removed)}</td>
                  <td className="text-right tabular-nums">{money(claimableCents)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </BarCard>

          {d.poolBlockers && d.poolBlockers.total > 0 && <PoolBlockersCard pool={d.poolBlockers} />}

          <BarCard
            title="Column mapping"
            action={
              <>
                {d.mapping.saved && <Chip tone="good">Saved for {d.vendorName}</Chip>}
                <Button asChild type="button" variant="outline" size="sm" className="h-8 border-[var(--border-strong)] px-4">
                  <Link href="/app/import">Edit mapping</Link>
                </Button>
              </>
            }
            footnote={
              <>
                Remembered per vendor, so the next {d.vendorName} file is one click. The commit is transactional: all {count(d.leadsReceived)} rows land or none do — a half-imported list with no way to tell which rows made it is the failure this prevents.
              </>
            }
          >
            {d.mapping.rows.length > 0 ? (
              <table className="portal-lead-table w-full min-w-[620px]! table-fixed text-left text-sm">
                <thead>
                  <tr>
                    <th className="w-[190px]">Their header</th>
                    <th>Our field</th>
                    <th className="w-[200px]">Sample</th>
                    <th className="w-[110px]"><span className="sr-only">Status</span></th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {d.mapping.rows.map((row) => (
                    <tr key={row.header} className="m-row">
                      <td>{row.header}</td>
                      <td>{row.fieldLabel ?? "— not mapped"}</td>
                      <td className="max-w-[200px] truncate">{row.sample || <span className="text-muted-foreground">—</span>}</td>
                      <td>{row.field ? <Chip tone="good" dot>Remembered</Chip> : <Chip tone="neutral" dot>Ignored</Chip>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                No mapping is saved for {d.vendorName}. Save one on the import screen and every later file from them maps itself.
              </p>
            )}
          </BarCard>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-6 xl:w-[460px]">
          <section className="rounded-lg border border-border bg-card p-6 shadow-[0_1px_2px_rgba(16,20,26,.05)]">
            <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em]">List health</h2>
            <p className="mt-1 text-sm leading-normal tracking-[-0.02em] text-muted-foreground">The view that shows a list has stalled before the cost per policy says so.</p>
            <div className="mt-1.5">
              <HealthRow label="Dialed at least once" value={d.dialed} of={d.leadsReceived} tone="info" />
              <HealthRow label="Never dialed" value={d.neverDialed} of={d.leadsReceived} tone="warning" />
              <HealthRow label="Stuck outside their window" value={d.outsideWindow} of={d.leadsReceived} tone={d.outsideWindow ? "warning" : "good"} />
              <HealthRow label={`Exhausted at ${(d.attemptCeilings ?? [d.attemptCeiling]).join(" or ")} attempts`} value={d.exhausted} of={d.leadsReceived} tone="neutral" />
              <HealthRow label="Contacted" value={d.contacted} of={d.leadsReceived} tone="good" />
            </div>
          </section>

          {d.neverDialed > 0 && (
            <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em]">
              <p className="font-semibold text-[var(--warning-ink)]">{count(d.neverDialed)} {d.neverDialed === 1 ? "has" : "have"} never been dialed</p>
              <p className="mt-1.5 text-[var(--body)]">
                {d.neverDialed === 1 ? "It is" : "They are"} {pct(d.neverDialed, d.recordsPurchased || d.leadsReceived)}% of what you paid for. A list where a third is unreachable looks identical to one that is working, right up until the cost per policy comes in wrong.
              </p>
            </div>
          )}

          <section className="rounded-lg border border-border bg-card p-5 shadow-[0_1px_2px_rgba(16,20,26,.05)]">
            <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em]">Consent artefacts</h2>
            <dl className="mt-3.5 grid grid-cols-2 gap-x-6 gap-y-4">
              {[
                ["TrustedForm present", `${count(d.consent.trustedForm)} of ${count(d.leadsReceived)}`],
                ["Missing", count(Math.max(0, d.leadsReceived - d.consent.supplied))],
                ["Oldest certificate", d.consent.oldestCapturedAt ? fullDay(d.consent.oldestCapturedAt, timeZone) : "—"],
                ["Vendor signal", d.leadsReceived > 0 ? `${((100 * d.consent.supplied) / d.leadsReceived).toFixed(1)}% supplied` : "—"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-sm font-semibold tabular-nums leading-normal tracking-[-0.02em] text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
              This is what you are asked to produce when a complaint arrives. A vendor who cannot supply them is selling something different from what they claim.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

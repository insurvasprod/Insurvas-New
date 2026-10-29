import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ChevronLeft, Columns3, Download, ShieldCheck } from "lucide-react";

import { LeadListAssignDrawer } from "@/components/app/lead-list-assign-drawer";
import { LeadListClaimButton } from "@/components/app/lead-list-claim-button";
import { TabbedPanels } from "@/components/app/lead-ops-view-tabs";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { PageHeader } from "@/components/ui/page-header";
import { Meter, StatStrip, StatTile, type MeterTone } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { TableCard } from "@/components/ui/table-card";
import type { LeadListDetail, PoolBlocker, PoolBlockers, RemovalReason } from "@/lib/leadLists/detail";
import { cn } from "@/lib/utils";
import { StatusChip } from "@/components/ui/status-chip";

/**
 * One bought list, from the file that was committed to the policies it turned into — the board's
 * p-app-lead-list-detail. Rendered on the server: nothing here changes without a new read, and
 * every action is a place to go (export, edit the mapping), not a state to hold — except assigning,
 * whose drawer (lead-list-assign-drawer) is the one client island and refreshes the page when done.
 *
 * Its sections are exported one by one: the Lists step opens the same list in a side panel
 * (lead-list-panel.tsx, owner 2026-10-29) and composes them there, so nothing is drawn twice. No
 * server-only import may land here for that reason; the data arrives as props.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const REMOVAL: Record<RemovalReason, { label: string; chip: string; tone: "danger" | "neutral" }> = {
  tcpa_litigator: { label: "TCPA litigator", chip: "litigator", tone: "danger" },
  // The scrub answers "on a do-not-call list", not which one, so federal and state stay one row.
  dnc: { label: "Federal or state DNC", chip: "suppressed", tone: "danger" },
  internal_dnc: { label: "Your own internal DNC", chip: "suppressed", tone: "danger" },
  invalid: { label: "Invalid or disconnected", chip: "invalid", tone: "danger" },
  duplicate_in_file: { label: "Repeated inside the file", chip: "duplicate", tone: "neutral" },
  suppressed: { label: "Suppressed", chip: "suppressed", tone: "danger" },
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
function fullDay(iso: string, timeZone: string | null) {
  const p = parts(iso, timeZone);
  return p ? `${Number(p.day)} ${MONTHS[p.month].slice(0, 3)} ${p.year}` : "—";
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

function unblocks(blocker: PoolBlocker, groups: PoolBlockers["groups"], pool: PoolBlockers, scrubFix: ReactNode = null): ReactNode {
  const states = statesLine(groups);
  const link = "font-semibold text-foreground underline underline-offset-2";
  switch (blocker) {
    case "ready":
      return "Nothing — Serve next hands these out unassigned.";
    case "campaign": {
      const why = [
        pool.campaign.status && pool.campaign.status !== "active" ? `is ${pool.campaign.status}` : null,
        pool.campaign.scrubStatus !== "scrubbed" ? "has not been scrubbed" : null,
      ].filter(Boolean).join(" and ") || "is not servable";
      // In the Lists panel the scrub runs right here (scrubFix); the list's own page sends you to it.
      if (scrubFix && pool.campaign.scrubStatus !== "scrubbed") return <span className="flex flex-col items-start gap-2">This list {why}, so Serve next hands out none of it.{scrubFix}</span>;
      return <>This list {why}, so Serve next hands out none of it. Change it on <Link href="/app/campaigns" className={link}>Vendors &amp; campaigns</Link>.</>;
    }
    case "no_agent":
      return <>{states}. Nobody here holds a current licence there, and no setter is active. <Link href="/app/appointments?tab=licences" className={link}>Add a licence</Link> to work them.</>;
    case "at_capacity":
      return <>{states}. <Link href="/app/assignments" className={link}>Raise a capacity</Link> on Lead routing.</>;
    case "no_state":
      return "Add a state to these leads to call them.";
    case "rules_stale":
      return "Refresh the calling-window rules to resume dialing.";
    case "outside_window": {
      const openings = [...groups]
        .filter((group) => group.state)
        .sort((a, b) => (a.nextAt ?? "9").localeCompare(b.nextAt ?? "9"));
      const shown = openings.slice(0, 4).map((group) => `${group.state} ${group.nextAt ? `opens ${localOpening(group.nextAt, group.zone)}` : "does not open in the next 8 days"}`);
      return `${shown.join(" · ")}${openings.length > 4 ? ` · +${openings.length - 4} more` : ""}. Served when it opens.`;
    }
    case "waiting": {
      const next = groups.map((group) => group.nextAt).filter((value): value is string => Boolean(value)).sort()[0];
      const zone = groups.find((group) => group.nextAt === next)?.zone ?? null;
      return `The cadence has them waiting between attempts${next ? `; the first is due ${localOpening(next, zone)}` : ""}.`;
    }
    case "unscheduled":
      return <>Reschedule them in <Link href="/app/nurture" className={link}>Lead recycling</Link>.</>;
    case "suppressed":
      return "Their number went onto a do-not-call or suppression list after import. They are never dialed.";
    case "exhausted":
      return <>Bring them back in <Link href="/app/nurture" className={link}>Lead recycling</Link>.</>;
    case "lead_state": {
      const statuses = [...new Set(groups.map((group) => group.detail).filter(Boolean))].join(", ");
      return `Lead status ${statuses || "unknown"}, which Serve next does not hand out.`;
    }
  }
}

export function PoolBlockersCard({ pool, scrubFix = null }: { pool: PoolBlockers; scrubFix?: ReactNode }) {
  const byBlocker = new Map<PoolBlocker, PoolBlockers["groups"]>();
  for (const group of pool.groups) byBlocker.set(group.blocker, [...(byBlocker.get(group.blocker) ?? []), group]);
  const rows = BLOCKER_ORDER.filter((blocker) => byBlocker.has(blocker)).map((blocker) => {
    const groups = byBlocker.get(blocker) ?? [];
    return { blocker, groups, leads: groups.reduce((n, group) => n + group.count, 0) };
  });
  const held = pool.total - (rows.find((row) => row.blocker === "ready")?.leads ?? 0);
  return (
    <TableCard
      title="Why these aren't being served"
      action={<StatusChip tone={held > 0 ? "danger" : "good"}>{count(pool.total)} in the pool{held > 0 ? ` · ${count(held)} held` : ""}</StatusChip>}
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
              <td className="text-[var(--body)]">{unblocks(row.blocker, row.groups, pool, scrubFix)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}

/**
 * The figures one detail read gives both the list's page and the Lists panel (lead-list-panel.tsx),
 * so the two never count a list differently.
 */
export function listFigures(d: LeadListDetail) {
  const removed = d.removals.reduce((sum, row) => sum + row.rows, 0);
  const claimableCents = d.removals.reduce((sum, row) => sum + (row.claimableCents ?? 0), 0);
  // Rows a later re-scrub found stay "removed" but are never claimable (20260925707900).
  const claimableRows = d.removals.reduce((sum, row) => sum + (row.claimableCents != null ? row.claimableRows : 0), 0);
  const windowOpen = d.returnDaysLeft == null || d.returnDaysLeft > 0;
  const netSpend = d.totalSpendCents - d.creditsReceivedCents;
  const exportHref = `/api/app/vendor-returns/import-removals?campaign_id=${d.campaignId}`;
  // What each usable record costs once the credit still being argued lands: net spend less that
  // credit, over the same usable rows. Not "back to the invoice price" — rows on your own list are
  // never credited, so the two only meet when every removal is creditable.
  const postCreditCents = d.recordsUsable > 0 ? (netSpend - d.claims.pendingCents) / d.recordsUsable : null;
  return { removed, claimableCents, claimableRows, windowOpen, netSpend, exportHref, postCreditCents, unassigned: Math.max(0, d.leadsReceived - d.assigned) };
}

/** Two decimals, as every figure on the list is drawn. */
export const listMoney = money;

/** "Vendor · Product · $1,750.00 for 5,000 records, imported 18 August" */
export function listSubtitle(d: LeadListDetail, timeZone: string | null, spend = true) {
  return [
    d.vendorName,
    d.productName ?? d.productCode,
    // A list nothing was paid for (your own book) says only when it arrived, not "$0.00 for 0 records".
    d.recordsPurchased === 0 && d.totalSpendCents === 0
      ? (d.firstImportAt ? `imported ${longDay(d.firstImportAt, timeZone)}` : "nothing imported yet")
      : `${spend ? `${money(d.totalSpendCents)} for ` : ""}${count(d.recordsPurchased)} records${d.firstImportAt ? `, imported ${longDay(d.firstImportAt, timeZone)}` : ", nothing imported yet"}`,
  ].filter(Boolean).join(" · ");
}

/**
 * What each removal reason asks of you (owner 2026-10-29: "help the user create faster solutions"):
 * the vendor's defects are claimed back, the do-not-call hits are already kept off the dialer, and a
 * repeat inside the file was merged at import.
 */
const REMOVAL_FIX: Record<RemovalReason, { state: string; tone: "good" | "neutral"; tip: string }> = {
  tcpa_litigator: { state: "Blocked from dialing", tone: "good", tip: "A known TCPA plaintiff. Never dialed; the vendor owes credit for the row." },
  dnc: { state: "Kept off the dialer", tone: "good", tip: "On a federal or state do-not-call list. Never dialed; the vendor owes credit for selling it." },
  internal_dnc: { state: "Kept off the dialer", tone: "good", tip: "On your own do-not-call list. Never dialed. Your list, so not the vendor's to credit." },
  invalid: { state: "Not a working number", tone: "neutral", tip: "Invalid or disconnected. Nobody could dial it; the vendor owes credit for the row." },
  duplicate_in_file: { state: "Already merged", tone: "good", tip: "The same number twice in one file, merged at import: nothing to do. The vendor charged for both, so the repeat is creditable." },
  suppressed: { state: "Kept off the dialer", tone: "good", tip: "Suppressed after import. Never dialed." },
};

/** Where the removed rows went, and the quickest thing to do about each reason. */
export function RemovalsCard({ detail: d, money: canSeeMoney, claim }: {
  detail: LeadListDetail;
  money: boolean;
  /** Per-reason "Claim credit" in the Lists panel; without it the list's page refreshes after a claim. */
  claim?: { blocked: string | null; onDone?: () => void };
}) {
  const { removed, claimableCents, windowOpen, exportHref, postCreditCents } = listFigures(d);
  const rows = d.removals.filter((row) => row.rows > 0);
  const closingSoon = d.returnDaysLeft != null && d.returnDaysLeft > 0 && d.returnDaysLeft <= 3;
  const daysLeft = d.returnDaysLeft == null ? null : windowOpen ? `${d.returnDaysLeft} ${d.returnDaysLeft === 1 ? "day" : "days"} left` : "window closed";

  if (!d.firstImportAt) {
    return (
      <TableCard title="Removed at import">
        <EmptyState
          title="Nothing imported yet"
          hint="Import a file against this list to see what the scrub removes."
          action={<Button asChild type="button" variant="outline"><Link href={importHref(d)}>Import a list</Link></Button>}
        />
      </TableCard>
    );
  }
  if (rows.length === 0) {
    // One clean state, not a table of zeros. An unscrubbed list has not been checked yet, which is
    // not the same as clean.
    const checked = d.scrubStatus === "scrubbed";
    return (
      <TableCard title="Removed at import">
        <EmptyState
          title={checked ? "Nothing was removed from this list" : "Not scrubbed yet"}
          hint={checked ? (d.recordsUsable > 0 ? `All ${count(d.recordsUsable)} rows passed the scrub.` : "Every row passed the scrub.") : "Run the scrub to see what it removes."}
        />
      </TableCard>
    );
  }

  return (
    <TableCard
      title={`${count(removed)} ${removed === 1 ? "row" : "rows"} removed at import`}
      action={
        canSeeMoney && claimableCents > 0 ? (
          <StatusChip tone={!windowOpen ? "neutral" : closingSoon ? "warning" : "good"}>
            {money(claimableCents)} {windowOpen ? "claimable" : "creditable"}{daysLeft && ` · ${daysLeft}`}
          </StatusChip>
        ) : undefined
      }
      footer={
        canSeeMoney && d.costPerRecordCents != null && d.costPerUsableCents != null ? (
          <span>
            Each usable record cost <strong className="text-foreground">{perRecord(d.costPerUsableCents)}</strong>, not {perRecord(d.costPerRecordCents)}
            {postCreditCents != null && d.claims.pendingCents > 0
              ? <> · <strong className="text-foreground">{perRecord(postCreditCents)}</strong> if the {money(d.claims.pendingCents)} still claimable is credited</>
              : null}
          </span>
        ) : undefined
      }
    >
      <table className="portal-lead-table w-full min-w-[620px]! text-left text-sm">
        <thead>
          <tr>
            <th>Reason</th>
            <th className="w-[74px] text-right">Rows</th>
            {canSeeMoney && <th className="w-[100px] text-right">Claimable</th>}
            <th className="w-[300px] text-right">Next step</th>
          </tr>
        </thead>
        <tbody className="m-seq">
          {rows.map((row) => {
            const ui = REMOVAL[row.reason];
            const fix = REMOVAL_FIX[row.reason];
            const creditable = row.claimableCents != null;
            const canClaim = canSeeMoney && creditable && d.claims.supported && row.unclaimedRows > 0 && windowOpen;
            const onClaim = creditable && d.claims.supported && row.claimableRows > 0 && row.unclaimedRows === 0 && windowOpen;
            // Your own list and later suppressions are exported whole; the vendor's defects as the claimable rows.
            const exportRows = row.reason === "internal_dnc" || row.reason === "suppressed" ? row.rows : row.claimableRows;
            return (
              <tr key={row.reason} className="m-row">
                <td>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                    <span className={cn("size-[7px] shrink-0 rounded-full", ui.tone === "danger" ? "bg-[var(--error)]" : "bg-[var(--muted-foreground)]")} aria-hidden="true" />
                    {ui.label}
                  </span>
                  {row.rescrubRows > 0 && <span className="block text-xs text-[var(--muted)]">{count(row.rescrubRows)} found by a later re-scrub · not claimable</span>}
                </td>
                <td className="text-right tabular-nums">{count(row.rows)}</td>
                {canSeeMoney && <td className="text-right tabular-nums">{row.claimableCents == null ? "—" : money(row.claimableCents)}</td>}
                <td>
                  <span className="flex flex-wrap items-center justify-end gap-2">
                    {canClaim ? (
                      <LeadListClaimButton
                        campaignId={d.campaignId}
                        reason={row.reason}
                        rows={row.unclaimedRows}
                        amount={money(Math.round(row.unclaimedRows * (d.costPerRecordCents ?? 0)))}
                        blocked={claim?.blocked ?? null}
                        onDone={claim?.onDone}
                        label={`Claim credit · ${count(row.unclaimedRows)}`}
                        size="sm"
                      />
                    ) : onClaim ? (
                      <StatusChip tone="info">On a claim</StatusChip>
                    ) : canSeeMoney && (row.reason === "tcpa_litigator" || row.reason === "invalid") && row.claimableRows > 0 && !windowOpen ? (
                      // The do-not-call and repeat rows keep saying what happened to them; these two
                      // only had a claim to offer, and it has run out.
                      <StatusChip tone="neutral">Window closed</StatusChip>
                    ) : (
                      <StatusChip tone={fix.tone}>{fix.state}</StatusChip>
                    )}
                    {canSeeMoney && exportRows > 0 && (
                      <Button asChild type="button" variant="ghost" size="sm">
                        <a href={`${exportHref}&reason=${row.reason}`} download aria-label={`Export the ${count(exportRows)} ${ui.label} rows`}>
                          <Download aria-hidden="true" />Export
                        </a>
                      </Button>
                    )}
                    <InfoTip label={`About ${ui.label}`} side="left">{fix.tip}</InfoTip>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
        {rows.length > 1 && (
          <tfoot>
            <tr className="bg-[var(--surface-alt)] text-sm font-semibold text-foreground [&>td]:border-t [&>td]:border-[var(--border-strong)] [&>td]:px-3 [&>td]:py-2.5">
              <td>{count(d.recordsUsable)} usable · {count(removed)} removed</td>
              <td className="text-right tabular-nums">{count(removed)}</td>
              {canSeeMoney && <td className="text-right tabular-nums">{money(claimableCents)}</td>}
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </TableCard>
  );
}

/** The import that opens with this list (and its vendor) already chosen, as Source's "Import its list". */
const importHref = (d: LeadListDetail) => `/app/import?campaign=${d.campaignId}`;

/**
 * The vendor's saved column map: which of their headers became which field, so their next file
 * imports without mapping again.
 */
export function MappingCard({ detail: d }: { detail: LeadListDetail }) {
  const mapped = d.mapping.rows.filter((row) => row.field).length;
  const tip = <InfoTip label="About the column map">Remembered per vendor and product. Their next file maps itself on import.</InfoTip>;
  if (d.mapping.rows.length === 0) {
    return (
      <TableCard>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--surface-alt)] text-muted-foreground"><Columns3 className="size-4" aria-hidden="true" /></span>
          <span className="inline-flex min-w-0 flex-1 items-center gap-0.5 text-sm font-semibold text-foreground">No column map saved for {d.vendorName}{tip}</span>
          <Button asChild type="button" variant="outline" size="sm"><Link href={importHref(d)}>Map on next import</Link></Button>
        </div>
      </TableCard>
    );
  }
  return (
    <PagedTableCard
      total={d.mapping.rows.length}
      noun="columns"
      title="Column map"
      action={
        <>
          <StatusChip tone="good">{count(mapped)} of {count(d.mapping.rows.length)} mapped · {d.vendorName}</StatusChip>
          {tip}
          <Button asChild type="button" variant="outline" size="sm">
            <Link href={importHref(d)}>Edit on next import</Link>
          </Button>
        </>
      }
    >
      <table className="portal-lead-table w-full min-w-[480px]! text-left text-sm">
        <thead>
          <tr>
            <th className="w-[200px]">Their column</th>
            <th className="w-[28px]"><span className="sr-only">becomes</span></th>
            <th>Your field</th>
            <th className="w-[180px]">Sample</th>
          </tr>
        </thead>
        <PagedBody className="m-seq">
          {d.mapping.rows.map((row) => (
            <tr key={row.header} className="m-row">
              <td className="font-semibold">{row.header}</td>
              <td className="text-muted-foreground"><ArrowRight className="size-3.5" aria-hidden="true" /></td>
              <td>{row.field ? row.fieldLabel : <span className="text-muted-foreground">Ignored</span>}</td>
              <td className="max-w-[180px] truncate text-muted-foreground" title={row.sample || undefined}>{row.sample || "—"}</td>
            </tr>
          ))}
        </PagedBody>
      </table>
    </PagedTableCard>
  );
}

/** What the list cost per record bought, per record usable, and per policy it turned into. */
export function ListEconomics({ detail: d, money: canSeeMoney, spend = true }: {
  detail: LeadListDetail;
  money: boolean;
  /** May this person see what the list cost (owner, producer)? An assistant sees the inventory only. */
  spend?: boolean;
}) {
  const { netSpend } = listFigures(d);
  const contactRate = d.dialed > 0 ? (100 * d.contacted) / d.dialed : null;
  if (!spend) {
    return (
      <StatStrip label="List figures">
        <StatTile label="Records bought" value={count(d.recordsPurchased)} footnote={`${count(d.recordsUsable)} usable after scrub`} />
        <StatTile
          label="Contact rate"
          value={contactRate == null ? "—" : `${contactRate.toFixed(1)}%`}
          valueTone={contactRate == null ? undefined : "good"}
          footnote={d.dialed > 0 ? `${count(d.contacted)} of ${count(d.dialed)} dialed` : "nobody dialed yet"}
        />
      </StatStrip>
    );
  }
  return (
    <StatStrip label="List economics">
      <StatTile label="Paid per record" value={perRecord(d.costPerRecordCents)} footnote={`${wholeMoney(d.totalSpendCents)} / ${count(d.recordsPurchased)} rows`} />
      <StatTile
        label="Cost per usable record"
        value={perRecord(d.costPerUsableCents)}
        valueTone="primary"
        footnote={
          <span className="inline-flex items-center gap-0.5">
            {`${wholeMoney(netSpend)} / ${count(d.recordsUsable)} after scrub`}
            <InfoTip label="About cost per usable record">Net spend over the rows that survived the scrub. From {REPEATS_COUNTED_FROM}, a number repeated inside a file counts as removed.</InfoTip>
          </span>
        }
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
        reserveFootnote
      />
    </StatStrip>
  );
}

/** How far the list is worked through, as five meters. */
export function ListHealthCard({ detail: d }: { detail: LeadListDetail }) {
  return (
    <TableCard title="List health">
      <div className="px-4 pb-1.5">
        <HealthRow label="Dialed at least once" value={d.dialed} of={d.leadsReceived} tone="info" />
        <HealthRow label="Never dialed" value={d.neverDialed} of={d.leadsReceived} tone="warning" />
        <HealthRow label="Stuck outside their window" value={d.outsideWindow} of={d.leadsReceived} tone={d.outsideWindow ? "warning" : "good"} />
        <HealthRow label={`Exhausted at ${(d.attemptCeilings ?? [d.attemptCeiling]).join(" or ")} attempts`} value={d.exhausted} of={d.leadsReceived} tone="neutral" />
        <HealthRow label="Contacted" value={d.contacted} of={d.leadsReceived} tone="good" />
      </div>
    </TableCard>
  );
}

/**
 * Consent proof: the TrustedForm / Jornaya certificates that show each person agreed to be called,
 * which is what you produce when a lead complains. A meter coloured by how much of the list is
 * covered, the gap with its export, and the vendor's own rate across everything it sold.
 */
export function ConsentCard({ detail: d, timeZone, exportHref = null }: {
  detail: LeadListDetail;
  timeZone: string | null;
  /** "Export missing": the leads with no certificate, as a CSV. Null hides it (no consent locker). */
  exportHref?: string | null;
}) {
  const total = d.leadsReceived;
  const proof = d.consent.supplied;
  const missing = Math.max(0, total - proof);
  const share = total > 0 ? proof / total : null;
  const tone: MeterTone = share == null ? "neutral" : share >= 0.9 ? "good" : share >= 0.5 ? "warning" : "danger";
  const ink = tone === "good" ? "text-[var(--success-ink)]" : tone === "warning" ? "text-[var(--warning-ink)]" : tone === "danger" ? "text-[var(--error-ink)]" : "text-foreground";
  const vendorRate = d.consent.vendorRatePct;
  return (
    <TableCard
      title="Consent proof"
      action={<InfoTip label="About consent proof" side="left">A TrustedForm or Jornaya certificate shows the person agreed to be called. Keep one for every lead you dial: it is your answer to a TCPA complaint.</InfoTip>}
    >
      <div className="flex flex-col gap-3 border-t border-border px-4 py-4">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">No leads have arrived yet.</p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <ShieldCheck className={cn("size-4 shrink-0", ink)} aria-hidden="true" />
              <span className={cn("shrink-0 text-sm font-semibold tabular-nums", ink)}>{count(proof)} of {count(total)} have proof</span>
              <Meter value={proof} max={total} tone={tone} label={`Consent proof: ${proof} of ${total} leads`} className="h-1.5 flex-1 bg-[var(--border)] [&>span]:h-1.5" />
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              <div>
                <dt className="text-xs font-semibold text-muted-foreground">Missing</dt>
                <dd className={cn("mt-0.5 flex flex-wrap items-center gap-2 text-sm font-semibold tabular-nums", missing > 0 ? "text-[var(--error-ink)]" : "text-foreground")}>
                  {count(missing)}
                  {missing > 0 && exportHref && (
                    <Button asChild type="button" variant="ghost" size="sm">
                      <a href={exportHref} download aria-label={`Export the ${count(missing)} leads with no consent proof`}><Download aria-hidden="true" />Export missing</a>
                    </Button>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-muted-foreground">TrustedForm</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{count(d.consent.trustedForm)}</dd>
              </div>
              <div>
                <dt className="inline-flex items-center gap-0.5 text-xs font-semibold text-muted-foreground">
                  Oldest certificate
                  <InfoTip label="About the oldest certificate">When the earliest certificate on this list was captured.</InfoTip>
                </dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{d.consent.oldestCapturedAt ? fullDay(d.consent.oldestCapturedAt, timeZone) : "—"}</dd>
              </div>
              <div>
                <dt className="inline-flex items-center gap-0.5 text-xs font-semibold text-muted-foreground">
                  Vendor rate
                  <InfoTip label="About the vendor's consent rate">Share of every lead {d.vendorName} sold you that came with a certificate.</InfoTip>
                </dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{vendorRate == null ? "—" : `${vendorRate.toFixed(1)}%`}</dd>
              </div>
            </dl>
          </>
        )}
      </div>
    </TableCard>
  );
}

export function LeadListDetailView({
  detail,
  money: canSeeMoney,
  timeZone,
  assign = { manager: false, blocked: null },
  claimBlocked = null,
}: {
  detail: LeadListDetail;
  money: boolean;
  timeZone: string | null;
  /** manager: owner or producer. blocked: why assigning is off for them (plan, read-only), or null. */
  assign?: { manager: boolean; blocked: string | null };
  /** Why drafting a claim is off (a read-only plan), or null. */
  claimBlocked?: string | null;
}) {
  const d = detail;
  const { removed, claimableRows, exportHref, unassigned } = listFigures(d);

  const canClaim = canSeeMoney && d.claims.supported && d.claims.unclaimedRows > 0 && !claimBlocked;
  const canAssign = assign.manager && d.assignable > 0 && !assign.blocked;
  const closingSoon = d.returnDaysLeft != null && d.returnDaysLeft > 0 && d.returnDaysLeft <= 3;
  const nextStep: { text: ReactNode; action: ReactNode } | null =
    canClaim && closingSoon
      ? { text: <>The return window closes in <strong className="font-semibold text-[var(--ink)]">{d.returnDaysLeft} {d.returnDaysLeft === 1 ? "day" : "days"}</strong> — {count(d.claims.unclaimedRows)} rows ({money(d.claims.unclaimedCents)}) are still unclaimed.</>, action: <LeadListClaimButton campaignId={d.campaignId} rows={d.claims.unclaimedRows} amount={money(d.claims.unclaimedCents)} blocked={claimBlocked} /> }
      : canAssign
        ? { text: <><strong className="font-semibold text-[var(--ink)]">{count(d.assignable)}</strong> usable {d.assignable === 1 ? "lead has" : "leads have"} no owner yet. Assign them so they reach the dialer.</>, action: <LeadListAssignDrawer campaignId={d.campaignId} listName={d.campaignName} assignable={d.assignable} /> }
        : canClaim
          ? { text: <>{count(d.claims.unclaimedRows)} rows the vendor owes you for ({money(d.claims.unclaimedCents)}) are not claimed yet.</>, action: <LeadListClaimButton campaignId={d.campaignId} rows={d.claims.unclaimedRows} amount={money(d.claims.unclaimedCents)} blocked={claimBlocked} /> }
          : d.poolBlockers && d.poolBlockers.total > 0
            ? { text: <>{count(d.poolBlockers.total)} leads in the pool are not being served. The <strong className="font-semibold text-[var(--ink)]">Not being served</strong> tab says what unblocks each.</>, action: null }
            : null;

  return (
    // 2026-10-26: a list's page on the moving ribbon, like Lead sources it opens from.
    <>
    <div className="m-stagger flex flex-col gap-6">
      <Link
        href="/app/lead-sources"
        className="-mb-3 inline-flex w-fit items-center gap-1.5 text-sm font-semibold tracking-[-0.01em] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Lead sources
      </Link>
      <PageHeader
        title={d.campaignName}
        description={listSubtitle(d, timeZone, assign.manager)}
        actions={
          <>
            {canSeeMoney && d.claims.supported && d.claims.unclaimedRows > 0 && (
              <LeadListClaimButton campaignId={d.campaignId} rows={d.claims.unclaimedRows} amount={money(d.claims.unclaimedCents)} blocked={claimBlocked} />
            )}
            {canSeeMoney && claimableRows > 0 && (
              <Button asChild type="button" variant="outline">
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
              <Button type="button" disabled aria-describedby="assign-blocked">Assign the {count(d.assignable)}</Button>
            )}
            {(!assign.manager || d.assignable === 0) && unassigned > 0 && (
              <Button asChild type="button" variant="outline">
                <Link href={`/app/lead-lists#${d.campaignId}`}>See the {count(unassigned)} unassigned</Link>
              </Button>
            )}
          </>
        }
      />

      {assign.manager && d.assignable > 0 && assign.blocked && (
        <p id="assign-blocked" role="status" className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-surface)] px-4 py-2.5 text-sm text-[var(--warning-ink)]">{assign.blocked}</p>
      )}

      <ListEconomics detail={d} money={canSeeMoney} spend={assign.manager} />

      {nextStep && (
        <section aria-label="Next step" className="m-glass flex flex-wrap items-center gap-4 rounded-xl border border-border px-4 py-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--primary-soft)] text-[var(--accent-ink)]"><ArrowRight className="size-4" aria-hidden="true" /></span>
          <span className="min-w-0 flex-1 text-sm text-[var(--body)]"><span className="block text-xs font-semibold text-[var(--accent-ink)]">Next step</span>{nextStep.text}</span>
          {nextStep.action}
        </section>
      )}

      {/* 2026-10-06 redesign: the three long sections are tabs, one at a time; health and consent
          stay beside them, always in view. */}
      <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-grow">
          <TabbedPanels
            label="List sections"
            tabs={[
              { key: "removals", label: "Removed at import", count: removed, panel: <RemovalsCard detail={d} money={canSeeMoney} /> },
              ...(d.poolBlockers && d.poolBlockers.total > 0
                ? [{ key: "pool", label: "Not being served", count: d.poolBlockers.total, panel: <PoolBlockersCard pool={d.poolBlockers} /> }]
                : []),
              { key: "mapping", label: "Column map", count: d.mapping.rows.length, panel: <MappingCard detail={d} /> },
            ]}
          />
        </div>
        <div className="flex w-full shrink-0 flex-col gap-6 xl:w-[420px]">
          <ListHealthCard detail={d} />
          <ConsentCard detail={d} timeZone={timeZone} />
        </div>
      </div>
    </div>
    </>
  );
}

import { DashBars, DashChart, DashHero, DashLayout, DashList, DashNeeds, DashRing, DashTable, type DashNeed } from "@/components/app/home/dash/dash-kit";
import { LineSeries } from "@/components/ui/chart";
import { CATEGORY_LABELS, type ComplaintCategory } from "@/lib/compliance/complaints";
import {
  BLOCKED_LABELS,
  consentShare,
  daysUntil,
  dialingState,
  dueText,
  loadComplianceView,
  maskPhone,
  newestEvents,
  reasonBars,
  sortDeadlines,
  whenText,
  type BlockedOutcome,
  type ComplianceViewData,
  type DeadlineRow,
  type EventRow,
} from "@/lib/dashboard/views/compliance";

import type { DashViewProps } from "./view-props";

/**
 * The Compliance view of /app/dashboard (owner 2026-11-06). Am I safe to dial, what waits on me, how screening
 * went this month, how much consent is on file, which deadlines come next, and what happened lately. Every
 * figure opens the page behind it; a card whose read failed, or whose page this reader cannot open, is left out.
 */
const n = (value: number) => value.toLocaleString("en-US");
const regulator = (channel: string, state: string | null) => (channel === "ftc" ? "FTC complaint" : channel === "doi" ? `${state ? `${state} ` : ""}DOI complaint` : "Complaint");

/** The view's Needs you, also read by the Overview. */
export function complianceNeeds(data: ComplianceViewData): DashNeed[] {
  const nowMs = data.now.getTime();
  const needs: DashNeed[] = [];
  const feeds = data.overview ? dialingState(data.overview) : null;
  if (feeds && feeds.failing > 0) needs.push({ key: "feeds", count: feeds.failing, label: feeds.failing === 1 ? "DNC feed failing" : "DNC feeds failing", detail: "Numbers may not be screened", tone: "danger", href: "/app/tcpa" });
  if (data.complaints && data.complaints.length) {
    const first = data.complaints[0];
    const urgent = data.complaints.some((row) => row.countdown.tone === "overdue" || row.countdown.tone === "red");
    needs.push({
      key: "complaints",
      count: data.complaints.length,
      label: data.complaints.length === 1 ? "Open complaint" : "Open complaints",
      detail: `Soonest: ${first.countdown.label}`,
      tone: urgent ? "danger" : "warning",
      href: data.complaints.length === 1 ? `/app/complaints/${first.id}` : "/app/complaints",
    });
  }
  if (data.expiring && data.expiring.length) {
    const lapsed = data.expiring.some((row) => daysUntil(row.expiresAt, nowMs) < 0);
    needs.push({ key: "expiring", count: data.expiring.length, label: "Licences & appointments expiring", detail: lapsed ? "Some have already expired" : "Within 30 days", tone: lapsed ? "danger" : "warning", href: "/app/appointments" });
  }
  if (data.deletions && data.deletions.toVerify + data.deletions.ready > 0) {
    const { toVerify, ready } = data.deletions;
    needs.push({
      key: "deletions",
      count: toVerify + ready,
      label: "Deletion requests",
      detail: [toVerify ? `${n(toVerify)} to verify` : "", ready ? `${n(ready)} ready to delete` : ""].filter(Boolean).join(" · "),
      tone: "warning",
      href: ready && !toVerify ? "/app/deletion-requests?queue=ready" : "/app/deletion-requests",
    });
  }
  if (data.consent && data.consent.textMissing > 0) needs.push({ key: "consent", count: data.consent.textMissing, label: "Leads without consent text", detail: "No claimed certificate copy", tone: "warning", href: "/app/consent" });
  return needs;
}

/** One figure for the Overview's "Your modules": whether dialing is safe. */
export function complianceHeadline(data: ComplianceViewData): { figure: string; line: string } | null {
  const feeds = data.overview ? dialingState(data.overview) : null;
  if (feeds) return { figure: feeds.value, line: feeds.line };
  if (data.complaints) return { figure: n(data.complaints.length), line: data.complaints.length === 1 ? "open complaint" : "open complaints" };
  return null;
}

export async function ComplianceView(props: DashViewProps) {
  const data = await loadComplianceView(props);
  const { can, now } = data;
  const nowMs = now.getTime();
  const zone = props.zone;

  /* Needs you ─────────────────────────────────────────────────────────────────────────────────── */
  const needs = complianceNeeds(data);
  const feeds = data.overview ? dialingState(data.overview) : null;

  /* Big: screened vs blocked per day ─────────────────────────────────────────────────────────────── */
  const big = data.screening ? (
    <DashChart
      title="Numbers screened"
      link={{ label: "Screening log", href: "/app/tcpa" }}
      total={n(data.screening.total)}
      totalLine={`screened this month · ${n(data.screening.totalBlocked)} blocked`}
      legend={[{ label: "Screened", tone: "primary" }, { label: "Blocked", tone: "info" }]}
    >
      <LineSeries
        points={data.screening.screened}
        compare={{ points: data.screening.blocked, label: "Blocked" }}
        summary={`${n(data.screening.total)} numbers screened this month, ${n(data.screening.totalBlocked)} blocked.`}
        unit="screened"
        hrefFor={() => "/app/tcpa"}
      />
    </DashChart>
  ) : null;

  /* Side: consent on file ──────────────────────────────────────────────────────────────────────── */
  const share = data.consent ? consentShare(data.consent) : null;
  const side = share ? (
    <DashRing
      title="Consent on file"
      link={{ label: "Consent locker", href: "/app/consent" }}
      value={share.pct ?? 0}
      center={share.pct === null ? "No leads" : `${share.pct}%`}
      label={share.pct === null ? "No leads yet" : `${share.pct}% of leads hold the consent text`}
      tone={share.tone}
      lines={[
        { label: "With consent text", value: `${n(share.withText)} of ${n(share.leads)}`, href: "/app/consent" },
        { label: "With IP address", value: n(share.withIp), href: "/app/consent" },
        { label: "Gaps found", value: n(share.gaps), href: "/app/consent" },
      ]}
    />
  ) : null;

  /* Left: why numbers were blocked ─────────────────────────────────────────────────────────────── */
  const left = data.screening ? (
    <DashBars
      title="Why numbers were blocked"
      period="this month"
      link={{ label: "Suppression list", href: "/app/tcpa" }}
      rows={reasonBars(data.screening.byReason).map((row) => ({ ...row, shown: n(row.value), href: "/app/tcpa" }))}
    />
  ) : null;

  /* Right: deadlines ───────────────────────────────────────────────────────────────────────────── */
  const deadlines: DeadlineRow[] = [];
  for (const row of data.complaints ?? []) {
    if (row.countdown.tone === "none") continue;
    const who = row.complainantName ?? row.owner.name;
    if (row.countdown.tone === "no_deadline") deadlines.push({ key: `c_${row.id}`, what: regulator(row.channel, row.regulatorState), who, due: "Not set", dueAt: -Infinity, href: `/app/complaints/${row.id}` });
    else if (row.responseDueAt) deadlines.push({ key: `c_${row.id}`, what: regulator(row.channel, row.regulatorState), who, due: dueText(daysUntil(row.responseDueAt, nowMs)), dueAt: Date.parse(row.responseDueAt), href: `/app/complaints/${row.id}` });
  }
  for (const row of data.deletions?.all ?? []) {
    if (row.status !== "scheduled" || !row.scheduledPurgeAt) continue;
    deadlines.push({ key: `d_${row.id}`, what: "Deletion hold ends", who: row.requesterName ?? maskPhone(row.phoneDigits), due: dueText(daysUntil(row.scheduledPurgeAt, nowMs)), dueAt: Date.parse(row.scheduledPurgeAt), href: `/app/deletion-requests/${row.id}` });
  }
  for (const row of data.expiring ?? []) {
    deadlines.push({ key: row.key, what: row.label, who: "Agency", due: dueText(daysUntil(row.expiresAt, nowMs)), dueAt: Date.parse(`${row.expiresAt.slice(0, 10)}T00:00:00Z`), href: "/app/appointments" });
  }
  const showDeadlines = data.complaints !== null || data.deletions !== null || data.expiring !== null;
  const right = showDeadlines ? (
    <DashTable
      title="Deadlines"
      period="soonest first"
      heads={["What", "Who", "Due"]}
      rows={sortDeadlines(deadlines).map((row) => ({ key: row.key, cells: [row.what, row.who, row.due], href: row.href }))}
      empty="No deadline is coming up."
    />
  ) : null;

  /* Hero: dialing state ────────────────────────────────────────────────────────────────────────── */
  const facts: Array<{ label: string; value: string }> = [];
  if (data.screening) facts.push({ label: "Blocked today", value: n(data.screening.blockedToday) });
  if (data.lastCheck) facts.push({ label: "Last check", value: whenText(data.lastCheck, nowMs, zone) });
  const hero = feeds ? (
    <DashHero kicker="Dialing" value={feeds.value} line={feeds.line} facts={facts} href="/app/tcpa" />
  ) : null;

  /* List: recent events ────────────────────────────────────────────────────────────────────────── */
  const events: EventRow[] = [];
  for (const row of data.recentBlocked ?? []) {
    events.push({
      key: `b_${row.ts}_${row.phone_digits ?? ""}`,
      at: row.ts,
      mark: "⊘",
      tone: "danger",
      title: "Number blocked",
      detail: `${BLOCKED_LABELS[row.outcome as BlockedOutcome] ?? "Blocked"} · ${maskPhone(row.phone_digits)}`,
      href: row.lead_id && can.leads ? `/app/leads/${row.lead_id}` : "/app/tcpa",
    });
  }
  for (const row of data.receivedComplaints ?? []) {
    events.push({ key: `c_${row.id}`, at: row.receivedAt, mark: "!", tone: "warning", title: "Complaint received", detail: `${regulator(row.channel, row.regulatorState)} · ${CATEGORY_LABELS[row.category as ComplaintCategory] ?? row.category}`, href: `/app/complaints/${row.id}` });
  }
  for (const row of data.artefacts ?? []) {
    events.push({ key: `a_${row.id}`, at: row.captured_at, mark: "✓", tone: "good", title: "Consent added", detail: row.provider ? `Certificate · ${row.provider}` : "Certificate", href: `/app/consent/${row.id}` });
  }
  for (const row of (data.deletions?.all ?? []).slice(0, 5)) {
    events.push({ key: `d_${row.id}`, at: row.receivedAt, mark: "×", tone: "info", title: "Deletion request", detail: row.requesterName ?? maskPhone(row.phoneDigits), href: `/app/deletion-requests/${row.id}` });
  }
  const showList = data.recentBlocked !== null || data.receivedComplaints !== null || data.artefacts !== null || data.deletions !== null;
  const list = showList ? (
    <DashList
      title="Recent events"
      period="newest first"
      items={newestEvents(events).map((row) => ({ key: row.key, mark: row.mark, tone: row.tone, title: row.title, detail: row.detail, when: whenText(row.at, nowMs, zone), href: row.href }))}
      empty="Nothing has happened yet."
    />
  ) : null;

  // Most urgent first; and when no source answered, no "nothing is waiting" all-clear either.
  const rank = { danger: 0, warning: 1, info: 2, good: 3, neutral: 4 } as const;
  const answered = [data.overview, data.complaints, data.expiring, data.deletions, data.consent].some((source) => source !== null);
  const needsCard = answered ? <DashNeeds items={needs.map((need, order) => ({ need, order })).sort((a, b) => rank[a.need.tone] - rank[b.need.tone] || a.order - b.order).map(({ need }) => need)} /> : null;

  return <DashLayout needs={needsCard} big={big} side={side} left={left} right={right} hero={hero} list={list} />;
}

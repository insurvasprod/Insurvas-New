import { DashBars, DashChart, DashHero, DashLayout, DashList, DashNeeds, DashRing, DashTable, type DashItem, type DashNeed, type DashTone } from "@/components/app/home/dash/dash-kit";
import { HomePanel } from "@/components/app/home/home-panel";
import { LineSeries } from "@/components/ui/chart";
import { personName } from "@/lib/format/personName";
import type { Step } from "@/lib/retention/cases/ladder";
import { casesHref, loadRetentionView, type RetentionViewData, monthHref, rateText, SCORE_PERIOD, CHART_MONTHS } from "@/lib/dashboard/views/retention";

import type { DashViewProps } from "./view-props";

/**
 * The dashboard's Retention view (owner 2026-11-06, /app/dashboard?view=retention): what waits on the ladder,
 * Waiting on the carrier and Win-back; premium saved against premium lost by month; the save rate; why
 * policies are at risk; the cases closing soonest; this month's saves; and the latest saves, lapses and
 * carrier confirmations. Every figure opens the page behind it, filtered the way that page reads its address.
 */
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const n = (value: number) => value.toLocaleString("en-US");
const nameOf = (raw: string | null, policyNumber: string) => (raw ? personName(raw) : `Policy ${policyNumber}`);
const STEP_TONE: Record<Step, DashTone> = { payment_problem: "warning", pending_lapse: "warning", lapsed_reinstatable: "danger", lost: "danger", paperwork: "info" };
const shortDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const when = (iso: string, zone: string) => {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: zone });
  } catch {
    return shortDay(iso);
  }
};

/** The view's Needs you, also read by the Overview. */
export function retentionNeeds(data: RetentionViewData): DashNeed[] {
  const { links, cases, servicing, winback } = data;
  const needs: DashNeed[] = [];
  if (cases && links.cases) {
    needs.push({ key: "past-due", count: cases.pastDue, label: "Past their carrier deadline", detail: "cases at their risk point today", tone: "danger", href: casesHref(links.cases, { deadline: "over" }) });
  }
  if (servicing && links.servicing) {
    needs.push({ key: "servicing", count: servicing.overdue, label: "Carrier changes to check", detail: "sent, not shown in a file", tone: "warning", href: `${links.servicing}?status=check` });
  }
  if (winback && links.winback) {
    needs.push({ key: "claims", count: winback.claims, label: "Possible claims", detail: "lapsed after a reported death", tone: "danger", href: `${links.winback}?show=claims` });
  }
  if (cases && links.cases) {
    needs.push({ key: "mailed-bill", count: cases.mailedBills, label: "Paper bills to switch", detail: "move them to bank draft", tone: "info", href: casesHref(links.cases, { step: "paperwork", reason: "mailed_bill" }) });
  }
  if (winback && links.winback) {
    needs.push({ key: "winback", count: winback.ready, label: "Ready for win-back", detail: "cooling-off is over", tone: "good", href: `${links.winback}?show=released` });
  }
  return needs;
}

/** One figure for the Overview's "Your modules". */
export function retentionHeadline(data: RetentionViewData, noMoney: boolean): { figure: string; line: string } | null {
  const month = data.cases?.thisMonth;
  if (!month || !data.links.cases) return null;
  return noMoney ? { figure: n(month.saved), line: "saved this month" } : { figure: `${usd(month.savedCents)}/mo`, line: `saved this month · ${n(month.saved)} ${month.saved === 1 ? "case" : "cases"}` };
}

export async function RetentionView(props: DashViewProps) {
  const { noMoney, zone } = props;
  const data = await loadRetentionView(props);
  const { links, cases, servicing, advanceKept, persistency13, today } = data;
  const closedHref = links.cases ? casesHref(links.cases, { step: "closed" }) : null;

  const needs = retentionNeeds(data);

  /* Big: premium saved vs lost by month */
  const months = cases?.months ?? [];
  const savedPoints = months.map((m) => ({ key: m.start, label: m.label, value: noMoney ? m.saved : m.savedCents }));
  const lostPoints = months.map((m) => ({ key: m.start, label: m.label, value: noMoney ? m.lost : m.lostCents }));
  const savedTotal = savedPoints.reduce((sum, p) => sum + p.value, 0);
  const anyClosed = months.some((m) => m.saved + m.lost > 0);
  const big = cases && anyClosed ? (
    <DashChart
      title={noMoney ? "Saved and lost" : "Premium saved and lost"}
      link={closedHref ? { label: "Closed cases", href: closedHref } : undefined}
      total={noMoney ? n(savedTotal) : usd(savedTotal)}
      totalLine={noMoney ? `cases saved · last ${CHART_MONTHS} months` : `a month kept · last ${CHART_MONTHS} months`}
      legend={[{ label: "Saved", tone: "primary" }, { label: "Lost", tone: "info" }]}
    >
      <LineSeries
        points={savedPoints}
        compare={{ points: lostPoints, label: "Lost" }}
        summary={noMoney ? `Cases saved and lost each month, last ${CHART_MONTHS} months, from closed Retention cases.` : `Monthly premium on cases saved and lost each month, last ${CHART_MONTHS} months, from closed Retention cases.`}
        format={noMoney ? n : usd}
        labels="all"
        minHeight={200}
        hrefFor={(point) => monthHref(point.key, today, links)}
      />
    </DashChart>
  ) : cases ? (
    <HomePanel title={noMoney ? "Saved and lost" : "Premium saved and lost"} link={closedHref ? { label: "Closed cases", href: closedHref } : undefined}>
      <p className="m-0 text-sm text-muted-foreground">A month shows here once a carrier file closes a case as saved or lost.</p>
    </HomePanel>
  ) : null;

  /* Side: save rate */
  const score = cases?.score ?? null;
  const decided = score ? score.saved + score.lost : 0;
  const scoreHref = links.scorecard ? `${links.scorecard}?period=${SCORE_PERIOD}` : closedHref;
  const side = score ? (
    <DashRing
      title="Save rate"
      link={scoreHref ? { label: "Scorecard", href: scoreHref } : undefined}
      value={score.saved}
      max={Math.max(1, decided)}
      center={rateText(score)}
      label={decided ? `${n(score.saved)} of ${n(decided)} decided cases saved, last 6 months` : "No case decided in the last 6 months"}
      lines={[
        { label: "Cases saved · 6 months", value: n(score.saved), href: closedHref ?? undefined },
        ...(!noMoney && advanceKept ? [{ label: "Chargebacks avoided", value: usd(advanceKept.cents), href: closedHref ?? undefined }] : []),
        ...(persistency13 && links.persistency ? [{ label: "13-month persistency", value: persistency13.text, href: `${links.persistency}?view=persistency` }] : []),
      ]}
    />
  ) : null;

  /* Left: why policies are at risk */
  const reasons = cases?.byReason.slice(0, 6) ?? [];
  const left = cases && links.cases ? (
    reasons.length ? (
      <DashBars
        title="Why policies are at risk"
        period="open cases"
        link={{ label: "Cases", href: links.cases }}
        rows={reasons.map((r) => ({ key: r.reason, label: r.label, value: r.count, shown: n(r.count), tone: STEP_TONE[r.step], href: casesHref(links.cases!, { reason: r.reason }) }))}
      />
    ) : (
      <HomePanel title="Why policies are at risk" link={{ label: "Cases", href: links.cases }}>
        <p className="m-0 text-sm text-muted-foreground">No open case: a policy shows here when a carrier file flags it.</p>
      </HomePanel>
    )
  ) : null;

  /* Right: closing soonest */
  const right = cases && links.cases ? (
    <DashTable
      title="Closing soonest"
      period="by carrier deadline"
      link={{ label: "Due this week", href: casesHref(links.cases, { deadline: "week" }) }}
      heads={noMoney ? ["Client", "Days left", "Lapse date"] : ["Client", "$/mo", "Lapse date"]}
      rows={cases.closingSoon.map((c) => ({
        key: c.id,
        href: `${links.cases}/${c.id}`,
        cells: [
          nameOf(c.clientName, c.policyNumber),
          noMoney ? (c.daysLeft === 0 ? "Today" : `${n(c.daysLeft ?? 0)} days`) : c.monthlyCents === null ? "—" : usd(c.monthlyCents),
          c.deadline ? shortDay(c.deadline) : "—",
        ],
      }))}
      empty="No open case has a carrier deadline ahead."
    />
  ) : null;

  /* Hero: saved this month */
  const month = cases?.thisMonth ?? null;
  const hero = month && closedHref ? (
    <DashHero
      kicker={noMoney ? "Saved this month" : "Premium saved this month"}
      value={noMoney ? n(month.saved) : `${usd(month.savedCents)}/mo`}
      line={noMoney ? "cases a carrier file proved saved" : `${n(month.saved)} ${month.saved === 1 ? "case" : "cases"} a carrier file proved saved`}
      facts={[{ label: "Lost", value: n(month.lost) }, { label: "Open now", value: n(cases!.open) }]}
      href={closedHref}
    />
  ) : null;

  /* List: recent saves, lapses, carrier confirmations */
  const items: Array<DashItem & { at: string }> = [];
  if (cases && links.cases) {
    for (const c of cases.recent.slice(0, 6)) {
      const saved = c.status === "saved";
      items.push({
        key: `case-${c.id}`, at: c.resolvedAt ?? "", mark: saved ? "✓" : "✕", tone: saved ? "good" : "danger",
        title: nameOf(c.clientName, c.policyNumber), detail: `${saved ? "Saved" : "Lapsed"} · ${c.carrierName}`,
        value: noMoney || c.monthlyCents === null ? undefined : `${usd(c.monthlyCents)}/mo`, when: c.resolvedAt ? when(c.resolvedAt, zone) : undefined,
        href: `${links.cases}/${c.id}`,
      });
    }
  }
  if (servicing && links.servicing) {
    for (const r of servicing.confirmations) {
      items.push({
        key: `svc-${r.id}`, at: r.verifiedAt, mark: "↻", tone: "info",
        title: nameOf(r.clientName, r.policyNumber), detail: `Carrier change confirmed · ${r.carrierName}`, when: when(r.verifiedAt, zone),
        href: `${links.servicing}/${r.id}`,
      });
    }
  }
  const latest = items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6).map(({ at: _at, ...item }) => item); // eslint-disable-line @typescript-eslint/no-unused-vars
  const list = links.cases || links.servicing ? (
    <DashList title="Latest" period="saves, lapses, carrier confirmations" link={closedHref ? { label: "Closed cases", href: closedHref } : undefined} items={latest} empty="Saves, lapses and carrier confirmations show here as the files bring them." />
  ) : null;

  return <DashLayout needs={<DashNeeds items={needs} />} big={big} side={side} left={left} right={right} hero={hero} list={list} />;
}

/**
 * The home's lead-to-money map (redesign 2026-10-25), as figures. Pure: it reads the DealFlow day
 * funnel (`lib/dealFlow/dialFunnel.ts`, the same counts the Daily deal flow page shows) and says what
 * the map draws — the stages with their cost each, the drop between each pair, and the biggest leak.
 *
 * Only steps with a count are stages: "Quoted" is left out when no pipeline has a quoting stage
 * (the funnel then reads null), rather than drawn as zero. A count can rise from one step to the next
 * (a lead dialled that the queue never served), so a drop is never negative.
 *
 * The biggest leak is the step that keeps the smallest share of what reached it, among steps that
 * lose something and start from at least `MIN_LEAK_BASE` leads — two of three is not a finding.
 */
import type { DialFunnel, FunnelStep } from "../dealFlow/dialFunnel.ts";

export const MIN_LEAK_BASE = 5;

const STAGE_LABEL: Record<FunnelStep["key"], string> = {
  served: "Leads served",
  dialed: "Dialled",
  contacts: "Reached",
  quoted: "Quoted",
  applications: "Applications",
};

/** What a lead that stopped before this step did not get: "−968 not reached". */
const LOST_AS: Record<FunnelStep["key"], string> = {
  served: "not served",
  dialed: "never dialled",
  contacts: "not reached",
  quoted: "no quote",
  applications: "no application",
};

export type LeadFlowStage = { key: FunnelStep["key"]; label: string; count: number; value: string; note?: string; /** Share of the step before that reached this one (0–1); null on the first. */ kept: number | null };
export type LeadFlowDrop = { from: number; lost: number; kept: number | null; text: string };
export type LeadFlowLeak = { drop: number; percent: string; from: string; to: string; lost: number; lostAs: string; lostSpendCents: number | null; topAgent: { name: string; count: number } | null };
export type LeadFlowView = {
  empty: boolean;
  stages: LeadFlowStage[];
  drops: LeadFlowDrop[];
  leak: LeadFlowLeak | null;
  spendCents: number | null;
  annualisedCents: number;
  deals: number;
  costPerApplicationCents: number | null;
  /** Every dial in the period (a lead can be dialled more than once). */
  dials: number;
  /** The agent with the most applications in the period, when anyone has one. */
  topAgent: { name: string; applications: number } | null;
  /** Deals recorded with no premium on them. */
  unpricedDeals: number;
};

const whole = (n: number) => Math.round(n).toLocaleString("en-US");

/** "$13.35" under $100, else "$1,204" — the figure a person compares, not a cent more. */
export function money(cents: number): string {
  const dollars = cents / 100;
  return dollars < 100 ? `$${dollars.toFixed(2)}` : `$${whole(dollars)}`;
}

export function leadFlowView(funnel: Pick<DialFunnel, "steps" | "spendCents" | "annualisedCents" | "deals" | "leak"> & Partial<Pick<DialFunnel, "agents" | "unpricedDeals">>): LeadFlowView {
  const steps = funnel.steps.filter((step): step is FunnelStep & { count: number } => step.count !== null);
  const spend = funnel.spendCents;
  const stages: LeadFlowStage[] = steps.map((step, index) => ({
    key: step.key,
    label: STAGE_LABEL[step.key],
    count: step.count,
    value: whole(step.count),
    note: spend === null ? undefined : index === 0 ? `${money(spend)} spent` : step.count > 0 ? `${money(spend / step.count)} each` : undefined,
    kept: index === 0 || steps[index - 1].count <= 0 || step.count > steps[index - 1].count ? null : step.count / steps[index - 1].count,
  }));

  const drops: LeadFlowDrop[] = stages.slice(1).map((stage, index) => {
    const before = stages[index].count;
    const lost = Math.max(0, before - stage.count);
    return { from: index, lost, kept: before > 0 ? Math.min(1, stage.count / before) : null, text: lost > 0 ? `−${whole(lost)} ${LOST_AS[stage.key]}` : "none lost" };
  });

  let worst = -1;
  drops.forEach((drop, index) => {
    if (drop.lost <= 0 || drop.kept === null || stages[index].count < MIN_LEAK_BASE) return;
    if (worst === -1 || drop.kept < (drops[worst].kept ?? 1)) worst = index;
  });

  const served = stages[0]?.key === "served" ? stages[0].count : 0;
  const leak: LeadFlowLeak | null = worst === -1 ? null : {
    drop: worst,
    percent: `${Math.round((drops[worst].kept ?? 0) * 100)}%`,
    from: stages[worst].label,
    to: stages[worst + 1].label,
    lost: drops[worst].lost,
    lostAs: LOST_AS[stages[worst + 1].key],
    // What the lost leads cost, at the average cost of a lead served.
    lostSpendCents: spend !== null && served > 0 ? Math.round((spend / served) * drops[worst].lost) : null,
    // The funnel's own leak (served, never dialled) names the agent who left the most.
    topAgent: stages[worst + 1].key === "dialed" && funnel.leak.top ? { name: funnel.leak.top.name, count: funnel.leak.top.count } : null,
  };

  const applications = steps.find((step) => step.key === "applications")?.count ?? 0;
  const agents = funnel.agents ?? [];
  const best = [...agents].sort((a, b) => b.applications - a.applications || b.contacts - a.contacts)[0];
  return {
    empty: stages.every((stage) => stage.count === 0),
    stages,
    drops,
    leak,
    spendCents: spend,
    annualisedCents: funnel.annualisedCents,
    deals: funnel.deals,
    costPerApplicationCents: spend !== null && applications > 0 ? Math.round(spend / applications) : null,
    dials: agents.reduce((sum, agent) => sum + agent.dials, 0),
    topAgent: best && best.applications > 0 ? { name: best.name, applications: best.applications } : null,
    unpricedDeals: funnel.unpricedDeals ?? 0,
  };
}

/** The same number of days immediately before a range: what a period's figures are compared with. */
export function priorRange(range: { fromDate: string; toDate: string }): { fromDate: string; toDate: string } {
  const [fy, fm, fd] = range.fromDate.split("-").map(Number);
  const [ty, tm, td] = range.toDate.split("-").map(Number);
  const days = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1;
  const to = new Date(Date.UTC(fy, fm - 1, fd - 1));
  const from = new Date(Date.UTC(fy, fm - 1, fd - days));
  return { fromDate: from.toISOString().slice(0, 10), toDate: to.toISOString().slice(0, 10) };
}

/** The local dates a home's period covers, ending today in the agency's zone. */
export function flowRange(today: string, days: number): { fromDate: string; toDate: string } {
  const [y, m, d] = today.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, d - (Math.max(1, days) - 1)));
  return { fromDate: from.toISOString().slice(0, 10), toDate: today };
}

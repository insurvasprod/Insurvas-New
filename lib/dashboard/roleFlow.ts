/**
 * One map per role (redesign 2026-10-25, owner: "every single role to have a different map on the
 * dashboard, just because they will not see all the money … different layouts throughout the way,
 * which will help them out into going from one to another. Like leading them").
 *
 * Each role's map is the route its own work takes, drawn over the ribbon, every stop a link to the
 * page where that step is done, and one stop lit as where to go first:
 *
 *   owner, admin   lead to money: served → dialled → reached → quoted → applications → premium ($),
 *                  with what each step costs (the Daily deal flow funnel, agency-wide)
 *   manager        the same flow for the team they manage (the session's producer scope), no money:
 *                  it ends at deals, and no step carries a cost
 *   producer       their own leads to their own premium (scoped to them)
 *   setter         their week: dialled → reached → booked → showed (the setter scorecard)
 *   assistant      a path, not a funnel: the inbox → callbacks → lead lists → assignments
 *   bookkeeper     a path through the money: statements → discrepancies → owed → chargeback exposure
 *   retention      a path through the book at risk: lapse risk → save queue → reinstatement → persistency
 *
 * A funnel's lit stop is its biggest leak (the step that keeps the smallest share); a path's is the
 * first stop with work that is late or waiting. The first tile under the map says the same in words
 * ("Biggest leak" in amber, or "Start here") and links to that stop.
 *
 * Pure: it reshapes figures the page already read under the reader's own gates and scope.
 */
import type { MemberRole, TenantRole } from "../tenantAuth/roles.ts";
import type { LeadFlowView } from "./leadFlow.ts";

export type RoleMapKey = "owner" | "manager" | "producer" | "setter" | "assistant" | "bookkeeper" | "retention";

export type MapTrend = { text: string; tone: "good" | "danger" | "neutral"; title: string };
export type MapStage = { label: string; value: string; count: number; note?: string; href?: string; /** "37% kept" — the share of the stop before that got here. */ kept?: string; /** Against the same number of days before. */ trend?: MapTrend };
/** One figure in the row under a funnel map (2026-10-26, owner: "fill with more data"). */
export type MapFact = { label: string; value: string; note?: string; tone?: "default" | "good" | "warning"; href?: string };
export type MapDrop = { text: string; lost: number; href?: string };
export type MapRow = { label: string; value?: string; tone?: "default" | "good" | "warning" | "danger"; href?: string };
export type LeadTile = { title: string; big: string; unit: string; leak: boolean; rows: MapRow[]; cta: { label: string; href: string }; href: string };

export type RoleMap = {
  label: string;
  mode: "flow" | "path";
  stages: MapStage[];
  drops: MapDrop[];
  /** Flow: the index into `drops` of the biggest leak. */
  worst: number | null;
  /** Path: the index into `stages` of the stop to go to first. */
  hot: number | null;
  lead: LeadTile | null;
  /** Funnel maps: more figures under the drawing. */
  facts?: MapFact[];
};

/** The map a person gets: the agency title first (a manager is not an owner), then the role. */
export function roleMapKey(role: TenantRole, memberRole?: MemberRole | null): RoleMapKey {
  if (memberRole === "manager") return "manager";
  if (memberRole === "admin" || role === "owner") return "owner";
  return role;
}

const whole = (n: number) => Math.round(n).toLocaleString("en-US");
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const pct = (part: number, of: number) => (of > 0 ? `${Math.round((part / of) * 100)}%` : "—");
/** "$5.67" under $100, else "$1,204". */
const usdCents = (cents: number) => (cents < 10_000 ? `$${(cents / 100).toFixed(2)}` : usd(cents));

/* ── Funnels: owner, manager, producer ─────────────────────────────────────────────────────── */

const FUNNEL_LABEL: Record<"owner" | "manager" | "producer", string> = {
  owner: "Lead to money",
  manager: "Your team's leads",
  producer: "Your leads to your premium",
};

/** "▲ 12%" against the period before; a step that was empty before and is not now is "new". */
export function trendOf(now: number, before: number | null | undefined, period: string): MapTrend | undefined {
  if (before === null || before === undefined) return undefined;
  const title = `against the ${period === "today" ? "day" : period} before`;
  if (before === 0) return now > 0 ? { text: "new", tone: "good", title } : undefined;
  const change = (now - before) / before;
  if (Math.abs(change) < 0.005) return { text: "= same", tone: "neutral", title };
  return { text: `${change > 0 ? "▲" : "▼"} ${Math.round(Math.abs(change) * 100)}%`, tone: change > 0 ? "good" : "danger", title };
}

export function funnelMap(key: "owner" | "manager" | "producer", view: LeadFlowView, href: string, period: string, prior: LeadFlowView | null = null): RoleMap {
  const money = key !== "manager";
  const priorCount = new Map((prior?.stages ?? []).map((stage) => [stage.key, stage.count]));
  const stages: MapStage[] = view.stages.map((stage, index) => ({
    label: stage.label,
    value: stage.value,
    count: stage.count,
    // Cost per step is the agency's spend: the owner's to see, and a producer's own share of it.
    note: money ? stage.note : index === 0 ? period : view.stages[0].count ? `${pct(stage.count, view.stages[0].count)} of served` : undefined,
    href,
    kept: stage.kept === null ? undefined : `${Math.round(stage.kept * 100)}% kept`,
    trend: prior ? trendOf(stage.count, priorCount.get(stage.key) ?? 0, period) : undefined,
  }));
  const drops: MapDrop[] = view.drops.map((drop) => ({ text: drop.text, lost: drop.lost, href }));

  // The last stop: premium for the owner and producer, deals for a manager (no money).
  if (view.deals > 0 || view.annualisedCents > 0) {
    const last = stages.at(-1);
    const deals = Math.min(view.deals, last?.count ?? view.deals);
    stages.push({
      label: money ? (key === "producer" ? "Your premium" : "Premium written") : "Deals",
      value: money ? usd(view.annualisedCents) : whole(deals),
      count: deals,
      note: money ? `${whole(view.deals)} ${view.deals === 1 ? "deal" : "deals"} · a year` : "closed",
      href,
      kept: last && last.count > 0 && view.deals <= last.count ? `${Math.round((deals / last.count) * 100)}% closed` : undefined,
      trend: prior ? (money ? trendOf(view.annualisedCents, prior.annualisedCents, period) : trendOf(deals, prior.deals, period)) : undefined,
    });
    if (last) drops.push({ text: last.count - deals > 0 ? `−${whole(last.count - deals)} not closed` : "none lost", lost: Math.max(0, last.count - deals), href });
  }

  const leak = view.leak;
  const lead: LeadTile | null = leak
    ? {
        title: "Biggest leak",
        big: leak.percent,
        unit: `${leak.from} → ${leak.to}`,
        leak: true,
        rows: [
          { label: `${whole(leak.lost)} leads ${leak.lostAs}`, value: money && leak.lostSpendCents !== null ? usd(leak.lostSpendCents) : undefined, tone: "warning", href },
          // Who left the most: a name the owner and a manager act on; a producer's map is only theirs.
          ...(leak.topAgent && key !== "producer" ? [{ label: `${leak.topAgent.name} left the most`, value: `${whole(leak.topAgent.count)}`, tone: "warning" as const, href }] : []),
          { label: `Kept from ${leak.from.toLowerCase()} to ${leak.to.toLowerCase()}`, value: leak.percent, href },
        ],
        cta: { label: "See who fell out", href },
        href,
      }
    : null;
  // More figures under the drawing: rates for everyone, money for those who may see it, a name for those who manage.
  const count = (stageKey: string) => view.stages.find((stage) => stage.key === stageKey)?.count ?? 0;
  const dialled = count("dialed");
  const reached = count("contacts");
  const spend = view.spendCents;
  const facts: MapFact[] = [];
  if (dialled > 0) facts.push({ label: "Contact rate", value: pct(reached, dialled), note: `${whole(reached)} of ${whole(dialled)} dialled`, href });
  if (view.dials > 0 && dialled > 0) facts.push({ label: "Dials per lead", value: (view.dials / dialled).toFixed(1), note: `${whole(view.dials)} dials`, href });
  if (money && view.costPerApplicationCents !== null) facts.push({ label: "Cost per application", value: usdCents(view.costPerApplicationCents), note: spend !== null ? `${usdCents(spend)} spent` : undefined, href });
  if (money && spend !== null && view.deals > 0) facts.push({ label: "Cost per deal", value: usdCents(spend / view.deals), note: `${whole(view.deals)} ${view.deals === 1 ? "deal" : "deals"}`, href });
  if (money && view.deals > 0 && view.annualisedCents > 0) facts.push({ label: "Premium per deal", value: usd(view.annualisedCents / view.deals), note: "a year", tone: "good", href });
  if (key !== "producer" && view.topAgent) facts.push({ label: "Most applications", value: view.topAgent.name, note: `${whole(view.topAgent.applications)} ${view.topAgent.applications === 1 ? "application" : "applications"}`, href });
  if (money && view.unpricedDeals > 0) facts.push({ label: "Deals with no premium", value: whole(view.unpricedDeals), note: "not in premium written", tone: "warning", href });
  return { label: `${FUNNEL_LABEL[key]} · ${period}`, mode: "flow", stages, drops, worst: leak ? leak.drop : null, hot: null, lead, facts };
}

/** The biggest leak of a plain funnel: the step that keeps the smallest share, from at least five. */
export function worstDrop(stages: MapStage[]): number | null {
  let worst: number | null = null;
  let kept = 1;
  for (let index = 0; index < stages.length - 1; index += 1) {
    const before = stages[index].count;
    const after = stages[index + 1].count;
    if (before < 5 || after >= before) continue;
    if (after / before < kept) { kept = after / before; worst = index; }
  }
  return worst;
}

/* ── Setter: the week from dial to show ────────────────────────────────────────────────────── */

export function setterMap(input: { dials: number; reached: number; booked: number; showed: number }, hrefs: { dialer: string | null; activity: string | null; calendar: string | null }): RoleMap {
  const stages: MapStage[] = [
    { label: "Dialled", value: whole(input.dials), count: input.dials, note: "last 7 days", href: hrefs.dialer ?? undefined },
    { label: "Reached", value: whole(input.reached), count: input.reached, note: input.dials ? `${pct(input.reached, input.dials)} contact` : undefined, href: hrefs.activity ?? undefined },
    { label: "Booked", value: whole(input.booked), count: input.booked, note: input.reached ? `${pct(input.booked, input.reached)} of reached` : undefined, href: hrefs.calendar ?? undefined },
    { label: "Showed", value: whole(input.showed), count: input.showed, note: input.booked ? `${pct(input.showed, input.booked)} show rate` : undefined, href: hrefs.activity ?? undefined },
  ];
  const lostAs = ["not reached", "not booked", "did not show"];
  const drops: MapDrop[] = stages.slice(1).map((stage, index) => {
    const lost = Math.max(0, stages[index].count - stage.count);
    return { text: lost ? `−${whole(lost)} ${lostAs[index]}` : "none lost", lost, href: stage.href };
  });
  const worst = worstDrop(stages);
  const where = worst === null ? null : stages[worst + 1];
  const lead: LeadTile | null = worst === null || !where
    ? null
    : {
        title: "Biggest leak",
        big: pct(where.count, stages[worst].count),
        unit: `${stages[worst].label} → ${where.label}`,
        leak: true,
        rows: [
          { label: `${whole(drops[worst].lost)} ${lostAs[worst]}`, tone: "warning", href: where.href },
          { label: "Booked this week", value: whole(input.booked), href: hrefs.calendar ?? undefined },
          { label: "Show rate", value: pct(input.showed, input.booked), tone: input.booked && input.showed / input.booked >= 0.6 ? "good" : "warning", href: hrefs.activity ?? undefined },
        ],
        cta: hrefs.dialer ? { label: "Start calling", href: hrefs.dialer } : { label: "Open", href: where.href ?? "/app/dashboard" },
        href: where.href ?? "/app/dashboard",
      };
  return { label: "Your calls to booked appointments · 7 days", mode: "flow", stages, drops, worst, hot: null, lead };
}

/* ── Paths: assistant, bookkeeper, retention ───────────────────────────────────────────────── */

/** One stop on a path: its figure (null = no figure, just the way in), whether it is late, and a line. */
export type PathStop = { label: string; href: string | null; figure: string | null; count: number; urgent: boolean; note: string; next: string };

/**
 * A path map from its stops. Only the stops this person can open are drawn (`href` null drops one).
 * The lit stop is the first urgent one, else the first with work in it, else the first.
 */
export function pathMap(label: string, stops: PathStop[], startTitle = "Start here"): RoleMap {
  const shown = stops.filter((stop) => stop.href !== null);
  if (shown.length === 0) return { label, mode: "path", stages: [], drops: [], worst: null, hot: null, lead: null };
  let hot = shown.findIndex((stop) => stop.urgent);
  if (hot === -1) hot = shown.findIndex((stop) => stop.count > 0);
  if (hot === -1) hot = 0;
  const stages: MapStage[] = shown.map((stop) => ({ label: stop.label, value: stop.figure ?? "Open", count: 1, note: stop.note, href: stop.href ?? undefined }));
  const drops: MapDrop[] = shown.slice(0, -1).map((stop) => ({ text: stop.next, lost: 0, href: stop.href ?? undefined }));
  const first = shown[hot];
  const lead: LeadTile = {
    title: startTitle,
    big: first.figure ?? "→",
    unit: first.label,
    leak: first.urgent,
    rows: shown.map((stop) => ({ label: stop.label, value: stop.figure ?? undefined, tone: stop.urgent ? "warning" : stop.count > 0 ? "good" : "default", href: stop.href ?? undefined })),
    cta: { label: `Go to ${first.label.toLowerCase()}`, href: first.href ?? "/app/dashboard" },
    href: first.href ?? "/app/dashboard",
  };
  return { label, mode: "path", stages, drops, worst: null, hot, lead };
}

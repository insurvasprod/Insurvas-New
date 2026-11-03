/**
 * The DealFlow concept board's day funnel: Served → Dialed → Contacts → Quoted → Applications, the
 * list spend behind it, a per-agent block and the day's leak (served, never dialed).
 *
 * Pure: the loader in dialFunnelLoader.ts reads the rows and this turns them into figures, so the
 * arithmetic is testable without a database. Every step counts DISTINCT leads, which is what makes
 * the conversion from one step to the next a meaningful percentage.
 *
 * Sources, and why each one:
 * - Served — tenant_lead_activity.served_at, one row per queue serve (trigger on lead_queue).
 * - Dialed / contacts / zero-click — tenant_call_attempts, read directly. The activity log's own
 *   clicked_at was only mirrored from 20260925705000, so it is not trusted for older days.
 * - Quoted — there is no quote event; a lead entering a pipeline stage whose name starts "Quot" is
 *   the closest recorded fact, and the page says when no pipeline has such a stage.
 * - Applications — tenant_application_cases opened in the range.
 */

/** The ways a call reaches nobody. Mirrors public.is_contact_disposition (20260913390000). */
export const NON_CONTACT_DISPOSITIONS = new Set(["no_answer", "voicemail", "busy", "call_dropped", "disconnected", "wrong_number"]);

export function isContactDisposition(disposition: string | null | undefined): boolean {
  return !!disposition && !NON_CONTACT_DISPOSITIONS.has(disposition);
}

export type ServedRow = { lead_id: string; agent_user_id: string | null; campaign_id: string | null };
export type AttemptRow = { lead_id: string; agent_id: string | null; dial_clicked_at: string | null; disposition: string | null };
export type ApplicationRow = { lead_id: string; opened_by: string | null };
export type QuotedRow = { lead_id: string; actor_user_id: string | null };
export type DealPremiumRow = { monthly_premium_cents: number | null };
export type Agent = { id: string; name: string; role: string };

export type FunnelStep = { key: "served" | "dialed" | "contacts" | "quoted" | "applications"; label: string; count: number | null; toNext: number | null };
export type AgentLine = { id: string; name: string; role: string; served: number; dials: number; contacts: number; contactRate: number | null; applications: number; servedNeverDialed: number; zeroClick: number };
export type DialFunnel = {
  steps: FunnelStep[];
  annualisedCents: number;
  unpricedDeals: number;
  deals: number;
  spendCents: number | null;
  servedWithCost: number;
  agents: AgentLine[];
  leak: { servedNeverDialed: number; share: number | null; top: { id: string; name: string; count: number; alsoMostZeroClick: boolean; zeroClick: number } | null };
  quotedStageExists: boolean;
};

/** One cost per served (lead, campaign) pair: the lead's own recorded cost, else the campaign's per-record cost. */
export type CostLookup = { leadCost: Map<string, number>; campaignPerRecord: Map<string, number> };

const pct = (part: number, whole: number) => (whole > 0 ? part / whole : null);

export function buildDialFunnel(input: {
  served: ServedRow[];
  attempts: AttemptRow[];
  applications: ApplicationRow[];
  quoted: QuotedRow[] | null;
  deals: DealPremiumRow[];
  agents: Agent[];
  costs: CostLookup;
}): DialFunnel {
  const servedLeads = new Set(input.served.map((row) => row.lead_id));
  const dialedLeads = new Set(input.attempts.filter((row) => row.dial_clicked_at).map((row) => row.lead_id));
  const contactLeads = new Set(input.attempts.filter((row) => isContactDisposition(row.disposition)).map((row) => row.lead_id));
  const quotedLeads = input.quoted ? new Set(input.quoted.map((row) => row.lead_id)) : null;
  const applicationLeads = new Set(input.applications.map((row) => row.lead_id));

  const counts: Array<[FunnelStep["key"], string, number | null]> = [
    ["served", "Served", servedLeads.size],
    ["dialed", "Dialed", dialedLeads.size],
    ["contacts", "Contacts", contactLeads.size],
    ["quoted", "Quoted", quotedLeads ? quotedLeads.size : null],
    ["applications", "Applications", applicationLeads.size],
  ];
  const steps: FunnelStep[] = counts.map(([key, label, count], index) => {
    // A step with no count is skipped over, so Contacts converts to Applications when Quoted is unknown.
    const next = counts.slice(index + 1).find((step) => step[2] != null);
    return { key, label, count, toNext: count == null || !next || next[2] == null ? null : pct(next[2], count) };
  });

  // Spend: each served (lead, campaign) pair once.
  let spendCents = 0;
  let servedWithCost = 0;
  const costed = new Set<string>();
  for (const row of input.served) {
    const key = `${row.lead_id}:${row.campaign_id ?? ""}`;
    if (costed.has(key)) continue;
    costed.add(key);
    const own = input.costs.leadCost.get(key);
    const fallback = row.campaign_id ? input.costs.campaignPerRecord.get(row.campaign_id) : undefined;
    const cost = own ?? fallback;
    if (cost != null && cost > 0) { spendCents += cost; servedWithCost += 1; }
  }

  const priced = input.deals.filter((deal) => deal.monthly_premium_cents != null);
  const annualisedCents = priced.reduce((sum, deal) => sum + (deal.monthly_premium_cents ?? 0) * 12, 0);

  // Per agent.
  const byAgent = new Map<string, { served: Set<string>; dialed: Set<string>; dials: number; contacts: number; applications: Set<string>; zeroClick: number }>();
  const line = (id: string) => {
    let entry = byAgent.get(id);
    if (!entry) { entry = { served: new Set(), dialed: new Set(), dials: 0, contacts: 0, applications: new Set(), zeroClick: 0 }; byAgent.set(id, entry); }
    return entry;
  };
  for (const row of input.served) if (row.agent_user_id) line(row.agent_user_id).served.add(row.lead_id);
  for (const row of input.attempts) {
    if (!row.agent_id) continue;
    const entry = line(row.agent_id);
    if (row.dial_clicked_at) { entry.dials += 1; entry.dialed.add(row.lead_id); }
    if (row.dial_clicked_at && isContactDisposition(row.disposition)) entry.contacts += 1;
    if (!row.dial_clicked_at && row.disposition) entry.zeroClick += 1;
  }
  for (const row of input.applications) if (row.opened_by) line(row.opened_by).applications.add(row.lead_id);

  const names = new Map(input.agents.map((agent) => [agent.id, agent]));
  const agents: AgentLine[] = [...byAgent.entries()]
    .map(([id, entry]) => {
      const servedNeverDialed = [...entry.served].filter((lead) => !entry.dialed.has(lead)).length;
      return {
        id,
        name: names.get(id)?.name ?? "Former member",
        role: names.get(id)?.role ?? "",
        served: entry.served.size,
        dials: entry.dials,
        contacts: entry.contacts,
        contactRate: pct(entry.contacts, entry.dials),
        applications: entry.applications.size,
        servedNeverDialed,
        zeroClick: entry.zeroClick,
      };
    })
    .sort((a, b) => b.dials - a.dials || b.served - a.served || a.name.localeCompare(b.name));

  // The leak: served by someone, never dialed by that same someone.
  const servedNeverDialed = agents.reduce((sum, agent) => sum + agent.servedNeverDialed, 0);
  const servedPairs = agents.reduce((sum, agent) => sum + agent.served, 0);
  const worst = [...agents].sort((a, b) => b.servedNeverDialed - a.servedNeverDialed)[0];
  const mostZeroClick = [...agents].sort((a, b) => b.zeroClick - a.zeroClick)[0];
  const top = worst && worst.servedNeverDialed > 0
    ? { id: worst.id, name: worst.name, count: worst.servedNeverDialed, zeroClick: worst.zeroClick, alsoMostZeroClick: !!mostZeroClick && mostZeroClick.zeroClick > 0 && mostZeroClick.id === worst.id }
    : null;

  return {
    steps,
    annualisedCents,
    unpricedDeals: input.deals.length - priced.length,
    deals: input.deals.length,
    spendCents: servedWithCost > 0 ? spendCents : null,
    servedWithCost,
    agents,
    leak: { servedNeverDialed, share: pct(servedNeverDialed, servedPairs), top },
    quotedStageExists: input.quoted != null,
  };
}

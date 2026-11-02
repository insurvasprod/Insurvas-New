import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { narrowTo } from "@/lib/partnerAuth/team";
import { partnerOutcomeLabel } from "@/lib/partnerLeads/service";
import { intakeLocalDate } from "@/lib/dealFlow/localDate";
import { dealFlowFigures, type FigureRow } from "./figures";
import { isValidDay } from "./localDay";
import {
  PARTNER_DEAL_FLOW_COLUMNS,
  PARTNER_DEAL_FLOW_LEAD_COLUMNS,
  type DealFlowStageType,
  type PartnerDealFlowAccess,
  type PartnerDealFlowFilters,
  type PartnerDealFlowPayload,
  type PartnerDealFlowRow,
} from "./types";

/**
 * Daily deal flow, the partner's side: one day of what the agency did with the leads this partner
 * sent (plan `tasks/partner-daily-deal-flow`). Read-only.
 *
 * ## It does not decide access, and this page's scope is not the portal's
 *
 * The caller hands down `visibleIds`: the `created_by` ids this viewer may read, worked out from
 * the signed session by `lib/partnerAuth/team.ts`. This file never sees the role and never decides
 * anything, because a second copy of "who may see what" is faithful on the day it is written and
 * drifts afterwards — and the drift is invisible until a partner sees somebody else's customer.
 *
 * **This page is narrower than the rest of the portal, on purpose** (owner, 2 Nov). Here a
 * `partner_admin` sees their own team — the members whose `partner_admin_user_id` points at them —
 * and themselves. Everywhere else an admin still sees the whole partner organisation, which is
 * `lib/partnerLeads/scope.ts`' decision and is deliberately untouched: Pipeline, the lead record,
 * the CSV export, Overview and Team review are all unchanged.
 *
 * So an admin can open a lead on Pipeline that is absent from this page. That is the decision, not
 * a bug. Widening Pipeline to match would need a migration — `partner_lead_pipeline_page` takes one
 * `p_closer_id`, not a list — which is why the two are out of step rather than both moved at once.
 *
 * ## It reads its own columns rather than the agency's report
 *
 * `list_deal_flow_report` would have served the rows, and would have brought the agency's notes,
 * the closer who worked the call, the buffer assistant, the campaign and the vendor with them, to
 * be stripped here. The next column added to that function would then arrive unstripped. So this
 * reads `deal_flow` directly through `PARTNER_DEAL_FLOW_COLUMNS`, a literal allow-list that
 * `service.test.mjs` holds in place. One day of one partner's deals is a small read; it needs no
 * SQL-side paging, counters or facets.
 *
 * Nothing here opens `agent_leads.values`, so no field on this page needs `maskSensitiveValues` —
 * the customer's name comes from `deal_flow.insured_name` and nothing else does.
 *
 * ## The stage is the lead's, not the deal's
 *
 * `deal_flow` carries its own `stage_id`, which the dialer does not move; `agent_leads.stage_id` is
 * what the partner's Pipeline shows. This page reads the lead's, so the two pages can never
 * disagree about where a lead stands — the agency's report keeps both and flags the drift, which is
 * an agency problem, not something to show a partner.
 */

/** One day of one partner. Far past anything real; a day at the cap would make the figures lie. */
const MAX_ROWS = 5000;

const SELECT = `${PARTNER_DEAL_FLOW_COLUMNS.join(", ")}, agent_leads!inner(${PARTNER_DEAL_FLOW_LEAD_COLUMNS.join(", ")})`;

type DealRow = {
  lead_id: string;
  product_line: string;
  insured_name: string | null;
  local_date: string;
  call_result: string | null;
  carrier: string | null;
  product_type: string | null;
  monthly_premium_cents: number | null;
  face_amount_cents: number | null;
  draft_date: string | null;
  disposition_at: string | null;
  updated_at: string;
  agent_leads: { created_by: string | null; created_at: string; stage_id: string | null };
};

type Stage = { name: string; stageType: DealFlowStageType };

function isStageType(value: unknown): value is DealFlowStageType {
  return value === "open" || value === "won" || value === "lost";
}

function searchable(row: PartnerDealFlowRow): string {
  return [row.customer, row.carrier, row.outcome, row.productType].filter(Boolean).join(" ").toLowerCase();
}

export async function listPartnerDealFlow(
  tenantId: string,
  partnerId: string,
  options: { from: string; to: string; timezone: string; filters?: PartnerDealFlowFilters },
  access: PartnerDealFlowAccess,
): Promise<PartnerDealFlowPayload> {
  const { from, to, timezone } = options;
  if (!isValidDay(from) || !isValidDay(to)) throw new Error("Choose a valid date range");
  if (from > to) throw new Error("The start date must be on or before the end date");
  const filters = options.filters ?? {};
  const db = getSupabaseServiceClient();

  // An empty list is a bug upstream, not a scope. It would read as "nobody", and worse, it invites
  // the next person at this line to treat it as "no filter" and open the organisation. The list
  // always holds the viewer, so there is no legitimate way to arrive here with none.
  const visibleIds = [...access.visibleIds];
  if (!visibleIds.length) throw new Error("Could not load the daily deal flow: no submitter is in scope");
  // `?submitted_by=` is one of the page's own filters, not part of the boundary: it narrows within
  // the list and can never add to it, and an id outside the list narrows nothing rather than
  // erroring — an error would confirm that the id exists.
  const allowedIds = narrowTo(visibleIds, filters.submittedBy);

  // The boundary, in SQL and unconditional. `const`, so a later edit cannot make it an `if`.
  const query = db
    .from("deal_flow")
    .select(SELECT)
    .eq("tenant_id", tenantId)
    .eq("partner_id", partnerId)
    .in("agent_leads.created_by", visibleIds)
    .gte("local_date", from)
    .lte("local_date", to)
    .order("updated_at", { ascending: false })
    .limit(MAX_ROWS);

  const { data, error } = await query;
  if (error) throw new Error(`Could not load the daily deal flow: ${error.message}`);
  const deals = (data ?? []) as unknown as DealRow[];

  const stageIds = [...new Set(deals.map((deal) => deal.agent_leads?.stage_id).filter((id): id is string => Boolean(id)))];
  const submitterIds = [...new Set(deals.map((deal) => deal.agent_leads?.created_by).filter((id): id is string => Boolean(id)))];
  const [stageRows, userRows] = await Promise.all([
    stageIds.length
      ? db.from("tenant_pipeline_stages").select("id, name, stage_type").in("id", stageIds)
      : Promise.resolve({ data: [], error: null }),
    submitterIds.length
      ? db.from("users").select("id, name").in("id", submitterIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (stageRows.error) throw new Error(`Could not load pipeline stages: ${stageRows.error.message}`);
  if (userRows.error) throw new Error(`Could not load partner submitters: ${userRows.error.message}`);

  const stages = new Map<string, Stage>(
    ((stageRows.data ?? []) as Array<{ id: string; name: string; stage_type: string }>).map((row) => [
      row.id,
      { name: row.name, stageType: isStageType(row.stage_type) ? row.stage_type : "open" },
    ]),
  );
  const names = new Map<string, string>(
    ((userRows.data ?? []) as Array<{ id: string; name: string | null }>).map((row) => [row.id, row.name ?? "Partner closer"]),
  );

  const scoped: PartnerDealFlowRow[] = deals.map((deal) => {
    // A stage that cannot be resolved counts as in progress, in the table and in the figures
    // alike — the same fallback the agency's report makes (lib/dealFlow/types.ts).
    const stage = (deal.agent_leads?.stage_id && stages.get(deal.agent_leads.stage_id)) || { name: "In progress", stageType: "open" as const };
    const submittedBy = deal.agent_leads?.created_by ?? null;
    return {
      leadId: deal.lead_id,
      day: deal.local_date,
      customer: deal.insured_name?.trim() || "Unnamed lead",
      productLine: deal.product_line,
      stageName: stage.name,
      stageType: stage.stageType,
      carrier: deal.carrier,
      productType: deal.product_type,
      monthlyPremiumCents: deal.monthly_premium_cents,
      faceAmountCents: deal.face_amount_cents,
      draftDate: deal.draft_date,
      outcome: partnerOutcomeLabel(deal.call_result),
      submittedBy: { id: submittedBy, name: (submittedBy && names.get(submittedBy)) || "Partner closer" },
      submittedDay: intakeLocalDate(timezone, new Date(deal.agent_leads.created_at)),
      updatedAt: deal.updated_at,
    };
  });

  // The facets describe what this viewer could filter down to, so they come from the scoped set
  // before the page's own filters narrow it — otherwise choosing a product empties the product menu,
  // and choosing a person leaves the submitter menu holding only that person. Because `scoped` is
  // already inside the boundary, the submitter menu can never name somebody whose rows the page
  // would then refuse to show.
  const facets = {
    products: [...new Set(scoped.map((row) => row.productLine))].sort(),
    submitters: [...new Map(scoped.filter((row) => row.submittedBy.id).map((row) => [row.submittedBy.id as string, { id: row.submittedBy.id as string, name: row.submittedBy.name }])).values()]
      .sort((a, b) => a.name.localeCompare(b.name)),
  };

  const search = filters.search?.trim().toLowerCase() ?? "";
  // Narrowed by everything except the stage, so the stage chips can carry counts that are still
  // true once one of them is picked — a chip reading "Won 4" that becomes "Won 0" the moment you
  // press it is worse than no count at all.
  const beforeStage = scoped.filter((row) => {
    // Fails closed: a row whose submitter is not in the allowed list is dropped whatever the query
    // returned. The `.in()` above already guarantees it — this costs nothing and means the table
    // cannot show a row the boundary would refuse, even if that line is ever weakened.
    if (!row.submittedBy.id || !allowedIds.includes(row.submittedBy.id)) return false;
    if (filters.product && row.productLine !== filters.product) return false;
    if (search && !searchable(row).includes(search)) return false;
    return true;
  });
  const stageCounts = {
    open: beforeStage.filter((row) => row.stageType === "open").length,
    won: beforeStage.filter((row) => row.stageType === "won").length,
    lost: beforeStage.filter((row) => row.stageType === "lost").length,
  };
  const rows = filters.stageType ? beforeStage.filter((row) => row.stageType === filters.stageType) : beforeStage;

  // The figures describe the filtered table, not the whole day and not the page on screen.
  const figureRows: FigureRow[] = rows.map((row) => ({
    stageType: row.stageType,
    monthlyPremiumCents: row.monthlyPremiumCents,
    submittedDay: row.submittedDay,
    outcome: row.outcome,
  }));

  return {
    from,
    to,
    today: intakeLocalDate(timezone),
    rows,
    figures: dealFlowFigures(figureRows, to),
    stageCounts,
    facets,
    capped: deals.length >= MAX_ROWS,
    generatedAt: new Date().toISOString(),
  };
}

import { NextResponse, type NextRequest } from "next/server";

import { partnerTeamMembers, requirePartner } from "@/lib/partnerAuth/requirePartner";
import { visibleSubmitters } from "@/lib/partnerAuth/team";
import { listPartnerDealFlow } from "@/lib/partnerDealFlow/service";
import { partnerDealFlowCsv } from "@/lib/partnerDealFlow/csv";
import { isValidDay, resolveDay } from "@/lib/partnerDealFlow/localDay";
import { DEAL_FLOW_STAGE_TYPES, type DealFlowStageType, type PartnerDealFlowFilters } from "@/lib/partnerDealFlow/types";

/**
 * Daily deal flow for the signed-in partner (plan `tasks/partner-daily-deal-flow`).
 *
 * Open to both roles and read-only: there is no POST, PATCH or DELETE here, because the agency
 * records what it did with a lead and the partner reads it.
 *
 * Who sees which rows is decided here, from the session, and handed to the service as a list of
 * ids — the service is given the answer rather than the question. A `partner_user` gets their own
 * id; a `partner_admin` gets their team's and their own (`lib/partnerAuth/team.ts`). This is the
 * one partner page that narrows an admin below the whole organisation; everywhere else
 * `lib/partnerLeads/scope.ts` still opens the organisation to them, unchanged.
 *
 * `?submitted_by=` only ever narrows inside that list. A partner user naming a colleague, or an
 * admin naming another team's member, gets their own view back rather than an error.
 *
 * `tenant_id` and `partner_id` come from the signed session. A `?partner_id=` that is not the
 * caller's is refused rather than ignored, so a wrong link fails loudly instead of quietly showing
 * the caller their own day under somebody else's name.
 */

function stageType(value: string | null): DealFlowStageType | null {
  return value && (DEAL_FLOW_STAGE_TYPES as readonly string[]).includes(value) ? (value as DealFlowStageType) : null;
}

function cents(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function filterDay(value: string | null): string | null {
  return isValidDay(value) ? value : null;
}

function filtersFrom(request: NextRequest): PartnerDealFlowFilters {
  const params = request.nextUrl.searchParams;
  return {
    stageType: stageType(params.get("stage_type")),
    product: params.get("product") || null,
    submittedBy: params.get("submitted_by") || null,
    search: params.get("search") || null,
    customer: params.get("customer") || null,
    carrier: params.get("carrier") || null,
    annualisedPremiumMinCents: cents(params.get("annualised_premium_min")),
    annualisedPremiumMaxCents: cents(params.get("annualised_premium_max")),
    draftDateFrom: filterDay(params.get("draft_date_from")),
    draftDateTo: filterDay(params.get("draft_date_to")),
  };
}

function checkPartnerParam(request: NextRequest, partnerId: string) {
  const requested = request.nextUrl.searchParams.get("partner_id");
  return !requested || requested === partnerId;
}

export async function GET(request: NextRequest) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  const { context } = auth;
  if (!checkPartnerParam(request, context.partnerId)) {
    return NextResponse.json({ error: "You cannot access another partner's deal flow" }, { status: 403 });
  }
  // A missing, malformed or future day lands on today in the partner's own timezone rather than
  // erroring: the date inputs are capped at today, so a future day is a stale link.
  const params = request.nextUrl.searchParams;
  const from = resolveDay(params.get("from"), context.partnerTimezone);
  const to = resolveDay(params.get("to"), context.partnerTimezone);
  try {
    // Inside the try with the service's own reads: a `partner_users` read that fails throws rather
    // than returning an empty list, so the request ends in an error instead of a page that looks
    // right and is scoped wrong.
    const members = await partnerTeamMembers(context.tenantId, context.partnerId);
    const visibleIds = visibleSubmitters({ userId: context.userId, role: context.role }, members);
    const payload = await listPartnerDealFlow(
      context.tenantId,
      context.partnerId,
      { from, to, timezone: context.partnerTimezone, filters: filtersFrom(request) },
      { visibleIds },
    );
    if (params.get("format") === "csv") {
      const name = payload.from === payload.to ? payload.from : `${payload.from}_${payload.to}`;
      return new NextResponse(partnerDealFlowCsv(payload.rows), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename=deal-flow-${name}.csv`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the daily deal flow" }, { status: 400 });
  }
}

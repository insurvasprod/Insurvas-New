import { NextResponse, type NextRequest } from "next/server";

import { leadListsReport, listLeadsInList } from "@/lib/leadLists/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { refuseNarrowInAgency } from "@/lib/agency/routeScope";
import { consentMissingCsv, leadListDetail, type LeadListDetail } from "@/lib/leadLists/detail";
import { audit } from "@/lib/audit/log";
import type { EntitledContext } from "@/lib/entitlements/requireFeature";
import { hasFeature, type Entitlement } from "@/lib/entitlements/types";
import { featureKillState } from "@/lib/features/killSwitch";
import { contextRoles } from "@/lib/tenantAuth/requireTenant";
import { holdsAnyRole } from "@/lib/tenantAuth/teamAccess";
import { getViewerTimezone } from "@/lib/users/viewerTimezone";

/**
 * The lead list — what was bought, and what is left of it.
 *
 * Gated on `lead_import` rather than `outbound_dialing`: this is the inventory of imported lists, and
 * a tenant who buys lists should be able to look at them whether or not they have the dialer.
 *
 * A setter is excluded. LA-2.12's role table gives them the queue, not the book — deciding which
 * list to work through and who gets it is the licensed agent's call, and this screen is where the
 * handing-out happens.
 */
const LIST_ROLES = ["owner", "producer", "assistant"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A feature as guardPage reads it: on the plan and not switched off. */
async function featureOn(entitlement: Entitlement, featureKey: string, tenantId: string) {
  if (!hasFeature(entitlement, featureKey)) return false;
  return !(await featureKillState(featureKey, tenantId)).killed;
}

/** A list's detail with what it cost taken out, for someone who may not see spend. */
function withoutSpend(detail: LeadListDetail): LeadListDetail {
  return {
    ...detail,
    totalSpendCents: 0,
    creditsReceivedCents: 0,
    costPerRecordCents: null,
    costPerUsableCents: null,
    removals: detail.removals.map((row) => ({ ...row, claimableCents: null })),
    claims: { ...detail.claims, unclaimedCents: 0, pendingCents: 0 },
    outcome: null,
  };
}

/** What app/app/(shell)/lead-lists/[campaignId]/page.tsx hands LeadListDetailView, decided the same way. */
async function listPanel(auth: EntitledContext, campaignId: string) {
  const { tenantId, userId } = auth.context;
  const roles = contextRoles(auth.context);
  const readOnly = auth.entitlement.access === "read_only";
  const [trueCpa, dialing, consentLocker] = await Promise.all([
    featureOn(auth.entitlement, "true_cpa", tenantId),
    featureOn(auth.entitlement, "outbound_dialing", tenantId),
    featureOn(auth.entitlement, "consent_locker", tenantId),
  ]);
  const manager = holdsAnyRole(roles, ["owner", "producer"]);
  const money = trueCpa && manager;
  const [read, timeZone] = await Promise.all([
    leadListDetail(tenantId, userId, campaignId, { money, readOnly }),
    getViewerTimezone(tenantId, userId).catch(() => null),
  ]);
  // An assistant sees the inventory, never what it cost (the list's page says the same): the spend
  // and every figure made from it leave the server as nothing, not merely hidden on the screen.
  const detail = read && !manager ? withoutSpend(read) : read;
  return {
    detail,
    money,
    spend: manager,
    timeZone,
    assign: {
      manager,
      blocked: !dialing
        ? "Add Outbound dialing to your plan to assign leads."
        : readOnly
          ? "Restore full access to your plan to assign leads — it is read-only."
          : null,
    },
    claimBlocked: readOnly ? "Restore full access to your plan to draft a claim — it is read-only." : null,
    // "Export missing" (leads with no certificate): the consent locker's evidence, so its feature.
    consentExport: consentLocker,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("lead_import", LIST_ROLES, { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Lead lists");
  if (refused) return refused;

  const params = request.nextUrl.searchParams;
  const campaignId = params.get("campaign_id");

  try {
    if (campaignId) {
      if (!UUID.test(campaignId))
        return NextResponse.json({ error: "Choose a valid lead list" }, { status: 400 });
      // `detail=1`: the list's own page (/app/lead-lists/[campaignId]) as data, for the panel that
      // opens it in place on Lead sources › Lists (owner 2026-10-29). The same reads and the same
      // gates the page applies: the economics only for owners and producers on True CPA, assigning
      // only on Outbound dialing outside a read-only plan, claiming only outside a read-only plan.
      if (params.get("detail") === "1") {
        const panel = await listPanel(auth, campaignId);
        if (!panel.detail) return NextResponse.json({ error: "That lead list does not exist" }, { status: 404 });
        return NextResponse.json(panel, { headers: { "Cache-Control": "no-store" } });
      }
      // `export=consent_missing`: the list's leads with no consent certificate, as a CSV (Lists panel ›
      // Mapping & consent). Consent evidence leaving the product, so the consent locker's feature and
      // its audit action, as its own export (app/api/app/consent/route.ts).
      if (params.get("export") === "consent_missing") {
        if (!(await featureOn(auth.entitlement, "consent_locker", auth.context.tenantId)))
          return NextResponse.json({ error: "Add the consent locker to your plan to export consent gaps.", code: "feature_not_entitled" }, { status: 403 });
        const file = await consentMissingCsv(auth.context.tenantId, campaignId);
        if (!file) return NextResponse.json({ error: "That lead list does not exist" }, { status: 404 });
        await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.consent_evidence_exported", targetType: "tenant", targetId: auth.context.tenantId, metadata: { filter: "none", campaign_id: campaignId, rows: file.rows, capped: file.capped }, request });
        return new NextResponse(file.csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="consent-missing-${campaignId.slice(0, 8)}.csv"`,
            "Cache-Control": "no-store",
          },
        });
      }
      const leads = await listLeadsInList(auth.context.tenantId, campaignId, {
        state: params.get("state"),
        unassignedOnly: params.get("unassigned") === "1",
      });
      return NextResponse.json({ leads }, { headers: { "Cache-Control": "no-store" } });
    }
    const report = await leadListsReport(auth.context.tenantId);
    // Spend is the owner's and producer's (an assistant sees the inventory, not what it cost).
    const spend = holdsAnyRole(contextRoles(auth.context), ["owner", "producer"]);
    const lists = spend ? report.lists : report.lists.map((list) => ({ ...list, totalSpendCents: 0, creditsReceivedCents: 0 }));
    return NextResponse.json(
      // `role` travels with the payload so the screen decides what to OFFER. Assigning is a write
      // and the assignment route enforces it; this only decides whether the control is drawn.
      { lists, licensedStates: report.licensedStates, role: auth.context.role, readOnly: auth.entitlement.access === "read_only", spend },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the lead lists" },
      { status: 500 },
    );
  }
}

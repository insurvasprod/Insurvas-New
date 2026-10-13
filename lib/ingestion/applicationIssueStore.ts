import "server-only";

import { syncLeadStageForApplication } from "@/lib/applications/stageSyncService";
import { markDealPolicyIssued } from "@/lib/issuedPolicies/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { AWAITING_CARRIER, carrierIssue, ISSUED_BY_CARRIER, type IssueCandidate } from "./applicationIssue";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- LA-3/LA-4 tables are not all in database.types.ts
const db = () => getSupabaseServiceClient() as any;
type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * After a carrier file's policies are linked and their current rows refreshed: every linked
 * application still waiting on the carrier whose policy the carrier now lists as issued is closed
 * as issued (LA-3.18: "later, by Module 4 from carrier data"). The same follow-ups as the agent's
 * own Issued action run — open requirements waived, the policy number on the submission, the deal's
 * issued policy (LA-2.17), and the lead's pipeline stage (LA-3.23). Never throws: the file's
 * policies are already stored, and the agent can still record the issue by hand.
 */
export async function recordCarrierIssues(tenantId: string, carrierId: string, policies: string[]): Promise<{ issued: number }> {
  let issued = 0;
  try {
    const current = await db().from("policy_current")
      .select("policy_number, status_normalized, application_id, issue_date, issued_on, last_snapshot_date")
      .eq("tenant_id", tenantId).eq("carrier_id", carrierId).in("policy_number", policies)
      .not("application_id", "is", null).in("status_normalized", [...ISSUED_BY_CARRIER]);
    if (current.error) { if (!isSchemaGap(current.error)) console.error("[carrier-issue]", current.error.message); return { issued }; }
    const rows = (current.data ?? []) as Loose[];
    if (!rows.length) return { issued };

    const apps = await db().from("tenant_applications").select("id, status, lead_id, carrier_id")
      .eq("tenant_id", tenantId).in("id", [...new Set(rows.map((row) => row.application_id))]).in("status", [...AWAITING_CARRIER]);
    if (apps.error) { console.error("[carrier-issue]", apps.error.message); return { issued }; }
    const appById = new Map(((apps.data ?? []) as Loose[]).map((app) => [app.id as string, app]));
    const carrier = await db().from("carriers").select("name").eq("id", carrierId).maybeSingle();

    for (const row of rows) {
      const app = appById.get(row.application_id);
      if (!app) continue;
      const candidate: IssueCandidate = { applicationId: app.id, applicationStatus: app.status, statusNormalized: row.status_normalized, policyNumber: row.policy_number, issueDate: row.issue_date, issuedOn: row.issued_on, lastSnapshotDate: row.last_snapshot_date };
      const decision = carrierIssue(candidate);
      if (!decision.issue) continue;
      try {
        // The same RPC the agent's action uses, with no person behind it (as the counteroffer expiry job does).
        const moved = await db().rpc("application_transition", { p_tenant_id: tenantId, p_application_id: app.id, p_actor: null, p_to: "closed", p_outcome: "issued", p_reason_code: null, p_reason_text: null });
        if (moved.error) { console.error("[carrier-issue]", app.id, moved.error.message); continue; }
        appById.delete(app.id);
        issued++;
        await db().from("tenant_application_requirements")
          .update({ status: "waived", satisfied_at: new Date().toISOString().slice(0, 10), note: "Waived: the carrier's file shows the policy issued." })
          .eq("tenant_id", tenantId).eq("application_id", app.id).in("status", ["open", "in_progress"]);
        // The policy number joins the submission it was sent under, without overwriting the application number.
        const sub = await db().from("tenant_application_submissions").select("id, policy_number").eq("tenant_id", tenantId).eq("application_id", app.id).order("submitted_at", { ascending: false }).limit(1).maybeSingle();
        if (sub.data && !sub.data.policy_number) await db().from("tenant_application_submissions").update({ policy_number: row.policy_number }).eq("tenant_id", tenantId).eq("id", sub.data.id);
        const deal = await db().from("deal_flow").select("id").eq("tenant_id", tenantId).eq("lead_id", app.lead_id).maybeSingle();
        if (deal.data && carrier.data?.name) {
          await markDealPolicyIssued(tenantId, { dealId: deal.data.id, carrier: carrier.data.name, policyNumber: row.policy_number, issuedOn: decision.issuedOn }).catch((error) => console.error("[carrier-issue] deal", app.id, error instanceof Error ? error.message : error));
        }
        // A system row with no request behind it, written the way the counteroffer expiry job writes its own.
        await db().from("audit_log").insert({ actor_type: "system", actor_id: null, action: "tenant.application_transitioned", target_type: "tenant_application", target_id: app.id, metadata: { tenantId, to: "closed", outcome: "issued", source: "carrier_file", carrierId, policyNumber: row.policy_number, carrierStatus: row.status_normalized, issuedOn: decision.issuedOn } });
        await syncLeadStageForApplication(tenantId, app.id);
      } catch (error) {
        console.error("[carrier-issue]", app.id, error instanceof Error ? error.message : error);
      }
    }
  } catch (error) {
    console.error("[carrier-issue]", error instanceof Error ? error.message : error);
  }
  return { issued };
}

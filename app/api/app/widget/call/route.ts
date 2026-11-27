import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { guardLead } from "@/lib/agency/guards";
import { customerName } from "@/lib/callbacks/timezone";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * The phone's call in progress from the dialer (mobile board L2, 2026-11-27): the reader's own dialer call that was
 * placed and has no outcome yet, for the in-app "on a call" card and Android's ongoing notification.
 *
 *   GET → { call: { attemptId, leadId, customer, state, productCode, attemptNumber, disclosureRead, startedAt } | null }
 *
 * "Placed" is the server's own record of the dial (tenant_call_attempts.dial_clicked_at, written by
 * POST /api/app/dialer/attempt/:id/click after its checks); "no outcome" is a null disposition. A call is shown for
 * at most an hour after the dial, so an attempt left without an outcome never haunts the phone. Only the reader's
 * own attempts (agent_id is the session's user), filtered to the session's tenant; the lead read is tenant-filtered
 * too (the service client has no RLS predicate). Read only, no money: the same roles and feature as the dialer.
 */
const DIALER_ROLES = ["owner", "producer", "setter"] as const;
const SHOWN_FOR_MS = 60 * 60_000;

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export async function GET() {
  const auth = await requireFeatureRole("outbound_dialing", DIALER_ROLES);
  if (auth instanceof NextResponse) return auth;
  const { tenantId, userId } = auth.context;
  // tenant_call_attempts is not in the generated types (the dialer service reads it untyped too).
  const db = getSupabaseServiceClient() as unknown as SupabaseClient;
  try {
    const since = new Date(Date.now() - SHOWN_FOR_MS).toISOString();
    const attempt = await db
      .from("tenant_call_attempts")
      .select("id, lead_id, attempt_number, dial_clicked_at, disclosure_confirmed_at, disclosure_state, disclosure_product_code")
      .eq("tenant_id", tenantId)
      .eq("agent_id", userId)
      .is("disposition", null)
      .gte("dial_clicked_at", since)
      .order("dial_clicked_at", { ascending: false })
      .limit(1)
      .maybeSingle<Row>();
    if (attempt.error) throw new Error(attempt.error.message);
    const row = attempt.data;
    if (!row) return NextResponse.json({ call: null }, { headers: { "Cache-Control": "no-store" } });

    const leadId = text(row.lead_id);
    // AG-0.4: the lead read goes through the agency's lead guard, like every one-record read; a lead this
    // session cannot see (a narrowed producer, a reassigned lead) shows no call rather than its name.
    if (await guardLead({ tenantId, userId }, leadId)) return NextResponse.json({ call: null }, { headers: { "Cache-Control": "no-store" } });
    const lead = await db.from("agent_leads").select("values").eq("tenant_id", tenantId).eq("id", leadId).maybeSingle<Row>();
    if (lead.error) throw new Error(lead.error.message);
    const values = (lead.data?.values ?? {}) as Record<string, unknown>;
    const attemptNumber = Number(row.attempt_number);

    return NextResponse.json(
      {
        call: {
          attemptId: text(row.id),
          leadId,
          customer: customerName(values),
          state: text(row.disclosure_state) || null,
          productCode: text(row.disclosure_product_code) || null,
          attemptNumber: Number.isFinite(attemptNumber) && attemptNumber > 0 ? attemptNumber : null,
          disclosureRead: Boolean(row.disclosure_confirmed_at),
          startedAt: text(row.dial_clicked_at),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[widget/call] could not read the call in progress", error);
    return NextResponse.json({ error: "The call in progress could not be read." }, { status: 503 });
  }
}

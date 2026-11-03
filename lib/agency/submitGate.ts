import "server-only";
import { NextResponse } from "next/server";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isAgencyTenant } from "./audience";

/**
 * AG-1.10 / LA-6.2 amendment · the Sell module's gate, per producer. In an agency, an application is submitted
 * only for a producer whose can_submit is true; otherwise it is refused with the SPECIFIC missing item (not a
 * generic "not authorised"). The producer is the case's writer (whoever opened it), whoever presses the button.
 * A solo agent's submission is untouched.
 */
export async function refuseIfCannotSubmit(tenantId: string, applicationId: string): Promise<NextResponse | null> {
  if (!(await isAgencyTenant(tenantId))) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseServiceClient() as any;
  const { data: app } = await db.from("tenant_applications").select("case_id").eq("tenant_id", tenantId).eq("id", applicationId).maybeSingle();
  if (!app?.case_id) return null;
  const { data: kase } = await db.from("tenant_application_cases").select("opened_by").eq("tenant_id", tenantId).eq("id", app.case_id).maybeSingle();
  if (!kase?.opened_by) return null;
  const { data: producer, error } = await db.from("producer").select("can_submit, can_submit_reason").eq("tenant_id", tenantId).eq("user_id", kase.opened_by).maybeSingle();
  if (error) return null; // before migration 20261018100000 there is no producer table: nothing to gate on
  if (!producer) {
    return NextResponse.json({ error: "This writer is not set up as a producer in your agency yet.", code: "not_a_producer" }, { status: 409 });
  }
  if (producer.can_submit) return null;
  const reason = (producer.can_submit_reason as string | null) ?? "Onboarding is not complete";
  return NextResponse.json(
    { error: `You can't submit yet: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}. Finish it on your onboarding checklist.`, code: "cannot_submit", reason },
    { status: 409 },
  );
}

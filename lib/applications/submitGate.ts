import "server-only";

import { isAgencyTenant } from "@/lib/agency/audience";
import { db } from "./db";
import { gateFromProducer } from "./submitGateRules";
import type { SubmitGateView } from "./types";

/**
 * AG-1.10 · the producer submit gate, read for the case view so the Submit step and the "Record the
 * submission" dialog say it BEFORE the agent presses Record (walk 2026-11-20: the dialog said "Will go
 * through", then the server refused with 409 cannot_submit). The authority stays the server's
 * `refuseIfCannotSubmit` (lib/agency/submitGate.ts) on POST …/submissions; this reads the same row the
 * same way — the case's writer (whoever opened it), the producer's can_submit / can_submit_reason —
 * and never blocks anything itself.
 *
 * Null when there is nothing to gate: a solo agent, no writer on the case, or a database without the
 * producer table yet. A failed read is null too: the server still decides on Record.
 */
export async function submitGateFor(tenantId: string, openedBy: string | null): Promise<SubmitGateView | null> {
  if (!openedBy) return null;
  try {
    if (!(await isAgencyTenant(tenantId))) return null;
    const q = await db().from("producer").select("can_submit, can_submit_reason").eq("tenant_id", tenantId).eq("user_id", openedBy).maybeSingle();
    if (q.error) return null; // before migration 20261018100000 there is no producer table: nothing to gate on
    return gateFromProducer(q.data as { can_submit: boolean | null; can_submit_reason: string | null } | null);
  } catch {
    return null;
  }
}

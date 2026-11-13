import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { OPEN_WORK_KINDS, OPEN_WORK_LABEL, type OpenWorkKind } from "./openWork";

/**
 * Settings round 8 · "Hand over now" in the person sheet: a person's open work moves to a teammate and
 * the person stays active. The moves and the taker rules live in tenant_hand_over_member_work
 * (20261112310000), the same as deactivation's; until it is applied the route answers 503.
 */

export class HandOverRefusal extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = "HandOverRefusal";
  }
}

export const HAND_OVER_PENDING = "Handing work over without deactivating needs a database update (20261112310000).";

const isMissing = (error: { code?: string; message?: string }) => error.code === "42883" || error.code === "PGRST202" || /could not find the function|does not exist/i.test(error.message ?? "");

export async function handOverMemberWork(input: { tenantId: string; userId: string; actorId: string; to: string }): Promise<{ moved: Partial<Record<OpenWorkKind, number>> }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getSupabaseServiceClient() as any).rpc("tenant_hand_over_member_work", { p_tenant_id: input.tenantId, p_user_id: input.userId, p_actor: input.actorId, p_to: input.to });
  if (error) {
    const message: string = error.message ?? "";
    if (isMissing(error)) throw new HandOverRefusal(HAND_OVER_PENDING, "schema_pending", 503);
    const cannot = /reassign_target_cannot_work:([a-z_,]+)/.exec(message);
    if (cannot) {
      const kinds = cannot[1].split(",").filter((k): k is OpenWorkKind => (OPEN_WORK_KINDS as readonly string[]).includes(k));
      throw new HandOverRefusal(`That teammate cannot work ${kinds.map((k) => OPEN_WORK_LABEL[k][1]).join(" or ") || "some of this work"}. Choose an owner or an agent.`, "reassign_target_role", 400);
    }
    if (message.includes("reassign_target_invalid")) throw new HandOverRefusal("Choose an active teammate to take the work over.", "reassign_target", 400);
    if (message.includes("member_not_found")) throw new HandOverRefusal("That person is not on this workspace.", "not_found", 404);
    throw new Error(message || "Could not hand the work over");
  }
  const moved = ((data ?? {}) as { moved?: Record<string, number> }).moved ?? {};
  return { moved };
}

import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { languageName, type ReleaseAction } from "./constants";

/**
 * Giving a transfer back, and a buffer leaving a call (20260925709860).
 *
 *   unassign    a transfer being worked goes back to the queue. Nobody owns it any more.
 *   requeue     a transfer whose call dropped goes back to the queue. The next claim resumes the
 *               same verification session, corrections and all (LA-1.10-8, LA-1.11-6).
 *   end_buffer  the buffer assistant leaves a call the licensed agent already owns. Ownership, the
 *               call and the verification do not move (LA-1.14-9). It is not an unassign.
 */
export type { ReleaseAction };

export class TransferReleaseError extends Error {
  constructor(public code: string, message: string, public status: number, public detail: string | null = null) { super(message); }
}

type RpcError = { code?: string; message: string; details?: string | null };
type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError | null }>;

/** The pending-migration message every write in this repo uses. */
export const RELEASE_SCHEMA_PENDING = "This setting needs a database update that has not been applied yet.";

function mapError(error: RpcError): TransferReleaseError {
  if (error.code === "42883" || error.code === "PGRST202" || error.code === "42703") return new TransferReleaseError("schema_pending", RELEASE_SCHEMA_PENDING, 503);
  const detail = error.details ?? null;
  switch (error.message) {
    case "ROLE_NOT_ALLOWED": return new TransferReleaseError("role_not_allowed", "Your role cannot change who has this transfer.", 403);
    case "RELEASE_OWNER_REQUIRED": return new TransferReleaseError("owner_required", "Only the agent who has this transfer, or the account owner, can do that.", 403);
    case "WORK_ITEM_NOT_FOUND": return new TransferReleaseError("work_item_not_found", "That transfer was not found.", 404);
    case "NOT_A_TRANSFER": return new TransferReleaseError("not_a_transfer", "This lead came from the dialer, not a partner transfer. The dialer serves it again.", 409);
    case "HANDOFF_PENDING": return new TransferReleaseError("handoff_pending", "A handoff is being offered on this transfer. Wait for it to be accepted or to time out first.", 409);
    case "NOT_BEING_WORKED": return new TransferReleaseError("not_being_worked", "Nobody is working this transfer, so there is nothing to unassign.", 409);
    case "NOT_DROPPED": return new TransferReleaseError("not_dropped", "Only a transfer whose call dropped goes back in the queue this way.", 409);
    case "NO_BUFFER_INVOLVED": return new TransferReleaseError("no_buffer", "No buffer assistant is on this transfer.", 409);
    case "BUFFER_OWNS_CALL": return new TransferReleaseError("buffer_owns_call", "The buffer still has this call. Hand it off to a licensed agent, or unassign it.", 409);
    case "CALL_ENDED": return new TransferReleaseError("call_ended", "This call has already ended, so there is no buffer involvement to end.", 409);
    case "LANGUAGE_COVER_REQUIRED": return new TransferReleaseError("language_cover_required", `The caller asked for ${languageName(detail)} and the licensed agent does not list it. Confirm to leave the call anyway.`, 409, detail);
    case "INVALID_RELEASE_REASON": return new TransferReleaseError("invalid_input", "Choose a valid action.", 400);
    default: return new TransferReleaseError("release_failed", "Could not update this transfer.", 500);
  }
}

export async function releaseTransfer(params: { tenantId: string; userId: string; workItemId: string; action: ReleaseAction; acknowledgeLanguage?: boolean }) {
  const supabase = getSupabaseServiceClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as Rpc;
  const { data, error } = params.action === "end_buffer"
    ? await rpc("end_buffer_involvement", { p_tenant_id: params.tenantId, p_work_item_id: params.workItemId, p_actor: params.userId, p_acknowledge_language: params.acknowledgeLanguage === true })
    : await rpc("return_transfer_to_queue", { p_tenant_id: params.tenantId, p_work_item_id: params.workItemId, p_actor: params.userId, p_reason: params.action });
  if (error) {
    const mapped = mapError(error);
    if (mapped.code === "release_failed") console.error("[transfer release] failed", params.action, error.code, error.message, error.details);
    throw mapped;
  }
  return (data ?? {}) as Record<string, unknown>;
}

/** The claim refusal for a caller who asked for a language the agent does not list (LA-1.14-10). */
export function languageRefusal(detail: string | null | undefined) {
  const language = languageName(detail);
  return `This caller asked for ${language}, and ${language} is not among your languages. A ${language}-speaking agent can take it, or a buffer who speaks ${language} can take it and hand it to you.`;
}

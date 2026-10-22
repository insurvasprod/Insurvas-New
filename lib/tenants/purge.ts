import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { AVATAR_BUCKET } from "@/lib/users/avatarRules";

// The generated types do not know purge_tenant_workspace / cancelled_workspaces_due (20261016430000) yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpcClient = () => getSupabaseServiceClient() as any;

/**
 * Deleting a cancelled agency's workspace on request (tos-v2 §9, DPA §8). The database deletes
 * every agency row except the kept billing records, or nothing (purge_tenant_workspace,
 * 20261016430000); then the agency's uploaded files go, which only the app can reach. Every
 * agency upload lives under "<tenant id>/" in its bucket; a deleted person's avatar under "<user id>/".
 */

export class PurgeError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}

const REFUSALS: Record<string, [string, number]> = {
  TENANT_NOT_FOUND: ["That agency does not exist.", 404],
  CONFIRMATION_MISMATCH: ["Type the agency's name exactly as it is shown to confirm.", 400],
  REASON_REQUIRED: ["Say why (10 characters or more); it is kept with the record of the deletion.", 400],
  SUBSCRIPTION_NOT_CANCELLED: ["This agency still has a subscription that is not cancelled. Cancel it first.", 409],
  LEGAL_HOLD_ACTIVE: ["This agency has an active legal hold, so its records cannot be deleted.", 409],
  PURGE_INCOMPLETE: ["The deletion could not remove every record, so nothing was deleted.", 409],
};

type PurgeResult = { purgeId: string; deleted: Record<string, number>; passes: number; accountsAnonymised: number; anonymisedUserIds: string[]; kept: string[] };

/** Every object under a prefix, folders included (Storage lists one level at a time). */
async function listAll(bucket: string, prefix: string, depth = 0): Promise<string[]> {
  if (depth > 12) return [];
  const storage = getSupabaseServiceClient().storage.from(bucket);
  const paths: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await storage.list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`);
    for (const entry of data ?? []) {
      const path = `${prefix}/${entry.name}`;
      // A folder has no id; a file does.
      if (entry.id) paths.push(path); else paths.push(...await listAll(bucket, path, depth + 1));
    }
    if (!data || data.length < 1000) break;
  }
  return paths;
}

async function removeFiles(tenantId: string, userIds: string[]) {
  const storage = getSupabaseServiceClient().storage;
  const { data: buckets, error } = await storage.listBuckets();
  if (error) return { removed: 0, problems: [`Could not list the file buckets: ${error.message}`] };
  let removed = 0;
  const problems: string[] = [];
  const targets = [...(buckets ?? []).map((b) => ({ bucket: b.id, prefix: tenantId })), ...userIds.map((u) => ({ bucket: AVATAR_BUCKET, prefix: u }))];
  for (const { bucket, prefix } of targets) {
    try {
      const paths = await listAll(bucket, prefix);
      for (let i = 0; i < paths.length; i += 100) {
        const { error: rmError } = await storage.from(bucket).remove(paths.slice(i, i + 100));
        if (rmError) problems.push(`${bucket}: ${rmError.message}`); else removed += Math.min(100, paths.length - i);
      }
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { removed, problems };
}

export async function purgeWorkspace(input: { tenantId: string; actorId: string; reason: string; confirmName: string }) {
  // requested_by holds the platform admin's id (admin_users, so no foreign key to users).
  const { data, error } = await rpcClient().rpc("purge_tenant_workspace", {
    p_tenant_id: input.tenantId, p_actor: input.actorId, p_reason: input.reason.trim(), p_confirm_name: input.confirmName,
  });
  if (error) {
    const code = Object.keys(REFUSALS).find((k) => (error.message ?? "").includes(k));
    if (code) throw new PurgeError(code === "PURGE_INCOMPLETE" ? `${REFUSALS[code][0]} ${error.message.replace(/^.*PURGE_INCOMPLETE:\s*/, "")}` : REFUSALS[code][0], REFUSALS[code][1], code);
    throw new PurgeError(`The deletion failed and nothing was deleted: ${error.message}`, 500, "PURGE_FAILED");
  }
  const result = data as PurgeResult;
  const files = await removeFiles(input.tenantId, result.anonymisedUserIds ?? []);
  return { ...result, filesRemoved: files.removed, fileProblems: files.problems };
}

/** Agencies past their read-only window and not yet deleted. Nothing is deleted automatically. */
export async function workspacesDueForDeletion() {
  const { data, error } = await rpcClient().rpc("cancelled_workspaces_due");
  if (error) {
    if (/cancelled_workspaces_due/.test(error.message ?? "") && /does not exist|Could not find/i.test(error.message ?? "")) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as Array<{ tenant_id: string; name: string; cancelled_at: string; readable_until: string }>;
}

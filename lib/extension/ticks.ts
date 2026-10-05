import "server-only";

import { ApplicationError, db, isMissingSchema, rows, SchemaPendingError } from "@/lib/applications/db";
import type { CopySurface } from "./constants";
import type { CopyTickView } from "./types";

/**
 * LA-3.14 copy-assist ticks, shared by the inline panel, the pop-out window and the extension (three
 * surfaces, two origins — hence a table, not browser storage). A new attempt has a new application
 * id, so ticks reset by construction. A tick is re-stamped when the value is copied again.
 */

async function attemptOpen(tenantId: string, applicationId: string) {
  const q = await db().from("tenant_applications").select("id, status").eq("tenant_id", tenantId).eq("id", applicationId).maybeSingle();
  if (isMissingSchema(q.error)) throw new SchemaPendingError("The application record");
  if (q.error) throw new ApplicationError("APPLICATION_UNAVAILABLE", q.error.message, 500);
  if (!q.data) throw new ApplicationError("APPLICATION_NOT_FOUND", "That application could not be found.", 404);
  return q.data as { id: string; status: string };
}

export async function listTicks(tenantId: string, applicationId: string): Promise<CopyTickView[]> {
  await attemptOpen(tenantId, applicationId);
  const q = await db().from("tenant_copy_assist_ticks").select("field_key, copied_at, surface").eq("tenant_id", tenantId).eq("application_id", applicationId);
  if (q.error && isMissingSchema(q.error)) return [];
  if (q.error) throw new ApplicationError("APPLICATION_UNAVAILABLE", q.error.message, 500);
  return rows<{ field_key: string; copied_at: string; surface: CopySurface }>(q.data).map((t) => ({ fieldKey: t.field_key, copiedAt: t.copied_at, surface: t.surface }));
}

export async function putTicks(tenantId: string, userId: string, applicationId: string, keys: string[], surface: CopySurface) {
  const a = await attemptOpen(tenantId, applicationId);
  if (a.status === "closed") throw new ApplicationError("APPLICATION_CLOSED", "This attempt is closed. Start a new attempt instead.", 409);
  const now = new Date().toISOString();
  const payload = [...new Set(keys)].map((field_key) => ({ application_id: a.id, tenant_id: tenantId, field_key, copied_at: now, copied_by: userId, surface }));
  const { error } = await db().from("tenant_copy_assist_ticks").upsert(payload, { onConflict: "application_id,field_key" });
  if (isMissingSchema(error)) throw new SchemaPendingError("Copy-assist progress");
  if (error) throw new ApplicationError("APPLICATION_UNAVAILABLE", `Could not save the copy tick: ${error.message}`, 500);
  return { ticked: payload.length, copiedAt: now };
}

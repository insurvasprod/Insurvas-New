import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { AUDIT_ACTION_LABELS, type AuditAction } from "@/lib/audit/actions";

/**
 * A credit note's approval trail (billing-r2 screen 6): who raised it, who approved it, each reconciliation
 * retry, from the audit log (target_type 'credit_note'), with each admin's name. Read only, for the sheet that
 * opens from Refunds & credits.
 */
export type TrailEntry = { id: string; at: string; action: string; label: string; who: string | null; reason: string | null; detail: string | null };

export type CreditNoteRecord = {
  id: string;
  number: string;
  type: string;
  status: string;
  amount_cents: number;
  reason_code: string;
  reason_text: string | null;
  requested_by: string | null;
  requested_by_name: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  created_at: string;
  failure_reason: string | null;
  rejected_reason: string | null;
  reconciliation_state: string;
  reconciliation_attempts: number;
  last_reconciliation_error: string | null;
  provider_refund_id: string | null;
  tenant_id: string;
  tenant_name: string;
  invoice: { id: string; number: string } | null;
  trail: TrailEntry[];
};

export async function fetchCreditNoteRecord(id: string): Promise<CreditNoteRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = getSupabaseServiceClient();
  const [noteResult, trailResult] = await Promise.all([
    db.from("credit_notes").select("*, tenants(name), invoice:platform_invoices(id, number)").eq("id", id).maybeSingle(),
    db.from("audit_log").select("id, ts, action, actor_id, actor_type, reason, metadata").eq("target_type", "credit_note").eq("target_id", id).order("ts", { ascending: true }).limit(100),
  ]);
  if (noteResult.error) throw new Error(`Could not load the credit note: ${noteResult.error.message}`);
  const note = noteResult.data as unknown as (Omit<CreditNoteRecord, "tenant_name" | "requested_by_name" | "approved_by_name" | "trail" | "invoice"> & { approved_by: string | null; tenants: { name: string } | null; invoice: { id: string; number: string } | null }) | null;
  if (!note) return null;

  const trailRows = trailResult.data ?? [];
  const adminIds = [...new Set([note.requested_by, note.approved_by, ...trailRows.map((row) => row.actor_id)].filter((value): value is string => Boolean(value)))];
  const { data: admins } = adminIds.length ? await db.from("admin_users").select("id, name").in("id", adminIds) : { data: [] as { id: string; name: string }[] };
  const nameOf = new Map((admins ?? []).map((admin) => [admin.id, admin.name]));

  const trail: TrailEntry[] = trailRows.map((row) => {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const status = typeof meta.status === "string" ? meta.status.replace(/_/g, " ") : null;
    return {
      id: row.id,
      at: row.ts,
      action: row.action,
      label: AUDIT_ACTION_LABELS[row.action as AuditAction] ?? row.action,
      who: row.actor_id ? nameOf.get(row.actor_id) ?? "An admin" : row.actor_type === "system" ? "The system" : null,
      reason: row.reason,
      detail: status ? `Status ${status}` : null,
    };
  });

  const { tenants, approved_by, ...rest } = note;
  return {
    ...rest,
    tenant_name: tenants?.name ?? "—",
    requested_by_name: note.requested_by ? nameOf.get(note.requested_by) ?? null : null,
    approved_by_name: approved_by ? nameOf.get(approved_by) ?? null : null,
    trail,
  };
}

import { AUDIT_LOG_PAGE_SIZE } from "@/lib/audit/constants";
import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { AuditLogTable } from "@/components/admin/audit-log-table";
import { AdminPageHeader } from "@/components/admin/page-header";



export default async function AuditLogPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");

  const supabase = getSupabaseServiceClient();

  let query = supabase
    .from("audit_log")
    .select("id, ts, actor_type, actor_id, action, target_type, target_id, reason, ip, user_agent, metadata", {
      count: "exact",
    })
    .order("ts", { ascending: false });

  if (admin.role !== "super_admin") {
    query = query.eq("actor_id", admin.id);
  }

  const { data: rows, count } = await query.range(0, AUDIT_LOG_PAGE_SIZE - 1);

  const actorIds = [...new Set((rows ?? []).map((r) => r.actor_id).filter((id): id is string => Boolean(id)))];
  const { data: actorRows } = actorIds.length
    ? await supabase.from("admin_users").select("id, name, email").in("id", actorIds)
    : { data: [] };
  const actorById = new Map((actorRows ?? []).map((a) => [a.id, a]));

  const entries = (rows ?? []).map((row) => ({ ...row, actor: row.actor_id ? (actorById.get(row.actor_id) ?? null) : null }));

  // The actor filter only makes sense for super_admin — everyone else is locked to themselves.
  const { data: allAdmins } =
    admin.role === "super_admin" ? await supabase.from("admin_users").select("id, name, email") : { data: [] };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <AdminPageHeader
        title="Audit log"
        subtitle={
          admin.role === "super_admin"
            ? "Every recorded admin action, platform-wide. Append-only."
            : "Your own recorded actions. Append-only."
        }
      />
      <AuditLogTable
        initialEntries={entries}
        initialTotal={count ?? 0}
        pageSize={AUDIT_LOG_PAGE_SIZE}
        isSuperAdmin={admin.role === "super_admin"}
        allAdmins={allAdmins ?? []}
      />
    </div>
  );
}

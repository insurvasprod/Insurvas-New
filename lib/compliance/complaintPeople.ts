import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Who a complaint can be owned by or be about (the agency's accepted members), and which partner sent the
 * lead: the pickers on Complaints' record and new-complaint pages (LA-6.4). Server only.
 */
export type ComplaintPerson = { id: string; name: string; role: string };

export async function complaintPeople(tenantId: string): Promise<{ team: ComplaintPerson[]; partners: { id: string; name: string }[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseServiceClient() as any;
  const [team, partners] = await Promise.all([
    db.from("tenant_users").select("user_id, role, users!inner(name, email)").eq("tenant_id", tenantId).not("accepted_at", "is", null),
    db.from("partners").select("id, name").eq("tenant_id", tenantId).order("name"),
  ]);
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    team: ((team.data ?? []) as any[]).map((m) => ({ id: m.user_id as string, name: (m.users?.name as string | null) ?? (m.users?.email as string) ?? "Unnamed", role: m.role as string })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    partners: ((partners.data ?? []) as any[]).map((p) => ({ id: p.id as string, name: p.name as string })),
  };
}

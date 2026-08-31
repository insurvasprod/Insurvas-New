import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { fetchAcceptanceStats, fetchAllVersions, fetchUserAcceptances } from "@/lib/legal/queries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { AdminPageHeader } from "@/components/admin/page-header";
import { LegalScreen } from "@/components/admin/legal-screen";
import { LEGAL_DOC_LABELS, type LegalDocType } from "@/lib/legal/constants";

export default async function LegalPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // No role gate on reading: the acceptance record is exactly what a support agent needs when a
  // customer disputes something. Publishing is super_admin only, enforced on the route and
  // reflected in `canPublish` below.

  const { user: userQuery } = await searchParams;

  const [stats, versions] = await Promise.all([fetchAcceptanceStats(), fetchAllVersions()]);

  // The per-user lookup the ticket asks for: "any user's full acceptance history on one screen".
  let lookup: { email: string; found: boolean; records: Awaited<ReturnType<typeof fetchUserAcceptances>> } | null =
    null;

  if (userQuery?.trim()) {
    const supabase = getSupabaseServiceClient();
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("email", userQuery.trim().toLowerCase())
      .maybeSingle<{ id: string }>();

    lookup = {
      email: userQuery.trim(),
      found: Boolean(user),
      records: user ? await fetchUserAcceptances(user.id) : [],
    };
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Legal documents"
        subtitle="What each user agreed to, and when — from a record, not an assumption"
      />

      <LegalScreen
        canPublish={admin.role === "super_admin"}
        stats={stats.map((s) => ({ ...s, label: LEGAL_DOC_LABELS[s.doc_type as LegalDocType] }))}
        versions={versions}
        lookup={lookup}
      />
    </div>
  );
}

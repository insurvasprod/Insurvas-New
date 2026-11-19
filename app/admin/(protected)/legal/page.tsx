import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { fetchAcceptanceStats, fetchUserAcceptances } from "@/lib/legal/queries";
import { countEligibleUsers, fetchAdminLegalVersions, fetchLegalDrafts } from "@/lib/legal/admin";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { LegalScreen } from "@/components/admin/legal-screen";
import { LegalDocTabs } from "@/components/admin/legal/doc-tabs";
import { PlatformPage } from "@/components/admin/platform/platform-page";
import { LEGAL_DOC_LABELS, LEGAL_DOC_TYPES, type LegalDocType } from "@/lib/legal/constants";

export default async function LegalPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string; doc?: string }>;
}) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // No role gate on reading: the acceptance record is exactly what a support agent needs when a
  // customer disputes something. Publishing is super_admin only, enforced on the route and
  // reflected in `canPublish` below.

  const { user: userQuery, doc: docParam } = await searchParams;
  const initialDoc: LegalDocType = (LEGAL_DOC_TYPES as readonly string[]).includes(docParam ?? "")
    ? (docParam as LegalDocType)
    : "tos";

  // Drafts (legal_document_drafts, 20260924363000) are read here and on /api/admin/legal only —
  // never by a customer surface. Before the migration is applied `draftsSupported` is false and the
  // editor publishes directly, as the page did before drafts existed.
  const [stats, versions, draftRead, eligibleUsers] = await Promise.all([
    fetchAcceptanceStats(),
    fetchAdminLegalVersions(),
    fetchLegalDrafts(),
    countEligibleUsers().catch((error) => {
      console.error("[legal] could not count eligible users", error);
      return null;
    }),
  ]);

  // The per-user lookup the ticket asks for: "any user's full acceptance history on one screen".
  let lookup: { email: string; found: boolean; records: Awaited<ReturnType<typeof fetchUserAcceptances>> } | null =
    null;

  if (userQuery?.trim()) {
    const supabase = getSupabaseServiceClient();
    const { data: user, error } = await supabase
      .from("users")
      .select("id")
      .eq("email", userQuery.trim().toLowerCase())
      .maybeSingle<{ id: string }>();

    // This screen is the evidence in a dispute. A failed lookup rendered as `found: false` tells
    // the reader that a customer never accepted the terms — which is the single most expensive
    // wrong answer this page can give, and indistinguishable from the truthful one.
    if (error) throw new Error(`Could not look up that user: ${error.message}`);

    lookup = {
      email: userQuery.trim(),
      found: Boolean(user),
      records: user ? await fetchUserAcceptances(user.id) : [],
    };
  }

  // Inside the Platform frame (admin round 1, 2026-11-18). The Terms · Privacy · DPA bar sits on the title line and
  // switches `?doc=` in place; LegalScreen reads the same parameter.
  return (
    <PlatformPage
      step="legal"
      info="The Terms, Privacy policy and DPA customers accept, every version of each, and any user's acceptance record. Publishing is super admin only."
      tabs={<LegalDocTabs initialDoc={initialDoc} />}
    >
      <LegalScreen
        canPublish={admin.role === "super_admin"}
        initialDoc={initialDoc}
        today={new Date().toISOString().slice(0, 10)}
        stats={stats.map((s) => ({ ...s, label: LEGAL_DOC_LABELS[s.doc_type as LegalDocType] }))}
        versions={versions}
        drafts={draftRead.drafts}
        draftsSupported={draftRead.supported}
        eligibleUsers={eligibleUsers}
        lookup={lookup}
      />
    </PlatformPage>
  );
}

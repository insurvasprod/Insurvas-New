import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { DeletionError, getDeletionRequest } from "@/lib/compliance/dataSubjectStore";
import { buildDeletionCertificate } from "@/lib/compliance/deletionCertificate";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { refuseNarrowInAgency } from "@/lib/agency/routeScope";

/**
 * LA-6.5 (Notion sprint) · the deletion certificate as a PDF, sendable to the requester. Built from
 * the request's recorded results, so it can be produced again at any time and always says the same.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("tcpa_checker", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Deletion requests");
  if (refused) return refused;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That request isn't here." }, { status: 404 });
  const { tenantId, userId, role } = auth.context;
  try {
    const r = await getDeletionRequest({ tenantId, userId, role }, id);
    if (r.status !== "completed") return NextResponse.json({ error: "A certificate is issued once the deletion is done." }, { status: 409 });
    const db = getSupabaseServiceClient();
    const ids = [r.verifiedBy, r.performedBy].filter((x): x is string => Boolean(x));
    const [{ data: users }, { data: tenant }] = await Promise.all([
      ids.length ? db.from("users").select("id, name").in("id", ids) : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
      db.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
    ]);
    const name = (u: string | null) => (u ? (users ?? []).find((x) => x.id === u)?.name ?? null : null);
    const bytes = await buildDeletionCertificate(r, { verifiedBy: name(r.verifiedBy), performedBy: name(r.performedBy), agency: tenant?.name ?? "Our agency" });
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="deletion-certificate-${id.slice(0, 8)}.pdf"`, "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DeletionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[deletion-certificate]", error);
    return NextResponse.json({ error: "The certificate could not be produced" }, { status: 500 });
  }
}

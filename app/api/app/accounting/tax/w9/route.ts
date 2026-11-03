import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { attachW9, TaxError, w9Url } from "@/lib/accounting/taxStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-7.8 (Notion sprint) · a payee's W-9: attach it (PDF or image, tenant-scoped storage; attaching ticks
 * "W-9 on file") and open the newest one through a 60-second signed link. Owner and bookkeeper only.
 */
const ROLES = ["owner", "bookkeeper"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (error: unknown) => {
  if (error instanceof TaxError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[tax-w9]", error);
  return NextResponse.json({ error: "That didn't work" }, { status: 500 });
};

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("tax_summaries", ROLES);
  if (auth instanceof NextResponse) return auth;
  const profile = request.nextUrl.searchParams.get("profile") ?? "";
  if (!UUID.test(profile)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.redirect(await w9Url(auth.context.tenantId, profile), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("tax_summaries", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const form = await request.formData().catch(() => null);
  const profile = String(form?.get("profile") ?? "");
  const file = form?.get("file");
  if (!UUID.test(profile)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to attach." }, { status: 400 });
  const { tenantId, userId } = auth.context;
  try {
    await attachW9(tenantId, profile, file);
    await audit({ actorType: "tenant", actorId: userId, action: "accounting.tax_profile_saved", targetType: "payee_tax_profile", targetId: profile, metadata: { tenantId, w9: true }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}

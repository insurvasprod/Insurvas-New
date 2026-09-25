import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { loadTenantUsers } from "@/lib/adminTenantUsers/queries";
import { membersCsv } from "@/lib/adminTenantUsers/present";
import { TENANT_ROLE_LABELS, isTenantRole } from "@/lib/tenantAuth/roles";

/**
 * The tenant's people as CSV, names and emails included. super_admin only, and audited before the
 * file is returned: personal data leaving the product is the event worth a trail.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(["super_admin"]);
  if (auth instanceof NextResponse) return auth;

  const { id: tenantId } = await params;
  if (!z.string().uuid().safeParse(tenantId).success) {
    return NextResponse.json({ error: "That tenant identifier is not valid" }, { status: 400 });
  }

  const { data: tenant, error: tenantError } = await getSupabaseServiceClient().from("tenants").select("id, name").eq("id", tenantId).maybeSingle<{ id: string; name: string }>();
  if (tenantError) return NextResponse.json({ error: "Could not load this tenant" }, { status: 500 });
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  let csv: string;
  let rows: number;
  try {
    const { members } = await loadTenantUsers(tenantId);
    rows = members.length;
    csv = membersCsv(members, (role) => (isTenantRole(role) ? TENANT_ROLE_LABELS[role] : role));
  } catch (error) {
    console.error("[admin tenant users] export failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not export this tenant's people" }, { status: 500 });
  }

  await audit({
    actorId: auth.session.sub,
    action: "tenant.users_exported",
    targetType: "tenant",
    targetId: tenantId,
    metadata: { rows, includesEmails: true },
    request,
  });

  const slug = tenant.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tenant";
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${slug}-people-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}

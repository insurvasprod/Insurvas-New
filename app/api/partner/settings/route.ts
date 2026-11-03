import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";

import { getPartnerTemplateForProduct } from "@/lib/agentTemplates/service";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { listPartnerApprovedProducts } from "@/lib/partnerProducts/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function GET() {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;

  const { tenantId, partnerId, userId } = auth.context;
  const db = getSupabaseServiceClient();
  const [partnerResult, userResult, approvedProducts, agencyResult] = await Promise.all([
    db.from("partners").select("id, name, contact_name, contact_email, timezone, status").eq("tenant_id", tenantId).eq("id", partnerId).maybeSingle(),
    db.from("users").select("id, name, email, last_login_at").eq("id", userId).maybeSingle(),
    // Caught here so a failure still lands on the same 500 below rather than escaping the route.
    listPartnerApprovedProducts(tenantId, partnerId).catch(() => null),
    // The agency that owns the agent-managed controls, named on the settings card. Optional: a
    // failed read leaves the card saying "your agent" rather than failing the page.
    db.from("tenants").select("name").eq("id", tenantId).maybeSingle<{ name: string }>(),
  ]);

  if (partnerResult.error || userResult.error || !partnerResult.data || !userResult.data || !approvedProducts) {
    return NextResponse.json({ error: "Could not load partner settings" }, { status: 500 });
  }

  try {
    const products = await Promise.all(approvedProducts.map(async (product) => {
      try {
        const template = await getPartnerTemplateForProduct(tenantId, partnerId, userId, product.code);
        return { code: product.code, name: product.name, formVersion: template.assignment.definition_version, managedBy: "Your agent" };
      } catch {
        return { code: product.code, name: product.name, formVersion: null, managedBy: "Your agent" };
      }
    }));

    return NextResponse.json({
      partner: {
        id: partnerResult.data.id,
        name: partnerResult.data.name,
        contactName: partnerResult.data.contact_name,
        contactEmail: partnerResult.data.contact_email,
        timezone: partnerResult.data.timezone,
        status: partnerResult.data.status,
      },
      user: {
        id: userResult.data.id,
        name: userResult.data.name,
        email: userResult.data.email,
        lastLoginAt: userResult.data.last_login_at,
      },
      agency: { name: agencyResult.data?.name ?? null },
      products,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load partner settings" }, { status: 500 });
  }
}

const timezoneSchema = z.object({ timezone: z.string().trim().min(1).max(64) }).strict();

/** A real IANA zone: the runtime rejects anything else, which is the whole validation. */
function isTimeZone(value: string) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
}

/**
 * The partner organisation's timezone (p-par-settings, Profile & notifications). Submission dates
 * and "since 00:00 your time" are read in it. A partner admin sets it for the organisation; a
 * partner user cannot, and the form says so rather than offering a control that fails.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  if (auth.context.role !== "partner_admin") return NextResponse.json({ error: "Only a partner admin can change the organization timezone." }, { status: 403 });
  const parsed = timezoneSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isTimeZone(parsed.data.timezone)) return NextResponse.json({ error: "Choose a valid timezone." }, { status: 400 });

  const { tenantId, partnerId, userId } = auth.context;
  const db = getSupabaseServiceClient();
  const before = await db.from("partners").select("timezone").eq("tenant_id", tenantId).eq("id", partnerId).maybeSingle<{ timezone: string }>();
  const updated = await db.from("partners").update({ timezone: parsed.data.timezone }).eq("tenant_id", tenantId).eq("id", partnerId).select("timezone").maybeSingle<{ timezone: string }>();
  if (updated.error || !updated.data) return NextResponse.json({ error: "The timezone could not be saved." }, { status: 503 });
  await audit({ actorType: "tenant", actorId: userId, action: "tenant.partner_timezone_updated", targetType: "partner", targetId: partnerId, metadata: { from: before.data?.timezone ?? null, to: updated.data.timezone, actorPlane: "partner" }, request });
  return NextResponse.json({ timezone: updated.data.timezone });
}

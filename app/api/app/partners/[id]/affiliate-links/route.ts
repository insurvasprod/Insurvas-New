import { NextResponse } from "next/server";

import { audit } from "@/lib/audit/log";
import { createAffiliateLink, listAffiliateLinks } from "@/lib/affiliate/service";
import { affiliateLinkSchema } from "@/lib/affiliate/schemas";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const PARTNER_ROLES = ["owner", "bookkeeper"] as const;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("publisher_records", PARTNER_ROLES);
  if (auth instanceof NextResponse) return auth;
  try { return NextResponse.json({ links: await listAffiliateLinks(auth.context.tenantId, (await params).id) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load affiliate links" }, { status: 500 }); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("publisher_records", PARTNER_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const partnerId = (await params).id;
  const parsed = affiliateLinkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid affiliate link details" }, { status: 400 });
  try {
    const link = await createAffiliateLink(auth.context.tenantId, partnerId, parsed.data);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.affiliate_link_created", targetType: "affiliate_link", targetId: link.id, metadata: { partnerId, slug: link.slug, campaign: link.campaign }, request });
    return NextResponse.json({ link }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create affiliate link";
    const status = message === "affiliate_slug_taken" ? 409 : message === "affiliate_partner_required" || message === "partner_offboarded" ? 400 : 400;
    return NextResponse.json({ error: message === "affiliate_slug_taken" ? "That tracked-link slug is already in use" : message === "affiliate_partner_required" ? "Choose an affiliate partner" : message }, { status });
  }
}

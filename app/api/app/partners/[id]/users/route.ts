import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { buildPartnerInviteUrl, generateInviteToken, hashInviteToken, inviteExpiryFromNow } from "@/lib/users/invitations";
import { sendInvitationEmail } from "@/lib/email/sendInvitationEmail";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { partnerUserInviteSchema } from "@/lib/partnerAuth/schemas";
import { invitePartnerUser, listPartnerUsers } from "@/lib/partnerUsers/service";

const OWNER_ROLES = ["owner", "bookkeeper"] as const;

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function partnerIdFrom(params: Promise<{ id: string }>) {
  const { id } = await params;
  return validUuid(id) ? id : null;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("publisher_records", OWNER_ROLES);
  if (auth instanceof NextResponse) return auth;
  const partnerId = await partnerIdFrom(params);
  if (!partnerId) return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  try {
    return NextResponse.json({ users: await listPartnerUsers(auth.context.tenantId, partnerId) });
  } catch {
    return NextResponse.json({ error: "Could not load partner users" }, { status: 404 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("publisher_records", OWNER_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const partnerId = await partnerIdFrom(params);
  if (!partnerId) return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  const parsed = partnerUserInviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid partner user details" }, { status: 400 });

  const token = generateInviteToken();
  const expiresAt = await inviteExpiryFromNow();
  try {
    const result = await invitePartnerUser({ tenantId: auth.context.tenantId, partnerId, ...parsed.data, tokenHash: hashInviteToken(token), expiresAt: expiresAt.toISOString() });
    const origin = process.env.NEXT_PUBLIC_PARTNER_APP_URL || process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const inviteUrl = buildPartnerInviteUrl(token, origin);
    const { delivered } = await sendInvitationEmail({ to: result.email, name: result.name, inviteUrl, expiresAt, userId: result.user_id, tenantId: result.tenant_id });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_user_invited", targetType: "partner_user", targetId: result.user_id, metadata: { partnerId, email: result.email, role: result.role, delivered, actorPlane: "agent" }, request });
    return NextResponse.json({ ok: true, user: { id: result.user_id, name: result.name, email: result.email, role: result.role }, invite: { url: inviteUrl, expiresAt: expiresAt.toISOString(), delivered } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not invite partner user";
    if (message.includes("partner_user_email_exists") || message.includes("duplicate key")) return NextResponse.json({ error: "This email is already registered" }, { status: 409 });
    if (message.includes("partner_not_found")) return NextResponse.json({ error: "Partner not found" }, { status: 404 });
    return NextResponse.json({ error: "Could not invite partner user" }, { status: 500 });
  }
}

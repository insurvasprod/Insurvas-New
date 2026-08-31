import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_SETTINGS } from "@/lib/settings/permissions";
import { deleteAnnouncement, updateAnnouncement } from "@/lib/system/service";

const schema = z.object({
  message: z.string().trim().min(1, "Enter an announcement message").max(1000),
  type: z.enum(["info", "warning", "critical"]),
  audience: z.enum(["all", "individual", "agency_no_teams", "agency_with_teams", "management"]),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }),
  is_dismissible: z.boolean().default(true),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_SETTINGS);
  if (auth instanceof NextResponse) return auth;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid announcement" }, { status: 400 });
  if (new Date(parsed.data.ends_at) <= new Date(parsed.data.starts_at)) return NextResponse.json({ error: "End must be after start" }, { status: 400 });
  const { id } = await params;

  try {
    const announcement = await updateAnnouncement(id, {
      message: parsed.data.message,
      type: parsed.data.type,
      audience: parsed.data.audience,
      startsAt: parsed.data.starts_at,
      endsAt: parsed.data.ends_at,
      isDismissible: parsed.data.is_dismissible,
    });
    await audit({ actorId: auth.session.sub, action: "announcement.updated", targetType: "announcement", targetId: id, metadata: { type: announcement.type, audience: announcement.audience }, request });
    return NextResponse.json({ announcement });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update announcement" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_SETTINGS);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  try {
    await deleteAnnouncement(id);
    await audit({ actorId: auth.session.sub, action: "announcement.deleted", targetType: "announcement", targetId: id, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete announcement" }, { status: 400 });
  }
}

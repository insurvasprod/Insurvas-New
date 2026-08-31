import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_SETTINGS } from "@/lib/settings/permissions";
import { createAnnouncement } from "@/lib/system/service";

const schema = z.object({
  message: z.string().trim().min(1, "Enter an announcement message").max(1000),
  type: z.enum(["info", "warning", "critical"]),
  audience: z.enum(["all", "individual", "agency_no_teams", "agency_with_teams", "management"]),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }),
  is_dismissible: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_SETTINGS);
  if (auth instanceof NextResponse) return auth;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid announcement" }, { status: 400 });
  if (new Date(parsed.data.ends_at) <= new Date(parsed.data.starts_at)) return NextResponse.json({ error: "End must be after start" }, { status: 400 });

  try {
    const announcement = await createAnnouncement({
      message: parsed.data.message,
      type: parsed.data.type,
      audience: parsed.data.audience,
      startsAt: parsed.data.starts_at,
      endsAt: parsed.data.ends_at,
      isDismissible: parsed.data.is_dismissible,
      createdBy: auth.session.sub,
    });
    await audit({ actorId: auth.session.sub, action: "announcement.created", targetType: "announcement", targetId: announcement.id, metadata: { type: announcement.type, audience: announcement.audience }, request });
    return NextResponse.json({ announcement }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create announcement" }, { status: 400 });
  }
}

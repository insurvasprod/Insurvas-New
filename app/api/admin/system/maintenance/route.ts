import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_SETTINGS } from "@/lib/settings/permissions";
import { getMaintenanceStatus, setMaintenance } from "@/lib/system/service";

const schema = z.object({
  level: z.enum(["off", "banner_only", "read_only", "locked"]),
  message: z.string().trim().max(1000).optional().default(""),
  scheduled_start: z.string().datetime({ offset: true }).nullable().optional(),
  scheduled_end: z.string().datetime({ offset: true }).nullable().optional(),
});

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_SETTINGS);
  if (auth instanceof NextResponse) return auth;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid maintenance settings" }, { status: 400 });

  const { level, message, scheduled_start, scheduled_end } = parsed.data;
  if (level !== "off" && message.length < 1) return NextResponse.json({ error: "Enter a maintenance message" }, { status: 400 });
  if (level === "off" && (scheduled_start || scheduled_end)) return NextResponse.json({ error: "Turn maintenance on before scheduling a window" }, { status: 400 });
  if ((scheduled_start && !scheduled_end) || (!scheduled_start && scheduled_end)) return NextResponse.json({ error: "Choose both a scheduled start and end" }, { status: 400 });
  if (scheduled_start && scheduled_end && new Date(scheduled_end) <= new Date(scheduled_start)) return NextResponse.json({ error: "Scheduled end must be after scheduled start" }, { status: 400 });

  try {
    const before = await getMaintenanceStatus();
    const change = await setMaintenance(
      {
        level: level === "off" ? null : level,
        message,
        scheduledStart: scheduled_start ?? null,
        scheduledEnd: scheduled_end ?? null,
      },
      auth.session.sub,
    );
    await audit({
      actorId: auth.session.sub,
      action: "maintenance.updated",
      targetType: "maintenance",
      targetId: "1",
      metadata: {
        changes: {
          level: { from: before.level, to: level },
          scheduledStart: { from: before.scheduledStart, to: scheduled_start ?? null },
          scheduledEnd: { from: before.scheduledEnd, to: scheduled_end ?? null },
        },
      },
      request,
    });
    return NextResponse.json({ ok: true, maintenance: await getMaintenanceStatus(), changed: Boolean(change.from || change.to) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save maintenance settings" }, { status: 400 });
  }
}

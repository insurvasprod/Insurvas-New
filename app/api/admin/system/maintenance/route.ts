import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import {
  CAN_CHANGE_MAINTENANCE,
  confirmsLock,
  LOCK_CONFIRM_PHRASE,
  MAINTENANCE_REASON_MAX,
  MAINTENANCE_REASON_MIN,
} from "@/lib/system/adminFormat";
import { getMaintenanceStatus, setMaintenance } from "@/lib/system/service";

const REASON_ERROR = `Give a reason of ${MAINTENANCE_REASON_MIN}–${MAINTENANCE_REASON_MAX} characters; it is recorded in the audit log`;

const schema = z.object({
  level: z.enum(["off", "banner_only", "read_only", "locked"]),
  message: z.string().trim().max(1000).optional().default(""),
  scheduled_start: z.string().datetime({ offset: true }).nullable().optional(),
  scheduled_end: z.string().datetime({ offset: true }).nullable().optional(),
  // Every change affects every customer, so every change says why. It lands in the audit row.
  reason: z
    .string({ error: REASON_ERROR })
    .trim()
    .min(MAINTENANCE_REASON_MIN, REASON_ERROR)
    .max(MAINTENANCE_REASON_MAX, REASON_ERROR),
  // Required whenever the new level is locked (checked below), including while it already is.
  confirmPhrase: z.string().max(100).optional(),
});

/**
 * Maintenance changes every customer's access at once, so it is super_admin only (it used to be
 * the wider settings pair, super_admin + platform_config). platform_config can still open the
 * screen, read the state and run announcements.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdminRole(CAN_CHANGE_MAINTENANCE);
  if (auth instanceof NextResponse) return auth;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid maintenance settings" }, { status: 400 });

  const { level, message, scheduled_start, scheduled_end, reason, confirmPhrase } = parsed.data;
  if (level === "locked" && !confirmsLock(confirmPhrase ?? "")) {
    return NextResponse.json({ error: `Type "${LOCK_CONFIRM_PHRASE}" to confirm locking the platform` }, { status: 400 });
  }
  if (level !== "off" && message.length < 1) return NextResponse.json({ error: "Enter a maintenance message" }, { status: 400 });
  if (level === "off" && (scheduled_start || scheduled_end)) return NextResponse.json({ error: "Turn maintenance on before scheduling a window" }, { status: 400 });
  // An end on its own is allowed: "on now, back by 03:00" is the common case, and the service
  // already treats a missing start as "applies immediately". A start with no end is still refused.
  if (scheduled_start && !scheduled_end) return NextResponse.json({ error: "Choose a scheduled end as well" }, { status: 400 });
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
      reason,
      metadata: {
        changes: {
          level: { from: before.level, to: level },
          message: { from: before.message, to: level === "off" ? null : message },
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

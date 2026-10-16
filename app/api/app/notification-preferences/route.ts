import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getEntitlement } from "@/lib/entitlements/get";
import { effectiveFeatures } from "@/lib/features/killSwitch";
import { resolveDelivery, visibleEvents } from "@/lib/notifications/events";
import { forgetDelivery, loadNotificationSettings, loadPreferences, NotificationPreferenceError, savePreference, saveQuietHours } from "@/lib/notifications/preferences";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { getViewerTimezone } from "@/lib/users/viewerTimezone";

/**
 * LA-8.4 (Notion sprint) · my notification preferences: per event, per channel, the digest for
 * high-volume ones, and quiet hours. Every role, own choices only. Events this person cannot receive
 * (a feature their plan lacks, a role it is not for) are absent. The four protected events come back
 * locked, and no write here can switch them off.
 */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 21:00");
const bodySchema = z.union([
  z.object({ event_key: z.string().min(1).max(64), in_app: z.boolean().optional(), email: z.boolean().optional(), push: z.boolean().optional(), digest: z.enum(["immediate", "daily", "weekly", "off"]).optional() }).strict(),
  z.object({ quiet: z.object({ enabled: z.boolean(), start: hhmm, end: hhmm }).strict() }).strict(),
]);

async function view(context: { userId: string; tenantId: string; role: Parameters<typeof visibleEvents>[1] }) {
  const entitlement = await getEntitlement(context.tenantId);
  const [granted, prefs, settings, timeZone] = await Promise.all([
    effectiveFeatures(entitlement.features, context.tenantId),
    loadPreferences(context.userId),
    loadNotificationSettings(context.userId),
    getViewerTimezone(context.tenantId, context.userId),
  ]);
  return {
    available: settings.available,
    timeZone,
    quiet: settings.quiet,
    events: visibleEvents(granted, context.role).map((e) => ({
      key: e.key, label: e.label, description: e.description, group: e.group,
      supportsDigest: e.supports_digest, protected: e.is_protected, protectedReason: e.protected_reason ?? null,
      delivery: resolveDelivery(e, prefs.get(e.key)),
    })),
  };
}

export async function GET() {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await view(auth.context), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[notification-preferences]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Your notification preferences could not be read." }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a notification and a channel." }, { status: 400 });
  try {
    if ("quiet" in parsed.data) await saveQuietHours(auth.context.userId, parsed.data.quiet);
    else {
      const { event_key, ...patch } = parsed.data;
      await savePreference(auth.context.userId, event_key, patch);
    }
    forgetDelivery(auth.context.userId);
    return NextResponse.json(await view(auth.context));
  } catch (error) {
    if (error instanceof NotificationPreferenceError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[notification-preferences]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "That could not be saved. Nothing changed." }, { status: 500 });
  }
}

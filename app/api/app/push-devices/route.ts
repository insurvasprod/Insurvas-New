import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { deviceLabel } from "@/lib/tenantAuth/securityRules";
import { registerPushDevice, retirePushToken } from "@/lib/push/devices";
import { isExpoPushToken } from "@/lib/push/rules";

/**
 * The phone app's push registration (2026-11-24). POST after sign-in (and whenever the token changes);
 * DELETE when the person turns alerts off in the app. Any role: the bell belongs to everyone.
 * The device is bound to the caller's session row, so ending the session ends its push.
 */
const postSchema = z.object({ token: z.string().refine(isExpoPushToken, "Not a push token."), platform: z.enum(["ios", "android"]) }).strict();
const deleteSchema = z.object({ token: z.string().refine(isExpoPushToken, "Not a push token.") }).strict();

export async function POST(request: NextRequest) {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That phone could not be registered for alerts." }, { status: 400 });
  try {
    const result = await registerPushDevice({
      userId: auth.context.userId,
      tenantId: auth.context.tenantId,
      sessionId: auth.context.sessionId ?? null,
      token: parsed.data.token,
      platform: parsed.data.platform,
      deviceLabel: deviceLabel(request.headers.get("user-agent")),
    });
    // Before migration 20261124100000 the app keeps working without push.
    return NextResponse.json({ ok: true, push: result === "saved" });
  } catch {
    return NextResponse.json({ error: "Alerts could not be turned on right now." }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That phone is not registered." }, { status: 400 });
  try {
    await retirePushToken(auth.context.userId, parsed.data.token);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Alerts could not be turned off right now." }, { status: 503 });
  }
}

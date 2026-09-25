import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import {
  CalendarProviderNotConfiguredError,
  calendarProviders,
  disconnectCalendar,
  listCalendarConnections,
  startCalendarConnection,
  syncCalendarBusy,
} from "@/lib/appointments/linkedCalendars";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Settings › Calendar & availability · linked calendars (20260924230200).
 *
 * The same people who can see and change a calendar can link one: an owner for anyone, everyone
 * else for themselves. Tokens never leave the server — the list carries the account and its state.
 */
const CALENDAR_ROLES = ["owner", "producer", "assistant"] as const;

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("connect"), provider: z.enum(["google", "microsoft"]), userId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("sync"), id: z.string().uuid() }).strict(),
]);

export async function GET() {
  const auth = await requireFeatureRole("outbound_dialing", CALENDAR_ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    const { available, connections } = await listCalendarConnections(auth.context.tenantId);
    return NextResponse.json({ available, providers: calendarProviders(), connections }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load linked calendars" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", CALENDAR_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  if (!hasTenantPermission(auth.context.role, "calendar.manage"))
    return NextResponse.json({ error: "Your role cannot change the calendar", code: "role_not_allowed" }, { status: 403 });
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a calendar action" }, { status: 400 });

  try {
    if (parsed.data.action === "connect") {
      if (auth.context.role !== "owner" && parsed.data.userId !== auth.context.userId)
        return NextResponse.json({ error: "You can only link your own calendar.", code: "not_your_calendar" }, { status: 403 });
      const url = await startCalendarConnection({ tenantId: auth.context.tenantId, userId: parsed.data.userId, provider: parsed.data.provider });
      return NextResponse.json({ url });
    }

    const syncId = parsed.data.id;
    const { connections } = await listCalendarConnections(auth.context.tenantId);
    const connection = connections.find((item) => item.id === syncId);
    if (!connection) return NextResponse.json({ error: "That calendar is not linked here." }, { status: 404 });
    if (auth.context.role !== "owner" && connection.userId !== auth.context.userId)
      return NextResponse.json({ error: "You can only refresh your own calendar.", code: "not_your_calendar" }, { status: 403 });
    const busy = await syncCalendarBusy(connection.id);
    return NextResponse.json({ ok: true, busy });
  } catch (error) {
    if (error instanceof CalendarProviderNotConfiguredError)
      return NextResponse.json({ error: error.message, code: "provider_not_configured", missing: error.missing }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not reach the calendar" }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", CALENDAR_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  if (!hasTenantPermission(auth.context.role, "calendar.manage"))
    return NextResponse.json({ error: "Your role cannot change the calendar", code: "role_not_allowed" }, { status: 403 });
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Choose a linked calendar" }, { status: 400 });
  try {
    const { connections } = await listCalendarConnections(auth.context.tenantId);
    const connection = connections.find((item) => item.id === id);
    if (!connection) return NextResponse.json({ error: "That calendar is not linked here." }, { status: 404 });
    if (auth.context.role !== "owner" && connection.userId !== auth.context.userId)
      return NextResponse.json({ error: "You can only unlink your own calendar.", code: "not_your_calendar" }, { status: 403 });
    await disconnectCalendar(auth.context.tenantId, id);
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.calendar_unlinked",
      targetType: "tenant_connected_calendars",
      targetId: id,
      metadata: { provider: connection.provider, userId: connection.userId },
      request,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not unlink that calendar" }, { status: 500 });
  }
}

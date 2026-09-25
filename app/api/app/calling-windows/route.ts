import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { SchemaGapError } from "@/lib/appointments/schemaGap";
import { FEDERAL_MINUTES, minuteLabel, type MinuteWindow } from "@/lib/callingWindow/engine";
import {
  getCallingWindows,
  saveCallingWindowOptions,
  saveCampaignCallingWindow,
  saveTenantCallingWindow,
} from "@/lib/callingWindow/service";

/**
 * LA-2.4 · the hours this agency is willing to dial in.
 *
 * Reading is open to anyone who dials, because "why can I not call this lead yet" is answered by
 * this data. Writing is the owner's: narrowing the window stops everybody working, and widening it
 * is not possible at all — every layer may only tighten, and the route says so rather than storing
 * a value the engine will ignore.
 *
 * A window may arrive in whole hours (`startHour`/`endHour`, the original contract) or in minutes
 * of the customer's day (`startMinute`/`endMinute`, 20260924121000). Minutes win when both are sent.
 * The `options` scope — and `options` alongside a tenant save — writes the agency's three switches.
 */
const READ_ROLES = ["owner", "producer", "setter", "assistant"] as const;
const WRITE_ROLES = ["owner"] as const;

const windowSchema = z
  .object({
    startHour: z.number().int().min(0).max(23).optional(),
    endHour: z.number().int().min(1).max(24).optional(),
    startMinute: z.number().int().min(0).max(1439).optional(),
    endMinute: z.number().int().min(1).max(1440).optional(),
  })
  .strict();

const optionsSchema = z
  .object({
    noSunday: z.boolean(),
    noFederalHolidays: z.boolean(),
    campaignOverrides: z.boolean(),
  })
  .strict();

const saveSchema = z
  .object({
    scope: z.enum(["tenant", "campaign", "options"]),
    campaignId: z.string().uuid().nullable().optional(),
    window: windowSchema.nullable().optional(),
    reason: z.string().trim().max(200).nullable().optional(),
    options: optionsSchema.optional(),
  })
  .strict();

function toMinuteWindow(window: z.infer<typeof windowSchema>): MinuteWindow | null {
  const start = window.startMinute ?? (window.startHour == null ? null : window.startHour * 60);
  const end = window.endMinute ?? (window.endHour == null ? null : window.endHour * 60);
  return start == null || end == null ? null : { start, end };
}

export async function GET() {
  const auth = await requireFeatureRole("outbound_dialing", READ_ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    const settings = await getCallingWindows(auth.context.tenantId);
    return NextResponse.json(
      { ...settings, canEdit: auth.context.role === "owner" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load your calling windows" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", WRITE_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;

  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter a valid calling window" }, { status: 400 });

  const { scope } = parsed.data;
  if (scope !== "options" && parsed.data.window === undefined)
    return NextResponse.json({ error: "Send a window, or null to clear it", code: "window_required" }, { status: 400 });
  if (scope === "options" && !parsed.data.options)
    return NextResponse.json({ error: "Send the three switches", code: "options_required" }, { status: 400 });

  let window: MinuteWindow | null = null;
  if (parsed.data.window) {
    window = toMinuteWindow(parsed.data.window);
    // Both ends or neither. One end alone narrows one side and leaves the other to the layer
    // above, which the schema can express and is never what somebody means.
    if (!window)
      return NextResponse.json(
        { error: "Set both hours, or neither. One alone is ambiguous and is refused.", code: "half_window" },
        { status: 400 },
      );
    if (window.start >= window.end)
      return NextResponse.json(
        { error: "A calling window has to end after it starts.", code: "inverted_window" },
        { status: 400 },
      );
    // Refused rather than stored-and-ignored. `greatest`/`least` would quietly discard a wider
    // window, and the owner would leave believing they had extended their calling hours.
    if (window.start < FEDERAL_MINUTES.start || window.end > FEDERAL_MINUTES.end)
      return NextResponse.json(
        {
          error: `Calling hours can only be narrowed, never widened. Federal law caps them at ${minuteLabel(FEDERAL_MINUTES.start)}–${minuteLabel(FEDERAL_MINUTES.end)} in the customer's own timezone, and some states are stricter still.`,
          code: "wider_than_federal",
        },
        { status: 400 },
      );
  }

  if (scope === "campaign" && !parsed.data.campaignId)
    return NextResponse.json({ error: "Say which campaign", code: "campaign_required" }, { status: 400 });

  try {
    if (scope === "tenant") {
      await saveTenantCallingWindow({ tenantId: auth.context.tenantId, userId: auth.context.userId, window });
    } else if (scope === "campaign") {
      await saveCampaignCallingWindow({
        tenantId: auth.context.tenantId,
        campaignId: parsed.data.campaignId as string,
        window,
        reason: parsed.data.reason ?? null,
      });
    }
    if (parsed.data.options && scope !== "campaign") {
      await saveCallingWindowOptions({ tenantId: auth.context.tenantId, userId: auth.context.userId, options: parsed.data.options });
    }
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.calling_window_updated",
      targetType: scope === "campaign" ? "tenant_campaigns" : scope === "options" ? "tenant_calling_window_options" : "tenant_calling_windows",
      targetId: scope === "campaign" ? (parsed.data.campaignId as string) : auth.context.tenantId,
      metadata: {
        scope,
        startHour: window ? Math.floor(window.start / 60) : null,
        endHour: window ? Math.ceil(window.end / 60) : null,
        startMinute: window?.start ?? null,
        endMinute: window?.end ?? null,
        reason: scope === "campaign" ? parsed.data.reason ?? null : undefined,
        options: parsed.data.options ?? undefined,
        // Clearing is a real decision — it removes this agency's own narrowing and leaves only the
        // statutory floors — so it is recorded as that, not as a null window.
        cleared: scope !== "options" && window === null,
      },
      request,
    });
    return NextResponse.json(await getCallingWindows(auth.context.tenantId));
  } catch (error) {
    if (error instanceof SchemaGapError)
      return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save the calling window" },
      { status: 400 },
    );
  }
}

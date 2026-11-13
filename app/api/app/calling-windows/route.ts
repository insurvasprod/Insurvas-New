import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { SchemaGapError } from "@/lib/appointments/schemaGap";
import { FEDERAL_MINUTES, minuteLabel, type MinuteWindow } from "@/lib/callingWindow/engine";
import { recordSettingsChanges, type SettingsChange } from "@/lib/settingsAudit/record";
import {
  getCallingWindows,
  resetCallingWindowDefaults,
  saveCallingWindowOptions,
  saveCampaignCallingWindow,
  saveTenantCallingWindow,
} from "@/lib/callingWindow/service";
import { refuseNarrowInAgency } from "@/lib/agency/routeScope";
import { scopeFor } from "@/lib/agency/visibility";
import { readWeek, saveDaysOff, saveWeekDays, type WeekStore } from "@/lib/callingWindows/store";
import { WEEKDAYS, dayRows, envelope, fitsWithoutDays, weekFrom, type DayOff, type Week } from "@/lib/callingWindows/week";

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

const dayOffSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    fromMinute: z.number().int().min(0).max(1439).nullable(),
    label: z.string().trim().max(80),
  })
  .strict();

const saveSchema = z
  .object({
    // `reset`: back to the Insurvas default hours and switches (docs/settings/DEFAULTS.md).
    // `week` (round 8): the week grid, the switches and the agency's own days off, saved together.
    scope: z.enum(["tenant", "campaign", "options", "reset", "week"]),
    campaignId: z.string().uuid().nullable().optional(),
    window: windowSchema.nullable().optional(),
    reason: z.string().trim().max(200).nullable().optional(),
    options: optionsSchema.optional(),
    week: z.array(windowSchema.nullable()).length(7).optional(),
    daysOff: z.array(dayOffSchema).max(100).optional(),
  })
  .strict();

/** The week grid's own read (20261112300000), beside the settings every dialer reads. Never fatal. */
async function weekFor(tenantId: string, base: MinuteWindow | null): Promise<(WeekStore & { week: Week }) | null> {
  try {
    const store = await readWeek(tenantId);
    return { ...store, week: weekFrom(base, store.days) };
  } catch (error) {
    console.error("[calling-windows] week read failed", error instanceof Error ? error.message : error);
    return null;
  }
}

const baseOf = (tenant: { startHour: number; endHour: number; startMinute?: number | null; endMinute?: number | null } | null): MinuteWindow | null =>
  tenant ? { start: tenant.startMinute ?? tenant.startHour * 60, end: tenant.endMinute ?? tenant.endHour * 60 } : null;

const dayText = (day: MinuteWindow | null) => (day ? `${minuteLabel(day.start)}–${minuteLabel(day.end)}` : "Day off");
const offText = (days: DayOff[]) => days.map((day) => `${day.date}${day.fromMinute == null ? "" : ` from ${minuteLabel(day.fromMinute)}`}${day.label ? ` (${day.label})` : ""}`).join(", ") || null;

function toMinuteWindow(window: z.infer<typeof windowSchema>): MinuteWindow | null {
  const start = window.startMinute ?? (window.startHour == null ? null : window.startHour * 60);
  const end = window.endMinute ?? (window.endHour == null ? null : window.endHour * 60);
  return start == null || end == null ? null : { start, end };
}

export async function GET() {
  const auth = await requireFeatureRole("outbound_dialing", READ_ROLES, { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  try {
    const [settings, scope, store] = await Promise.all([getCallingWindows(auth.context.tenantId), scopeFor(auth.context), weekFor(auth.context.tenantId, null)]);
    const week = store ? { ...store, week: weekFrom(baseOf(settings.tenant), store.days) } : null;
    // AG-0.5: the windows, switches and state rules are the agency's configuration and every dialer
    // needs them. `dialingStates` is the one part built from rows — every live lead's state, whoever owns
    // it — so a narrow session inside an agency gets null, and the board falls back to the states whose
    // rule bites (statesToList's "notable" basis).
    return NextResponse.json(
      { ...settings, week, ...(scope === null ? {} : { dialingStates: null }), canEdit: auth.context.role === "owner" },
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
  const refused = await refuseNarrowInAgency(auth.context, "Calling windows");
  if (refused) return refused;

  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter a valid calling window" }, { status: 400 });

  const { scope } = parsed.data;
  if (scope === "reset") {
    try {
      const before = await getCallingWindows(auth.context.tenantId);
      await resetCallingWindowDefaults(auth.context.tenantId);
      // Round 8: a day's own hours would narrow the default too, so the reset clears them. Own days off stay.
      await saveWeekDays({ tenantId: auth.context.tenantId, userId: auth.context.userId, rows: [] });
      await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.calling_window_updated", targetType: "tenant_calling_windows", targetId: auth.context.tenantId, metadata: { scope, reset: true }, request });
      const saved = await getCallingWindows(auth.context.tenantId);
      const hours = (w: typeof saved.tenant) => (w ? `${minuteLabel(w.startMinute ?? w.startHour * 60)}–${minuteLabel(w.endMinute ?? w.endHour * 60)}` : null);
      const labels = { noSunday: "No calls on Sundays", noFederalHolidays: "No calls on federal holidays", campaignOverrides: "Campaigns may narrow the hours" } as const;
      const changes: SettingsChange[] = [
        { key: "agency_hours", label: "Agency calling hours", from: hours(before.tenant), to: hours(saved.tenant) },
        ...(Object.keys(labels) as (keyof typeof labels)[]).map((key) => ({ key, label: labels[key], from: before.options[key], to: saved.options[key] })),
      ];
      await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "calling-windows", changes, reason: "Reset to the Insurvas default" });
      return NextResponse.json({ ...saved, week: await weekFor(auth.context.tenantId, baseOf(saved.tenant)) });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not reset your calling windows" }, { status: 500 });
    }
  }
  if (scope === "week") return saveWeek(request, auth.context, parsed.data);
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
    const before = await getCallingWindows(auth.context.tenantId).catch(() => null);
    if (scope === "tenant") {
      await saveTenantCallingWindow({ tenantId: auth.context.tenantId, userId: auth.context.userId, window });
      // Clearing the agency's hours clears its per-day hours too (round 8); a day row alone would still narrow.
      if (window === null) await saveWeekDays({ tenantId: auth.context.tenantId, userId: auth.context.userId, rows: [] });
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
    const saved = await getCallingWindows(auth.context.tenantId);
    // LA-8.8: the settings history, as hours a person reads.
    const hours = (w: { startHour: number | null; endHour: number | null; startMinute?: number | null; endMinute?: number | null } | null | undefined) => {
      const start = w ? w.startMinute ?? (w.startHour === null ? null : w.startHour * 60) : null;
      const end = w ? w.endMinute ?? (w.endHour === null ? null : w.endHour * 60) : null;
      return start === null || end === null ? null : `${minuteLabel(start)}–${minuteLabel(end)}`;
    };
    const changes: SettingsChange[] = [];
    if (scope === "tenant") changes.push({ key: "agency_hours", label: "Agency calling hours", from: hours(before?.tenant), to: hours(saved.tenant) });
    if (scope === "campaign") {
      const id = parsed.data.campaignId as string;
      const was = before?.campaigns.find((c) => c.id === id);
      const now = saved.campaigns.find((c) => c.id === id);
      changes.push({ key: `campaign:${id}`, label: `Calling hours — ${now?.name ?? was?.name ?? "campaign"}`, from: hours(was), to: hours(now) });
    }
    if (parsed.data.options && scope !== "campaign") {
      const labels = { noSunday: "No calls on Sundays", noFederalHolidays: "No calls on federal holidays", campaignOverrides: "Campaigns may narrow the hours" } as const;
      for (const key of Object.keys(labels) as (keyof typeof labels)[]) changes.push({ key, label: labels[key], from: before ? before.options[key] : null, to: saved.options[key] });
    }
    await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "calling-windows", changes, reason: scope === "campaign" ? parsed.data.reason ?? null : null });
    return NextResponse.json({ ...saved, week: await weekFor(auth.context.tenantId, baseOf(saved.tenant)) });
  } catch (error) {
    if (error instanceof SchemaGapError)
      return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save the calling window" },
      { status: 400 },
    );
  }
}

/**
 * Round 8 · the week grid's one save: each day's hours (null = a day off), the three switches and the
 * agency's own days off. The base window stored is the envelope of the open days and each day that
 * differs gets its own row (20261112300000), so the dial check narrows to exactly the day drawn.
 * Before that migration a week whose open days all match still saves; anything else is refused with
 * "needs a database update" rather than stored as something the dialer would not do.
 */
async function saveWeek(
  request: NextRequest,
  context: { tenantId: string; userId: string },
  body: z.infer<typeof saveSchema>,
) {
  if (!body.week || !body.options)
    return NextResponse.json({ error: "Send the week and the three switches", code: "week_required" }, { status: 400 });
  const week: Week = [];
  for (const [weekday, raw] of body.week.entries()) {
    if (raw === null) { week.push(null); continue; }
    const day = toMinuteWindow(raw);
    if (!day) return NextResponse.json({ error: `Set both ends of ${WEEKDAYS[weekday]}, or make it a day off.`, code: "half_window" }, { status: 400 });
    if (day.start >= day.end) return NextResponse.json({ error: `${WEEKDAYS[weekday]} ends before it starts. Drag the end below the start.`, code: "inverted_window" }, { status: 400 });
    if (day.start < FEDERAL_MINUTES.start || day.end > FEDERAL_MINUTES.end)
      return NextResponse.json({ error: `Calling hours can only be narrowed, never widened. Federal law caps ${WEEKDAYS[weekday]} at ${minuteLabel(FEDERAL_MINUTES.start)}–${minuteLabel(FEDERAL_MINUTES.end)} in the customer's own timezone.`, code: "wider_than_federal" }, { status: 400 });
    week.push(day);
  }
  const base = envelope(week);
  if (!base) return NextResponse.json({ error: "Open at least one day. To stop dialing altogether, pause your campaigns instead.", code: "no_open_day" }, { status: 400 });
  const daysOff = [...new Map((body.daysOff ?? []).map((day) => [day.date, day])).values()];

  try {
    const [before, store] = await Promise.all([getCallingWindows(context.tenantId), readWeek(context.tenantId)]);
    const beforeWeek = weekFrom(baseOf(before.tenant), store.days);
    // Refused before anything is written, so a half-saved week never reaches the dialer.
    if (!store.ready && (!fitsWithoutDays(week, body.options.noSunday) || daysOff.length > 0)) throw new SchemaGapError();
    const optionsChanged = (["noSunday", "noFederalHolidays", "campaignOverrides"] as const).some((key) => before.options[key] !== body.options?.[key]);
    if (optionsChanged && !before.schemaReady) throw new SchemaGapError();

    const beforeBase = baseOf(before.tenant);
    if (!beforeBase || before.tenantIsDefault || beforeBase.start !== base.start || beforeBase.end !== base.end)
      await saveTenantCallingWindow({ tenantId: context.tenantId, userId: context.userId, window: base });
    if (store.ready) {
      await saveWeekDays({ tenantId: context.tenantId, userId: context.userId, rows: dayRows(week, base) });
      await saveDaysOff({ tenantId: context.tenantId, userId: context.userId, daysOff });
    }
    if (optionsChanged) await saveCallingWindowOptions({ tenantId: context.tenantId, userId: context.userId, options: body.options });

    await audit({
      actorType: "tenant",
      actorId: context.userId,
      action: "tenant.calling_window_updated",
      targetType: "tenant_calling_windows",
      targetId: context.tenantId,
      metadata: { scope: "week", week: week.map((day) => (day ? { startMinute: day.start, endMinute: day.end } : null)), options: body.options, daysOff: daysOff.length },
      request,
    });
    const labels = { noSunday: "No calls on Sundays", noFederalHolidays: "No calls on federal holidays", campaignOverrides: "Campaigns may narrow the hours" } as const;
    const changes: SettingsChange[] = [];
    week.forEach((day, weekday) => {
      const was = beforeWeek[weekday];
      if (dayText(was) !== dayText(day)) changes.push({ key: `day:${weekday}`, label: `${WEEKDAYS[weekday]} calling hours`, from: dayText(was), to: dayText(day) });
    });
    for (const key of Object.keys(labels) as (keyof typeof labels)[])
      if (before.options[key] !== body.options[key]) changes.push({ key, label: labels[key], from: before.options[key], to: body.options[key] });
    if (offText(store.daysOff) !== offText(daysOff)) changes.push({ key: "days_off", label: "Days off", from: offText(store.daysOff), to: offText(daysOff) });
    await recordSettingsChanges({ tenantId: context.tenantId, actorId: context.userId, section: "calling-windows", changes, reason: null });

    const saved = await getCallingWindows(context.tenantId);
    return NextResponse.json({ ...saved, week: await weekFor(context.tenantId, baseOf(saved.tenant)) });
  } catch (error) {
    if (error instanceof SchemaGapError)
      return NextResponse.json({ error: "Different hours per day and your own days off need a database update. Until it is applied, every open day keeps the same hours.", code: "schema_pending" }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save your calling hours" }, { status: 400 });
  }
}

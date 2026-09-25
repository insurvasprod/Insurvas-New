import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { LAPSE_RESOLUTIONS, LAPSE_SIGNAL_KINDS, LAPSE_SIGNAL_NOTE_MAX, OTHER_NOTE_MIN } from "@/lib/lapseRisk/model";
import { LapseRiskError, recordLapseSignal, resolveLapseSignals } from "@/lib/lapseRisk/service";

/**
 * Lapse signals: POST records one against a policy, PATCH resolves every open one on a policy.
 *
 * Both are chargeback_radar writes for owners and producers, scoped by the commission rule inside
 * the service (a producer acts only on the policies they recorded; anything else is a 404).
 *
 * Resolving as "policy_lapsed" also marks the policy lapsed — in the same database transaction —
 * so the commission ledger posts its chargeback. That is a write to the book of business, so it
 * passes the same gate the policies PATCH does and writes the same tenant.policy_updated row.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date as YYYY-MM-DD");
const note = z.string().trim().max(LAPSE_SIGNAL_NOTE_MAX, `Keep the note under ${LAPSE_SIGNAL_NOTE_MAX} characters`).nullable().optional();

const recordSchema = z
  .object({ policyId: z.string().uuid("Choose a policy"), kind: z.enum(LAPSE_SIGNAL_KINDS), occurredOn: isoDate, note })
  .strict()
  .superRefine((value, context) => {
    // A day of slack for time zones; anything later has not happened yet.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    if (value.occurredOn > tomorrow) context.addIssue({ code: "custom", path: ["occurredOn"], message: "A signal cannot be dated in the future" });
    if (value.occurredOn < "2000-01-01") context.addIssue({ code: "custom", path: ["occurredOn"], message: "Enter the date the signal happened" });
    if (value.kind === "other" && (value.note ?? "").length < OTHER_NOTE_MIN)
      context.addIssue({ code: "custom", path: ["note"], message: "Say what happened — “Other” needs a written reason" });
  });

const resolveSchema = z.object({ policyId: z.string().uuid("Choose a policy"), resolution: z.enum(LAPSE_RESOLUTIONS), note }).strict();

function failure(error: unknown, fallback: string) {
  if (error instanceof LapseRiskError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  console.error(`[lapse-risk] ${fallback}`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("chargeback_radar", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = recordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter a valid lapse signal" }, { status: 400 });

  try {
    const { policyId, kind, occurredOn } = parsed.data;
    const saved = await recordLapseSignal(auth.context, { policyId, kind, occurredOn, note: parsed.data.note || null });
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.lapse_signal_recorded",
      targetType: "tenant_policy",
      targetId: policyId,
      metadata: { signal_id: saved.signalId, policy_number: saved.policyNumber, kind, occurred_on: occurredOn, source: "manual", has_note: Boolean(parsed.data.note) },
      request,
    });
    return NextResponse.json({ ok: true, signalId: saved.signalId }, { status: 201 });
  } catch (error) {
    return failure(error, "Could not record the lapse signal");
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireFeatureRole("chargeback_radar", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = resolveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose how this was resolved" }, { status: 400 });
  const { policyId, resolution } = parsed.data;

  if (resolution === "policy_lapsed") {
    // Changing a policy's status is a book-of-business write; the same gate as PATCH /api/app/policies.
    const book = await requireFeatureRole("book_of_business", ["owner", "producer"], { write: true });
    if (book instanceof NextResponse) return book;
  }

  try {
    const result = await resolveLapseSignals(auth.context, { policyId, resolution, note: parsed.data.note || null });
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.lapse_signals_resolved",
      targetType: "tenant_policy",
      targetId: policyId,
      metadata: { policy_number: result.policyNumber, resolution, resolved: result.resolved, has_note: Boolean(parsed.data.note) },
      request,
    });
    if (result.policyStatus !== result.previousStatus) {
      await audit({
        actorType: "tenant",
        actorId: auth.context.userId,
        action: "tenant.policy_updated",
        targetType: "tenant_policy",
        targetId: policyId,
        metadata: { changed: ["status"], from: result.previousStatus, to: result.policyStatus, via: "lapse_risk" },
        request,
      });
    }
    return NextResponse.json({ ok: true, resolved: result.resolved, policyStatus: result.policyStatus });
  } catch (error) {
    return failure(error, "Could not resolve the lapse signals");
  }
}

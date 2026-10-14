import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { isRecordUuid } from "@/lib/ingestion/path";
import { CONTACT_INCOME_TYPES } from "@/lib/retention/income";
import { contactForPolicy, IncomeError, readIncome, saveIncome } from "@/lib/retention/incomeStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-5.10 (Notion sprint) · the client's monthly income, captured on a retention call (the save
 * queue's "add income"). This is how the existing book, which never had an interview here, fills
 * in. Owner and producer only (a producer reaches the policies credited to them); every read and
 * change is logged.
 */
const ROLES = ["owner", "producer"] as const;
const policy = { carrier_id: z.string().refine(isRecordUuid, "Choose the policy."), policy_number: z.string().min(1).max(120) };
const body = z.object({
  ...policy,
  income: z.object({
    monthly_dollars: z.string().trim().min(1).max(20),
    income_type: z.enum(CONTACT_INCOME_TYPES).nullable(),
    household_total: z.boolean(),
    estimate: z.boolean(),
  }).strict().nullable(),
}).strict();

const fail = (error: unknown) => {
  if (error instanceof IncomeError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[income]", error);
  return NextResponse.json({ error: "The income could not be saved" }, { status: 500 });
};

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("chargeback_radar", ROLES);
  if (auth instanceof NextResponse) return auth;
  const carrierId = request.nextUrl.searchParams.get("carrier_id") ?? "";
  const policyNumber = request.nextUrl.searchParams.get("policy_number") ?? "";
  if (!isRecordUuid(carrierId) || !policyNumber || policyNumber.length > 120) return NextResponse.json({ error: "Choose the policy." }, { status: 400 });
  const { tenantId, userId, role } = auth.context;
  const viewer = { tenantId, userId, role };
  try {
    return NextResponse.json(await readIncome(viewer, await contactForPolicy(viewer, carrierId, policyNumber), "save_queue"), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireFeatureRole("chargeback_radar", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the income and try again." }, { status: 400 });
  const b = parsed.data;
  const { tenantId, userId, role } = auth.context;
  const viewer = { tenantId, userId, role };
  try {
    const target = await contactForPolicy(viewer, b.carrier_id, b.policy_number);
    await saveIncome(viewer, target, b.income ? { monthlyDollars: b.income.monthly_dollars, incomeType: b.income.income_type, householdTotal: b.income.household_total, estimate: b.income.estimate } : null, "save_queue");
    await audit({ actorType: "tenant", actorId: userId, action: "retention.income_saved", targetType: "contact", targetId: target.contactId ?? `${b.carrier_id}:${b.policy_number}`, metadata: { tenantId, surface: "save_queue", cleared: b.income === null, estimate: b.income?.estimate ?? null }, request });
    return NextResponse.json(await readIncome(viewer, target, "save_queue"));
  } catch (error) {
    return fail(error);
  }
}

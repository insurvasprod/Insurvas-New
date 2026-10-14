import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { isUuid } from "@/lib/applications/http";
import { CONTACT_INCOME_TYPES } from "@/lib/retention/income";
import { contactForApplication, IncomeError, readIncome, saveIncome } from "@/lib/retention/incomeStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-5.10 (Notion sprint) · the client's monthly income, from an application: the interview (LA-3.2)
 * or the draft-date setup (LA-3.9). Optional — nothing waits on it. Owner and producer only: setters,
 * assistants and bookkeepers get 403. Every read and change is logged.
 */
const ROLES = ["owner", "producer"] as const;
const surface = z.enum(["interview", "draft_date_setup"]);
const income = z.object({
  monthly_dollars: z.string().trim().min(1).max(20),
  income_type: z.enum(CONTACT_INCOME_TYPES).nullable(),
  household_total: z.boolean(),
  estimate: z.boolean(),
}).strict();
const body = z.object({ surface, income: income.nullable() }).strict();

const fail = (error: unknown) => {
  if (error instanceof IncomeError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[income]", error);
  return NextResponse.json({ error: "The income could not be saved" }, { status: 500 });
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That application could not be found." }, { status: 404 });
  const where = surface.safeParse(request.nextUrl.searchParams.get("surface"));
  if (!where.success) return NextResponse.json({ error: "Say where this is being read." }, { status: 400 });
  const { tenantId, userId, role } = auth.context;
  const viewer = { tenantId, userId, role };
  try {
    return NextResponse.json(await readIncome(viewer, await contactForApplication(viewer, id), where.data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That application could not be found." }, { status: 404 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the income and try again." }, { status: 400 });
  const b = parsed.data;
  const { tenantId, userId, role } = auth.context;
  const viewer = { tenantId, userId, role };
  try {
    const target = await contactForApplication(viewer, id);
    await saveIncome(viewer, target, b.income ? { monthlyDollars: b.income.monthly_dollars, incomeType: b.income.income_type, householdTotal: b.income.household_total, estimate: b.income.estimate } : null, b.surface);
    // The audit row names the change, never the amount.
    await audit({ actorType: "tenant", actorId: userId, action: "retention.income_saved", targetType: target.contactId ? "contact" : "lead", targetId: target.contactId ?? target.leadId ?? id, metadata: { tenantId, surface: b.surface, cleared: b.income === null, estimate: b.income?.estimate ?? null }, request });
    return NextResponse.json(await readIncome(viewer, target, b.surface));
  } catch (error) {
    return fail(error);
  }
}

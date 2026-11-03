import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { SchemaGapError } from "@/lib/appointments/schemaGap";
import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_CALLING_RULES } from "@/lib/callingWindow/permissions";
import { CallingRuleError, addHoliday } from "@/lib/callingWindow/rulesAdmin";
import { addHolidaySchema } from "@/lib/callingWindow/rulesModel";

/** POST · add a no-call holiday for one state, or for every state (state null). */
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_CALLING_RULES);
  if (auth instanceof NextResponse) return auth;
  const parsed = addHolidaySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter a valid holiday" }, { status: 400 });
  if (parsed.data.date < new Date().toISOString().slice(0, 10))
    return NextResponse.json({ error: "A holiday in the past cannot be added." }, { status: 400 });
  try {
    const holiday = await addHoliday(parsed.data, auth.session.sub);
    await audit({
      actorId: auth.session.sub,
      action: "calling_holiday.added",
      targetType: "calling_window_holiday",
      targetId: holiday.id,
      metadata: { state: holiday.state, date: holiday.date, name: holiday.name, source: holiday.source },
      request,
    });
    return NextResponse.json({ holiday }, { status: 201 });
  } catch (error) {
    if (error instanceof SchemaGapError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
    const status = error instanceof CallingRuleError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not add the holiday" }, { status });
  }
}

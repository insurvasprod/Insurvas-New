import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { SchemaGapError } from "@/lib/appointments/schemaGap";
import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_CALLING_RULES } from "@/lib/callingWindow/permissions";
import { CallingRuleError, removeHoliday } from "@/lib/callingWindow/rulesAdmin";

/** DELETE · remove a holiday that has not happened yet. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_CALLING_RULES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That is not a holiday id" }, { status: 400 });
  try {
    const holiday = await removeHoliday(id);
    await audit({
      actorId: auth.session.sub,
      action: "calling_holiday.removed",
      targetType: "calling_window_holiday",
      targetId: holiday.id,
      metadata: { state: holiday.state, date: holiday.date, name: holiday.name },
      request,
    });
    return NextResponse.json({ holiday });
  } catch (error) {
    if (error instanceof SchemaGapError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
    const status = error instanceof CallingRuleError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove the holiday" }, { status });
  }
}

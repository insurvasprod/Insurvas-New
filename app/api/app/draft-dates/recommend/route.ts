import { NextResponse } from "next/server";

import { body } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { recommendSchema } from "@/lib/applications/schemas";
import { recommendDraftDay } from "@/lib/draftDates/optimiser";
import { salesSettingsFor } from "@/lib/salesSettings/settings";

/** LA-3.9 · the recommendation alone — a calculation; only the agency's draft buffer is read, nothing is saved. */
export async function POST(request: Request) {
  const auth = await requireFeatureRole("draft_date_optimizer", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const input = await body(request, recommendSchema);
  if (input instanceof NextResponse) return input;
  const { income_type, ...rest } = input;
  // No buffer given: the agency's own (Settings › Sales › Quote & QA rules), else the default.
  const buffer = rest.buffer ?? (await salesSettingsFor(auth.context.tenantId).then((s) => s.draftBufferDays).catch(() => 3));
  return NextResponse.json(recommendDraftDay({ incomeType: income_type, birthDay: rest.birthDay ?? null, before1997: rest.before1997 ?? false, pensionDay: rest.pensionDay ?? null, payFrequency: rest.payFrequency ?? null, payAnchor: rest.payAnchor ?? null, buffer }));
}

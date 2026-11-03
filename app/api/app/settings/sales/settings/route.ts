import { NextResponse } from "next/server";
import { z } from "zod";

import { actorOf, body, failure } from "@/lib/applications/http";
import { salesSettingsSchema } from "@/lib/salesSettings/schema";
import { readSalesSettings, saveSalesSettings } from "@/lib/salesSettings/settings";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * LA-3.17 · the Sales settings document. GET: owners and producers (the payment step reads the
 * draft-day buffer). PUT: owners — the whole document, validated by `salesSettingsSchema` (the
 * welcome pack's four locked tokens included); every changed key is audited old → new.
 */
export async function GET(request: Request) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await readSalesSettings(actorOf(auth, request)), { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

const putSchema = z.object({
  settings: salesSettingsSchema,
  /** The `updatedAt` the editor loaded (null before the first save); a newer save refuses this one. */
  expected_updated_at: z.string().max(40).nullable().optional(),
}).strict();

export async function PUT(request: Request) {
  const auth = await requireFeatureRole("applications", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const input = await body(request, putSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json(await saveSalesSettings(actorOf(auth, request), input.settings, input.expected_updated_at));
  } catch (error) {
    return failure(error);
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { SETTINGS_CHANGE_TYPES, settingsAuditCsv } from "@/lib/settingsAudit/constants";
import { SettingsAuditPendingError, listSettingsAudit, settingsAuditActors } from "@/lib/settingsAudit/service";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";

/**
 * LA-8.8 · GET /api/app/settings-audit — who changed which setting, from what, to what, when.
 *
 * The tenant admin (owner) reads the whole log, filtered by section, person, change type and dates.
 * Anyone else reads only their own entries, with `?mine=1`; asking for the whole log is 403.
 * `?format=csv` returns exactly the filtered set. There is no write route: the log is read-only.
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const querySchema = z.object({
  section: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/).optional(),
  actor: z.string().uuid().optional(),
  type: z.enum(SETTINGS_CHANGE_TYPES).optional(),
  from: z.string().regex(DATE).optional(),
  to: z.string().regex(DATE).optional(),
  mine: z.literal("1").optional(),
  format: z.enum(["json", "csv"]).optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Those filters are not valid" }, { status: 400 });
  const q = parsed.data;
  const owner = auth.context.role === "owner";
  if (!owner && !q.mine) return NextResponse.json({ error: "Only the account owner can read the whole settings history. You can read your own changes." }, { status: 403 });

  try {
    const filter = { section: q.section, actor: q.actor, changeType: q.type, from: q.from, to: q.to };
    const entries = await listSettingsAudit(auth.context.tenantId, filter, { onlyActor: q.mine ? auth.context.userId : undefined });
    if (q.format === "csv") {
      return new NextResponse(settingsAuditCsv(entries), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="settings-history-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
      });
    }
    const actors = owner && !q.mine ? await settingsAuditActors(auth.context.tenantId) : [];
    return NextResponse.json({ entries, actors }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SettingsAuditPendingError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
    console.error("[settings-audit] read failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not read the settings history" }, { status: 500 });
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { platformFactValue } from "@/lib/carriers/factReports";
import { FACT_REPORT_LABEL, FIXABLE_FACT_KEYS, type FixableFactKey } from "@/lib/carriers/factReportConstants";
import { isRecordUuid } from "@/lib/ingestion/path";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

type Params = { params: Promise<{ id: string }> };

const body = z.object({
  portal_origin: z.string().max(500).nullable().optional(),
  reference_pattern: z.string().max(500).nullable().optional(),
  billing_descriptor: z.string().max(500).nullable().optional(),
}).strict();

/**
 * The carrier record's three portal facts (admin round 1, docs/design/admin-r1/catalog.html screen 8): the portal
 * address, what a policy number looks like and the client's bank statement text, edited directly on the platform
 * carrier instead of only through a fact report. The same checks the fact-report fix runs (platformFactValue); a
 * blank value clears the fact. Carrier-library access, as editing the carrier itself; audited as carrier.updated with
 * before and after, the shape the fact-report fix writes, so the carrier's history reads one way.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireAdminRole(["super_admin", "platform_config"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isRecordUuid(id)) return NextResponse.json({ error: "Carrier not found" }, { status: 404 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the values and try again." }, { status: 400 });

  // Each fact given: a checked value, or null to clear it.
  const next: Partial<Record<FixableFactKey, string | null>> = {};
  for (const key of FIXABLE_FACT_KEYS) {
    const raw = parsed.data[key];
    if (raw === undefined) continue;
    const trimmed = raw?.trim() ?? "";
    if (!trimmed) { next[key] = null; continue; }
    const checked = platformFactValue(key, trimmed);
    if ("problem" in checked) return NextResponse.json({ error: `${FACT_REPORT_LABEL[key]}: ${checked.problem}` }, { status: 400 });
    next[key] = checked.value;
  }
  if (!Object.keys(next).length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the three fact columns are not in the generated types
  const db = getSupabaseServiceClient() as any;
  try {
    const before = await db.from("carriers").select("id, name, portal_origin, reference_pattern, billing_descriptor").eq("id", id).is("organization_id", null).maybeSingle();
    if (before.error) throw before.error;
    if (!before.data) return NextResponse.json({ error: "Carrier not found" }, { status: 404 });
    const was = before.data as Record<string, string | null>;
    const changed = Object.fromEntries(Object.entries(next).filter(([key, value]) => (was[key] ?? null) !== value));
    if (!Object.keys(changed).length) return NextResponse.json({ facts: pick(was), changed: [] });

    const update = await db.from("carriers").update(changed).eq("id", id).is("organization_id", null).select("portal_origin, reference_pattern, billing_descriptor").maybeSingle();
    if (update.error) throw update.error;
    if (!update.data) return NextResponse.json({ error: "Carrier not found" }, { status: 404 });
    await audit({
      actorId: auth.session.sub,
      action: "carrier.updated",
      targetType: "carrier",
      targetId: id,
      metadata: { name: was.name, ...Object.fromEntries(Object.entries(changed).map(([key, after]) => [key, { before: was[key] ?? null, after }])), from: "carrier_record" },
      request,
    });
    return NextResponse.json({ facts: pick(update.data as Record<string, string | null>), changed: Object.keys(changed) });
  } catch (error) {
    console.error("[admin carrier facts]", error);
    return NextResponse.json({ error: "That did not save. Try again." }, { status: 500 });
  }
}

function pick(row: Record<string, string | null>) {
  return { portalOrigin: row.portal_origin ?? null, referencePattern: row.reference_pattern ?? null, billingDescriptor: row.billing_descriptor ?? null };
}

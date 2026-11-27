import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { auditMany } from "@/lib/audit/log";
import { DISCREPANCY_SCHEMA_PENDING_MESSAGE, DiscrepancyError, SETTABLE_DISCREPANCY_STATUSES, listDiscrepancies, owedToYou, setDiscrepancyStatus } from "@/lib/discrepancies/service";
import { isRecordId } from "@/lib/ledger/statementConstants";
import { loadPayIssues } from "@/lib/discrepancies/payIssues";
import { payIssueCarrierKey } from "@/lib/commissions/payIssueGroups";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Money boundary (LA-4.4 / 4.5): what the carriers appear to owe.
 *
 * GET lists every finding, open first by amount, with the total owed. Reading only: the findings
 * are recomputed after each change to their facts (statements, policies, contracts, schedules), not
 * on request (user decision 2026-10-06, option a), so a read never writes.
 *
 * PATCH `{ ids, status, note? }` records one decision on several findings at once (e.g. "disputed"
 * for every finding a letter just went out for). Each is applied and audited as its own decision; a
 * finding that no longer applies (cleared) is skipped and reported, never an error for the rest.
 *
 * Owner and bookkeeper only, as the Discrepancies menu item. PATCH is a write: read-only is refused.
 */
const roles = ["owner", "bookkeeper"] as const;

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("discrepancy_report", roles);
  if (auth instanceof NextResponse) return auth;
  if (request.nextUrl.searchParams.get("view") === "carriers") return byCarrier(auth.context.tenantId);
  try {
    const [list, owed] = await Promise.all([listDiscrepancies(auth.context.tenantId), owedToYou(auth.context.tenantId)]);
    return NextResponse.json(
      { ok: true, available: list.available, message: list.available ? null : DISCREPANCY_SCHEMA_PENDING_MESSAGE, owed, items: list.items },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[discrepancies] list", error);
    return NextResponse.json({ error: "Could not load the pay issues" }, { status: 500 });
  }
}

/**
 * `?view=carriers` (the phone's Pay issues, release 3 board G8): Commissions › Pay issues' Open list (both sources,
 * loadPayIssues, the page's own reader) as what each carrier owes, to the cent, with how many issues of each kind.
 * No client names (names: false) and no policy numbers: the phone shows carriers and totals; the issues open on
 * the computer. Reading only, like the list above.
 */
async function byCarrier(tenantId: string) {
  try {
    const read = await loadPayIssues(tenantId, { names: false });
    const open = read.issues.filter((i) => i.status !== "closed");
    const carriers = new Map<string, { carrierKey: string; carrierName: string; owedToYouCents: number; owedToCarrierCents: number; count: number; kinds: Record<string, number> }>();
    for (const issue of open) {
      const key = payIssueCarrierKey(issue);
      const row = carriers.get(key) ?? { carrierKey: key, carrierName: issue.carrierName, owedToYouCents: 0, owedToCarrierCents: 0, count: 0, kinds: {} };
      row.owedToYouCents += issue.owedToYouCents;
      row.owedToCarrierCents += issue.owedToCarrierCents;
      row.count += 1;
      row.kinds[issue.type] = (row.kinds[issue.type] ?? 0) + 1;
      carriers.set(key, row);
    }
    const kinds: Record<string, number> = {};
    for (const issue of open) kinds[issue.type] = (kinds[issue.type] ?? 0) + 1;
    return NextResponse.json({
      ok: true, available: read.available, owedCents: read.summary.owedCents, count: open.length, kinds,
      carriers: [...carriers.values()].sort((a, b) => b.owedToYouCents - a.owedToYouCents || b.count - a.count || a.carrierName.localeCompare(b.carrierName)),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[discrepancies] by carrier", error);
    return NextResponse.json({ error: "Could not load the pay issues" }, { status: 500 });
  }
}

const bulkSchema = z.object({
  ids: z.array(z.string().refine(isRecordId, "That pay issue is not in this workspace")).min(1, "Choose at least one pay issue").max(200, "Choose at most 200 pay issues at a time"),
  status: z.enum(SETTABLE_DISCREPANCY_STATUSES),
  note: z.string().trim().max(1000).nullish(),
}).strict();

export async function PATCH(request: NextRequest) {
  const auth = await requireFeatureRole("discrepancy_report", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = bulkSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Check the request and try again" }, { status: 400 });
  const { tenantId, userId } = auth.context;
  const ids = [...new Set(body.data.ids)];
  const changed: Array<{ id: string; from: string; to: string; kind: string; policyId: string; owedCents: number }> = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  try {
    for (const id of ids) {
      try {
        const result = await setDiscrepancyStatus(tenantId, userId, id, body.data.status, body.data.note ?? null);
        changed.push({ id, ...result });
      } catch (error) {
        // Not this workspace's, or no longer applying: reported, and the rest still go through.
        if (error instanceof DiscrepancyError && (error.status === 404 || error.status === 409)) { skipped.push({ id, reason: error.message }); continue; }
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof DiscrepancyError) return NextResponse.json({ error: error.message, code: error.code, changed: changed.length }, { status: error.status });
    console.error("[discrepancies] bulk status", error);
    return NextResponse.json({ error: "Could not record every decision", changed: changed.length }, { status: 500 });
  } finally {
    if (changed.length) {
      await auditMany(changed.map((item) => ({
        actorType: "tenant" as const,
        actorId: userId,
        action: "tenant.discrepancy_status_changed" as const,
        targetType: "tenant_commission_discrepancy",
        targetId: item.id,
        reason: body.data.note ?? undefined,
        metadata: { tenantId, from: item.from, to: item.to, kind: item.kind, policyId: item.policyId, owedCents: item.owedCents, bulk: true },
        request,
      })));
    }
  }
  return NextResponse.json({ ok: true, status: body.data.status, changed: changed.length, skipped });
}

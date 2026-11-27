import { NextResponse } from "next/server";

import { actorOf, failure } from "@/lib/applications/http";
import { db } from "@/lib/applications/db";
import { caseScopedColumns, inChunks, insuredNames, scopeByCase } from "@/lib/applications/lists";
import { loadSalesReport } from "@/lib/applications/report";
import { dayIn } from "@/lib/applications/reportRules";
import { queryObject, salesReportQuery } from "@/lib/applications/reportSchemas";
import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { scopeFor, type ProducerScope } from "@/lib/agency/visibility";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-3.21 · Sales performance for the window and filters given. Carries premium and ESTIMATED
 * first-year commission (integer cents), so it is a money route: no assistant, no setter.
 *
 * Two phone reads (mobile board I4), same gate, same scope, same filters:
 *   `?days_by_month=N` (1–12) · the median days from application to issue for each of the N calendar months
 *     ending with the window's last month, each month counted by the report itself (its own population and rule).
 *   `?declined=<key>` · the applications behind one "Why carriers declined" row of the window: who, which carrier,
 *     when it was submitted. The key is the report's own (reason:<code> | outcome:<outcome>).
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CLOSED_WITHOUT_POLICY = ["declined", "postponed", "declined_by_client", "offer_expired"];
const DECLINE_KEY = /^(reason:[a-z0-9_]{1,64}|outcome:(declined|postponed|declined_by_client|offer_expired))$/;

const reasonKey = (a: { outcome: string | null; outcome_reason_code: string | null }) =>
  a.outcome === "declined_by_client" ? "outcome:declined_by_client" : a.outcome === "offer_expired" ? "outcome:offer_expired" : a.outcome_reason_code ? `reason:${a.outcome_reason_code}` : `outcome:${a.outcome}`;

const iso = (y: number, m: number, d: number) => {
  const at = new Date(Date.UTC(y, m, d));
  return at.toISOString().slice(0, 10);
};

export async function GET(request: Request) {
  const auth = await requireFeatureRole("sales_report", ["owner", "producer", "bookkeeper"], { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const raw = queryObject(new URL(request.url).searchParams);
  const byMonth = raw.days_by_month;
  const declined = raw.declined;
  delete raw.days_by_month;
  delete raw.declined;
  const parsed = salesReportQuery.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the filters and try again.", code: "invalid_request" }, { status: 400 });
  const q = parsed.data;
  const filters = { carrierId: q.carrier ?? null, productCode: q.product ?? null, source: q.source ?? null, producerId: q.producer ?? null };
  try {
    // AG-0.5 · a producer's own report: scoped to the visible producers' cases. `producer` in the query can only
    // narrow inside that scope; it never widens it, because the scope comes from the session.
    const scope = await scopeFor(auth.context);
    if (byMonth !== undefined) {
      const n = Number(byMonth);
      if (!Number.isInteger(n) || n < 1 || n > 12) return NextResponse.json({ error: "Choose 1 to 12 months.", code: "invalid_request" }, { status: 400 });
      const end = q.to ?? new Date().toISOString().slice(0, 10);
      const y = Number(end.slice(0, 4));
      const m = Number(end.slice(5, 7)) - 1;
      const windows = Array.from({ length: n }, (_, i) => {
        const at = new Date(Date.UTC(y, m - (n - 1 - i), 1));
        return { key: at.toISOString().slice(0, 7), label: MONTHS[at.getUTCMonth()], from: iso(at.getUTCFullYear(), at.getUTCMonth(), 1), to: iso(at.getUTCFullYear(), at.getUTCMonth() + 1, 0) };
      });
      const reports = await Promise.all(windows.map((w) => loadSalesReport(actor.tenantId, { ...filters, from: w.from, to: w.to }, Date.now(), scope)));
      return NextResponse.json({
        months: windows.map((w, i) => ({ ...w, submitToIssueDays: reports[i].report.timing.all.submitToIssueDays })),
      }, { headers: { "Cache-Control": "no-store" } });
    }
    if (declined !== undefined) {
      if (!DECLINE_KEY.test(declined)) return NextResponse.json({ error: "Choose a decline reason.", code: "invalid_request" }, { status: 400 });
      return NextResponse.json({ applications: await declinedApplications(actor.tenantId, declined, { from: q.from, to: q.to, ...filters }, scope) }, { headers: { "Cache-Control": "no-store" } });
    }
    const { report } = await loadSalesReport(actor.tenantId, { from: q.from, to: q.to, ...filters }, Date.now(), scope);
    return NextResponse.json({ report });
  } catch (error) {
    return failure(error);
  }
}

type Attempt = { id: string; lead_id: string; insured_role: string; carrier_id: string | null; product_code: string | null; outcome: string | null; outcome_reason_code: string | null; submitted_at: string | null; created_by: string | null; case_id: string; status: string };

/**
 * The window's declined applications for one reason, by the report's own rule: submitted in the window (in the
 * workspace's time zone), closed without a policy, with this reason key, matching the carrier, product and producer
 * filters. The source filter is the report page's (its case lookup); here it is not applied, so a source-filtered
 * view lists every source's. Newest first, at most 200.
 */
async function declinedApplications(tenantId: string, key: string, f: { from?: string; to?: string; carrierId: string | null; productCode: string | null; producerId: string | null }, scope: ProducerScope) {
  const client = db();
  const zone = (await getWorkspaceTimezone(tenantId).catch(() => null)) ?? "UTC";
  const to = f.to ?? new Date().toISOString().slice(0, 10);
  const from = f.from ?? to;
  // A day either side of the window in UTC, then the exact window in the workspace's zone.
  const gte = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString();
  const lt = new Date(Date.parse(`${to}T00:00:00Z`) + 2 * 86_400_000).toISOString();
  let query = scopeByCase(client.from("tenant_applications").select(caseScopedColumns("id, lead_id, insured_role, carrier_id, product_code, outcome, outcome_reason_code, submitted_at, created_by, case_id, status", scope))
    .eq("tenant_id", tenantId).eq("status", "closed").in("outcome", CLOSED_WITHOUT_POLICY).gte("submitted_at", gte).lt("submitted_at", lt), scope);
  if (f.carrierId) query = query.eq("carrier_id", f.carrierId);
  if (f.productCode) query = query.eq("product_code", f.productCode);
  if (f.producerId) query = query.eq("created_by", f.producerId);
  const { data, error } = await query.order("submitted_at", { ascending: false }).limit(2000);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as Attempt[])
    .filter((a) => a.submitted_at && dayIn(a.submitted_at, zone) >= from && dayIn(a.submitted_at, zone) <= to && reasonKey(a) === key)
    .slice(0, 200);
  const [carriers, names] = await Promise.all([
    inChunks<{ id: string; name: string }>(rows.map((r) => r.carrier_id).filter((x): x is string => Boolean(x)), (chunk) => client.from("carriers").select("id, name").in("id", chunk)),
    insuredNames(tenantId, rows.map((r) => ({ id: r.id, lead_id: r.lead_id, insured_role: r.insured_role === "spouse" ? "spouse" as const : "primary" as const }))),
  ]);
  const carrierName = new Map(carriers.map((c) => [c.id, c.name]));
  return rows.map((a) => ({
    id: a.id,
    leadId: a.lead_id,
    clientName: names.nameFor({ id: a.id, lead_id: a.lead_id, insured_role: a.insured_role === "spouse" ? "spouse" : "primary" }),
    carrierName: a.carrier_id ? carrierName.get(a.carrier_id) ?? null : null,
    submittedOn: a.submitted_at ? dayIn(a.submitted_at, zone) : null,
  }));
}

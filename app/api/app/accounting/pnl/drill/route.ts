import { NextResponse, type NextRequest } from "next/server";

import { customRange, resolvePeriod, statement as statementOf } from "@/lib/accounting/pnlCore";
import { drill, loadPnl, PnlError, reportingSettings, statementRows } from "@/lib/accounting/pnlStore";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-7.7 (Notion sprint) · the entries behind one P&L line, each linked to its source document —
 * a figure nobody can open is a figure nobody acts on. Owner and bookkeeper only.
 */
const ROLES = ["owner", "bookkeeper"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTIONS = ["in", "held", "acquisition", "overhead", "splits"] as const;
const SOURCES = ["partner", "vendor", "expense_category"] as const;

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("profit_and_loss", ROLES);
  if (auth instanceof NextResponse) return auth;
  const { tenantId } = auth.context;
  const q = request.nextUrl.searchParams;
  if (q.get("view") === "summary") return summary(tenantId, q);
  const section = SECTIONS.find((s) => s === q.get("section"));
  const entryType = q.get("entry_type") ?? "";
  const sourceType = SOURCES.find((s) => s === q.get("source_type")) ?? null;
  const sourceId = q.get("source_id");
  if (!section || !/^[a-z_]{2,40}$/.test(entryType) || (sourceId && !UUID.test(sourceId))) return NextResponse.json({ error: "Unknown line." }, { status: 400 });
  try {
    const settings = await reportingSettings(tenantId);
    const period = resolvePeriod({ kind: q.get("kind"), anchor: q.get("anchor"), from: q.get("from"), to: q.get("to"), basis: q.get("basis") }, { basis: settings.basis, fyStartMonth: settings.fyStartMonth, today: new Date().toISOString().slice(0, 10) });
    if ("error" in period) return NextResponse.json({ error: period.error }, { status: 400 });
    const result = await drill(tenantId, { range: period.range, basis: period.basis, section, entryType, sourceType, sourceId, category: q.get("category"), page: Math.max(0, Number(q.get("page") ?? 0) || 0) });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PnlError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[pnl]", error);
    return NextResponse.json({ error: "The entries could not be loaded" }, { status: 500 });
  }
}

/**
 * `?view=summary` (the phone's Money tab and Profit & loss, release 3 boards G3 and G3e): the statement the web's
 * Profit & loss draws (loadPnl, the same period rules: `kind` month · quarter · year, `anchor`, the agency's basis),
 * cut to what a phone shows: the totals, the lines with their names, the period before, and the six-month trend.
 * Read only, under this route's gate (owner and bookkeeper).
 *
 * Added for the boards' wording: `previousToDate` — for the month that holds today, the month before through the
 * same day ("↑ $2,940 vs October at this point"), by the same statement rules on that custom range; and `splitPeople`
 * — how many people the period's team pay went to ("Team pay · 6 people"), from the cost ledger's producer splits.
 */
async function summary(tenantId: string, q: URLSearchParams) {
  try {
    const settings = await reportingSettings(tenantId);
    const kind = q.get("kind");
    const period = resolvePeriod({ kind: kind === "quarter" || kind === "year" ? kind : "month", anchor: q.get("anchor"), basis: q.get("basis") }, { basis: settings.basis, fyStartMonth: settings.fyStartMonth, today: new Date().toISOString().slice(0, 10) });
    if ("error" in period) return NextResponse.json({ error: period.error }, { status: 400 });
    const today = new Date().toISOString().slice(0, 10);
    const [data, previousToDate, splitPeople] = await Promise.all([
      loadPnl(tenantId, period),
      period.kind === "month" && period.range.from <= today && today < period.range.to ? toDate(tenantId, period.range.from, today, period.basis).catch(() => null) : Promise.resolve(null),
      people(tenantId, period.range, period.basis).catch(() => null),
    ]);
    const s = data.statement;
    const line = (l: (typeof s.in)[number]) => ({ section: l.section, entryType: l.entryType, sourceType: l.sourceType, sourceId: l.sourceId, sourceName: l.sourceName, amountCents: l.amountCents, entries: l.entries });
    return NextResponse.json({
      kind: data.kind, basis: data.basis, range: data.range, today: data.today,
      totals: { inCents: s.inCents, acquisitionCents: s.acquisitionCents, overheadCents: s.overheadCents, splitsCents: s.splitsCents, netProfitCents: s.netProfitCents, heldCents: s.heldCents },
      lines: { in: s.in.map(line), acquisition: s.acquisition.map(line), overhead: s.overhead.map(line), splits: s.splits.map(line) },
      previous: { range: data.previous.range, inCents: data.previous.inCents, acquisitionCents: data.previous.acquisitionCents, overheadCents: data.previous.overheadCents, splitsCents: data.previous.splitsCents, netProfitCents: data.previous.netProfitCents },
      trend: data.trend,
      previousToDate,
      splitPeople,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PnlError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[pnl] summary", error);
    return NextResponse.json({ error: "The profit and loss could not be loaded" }, { status: 500 });
  }
}

/** The month before, from its first day through the same day of the month as today (capped at its last day). */
async function toDate(tenantId: string, monthStart: string, today: string, basis: "cash" | "accrual") {
  const [y, m] = monthStart.split("-").map(Number);
  const prevStart = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const lastDay = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const end = `${prevStart.slice(0, 8)}${String(Math.min(Number(today.slice(8, 10)), lastDay)).padStart(2, "0")}`;
  const range = customRange(prevStart, end);
  if (!range) return null;
  const rows = await statementRows(tenantId, { kind: "custom", range, basis });
  const t = statementOf(rows.cur);
  return { range, inCents: t.inCents, acquisitionCents: t.acquisitionCents, overheadCents: t.overheadCents, splitsCents: t.splitsCents, netProfitCents: t.netProfitCents };
}

/** How many people the period's producer splits went to (the cost ledger, by the statement's date basis). */
async function people(tenantId: string, range: { from: string; to: string }, basis: "cash" | "accrual") {
  type Q = { eq(c: string, v: unknown): Q; gte(c: string, v: unknown): Q; lt(c: string, v: unknown): Q; range(a: number, b: number): PromiseLike<{ data: Array<{ producer_user_id: string | null }> | null; error: unknown }> };
  const db = getSupabaseServiceClient() as unknown as { from(t: string): { select(c: string): Q } };
  const day = basis === "cash" ? "paid_on" : "incurred_on";
  const who = new Set<string>();
  for (let at = 0; at < 20_000; at += 1000) {
    const { data, error } = await db.from("cost_entry").select("producer_user_id").eq("tenant_id", tenantId).eq("entry_type", "producer_split").gte(day, range.from).lt(day, range.to).range(at, at + 999);
    if (error) return null;
    for (const r of data ?? []) if (r.producer_user_id) who.add(r.producer_user_id);
    if (!data || data.length < 1000) break;
  }
  return who.size;
}

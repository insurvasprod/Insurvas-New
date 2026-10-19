import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { owedToYou } from "@/lib/discrepancies/service";
import { loadDiscrepancies } from "@/lib/ingestion/discrepancyStore";
import { moneySummary } from "@/lib/ingestion/discrepancyEngine";
import { historyStart, persistency, persistencyText } from "@/lib/ingestion/scorecards";
import { loadScorecards } from "@/lib/ingestion/scorecardsStore";
import { addMonths } from "@/lib/ledger/compute";
import { getCommissionLedger } from "@/lib/ledger/service";
import { getLapseRisk } from "@/lib/lapseRisk/service";
import { roleCanViewCommission } from "@/lib/tenantAuth/permissions";
import { rowVisible, type ProducerScope } from "@/lib/agency/visibilityCore";
import type { TenantContext } from "@/lib/tenantAuth/requireTenant";

import { HOME_MONEY, type HomeMoneyKey } from "./roleHome";

/**
 * The dashboard's money and retention figures (LA-4.18, Sixteen #15's money dashboard), each read
 * from the SAME source as the page it opens, so the number on the dashboard is the number on the
 * page (LA-4.20):
 *
 *   statements     Statements' "To review": standing statements in review
 *   discrepancies  Discrepancies' "Open": carrier-file findings + statements imported by hand
 *   owed           Discrepancies' "You appear to be owed", the same two sources
 *   exposure       the ledger's expected view, "still exposed" (lib/ledger getCommissionLedger)
 *   lapse          Lapse risk's recorded signals (lib/lapseRisk getLapseRisk)
 *   persistency    Book scorecards' month-9 persistency, from the carriers' files
 *
 * Persistency is NOT lib/persistency's report: that one is built from hand-entered policies and was
 * retired from the screen on 2026-10-08 (app/app/(shell)/persistency redirects) so that two
 * persistency figures could not disagree. The dashboard follows the screen.
 *
 * Scope is the reader's, as on each page: the ledger, lapse risk and scorecards ask the commission
 * rule (a producer's own book); statements and discrepancies are owner and bookkeeper pages, read
 * agency-wide, and are only ever asked for when the reader can open them (roleHome gates the keys).
 *
 * AG-0.5 · producer isolation. `scope` is the session's producer scope (scopeFor, from the session;
 * null = no filter, the default, so other callers and solo tenants are unchanged). With a scope:
 *   · statements, discrepancies and owed are agency-wide by nature (no producer on a statement
 *     count or a carrier finding), so they are never read; roleHome only gives them to the owner and
 *     the bookkeeper, whose scope is null, so nothing a narrow home shows today is lost;
 *   · exposure reads the ledger with the role rule AND the scope (as /app/ledger does);
 *   · lapse risk and persistency are read only for a producer (a manager rides on producer), whose
 *     role rule already narrows them to his own book (getLapseRisk's commission rule, loadScorecards'
 *     agent_user_id = reader): inside his scope, and for a manager stricter than it. Any other narrow
 *     role is never given them (those reads would not narrow it).
 *
 * Every read runs only when a key needs it, and all of them run at once. A read that fails leaves
 * its figure out rather than showing a zero it could not get.
 */
export type MoneyFigure = {
  key: HomeMoneyKey;
  label: string;
  /** As shown: "$4,210", "3", "62%", "—". */
  value: string;
  caption: string;
  tone?: "good" | "warning" | "danger";
  href: string;
  /** A share drawn as a ring beside the caption (coverage, persistency). */
  ring?: { value: number; max: number; label: string };
};

export type DashboardMoney = {
  figures: MoneyFigure[];
  /** Policies inside their chargeback window (the ledger's exposure rows), for the upgrade tile; null when not read. */
  exposurePolicies: number | null;
};

const usd = (cents: number) => `${cents < 0 ? "−" : ""}$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;
const n = (value: number) => value.toLocaleString("en-US");
const plural = (value: number, one: string, many: string) => `${n(value)} ${value === 1 ? one : many}`;

type Head = PromiseLike<{ count: number | null; error: { message: string } | null }>;
type Chain = Head & { eq(column: string, value: unknown): Chain; not(column: string, op: string, value: unknown): Chain };
type Loose = { from(table: string): { select(columns: string, options: { count: "exact"; head: true }): Chain } };
const db = () => getSupabaseServiceClient() as unknown as Loose;

async function statementCounts(tenantId: string) {
  const standing = () => db().from("tenant_commission_statements").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  const [all, review] = await Promise.all([standing().not("status", "eq", "voided"), standing().eq("status", "review")]);
  if (all.error || review.error) throw new Error("statement counts unavailable");
  return { standing: all.count ?? 0, review: review.count ?? 0 };
}

/** The Discrepancies page's own figures: its "Open" and "You appear to be owed" tiles. */
async function discrepancyFigures(tenantId: string) {
  const [carrier, hand] = await Promise.all([loadDiscrepancies(tenantId), owedToYou(tenantId)]);
  const sum = moneySummary((carrier.available ? carrier.items : []).map((item) => ({
    discrepancy_type: item.type, difference_cents: item.differenceCents, expected_amount_cents: item.expectedCents, reported_amount_cents: item.reportedCents, status: item.status,
  })));
  return {
    available: carrier.available || hand.available,
    open: sum.open + (hand.available ? hand.count : 0),
    owedCents: sum.owedCents + (hand.available ? Math.max(0, hand.totalCents) : 0),
    unpricedMissing: sum.unpricedMissing,
  };
}

export async function getDashboardMoney(input: { context: TenantContext; wanted: Array<{ key: HomeMoneyKey; href: string }>; upgrade: boolean; scope?: ProducerScope }): Promise<DashboardMoney> {
  const { context } = input;
  const scope: ProducerScope = input.scope ?? null;
  // AG-0.5: under a scope, only the figures that can be narrowed to the visible producers (see above).
  const narrowable = (key: HomeMoneyKey) => scope === null || key === "exposure" || ((key === "lapse" || key === "persistency") && context.role === "producer");
  const wanted = input.wanted.filter((item) => narrowable(item.key));
  const want = new Set(wanted.map((item) => item.key));
  // The role rule (a producer sees his own) AND the session's producer scope: in an agency both must hold.
  const canView = (producerUserId: string | null | undefined) => roleCanViewCommission(context.role, context.userId, producerUserId ?? undefined) && rowVisible(scope, producerUserId);
  const safe = <T>(promise: Promise<T>) => promise.catch((error: unknown) => { console.error("[dashboard money]", error); return null; });

  // Lapse risk computes the ledger itself, so when both are wanted the ledger is read once, inside it.
  const lapseRead = want.has("lapse") ? safe(getLapseRisk(context)) : Promise.resolve(null);
  const ledgerRead = !want.has("lapse") && (want.has("exposure") || (input.upgrade && scope === null)) ? safe(getCommissionLedger({ tenantId: context.tenantId, canView })) : Promise.resolve(null);
  const today = new Date().toISOString().slice(0, 10);

  const [statements, discrepancies, lapse, ledgerOnly, scorecards] = await Promise.all([
    want.has("statements") ? safe(statementCounts(context.tenantId)) : null,
    want.has("discrepancies") || want.has("owed") ? safe(discrepancyFigures(context.tenantId)) : null,
    lapseRead,
    ledgerRead,
    want.has("persistency") ? safe(loadScorecards(context, { from: addMonths(today, -12), to: today })) : null,
  ]);
  const exposure = lapse
    ? { cents: lapse.chargebackExposure.totalCents, policies: lapse.chargebackExposure.policies.length, priced: null as number | null }
    : ledgerOnly
      ? { cents: ledgerOnly.totals.exposureCents, policies: ledgerOnly.exposure.length, priced: ledgerOnly.policiesRead }
      : null;

  const build: Record<HomeMoneyKey, () => Omit<MoneyFigure, "key" | "label" | "href"> | null> = {
    statements: () => statements && (statements.standing === 0
      ? { value: "—", caption: "Import a carrier statement" }
      : { value: n(statements.review), caption: statements.review ? `of ${plural(statements.standing, "statement", "statements")} imported` : "every statement reviewed", tone: statements.review ? "warning" : "good" }),
    discrepancies: () => discrepancies && (!discrepancies.available
      ? null
      : { value: n(discrepancies.open), caption: discrepancies.open ? "open or in a letter" : "nothing open: import statements to check", tone: discrepancies.open ? "warning" : undefined }),
    owed: () => discrepancies && (!discrepancies.available
      ? null
      : { value: usd(discrepancies.owedCents), caption: discrepancies.unpricedMissing ? `plus ${n(discrepancies.unpricedMissing)} missing without a rate` : discrepancies.owedCents ? "missing, short-paid and wrong chargebacks" : "nothing found owed", tone: discrepancies.owedCents ? "warning" : undefined }),
    exposure: () => exposure && (exposure.priced === 0
      ? { value: "—", caption: "Add a policy to see its window" }
      : { value: usd(exposure.cents), caption: exposure.policies ? `${plural(exposure.policies, "policy", "policies")} inside the chargeback window` : "nothing inside a chargeback window", tone: exposure.cents ? "warning" : undefined }),
    lapse: () => lapse && (lapse.storage === "pending"
      ? null
      : { value: n(lapse.totals.policies), caption: lapse.totals.policies ? `${usd(lapse.totals.commissionExposedCents)} commission at stake` : "No open signal: record one from a policy", tone: lapse.totals.policies ? "danger" : "good" }),
    persistency: () => {
      if (!scorecards || !scorecards.available) return scorecards && !scorecards.available ? { value: "—", caption: "Read a carrier file to begin" } : null;
      const cell = persistency(scorecards.policies, 9, scorecards.today, historyStart(scorecards.policies));
      if (cell.building) return { value: "—", caption: cell.readyOn ? `building: ready ${cell.readyOn}` : "Read a carrier file to begin" };
      return {
        value: persistencyText(cell, "count", scorecards.minSample),
        caption: cell.eligible ? `${n(cell.alive)} of ${n(cell.eligible)} still in force` : "no policy old enough yet",
        ring: cell.eligible ? { value: cell.alive, max: cell.eligible, label: `${n(cell.alive)} of ${n(cell.eligible)} policies in force at month 9` } : undefined,
      };
    },
  };

  const figures: MoneyFigure[] = [];
  for (const item of wanted) {
    const figure = build[item.key]();
    if (figure) figures.push({ key: item.key, label: HOME_MONEY[item.key].label, href: item.href, ...figure });
  }
  return { figures, exposurePolicies: exposure ? exposure.policies : null };
}

import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { OWED_KINDS } from "@/lib/discrepancies/compute";
import { listDiscrepancies, type DiscrepancyView } from "@/lib/discrepancies/service";
import { findingExpectedCents } from "@/lib/commissions/lineExpected";
import { HAND_TYPE, type PayIssue, type PayIssueStatus } from "@/lib/commissions/payIssueGroups";
import { agencyToday } from "@/lib/ingestion/agencyDay";
import { moneySummary, type DiscrepancyType } from "@/lib/ingestion/discrepancyEngine";
import { DISPUTABLE } from "@/lib/ingestion/disputeLetter";
import { loadDiscrepancies, type DiscrepancyRow, type DisputeRow } from "@/lib/ingestion/discrepancyStore";

/**
 * Commissions › Pay issues (round 7, 2·A): both sources read once, as one list of PayIssue, for the list, a group's
 * page, an issue's page and a letter's page. Reading only: the findings are recomputed after each change to their
 * facts and on "Check now", never because a page opened.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();
const chunks = <T,>(items: T[], n = 200) => Array.from({ length: Math.ceil(items.length / n) }, (_, i) => items.slice(i * n, i * n + n));

const CARRIER_CLOSED_WORD: Record<string, string> = { resolved: "Resolved", dismissed: "Dismissed", expired: "No longer applies", accepted: "Accepted" };
const HAND_CLOSED_WORD: Record<string, string> = { resolved: "Resolved", written_off: "Written off", cleared: "No longer applies" };
const carrierStatus = (status: string): PayIssueStatus => (status === "open" ? "open" : status === "disputed" ? "letter" : "closed");

export type PolicyFacts = { contactId: string | null; clientName: string | null; issuedOn: string | null; productCode: string | null; annualPremiumCents: number | null; status: string | null; asOf: string | null; agentUserId: string | null; agentName: string | null; agentCode: string | null };

/** The carrier files' facts for these policies (policy_current), with each client's name. A failed read: no names. */
export async function policyFactsFor(tenantId: string, keys: Array<{ carrierId: string; policyNumber: string }>): Promise<Map<string, PolicyFacts>> {
  const out = new Map<string, PolicyFacts>();
  const numbers = [...new Set(keys.map((k) => k.policyNumber))];
  if (!numbers.length) return out;
  try {
    const rows = (await Promise.all(chunks(numbers).map((part) => db().from("policy_current").select("carrier_id, policy_number, contact_id, issue_date, product_code, annualised_premium_cents, status_normalized, as_of, agent_user_id, agent_identifier").eq("tenant_id", tenantId).in("policy_number", part))))
      .flatMap((r: Loose) => r.data ?? []) as Loose[];
    const contactIds = [...new Set(rows.map((r) => r.contact_id).filter(Boolean))] as string[];
    const agentIds = [...new Set(rows.map((r) => r.agent_user_id).filter(Boolean))] as string[];
    const [contacts, agents] = await Promise.all([
      Promise.all(chunks(contactIds).map((part) => db().from("contacts").select("id, first_name, last_name").eq("tenant_id", tenantId).in("id", part))).then((r) => r.flatMap((x: Loose) => x.data ?? []) as Loose[]),
      agentIds.length ? db().from("users").select("id, name, email").in("id", agentIds).then((r: Loose) => (r.data ?? []) as Loose[]) : Promise.resolve([] as Loose[]),
    ]);
    const nameOf = new Map<string, string | null>(contacts.map((c) => [c.id as string, ([c.first_name, c.last_name].filter(Boolean).join(" ") || null) as string | null]));
    const agentOf = new Map<string, string | null>(agents.map((u: Loose) => [u.id as string, (u.name || u.email || null) as string | null]));
    for (const r of rows) {
      out.set(`${r.carrier_id}|${r.policy_number}`, {
        contactId: r.contact_id ?? null, clientName: r.contact_id ? nameOf.get(r.contact_id) ?? null : null, issuedOn: r.issue_date ?? null, productCode: r.product_code ?? null,
        annualPremiumCents: r.annualised_premium_cents == null ? null : Number(r.annualised_premium_cents), status: r.status_normalized ?? null, asOf: r.as_of ?? null,
        agentUserId: r.agent_user_id ?? null, agentName: r.agent_user_id ? agentOf.get(r.agent_user_id) ?? null : null, agentCode: r.agent_identifier ?? null,
      });
    }
  } catch (error) {
    console.error("[pay-issues] policy facts could not be read", error);
  }
  return out;
}

export function carrierIssue(row: DiscrepancyRow, facts: PolicyFacts | undefined, today: string): PayIssue {
  // A chargeback still to come has nothing paid to compare: what will be taken back is what is owed to the carrier.
  const coming = row.type === "missing_chargeback" && row.differenceCents === null;
  const difference = coming ? -Math.abs(row.expectedCents ?? 0) : row.differenceCents ?? 0;
  const status = carrierStatus(row.status);
  const overdueFrom = typeof row.evidence?.overdue_from === "string" ? row.evidence.overdue_from : null;
  return {
    id: row.id, source: "carrier", type: row.type, carrierId: row.carrierId, carrierName: row.carrierName, policyNumber: row.policyNumber,
    clientName: facts?.clientName ?? null, issuedOn: facts?.issuedOn ?? null,
    expectedCents: coming ? null : findingExpectedCents(row.type, row.expectedCents), paidCents: coming ? null : row.reportedCents,
    owedToYouCents: row.type !== "held_building_up" && difference > 0 ? difference : 0, owedToCarrierCents: difference < 0 ? -difference : 0,
    unpriced: row.type === "missing" && row.differenceCents === null, withinLag: Boolean(overdueFrom && overdueFrom > today),
    disputable: status === "open" && DISPUTABLE.has(row.type), status,
    statusWord: status === "closed" ? CARRIER_CLOSED_WORD[row.resolution ?? ""] ?? CARRIER_CLOSED_WORD[row.status] ?? "Closed" : status === "letter" ? "In a letter" : "Open",
    foundAt: row.detectedAt, disputeId: row.disputeId,
  };
}

export function handIssue(item: DiscrepancyView): PayIssue {
  const type: DiscrepancyType = HAND_TYPE[item.kind];
  const status: PayIssueStatus = item.status === "open" ? "open" : item.status === "disputed" ? "letter" : "closed";
  return {
    id: item.id, source: "hand", type, carrierId: item.carrierId, carrierName: item.carrierName, policyNumber: item.policyNumber, clientName: item.insuredName || null, issuedOn: null,
    expectedCents: findingExpectedCents(type, item.detail?.expectedCents ?? null), paidCents: item.detail?.receivedCents ?? null,
    owedToYouCents: item.owedCents > 0 ? item.owedCents : 0, owedToCarrierCents: item.owedCents < 0 ? -item.owedCents : 0,
    unpriced: false, withinLag: false, disputable: status === "open" && Boolean(item.carrierId) && DISPUTABLE.has(type), status,
    statusWord: status === "closed" ? HAND_CLOSED_WORD[item.status] ?? "Closed" : status === "letter" ? "In a letter" : "Open",
    foundAt: item.firstSeenAt, disputeId: null,
  };
}

export type PayIssuesRead = Awaited<ReturnType<typeof loadPayIssues>>;

/** Every pay issue from both sources, the saved letters, and the headline figures. */
export async function loadPayIssues(tenantId: string, options: { names?: boolean } = {}) {
  const [found, list, today] = await Promise.all([loadDiscrepancies(tenantId), listDiscrepancies(tenantId), agencyToday(tenantId)]);
  const carrierRows = found.available ? found.items : [];
  const facts = options.names === false ? new Map<string, PolicyFacts>() : await policyFactsFor(tenantId, carrierRows.filter((r) => r.policyNumber).map((r) => ({ carrierId: r.carrierId, policyNumber: r.policyNumber! })));
  const issues: PayIssue[] = [
    ...carrierRows.map((row) => carrierIssue(row, row.policyNumber ? facts.get(`${row.carrierId}|${row.policyNumber}`) : undefined, today)),
    ...(list.available ? list.items : []).map(handIssue),
  ];
  const sum = moneySummary(carrierRows.map((i) => ({ discrepancy_type: i.type, difference_cents: i.differenceCents, expected_amount_cents: i.expectedCents, reported_amount_cents: i.reportedCents, status: i.status })));
  // An unexpected chargeback asserts no cause, so it is listed but never counted as owed (OWED_KINDS).
  const handOwed = (list.available ? list.items : []).filter((i) => (i.status === "open" || i.status === "disputed") && OWED_KINDS.has(i.kind)).reduce((total, i) => total + Math.max(0, i.owedCents), 0);
  return {
    available: found.available || list.available,
    carrierAvailable: found.available,
    handAvailable: list.available,
    truncated: found.available ? found.truncated : false,
    today,
    issues,
    carrierRows,
    handRows: list.available ? list.items : [],
    disputes: (found.available ? found.disputes : []) as DisputeRow[],
    facts,
    summary: { owedCents: sum.owedCents + handOwed, unpriced: sum.unpricedMissing, comingBackCents: sum.comingBackCents, heldCents: sum.heldCents },
  };
}

export type CarrierPayFacts = { trigger: "on_issue" | "on_first_draft" | null; lagDays: number | null; toleranceCents: number | null; lastFile: { id: string; date: string | null; name: string } | null };

/** One carrier's pay timing (the agency's own, else the platform's) and its last commission file. */
export async function carrierPayFacts(tenantId: string, carrierId: string): Promise<CarrierPayFacts> {
  try {
    const [settings, file] = await Promise.all([
      db().from("carrier_operating_settings").select("tenant_id, commission_trigger, expected_lag_days, tolerance_cents").eq("carrier_id", carrierId).or(`tenant_id.eq.${tenantId},tenant_id.is.null`),
      db().from("file_registry").select("id, file_date, original_filename").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("file_type", "commissions").neq("status", "superseded").order("file_date", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const rows = (settings.error ? [] : settings.data ?? []) as Loose[];
    const own = rows.find((r) => r.tenant_id === tenantId);
    const shared = rows.find((r) => r.tenant_id === null);
    const pick = (field: string) => own?.[field] ?? shared?.[field] ?? null;
    return {
      trigger: pick("commission_trigger"), lagDays: pick("expected_lag_days") === null ? null : Number(pick("expected_lag_days")), toleranceCents: pick("tolerance_cents") === null ? null : Number(pick("tolerance_cents")),
      lastFile: file.data ? { id: file.data.id, date: file.data.file_date ?? null, name: file.data.original_filename ?? "the file" } : null,
    };
  } catch (error) {
    console.error("[pay-issues] carrier pay facts could not be read", error);
    return { trigger: null, lagDays: null, toleranceCents: null, lastFile: null };
  }
}

/** "Aflac pays 45 days after issue", or what is not set. */
export function payTimingWords(carrierName: string, facts: Pick<CarrierPayFacts, "trigger" | "lagDays">): string {
  if (facts.trigger === null && facts.lagDays === null) return `No pay timing set for ${carrierName}`;
  if (facts.lagDays === null) return `${carrierName} pays ${facts.trigger === "on_issue" ? "after issue" : "after the first draft"}; no lag set`;
  if (facts.trigger === null) return `${carrierName} pays within ${facts.lagDays} days; no pay trigger set`;
  return `${carrierName} pays ${facts.lagDays} days after ${facts.trigger === "on_issue" ? "issue" : "the first draft"}`;
}

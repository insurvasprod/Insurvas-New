import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { getVendorCostPerPolicy } from "@/lib/vendorScorecard/service";

import { buildSummary, type SummaryInput } from "./dailySummary";
import { CONTRACT_MONTH, DEFAULT_MIN_SAMPLE, historyStart, persistency, type ScorePolicy, type Submission, type WeekTotal } from "./scorecards";

/**
 * LA-4.18 (Notion sprint) · the reads behind the scorecards. Everything is read live, per request,
 * from LA-4.7's policy_current and LA-4.12's ledger (commission_policy_totals for each policy, the
 * week totals summed in the database); nothing is snapshotted. A producer sees their own book: the
 * policies credited to them, their own ledger lines and submissions, and no agency spend.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export class ScorecardsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ScorecardsError";
  }
}

export const SCORECARDS_PENDING_MESSAGE = "This needs a database update (20261008270000).";

export type Viewer = { tenantId: string; userId: string; role: string };

const PAGE = 1000;
const CHUNK = 200;
/** The countdown that reads red on the call list (LA-4.16): "call today". */
const CLOSING_SOON_DAYS = 3;

async function everyRow(build: () => Loose, max = 100_000): Promise<{ rows: Loose[]; error: Loose }> {
  const rows: Loose[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) return { rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return { rows, error: null };
}

async function byIds(table: string, columns: string, ids: Array<string | null>, tenantId?: string): Promise<Loose[]> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const chunks: string[][] = [];
  for (let at = 0; at < unique.length; at += CHUNK) chunks.push(unique.slice(at, at + CHUNK));
  const results = await Promise.all(chunks.map((chunk) => {
    let query = db().from(table).select(columns).in("id", chunk);
    if (tenantId) query = query.eq("tenant_id", tenantId);
    return query;
  }));
  return results.flatMap((result: Loose) => result.data ?? []);
}

/** How old a carrier's latest file may be and still be "the latest" in the day's summary. */
const LATEST_FILE_DAYS = 7;
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const POLICY_COLUMNS = "carrier_id, policy_number, contact_id, agent_user_id, agent_identifier, agency_id, vendor_id, campaign_id, status_normalized, issue_date, effective_date, lapsed_on, termination_date, months_paid, annualised_premium_cents, product_code, product_tier, first_seen_date, application_id, as_of, days_until_carrier_closes, last_snapshot_date";

export type ScorecardData = {
  available: true;
  today: string;
  policies: ScorePolicy[];
  minSample: number;
  settingsAvailable: boolean;
  weeks: WeekTotal[] | null;
  submissions: Submission[];
  /** Agency spend per lead source in the period (owners and bookkeepers); null for a producer or when the LA-2 report isn't there. */
  spend: Array<[string, number]> | null;
  summary: SummaryInput;
  scoped: boolean;
};

export async function loadScorecards(viewer: Viewer, period: { from: string; to: string }, options: { withClients?: boolean; withSpend?: boolean } = {}): Promise<ScorecardData | { available: false }> {
  const scoped = viewer.role === "producer";
  const t = viewer.tenantId;
  const read = await everyRow(() => {
    let query = db().from("policy_current").select(POLICY_COLUMNS).eq("tenant_id", t);
    if (scoped) query = query.eq("agent_user_id", viewer.userId);
    return query.order("carrier_id").order("policy_number");
  });
  if (read.error) {
    if (isSchemaGap(read.error)) return { available: false };
    throw new Error(`Could not load the policies: ${read.error.message}`);
  }
  const rows = read.rows;
  const today = rows.reduce((max: string, r: Loose) => (r.as_of > max ? r.as_of : max), "") || new Date().toISOString().slice(0, 10);
  const since = addDays(today, -1);

  // The LA-2 spend report (about a second: it is the whole lead funnel) only for the view that needs it, in parallel with the rest.
  const spendRead: Promise<Array<[string, number]> | null> = scoped || !options.withSpend ? Promise.resolve(null) : getVendorCostPerPolicy(t, period)
    .then((report) => (report.available ? report.rows.map((v): [string, number] => [v.vendor_id, Number(v.net_spend_cents ?? v.total_spend_cents ?? 0)]) : null))
    .catch((error) => { console.error("[scorecards] lead spend could not be read", error); return null; });
  const [money, carriers, users, vendors, campaigns, tenant, notes, settings, weeks, subs, changes, chargebackLines, contacts] = await Promise.all([
    everyRow(() => db().from("commission_policy_totals").select("carrier_id, policy_number, advanced_cents, charged_back_cents, net_received_cents").eq("tenant_id", t).order("carrier_id").order("policy_number")),
    db().from("carriers").select("id, name"),
    byIds("users", "id, name, email", rows.map((r: Loose) => r.agent_user_id)),
    db().from("tenant_lead_vendors").select("id, name").eq("tenant_id", t),
    db().from("tenant_campaigns").select("id, name, vendor_id").eq("tenant_id", t),
    db().from("tenants").select("name").eq("id", t).maybeSingle(),
    everyRow(() => db().from("policy_annotation").select("carrier_id, policy_number, lead_vendor_id, lead_campaign_id").eq("tenant_id", t).order("carrier_id").order("policy_number")),
    db().from("book_insight_settings").select("min_sample").eq("tenant_id", t).maybeSingle(),
    db().rpc("commission_week_totals", { p_tenant_id: t, p_from: addDays(today, -7 * 13), p_to: today, p_agent_user_id: scoped ? viewer.userId : null }),
    everyRow(() => {
      let query = db().from("tenant_application_submissions").select("application_id, carrier_id, submitted_at").eq("tenant_id", t).gte("submitted_at", `${period.from}T00:00:00Z`).lt("submitted_at", `${addDays(period.to, 1)}T00:00:00Z`);
      if (scoped) query = query.eq("created_by", viewer.userId);
      return query.order("submitted_at").order("id");
    }),
    everyRow(() => db().from("policy_change").select("carrier_id, policy_number, old_value, new_value, to_snapshot_date").eq("tenant_id", t).eq("field_name", "status_normalized").gte("to_snapshot_date", addDays(today, -LATEST_FILE_DAYS)).order("to_snapshot_date").order("policy_number").order("id")),
    everyRow(() => {
      let query = db().from("commission_entry").select("amount_cents").eq("tenant_id", t).eq("entry_type", "chargeback").gte("created_at", `${since}T00:00:00Z`);
      if (scoped) query = query.eq("agent_user_id", viewer.userId);
      return query.order("created_at").order("id");
    }),
    options.withClients ? byIds("contacts", "id, first_name, last_name", rows.map((r: Loose) => r.contact_id), t) : Promise.resolve([]),
  ]);

  const moneyRows = money.error ? [] : money.rows;
  const ledger = new Map<string, Loose>(moneyRows.map((m: Loose) => [`${m.carrier_id}|${m.policy_number}`, m]));
  const carrierName = new Map<string, string>((carriers.data ?? []).map((c: Loose) => [c.id, c.name]));
  const userName = new Map<string, string>(users.map((u: Loose) => [u.id, u.name || u.email]));
  const vendorName = new Map<string, string>((vendors.data ?? []).map((v: Loose) => [v.id, v.name]));
  const campaign = new Map<string, Loose>((campaigns.data ?? []).map((c: Loose) => [c.id, c]));
  const note = new Map<string, Loose>((notes.error ? [] : notes.rows).map((n: Loose) => [`${n.carrier_id}|${n.policy_number}`, n]));
  const contact = new Map<string, Loose>(contacts.map((c: Loose) => [c.id, c]));
  const agencyName = tenant.data?.name ?? "This agency";

  const policies: ScorePolicy[] = rows.map((r: Loose): ScorePolicy => {
    const key = `${r.carrier_id}|${r.policy_number}`;
    const n = note.get(key);
    const vendorId = (n && (n.lead_vendor_id || n.lead_campaign_id) ? n.lead_vendor_id ?? campaign.get(n.lead_campaign_id)?.vendor_id : r.vendor_id ?? campaign.get(r.campaign_id)?.vendor_id) ?? null;
    const campaignId = n && (n.lead_vendor_id || n.lead_campaign_id) ? n.lead_campaign_id : r.campaign_id;
    const m = ledger.get(key);
    const c = r.contact_id ? contact.get(r.contact_id) : null;
    return {
      key,
      carrierId: r.carrier_id,
      carrierName: carrierName.get(r.carrier_id) ?? "Carrier not known",
      policyNumber: r.policy_number,
      clientName: c ? [c.first_name, c.last_name].filter(Boolean).join(" ") || null : null,
      status: r.status_normalized,
      issueDate: r.issue_date ?? r.effective_date ?? null,
      lapsedOn: r.lapsed_on,
      terminationDate: r.termination_date,
      monthsPaid: r.months_paid,
      annualCents: r.annualised_premium_cents === null ? null : Number(r.annualised_premium_cents),
      productKey: [r.product_code, r.product_tier].filter(Boolean).join(" · ") || "none",
      productName: [r.product_code, r.product_tier].filter(Boolean).join(" · ") || "No product on file",
      agentKey: r.agent_user_id ?? (r.agent_identifier ? `code:${r.agent_identifier}` : "none"),
      agentName: r.agent_user_id ? userName.get(r.agent_user_id) ?? "Agent" : r.agent_identifier ? `Writing code ${r.agent_identifier}` : "No agent on file",
      agencyKey: r.agency_id ?? "agency",
      agencyName,
      sourceKey: vendorId ?? (campaignId ? `campaign:${campaignId}` : "none"),
      sourceName: vendorId ? vendorName.get(vendorId) ?? "Lead vendor" : campaignId ? campaign.get(campaignId)?.name ?? "Campaign" : "Unattributed",
      firstSeen: r.first_seen_date,
      applicationId: r.application_id,
      advancedCents: m ? Number(m.advanced_cents ?? 0) : null,
      chargedBackCents: m ? Number(m.charged_back_cents ?? 0) : null,
      netCents: m ? Number(m.net_received_cents ?? 0) : null,
    };
  });

  let settingsAvailable = true;
  if (settings.error) {
    if (!isSchemaGap(settings.error)) throw new Error(`Could not load the scorecard settings: ${settings.error.message}`);
    settingsAvailable = false;
  }
  const minSample = settings.data?.min_sample ?? DEFAULT_MIN_SAMPLE;

  let weekTotals: WeekTotal[] | null = null;
  if (weeks.error) {
    if (!isSchemaGap(weeks.error) && weeks.error.code !== "PGRST202") throw new Error(`Could not load commission by week: ${weeks.error.message}`);
  } else {
    weekTotals = (weeks.data ?? []).map((w: Loose) => ({ week: w.week_start, type: w.entry_type, cents: Number(w.amount_cents), entries: Number(w.entries) }));
  }

  const spend = await spendRead;

  // The day's summary: what each carrier's latest policy file changed (whatever its cadence, a week
  // at most), today's chargebacks, the call list's red rows. A policy counts once, and only while it
  // still has that status: one that lapsed and was paid up again in the same file is not "lapsed".
  const latestFile = new Map<string, string>();
  const statusOf = new Map<string, string>();
  for (const r of rows as Loose[]) {
    statusOf.set(`${r.carrier_id}|${r.policy_number}`, r.status_normalized);
    if (r.last_snapshot_date && r.last_snapshot_date > (latestFile.get(r.carrier_id) ?? "")) latestFile.set(r.carrier_id, r.last_snapshot_date);
  }
  const moved = (changes.error ? [] : changes.rows).filter((c: Loose) => c.to_snapshot_date === latestFile.get(c.carrier_id) && statusOf.get(`${c.carrier_id}|${c.policy_number}`) === c.new_value);
  const countTo = (value: string, from?: string[]) => new Set(moved.filter((c: Loose) => c.new_value === value && (!from || from.includes(c.old_value))).map((c: Loose) => `${c.carrier_id}|${c.policy_number}`)).size;
  const cbLines = chargebackLines.error ? [] : chargebackLines.rows;
  const summary = buildSummary({
    date: today,
    lapsed: countTo("lapsed"),
    atRisk: countTo("at_risk"),
    issued: countTo("active", ["submitted", "approved_unpaid"]),
    chargebacks: { lines: cbLines.length, cents: cbLines.reduce((sum: number, l: Loose) => sum + Number(l.amount_cents), 0) },
    closingSoon: rows.filter((r: Loose) => r.days_until_carrier_closes !== null && r.days_until_carrier_closes <= CLOSING_SOON_DAYS && ["active", "at_risk"].includes(r.status_normalized)).length,
    closingDays: CLOSING_SOON_DAYS,
    contract: persistency(policies, CONTRACT_MONTH, today, historyStart(policies)),
    minSample,
  });

  return {
    available: true,
    today,
    policies,
    minSample,
    settingsAvailable,
    weeks: weekTotals,
    submissions: (subs.error ? [] : subs.rows).filter((s: Loose) => s.application_id).map((s: Loose) => ({ applicationId: s.application_id, carrierId: s.carrier_id, submittedOn: String(s.submitted_at).slice(0, 10) })),
    spend,
    summary,
    scoped,
  };
}

export type WeekEntry = { id: string; carrierName: string; policyNumber: string; type: string; countedOn: string; cents: number; fileId: string; rowNumber: number | null };

/** The ledger lines behind one week's figures. */
export async function loadWeekEntries(viewer: Viewer, week: string): Promise<WeekEntry[] | null> {
  const [{ data, error }, carriers] = await Promise.all([
    db().rpc("commission_week_entries", { p_tenant_id: viewer.tenantId, p_week_start: week, p_agent_user_id: viewer.role === "producer" ? viewer.userId : null }),
    db().from("carriers").select("id, name"),
  ]);
  if (error) {
    if (isSchemaGap(error) || error.code === "PGRST202") return null;
    throw new Error(`Could not load the week's ledger lines: ${error.message}`);
  }
  const name = new Map<string, string>((carriers.data ?? []).map((c: Loose) => [c.id, c.name]));
  return (data ?? []).map((e: Loose) => ({ id: e.id, carrierName: name.get(e.carrier_id) ?? "Carrier", policyNumber: e.policy_number, type: e.entry_type === "reversal" && e.corrects_type ? `reversal of ${e.corrects_type}` : e.entry_type, countedOn: e.counted_on, cents: Number(e.amount_cents), fileId: e.file_id, rowNumber: e.row_number }));
}

/** The agency's sample size: below it a share is printed as a count. */
export async function saveMinSample(viewer: Viewer, minSample: number): Promise<void> {
  if (!Number.isInteger(minSample) || minSample < 2 || minSample > 100) throw new ScorecardsError("The sample size is a whole number from 2 to 100.", 400);
  const { error } = await db().from("book_insight_settings").upsert({ tenant_id: viewer.tenantId, min_sample: minSample, updated_by: viewer.userId, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
  if (error) {
    if (isSchemaGap(error)) throw new ScorecardsError(SCORECARDS_PENDING_MESSAGE, 503);
    throw new Error(`Could not save the sample size: ${error.message}`);
  }
}

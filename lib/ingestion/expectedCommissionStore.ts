import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { agencyToday } from "./agencyDay";
import { ageOn, coverage, expectedFor, firstDraftDate, resolveRate, triggerOccurredOn, type AdvanceRule, type ExpectedRow, type Schedule, type Trigger } from "./expectedCommission";

/**
 * LA-4.13 (Notion sprint) · expected commission, server side: gather the rate card, the carrier's
 * trigger and lag (LA-4.17), the agency's contract level, the product-family map and each policy's
 * trigger day, then write through record_expected_commission (20261008230000), the only writer.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export class RateCardError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RateCardError";
  }
}

export const EXPECTED_PENDING_MESSAGE = "Expected commission needs a database update (20261008230000).";

async function everyRow(build: () => Loose, max = 50_000): Promise<{ rows: Loose[]; error: Loose }> {
  const rows: Loose[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) return { rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return { rows, error: null };
}

const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

/** Everything the calculation reads for one agency (optionally one carrier). */
async function inputs(tenantId: string, carrierId?: string) {
  const scoped = (query: Loose) => (carrierId ? query.eq("carrier_id", carrierId) : query);
  // The age bands are read as soon as the schedules are in, beside the policies (which page longer).
  const [policies, settings, [schedules, bands], levels, families, advance] = await Promise.all([
    everyRow(() => scoped(db().from("policy_current").select("carrier_id, policy_number, product_code, annualised_premium_cents, issue_date, issued_on, effective_date, paid_to_date, first_seen_date, contact_id, status_normalized").eq("tenant_id", tenantId)).order("carrier_id").order("policy_number")),
    scoped(db().from("carrier_operating_settings").select("tenant_id, carrier_id, commission_trigger, expected_lag_days").or(`tenant_id.eq.${tenantId},tenant_id.is.null`)),
    Promise.resolve(scoped(db().from("commission_schedules").select("id, carrier_id, product_code, contract_level_bp, policy_year, rate_bp, effective_from, applies_onward").eq("tenant_id", tenantId))).then(async (schedules: Loose): Promise<[Loose, Loose[]]> => {
      const scheduleIds = (schedules.data ?? []).map((s: Loose) => s.id);
      const bands = scheduleIds.length ? (await Promise.all(chunks(scheduleIds, 200).map((ids) => db().from("commission_schedule_band").select("id, schedule_id, age_min, age_max, rate_bp").in("schedule_id", ids)))).flatMap((r: Loose) => r.data ?? []) : [];
      return [schedules, bands];
    }),
    scoped(db().from("tenant_carriers").select("carrier_id, contract_level_bp, effective_from").eq("tenant_id", tenantId).eq("is_active", true)),
    scoped(db().from("carrier_product_family").select("tenant_id, carrier_id, carrier_product_code, product_code").or(`tenant_id.eq.${tenantId},tenant_id.is.null`)),
    scoped(db().from("advance_rules").select("carrier_id, product_code, advance_months, advance_pct_bp, effective_from").eq("tenant_id", tenantId)),
  ]);
  if (policies.error) throw new Error(`Could not load the policies: ${policies.error.message}`);
  if (families.error) {
    if (isSchemaGap(families.error)) return null;
    throw new Error(`Could not load the product families: ${families.error.message}`);
  }

  // Settings: the agency's own value for each field, else the platform's.
  const trigger = new Map<string, { trigger: Trigger | null; lagDays: number | null }>();
  for (const carrier of new Set<string>(((settings.data ?? []) as Loose[]).map((s) => s.carrier_id as string))) {
    const own = (settings.data ?? []).find((s: Loose) => s.carrier_id === carrier && s.tenant_id === tenantId);
    const platform = (settings.data ?? []).find((s: Loose) => s.carrier_id === carrier && s.tenant_id === null);
    trigger.set(carrier, { trigger: own?.commission_trigger ?? platform?.commission_trigger ?? null, lagDays: own?.expected_lag_days ?? platform?.expected_lag_days ?? null });
  }
  const level = new Map<string, number>();
  for (const row of [...(levels.data ?? [])].sort((a: Loose, b: Loose) => String(a.effective_from).localeCompare(String(b.effective_from)))) level.set(row.carrier_id, row.contract_level_bp);
  const family = new Map<string, string>();
  for (const row of [...(families.data ?? [])].sort((a: Loose, b: Loose) => (a.tenant_id ? 1 : 0) - (b.tenant_id ? 1 : 0))) family.set(`${row.carrier_id}|${row.carrier_product_code}`, row.product_code); // the agency's own wins
  const bandsOf = new Map<string, Loose[]>();
  for (const band of bands) bandsOf.set(band.schedule_id, [...(bandsOf.get(band.schedule_id) ?? []), band]);
  const schedulesByCarrier = new Map<string, Schedule[]>();
  for (const s of schedules.data ?? []) {
    const schedule: Schedule = { id: s.id, productCode: s.product_code, levelBp: s.contract_level_bp, policyYear: s.policy_year, appliesOnward: Boolean(s.applies_onward), rateBp: s.rate_bp, effectiveFrom: s.effective_from, bands: (bandsOf.get(s.id) ?? []).map((b) => ({ id: b.id, ageMin: b.age_min, ageMax: b.age_max, rateBp: b.rate_bp })) };
    schedulesByCarrier.set(s.carrier_id, [...(schedulesByCarrier.get(s.carrier_id) ?? []), schedule]);
  }
  const advanceByCarrier = new Map<string, AdvanceRule[]>();
  for (const a of advance.data ?? []) advanceByCarrier.set(a.carrier_id, [...(advanceByCarrier.get(a.carrier_id) ?? []), { productCode: a.product_code, advanceMonths: a.advance_months, advancePctBp: a.advance_pct_bp, effectiveFrom: a.effective_from }]);
  return { policies: policies.rows, trigger, level, family, schedulesByCarrier, advanceByCarrier };
}

/** Insured ages (from the linked client's date of birth, at the effective date) and first-draft days. */
async function dobOf(tenantId: string, policies: Loose[]) {
  const contactIds = [...new Set(policies.map((p) => p.contact_id).filter(Boolean))] as string[];
  const contacts = contactIds.length ? (await Promise.all(chunks(contactIds, 200).map((ids) => db().from("contacts").select("id, dob").eq("tenant_id", tenantId).in("id", ids)))).flatMap((r: Loose) => r.data ?? []) : [];
  return new Map<string, string | null>(contacts.map((c: Loose) => [c.id, c.dob]));
}
async function perPolicy(tenantId: string, policies: Loose[]) {
  // The two reads need nothing of each other: together.
  const [dob, changes] = await Promise.all([
    dobOf(tenantId, policies),
    everyRow(() => db().from("policy_change").select("carrier_id, policy_number, old_value, new_value, to_snapshot_date").eq("tenant_id", tenantId).eq("field_name", "paid_to_date").order("to_snapshot_date").order("detected_at").order("id")),
  ]);
  const byPolicy = new Map<string, Array<{ oldValue: string | null; newValue: string | null; toSnapshotDate: string }>>();
  for (const c of changes.rows) byPolicy.set(`${c.carrier_id}|${c.policy_number}`, [...(byPolicy.get(`${c.carrier_id}|${c.policy_number}`) ?? []), { oldValue: c.old_value, newValue: c.new_value, toSnapshotDate: c.to_snapshot_date }]);
  return { dob, byPolicy };
}

const ISSUED = new Set(["approved_unpaid", "active", "at_risk", "lapsed", "not_taken", "paid_up"]);

/**
 * Write the expected rows for an agency (or one carrier of it). Rows with a figure are never
 * rewritten (the database refuses); a no-rate row is filled in once a rate exists.
 */
export async function computeExpected(tenantId: string, carrierId?: string): Promise<{ available: boolean; rows: number; inserted: number; filled: number }> {
  const data = await inputs(tenantId, carrierId);
  if (!data) return { available: false, rows: 0, inserted: 0, filled: 0 };
  const { dob, byPolicy } = await perPolicy(tenantId, data.policies);
  const rows: ExpectedRow[] = [];
  for (const p of data.policies) {
    if (!ISSUED.has(p.status_normalized)) continue; // nothing is owed on an application
    const setting = data.trigger.get(p.carrier_id) ?? { trigger: null, lagDays: null };
    if (!setting.trigger) continue;
    const triggerDay = triggerOccurredOn(setting.trigger, { issueDate: p.issue_date, issuedOn: p.issued_on, effectiveDate: p.effective_date, paidTo: p.paid_to_date, firstSeenDate: p.first_seen_date }, firstDraftDate(byPolicy.get(`${p.carrier_id}|${p.policy_number}`) ?? [], p.effective_date));
    const row = expectedFor({
      carrierId: p.carrier_id, policyNumber: p.policy_number, trigger: setting.trigger, lagDays: setting.lagDays, triggerDay,
      family: p.product_code ? data.family.get(`${p.carrier_id}|${p.product_code}`) ?? null : null, carrierProductCode: p.product_code,
      levelBp: data.level.get(p.carrier_id) ?? null, age: ageOn(p.contact_id ? dob.get(p.contact_id) ?? null : null, p.effective_date),
      annualPremiumCents: p.annualised_premium_cents === null ? null : Number(p.annualised_premium_cents),
      schedules: data.schedulesByCarrier.get(p.carrier_id) ?? [], advanceRules: data.advanceByCarrier.get(p.carrier_id) ?? [],
    });
    if (row) rows.push(row);
  }
  let inserted = 0;
  let filled = 0;
  for (const batch of chunks(rows, 500)) {
    const { data: result, error } = await db().rpc("record_expected_commission", { p_tenant_id: tenantId, p_rows: batch });
    if (error) {
      if (isSchemaGap(error)) return { available: false, rows: rows.length, inserted, filled };
      throw new Error(`Could not record expected commission: ${error.message}`);
    }
    inserted += Number(result?.inserted ?? 0);
    filled += Number(result?.filled ?? 0);
  }
  return { available: true, rows: rows.length, inserted, filled };
}

export type RateCardCarrier = {
  carrierId: string; carrierName: string; policies: number; monthlyCents: number; pricedMonthlyCents: number; pricedPolicies: number;
  trigger: Trigger | null; lagDays: number | null; levelBp: number | null; writingNumber: string | null;
  schedules: Array<Schedule & { familyName: string }>; unmapped: Array<{ code: string; policies: number }>; mapped: Array<{ code: string; family: string; own: boolean }>;
  reasons: Array<{ reason: string; policies: number }>;
  /** Advance rules by product family, newest first: how much is paid up front and for how long it can come back. */
  advanceRules: Array<{ productCode: string; familyName: string; advanceMonths: number; advancePctBp: number; clawbackMonths: number; clawbackType: "full" | "prorated"; effectiveFrom: string }>;
};

/** The rate card screen: per carrier in the book, what is set, what is missing, and how much of the book that leaves unpriced. */
export async function loadRateCard(tenantId: string) {
  // The screen's own reads (and the agency's day) need none of the calculation's inputs: read beside
  // them. The no-op catch only stops a failure counting as unhandled when there are no inputs to use
  // them with; they are awaited (and throw) below, after the inputs, as before.
  const screen = Promise.all([
    db().from("carriers").select("id, name"),
    db().from("products").select("code, name").eq("is_active", true).order("sort_order"),
    db().from("carrier_product_family").select("carrier_id, carrier_product_code").eq("tenant_id", tenantId),
    everyRow(() => db().from("expected_commission").select("carrier_id, confidence, expected_amount_cents, overdue_from").eq("tenant_id", tenantId).order("carrier_id").order("policy_number").order("policy_year")),
    db().from("tenant_carriers").select("carrier_id, writing_number, effective_from").eq("tenant_id", tenantId).eq("is_active", true),
    db().from("advance_rules").select("carrier_id, product_code, advance_months, advance_pct_bp, clawback_months, clawback_type, effective_from").eq("tenant_id", tenantId).order("effective_from", { ascending: false }),
  ]);
  const dayRead = agencyToday(tenantId);
  screen.catch(() => undefined);
  dayRead.catch(() => undefined);
  const data = await inputs(tenantId);
  if (!data) return { available: false as const };
  const [carriers, products, ownFamilies, expected, contracts, rules] = await screen;
  const writing = new Map<string, string>();
  for (const row of [...(contracts.data ?? [])].sort((a: Loose, b: Loose) => String(a.effective_from).localeCompare(String(b.effective_from)))) writing.set(row.carrier_id, row.writing_number);
  // Only the dates of birth are used here (the first-draft days are the writer's, computeExpected).
  const dob = await dobOf(tenantId, data.policies);
  const carrierName = new Map<string, string>((carriers.data ?? []).map((c: Loose) => [c.id, c.name]));
  const productName = new Map<string, string>((products.data ?? []).map((p: Loose) => [p.code, p.name]));
  const own = new Set((ownFamilies.data ?? []).map((f: Loose) => `${f.carrier_id}|${f.carrier_product_code}`));
  const today = await dayRead;
  const byCarrier = new Map<string, RateCardCarrier>();
  const priced: Array<{ carrierId: string; monthlyCents: number; priced: boolean }> = [];
  for (const p of data.policies) {
    if (!ISSUED.has(p.status_normalized)) continue;
    const entry: RateCardCarrier = byCarrier.get(p.carrier_id) ?? {
      carrierId: p.carrier_id, carrierName: carrierName.get(p.carrier_id) ?? "Carrier not known", policies: 0, monthlyCents: 0, pricedMonthlyCents: 0, pricedPolicies: 0,
      trigger: data.trigger.get(p.carrier_id)?.trigger ?? null, lagDays: data.trigger.get(p.carrier_id)?.lagDays ?? null, levelBp: data.level.get(p.carrier_id) ?? null, writingNumber: writing.get(p.carrier_id) ?? null,
      schedules: (data.schedulesByCarrier.get(p.carrier_id) ?? []).map((s) => ({ ...s, familyName: productName.get(s.productCode) ?? s.productCode })), unmapped: [], mapped: [], reasons: [],
      advanceRules: ((rules.data ?? []) as Loose[]).filter((r) => r.carrier_id === p.carrier_id).map((r) => ({ productCode: r.product_code, familyName: productName.get(r.product_code) ?? r.product_code, advanceMonths: r.advance_months, advancePctBp: r.advance_pct_bp, clawbackMonths: r.clawback_months, clawbackType: r.clawback_type, effectiveFrom: r.effective_from })),
    };
    const monthly = Math.floor(Number(p.annualised_premium_cents ?? 0) / 12);
    const family = p.product_code ? data.family.get(`${p.carrier_id}|${p.product_code}`) ?? null : null;
    // Priced means the rate card can price it today, whatever its trigger: the coverage the spec asks for.
    const rate = resolveRate({ schedules: data.schedulesByCarrier.get(p.carrier_id) ?? [], family, carrierProductCode: p.product_code, levelBp: data.level.get(p.carrier_id) ?? null, policyYear: 1, onDay: today, age: ageOn(p.contact_id ? dob.get(p.contact_id) ?? null : null, p.effective_date) });
    const ok = rate.confidence !== "no_rate_card" && p.annualised_premium_cents !== null;
    entry.policies++;
    entry.monthlyCents += monthly;
    if (ok) { entry.pricedPolicies++; entry.pricedMonthlyCents += monthly; }
    else {
      const reason = p.annualised_premium_cents === null ? "the carrier's file gives no premium" : rate.confidence === "no_rate_card" ? rate.reason : "";
      const known = entry.reasons.find((r) => r.reason === reason);
      if (known) known.policies++; else entry.reasons.push({ reason, policies: 1 });
    }
    if (p.product_code && !family) {
      const known = entry.unmapped.find((u) => u.code === p.product_code);
      if (known) known.policies++; else entry.unmapped.push({ code: p.product_code, policies: 1 });
    }
    if (p.product_code && family && !entry.mapped.some((m) => m.code === p.product_code)) entry.mapped.push({ code: p.product_code, family, own: own.has(`${p.carrier_id}|${p.product_code}`) });
    byCarrier.set(p.carrier_id, entry);
    priced.push({ carrierId: p.carrier_id, monthlyCents: monthly, priced: ok });
  }
  // A carrier you're contracted with is on the card before its first file, so its rates and advance
  // rule can be set ahead (they used to live only in Settings › Carrier library).
  for (const contract of (contracts.data ?? []) as Loose[]) {
    if (byCarrier.has(contract.carrier_id)) continue;
    byCarrier.set(contract.carrier_id, {
      carrierId: contract.carrier_id, carrierName: carrierName.get(contract.carrier_id) ?? "Carrier not known", policies: 0, monthlyCents: 0, pricedMonthlyCents: 0, pricedPolicies: 0,
      trigger: data.trigger.get(contract.carrier_id)?.trigger ?? null, lagDays: data.trigger.get(contract.carrier_id)?.lagDays ?? null, levelBp: data.level.get(contract.carrier_id) ?? null, writingNumber: writing.get(contract.carrier_id) ?? null,
      schedules: (data.schedulesByCarrier.get(contract.carrier_id) ?? []).map((s) => ({ ...s, familyName: productName.get(s.productCode) ?? s.productCode })), unmapped: [], mapped: [], reasons: [],
      advanceRules: ((rules.data ?? []) as Loose[]).filter((r) => r.carrier_id === contract.carrier_id).map((r) => ({ productCode: r.product_code, familyName: productName.get(r.product_code) ?? r.product_code, advanceMonths: r.advance_months, advancePctBp: r.advance_pct_bp, clawbackMonths: r.clawback_months, clawbackType: r.clawback_type, effectiveFrom: r.effective_from })),
    });
  }
  const rows = [...byCarrier.values()].sort((a, b) => b.monthlyCents - a.monthlyCents || a.carrierName.localeCompare(b.carrierName));
  for (const row of rows) row.reasons.sort((a, b) => b.policies - a.policies);
  const expectedRows = expected.error ? [] : expected.rows;
  return {
    available: true as const,
    carriers: rows,
    coverage: coverage(priced),
    expected: {
      available: !expected.error,
      priced: expectedRows.filter((r: Loose) => r.confidence !== "no_rate_card").length,
      unpriced: expectedRows.filter((r: Loose) => r.confidence === "no_rate_card").length,
      dueCents: expectedRows.filter((r: Loose) => r.confidence !== "no_rate_card").reduce((sum: number, r: Loose) => sum + Number(r.expected_amount_cents ?? 0), 0),
      pastLag: expectedRows.filter((r: Loose) => r.confidence !== "no_rate_card" && r.overdue_from && r.overdue_from <= today).length,
    },
    products: (products.data ?? []) as Array<{ code: string; name: string }>,
  };
}

/** The expected row(s) of one policy, for its page. */
export async function loadPolicyExpected(tenantId: string, carrierId: string, policyNumber: string) {
  const { data, error } = await db().from("expected_commission").select("*").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).order("policy_year");
  if (error) {
    if (isSchemaGap(error)) return { available: false as const, rows: [] as Loose[] };
    throw new Error(`Could not load the expected commission: ${error.message}`);
  }
  return { available: true as const, rows: (data ?? []) as Loose[] };
}

/** An agency's own mapping of a carrier product code to a product family; blank clears it. */
export async function saveProductFamily(tenantId: string, userId: string, input: { carrierId: string; carrierProductCode: string; productCode: string | null }) {
  const code = input.carrierProductCode.trim();
  if (!input.productCode) {
    const { error } = await db().from("carrier_product_family").delete().eq("tenant_id", tenantId).eq("carrier_id", input.carrierId).eq("carrier_product_code", code);
    if (error) throw new Error(`Could not clear the product family: ${error.message}`);
    return;
  }
  const existing = await db().from("carrier_product_family").select("id").eq("tenant_id", tenantId).eq("carrier_id", input.carrierId).eq("carrier_product_code", code).maybeSingle();
  const write = existing.data
    ? await db().from("carrier_product_family").update({ product_code: input.productCode, updated_by: userId, updated_at: new Date().toISOString() }).eq("id", existing.data.id)
    : await db().from("carrier_product_family").insert({ tenant_id: tenantId, carrier_id: input.carrierId, carrier_product_code: code, product_code: input.productCode, updated_by: userId });
  if (write.error) {
    if (isSchemaGap(write.error)) throw new RateCardError(EXPECTED_PENDING_MESSAGE, 503);
    throw new Error(`Could not save the product family: ${write.error.message}`);
  }
}

/** Age bands for one of the agency's own schedule rows. */
export async function addBand(tenantId: string, input: { scheduleId: string; ageMin: number; ageMax: number; rateBp: number }) {
  const { data: schedule } = await db().from("commission_schedules").select("id").eq("tenant_id", tenantId).eq("id", input.scheduleId).maybeSingle();
  if (!schedule) throw new RateCardError("That rate is not on your rate card.", 404);
  const { error } = await db().from("commission_schedule_band").insert({ schedule_id: input.scheduleId, age_min: input.ageMin, age_max: input.ageMax, rate_bp: input.rateBp });
  if (error) {
    if (error.code === "23P01") throw new RateCardError("That age band overlaps one this rate already has.", 409);
    if (isSchemaGap(error)) throw new RateCardError(EXPECTED_PENDING_MESSAGE, 503);
    throw new Error(`Could not save the age band: ${error.message}`);
  }
}

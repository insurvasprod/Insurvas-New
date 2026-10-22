import "server-only";

import { applicationKeyConfigured, decryptSensitive, encryptSensitive } from "@/lib/applications/crypto";
import { csvCell } from "@/lib/csv/cell";
import { mapLimit } from "@/lib/retention/batch";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { BusinessIdentityMissingError, requireBusinessIdentity } from "@/lib/agencyProfile/identity";
import { maskTaxId } from "@/lib/agencyProfile/types";

import { fromRow } from "./settingsCore";
import { commissionTaxKey, contractorReport, normaliseTaxId, TAX_CATEGORY_LABELS, TAX_NOTICE, type ExemptReason, type Payee, type TaxCategory } from "./taxCore";

/**
 * LA-7.8 (Notion sprint, Module 7 — Accounting) · 1099 figures and the tax-ready export, server
 * side (20261015270000). Tax IDs are encrypted with the application data key, bound to the payee's
 * profile row, masked by default; a reveal is allowed only to the roles the agency chose (owner by
 * default) and writes one audit row each time.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();
const FIELD = "payee.tax_id";

export const TAX_PENDING_MESSAGE = "Tax summaries need a database update (20261015200000–20261015270000).";

export class TaxError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function fail(error: { code?: string; message: string }): never {
  if (isSchemaGap(error) || error.code === "PGRST202" || error.code === "42883") throw new TaxError(TAX_PENDING_MESSAGE, 503);
  if (error.code === "22023" || error.code === "23514" || error.code === "P0001") throw new TaxError(error.message.replace(/^\w+: /, ""), 400);
  throw new Error(error.message);
}

export async function taxSettings(tenantId: string) {
  const { data } = await db().from("accounting_settings").select("tax_1099_threshold_cents, tax_id_viewer_roles, default_basis").eq("tenant_id", tenantId).maybeSingle();
  const s = fromRow(data);
  return { thresholdCents: s.tax1099ThresholdCents, viewerRoles: s.taxIdViewerRoles as string[], basis: s.defaultBasis };
}

async function payeeNames(tenantId: string) {
  const [partners, vendors, members] = await Promise.all([
    db().from("partners").select("id, name").eq("tenant_id", tenantId),
    db().from("tenant_lead_vendors").select("id, name").eq("tenant_id", tenantId),
    db().from("tenant_users").select("user_id, users!inner(name, email)").eq("tenant_id", tenantId),
  ]);
  const names = new Map<string, string>();
  for (const p of (partners.data ?? []) as Loose[]) names.set(`partner|${p.id}`, p.name);
  for (const v of (vendors.data ?? []) as Loose[]) names.set(`vendor|${v.id}`, v.name);
  for (const m of (members.data ?? []) as Loose[]) names.set(`producer|${m.user_id}`, m.users?.name ?? m.users?.email ?? "Producer");
  return names;
}

/** The year's contractor payments, with each payee's tax profile (masked). */
export async function contractors(tenantId: string, year: number) {
  const [paid, profiles, names, settings] = await Promise.all([
    db().rpc("contractor_payments", { p_tenant_id: tenantId, p_year: year }),
    db().from("payee_tax_profile").select("id, payee_type, payee_id, legal_name, tax_id_type, tax_id_last4, entity_type, address_line1, address_line2, city, state, postal_code, country, w9_on_file, exempt_reason").eq("tenant_id", tenantId),
    payeeNames(tenantId),
    taxSettings(tenantId),
  ]);
  if (paid.error) fail(paid.error);
  if (profiles.error) fail(profiles.error);
  const profileOf = new Map<string, Loose>(((profiles.data ?? []) as Loose[]).map((p) => [`${p.payee_type}|${p.payee_id}`, p]));
  const payees: (Payee & { profileId: string | null; address: string | null; entityType: string | null })[] = ((paid.data ?? []) as Loose[]).map((r) => {
    const key = `${r.payee_type}|${r.payee_id}`;
    const p = profileOf.get(key);
    return {
      payeeType: r.payee_type, payeeId: r.payee_id, displayName: names.get(key) ?? "Payee", paidCents: Number(r.paid_cents), profileId: p?.id ?? null, entityType: p?.entity_type ?? null,
      address: p ? [p.address_line1, p.address_line2, p.city, p.state, p.postal_code].filter(Boolean).join(", ") || null : null,
      profile: p ? { legalName: p.legal_name, taxIdType: p.tax_id_type, taxIdLast4: p.tax_id_last4, w9OnFile: !!p.w9_on_file, exemptReason: p.exempt_reason as ExemptReason | null } : null,
    };
  });
  return { year, ...contractorReport(payees, settings.thresholdCents), payees };
}

export type ProfileInput = {
  payeeType: "partner" | "producer" | "vendor"; payeeId: string; legalName: string | null; taxIdType: "ein" | "ssn" | "foreign" | "none"; taxId: string | null;
  entityType: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null; postalCode: string | null; country: string;
  w9OnFile: boolean; exemptReason: ExemptReason | null;
};

/** Save a payee's tax details. A new tax ID is encrypted here; leaving it blank keeps the one on file. */
export async function saveProfile(tenantId: string, by: string, input: ProfileInput): Promise<string> {
  const names = await payeeNames(tenantId);
  if (!names.has(`${input.payeeType}|${input.payeeId}`)) throw new TaxError("That payee isn't in this agency.", 404);
  const { data: existing } = await db().from("payee_tax_profile").select("id").eq("tenant_id", tenantId).eq("payee_type", input.payeeType).eq("payee_id", input.payeeId).maybeSingle();
  const id: string = existing?.id ?? crypto.randomUUID();
  const row: Record<string, unknown> = {
    id, tenant_id: tenantId, payee_type: input.payeeType, payee_id: input.payeeId, legal_name: input.legalName?.trim() || null, tax_id_type: input.taxIdType,
    entity_type: input.entityType, address_line1: input.addressLine1?.trim() || null, address_line2: input.addressLine2?.trim() || null, city: input.city?.trim() || null,
    state: input.state?.trim() || null, postal_code: input.postalCode?.trim() || null, country: input.country || "US", w9_on_file: input.w9OnFile, exempt_reason: input.exemptReason,
    updated_by: by, updated_at: new Date().toISOString(),
  };
  if (input.taxIdType === "none") Object.assign(row, { tax_id_ciphertext: null, tax_id_key_version: null, tax_id_last4: null });
  else if (input.taxId) {
    if (!applicationKeyConfigured()) throw new TaxError("Tax IDs can't be stored until the data encryption key is configured.", 503);
    const n = normaliseTaxId(input.taxIdType, input.taxId);
    if ("error" in n) throw new TaxError(n.error);
    const enc = encryptSensitive(n.value, { tenantId, applicationId: id, fieldKey: FIELD });
    Object.assign(row, { tax_id_ciphertext: enc.ciphertext, tax_id_key_version: enc.keyVersion, tax_id_last4: n.last4 });
  }
  const res = existing
    ? await db().from("payee_tax_profile").update(row).eq("tenant_id", tenantId).eq("id", id)
    : await db().from("payee_tax_profile").insert(row);
  if (res.error) fail(res.error);
  return id;
}

/** Reveal one tax ID: only for the roles the agency allows, and one audit row per reveal. */
export async function revealTaxId(tenantId: string, userId: string, role: string, profileId: string, ip: string | null): Promise<string> {
  const settings = await taxSettings(tenantId);
  if (!settings.viewerRoles.includes(role)) throw new TaxError("Your agency has not allowed your role to see tax IDs.", 403);
  const { data: p, error } = await db().from("payee_tax_profile").select("id, tax_id_ciphertext, tax_id_key_version").eq("tenant_id", tenantId).eq("id", profileId).maybeSingle();
  if (error) fail(error);
  if (!p?.tax_id_ciphertext) throw new TaxError("No tax ID is on file.", 404);
  const { error: le } = await db().from("payee_tax_reveal_log").insert({ tenant_id: tenantId, profile_id: profileId, user_id: userId, ip });
  // No audit row, no reveal.
  if (le) fail(le);
  const value = decryptSensitive(p.tax_id_ciphertext, p.tax_id_key_version, { tenantId, applicationId: profileId, fieldKey: FIELD });
  if (!value) throw new TaxError("The tax ID could not be read.", 500);
  return value;
}

export type CategoryRow = { taxCategory: TaxCategory; sourceType: string; sourceValue: string; amountCents: number; entries: number };

export async function categoryTotals(tenantId: string, year: number, basis: "cash" | "accrual"): Promise<CategoryRow[]> {
  const { data, error } = await db().rpc("tax_category_totals", { p_tenant_id: tenantId, p_from: `${year}-01-01`, p_to: `${year + 1}-01-01`, p_basis: basis });
  if (error) fail(error);
  return ((data ?? []) as Loose[]).map((r) => ({ taxCategory: r.tax_category, sourceType: r.source_type, sourceValue: r.source_value, amountCents: Number(r.amount_cents), entries: Number(r.entries) }));
}

/** The agency's mapping: each source type and value, the bucket it lands in, and whether that is the shipped default. */
export async function categoryMap(tenantId: string) {
  const { data, error } = await db().from("tax_category_map").select("tenant_id, source_type, source_value, tax_category").or(`tenant_id.is.null,tenant_id.eq.${tenantId}`);
  if (error) fail(error);
  const rows = (data ?? []) as Loose[];
  const defaults = rows.filter((r) => !r.tenant_id);
  return defaults.map((d) => {
    const o = rows.find((r) => r.tenant_id && r.source_type === d.source_type && r.source_value === d.source_value);
    return { sourceType: d.source_type as string, sourceValue: d.source_value as string, defaultCategory: d.tax_category as TaxCategory, category: (o?.tax_category ?? d.tax_category) as TaxCategory, overridden: !!o };
  });
}

/**
 * An override of one mapping; choosing the default again removes the override. One database
 * transaction (set_tax_category_override, 20261015620000) writes the mapping and its audit row
 * (accounting_setting_change: who, from, to) together. Never touches published runs.
 */
export async function setCategory(tenantId: string, by: string, sourceType: string, sourceValue: string, category: TaxCategory): Promise<{ from: TaxCategory; to: TaxCategory; changed: boolean }> {
  const { data, error } = await db().rpc("set_tax_category_override", { p_tenant_id: tenantId, p_source_type: sourceType, p_source_value: sourceValue, p_category: category, p_by: by });
  if (error) {
    if (error.code === "P0002") throw new TaxError("Unknown source.", 404);
    fail(error);
  }
  return data as { from: TaxCategory; to: TaxCategory; changed: boolean };
}

const dollars = (c: number) => { const d = String(Math.abs(c)).padStart(3, "0"); return `${c < 0 ? "-" : ""}${d.slice(0, -2)}.${d.slice(-2)}`; };

/** Every transaction of the year with its bucket (paged past the API's row cap). */
async function transactions(tenantId: string, year: number, basis: "cash" | "accrual") {
  const col = basis === "cash" ? "paid_on" : "incurred_on";
  const rows: Loose[] = [];
  // The category map is read beside the (in-order) pages; a failure is still reported map first.
  const [mapRead, pageRead] = await Promise.allSettled([categoryMap(tenantId), (async () => {
    for (let from = 0; from < 100_000; from += 1000) {
      const { data, error } = await db().from("money_entry").select("side, entry_id, entry_type, amount_cents, incurred_on, paid_on, description, policy_number, expense_id").eq("tenant_id", tenantId)
        .gte(col, `${year}-01-01`).lt(col, `${year + 1}-01-01`).order(col).order("entry_id").range(from, from + 999);
      if (error) fail(error);
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
  })()]);
  if (mapRead.status === "rejected") throw mapRead.reason;
  if (pageRead.status === "rejected") throw pageRead.reason;
  const map = mapRead.value;
  const bucket = new Map(map.map((m) => [`${m.sourceType}|${m.sourceValue}`, m.category]));
  const expenseIds = [...new Set(rows.map((r) => r.expense_id).filter(Boolean))];
  const categories = new Map<string, string>();
  // What each commission correction corrects (the money view does not carry it): a reversal is
  // bucketed as what it reverses, and held money — reversed or not — is not income.
  const corrects = new Map<string, string | null>();
  const reversalIds = rows.filter((r) => r.side === "commission" && r.entry_type === "reversal").map((r) => r.entry_id as string);
  // Expense categories and corrections are independent chunked reads: a few at a time, folded in the old order.
  const starts = (n: number) => Array.from({ length: Math.ceil(n / 200) }, (_, k) => k * 200);
  const [expenseReads, correctReads] = await Promise.all([
    mapLimit(starts(expenseIds.length), 6, (i) => db().from("expense").select("id, category").in("id", expenseIds.slice(i, i + 200))),
    mapLimit(starts(reversalIds.length).flatMap((i) => ["commission_entry", "commission_account_entry"].map((table) => ({ i, table }))), 6, ({ i, table }) => db().from(table).select("id, corrects_type").in("id", reversalIds.slice(i, i + 200))),
  ]);
  for (const { data } of expenseReads as Loose[]) for (const e of (data ?? []) as Loose[]) categories.set(e.id, e.category);
  for (const { data, error } of correctReads as Loose[]) {
    if (error) fail(error);
    for (const c of (data ?? []) as Loose[]) corrects.set(c.id, c.corrects_type ?? null);
  }
  const out: { date: string; side: string; type: string; description: string; amountCents: number; category: TaxCategory }[] = [];
  for (const r of rows) {
    let category: TaxCategory;
    if (r.side === "commission") {
      const k = commissionTaxKey(r.entry_type, corrects.get(r.entry_id) ?? null, Number(r.amount_cents));
      if (!k) continue;
      category = k.forced ?? bucket.get(`commission_entry_type|${k.sourceValue}`) ?? "other";
    } else {
      category = bucket.get(r.expense_id ? `expense_category|${categories.get(r.expense_id)}` : `cost_entry_type|${r.entry_type}`) ?? "other";
    }
    out.push({ date: (basis === "cash" ? r.paid_on : r.incurred_on) as string, side: r.side as string, type: r.entry_type as string, description: (r.description ?? (r.policy_number ? `Policy ${r.policy_number}` : "")) as string, amountCents: Number(r.amount_cents), category });
  }
  return out;
}

/** The year as an accountant works from it: totals, every transaction with its bucket, contractor payments. */
export async function taxExport(tenantId: string, year: number, format: "xlsx" | "csv", sheet: "totals" | "transactions" | "contractors" = "totals") {
  // LA-8.3: the summary is filed under the legal name and tax ID, so it is not built without them.
  const payer = await requireBusinessIdentity(tenantId, "tax_export").catch((error: unknown) => {
    if (error instanceof BusinessIdentityMissingError) throw new TaxError(error.message, error.status);
    throw error;
  });
  const settings = await taxSettings(tenantId);
  const [totals, txns, people] = await Promise.all([categoryTotals(tenantId, year, settings.basis), transactions(tenantId, year, settings.basis), contractors(tenantId, year)]);
  const byCategory = new Map<TaxCategory, number>();
  for (const t of totals) byCategory.set(t.taxCategory, (byCategory.get(t.taxCategory) ?? 0) + t.amountCents);
  // Who the figures are for: the legal name, the tax ID masked (never in full in a file), the address.
  const header = [[TAX_NOTICE], [`Summary of recorded transactions for ${year}, ${settings.basis} basis. Not a tax return.`],
    [`${payer.legalName ?? ""} · ${payer.taxIdType === "ssn" ? "SSN" : "EIN"} ${maskTaxId(payer.taxIdType, payer.taxIdLast4)}`], ...(payer.addressLines.length ? [[payer.addressLines.join(", ")]] : []), []];
  const sheets: Record<string, unknown[][]> = {
    Totals: [...header, ["Category", "Amount"], ...[...byCategory.entries()].map(([k, v]) => [TAX_CATEGORY_LABELS[k] ?? k, dollars(v)])],
    Transactions: [...header, ["Date", "Kind", "Type", "Description", "Category", "Amount"], ...txns.map((t) => [t.date, t.side, t.type, t.description, TAX_CATEGORY_LABELS[t.category] ?? t.category, dollars(t.amountCents)])],
    Contractors: [...header, [`Paid in ${year} (cash, by payment date). The 1099 threshold used: ${dollars(people.thresholdCents)}.`], ["Name on the form", "Payee", "Tax ID", "Paid", "Requires a 1099", "Exempt", "Missing"],
      ...[...people.rows, ...people.under].map((r) => [r.nameOnForm, r.payeeType, r.profile?.taxIdLast4 ? `••••${r.profile.taxIdLast4}` : "", dollars(r.paidCents), r.requires ? "Yes" : "No", r.exempt ?? "", r.missing.join(", ")])],
  };
  if (format === "csv") {
    const name = sheet === "transactions" ? "Transactions" : sheet === "contractors" ? "Contractors" : "Totals";
    return { filename: `tax-${year}-${sheet}.csv`, contentType: "text/csv; charset=utf-8", body: sheets[name].map((r) => r.map(csvCell).join(",")).join("\r\n") };
  }
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) wb.addWorksheet(name).addRows(rows);
  return { filename: `tax-${year}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: Buffer.from(await wb.xlsx.writeBuffer()) };
}

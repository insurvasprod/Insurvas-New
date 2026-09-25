/**
 * What the carrier library's rows mean, once — shared by Settings › Carrier library and the
 * Agency profile tiles so the two never count a "contract" differently. Plain module: no
 * server-only imports, safe for client components.
 *
 * The schema's shape, which the words follow:
 *   · a carrier's contract level lives on tenant_carriers, one active row per carrier;
 *   · commission rates live on commission_schedules, keyed by carrier, product, contract level and
 *     policy year, each row effective-dated;
 *   · advance rules are keyed by carrier and product, effective-dated.
 * A "product contract" is therefore a carrier with an active contract plus a product that has a
 * schedule at that carrier's current level, or an advance rule.
 */
import type { CommissionScheduleRow } from "./service-types";
import { resolveCommissionRate } from "./resolve";
import { dayMonthYear, viewerTimeZone, zonedParts } from "../format/dates";

export type TenantCarrierLike = { id: string; carrier_id: string; contract_level_bp: number; writing_number: string; effective_from: string; is_active: boolean };
export type AdvanceRuleLike = { id: string; carrier_id: string; product_code: string; advance_months: number; advance_pct_bp: number; clawback_months: number; clawback_type: "full" | "prorated"; effective_from: string };
export type LibraryLike = {
  carriers: Array<{ id: string; name: string }>;
  products: Array<{ code: string; name: string }>;
  tenantCarriers: TenantCarrierLike[];
  commissionSchedules: CommissionScheduleRow[];
  advanceRules: AdvanceRuleLike[];
  /** Migration 20260924220100; absent or empty before it. */
  carrierRequirements?: Array<{ carrier_id: string; requires_eo: boolean }>;
  requirementsAvailable?: boolean;
};

export type ContractRow = {
  key: string;
  carrierId: string;
  carrierName: string;
  /** null: the carrier has a contract but no product has a schedule or an advance rule yet. */
  productCode: string | null;
  productName: string | null;
  levelBp: number;
  effectiveFrom: string;
  hasSchedule: boolean;
  hasRule: boolean;
};

export const todayIso = () => new Date().toISOString().slice(0, 10);

export function activeContract(tenantCarriers: TenantCarrierLike[], carrierId: string) {
  return tenantCarriers.find((row) => row.carrier_id === carrierId && row.is_active) ?? null;
}

/** Table rows for "Carriers & contract levels", in library order then product order. */
export function buildContractRows(library: LibraryLike): ContractRow[] {
  const productOrder = new Map(library.products.map((product, index) => [product.code, index]));
  const productName = new Map(library.products.map((product) => [product.code, product.name]));
  const rows: ContractRow[] = [];
  for (const carrier of library.carriers) {
    const contract = activeContract(library.tenantCarriers, carrier.id);
    if (!contract) continue;
    const scheduled = new Set(library.commissionSchedules.filter((row) => row.carrier_id === carrier.id && row.contract_level_bp === contract.contract_level_bp).map((row) => row.product_code));
    const ruled = new Set(library.advanceRules.filter((row) => row.carrier_id === carrier.id).map((row) => row.product_code));
    const codes = [...new Set([...scheduled, ...ruled])].sort((a, b) => (productOrder.get(a) ?? 999) - (productOrder.get(b) ?? 999) || a.localeCompare(b));
    const base = { carrierId: carrier.id, carrierName: carrier.name, levelBp: contract.contract_level_bp, effectiveFrom: contract.effective_from };
    if (codes.length === 0) {
      rows.push({ ...base, key: `${carrier.id}:`, productCode: null, productName: null, hasSchedule: false, hasRule: false });
      continue;
    }
    for (const code of codes) {
      rows.push({ ...base, key: `${carrier.id}:${code}`, productCode: code, productName: productName.get(code) ?? code, hasSchedule: scheduled.has(code), hasRule: ruled.has(code) });
    }
  }
  return rows;
}

export type LibrarySummary = {
  activeCarriers: number;
  libraryCarriers: number;
  productContracts: number;
  contractCarriers: number;
  /** Product contracts with at least one commission rate at the current level. */
  schedules: number;
  /** Active carriers with no advance rule for any product. */
  carriersWithoutAdvanceRule: Array<{ carrierId: string; carrierName: string }>;
};

export function summarizeLibrary(library: LibraryLike): LibrarySummary {
  const rows = buildContractRows(library);
  const products = rows.filter((row) => row.productCode !== null);
  const active = library.carriers.filter((carrier) => activeContract(library.tenantCarriers, carrier.id));
  return {
    activeCarriers: active.length,
    libraryCarriers: library.carriers.length,
    productContracts: products.length,
    contractCarriers: new Set(products.map((row) => row.carrierId)).size,
    schedules: products.filter((row) => row.hasSchedule).length,
    carriersWithoutAdvanceRule: active
      .filter((carrier) => !library.advanceRules.some((rule) => rule.carrier_id === carrier.id))
      .map((carrier) => ({ carrierId: carrier.id, carrierName: carrier.name })),
  };
}

export type ScheduleBand = { from: number; to: number | null; rateBp: number };

/**
 * The schedule in force on `asOf` for one carrier/product/level, as the board draws it: one line per
 * run of consecutive years at the same rate ("Years 3–10"), and an open-ended row as "Year 11+".
 */
export function scheduleBands(rows: CommissionScheduleRow[], input: { carrierId: string; productCode: string; contractLevelBp: number; asOf: string }): ScheduleBand[] {
  const years = [...new Set(rows.filter((row) => row.carrier_id === input.carrierId && row.product_code === input.productCode && row.contract_level_bp === input.contractLevelBp && row.effective_from <= input.asOf).map((row) => row.policy_year))].sort((a, b) => a - b);
  const bands: ScheduleBand[] = [];
  for (const year of years) {
    const row = resolveCommissionRate(rows, { ...input, policyYear: year });
    if (!row || row.policy_year !== year) continue;
    const onward = row.applies_onward === true;
    const last = bands[bands.length - 1];
    if (last && last.to === year - 1 && last.rateBp === row.rate_bp) {
      last.to = onward ? null : year;
    } else {
      bands.push({ from: year, to: onward ? null : year, rateBp: row.rate_bp });
    }
  }
  return bands;
}

export function bandLabel(band: ScheduleBand) {
  if (band.to === null) return `Year ${band.from}+`;
  return band.from === band.to ? `Year ${band.from}` : `Years ${band.from}–${band.to}`;
}

/** The advance rule in force on `asOf` for a carrier/product. */
export function currentAdvanceRule<T extends AdvanceRuleLike>(rules: T[], carrierId: string, productCode: string, asOf: string): T | null {
  return rules.filter((rule) => rule.carrier_id === carrierId && rule.product_code === productCode && rule.effective_from <= asOf).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;
}

export const formatBps = (bp: number) => `${bp.toLocaleString("en-US")} bps`;
export const formatPercentFromBps = (bp: number) => `${(bp / 100).toFixed(2)}%`;

/** "7,500 bps", "7500", "7 500" → 7500. Anything else → null. */
export function parseBps(value: string): number | null {
  const cleaned = value.replace(/bps?$/i, "").replace(/[\s,]/g, "");
  if (!/^\d{1,6}$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return n <= 100000 ? n : null;
}

/**
 * "4 Sep 2026". A calendar date is that day; a timestamp reads in `zone`, the viewer's own by default,
 * which is why both screens that use this render it only once their data has loaded after mount.
 */
export function formatDay(iso: string | null | undefined, zone = viewerTimeZone()) {
  if (!iso) return "—";
  return zonedParts(iso, zone) ? dayMonthYear(iso, zone) : iso;
}

/**
 * Contracted carriers whose contract requires E&O cover in force, by name. Null when the requirement
 * cannot be recorded yet (migration 20260924220100), so a count of zero is never shown for "unknown".
 */
export function carriersRequiringEo(library: LibraryLike): string[] | null {
  if (library.requirementsAvailable === false || !library.carrierRequirements) return null;
  const required = new Set(library.carrierRequirements.filter((row) => row.requires_eo).map((row) => row.carrier_id));
  return library.carriers.filter((carrier) => required.has(carrier.id) && activeContract(library.tenantCarriers, carrier.id)).map((carrier) => carrier.name);
}

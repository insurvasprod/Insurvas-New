/**
 * Who uses a platform carrier, in words — shared by the staff console's Carriers page (server) and
 * its client table and deactivation dialog. Plain module: no server-only imports.
 *
 * "In use" (user decision, board p-adm-carriers): a tenant with an active contract
 * (tenant_carriers.is_active) or an open appointment (not terminated, not past terminated_at).
 * Counts come from admin_carrier_usage (migration 20260924357000). Before that migration the page
 * shows "unknown" — never 0, which would read as "safe to deactivate".
 */

export type CarrierUsage = {
  carrierId: string;
  /** Distinct tenants with an active contract or an open appointment. */
  tenants: number;
  contractTenants: number;
  appointmentTenants: number;
  openAppointments: number;
  /** Every appointment row recorded against the carrier, terminated ones included. */
  appointments: number;
};

export type CarrierUsageTotals = { tenants: number; appointments: number; openAppointments: number };

/** What the page knows. `available: false` until migration 20260924357000 is applied. */
export type CarrierUsageSnapshot =
  | { available: true; byCarrier: Record<string, CarrierUsage>; totals: CarrierUsageTotals }
  | { available: false };

/**
 * What the deactivation guard counted for one carrier. Before the migration the route counts active
 * contracts and open appointments directly, but cannot count distinct tenants across the two — those
 * fields are null then, and the dialog says so rather than guessing.
 */
export type CarrierBlockingUsage = {
  tenants: number | null;
  contractTenants: number;
  appointmentTenants: number | null;
  openAppointments: number;
};

export const CARRIER_IN_USE_CODE = "carrier_in_use";
export const OVERRIDE_REASON_MIN = 10;
export const OVERRIDE_REASON_MAX = 500;
export const USAGE_UNKNOWN_TITLE = "Usage needs a database update that has not been applied yet (migration 20260924357000).";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function isInUse(usage: Pick<CarrierBlockingUsage, "tenants" | "contractTenants" | "openAppointments">): boolean {
  return (usage.tenants ?? 0) > 0 || usage.contractTenants > 0 || usage.openAppointments > 0;
}

/** The table's Usage cell: "In use by 3 tenants". */
export function usageLine(usage: CarrierUsage | null | undefined): string {
  if (!usage) return "In use by 0 tenants";
  return `In use by ${plural(usage.tenants, "tenant")}`;
}

/** Hover text for the Usage cell: the split, and the appointments behind it. */
export function usageTitle(usage: CarrierUsage | null | undefined): string {
  if (!usage) return "No active contracts and no appointments recorded";
  return [
    `${plural(usage.contractTenants, "tenant")} with an active contract`,
    `${plural(usage.appointmentTenants, "tenant")} with open appointments`,
    `${plural(usage.openAppointments, "open appointment")} of ${usage.appointments.toLocaleString("en-US")} recorded`,
  ].join(" · ");
}

/** The 409's one sentence, and the dialog's summary. */
export function blockingSentence(name: string, usage: CarrierBlockingUsage): string {
  const parts: string[] = [];
  if (usage.contractTenants > 0) parts.push(`${plural(usage.contractTenants, "tenant")} with an active contract`);
  if (usage.openAppointments > 0) {
    parts.push(
      usage.appointmentTenants === null
        ? plural(usage.openAppointments, "open appointment")
        : `${plural(usage.openAppointments, "open appointment")} across ${plural(usage.appointmentTenants, "tenant")}`,
    );
  }
  const who = usage.tenants === null ? "Tenants still use" : `${plural(usage.tenants, "tenant")} still ${usage.tenants === 1 ? "uses" : "use"}`;
  return `${who} ${name}: ${parts.join(" and ") || "active records"}.`;
}

/** What deactivating does to tenants — shown in the override dialog, and true of the code today. */
export const DEACTIVATION_CONSEQUENCES = [
  "It disappears from every tenant's carrier pickers: Settings › Carrier library, Appointments and the commission statement import. Tenants cannot save a new contract level for it.",
  "Tenants' existing contract rows for it drop out of Settings › Carrier library, and the carrier counts there go down.",
  "Their appointments with it stay recorded but show as “Carrier” instead of its name.",
  "Lead routing does not change: appointments with it still make agents eligible in their states.",
  "Nothing is deleted. Reactivating brings all of it back.",
] as const;

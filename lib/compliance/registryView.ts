/**
 * The compliance registry screen's wording (board p-adm-compliance). Plain module with type-only
 * imports, so the server page, the client table and node:test all load the same rules.
 *
 * Nothing here decides whether a dial may happen. The DNC verdict arrives from the real gate
 * (`getDncDialingStatus`) as `dialing.dncBlocked`; the litigator line restates what the preflight
 * does when no litigator vendor is enabled (it refuses as `litigator_unavailable`).
 */
import type { ComplianceVendor, ComplianceVendorType } from "./constants";

export type RegistryDialing = {
  /** DEMO_SCREENING_MODE on localhost: every lookup is answered locally. */
  demo: boolean;
  /** `getDncDialingStatus().blocked` — the gate every dial passes. */
  dncBlocked: boolean;
};

export type RegistryTone = "success" | "warning" | "error" | "info" | "neutral";

/** Types a dial actually calls. The other two are registered but nothing in the product calls them. */
const DIAL_TYPES: readonly ComplianceVendorType[] = ["dnc_scrub", "litigator_scrub"];

export type VendorRole = "Primary" | "Fallback" | "Unused" | "Not called";

/**
 * Primary / Fallback in the order the lookups try them. `vendors` must be in the listing's order
 * (vendor_type, priority, name — the database's order, which is also the fallback loop's), so the
 * rank here cannot disagree with the one the dialer uses.
 */
export function vendorRoles(vendors: readonly Pick<ComplianceVendor, "id" | "vendor_type" | "is_enabled">[]): Map<string, VendorRole> {
  const seen = new Map<ComplianceVendorType, number>();
  const roles = new Map<string, VendorRole>();
  for (const vendor of vendors) {
    if (!vendor.is_enabled) { roles.set(vendor.id, "Unused"); continue; }
    if (!DIAL_TYPES.includes(vendor.vendor_type)) { roles.set(vendor.id, "Not called"); continue; }
    const rank = seen.get(vendor.vendor_type) ?? 0;
    roles.set(vendor.id, rank === 0 ? "Primary" : "Fallback");
    seen.set(vendor.vendor_type, rank + 1);
  }
  return roles;
}

export const ROLE_HINT: Record<VendorRole, string> = {
  Primary: "Tried first for every lookup of this type.",
  Fallback: "Tried only when every vendor above it fails.",
  Unused: "Disabled: no lookup calls it.",
  "Not called": "Enabled, but nothing in the product calls this vendor type yet.",
};

const plural = (count: number, one: string, many: string) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/** The Health cell: the same 24-hour counts the gate reads, fallback hand-offs excluded. */
export function healthPill(vendor: Pick<ComplianceVendor, "available" | "calls_24h" | "failures_24h" | "last_latency_ms">): { tone: RegistryTone; label: string; hint: string } {
  const window = `${plural(vendor.calls_24h, "call", "calls")} in the last 24 hours, ${plural(vendor.failures_24h, "failure", "failures")}.`;
  if (vendor.calls_24h === 0) return { tone: "neutral", label: "Not checked", hint: "No lookup or connection test in the last 24 hours. The dial gate counts an unchecked DNC vendor as available." };
  if (!vendor.available) return { tone: "error", label: `Unreachable · ${plural(vendor.failures_24h, "failure", "failures")}`, hint: `Every call failed: ${window}` };
  if (vendor.failures_24h > 0) return { tone: "warning", label: `Reachable · ${vendor.failures_24h} of ${vendor.calls_24h} failed`, hint: window };
  return { tone: "success", label: vendor.last_latency_ms === null ? "Reachable" : `Reachable · ${vendor.last_latency_ms.toLocaleString("en-US")} ms`, hint: `${window}${vendor.last_latency_ms === null ? "" : " The time is the latest call's."}` };
}

/** Enabled vendors whose every call in the window failed — the board's "dangerous state". */
export function unreachableVendors<T extends Pick<ComplianceVendor, "is_enabled" | "available">>(vendors: readonly T[]): T[] {
  return vendors.filter((vendor) => vendor.is_enabled && !vendor.available);
}

const COUNT_WORD = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const countWord = (count: number) => COUNT_WORD[count] ?? count.toLocaleString("en-US");

export type DialingPosture = { tone: RegistryTone; title: string; lines: string[] };

/**
 * The callout above the table. It names what is missing rather than repeating a generic warning,
 * and it never calls a vendor "reachable" that has not answered: unchecked vendors are counted as
 * available by the gate (unchanged), so they are said to be unchecked.
 */
export function dialingPosture(vendors: readonly Pick<ComplianceVendor, "vendor_type" | "is_enabled" | "available" | "calls_24h">[], dialing: RegistryDialing): DialingPosture {
  const enabled = (type: ComplianceVendorType) => vendors.filter((vendor) => vendor.is_enabled && vendor.vendor_type === type);
  const dnc = enabled("dnc_scrub");
  const litigator = enabled("litigator_scrub");
  const answered = (list: typeof dnc) => list.filter((vendor) => vendor.calls_24h > 0 && vendor.available).length;
  const unchecked = (list: typeof dnc) => list.filter((vendor) => vendor.calls_24h === 0).length;

  if (dialing.demo) {
    return {
      tone: "info",
      title: "Dialing is currently possible, on demo screening",
      lines: ["DEMO_SCREENING_MODE is on in this local environment: every DNC and litigator lookup is answered locally, so the vendors below are not what gates dialing here. Production never runs in this mode."],
    };
  }

  const missing: string[] = [];
  if (dialing.dncBlocked) {
    missing.push(dnc.length === 0
      ? "No DNC vendor is enabled, so /api/app/dial/preflight returns 503 for every dial on the platform."
      : `${dnc.length === 1 ? "The one enabled DNC vendor" : `All ${dnc.length} enabled DNC vendors`} failed every call in the last 24 hours, so /api/app/dial/preflight returns 503 for every dial on the platform.`);
  }
  if (litigator.length === 0) {
    missing.push("No litigator vendor is enabled, so the preflight refuses every dial as litigator_unavailable (503).");
  }
  if (missing.length) {
    return { tone: "error", title: "Dialing is currently blocked", lines: [...missing, "Enable a vendor of the missing type, or fix the failing one, to restore dialing without a deploy."] };
  }

  const lines: string[] = [];
  const dncAnswered = answered(dnc);
  const dncUnchecked = unchecked(dnc);
  const dncPart = dncAnswered
    ? `${countWord(dncAnswered)} enabled DNC ${dncAnswered === 1 ? "vendor is" : "vendors are"} reachable.`
    : "No enabled DNC vendor has answered in the last 24 hours.";
  const uncheckedPart = dncUnchecked
    ? ` ${countWord(dncUnchecked)} ${dncUnchecked === 1 ? "has" : "have"} not been checked; the gate counts an unchecked vendor as available.`
    : "";
  lines.push(`${dncPart}${uncheckedPart}`);
  const litigatorAnswered = answered(litigator);
  const litigatorDown = litigator.filter((vendor) => !vendor.available).length;
  lines.push(litigatorDown === litigator.length
    ? `${litigator.length === 1 ? "The one enabled litigator vendor" : `All ${litigator.length} enabled litigator vendors`} failed every call in the last 24 hours; dials are refused whenever no litigator vendor answers.`
    : litigatorAnswered
      ? `${countWord(litigatorAnswered)} enabled litigator ${litigatorAnswered === 1 ? "vendor is" : "vendors are"} reachable.`
      : `${countWord(litigator.length)} enabled litigator ${litigator.length === 1 ? "vendor has" : "vendors have"} not been checked in the last 24 hours.`);
  const warn = dncAnswered === 0 || litigatorDown === litigator.length || litigatorAnswered === 0;
  return { tone: warn ? "warning" : "success", title: "Dialing is currently possible", lines };
}

/** The footer note under the table. */
export function registryFooter(unreachable: readonly Pick<ComplianceVendor, "name">[]): string {
  const names = unreachable.map((vendor) => vendor.name);
  const who = names.length === 0 ? null : names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const state = who
    ? `${who} ${names.length === 1 ? "is" : "are"} configured and unreachable — the dangerous state, and it would look identical to a healthy one without this column.`
    : "A vendor that is configured and unreachable is the dangerous state, and it would look identical to a healthy one without the Health column.";
  return `Enabled is not the same as working. ${state} Health reads the last 24 hours of lookups and connection tests; a hand-off to a fallback vendor is not counted as a second failure. Credentials are stored write-only and are never rendered.`;
}

// Spelled out rather than taken from Intl: server and browser ICU versions differ.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (value: number) => String(value).padStart(2, "0");

/** "22 Sep 08:44 UTC" in the current UTC year, "22 Sep 2025 08:44 UTC" otherwise. */
export function shortUtc(iso: string | null, nowYear: number): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear() === nowYear ? "" : ` ${d.getUTCFullYear()}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** "22 Sep 2026 08:40:55 UTC". */
export function fullUtc(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

// Beneficiary rules (LA-3.8). Shares are held in hundredths of a percent (integers) so 33.34 +
// 33.33 + 33.33 is exactly 10 000 and no float can make it 99.99999.

import type { BeneficiaryRelationship } from "./constants";

export type BeneficiaryTier = "primary" | "contingent";

export type BeneficiaryDraft = {
  id: string;
  tier: BeneficiaryTier;
  first_name: string;
  last_name: string;
  relationship: BeneficiaryRelationship | "";
  relationship_other?: string;
  dob?: string | null;
  /** Hundredths of a percent: 3334 is 33.34%. */
  share_bp: number;
};

export type BeneficiaryIssue = { code: string; message: string; severity: "block" | "warn"; id?: string };

export const FULL_SHARE = 10_000;

/**
 * An estate, trust or funeral home is not a person: it has one name, held in `last_name`, and no
 * first name (tenant_application_beneficiaries_person_named allows exactly these three).
 */
export const ENTITY_RELATIONSHIPS: readonly BeneficiaryRelationship[] = ["estate", "trust", "funeral_home"];
export const isEntityRelationship = (r: BeneficiaryRelationship | "" | null | undefined) => Boolean(r) && ENTITY_RELATIONSHIPS.includes(r as BeneficiaryRelationship);

/** "33.34" from 3334. */
export function formatShare(bp: number) {
  return `${Math.floor(bp / 100)}.${String(bp % 100).padStart(2, "0")}`;
}

/** 3334 from "33.34" / "33.3" / "33"; null for anything with more than two decimals or out of range. */
export function parseShare(input: string): number | null {
  const m = /^\s*(\d{1,3})(?:\.(\d{0,2}))?\s*$/.exec(input);
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number(((m[2] ?? "") + "00").slice(0, 2));
  return bp > 0 && bp <= FULL_SHARE ? bp : null;
}

/** Divide 100.00 across n rows; the leftover hundredths go on the first row (3 → 3334/3333/3333). */
export function splitEvenly(count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(FULL_SHARE / count);
  const shares = Array.from({ length: count }, () => base);
  shares[0] += FULL_SHARE - base * count;
  return shares;
}

export function tierTotal(rows: BeneficiaryDraft[], tier: BeneficiaryTier) {
  return rows.filter((r) => r.tier === tier).reduce((sum, r) => sum + (r.share_bp || 0), 0);
}

function ageOn(dob: string, today: Date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  let age = today.getUTCFullYear() - Number(m[1]);
  const month = today.getUTCMonth() + 1;
  if (month < Number(m[2]) || (month === Number(m[2]) && today.getUTCDate() < Number(m[3]))) age--;
  return age;
}

/** Every block and warning LA-3.8 names. A block keeps the application from reaching `ready`. */
export function checkBeneficiaries(rows: BeneficiaryDraft[], today = new Date()): BeneficiaryIssue[] {
  const issues: BeneficiaryIssue[] = [];
  const primaries = rows.filter((r) => r.tier === "primary");
  const contingents = rows.filter((r) => r.tier === "contingent");

  if (primaries.length === 0) issues.push({ code: "BENEFICIARY_NO_PRIMARY", severity: "block", message: contingents.length ? "A contingent beneficiary needs a primary beneficiary." : "Add at least one primary beneficiary." });
  const primaryTotal = tierTotal(rows, "primary");
  if (primaries.length && primaryTotal !== FULL_SHARE) issues.push({ code: "BENEFICIARY_PRIMARY_TOTAL", severity: "block", message: `Primary shares total ${formatShare(primaryTotal)}%, not 100.00%.` });
  const contingentTotal = tierTotal(rows, "contingent");
  if (contingents.length && contingentTotal !== FULL_SHARE) issues.push({ code: "BENEFICIARY_CONTINGENT_TOTAL", severity: "block", message: `Contingent shares total ${formatShare(contingentTotal)}%, not 100.00%.` });

  for (const r of rows) {
    // An estate, trust or funeral home reads back with no first name (null from the table).
    const name = (isEntityRelationship(r.relationship) ? r.last_name : `${r.first_name ?? ""} ${r.last_name}`).trim() || "A beneficiary";
    if (isEntityRelationship(r.relationship)) {
      if (!r.last_name.trim()) issues.push({ code: "BENEFICIARY_NAME", severity: "block", id: r.id, message: "Name the estate, trust or funeral home." });
    } else if (!(r.first_name ?? "").trim() || !r.last_name.trim()) issues.push({ code: "BENEFICIARY_NAME", severity: "block", id: r.id, message: `${name} needs a first and last name.` });
    if (!r.relationship) issues.push({ code: "BENEFICIARY_RELATIONSHIP", severity: "block", id: r.id, message: `${name} needs a relationship.` });
    if (r.relationship === "other" && !r.relationship_other?.trim()) issues.push({ code: "BENEFICIARY_RELATIONSHIP_OTHER", severity: "block", id: r.id, message: `Say what "other" means for ${name}.` });
    if (r.dob) {
      const age = ageOn(r.dob, today);
      if (age !== null && age < 18) issues.push({ code: "BENEFICIARY_MINOR", severity: "warn", id: r.id, message: `${name} is under 18 — most carriers need a trustee or custodian named.` });
    }
    if (r.relationship === "estate") issues.push({ code: "BENEFICIARY_ESTATE", severity: "warn", id: r.id, message: "Naming the estate often delays the payout through probate." });
  }
  if (primaries.length > 4) issues.push({ code: "BENEFICIARY_MANY_PRIMARIES", severity: "warn", message: "More than four primaries — many carrier portals only take four." });
  return issues;
}

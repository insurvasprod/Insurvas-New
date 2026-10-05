import "server-only";

// Two reads the workspace's Disclosures and Review steps need that the case view does not carry
// (LA-3.10, LA-3.11). Both are tenant-scoped by an explicit filter — the service client bypasses RLS.

import { ApplicationError, db, isMissingSchema, rows } from "./db";
import type { DisclosureClause } from "./disclosureRules";
import type { QaVerdict } from "./qa";

async function ownedAttempt(tenantId: string, applicationId: string) {
  const q = await db().from("tenant_applications").select("id").eq("tenant_id", tenantId).eq("id", applicationId).maybeSingle();
  if (isMissingSchema(q.error)) return null;
  if (q.error) throw new ApplicationError("APPLICATION_UNAVAILABLE", q.error.message, 500);
  if (!q.data) throw new ApplicationError("APPLICATION_NOT_FOUND", "That application could not be found.", 404);
  return q.data.id as string;
}

export type DisclosureTrigger = { disclosureId: string; states: string[]; carrierIds: string[]; rules: DisclosureClause[][] };

/**
 * Why each disclosure on this attempt applies: its state/carrier scope and the rules that can bring
 * it up. The screen evaluates them against the answers it already holds and says which one did.
 */
export async function disclosureTriggers(tenantId: string, applicationId: string): Promise<DisclosureTrigger[]> {
  const id = await ownedAttempt(tenantId, applicationId);
  if (!id) return [];
  const client = db();
  const on = await client.from("tenant_application_disclosures").select("disclosure_id").eq("tenant_id", tenantId).eq("application_id", id);
  if (isMissingSchema(on.error)) return [];
  if (on.error) throw new ApplicationError("APPLICATION_UNAVAILABLE", on.error.message, 500);
  const ids = [...new Set(rows<{ disclosure_id: string }>(on.data).map((r) => r.disclosure_id))];
  if (!ids.length) return [];
  const [lib, rules] = await Promise.all([
    client.from("application_disclosures").select("id, states, carrier_ids").in("id", ids).or(`tenant_id.is.null,tenant_id.eq.${tenantId}`),
    // Rules carry no tenant column; they are read only for disclosures this tenant's attempt holds.
    client.from("application_disclosure_rules").select("disclosure_id, clauses").in("disclosure_id", ids),
  ]);
  if (isMissingSchema(lib.error) || isMissingSchema(rules.error)) return [];
  if (lib.error || rules.error) throw new ApplicationError("APPLICATION_UNAVAILABLE", (lib.error ?? rules.error)!.message, 500);
  const ruleRows = rows<{ disclosure_id: string; clauses: DisclosureClause[] | null }>(rules.data);
  return rows<{ id: string; states: string[] | null; carrier_ids: string[] | null }>(lib.data).map((d) => ({
    disclosureId: d.id,
    states: d.states ?? [],
    carrierIds: d.carrier_ids ?? [],
    rules: ruleRows.filter((r) => r.disclosure_id === d.id).map((r) => (Array.isArray(r.clauses) ? r.clauses : [])),
  }));
}

export type FrozenQa = { submissionId: string; submittedAt: string; verdict: QaVerdict | null };

/** The QA verdict frozen with the attempt's latest submission (LA-3.11 · retrievable afterwards). */
export async function latestFrozenQa(tenantId: string, applicationId: string): Promise<FrozenQa | null> {
  const id = await ownedAttempt(tenantId, applicationId);
  if (!id) return null;
  const q = await db().from("tenant_application_submissions").select("id, submitted_at, qa_verdict").eq("tenant_id", tenantId).eq("application_id", id).order("submitted_at", { ascending: false }).limit(1).maybeSingle();
  if (isMissingSchema(q.error)) return null;
  if (q.error) throw new ApplicationError("APPLICATION_UNAVAILABLE", q.error.message, 500);
  if (!q.data) return null;
  const raw = q.data.qa_verdict as Partial<QaVerdict> | null;
  const verdict: QaVerdict | null = raw && (raw.verdict === "pass" || raw.verdict === "pass_with_warnings" || raw.verdict === "fail")
    ? { verdict: raw.verdict, blocking: Array.isArray(raw.blocking) ? raw.blocking : [], warnings: Array.isArray(raw.warnings) ? raw.warnings : [], passed: Array.isArray(raw.passed) ? raw.passed : [] }
    : null;
  return { submissionId: q.data.id as string, submittedAt: q.data.submitted_at as string, verdict };
}

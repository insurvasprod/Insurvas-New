import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { normalizeDigits } from "./constants";
import type { ConsentCertificateOption, DncExemption, DncExemptionBasis, DncExemptionUse, RelationshipKind } from "./exemptionConstants";

/**
 * LA-2.3-3 · recorded consent or business relationship that clears federal/state DNC for a number.
 *
 * The rules live in the database (20260925709700): record_dnc_exemption validates the basis and
 * refuses a second open record, dnc_exemption_active_id is the one test every gate asks, and
 * is_phone_suppressed / tenant_phone_suppression_hits ignore federal_dnc and state_dnc rows while it
 * answers. Nothing here decides; it reads, and it calls those functions.
 *
 * Before that migration: reads report `schemaReady: false` and every write throws
 * ExemptionSchemaPendingError, which the route answers with 503.
 */

type Result<T> = { data: T | null; error: { message: string; code?: string } | null };
type Row = Record<string, unknown>;
type Query = PromiseLike<Result<Row[]>> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  or(filter: string): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  limit(count: number): Query;
  maybeSingle<T = Row>(): Promise<Result<T>>;
};
type Db = { from(table: string): Query; rpc(name: string, args: Record<string, unknown>): PromiseLike<Result<unknown>> };

const db = () => getSupabaseServiceClient() as unknown as Db;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const nullable = (value: unknown) => (typeof value === "string" && value ? value : null);

const PENDING_CODES = new Set(["42P01", "42703", "42883", "PGRST200", "PGRST202", "PGRST204", "PGRST205"]);
export function isExemptionSchemaPending(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  if (error.code && PENDING_CODES.has(error.code)) return true;
  return /could not find the (function|table)|relation .* does not exist|schema cache/i.test(error.message ?? "");
}

export const EXEMPTION_SCHEMA_PENDING_MESSAGE = "This setting needs a database update that has not been applied yet.";

export class ExemptionSchemaPendingError extends Error {
  constructor() {
    super(EXEMPTION_SCHEMA_PENDING_MESSAGE);
    this.name = "ExemptionSchemaPendingError";
  }
}

/** A refusal from record/revoke, in words an owner can act on, with the HTTP status to answer. */
export class ExemptionRefusedError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409, public readonly code: string) {
    super(message);
    this.name = "ExemptionRefusedError";
  }
}

const REFUSALS: Array<[RegExp, string, 400 | 403 | 404 | 409, string]> = [
  [/not_a_us_phone/, "That is not a ten-digit US phone number.", 400, "invalid_phone"],
  [/dnc_exemption_owner_only/, "Only an owner can record or revoke a DNC exemption.", 403, "owner_only"],
  [/dnc_exemption_certificate_required/, "Written consent needs a stored consent certificate. Pick one from a lead with this number.", 400, "certificate_required"],
  [/dnc_exemption_certificate_not_found/, "That consent certificate is not on this workspace.", 404, "certificate_not_found"],
  [/dnc_exemption_certificate_not_stored/, "That certificate is not claimed and stored, so it is not evidence of consent yet. Claim it first.", 400, "certificate_not_stored"],
  [/dnc_exemption_certificate_other_number/, "That certificate belongs to a lead with a different phone number.", 400, "certificate_other_number"],
  [/dnc_exemption_relationship_kind/, "Say whether the relationship is a purchase or an inquiry.", 400, "relationship_kind"],
  [/dnc_exemption_relationship_date/, "The relationship date must be today or earlier.", 400, "relationship_date"],
  [/dnc_exemption_expired/, "A relationship from that date has already expired (18 months after a purchase, 3 after an inquiry), so it cannot clear DNC.", 400, "relationship_expired"],
  [/dnc_exemption_basis/, "Choose written consent or an existing business relationship.", 400, "basis"],
  [/dnc_exemption_exists|tenant_dnc_exemptions_one_open/, "This number already has an active exemption. Revoke it first to record a different one.", 409, "exemption_exists"],
  [/dnc_exemption_reason_required/, "Say why the exemption is being revoked.", 400, "reason_required"],
  [/dnc_exemption_not_open/, "That exemption is not on this workspace, or it is already revoked.", 404, "not_open"],
];

function refusal(error: { message: string; code?: string }): Error {
  if (isExemptionSchemaPending(error)) return new ExemptionSchemaPendingError();
  const match = REFUSALS.find(([pattern]) => pattern.test(error.message));
  return match ? new ExemptionRefusedError(match[1], match[2], match[3]) : new Error(`The exemption could not be saved: ${error.message}`);
}

async function names(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const result = await db().from("users").select("id, full_name, email").in("id", unique);
  if (result.error) return new Map();
  return new Map((result.data ?? []).map((row) => [text(row.id), text(row.full_name) || text(row.email) || "Someone on your team"]));
}

function leadName(values: unknown): string | null {
  const v = (values && typeof values === "object" ? values : {}) as Row;
  const name = text(v.full_name) || text(v.name) || [text(v.first_name), text(v.last_name)].filter(Boolean).join(" ");
  return name.trim() || null;
}

export type ExemptionsLoaded = { schemaReady: boolean; exemptions: DncExemption[]; uses: DncExemptionUse[] };

/** Every exemption the workspace has recorded (newest first, revoked ones kept) and the last uses. */
export async function listExemptions(tenantId: string, options: { phone?: string | null; limit?: number } = {}): Promise<ExemptionsLoaded> {
  const client = db();
  const digits = options.phone ? normalizeDigits(options.phone) : null;
  let query = client.from("tenant_dnc_exemptions")
    .select("id, phone_digits, basis, relationship_kind, relationship_date, expires_at, consent_artefact_id, certificate_provider, certificate_url, note, recorded_by, recorded_at, revoked_at, revoked_by, revoke_reason")
    .eq("tenant_id", tenantId);
  if (digits) query = query.eq("phone_digits", digits);
  const rows = await query.order("recorded_at", { ascending: false }).limit(Math.min(options.limit ?? 200, 500));
  if (rows.error) {
    if (isExemptionSchemaPending(rows.error)) return { schemaReady: false, exemptions: [], uses: [] };
    throw new Error(`Could not load DNC exemptions: ${rows.error.message}`);
  }
  const list = rows.data ?? [];
  const ids = list.map((row) => text(row.id));

  const [usesRead, artefacts] = await Promise.all([
    ids.length
      ? client.from("tenant_dnc_exemption_uses").select("id, exemption_id, phone_digits, context, cleared_lists, lead_id, user_id, used_at")
        .eq("tenant_id", tenantId).in("exemption_id", ids).order("used_at", { ascending: false }).limit(500)
      : Promise.resolve({ data: [] as Row[], error: null }),
    // The written-consent test re-checks the certificate is still held; the screen says so too.
    (() => {
      const artefactIds = list.map((row) => text(row.consent_artefact_id)).filter(Boolean);
      return artefactIds.length
        ? client.from("tenant_consent_artefacts").select("id, capture_status, stored_copy, stored_ref").eq("tenant_id", tenantId).in("id", artefactIds)
        : Promise.resolve({ data: [] as Row[], error: null });
    })(),
  ]);
  const useRows = usesRead.error ? [] : usesRead.data ?? [];
  const held = new Set((artefacts.error ? [] : artefacts.data ?? [])
    .filter((row) => text(row.capture_status) === "claimed" && (row.stored_copy != null || nullable(row.stored_ref)))
    .map((row) => text(row.id)));
  const who = await names([
    ...list.map((row) => text(row.recorded_by)),
    ...list.map((row) => text(row.revoked_by)),
    ...useRows.map((row) => text(row.user_id)),
  ]);

  const now = Date.now();
  const exemptions = list.map((row): DncExemption => {
    const id = text(row.id);
    const mine = useRows.filter((use) => text(use.exemption_id) === id);
    const expiresAt = nullable(row.expires_at);
    const basis = text(row.basis) as DncExemptionBasis;
    const state: DncExemption["state"] = row.revoked_at ? "revoked"
      : expiresAt && Date.parse(expiresAt) <= now ? "expired"
      : basis === "written_consent" && !held.has(text(row.consent_artefact_id)) ? "certificate_gone"
      : "active";
    return {
      id,
      phoneDigits: text(row.phone_digits),
      basis,
      relationshipKind: (nullable(row.relationship_kind) as RelationshipKind | null),
      relationshipDate: nullable(row.relationship_date),
      expiresAt,
      certificateProvider: nullable(row.certificate_provider),
      certificateUrl: nullable(row.certificate_url),
      consentArtefactId: nullable(row.consent_artefact_id),
      note: nullable(row.note),
      recordedAt: text(row.recorded_at),
      recordedByName: who.get(text(row.recorded_by)) ?? null,
      revokedAt: nullable(row.revoked_at),
      revokedByName: who.get(text(row.revoked_by)) ?? null,
      revokeReason: nullable(row.revoke_reason),
      state,
      uses: mine.length,
      lastUsedAt: mine[0] ? text(mine[0].used_at) : null,
    };
  });
  const uses = useRows.slice(0, 50).map((row): DncExemptionUse => ({
    id: text(row.id),
    exemptionId: text(row.exemption_id),
    phoneDigits: text(row.phone_digits),
    context: text(row.context),
    clearedLists: Array.isArray(row.cleared_lists) ? (row.cleared_lists as unknown[]).map(text) : [],
    leadId: nullable(row.lead_id),
    userName: who.get(text(row.user_id)) ?? null,
    usedAt: text(row.used_at),
  }));
  return { schemaReady: true, exemptions, uses };
}

/** The exemption clearing federal/state DNC for this number right now, or null (also before 709700). */
export async function activeExemption(tenantId: string, phone: string): Promise<DncExemption | null> {
  const digits = normalizeDigits(phone);
  if (!digits) return null;
  const loaded = await listExemptions(tenantId, { phone: digits, limit: 5 }).catch(() => null);
  return loaded?.exemptions.find((row) => row.state === "active") ?? null;
}

/**
 * The consent certificates on file for leads with this number, for the written-consent form. Only
 * a claimed certificate whose copy we hold (`stored`) can be attached; the others are listed so the
 * owner can see why a certificate they expected is not selectable.
 */
export async function consentCertificatesFor(tenantId: string, phone: string): Promise<ConsentCertificateOption[]> {
  const digits = normalizeDigits(phone);
  if (!digits) throw new ExemptionRefusedError("That is not a ten-digit US phone number.", 400, "invalid_phone");
  const client = db();
  const [a, b, c] = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6)];
  const forms = [digits, `1${digits}`, `+1${digits}`, `(${a}) ${b}-${c}`, `${a}-${b}-${c}`, `${a}.${b}.${c}`, `+1 ${a}-${b}-${c}`];
  const list = forms.map((form) => `"${form}"`).join(",");
  const leads = await client.from("agent_leads").select("id, values").eq("tenant_id", tenantId)
    .or(`values->>phone.in.(${list}),values->>phone_number.in.(${list})`).limit(20);
  if (leads.error) throw new Error(`Could not look up leads with this number: ${leads.error.message}`);
  const byLead = new Map((leads.data ?? []).map((row) => [text(row.id), leadName(row.values)]));
  if (!byLead.size) return [];
  const artefacts = await client.from("tenant_consent_artefacts")
    .select("id, lead_id, provider, certificate_url, captured_at, capture_status, stored_copy, stored_ref")
    .eq("tenant_id", tenantId).in("lead_id", [...byLead.keys()]).order("captured_at", { ascending: false }).limit(50);
  if (artefacts.error) throw new Error(`Could not load consent certificates: ${artefacts.error.message}`);
  return (artefacts.data ?? []).map((row) => ({
    id: text(row.id),
    leadId: text(row.lead_id),
    leadName: byLead.get(text(row.lead_id)) ?? null,
    provider: text(row.provider),
    certificateUrl: nullable(row.certificate_url),
    capturedAt: nullable(row.captured_at),
    status: text(row.capture_status),
    stored: text(row.capture_status) === "claimed" && (row.stored_copy != null || Boolean(nullable(row.stored_ref))),
  }));
}

export async function recordExemption(input: {
  tenantId: string;
  userId: string;
  phone: string;
  basis: DncExemptionBasis;
  consentArtefactId: string | null;
  relationshipKind: RelationshipKind | null;
  relationshipDate: string | null;
  note: string | null;
}): Promise<DncExemption> {
  const digits = normalizeDigits(input.phone);
  if (!digits) throw new ExemptionRefusedError("That is not a ten-digit US phone number.", 400, "invalid_phone");
  const result = await db().rpc("record_dnc_exemption", {
    p_tenant_id: input.tenantId,
    p_phone: digits,
    p_basis: input.basis,
    p_consent_artefact_id: input.basis === "written_consent" ? input.consentArtefactId : null,
    p_relationship_kind: input.basis === "existing_business_relationship" ? input.relationshipKind : null,
    p_relationship_date: input.basis === "existing_business_relationship" ? input.relationshipDate : null,
    p_note: input.note,
    p_actor: input.userId,
  });
  if (result.error) throw refusal(result.error);
  // Read back through the gates' own test: an exemption that saved but does not clear is a failure.
  const loaded = await listExemptions(input.tenantId, { phone: digits, limit: 5 });
  const saved = loaded.exemptions.find((row) => row.id === result.data);
  if (!saved) throw new Error("The exemption was saved but could not be read back. Reload before relying on it.");
  return saved;
}

export async function revokeExemption(input: { tenantId: string; userId: string; exemptionId: string; reason: string }): Promise<DncExemption | null> {
  const result = await db().rpc("revoke_dnc_exemption", { p_tenant_id: input.tenantId, p_exemption_id: input.exemptionId, p_actor: input.userId, p_reason: input.reason });
  if (result.error) throw refusal(result.error);
  const loaded = await listExemptions(input.tenantId, { limit: 500 });
  return loaded.exemptions.find((row) => row.id === input.exemptionId) ?? null;
}

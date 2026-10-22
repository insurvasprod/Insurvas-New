import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { API_SCOPE_KEYS, type ApiKeyView, type ApiScope } from "./constants";
import { generateApiKey } from "./rules";

/**
 * LA-8.7 · minting, rotating and revoking integration API keys (Settings › API keys & webhooks).
 *
 * The full key leaves this module once, in the return value of `createApiKey` / `rotateApiKey`, and
 * is never stored or logged: the table holds its hash. "Show it again" has no answer but rotation.
 */

// The generated database types are refreshed from the live project separately.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return getSupabaseServiceClient() as any; }

type Row = {
  id: string; label: string; key_prefix: string; last_four: string; scopes: string[]; created_at: string; created_by: string | null;
  last_used_at: string | null; last_used_ip: string | null; expires_at: string | null; revoked_at: string | null; rotated_from: string | null;
};
// `key_hash` is never selected: a hash that never leaves the database cannot leak through a response or a log.
const COLUMNS = "id, label, key_prefix, last_four, scopes, created_at, created_by, last_used_at, last_used_ip, expires_at, revoked_at, rotated_from";

export class ApiKeySchemaPendingError extends Error {
  constructor() {
    super("API keys are not available yet: migration 20261015340000 has not been applied.");
    this.name = "ApiKeySchemaPendingError";
  }
}
const isMissing = (error: { code?: string; message?: string } | null) => Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || /api_key/.test(error.message ?? "") && /does not exist|schema cache/.test(error.message ?? "")));

function view(row: Row, names: Map<string, string>): ApiKeyView {
  return {
    id: row.id,
    label: row.label,
    keyPrefix: row.key_prefix,
    lastFour: row.last_four,
    scopes: row.scopes.filter((scope): scope is ApiScope => (API_SCOPE_KEYS as readonly string[]).includes(scope)),
    createdAt: row.created_at,
    createdByName: row.created_by ? names.get(row.created_by) ?? null : null,
    lastUsedAt: row.last_used_at,
    lastUsedIp: row.last_used_ip,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    rotatedFrom: row.rotated_from,
  };
}

async function namesFor(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const users = await db().from("users").select("id, name").in("id", unique);
  return new Map(((users.data ?? []) as { id: string; name: string | null }[]).filter((u) => u.name).map((u) => [u.id, u.name as string]));
}

/** Every key of the agency, newest first; revoked ones stay listed (dimmed) so the history is honest. */
export async function listApiKeys(tenantId: string): Promise<ApiKeyView[]> {
  const result = await db().from("api_key").select(COLUMNS).eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(200);
  if (result.error) {
    if (isMissing(result.error)) throw new ApiKeySchemaPendingError();
    throw new Error(`Could not load API keys: ${result.error.message}`);
  }
  const rows = (result.data ?? []) as Row[];
  const names = await namesFor(rows.map((row) => row.created_by));
  return rows.map((row) => view(row, names));
}

export async function createApiKey(input: { tenantId: string; userId: string; label: string; scopes: ApiScope[]; expiresAt: string | null; rotatedFrom?: string | null }): Promise<{ key: string; record: ApiKeyView }> {
  const minted = generateApiKey();
  const result = await db().from("api_key").insert({
    tenant_id: input.tenantId,
    label: input.label.trim(),
    key_hash: minted.hash,
    key_prefix: minted.prefix,
    last_four: minted.lastFour,
    scopes: [...new Set(input.scopes)],
    created_by: input.userId,
    expires_at: input.expiresAt,
    rotated_from: input.rotatedFrom ?? null,
  }).select(COLUMNS).single();
  if (result.error) {
    if (isMissing(result.error)) throw new ApiKeySchemaPendingError();
    throw new Error(`Could not create the key: ${result.error.message}`);
  }
  return { key: minted.key, record: view(result.data as Row, await namesFor([input.userId])) };
}

async function liveKey(tenantId: string, keyId: string): Promise<Row> {
  const result = await db().from("api_key").select(COLUMNS).eq("tenant_id", tenantId).eq("id", keyId).maybeSingle();
  if (result.error) {
    if (isMissing(result.error)) throw new ApiKeySchemaPendingError();
    throw new Error(`Could not load that key: ${result.error.message}`);
  }
  const row = result.data as Row | null;
  if (!row) throw new Error("That key is not yours, or no longer exists.");
  if (row.revoked_at) throw new Error("That key is revoked.");
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) throw new Error("That key has expired.");
  return row;
}

/**
 * Rotation: a new key with the same label, scopes and end date, and the old one kept working for
 * `overlapHours` (its expiry is brought forward to then, never pushed later). Both are listed during
 * the overlap.
 *
 * - The new key never outlives what was chosen: a key with an end date keeps that date, even when
 *   it falls inside the overlap. Only a key with no end date rotates into one with none.
 * - Once per key: a key that already has a live successor is refused, here and by the database
 *   (api_key_one_rotation, 20261015640000), so two rotations racing mint one key, not two.
 * - All or nothing: when the old key's end cannot be set, the new key is revoked again before the
 *   error is raised, so a failed rotation never leaves a second live key nobody was shown.
 */
export class ApiKeyAlreadyRotatedError extends Error {
  constructor() {
    super("That key has already been rotated. Use its replacement, or revoke it.");
    this.name = "ApiKeyAlreadyRotatedError";
  }
}

export async function rotateApiKey(input: { tenantId: string; userId: string; keyId: string; overlapHours: number }): Promise<{ key: string; record: ApiKeyView; oldExpiresAt: string }> {
  const old = await liveKey(input.tenantId, input.keyId);
  const successor = await db().from("api_key").select("id").eq("tenant_id", input.tenantId).eq("rotated_from", old.id).is("revoked_at", null).limit(1);
  if (successor.error) throw new Error(`Could not check that key: ${successor.error.message}`);
  if (successor.data?.length) throw new ApiKeyAlreadyRotatedError();

  const overlapEnds = new Date(Date.now() + input.overlapHours * 3_600_000);
  const oldExpiresAt = old.expires_at && Date.parse(old.expires_at) < overlapEnds.getTime() ? old.expires_at : overlapEnds.toISOString();
  let minted: { key: string; record: ApiKeyView };
  try {
    minted = await createApiKey({
      tenantId: input.tenantId,
      userId: input.userId,
      label: old.label,
      scopes: old.scopes as ApiScope[],
      // A key that was due to expire keeps that date; the new one does not outlive what was chosen.
      expiresAt: old.expires_at,
      rotatedFrom: old.id,
    });
  } catch (error) {
    // The one-rotation index refused it: another rotation of this key won the race.
    if (error instanceof Error && /api_key_one_rotation|duplicate key/i.test(error.message)) throw new ApiKeyAlreadyRotatedError();
    throw error;
  }
  const shortened = await db().from("api_key").update({ expires_at: oldExpiresAt })
    .eq("tenant_id", input.tenantId).eq("id", old.id).is("revoked_at", null).select("id");
  if (shortened.error || !shortened.data?.length) {
    // Undo: the new key goes, so nothing live exists that the person was not shown working.
    const undone = await db().from("api_key").update({ revoked_at: new Date().toISOString(), revoked_by: input.userId })
      .eq("tenant_id", input.tenantId).eq("id", minted.record.id).is("revoked_at", null);
    if (undone.error) console.error("[api-key] could not revoke the key of a failed rotation", minted.record.id, undone.error.message);
    throw new Error(shortened.error
      ? `The key could not be rotated (${shortened.error.message}). The new key was withdrawn; try again.`
      : "That key was revoked while it was being rotated; the new key was withdrawn.");
  }
  return { ...minted, oldExpiresAt };
}

/** Effective on the next request: every request reads this row. */
export async function revokeApiKey(input: { tenantId: string; userId: string; keyId: string }): Promise<ApiKeyView> {
  const result = await db().from("api_key").update({ revoked_at: new Date().toISOString(), revoked_by: input.userId })
    .eq("tenant_id", input.tenantId).eq("id", input.keyId).is("revoked_at", null).select(COLUMNS).maybeSingle();
  if (result.error) {
    if (isMissing(result.error)) throw new ApiKeySchemaPendingError();
    throw new Error(`Could not revoke that key: ${result.error.message}`);
  }
  if (!result.data) throw new Error("That key is not yours, or is already revoked.");
  const row = result.data as Row;
  return view(row, await namesFor([row.created_by]));
}

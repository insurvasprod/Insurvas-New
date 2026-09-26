import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { generatePostKey } from "./service";
import { canonicalFieldMap, readFieldMap } from "./fieldMap";
import { isMissingSchema, SchemaPendingError } from "./schemaGap";
import type { PostCampaign, PostKey, PostKeysLoaded, PostKeyStats, RejectionCount } from "./types";
import { REJECTION_LABELS } from "./types";

export type { PostKey } from "./types";

/**
 * LA-2.5 · minting and rotating the keys a vendor posts leads with.
 *
 * `generatePostKey()` has existed since the lead-post migration and nothing ever called it. The
 * ingest path reads `tenant_vendor_post_keys` to authenticate a post and stamps `last_used_at`,
 * but no code anywhere created a row — so the endpoint at `/api/leads/post/[key]` was reachable,
 * correct, and impossible to give anyone a key for. A ping-post vendor could not be onboarded at
 * all.
 *
 * The key is shown once and never again. Only `key_hash` and a short `key_prefix` are stored, so
 * "what was that key" has no answer except rotation — which is the property that makes the table
 * safe and the one a screen most wants to paper over. It is not papered over here.
 *
 * `campaign_id` and `field_notes` arrive with migration 20260924130000. Every read below falls back
 * to the older column list when they are missing, and every write that needs them throws
 * `SchemaPendingError`, which the routes answer with 503.
 */

type Result<T> = { data: T | null; error: { message: string; code?: string } | null; count?: number | null };
type Row = Record<string, unknown>;
type Query = {
  select(columns: string, options?: { count?: "exact"; head?: boolean }): Query;
  eq(column: string, value: unknown): Query;
  neq(column: string, value: unknown): Query;
  is(column: string, value: null): Query;
  gte(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  insert(values: unknown): Query;
  update(values: unknown): Query;
  maybeSingle<T>(): Promise<Result<T>>;
  then(resolve: (value: Result<Row[]>) => unknown, reject?: (reason: unknown) => unknown): Promise<unknown>;
};
type Db = { from(table: string): Query; rpc(name: string, args: Record<string, unknown>): PromiseLike<Result<unknown>> };

/**
 * LA-2.5-2 · "One key per vendor, rotatable." A vendor holds ONE active key: minting a second is
 * refused (409), and so is re-enabling a retired key while another is active. Rotation is the way
 * to a new key. Migration 20260925709710 adds the unique index that makes this hold under a race,
 * and rotate_vendor_post_key(), which retires and mints in one transaction.
 */
export class PostKeyConflictError extends Error {
  readonly code = "vendor_has_key";
  constructor(message: string) {
    super(message);
    this.name = "PostKeyConflictError";
  }
}

const MISSING_FUNCTION = new Set(["42883", "PGRST202"]);
const isMissingFunction = (error: { code?: string; message?: string } | null) =>
  Boolean(error && ((error.code && MISSING_FUNCTION.has(error.code)) || /could not find the function/i.test(error.message ?? "")));

/** The vendor's active key other than `exceptKeyId`, if it holds one. */
async function activeKeyFor(tenantId: string, vendorId: string, exceptKeyId?: string): Promise<Row | null> {
  let query = db().from("tenant_vendor_post_keys").select("id, key_prefix").eq("tenant_id", tenantId).eq("vendor_id", vendorId).eq("is_active", true);
  if (exceptKeyId) query = query.neq("id", exceptKeyId);
  const result = (await (query as unknown as PromiseLike<Result<Row[]>>)) as Result<Row[]>;
  if (result.error) throw new Error(`Could not check the vendor's keys: ${result.error.message}`);
  return result.data?.[0] ?? null;
}

function oneKeyMessage(vendorName: string, prefix: string) {
  return `${vendorName || "This vendor"} already has an active posting key (${prefix}…). A vendor holds one key: rotate it to issue a new one, and the old one stops working.`;
}

function db(): Db {
  return getSupabaseServiceClient() as unknown as Db;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

const BASE_COLUMNS = "id, vendor_id, key_prefix, field_map, is_active, created_at, rotated_at, last_used_at";
const FULL_COLUMNS = `${BASE_COLUMNS}, campaign_id, field_notes`;
const WINDOW_DAYS = 30;

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, text(entry)]),
  );
}

function toKey(row: Row, vendorName: string): PostKey {
  return {
    id: text(row.id),
    vendorId: text(row.vendor_id),
    vendorName,
    keyPrefix: text(row.key_prefix),
    fieldMap: stringMap(row.field_map),
    fieldNotes: stringMap(row.field_notes),
    campaignId: text(row.campaign_id) || null,
    isActive: row.is_active === true,
    createdAt: text(row.created_at),
    rotatedAt: text(row.rotated_at) || null,
    lastUsedAt: text(row.last_used_at) || null,
  };
}

/** Run a select with the new columns, and again without them if the migration is not applied. */
async function selectKeys<T>(run: (columns: string) => PromiseLike<Result<T>>): Promise<{ result: Result<T>; schemaReady: boolean }> {
  const full = await run(FULL_COLUMNS);
  if (!isMissingSchema(full.error)) return { result: full, schemaReady: true };
  return { result: await run(BASE_COLUMNS), schemaReady: false };
}

async function count(query: Query): Promise<{ n: number; missing: boolean }> {
  const result = (await (query as unknown as PromiseLike<Result<Row[]>>)) as Result<Row[]>;
  if (result.error) {
    if (isMissingSchema(result.error)) return { n: 0, missing: true };
    throw new Error(`Could not count posts: ${result.error.message}`);
  }
  return { n: result.count ?? 0, missing: false };
}

/**
 * Posts and rejections per key over the last 30 days, and the rejections by reason.
 *
 * Per key where the log records the key (new rows, after 20260924130000). Rows from before that
 * carry only the vendor, so they are reported as "earlier" on that vendor's newest key rather than
 * spread across keys they may not have arrived on. Before the migration, every figure is the
 * vendor's and says so.
 */
async function postStats(tenantId: string, keys: PostKey[]): Promise<{ stats: PostKeyStats[]; rejections: RejectionCount[] }> {
  const client = db();
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const log = () => client.from("tenant_lead_post_log").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("received_at", since);

  const reasons = Object.keys(REJECTION_LABELS);
  const reasonCounts = Promise.all(reasons.map((code) => count(log().eq("outcome", "rejected").eq("reason_code", code))));

  // A real one-row read, not a `head` count: PostgREST answers a HEAD request for a missing column
  // with a bare 400 and no body, so the error has no code to recognise and the whole screen fails.
  const probe = (await (client.from("tenant_lead_post_log").select("key_id").eq("tenant_id", tenantId) as unknown as { limit: (n: number) => PromiseLike<Result<Row[]>> }).limit(1));
  if (probe.error && !isMissingSchema(probe.error)) throw new Error(`Could not count posts: ${probe.error.message}`);
  const keyColumn = !probe.error;

  const vendors = [...new Set(keys.map((key) => key.vendorId))];
  const newestByVendor = new Map<string, string>();
  for (const key of keys) {
    const current = newestByVendor.get(key.vendorId);
    const currentKey = keys.find((item) => item.id === current);
    if (!currentKey || key.createdAt > currentKey.createdAt) newestByVendor.set(key.vendorId, key.id);
  }

  const vendorFigures = new Map<string, { posts: number; rejected: number }>();
  await Promise.all(
    vendors.map(async (vendorId) => {
      const scoped = () => (keyColumn ? log().eq("vendor_id", vendorId).is("key_id", null) : log().eq("vendor_id", vendorId));
      const [posts, rejected] = await Promise.all([count(scoped()), count(scoped().eq("outcome", "rejected"))]);
      vendorFigures.set(vendorId, { posts: posts.n, rejected: rejected.n });
    }),
  );

  const stats = await Promise.all(
    keys.map(async (key): Promise<PostKeyStats> => {
      const vendor = vendorFigures.get(key.vendorId) ?? { posts: 0, rejected: 0 };
      if (!keyColumn) {
        return { keyId: key.id, posts: vendor.posts, rejected: vendor.rejected, perVendor: true, earlierPosts: 0, earlierRejected: 0 };
      }
      const [posts, rejected] = await Promise.all([
        count(log().eq("key_id", key.id)),
        count(log().eq("key_id", key.id).eq("outcome", "rejected")),
      ]);
      const newest = newestByVendor.get(key.vendorId) === key.id;
      return {
        keyId: key.id,
        posts: posts.n,
        rejected: rejected.n,
        perVendor: false,
        earlierPosts: newest ? vendor.posts : 0,
        earlierRejected: newest ? vendor.rejected : 0,
      };
    }),
  );

  const rejections = (await reasonCounts)
    .map((result, index) => ({ reasonCode: reasons[index], count: result.n }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);

  return { stats, rejections };
}

export async function listPostKeys(tenantId: string): Promise<PostKeysLoaded> {
  const client = db();
  const [keysRead, vendors, campaigns] = await Promise.all([
    // `key_hash` is deliberately not selected. It is not a secret that can be reversed, but a
    // hash that never leaves the database cannot leak through a log, a response body or a
    // screenshot either.
    selectKeys((columns) =>
      client.from("tenant_vendor_post_keys").select(columns).eq("tenant_id", tenantId).order("created_at", { ascending: false }) as unknown as PromiseLike<Result<Row[]>>,
    ),
    client.from("tenant_lead_vendors").select("id, name").eq("tenant_id", tenantId).order("name", { ascending: true }) as unknown as PromiseLike<Result<Row[]>>,
    client.from("tenant_campaigns").select("id, name, vendor_id, status").eq("tenant_id", tenantId).order("name", { ascending: true }) as unknown as PromiseLike<Result<Row[]>>,
  ]);

  const keys = keysRead.result;
  if (keys.error) throw new Error(`Could not load your posting keys: ${keys.error.message}`);
  if (vendors.error) throw new Error(`Could not load your vendors: ${vendors.error.message}`);
  if (campaigns.error) throw new Error(`Could not load your campaigns: ${campaigns.error.message}`);

  const vendorName = new Map((vendors.data ?? []).map((row) => [text(row.id), text(row.name)]));
  const list = (keys.data ?? []).map((row) => toKey(row, vendorName.get(text(row.vendor_id)) || "Vendor no longer on your list"));
  const { stats, rejections } = await postStats(tenantId, list);

  return {
    keys: list,
    vendors: (vendors.data ?? []).map((row) => ({ id: text(row.id), name: text(row.name) })),
    campaigns: (campaigns.data ?? []).map((row): PostCampaign => ({ id: text(row.id), name: text(row.name), vendorId: text(row.vendor_id), status: text(row.status) })),
    stats,
    rejections,
    windowDays: WINDOW_DAYS,
    schemaReady: keysRead.schemaReady,
    workspaceId: tenantId,
  };
}

/** A campaign may be bound to a key only if it is the key's vendor's, in the key's tenant. */
async function assertVendorCampaign(tenantId: string, vendorId: string, campaignId: string) {
  const result = await db()
    .from("tenant_campaigns")
    .select("id, vendor_id")
    .eq("tenant_id", tenantId)
    .eq("id", campaignId)
    .maybeSingle<Row>();
  if (result.error) throw new Error(`Could not check that campaign: ${result.error.message}`);
  if (!result.data) throw new Error("That campaign is not on your list.");
  if (text(result.data.vendor_id) !== vendorId) throw new Error("That campaign belongs to a different vendor.");
}

type MintInput = {
  tenantId: string;
  userId: string;
  vendorId: string;
  fieldMap: Record<string, string>;
  fieldNotes?: Record<string, string>;
  campaignId?: string | null;
};

/** The only moment the key exists outside the vendor's hands. Refused while the vendor holds one. */
export async function mintPostKey(input: MintInput): Promise<{ key: string; record: PostKey }> {
  return insertKey(input, { replacing: false });
}

async function insertKey(input: MintInput, options: { replacing: boolean }): Promise<{ key: string; record: PostKey }> {
  const client = db();

  const vendor = await client
    .from("tenant_lead_vendors")
    .select("id, name")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.vendorId)
    .maybeSingle<Row>();
  if (vendor.error) throw new Error(`Could not check that vendor: ${vendor.error.message}`);
  if (!vendor.data) throw new Error("That vendor is not on your list.");
  if (!options.replacing) {
    const held = await activeKeyFor(input.tenantId, input.vendorId);
    if (held) throw new PostKeyConflictError(oneKeyMessage(text(vendor.data.name), text(held.key_prefix)));
  }
  if (input.campaignId) await assertVendorCampaign(input.tenantId, input.vendorId, input.campaignId);

  // The field map is the vendor's, not the key's: a new key for a vendor that already has one starts
  // with that vendor's map and notes, so "set per vendor" holds from the first post.
  let fieldMap = input.fieldMap;
  let fieldNotes = input.fieldNotes;
  if (Object.keys(fieldMap).length === 0) {
    const { result: sibling } = await selectKeys((columns) =>
      (client.from("tenant_vendor_post_keys").select(columns).eq("tenant_id", input.tenantId).eq("vendor_id", input.vendorId).order("created_at", { ascending: false }) as unknown as { limit: (n: number) => PromiseLike<Result<Row[]>> }).limit(1),
    );
    const existing = sibling.data?.[0];
    if (existing) {
      fieldMap = stringMap(existing.field_map);
      if (!fieldNotes || Object.keys(fieldNotes).length === 0) fieldNotes = stringMap(existing.field_notes);
    }
  }

  const extras: Row = {};
  if (input.campaignId) extras.campaign_id = input.campaignId;
  if (fieldNotes && Object.keys(fieldNotes).length > 0) extras.field_notes = fieldNotes;

  const minted = generatePostKey();
  const inserted = await client
    .from("tenant_vendor_post_keys")
    .insert({
      tenant_id: input.tenantId,
      vendor_id: input.vendorId,
      key_hash: minted.hash,
      key_prefix: minted.prefix,
      // Always stored the canonical way round, whatever direction it was handed over in.
      field_map: canonicalFieldMap(readFieldMap(fieldMap)),
      is_active: true,
      created_by: input.userId,
      ...extras,
    })
    .select(Object.keys(extras).length > 0 ? FULL_COLUMNS : BASE_COLUMNS)
    .maybeSingle<Row>();

  if (inserted.error) {
    if (isMissingSchema(inserted.error)) throw new SchemaPendingError();
    // The one-active-key index (20260925709710) caught a mint that raced another.
    if (inserted.error.code === "23505" && !/key_hash/.test(inserted.error.message)) throw new PostKeyConflictError(oneKeyMessage(text(vendor.data.name), "another"));
    throw new Error(`Could not create the posting key: ${inserted.error.message}`);
  }
  if (!inserted.data) throw new Error("The posting key did not save.");

  return { key: minted.key, record: { ...toKey(inserted.data, text(vendor.data.name)), isActive: true, rotatedAt: null, lastUsedAt: null } };
}

/**
 * Rotation: a new key for the same vendor, and every active key it held retired.
 *
 * With 20260925709710 applied this is rotate_vendor_post_key(): retire and mint in one
 * transaction, so there is no instant with no key and no instant with two. Before it, the old
 * order stands — mint first, then retire — because deactivating first would give the vendor a
 * window where their posts are rejected, and a duplicate lead is recoverable where a rejected one
 * is a lost sale the vendor bills for anyway.
 */
export async function rotatePostKey(input: {
  tenantId: string;
  userId: string;
  keyId: string;
}): Promise<{ key: string; record: PostKey }> {
  const client = db();
  const { result: existing } = await selectKeys((columns) =>
    client.from("tenant_vendor_post_keys").select(columns).eq("tenant_id", input.tenantId).eq("id", input.keyId).maybeSingle<Row>(),
  );
  if (existing.error) throw new Error(`Could not load that key: ${existing.error.message}`);
  if (!existing.data) throw new Error("That posting key is not yours, or no longer exists.");

  const vendorId = text(existing.data.vendor_id);
  const fresh = generatePostKey();
  const atomic = await client.rpc("rotate_vendor_post_key", {
    p_tenant_id: input.tenantId,
    p_key_id: input.keyId,
    p_key_hash: fresh.hash,
    p_key_prefix: fresh.prefix,
    p_actor: input.userId,
  });
  if (!atomic.error && typeof atomic.data === "string") {
    const newId = atomic.data;
    const { result: row } = await selectKeys((columns) =>
      client.from("tenant_vendor_post_keys").select(columns).eq("tenant_id", input.tenantId).eq("id", newId).maybeSingle<Row>(),
    );
    const vendor = await client.from("tenant_lead_vendors").select("name").eq("tenant_id", input.tenantId).eq("id", vendorId).maybeSingle<Row>();
    if (row.error || !row.data) throw new Error("The key was rotated, but the new key could not be read back. Reload to see it.");
    return { key: fresh.key, record: { ...toKey(row.data, text(vendor.data?.name)), isActive: true, rotatedAt: null, lastUsedAt: null } };
  }
  if (atomic.error && !isMissingFunction(atomic.error)) throw new Error(`Could not rotate the posting key: ${atomic.error.message}`);

  const minted = await insertKey({
    tenantId: input.tenantId,
    userId: input.userId,
    vendorId: text(existing.data.vendor_id),
    // The field map, its notes and the campaign binding travel with the rotation. A vendor whose
    // payload shape suddenly stopped being understood would have a far harder problem to diagnose
    // than a rejected key.
    fieldMap: stringMap(existing.data.field_map),
    fieldNotes: stringMap(existing.data.field_notes),
    campaignId: text(existing.data.campaign_id) || null,
  }, { replacing: true });

  // Every other active key of the vendor, not only the one named, so the rotation leaves one.
  const retired = (await (client
    .from("tenant_vendor_post_keys")
    .update({ is_active: false, rotated_at: new Date().toISOString() })
    .eq("tenant_id", input.tenantId)
    .eq("vendor_id", vendorId)
    .eq("is_active", true)
    .neq("id", minted.record.id)
    .select("id") as unknown as PromiseLike<Result<Row[]>>)) as Result<Row[]>;

  if (retired.error) {
    // The new key is live and the old one is not retired. Saying so matters: silently reporting
    // success would leave two working keys and nobody aware of it.
    throw new Error(
      `A new key was created, but the old key could not be deactivated (${retired.error.message}). Both keys currently work — deactivate the old one before sharing the new.`,
    );
  }

  return minted;
}

export async function setPostKeyActive(input: {
  tenantId: string;
  keyId: string;
  isActive: boolean;
}): Promise<PostKey> {
  if (input.isActive) {
    // Re-enabling a retired key while the vendor holds another would give it two.
    const key = await db().from("tenant_vendor_post_keys").select("id, vendor_id").eq("tenant_id", input.tenantId).eq("id", input.keyId).maybeSingle<Row>();
    if (key.error) throw new Error(`Could not load that key: ${key.error.message}`);
    if (!key.data) throw new Error("That posting key is not yours, or no longer exists.");
    const held = await activeKeyFor(input.tenantId, text(key.data.vendor_id), input.keyId);
    if (held) {
      const vendor = await db().from("tenant_lead_vendors").select("name").eq("tenant_id", input.tenantId).eq("id", text(key.data.vendor_id)).maybeSingle<Row>();
      throw new PostKeyConflictError(oneKeyMessage(text(vendor.data?.name), text(held.key_prefix)));
    }
  }
  const result = await db()
    .from("tenant_vendor_post_keys")
    .update({ is_active: input.isActive })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.keyId)
    .select(BASE_COLUMNS)
    .maybeSingle<Row>();
  if (result.error?.code === "23505") throw new PostKeyConflictError(oneKeyMessage("", "another"));
  if (result.error) throw new Error(`Could not change that key: ${result.error.message}`);
  if (!result.data) throw new Error("That posting key is not yours, or no longer exists.");
  return toKey(result.data, "");
}

/**
 * Save a field map (and, when given, its notes). The map is stored canonically — `{ ours: theirs }`
 * — so a map saved from this screen is never read by the tolerant fallback again.
 *
 * Set per vendor: the map is written to every key the vendor holds, because it describes the shape
 * of the vendor's payload, and a vendor's second key (a second campaign, a rotation) posts the same
 * payload. The key id only names which vendor.
 */
export async function updatePostKeyFieldMap(input: {
  tenantId: string;
  keyId: string;
  fieldMap: Record<string, string>;
  fieldNotes?: Record<string, string>;
}): Promise<{ keys: number }> {
  const client = db();
  const key = await client
    .from("tenant_vendor_post_keys")
    .select("id, vendor_id")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.keyId)
    .maybeSingle<Row>();
  if (key.error) throw new Error(`Could not load that key: ${key.error.message}`);
  if (!key.data) throw new Error("That posting key is not yours, or no longer exists.");

  const patch: Row = { field_map: canonicalFieldMap(readFieldMap(input.fieldMap)) };
  if (input.fieldNotes !== undefined) patch.field_notes = input.fieldNotes;
  const result = (await (client
    .from("tenant_vendor_post_keys")
    .update(patch)
    .eq("tenant_id", input.tenantId)
    .eq("vendor_id", text(key.data.vendor_id))
    .select("id") as unknown as PromiseLike<Result<Row[]>>)) as Result<Row[]>;
  if (result.error) {
    if (isMissingSchema(result.error)) throw new SchemaPendingError();
    throw new Error(`Could not save the field map: ${result.error.message}`);
  }
  if (!result.data?.length) throw new Error("That posting key is not yours, or no longer exists.");
  return { keys: result.data.length };
}

/** Bind a key to one of its vendor's campaigns, or unbind it (null). */
export async function setPostKeyCampaign(input: { tenantId: string; keyId: string; campaignId: string | null }): Promise<void> {
  const client = db();
  const key = await client
    .from("tenant_vendor_post_keys")
    .select("id, vendor_id")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.keyId)
    .maybeSingle<Row>();
  if (key.error) throw new Error(`Could not load that key: ${key.error.message}`);
  if (!key.data) throw new Error("That posting key is not yours, or no longer exists.");
  if (input.campaignId) await assertVendorCampaign(input.tenantId, text(key.data.vendor_id), input.campaignId);

  const result = await client
    .from("tenant_vendor_post_keys")
    .update({ campaign_id: input.campaignId })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.keyId)
    .select("id")
    .maybeSingle<Row>();
  if (result.error) {
    if (isMissingSchema(result.error)) throw new SchemaPendingError();
    throw new Error(`Could not bind that campaign: ${result.error.message}`);
  }
}

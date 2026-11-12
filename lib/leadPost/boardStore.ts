import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { chooseProductTemplate, type TemplateCandidate } from "@/lib/agentTemplates/templateChoice";
import { applyFieldMap, isKnownLeadField, readFieldMap } from "./fieldMap";
import { checkSample, guessFieldMap } from "./sampleCheck";
import { normalisePhone } from "./service";
import { isMissingSchema, SchemaPendingError } from "./schemaGap";
import { listPostKeys } from "./keys";
import {
  callbackUrlProblem,
  leadLabel,
  productWords,
  readPostingHours,
  startOfDayIn,
  vendorStatus,
  type BoardCampaign,
  type LeadPostBoard,
  type PostingHours,
  type VendorCounts,
  type VendorRow,
  type VendorSettings,
} from "./board";
import type { PostKey } from "./types";

/**
 * Settings › Lead posting, round 8 option A: what the vendor table, the vendor sheet and the
 * "Connect a vendor" wizard read and write beyond lib/leadPost/keys.ts.
 *
 * Migration 20261112100100 adds the per-vendor settings (test mode, price, cap, hours, status
 * callback, grace window, notes, instructions tracking) and `is_test` on the log. Until it is
 * applied `leadPostR8Ready` is false, the board's `settings` are null, the reads below fall back to
 * the older columns, and every write that needs a new column throws SchemaPendingError.
 */

type Result<T = unknown> = { data: T | null; error: { message: string; code?: string } | null; count?: number | null };
type Row = Record<string, unknown>;
interface Q extends PromiseLike<Result<Row[]>> {
  select(columns: string, options?: { count?: "exact"; head?: boolean }): Q;
  eq(column: string, value: unknown): Q;
  neq(column: string, value: unknown): Q;
  in(column: string, values: unknown[]): Q;
  gte(column: string, value: unknown): Q;
  lt(column: string, value: unknown): Q;
  not(column: string, operator: string, value: unknown): Q;
  order(column: string, options?: { ascending?: boolean }): Q;
  limit(n: number): Q;
  range(from: number, to: number): Q;
  insert(values: unknown): Q;
  update(values: unknown): Q;
  maybeSingle(): PromiseLike<Result<Row>>;
}
type Db = { from(table: string): Q; rpc(name: string, args: Record<string, unknown>): PromiseLike<Result<unknown>> };
const db = () => getSupabaseServiceClient() as unknown as Db;

const text = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const rowsOf = (result: Result<Row[]>) => (Array.isArray(result.data) ? result.data : []);

export const R8_COLUMNS =
  "test_mode, price_cents, daily_cap, posting_hours, status_callback_url, status_callback_events, status_callback_last_at, status_callback_last_status, grace_until, notes, instructions_email, instructions_sent_at, instructions_token_hash, instructions_opened_count, instructions_last_opened_at";

/** True once 20261112100100 is applied. One cheap read; a missing column is the answer "no". */
export async function leadPostR8Ready(): Promise<boolean> {
  const probe = await db().from("tenant_vendor_post_keys").select("test_mode").limit(1);
  if (!probe.error) return true;
  if (isMissingSchema(probe.error)) return false;
  throw new Error(`Could not check the posting keys: ${probe.error.message}`);
}

export function settingsOf(row: Row): VendorSettings {
  const events = Array.isArray(row.status_callback_events) ? (row.status_callback_events as unknown[]).filter((value): value is string => typeof value === "string") : [];
  return {
    testMode: row.test_mode === true,
    priceCents: num(row.price_cents),
    dailyCap: num(row.daily_cap),
    postingHours: readPostingHours(row.posting_hours),
    callbackUrl: text(row.status_callback_url) || null,
    callbackEvents: events,
    callbackLastAt: text(row.status_callback_last_at) || null,
    callbackLastStatus: num(row.status_callback_last_status),
    graceUntil: text(row.grace_until) || null,
    notes: text(row.notes),
    instructionsEmail: text(row.instructions_email) || null,
    instructionsSentAt: text(row.instructions_sent_at) || null,
    instructionsOpened: num(row.instructions_opened_count) ?? 0,
    instructionsLastOpenedAt: text(row.instructions_last_opened_at) || null,
    instructionsLink: Boolean(text(row.instructions_token_hash)),
  };
}

/** The agency's own name for the vendor's instructions: trading name, legal name, then the workspace's. */
export async function agencyName(tenantId: string): Promise<string> {
  const client = db();
  const profile = await client.from("agency_profiles").select("dba, legal_name").eq("tenant_id", tenantId).maybeSingle();
  const name = text(profile.data?.dba).trim() || text(profile.data?.legal_name).trim();
  if (name) return name;
  const tenant = await client.from("tenants").select("name").eq("id", tenantId).maybeSingle();
  return text(tenant.data?.name).trim() || "our agency";
}

/** Active intake templates by product code: the form an accepted post's lead is opened with. */
async function intakeTemplates(productCodes: string[]): Promise<Map<string, TemplateCandidate>> {
  const out = new Map<string, TemplateCandidate>();
  if (productCodes.length === 0) return out;
  const read = await db().from("templates").select("id, name, product_code, version, is_active, updated_at, created_at").in("product_code", productCodes).eq("is_active", true);
  if (read.error) return out;
  const byProduct = new Map<string, TemplateCandidate[]>();
  for (const row of rowsOf(read)) {
    const candidate: TemplateCandidate = {
      id: text(row.id),
      name: text(row.name),
      product_code: text(row.product_code),
      version: num(row.version) ?? 1,
      is_active: row.is_active === true,
      updated_at: text(row.updated_at) || null,
      created_at: text(row.created_at) || null,
    };
    byProduct.set(candidate.product_code, [...(byProduct.get(candidate.product_code) ?? []), candidate]);
  }
  for (const [code, candidates] of byProduct) {
    const chosen = chooseProductTemplate(candidates);
    if (chosen) out.set(code, chosen);
  }
  return out;
}

/** The product a campaign's posts are for: its product code, else term life (the post path's default). */
export const postedProduct = (productCode: string | null) => productCode || "term_life";

async function boardCampaigns(tenantId: string, base: { id: string; name: string; vendorId: string; status: string }[]): Promise<BoardCampaign[]> {
  const client = db();
  const [details, servable, products] = await Promise.all([
    client.from("tenant_campaigns").select("id, product_code").eq("tenant_id", tenantId),
    client.from("campaigns_servable").select("id").eq("tenant_id", tenantId),
    client.from("products").select("code, name"),
  ]);
  const productOf = new Map(rowsOf(details).map((row) => [text(row.id), text(row.product_code) || null]));
  const servableIds = new Set(rowsOf(servable).map((row) => text(row.id)));
  const productName = new Map(rowsOf(products).map((row) => [text(row.code), text(row.name)]));
  const codes = [...new Set(base.map((campaign) => postedProduct(productOf.get(campaign.id) ?? null)))];
  const templates = await intakeTemplates(codes);
  return base.map((campaign) => {
    const productCode = productOf.get(campaign.id) ?? null;
    const code = postedProduct(productCode);
    return {
      ...campaign,
      productCode,
      productLabel: productName.get(code) || productWords(code),
      intakeForm: templates.has(code),
      servable: servableIds.has(campaign.id),
    };
  });
}

type LogRow = { vendorId: string; keyId: string | null; outcome: string; reasonCode: string; receivedAt: string; isTest: boolean };

/** The last 7 days of the log, without payloads. Read in pages; a busier week is capped and says so in the counts. */
async function weekOfPosts(tenantId: string, since: string, r8Ready: boolean): Promise<LogRow[]> {
  const out: LogRow[] = [];
  const columns = `vendor_id, key_id, outcome, reason_code, received_at${r8Ready ? ", is_test" : ""}`;
  for (let from = 0; from < 20_000; from += 1000) {
    let page = await db().from("tenant_lead_post_log").select(columns).eq("tenant_id", tenantId).gte("received_at", since).order("received_at", { ascending: false }).range(from, from + 999);
    if (page.error && isMissingSchema(page.error)) page = await db().from("tenant_lead_post_log").select("vendor_id, outcome, reason_code, received_at").eq("tenant_id", tenantId).gte("received_at", since).order("received_at", { ascending: false }).range(from, from + 999);
    if (page.error) throw new Error(`Could not read recent posts: ${page.error.message}`);
    const rows = rowsOf(page);
    for (const row of rows) {
      out.push({ vendorId: text(row.vendor_id), keyId: text(row.key_id) || null, outcome: text(row.outcome), reasonCode: text(row.reason_code), receivedAt: text(row.received_at), isTest: row.is_test === true });
    }
    if (rows.length < 1000) break;
  }
  return out;
}

/** Each connected vendor's last payload, top-level names only, for the "fields not read" check. */
async function lastPayloadKeys(tenantId: string, vendorIds: string[]): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  await Promise.all(
    vendorIds.map(async (vendorId) => {
      const read = await db().from("tenant_lead_post_log").select("raw_payload").eq("tenant_id", tenantId).eq("vendor_id", vendorId).order("received_at", { ascending: false }).limit(1);
      const payload = rowsOf(read)[0]?.raw_payload;
      if (payload && typeof payload === "object" && !Array.isArray(payload)) out.set(vendorId, payload as Record<string, unknown>);
    }),
  );
  return out;
}

const zero = (): VendorCounts => ({ posts: 0, accepted: 0, refused: 0, tests: 0 });

/** The whole board: one row per vendor that holds or held a key, the figures, the wizard's lists. */
export async function loadBoard(tenantId: string, timeZone: string): Promise<LeadPostBoard> {
  const client = db();
  const [base, r8Ready] = await Promise.all([listPostKeys(tenantId, { stats: false }), leadPostR8Ready()]);
  const now = new Date();
  const weekStart = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const dayStart = startOfDayIn(timeZone, now).toISOString();

  const [campaigns, posts, settingsRows, vendorKinds, name] = await Promise.all([
    boardCampaigns(tenantId, base.campaigns),
    weekOfPosts(tenantId, weekStart, r8Ready),
    r8Ready ? client.from("tenant_vendor_post_keys").select(`id, ${R8_COLUMNS}`).eq("tenant_id", tenantId) : Promise.resolve({ data: [], error: null } as Result<Row[]>),
    client.from("tenant_lead_vendors").select("id, lead_type").eq("tenant_id", tenantId),
    agencyName(tenantId),
  ]);
  const settingsByKey = new Map(rowsOf(settingsRows as Result<Row[]>).map((row) => [text(row.id), settingsOf(row)]));
  const kindOf = new Map(rowsOf(vendorKinds).map((row) => [text(row.id), text(row.lead_type)]));

  const keysByVendor = new Map<string, PostKey[]>();
  for (const key of base.keys) keysByVendor.set(key.vendorId, [...(keysByVendor.get(key.vendorId) ?? []), key]);
  const payloads = await lastPayloadKeys(tenantId, [...keysByVendor.keys()]);

  let spend: number | null = r8Ready ? 0 : null;
  const figures = { postsToday: 0, acceptedToday: 0, refusedToday: 0, spendTodayCents: spend };

  const vendors: VendorRow[] = [...keysByVendor.entries()].map(([vendorId, keys]) => {
    const active = keys.find((key) => key.isActive) ?? null;
    const key = active ?? keys[0];
    const settings = settingsByKey.get(key.id) ?? null;
    const today = zero();
    const week = zero();
    const reasons = new Map<string, number>();
    let lastPostAt: string | null = null;
    let lastPostWasTest = false;
    for (const post of posts) {
      if (post.vendorId !== vendorId) continue;
      if (!lastPostAt) {
        lastPostAt = post.receivedAt;
        lastPostWasTest = post.isTest;
      }
      const isToday = post.receivedAt >= dayStart;
      if (post.isTest) {
        week.tests += 1;
        if (isToday) today.tests += 1;
        continue;
      }
      week.posts += 1;
      if (isToday) today.posts += 1;
      if (post.outcome === "accepted") {
        week.accepted += 1;
        if (isToday) today.accepted += 1;
      } else {
        week.refused += 1;
        if (isToday) today.refused += 1;
        reasons.set(post.reasonCode, (reasons.get(post.reasonCode) ?? 0) + 1);
      }
    }
    if (!lastPostAt) lastPostAt = keys.map((item) => item.lastUsedAt).filter(Boolean).sort().reverse()[0] ?? null;
    figures.postsToday += today.posts;
    figures.acceptedToday += today.accepted;
    figures.refusedToday += today.refused;
    if (spend !== null && settings?.priceCents) spend += today.accepted * settings.priceCents;

    const payload = payloads.get(vendorId);
    const stored = readFieldMap(key.fieldMap);
    const unreadGuesses = payload ? guessFieldMap(payload, stored).filter((guess) => guess.ours !== guess.theirs) : [];
    const campaign = key.campaignId ? campaigns.find((item) => item.id === key.campaignId) : campaigns.find((item) => item.vendorId === vendorId && item.servable);
    const weekReasons = [...reasons.entries()].map(([reasonCode, count]) => ({ reasonCode, count })).sort((a, b) => b.count - a.count);
    const { status, needsYou } = vendorStatus({
      hasActiveKey: Boolean(active) || Boolean(settings?.graceUntil && settings.graceUntil > now.toISOString()),
      testMode: settings?.testMode ?? false,
      campaignServable: campaign ? campaign.servable : key.campaignId ? false : null,
      everPosted: Boolean(lastPostAt),
      week,
      weekReasons,
      unreadGuesses: unreadGuesses.length,
    });
    return { vendorId, vendorName: key.vendorName, key, keys, settings, today, week, weekReasons, lastPostAt, lastPostWasTest, status, needsYou, unreadGuesses };
  });
  figures.spendTodayCents = spend;

  const order: Record<string, number> = { needs_you: 0, live: 1, testing: 2, waiting: 3, paused: 4, revoked: 5 };
  vendors.sort((a, b) => order[a.status] - order[b.status] || b.today.posts - a.today.posts || a.vendorName.localeCompare(b.vendorName));

  return {
    vendors,
    allVendors: base.vendors.map((vendor) => ({ ...vendor, leadType: kindOf.get(vendor.id) ?? "", connected: (keysByVendor.get(vendor.id) ?? []).some((key) => key.isActive) })),
    campaigns,
    figures,
    schemaReady: base.schemaReady,
    r8Ready,
    agencyName: name,
    postingPath: `/api/post/${tenantId}`,
    readAt: now.toISOString(),
  };
}

/** One key of this tenant, with its vendor; throws a sentence when it is not here. */
async function keyRow(tenantId: string, keyId: string, extra = ""): Promise<Row> {
  const columns = `id, vendor_id, field_map, campaign_id, is_active${extra ? `, ${extra}` : ""}`;
  let read = await db().from("tenant_vendor_post_keys").select(columns).eq("tenant_id", tenantId).eq("id", keyId).maybeSingle();
  if (read.error && isMissingSchema(read.error)) read = await db().from("tenant_vendor_post_keys").select("id, vendor_id, field_map, is_active").eq("tenant_id", tenantId).eq("id", keyId).maybeSingle();
  if (read.error) throw new Error(`Could not load that key: ${read.error.message}`);
  if (!read.data) throw new Error("That posting key is not yours, or no longer exists.");
  return read.data;
}

/** The campaign a key's posts land on: the bound one, else the vendor's first servable one. */
async function landingCampaign(tenantId: string, key: Row): Promise<{ id: string; name: string; productCode: string | null; servable: boolean } | null> {
  const client = db();
  const campaignId = text(key.campaign_id);
  if (campaignId) {
    const [campaign, servable] = await Promise.all([
      client.from("tenant_campaigns").select("id, name, product_code").eq("tenant_id", tenantId).eq("id", campaignId).maybeSingle(),
      client.from("campaigns_servable").select("id").eq("tenant_id", tenantId).eq("id", campaignId).limit(1),
    ]);
    if (!campaign.data) return null;
    return { id: campaignId, name: text(campaign.data.name), productCode: text(campaign.data.product_code) || null, servable: rowsOf(servable).length > 0 };
  }
  const servable = await client.from("campaigns_servable").select("id, name, product_code").eq("tenant_id", tenantId).eq("vendor_id", text(key.vendor_id)).limit(1);
  const row = rowsOf(servable)[0];
  return row ? { id: text(row.id), name: text(row.name), productCode: text(row.product_code) || null, servable: true } : null;
}

export type FormQuestion = { key: string; label: string };

/** The questions of the intake form a vendor's leads are opened with, that are not already one of our lead fields. */
async function formQuestionsFor(productCode: string | null): Promise<{ questions: FormQuestion[]; formName: string | null }> {
  const code = postedProduct(productCode);
  const template = (await intakeTemplates([code])).get(code);
  if (!template) return { questions: [], formName: null };
  const read = await db().from("template_fields").select("field_key, label, sort_order").eq("template_id", template.id).eq("version", template.version).order("sort_order", { ascending: true });
  const questions = rowsOf(read)
    .map((row) => ({ key: text(row.field_key), label: text(row.label) }))
    .filter((question) => question.key && !isKnownLeadField(question.key));
  return { questions, formName: template.name };
}

export type VendorSample = {
  /** Their top-level fields (one level of nesting flattened to dotted names) with an example value each. */
  fields: { name: string; example: string }[];
  receivedAt: string | null;
  formQuestions: FormQuestion[];
  formName: string | null;
  campaignName: string | null;
  productLabel: string;
};

const exampleOf = (value: unknown) => {
  const raw = typeof value === "string" ? value : value === null || value === undefined ? "" : JSON.stringify(value);
  return raw.length > 48 ? `${raw.slice(0, 47)}…` : raw;
};

/**
 * Their last post's field names and example values, for the field map. Owner only (the route's
 * gate): a refused post's values are only ever shown to the person disputing it.
 */
export async function vendorSample(tenantId: string, keyId: string): Promise<VendorSample> {
  const key = await keyRow(tenantId, keyId);
  const [last, campaign] = await Promise.all([
    db().from("tenant_lead_post_log").select("raw_payload, received_at").eq("tenant_id", tenantId).eq("vendor_id", text(key.vendor_id)).order("received_at", { ascending: false }).limit(1),
    landingCampaign(tenantId, key),
  ]);
  const row = rowsOf(last)[0];
  const payload = row?.raw_payload && typeof row.raw_payload === "object" && !Array.isArray(row.raw_payload) ? (row.raw_payload as Record<string, unknown>) : null;
  const fields: { name: string; example: string }[] = [];
  for (const [name, value] of Object.entries(payload ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [inner, innerValue] of Object.entries(value as Record<string, unknown>)) fields.push({ name: `${name}.${inner}`, example: exampleOf(innerValue) });
    } else {
      fields.push({ name, example: exampleOf(value) });
    }
  }
  const form = await formQuestionsFor(campaign?.productCode ?? null);
  return {
    fields: fields.slice(0, 80),
    receivedAt: text(row?.received_at) || null,
    formQuestions: form.questions,
    formName: form.formName,
    campaignName: campaign?.name ?? null,
    productLabel: productWords(postedProduct(campaign?.productCode ?? null)),
  };
}

export type RefusedPost = { receivedAt: string; vendorId: string; vendorName: string; reasonCode: string; lead: string; isTest: boolean };

/** Refused posts in a window, newest first, each with only "Martha R. · TX" of the person. */
export async function refusedPosts(tenantId: string, days: 1 | 7 | 30, timeZone: string): Promise<{ rows: RefusedPost[]; capped: boolean }> {
  const since = days === 1 ? startOfDayIn(timeZone).toISOString() : new Date(Date.now() - days * 86_400_000).toISOString();
  const r8Ready = await leadPostR8Ready();
  const [keys, vendors] = await Promise.all([
    db().from("tenant_vendor_post_keys").select("vendor_id, field_map, is_active, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
    db().from("tenant_lead_vendors").select("id, name").eq("tenant_id", tenantId),
  ]);
  const mapOf = new Map<string, Record<string, unknown>>();
  for (const row of rowsOf(keys)) if (!mapOf.has(text(row.vendor_id)) || row.is_active === true) mapOf.set(text(row.vendor_id), (row.field_map as Record<string, unknown>) ?? {});
  const nameOf = new Map(rowsOf(vendors).map((row) => [text(row.id), text(row.name)]));
  const LIMIT = 500;
  let query = db().from("tenant_lead_post_log").select(`received_at, vendor_id, reason_code, raw_payload${r8Ready ? ", is_test" : ""}`).eq("tenant_id", tenantId).eq("outcome", "rejected").gte("received_at", since);
  if (r8Ready) query = query.eq("is_test", false);
  const read = await query.order("received_at", { ascending: false }).limit(LIMIT + 1);
  if (read.error) throw new Error(`Could not load refused posts: ${read.error.message}`);
  const rows = rowsOf(read);
  return {
    capped: rows.length > LIMIT,
    rows: rows.slice(0, LIMIT).map((row) => {
      const payload = row.raw_payload && typeof row.raw_payload === "object" && !Array.isArray(row.raw_payload) ? (row.raw_payload as Record<string, unknown>) : {};
      const vendorId = text(row.vendor_id);
      return {
        receivedAt: text(row.received_at),
        vendorId,
        vendorName: nameOf.get(vendorId) || "Vendor no longer on your list",
        reasonCode: text(row.reason_code),
        lead: leadLabel(applyFieldMap(payload, mapOf.get(vendorId) ?? {})),
        isTest: row.is_test === true,
      };
    }),
  };
}

// ── the vendor's settings ────────────────────────────────────────────────────

export type SettingsPatch = {
  priceCents?: number | null;
  dailyCap?: number | null;
  postingHours?: PostingHours | null;
  callbackUrl?: string | null;
  callbackEvents?: string[];
  notes?: string;
  testMode?: boolean;
  instructionsEmail?: string | null;
};

/** Save the round-8 settings on every key the vendor holds (they describe the vendor, not one key). */
export async function updateVendorSettings(tenantId: string, keyId: string, patch: SettingsPatch): Promise<void> {
  if (!(await leadPostR8Ready())) throw new SchemaPendingError();
  const key = await keyRow(tenantId, keyId);
  const row: Row = {};
  if (patch.priceCents !== undefined) row.price_cents = patch.priceCents;
  if (patch.dailyCap !== undefined) row.daily_cap = patch.dailyCap;
  if (patch.postingHours !== undefined) row.posting_hours = patch.postingHours;
  if (patch.callbackUrl !== undefined) {
    const problem = patch.callbackUrl ? callbackUrlProblem(patch.callbackUrl) : null;
    if (problem) throw new Error(problem);
    row.status_callback_url = patch.callbackUrl || null;
  }
  if (patch.callbackEvents !== undefined) row.status_callback_events = patch.callbackEvents.filter((event) => event === "accepted" || event === "refused");
  if (patch.notes !== undefined) row.notes = patch.notes.trim() || null;
  if (patch.testMode !== undefined) row.test_mode = patch.testMode;
  if (patch.instructionsEmail !== undefined) row.instructions_email = patch.instructionsEmail;
  if (Object.keys(row).length === 0) return;
  const result = await db().from("tenant_vendor_post_keys").update(row).eq("tenant_id", tenantId).eq("vendor_id", text(key.vendor_id)).select("id");
  if (result.error) {
    if (isMissingSchema(result.error)) throw new SchemaPendingError();
    throw new Error(`Could not save ${text(key.vendor_id) ? "the vendor's settings" : "that"}: ${result.error.message}`);
  }
}

/** "Sent to dev@… on …": recorded when the owner emails the instructions. */
export async function markInstructionsSent(tenantId: string, keyId: string, email: string | null): Promise<void> {
  if (!(await leadPostR8Ready())) throw new SchemaPendingError();
  const key = await keyRow(tenantId, keyId);
  const result = await db()
    .from("tenant_vendor_post_keys")
    .update({ instructions_email: email, instructions_sent_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("vendor_id", text(key.vendor_id))
    .select("id");
  if (result.error) throw new Error(`Could not record the instructions: ${result.error.message}`);
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * A public link to the vendor's instructions. The token is returned once; only its hash is stored
 * (on the vendor's active key), and making a new link retires the old one.
 */
export async function makeInstructionsLink(tenantId: string, keyId: string): Promise<string> {
  if (!(await leadPostR8Ready())) throw new SchemaPendingError();
  await keyRow(tenantId, keyId);
  const token = randomBytes(18).toString("base64url");
  const result = await db().from("tenant_vendor_post_keys").update({ instructions_token_hash: hashToken(token), instructions_opened_count: 0, instructions_last_opened_at: null }).eq("tenant_id", tenantId).eq("id", keyId).select("id");
  if (result.error) {
    if (isMissingSchema(result.error)) throw new SchemaPendingError();
    throw new Error(`Could not make the link: ${result.error.message}`);
  }
  return token;
}

/** The public page's read: the guide's inputs for a token, counting the open. Null for an unknown token. */
export async function openInstructions(workspaceId: string, token: string): Promise<{ agencyName: string; vendorName: string; campaignName: string | null; fieldMap: Record<string, string> } | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const read = await db().from("tenant_vendor_post_keys").select("id, tenant_id, vendor_id, field_map, campaign_id, is_active, instructions_opened_count").eq("instructions_token_hash", hashToken(token)).maybeSingle();
  if (read.error || !read.data) return null;
  const key = read.data;
  if (text(key.tenant_id) !== workspaceId || key.is_active !== true) return null;
  await db().from("tenant_vendor_post_keys").update({ instructions_opened_count: (num(key.instructions_opened_count) ?? 0) + 1, instructions_last_opened_at: new Date().toISOString() }).eq("id", text(key.id)).select("id");
  const [vendor, campaign, name] = await Promise.all([
    db().from("tenant_lead_vendors").select("name").eq("id", text(key.vendor_id)).maybeSingle(),
    landingCampaign(workspaceId, key),
    agencyName(workspaceId),
  ]);
  return { agencyName: name, vendorName: text(vendor.data?.name), campaignName: campaign?.name ?? null, fieldMap: (key.field_map as Record<string, string>) ?? {} };
}

/** The guide's inputs for the owner (copy, PDF): the key's vendor, campaign and map. */
export async function guideInputFor(tenantId: string, keyId: string | null): Promise<{ agencyName: string; vendorName: string | null; campaignName: string | null; fieldMap: Record<string, string>; formQuestions: { key: string; label: string; theirs?: string | null }[] }> {
  const name = await agencyName(tenantId);
  if (!keyId) return { agencyName: name, vendorName: null, campaignName: null, fieldMap: {}, formQuestions: [] };
  const key = await keyRow(tenantId, keyId);
  const [vendor, campaign] = await Promise.all([
    db().from("tenant_lead_vendors").select("name").eq("tenant_id", tenantId).eq("id", text(key.vendor_id)).maybeSingle(),
    landingCampaign(tenantId, key),
  ]);
  const map = (key.field_map as Record<string, string>) ?? {};
  const form = await formQuestionsFor(campaign?.productCode ?? null);
  const mapped = new Map(readFieldMap(map).map((entry) => [entry.ours, entry.theirs]));
  return {
    agencyName: name,
    vendorName: text(vendor.data?.name) || null,
    campaignName: campaign?.name ?? null,
    fieldMap: map,
    formQuestions: form.questions.filter((question) => mapped.has(question.key)).map((question) => ({ ...question, theirs: mapped.get(question.key) })),
  };
}

// ── a test post, from here ─────────────────────────────────────────────────────

export type TestCheck = { label: string; ok: boolean; detail: string };
export type TestResult = {
  accepted: boolean;
  reasonCode: string;
  message: string;
  checks: TestCheck[];
  /** "Martha Reyes", for "would make the lead …". */
  leadName: string;
  campaignName: string | null;
  state: string | null;
  ms: number | null;
  at: string;
  /** True when the run was written to the log as a test post (needs 20261112100100). */
  logged: boolean;
  /** Their fields that look like ours but are not read, with the map entry that would read them. */
  suggestions: { theirs: string; ours: string }[];
};

/**
 * Every check a real post runs that can be run without side effects — the field checks, the
 * campaign, the licence, the agency's own suppression lists and the duplicate check — stopping
 * before a lead, a charge or a metered screening. With 20261112100100 applied it is kept in the
 * log as a test post (never counted as a lead, spend or a rejection).
 */
export async function testPost(input: { tenantId: string; keyId: string; payload: Record<string, unknown>; fieldMap?: Record<string, string> | null }): Promise<TestResult> {
  const started = Date.now();
  const client = db();
  const key = await keyRow(input.tenantId, input.keyId);
  const map = input.fieldMap ?? ((key.field_map as Record<string, string>) ?? {});
  const fields = checkSample(input.payload, map);
  const values = applyFieldMap(input.payload, map);
  const checks: TestCheck[] = [{ label: "Key", ok: key.is_active === true, detail: key.is_active === true ? "Active" : "This key is revoked" }, ...fields.checks.map((check) => ({ label: check.label, ok: check.ok, detail: check.detail }))];
  let reasonCode: string | null = key.is_active === true ? fields.reasonCode : "unauthorised";
  const phone = normalisePhone(values.phone ?? values.phone_number ?? values.primary_phone);
  const state = typeof values.state === "string" && /^[A-Za-z]{2}$/.test(values.state.trim()) ? values.state.trim().toUpperCase() : null;

  const campaign = await landingCampaign(input.tenantId, key);
  checks.push(campaign?.servable ? { label: "Campaign open", ok: true, detail: campaign.name } : { label: "Campaign open", ok: false, detail: campaign ? `${campaign.name} is not active and scrubbed` : "No active, scrubbed campaign for this vendor" });
  if (!reasonCode && !campaign?.servable) reasonCode = "campaign_not_accepting";

  if (state) {
    const licence = await client.from("licenses").select("expires_at").eq("tenant_id", input.tenantId).eq("state", state).maybeSingle();
    const today = new Date().toISOString().slice(0, 10);
    const expires = text(licence.data?.expires_at);
    const ok = Boolean(licence.data) && (!expires || expires >= today);
    checks.push({ label: `${state} licence`, ok, detail: ok ? "Current" : licence.data ? "Expired" : `No ${state} licence on file` });
    if (!reasonCode && !ok) reasonCode = "state_not_licensed";
  }

  if (phone) {
    const scrub = await client.rpc("is_phone_suppressed", { p_tenant_id: input.tenantId, p_phone: phone });
    const hit = (Array.isArray(scrub.data) ? scrub.data[0] : scrub.data) as { suppressed?: boolean; list_type?: string } | null;
    if (scrub.error) checks.push({ label: "Do Not Call", ok: true, detail: "Your lists could not be read; a real post retries" });
    else checks.push({ label: "Do Not Call", ok: !hit?.suppressed, detail: hit?.suppressed ? `On your ${hit.list_type ?? "suppression"} list` : "Not on your lists · national lists are checked on real posts" });
    if (!reasonCode && hit?.suppressed) reasonCode = hit.list_type === "tcpa_litigator" ? "suppressed_litigator" : hit.list_type === "internal" ? "suppressed_internal" : "suppressed_dnc";

    const existing = await client.from("agent_leads").select("id").eq("tenant_id", input.tenantId).eq("values->>phone", phone).limit(1);
    const duplicate = rowsOf(existing).length > 0;
    checks.push({ label: "Not a duplicate", ok: !duplicate, detail: duplicate ? "This phone is already one of your leads" : "New to you" });
    if (!reasonCode && duplicate) reasonCode = "duplicate";
  }

  if (campaign) {
    const code = postedProduct(typeof values.product_line === "string" ? values.product_line : campaign.productCode);
    const form = (await intakeTemplates([code])).has(code);
    checks.push({ label: "Intake form", ok: form, detail: form ? productWords(code) : `No intake form for ${productWords(code)}` });
    if (!reasonCode && !form) reasonCode = "campaign_not_accepting";
  }

  const first = typeof values.first_name === "string" ? values.first_name.trim() : "";
  const last = typeof values.last_name === "string" ? values.last_name.trim() : "";
  const leadName = [first, last].filter(Boolean).join(" ") || (typeof values.full_name === "string" ? values.full_name : "") || "The test lead";
  const accepted = !reasonCode;
  const at = new Date().toISOString();

  let logged = false;
  if (await leadPostR8Ready()) {
    const write = await client.from("tenant_lead_post_log").insert({
      tenant_id: input.tenantId,
      vendor_id: text(key.vendor_id),
      key_id: text(key.id),
      campaign_id: campaign?.id ?? null,
      completed_at: at,
      outcome: accepted ? "accepted" : "rejected",
      reason_code: reasonCode ?? "accepted",
      lead_id: null,
      raw_payload: { ...input.payload, _insurvas_test: "sent from Settings" },
      processing_ms: Date.now() - started,
      http_status: accepted ? 200 : 422,
      is_test: true,
    });
    logged = !write.error;
  }

  return {
    accepted,
    reasonCode: reasonCode ?? "accepted",
    message: accepted ? "Every check passed." : (checks.find((check) => !check.ok)?.detail ?? "Refused"),
    checks,
    leadName,
    campaignName: campaign?.name ?? null,
    state,
    ms: Date.now() - started,
    at,
    logged,
    suggestions: guessFieldMap(input.payload, readFieldMap(map)).filter((guess) => guess.ours !== guess.theirs),
  };
}

/** Test posts (theirs and ours) on a vendor's keys, newest first. Empty until 20261112100100. */
export async function testHistory(tenantId: string, keyId: string): Promise<{ at: string; accepted: boolean; reasonCode: string; ms: number | null; ours: boolean; payloadNote: string }[]> {
  if (!(await leadPostR8Ready())) return [];
  const key = await keyRow(tenantId, keyId);
  const read = await db().from("tenant_lead_post_log").select("received_at, outcome, reason_code, processing_ms, raw_payload").eq("tenant_id", tenantId).eq("vendor_id", text(key.vendor_id)).eq("is_test", true).order("received_at", { ascending: false }).limit(20);
  return rowsOf(read).map((row) => {
    const payload = row.raw_payload && typeof row.raw_payload === "object" ? (row.raw_payload as Record<string, unknown>) : {};
    return {
      at: text(row.received_at),
      accepted: text(row.outcome) === "accepted",
      reasonCode: text(row.reason_code),
      ms: num(row.processing_ms),
      ours: payload._insurvas_test !== undefined,
      payloadNote: leadLabel(applyFieldMap(payload, (key.field_map as Record<string, string>) ?? {})),
    };
  });
}

// ── keys: what round 8 adds around rotate, revoke and connect ─────────────────

/**
 * After a rotation: the vendor's settings travel to the new key (rotate_vendor_post_key copies only
 * the map, notes and campaign), and with a grace window the old key keeps working until it ends.
 * A no-op before 20261112100100; a grace request then is refused before the rotation by the route.
 */
export async function afterRotate(tenantId: string, oldKeyId: string, newKeyId: string, graceHours: number): Promise<{ graceUntil: string | null }> {
  if (!(await leadPostR8Ready())) return { graceUntil: null };
  const client = db();
  const old = await client.from("tenant_vendor_post_keys").select(R8_COLUMNS).eq("tenant_id", tenantId).eq("id", oldKeyId).maybeSingle();
  if (old.data) {
    const copy: Row = {};
    for (const column of ["test_mode", "price_cents", "daily_cap", "posting_hours", "status_callback_url", "status_callback_events", "notes", "instructions_email", "instructions_sent_at"]) copy[column] = old.data[column] ?? null;
    if (copy.status_callback_events === null) copy.status_callback_events = [];
    if (copy.test_mode === null) copy.test_mode = false;
    await client.from("tenant_vendor_post_keys").update(copy).eq("tenant_id", tenantId).eq("id", newKeyId).select("id");
  }
  if (graceHours <= 0) return { graceUntil: null };
  const graceUntil = new Date(Date.now() + graceHours * 3_600_000).toISOString();
  const result = await client.from("tenant_vendor_post_keys").update({ grace_until: graceUntil }).eq("tenant_id", tenantId).eq("id", oldKeyId).select("id");
  if (result.error) throw new Error(`The key was rotated, but the old key's grace window could not be set: ${result.error.message}. The old key has stopped working.`);
  return { graceUntil };
}

/** Revoking ends every grace window the vendor's older keys still have. */
export async function endGrace(tenantId: string, keyId: string): Promise<void> {
  if (!(await leadPostR8Ready())) return;
  const key = await keyRow(tenantId, keyId);
  await db().from("tenant_vendor_post_keys").update({ grace_until: null }).eq("tenant_id", tenantId).eq("vendor_id", text(key.vendor_id)).not("grace_until", "is", null).select("id");
}

/** "Pick a lead source or type a new name": a new real-time vendor on the agency's list. */
export async function createRealtimeVendor(tenantId: string, userId: string, name: string): Promise<string> {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean || clean.length > 160) throw new Error("Enter the vendor's name, up to 160 characters.");
  const existing = await db().from("tenant_lead_vendors").select("id, name").eq("tenant_id", tenantId);
  const same = rowsOf(existing).find((row) => text(row.name).trim().toLowerCase() === clean.toLowerCase());
  if (same) return text(same.id);
  const inserted = await db().from("tenant_lead_vendors").insert({ tenant_id: tenantId, name: clean, lead_type: "realtime", created_by: userId }).select("id").maybeSingle();
  if (inserted.error) throw new Error(`Could not add ${clean} to your vendors: ${inserted.error.message}`);
  if (!inserted.data) throw new Error(`Could not add ${clean} to your vendors.`);
  return text(inserted.data.id);
}

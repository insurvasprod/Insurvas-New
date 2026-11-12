import "server-only";

// Settings r8, Application forms A: the server side of the builder that is not the form itself.
//
//   works today       the forms list (one form per product: its copy), versions (every published
//                     revision), results (sent leads + where started forms stopped, from form_drafts)
//   needs 20261112200000 (supabase/deploy/2026-11-12-application-forms.sql)
//                     drafts saved to Insurvas, several forms per product, share links, a webhook per
//                     form (form.submitted on the LA-8.7 webhook queue), start / stop events, and the
//                     test-lead flag. Every read below answers "not there yet" instead of failing, and
//                     `formCapabilities` tells the page which parts can save.
//
// Tenant data is read with the service client, so every query filters tenant_id itself.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { encryptSensitive } from "@/lib/applications/crypto";
import { secretScope } from "@/lib/webhooks/service";
import { checkTargetUrl, generateSigningSecret } from "@/lib/webhooks/rules";
import { isMissingSchema } from "@/lib/leadPost/schemaGap";
import type { TemplateField, TemplateFormDefinition } from "./constants";
import { templateFormFieldVisible } from "./visibility";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;

export type FormCapabilities = {
  /** Drafts saved to Insurvas (tenant_form_drafts). */
  drafts: boolean;
  /** Several forms per product (tenant_form_variants). */
  variants: boolean;
  /** Share links (tenant_form_shares). */
  share: boolean;
  /** A webhook per form (webhook_subscription.tenant_template_id + form.submitted). */
  webhooks: boolean;
  /** Opened / started / question / sent events (tenant_form_events). */
  events: boolean;
  /** agent_leads.is_test. */
  testLeads: boolean;
};

export const SCHEMA_PENDING = "needs a database update";

let cached: { at: number; value: FormCapabilities } | null = null;

/** Which parts of the migration are live. Probed once a minute per server. */
export async function formCapabilities(): Promise<FormCapabilities> {
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  const probe = async (table: string, columns: string) => {
    const { error } = await db().from(table).select(columns).limit(0);
    return !error;
  };
  const [drafts, variants, share, webhooks, events, testLeads] = await Promise.all([
    probe("tenant_form_drafts", "tenant_template_id"),
    probe("tenant_form_variants", "id"),
    probe("tenant_form_shares", "id"),
    probe("webhook_subscription", "tenant_template_id"),
    probe("tenant_form_events", "id"),
    probe("agent_leads", "is_test"),
  ]);
  const value = { drafts, variants, share, webhooks, events, testLeads };
  cached = { at: Date.now(), value };
  return value;
}

export class FormSchemaPendingError extends Error {
  constructor(what: string) {
    super(`${what} ${SCHEMA_PENDING} that has not been applied yet.`);
    this.name = "FormSchemaPendingError";
  }
}

/** The copy, if it is this tenant's. */
async function ownCopy(tenantId: string, copyId: string) {
  const { data, error } = await db().from("tenant_templates").select("id, product_code, name, definition_version, updated_at").eq("tenant_id", tenantId).eq("id", copyId).maybeSingle();
  if (error) throw new Error(`Could not read the form: ${error.message}`);
  if (!data) throw new Error("That form is not yours, or no longer exists.");
  return data as { id: string; product_code: string; name: string; definition_version: number; updated_at: string | null };
}

const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

/* ── forms list ────────────────────────────────────────────────────────── */

export type FormRow = {
  kind: "product" | "variant";
  id: string;
  tenant_template_id: string;
  product_code: string;
  name: string;
  version: number;
  status: "live" | "draft" | "off";
  sent: number;
  started: number;
  changed_at: string | null;
  changed_by: string | null;
  draft_changes: boolean;
  has_webhook: boolean;
};

/** One row per product form (the agency's copy), then each extra form when the migration is live. */
export async function listForms(tenantId: string, caps: FormCapabilities): Promise<FormRow[]> {
  const copies = await db().from("tenant_templates").select("id, product_code, name, definition_version, updated_at").eq("tenant_id", tenantId).order("product_code");
  if (copies.error) throw new Error(`Could not read your forms: ${copies.error.message}`);
  const rows = (copies.data ?? []) as Array<{ id: string; product_code: string; name: string; definition_version: number; updated_at: string | null }>;
  const window = since(30);
  const ids = rows.map((row) => row.id);
  const [revisions, drafts, serverDrafts] = await Promise.all([
    ids.length ? db().from("tenant_template_revisions").select("tenant_template_id, revision, created_at, created_by").in("tenant_template_id", ids).order("revision", { ascending: false }).limit(500) : { data: [] },
    ids.length ? db().from("form_drafts").select("tenant_template_id").eq("tenant_id", tenantId).in("tenant_template_id", ids).gte("created_at", window).limit(5000) : { data: [] },
    caps.drafts && ids.length ? db().from("tenant_form_drafts").select("tenant_template_id").eq("tenant_id", tenantId).in("tenant_template_id", ids) : { data: [] },
  ]);
  const sentCounts = await Promise.all(rows.map(async (row) => {
    const { count } = await db().from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("tenant_template_id", row.id).gte("created_at", window);
    return count ?? 0;
  }));
  const latest = new Map<string, { created_at: string; created_by: string | null }>();
  for (const rev of (revisions.data ?? []) as Array<{ tenant_template_id: string; revision: number; created_at: string; created_by: string | null }>) if (!latest.has(rev.tenant_template_id)) latest.set(rev.tenant_template_id, rev);
  const people = await namesOf([...latest.values()].map((rev) => rev.created_by).filter((id): id is string => Boolean(id)));
  const started = new Map<string, number>();
  for (const row of (drafts.data ?? []) as Array<{ tenant_template_id: string }>) started.set(row.tenant_template_id, (started.get(row.tenant_template_id) ?? 0) + 1);
  const withDraft = new Set(((serverDrafts.data ?? []) as Array<{ tenant_template_id: string }>).map((row) => row.tenant_template_id));
  const hooks = caps.webhooks && ids.length ? await db().from("webhook_subscription").select("tenant_template_id").eq("tenant_id", tenantId).in("tenant_template_id", ids).neq("status", "disabled") : { data: [] };
  const withHook = new Set(((hooks.data ?? []) as Array<{ tenant_template_id: string }>).map((row) => row.tenant_template_id));
  const out: FormRow[] = rows.map((row, index) => ({
    kind: "product",
    id: row.id,
    tenant_template_id: row.id,
    product_code: row.product_code,
    name: row.name,
    version: row.definition_version ?? 1,
    status: "live",
    sent: sentCounts[index],
    started: sentCounts[index] + (started.get(row.id) ?? 0),
    changed_at: latest.get(row.id)?.created_at ?? row.updated_at,
    changed_by: people.get(latest.get(row.id)?.created_by ?? "") ?? null,
    draft_changes: withDraft.has(row.id),
    has_webhook: withHook.has(row.id),
  }));
  if (caps.variants) {
    const variants = await db().from("tenant_form_variants").select("id, tenant_template_id, name, status, version, updated_at, updated_by").eq("tenant_id", tenantId).order("created_at");
    if (!variants.error) {
      const byCopy = new Map(rows.map((row) => [row.id, row]));
      const variantPeople = await namesOf(((variants.data ?? []) as Array<{ updated_by: string | null }>).map((row) => row.updated_by).filter((id): id is string => Boolean(id)));
      for (const variant of (variants.data ?? []) as Array<{ id: string; tenant_template_id: string; name: string; status: FormRow["status"]; version: number; updated_at: string; updated_by: string | null }>) {
        const copy = byCopy.get(variant.tenant_template_id);
        if (!copy) continue;
        out.push({ kind: "variant", id: variant.id, tenant_template_id: copy.id, product_code: copy.product_code, name: variant.name, version: variant.version, status: variant.status, sent: 0, started: 0, changed_at: variant.updated_at, changed_by: variantPeople.get(variant.updated_by ?? "") ?? null, draft_changes: false, has_webhook: false });
      }
    }
  }
  return out;
}

async function namesOf(ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<string, string>();
  const { data } = await db().from("users").select("id, name").in("id", unique);
  return new Map(((data ?? []) as Array<{ id: string; name: string | null }>).map((row) => [row.id, row.name?.trim() || "Someone on your team"]));
}

/* ── versions ──────────────────────────────────────────────────────────── */

export type FormVersion = { revision: number; name: string; created_at: string | null; created_by: string | null; fields: TemplateField[]; form_definition: TemplateFormDefinition; drafts_on_it: number };

/** Every published version of the form, newest first, with what each holds (for the diff and Restore). */
export async function listVersions(tenantId: string, copyId: string, limit = 30): Promise<FormVersion[]> {
  await ownCopy(tenantId, copyId);
  const { data, error } = await db().from("tenant_template_revisions").select("revision, name, fields, form_definition, created_at, created_by").eq("tenant_template_id", copyId).order("revision", { ascending: false }).limit(limit);
  if (error) throw new Error(`Could not read the versions: ${error.message}`);
  const rows = (data ?? []) as Array<{ revision: number; name: string; fields: unknown; form_definition: unknown; created_at: string | null; created_by: string | null }>;
  const people = await namesOf(rows.map((row) => row.created_by).filter((id): id is string => Boolean(id)));
  const pinned = await db().from("form_drafts").select("definition_version").eq("tenant_id", tenantId).eq("tenant_template_id", copyId).limit(5000);
  const onIt = new Map<number, number>();
  for (const row of (pinned.data ?? []) as Array<{ definition_version: number }>) onIt.set(row.definition_version, (onIt.get(row.definition_version) ?? 0) + 1);
  return rows.map((row) => ({
    revision: row.revision,
    name: row.name,
    created_at: row.created_at,
    created_by: row.created_by ? people.get(row.created_by) ?? null : null,
    fields: Array.isArray(row.fields) ? (row.fields as TemplateField[]) : [],
    form_definition: row.form_definition && typeof row.form_definition === "object" && Array.isArray((row.form_definition as TemplateFormDefinition).sections) ? (row.form_definition as TemplateFormDefinition) : { sections: [] },
    drafts_on_it: onIt.get(row.revision) ?? 0,
  }));
}

/* ── results ───────────────────────────────────────────────────────────── */

export type FormResults = {
  days: number;
  sent: number;
  started: number;
  finishedPct: number | null;
  /** Previous window's finished %, for the rise. */
  previousPct: number | null;
  stops: Array<{ field_key: string; label: string; page: number; reached: number; stopped: number }>;
  bySource: Array<{ source: string; sent: number }>;
  /** True when opened / time-to-finish come from events (the migration). */
  fromEvents: boolean;
  opened: number | null;
};

type DraftRow = { payload: unknown; created_at: string };

const answersOf = (payload: unknown): Record<string, unknown> => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const inner = (payload as { values?: unknown }).values;
  return inner && typeof inner === "object" && !Array.isArray(inner) ? (inner as Record<string, unknown>) : (payload as Record<string, unknown>);
};
const answered = (value: unknown) => !(value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0));

/**
 * Where people stop, from what is real today: every lead sent in the window reached every question it
 * was shown, and every form started but not sent (form_drafts) stopped after its last answered question.
 */
export async function formResults(tenantId: string, copyId: string, days: number, fields: TemplateField[], form: TemplateFormDefinition, caps: FormCapabilities): Promise<FormResults> {
  await ownCopy(tenantId, copyId);
  const window = since(days);
  const before = since(days * 2);
  const [sentNow, sentBefore, draftsNow, draftsBefore, partnerSent] = await Promise.all([
    db().from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("tenant_template_id", copyId).gte("created_at", window),
    db().from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("tenant_template_id", copyId).gte("created_at", before).lt("created_at", window),
    db().from("form_drafts").select("payload, created_at").eq("tenant_id", tenantId).eq("tenant_template_id", copyId).gte("created_at", window).limit(5000),
    db().from("form_drafts").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("tenant_template_id", copyId).gte("created_at", before).lt("created_at", window),
    db().from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("tenant_template_id", copyId).gte("created_at", window).not("partner_id", "is", null),
  ]);
  const sent = sentNow.count ?? 0;
  const open = (draftsNow.data ?? []) as DraftRow[];
  const started = sent + open.length;
  const previousStarted = (sentBefore.count ?? 0) + (draftsBefore.count ?? 0);
  const labels = new Map(fields.map((field) => [field.field_key, field.label]));
  const order = form.sections.flatMap((section, index) => section.fields.map((placed) => ({ placed, page: index + 1 })));
  const reached = new Map<string, number>(order.map(({ placed }) => [placed.field_key, sent]));
  const stopped = new Map<string, number>();
  for (const draft of open) {
    const values = answersOf(draft.payload);
    let last = -1;
    order.forEach(({ placed }, index) => { if (answered(values[placed.field_key])) last = index; });
    // It reached every shown question up to the one after its last answer, and stopped there.
    const stopAt = Math.min(last + 1, order.length - 1);
    for (let index = 0; index <= stopAt; index += 1) {
      const { placed } = order[index];
      if (index < stopAt && !templateFormFieldVisible(placed, values)) continue;
      reached.set(placed.field_key, (reached.get(placed.field_key) ?? 0) + 1);
    }
    if (order[stopAt]) stopped.set(order[stopAt].placed.field_key, (stopped.get(order[stopAt].placed.field_key) ?? 0) + 1);
  }
  let opened: number | null = null;
  if (caps.events) {
    const { count } = await db().from("tenant_form_events").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("tenant_template_id", copyId).eq("event", "opened").gte("occurred_at", window);
    opened = count ?? null;
  }
  const partner = partnerSent.count ?? 0;
  return {
    days,
    sent,
    started,
    finishedPct: started ? Math.round((sent / started) * 100) : null,
    previousPct: previousStarted ? Math.round(((sentBefore.count ?? 0) / previousStarted) * 100) : null,
    stops: order.map(({ placed, page }) => ({ field_key: placed.field_key, label: labels.get(placed.field_key) ?? placed.field_key, page, reached: reached.get(placed.field_key) ?? 0, stopped: stopped.get(placed.field_key) ?? 0 })),
    bySource: [{ source: "Partner portal", sent: partner }, { source: "Agents", sent: Math.max(0, sent - partner) }],
    fromEvents: caps.events,
    opened,
  };
}

/* ── drafts saved to Insurvas ─────────────────────────────────────────── */

export type ServerDraft = { base_revision: number; draft: unknown; updated_at: string; updated_by: string | null };

export async function readServerDraft(tenantId: string, copyId: string): Promise<ServerDraft | null> {
  const { data, error } = await db().from("tenant_form_drafts").select("base_revision, draft, updated_at, updated_by").eq("tenant_id", tenantId).eq("tenant_template_id", copyId).maybeSingle();
  if (error) { if (isMissingSchema(error)) throw new FormSchemaPendingError("Saving drafts to Insurvas"); throw new Error(`Could not read the draft: ${error.message}`); }
  if (!data) return null;
  const people = data.updated_by ? await namesOf([data.updated_by]) : new Map<string, string>();
  return { base_revision: data.base_revision, draft: data.draft, updated_at: data.updated_at, updated_by: data.updated_by ? people.get(data.updated_by) ?? null : null };
}

export async function saveServerDraft(tenantId: string, userId: string, copyId: string, baseRevision: number, draft: unknown) {
  await ownCopy(tenantId, copyId);
  const text = JSON.stringify(draft ?? null);
  if (!draft || typeof draft !== "object" || text.length > 900_000) throw new Error("That draft is too large to save.");
  const { error } = await db().from("tenant_form_drafts").upsert({ tenant_id: tenantId, tenant_template_id: copyId, base_revision: baseRevision, draft, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "tenant_template_id" });
  if (error) { if (isMissingSchema(error)) throw new FormSchemaPendingError("Saving drafts to Insurvas"); throw new Error(`Could not save the draft: ${error.message}`); }
  return { saved_at: new Date().toISOString() };
}

export async function clearServerDraft(tenantId: string, copyId: string) {
  const { error } = await db().from("tenant_form_drafts").delete().eq("tenant_id", tenantId).eq("tenant_template_id", copyId);
  if (error && !isMissingSchema(error)) throw new Error(`Could not clear the draft: ${error.message}`);
}

/* ── share link ───────────────────────────────────────────────────────── */

export type ShareAudience = "public" | "partners" | "agents";
export type FormShare = { slug: string; audience: ShareAudience; source_label: string; is_active: boolean };

const slugify = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "form";

export async function readShare(tenantId: string, copyId: string): Promise<FormShare | null> {
  const { data, error } = await db().from("tenant_form_shares").select("slug, audience, source_label, is_active").eq("tenant_id", tenantId).eq("tenant_template_id", copyId).maybeSingle();
  if (error) { if (isMissingSchema(error)) throw new FormSchemaPendingError("Share links"); throw new Error(`Could not read the share link: ${error.message}`); }
  return (data as FormShare | null) ?? null;
}

export async function saveShare(tenantId: string, userId: string, copyId: string, input: { audience: ShareAudience; source_label: string; is_active: boolean }) {
  const copy = await ownCopy(tenantId, copyId);
  if (!["public", "partners", "agents"].includes(input.audience)) throw new Error("Choose who can open the link.");
  const label = String(input.source_label ?? "").trim().slice(0, 80) || "Website";
  const existing = await readShare(tenantId, copyId);
  if (existing) {
    const { error } = await db().from("tenant_form_shares").update({ audience: input.audience, source_label: label, is_active: input.is_active, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("tenant_template_id", copyId);
    if (error) throw new Error(`Could not save the share link: ${error.message}`);
    return { ...existing, audience: input.audience, source_label: label, is_active: input.is_active };
  }
  // The link names the agency's form, never an id; a clash gets a short random tail.
  const tenant = await db().from("tenants").select("name").eq("id", tenantId).maybeSingle();
  const base = `${slugify(tenant.data?.name ?? "agency")}-${slugify(copy.product_code.replaceAll("_", "-"))}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${crypto.randomUUID().slice(0, 4)}`;
    const { error } = await db().from("tenant_form_shares").insert({ tenant_id: tenantId, tenant_template_id: copyId, slug, audience: input.audience, source_label: label, is_active: input.is_active, created_by: userId });
    if (!error) return { slug, audience: input.audience, source_label: label, is_active: input.is_active };
    if (error.code !== "23505") throw new Error(`Could not save the share link: ${error.message}`);
  }
  throw new Error("Could not make a free link name. Try again.");
}

/* ── the form's webhook (on the LA-8.7 webhook queue) ─────────────────── */

export type FormWebhook = { id: string; target_url: string; status: string; events: string[]; last_success_at: string | null; last_failure_at: string | null };
export type FormDelivery = { id: string; attempted_at: string; status_code: number | null; ok: boolean; duration_ms: number | null; attempt: number; event_type: string };

export async function readFormWebhook(tenantId: string, copyId: string): Promise<{ hook: FormWebhook | null; deliveries: FormDelivery[] }> {
  const { data, error } = await db().from("webhook_subscription").select("id, target_url, status, event_types, last_success_at, last_failure_at").eq("tenant_id", tenantId).eq("tenant_template_id", copyId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) { if (isMissingSchema(error)) throw new FormSchemaPendingError("A webhook per form"); throw new Error(`Could not read the webhook: ${error.message}`); }
  if (!data) return { hook: null, deliveries: [] };
  const attempts = await db().from("webhook_attempt").select("id, attempted_at, status_code, ok, duration_ms, attempt, webhook_delivery!inner(event_type)").eq("tenant_id", tenantId).eq("subscription_id", data.id).order("attempted_at", { ascending: false }).limit(10);
  const deliveries = ((attempts.data ?? []) as Array<{ id: string; attempted_at: string; status_code: number | null; ok: boolean; duration_ms: number | null; attempt: number; webhook_delivery: { event_type: string } | null }>).map((row) => ({ id: row.id, attempted_at: row.attempted_at, status_code: row.status_code, ok: row.ok, duration_ms: row.duration_ms, attempt: row.attempt, event_type: row.webhook_delivery?.event_type ?? "" }));
  return { hook: { id: data.id, target_url: data.target_url, status: data.status, events: data.event_types ?? [], last_success_at: data.last_success_at, last_failure_at: data.last_failure_at }, deliveries };
}

const FORM_EVENTS = ["form.submitted", "form.test"] as const;

/** Creates the form's webhook (the secret is returned this once) or changes its address and events. */
export async function saveFormWebhook(tenantId: string, userId: string, copyId: string, input: { target_url: string; events: string[] }): Promise<{ hook: FormWebhook; secret: string | null }> {
  const copy = await ownCopy(tenantId, copyId);
  const target = checkTargetUrl(input.target_url);
  if (!target.ok) throw new Error(target.message);
  const events = [...new Set(input.events.filter((event): event is (typeof FORM_EVENTS)[number] => (FORM_EVENTS as readonly string[]).includes(event)))];
  if (!events.length) throw new Error("Choose when to send.");
  const current = await readFormWebhook(tenantId, copyId);
  if (current.hook) {
    const { data, error } = await db().from("webhook_subscription").update({ target_url: target.url.href, event_types: events, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", current.hook.id).select("id, target_url, status, event_types, last_success_at, last_failure_at").single();
    if (error) throw new Error(`Could not save the webhook: ${error.message}`);
    return { hook: { ...data, events: data.event_types }, secret: null };
  }
  const id = crypto.randomUUID();
  const secret = generateSigningSecret();
  const sealed = encryptSensitive(secret, secretScope(tenantId, id));
  const { data, error } = await db().from("webhook_subscription").insert({
    id, tenant_id: tenantId, tenant_template_id: copyId, label: `${copy.name} form`.slice(0, 80), target_url: target.url.href, event_types: events,
    signing_secret_ciphertext: sealed.ciphertext, signing_secret_key_version: sealed.keyVersion, created_by: userId,
  }).select("id, target_url, status, event_types, last_success_at, last_failure_at").single();
  if (error) { if (isMissingSchema(error)) throw new FormSchemaPendingError("A webhook per form"); throw new Error(`Could not save the webhook: ${error.message}`); }
  return { hook: { ...data, events: data.event_types }, secret };
}

/* ── several forms per product ────────────────────────────────────────── */

export type FormVariant = { id: string; tenant_template_id: string; name: string; status: "draft" | "live" | "off"; audience: string[]; version: number; form_definition: TemplateFormDefinition };

export async function createVariant(tenantId: string, userId: string, input: { tenant_template_id: string; name: string; audience: string[]; form_definition: TemplateFormDefinition }) {
  await ownCopy(tenantId, input.tenant_template_id);
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 120) throw new Error("Give the form a name of up to 120 characters.");
  const audience = [...new Set((input.audience ?? []).filter((item) => ["partners", "agents", "public"].includes(item)))];
  if (!audience.length) throw new Error("Choose who fills it in.");
  if (!input.form_definition || !Array.isArray(input.form_definition.sections)) throw new Error("The form has no pages.");
  const { data, error } = await db().from("tenant_form_variants").insert({ tenant_id: tenantId, tenant_template_id: input.tenant_template_id, name, audience, status: "draft", form_definition: input.form_definition, created_by: userId, updated_by: userId }).select("id, tenant_template_id, name, status, audience, version, form_definition").single();
  if (error) { if (isMissingSchema(error)) throw new FormSchemaPendingError("Several forms per product"); throw new Error(`Could not make the form: ${error.message}`); }
  return data as FormVariant;
}

export async function readVariant(tenantId: string, id: string): Promise<FormVariant> {
  const { data, error } = await db().from("tenant_form_variants").select("id, tenant_template_id, name, status, audience, version, form_definition").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) { if (isMissingSchema(error)) throw new FormSchemaPendingError("Several forms per product"); throw new Error(`Could not read the form: ${error.message}`); }
  if (!data) throw new Error("That form is not yours, or no longer exists.");
  return data as FormVariant;
}

/** Publishes the variant's arrangement as its next version (the questions stay the product's). */
export async function publishVariant(tenantId: string, userId: string, id: string, input: { name: string; form_definition: TemplateFormDefinition; note?: string }) {
  const current = await readVariant(tenantId, id);
  const next = current.version + 1;
  const { error } = await db().from("tenant_form_variants").update({ name: String(input.name ?? current.name).trim().slice(0, 120) || current.name, form_definition: input.form_definition, version: next, status: "live", updated_by: userId, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", id).eq("version", current.version);
  if (error) throw new Error(`Could not publish the form: ${error.message}`);
  await db().from("tenant_form_variant_revisions").insert({ tenant_id: tenantId, variant_id: id, version: next, form_definition: input.form_definition, note: input.note?.slice(0, 300) ?? null, created_by: userId });
  return { version: next };
}

export async function setVariantStatus(tenantId: string, id: string, status: "live" | "off") {
  const { error } = await db().from("tenant_form_variants").update({ status, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", id);
  if (error) throw new Error(`Could not change the form: ${error.message}`);
}

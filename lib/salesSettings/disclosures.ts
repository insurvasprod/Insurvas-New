import "server-only";

import { z } from "zod";

import type { Actor } from "@/lib/applications/http";
import { ApplicationError, db, isMissingSchema, rows, SchemaPendingError, type DbError } from "@/lib/applications/db";
import { CANONICAL_GROUPS, isSensitiveKey } from "@/lib/applications/constants";
import { normaliseProse } from "@/lib/applications/formats";
import { US_STATES } from "@/lib/signup/constants";
import { CLAUSE_FIELD, CLAUSE_OPS, type Clause } from "./editing";
import { auditSales } from "./settings";

/**
 * LA-3.10 · the disclosure library (application_disclosures + application_disclosure_rules).
 *
 *   · Platform rows (tenant_id null) are read-only to an agency. "Copy to my agency" clones one as the
 *     agency's own draft, rules and attachment included; the original is untouched.
 *   · Each row is one version. A draft is edited in place. Editing a published version makes
 *     version N + 1 as a draft; publishing it retires the version before. Published and retired rows
 *     never change (20260926102500's guard), so an application acknowledged on version N keeps it.
 *   · A rule is a list of {field, op, value} clauses that must all hold; a second rule is OR. Fields
 *     are canonical application keys or `health.<question_key>`, read by
 *     lib/applications/disclosureRules.ts. Scope: states and carriers (empty = all).
 *   · The optional PDF lives in the private `application-confirmations` bucket at
 *     `<tenant>/disclosures/<id>-v<version>.pdf` and is read only through a 60-second signed URL.
 *
 * Owners write; owners and producers read.
 */

const BUCKET = "application-confirmations";
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const STATE_CODES = US_STATES.map(([code]) => code as string);

export type DisclosureStatus = "draft" | "published" | "retired";
export type DisclosureRuleView = { clauses: Clause[] };
export type DisclosureItem = {
  id: string;
  code: string;
  title: string;
  body: string;
  states: string[];
  carrierIds: string[];
  version: number;
  status: DisclosureStatus;
  platform: boolean;
  hasAttachment: boolean;
  rules: DisclosureRuleView[];
  updatedAt: string;
  /** Applications that acknowledged this exact version. */
  acknowledged: number;
};
export type InterviewFieldOption = { key: string; label: string; type: string };
export type DisclosureLibrary = {
  items: DisclosureItem[];
  carriers: { id: string; name: string }[];
  interviewFields: InterviewFieldOption[];
  canEdit: boolean;
};

type Row = {
  id: string; tenant_id: string | null; code: string; title: string; body_markdown: string; attachment_path: string | null;
  states: string[] | null; carrier_ids: string[] | null; version: number; status: DisclosureStatus; updated_at: string;
};
const COLUMNS = "id, tenant_id, code, title, body_markdown, attachment_path, states, carrier_ids, version, status, updated_at";

// ── input ──────────────────────────────────────────────────────────────────

const clauseSchema = z.object({
  field: z.string().regex(CLAUSE_FIELD, "Choose a field for every condition."),
  op: z.enum(CLAUSE_OPS),
  value: z.union([z.string().trim().min(1).max(200), z.number().finite(), z.boolean(), z.array(z.string().trim().min(1).max(100)).min(1).max(60)]),
}).strict();

export const disclosureInputSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9][A-Z0-9_]{1,63}$/, "The code is capital letters, digits and _ — like REPLACEMENT_NOTICE."),
  title: z.string().trim().min(1, "Give the document a title.").max(200),
  body: z.string().trim().min(1, "Write the text the agent reads or sends.").max(20000),
  states: z.array(z.string().regex(/^[A-Z]{2}$/)).max(60),
  carrier_ids: z.array(z.string().uuid()).max(100),
  rules: z.array(z.object({ clauses: z.array(clauseSchema).min(1).max(10) }).strict()).max(10),
}).strict();
export type DisclosureInput = z.infer<typeof disclosureInputSchema>;

const CANONICAL_KEYS = new Set(CANONICAL_GROUPS.flatMap((g) => g.fields.map((f) => f.key)).filter((key) => !isSensitiveKey(key)));

function checkInput(input: DisclosureInput, carrierIds: Set<string>) {
  const badState = input.states.find((s) => !STATE_CODES.includes(s));
  if (badState) throw new ApplicationError("DISCLOSURE_STATE", `${badState} isn't a US state code.`);
  const badCarrier = input.carrier_ids.find((id) => !carrierIds.has(id));
  if (badCarrier) throw new ApplicationError("DISCLOSURE_CARRIER", "One of the carriers isn't one of your agency's.");
  input.rules.forEach((rule, r) => rule.clauses.forEach((c, i) => {
    const where = `Rule ${r + 1}, condition ${i + 1}`;
    if (!c.field.startsWith("health.") && !CANONICAL_KEYS.has(c.field)) throw new ApplicationError("DISCLOSURE_RULE_FIELD", `${where}: there is no application field called ${c.field}.`);
    const list = Array.isArray(c.value);
    if ((c.op === "in" || c.op === "not_in") !== list) throw new ApplicationError("DISCLOSURE_RULE_VALUE", `${where}: "one of" takes a list; the other conditions take one value.`);
    if ((c.op === "gt" || c.op === "lt") && typeof c.value !== "number") throw new ApplicationError("DISCLOSURE_RULE_VALUE", `${where}: more than and less than need a number.`);
  }));
}

// ── helpers ────────────────────────────────────────────────────────────────

function fail(error: DbError, what: string): never {
  if (isMissingSchema(error)) throw new SchemaPendingError("The disclosure library");
  const message = error?.message ?? "";
  const guard = /DISCLOSURE_PUBLISHED_IMMUTABLE:\s*(.+)$/.exec(message);
  if (guard) throw new ApplicationError("DISCLOSURE_PUBLISHED_IMMUTABLE", `${guard[1].charAt(0).toUpperCase()}${guard[1].slice(1)}.`, 409);
  if (error?.code === "23505") throw new ApplicationError("DISCLOSURE_VERSION_TAKEN", "That code and version already exist. Refresh and try again.", 409);
  throw new ApplicationError("DISCLOSURE_UNAVAILABLE", `${what}: ${message || "unknown error"}`, 500);
}

async function tenantCarriers(tenantId: string) {
  const client = db();
  const contracted = await client.from("tenant_carriers").select("carrier_id").eq("tenant_id", tenantId);
  const ids = [...new Set(rows<{ carrier_id: string }>(contracted.error ? [] : contracted.data).map((c) => c.carrier_id))];
  if (!ids.length) return [];
  const carriers = await client.from("carriers").select("id, name").in("id", ids).order("name");
  return rows<{ id: string; name: string }>(carriers.error ? [] : carriers.data);
}

async function interviewFields(tenantId: string): Promise<InterviewFieldOption[]> {
  const { data, error } = await db().from("sales_templates").select("definition, tenant_id, version").eq("kind", "underwriting").in("status", ["published", "draft"]).or(`tenant_id.is.null,tenant_id.eq.${tenantId}`);
  if (error) return [];
  const out = new Map<string, InterviewFieldOption>();
  for (const t of rows<{ definition: { fields?: { field_key?: string; label?: string; type?: string }[] } | null }>(data)) {
    for (const f of t.definition?.fields ?? []) {
      if (!f.field_key || !/^[a-z][a-z0-9_]{0,63}$/.test(f.field_key) || f.type === "medication_list") continue;
      const key = `health.${f.field_key}`;
      if (!out.has(key)) out.set(key, { key, label: f.label ?? f.field_key, type: f.type ?? "text" });
    }
  }
  return [...out.values()].sort((a, b) => a.label.localeCompare(b.label));
}

async function rulesFor(ids: string[]) {
  if (!ids.length) return new Map<string, DisclosureRuleView[]>();
  const { data, error } = await db().from("application_disclosure_rules").select("disclosure_id, clauses, created_at").in("disclosure_id", ids).order("created_at");
  if (error) fail(error, "Could not load the disclosure rules");
  const by = new Map<string, DisclosureRuleView[]>();
  for (const r of rows<{ disclosure_id: string; clauses: Clause[] }>(data)) by.set(r.disclosure_id, [...(by.get(r.disclosure_id) ?? []), { clauses: r.clauses ?? [] }]);
  return by;
}

function toItem(row: Row, rules: Map<string, DisclosureRuleView[]>, acks: Map<string, number>): DisclosureItem {
  return {
    id: row.id, code: row.code, title: row.title, body: normaliseProse(row.body_markdown), states: row.states ?? [], carrierIds: row.carrier_ids ?? [],
    version: row.version, status: row.status, platform: row.tenant_id === null, hasAttachment: Boolean(row.attachment_path),
    rules: rules.get(row.id) ?? [], updatedAt: row.updated_at, acknowledged: acks.get(row.id) ?? 0,
  };
}

/** A row this tenant can see: its own, or a published platform row. */
async function visibleRow(tenantId: string, id: string): Promise<Row> {
  const { data, error } = await db().from("application_disclosures").select(COLUMNS).eq("id", id).or(`tenant_id.is.null,tenant_id.eq.${tenantId}`).maybeSingle();
  if (error) fail(error, "Could not load the disclosure");
  const row = data as Row | null;
  if (!row || (row.tenant_id === null && row.status !== "published")) throw new ApplicationError("DISCLOSURE_NOT_FOUND", "That disclosure could not be found.", 404);
  return row;
}

async function ownRow(tenantId: string, id: string): Promise<Row> {
  const row = await visibleRow(tenantId, id);
  if (row.tenant_id !== tenantId) throw new ApplicationError("DISCLOSURE_PLATFORM", "This is an Insurvas platform disclosure. Copy it to your agency to change it.", 403);
  return row;
}

async function nextVersion(tenantId: string, code: string) {
  const { data, error } = await db().from("application_disclosures").select("version").eq("code", code).or(`tenant_id.is.null,tenant_id.eq.${tenantId}`).order("version", { ascending: false }).limit(1);
  if (error) fail(error, "Could not number the new version");
  return (rows<{ version: number }>(data)[0]?.version ?? 0) + 1;
}

async function openDraftFor(tenantId: string, code: string, exceptId?: string) {
  let q = db().from("application_disclosures").select("id, version").eq("tenant_id", tenantId).eq("code", code).eq("status", "draft");
  if (exceptId) q = q.neq("id", exceptId);
  const { data, error } = await q.limit(1);
  if (error) fail(error, "Could not check for an open draft");
  return rows<{ id: string; version: number }>(data)[0] ?? null;
}

async function writeRules(disclosureId: string, rules: DisclosureRuleView[] | DisclosureInput["rules"]) {
  if (!rules.length) return;
  const { error } = await db().from("application_disclosure_rules").insert(rules.map((r) => ({ disclosure_id: disclosureId, clauses: r.clauses })));
  if (error) fail(error, "Could not save the rules");
}

async function itemById(tenantId: string, id: string) {
  const row = await visibleRow(tenantId, id);
  const [rules, acks] = await Promise.all([rulesFor([row.id]), ackCounts(tenantId, [row.id])]);
  return toItem(row, rules, acks);
}

async function ackCounts(tenantId: string, ids: string[]) {
  const by = new Map<string, number>();
  if (!ids.length) return by;
  const { data, error } = await db().from("tenant_application_disclosures").select("disclosure_id").eq("tenant_id", tenantId).eq("status", "acknowledged").in("disclosure_id", ids).limit(10000);
  if (error) return by;
  for (const r of rows<{ disclosure_id: string }>(data)) by.set(r.disclosure_id, (by.get(r.disclosure_id) ?? 0) + 1);
  return by;
}

const summary = (input: { code: string; title: string; states: string[]; carrier_ids?: string[]; carrierIds?: string[]; rules: { clauses: Clause[] }[] }) => ({
  code: input.code, title: input.title, states: input.states, carrierIds: input.carrier_ids ?? input.carrierIds ?? [], rules: input.rules.map((r) => r.clauses),
});

// ── reads ──────────────────────────────────────────────────────────────────

export async function listDisclosures(actor: Actor): Promise<DisclosureLibrary> {
  const { data, error } = await db().from("application_disclosures").select(COLUMNS)
    .or(`and(tenant_id.is.null,status.eq.published),tenant_id.eq.${actor.tenantId}`)
    .order("code").order("version", { ascending: false }).limit(1000);
  if (error) fail(error, "Could not load the disclosures");
  const list = rows<Row>(data);
  const ids = list.map((r) => r.id);
  const [rules, acks, carriers, fields] = await Promise.all([rulesFor(ids), ackCounts(actor.tenantId, ids), tenantCarriers(actor.tenantId), interviewFields(actor.tenantId)]);
  return { items: list.map((r) => toItem(r, rules, acks)), carriers, interviewFields: fields, canEdit: actor.role === "owner" };
}

export async function disclosureAttachmentUrl(actor: Actor, id: string) {
  const row = await visibleRow(actor.tenantId, id);
  if (!row.attachment_path) throw new ApplicationError("DISCLOSURE_NO_ATTACHMENT", "This disclosure has no PDF attached.", 404);
  // A file under a tenant prefix is served to that tenant only (a copied platform PDF has none).
  const owner = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i.exec(row.attachment_path)?.[1];
  if (owner && owner !== actor.tenantId) throw new ApplicationError("DISCLOSURE_NOT_FOUND", "That disclosure could not be found.", 404);
  const signed = await db().storage.from(BUCKET).createSignedUrl(row.attachment_path, 60);
  if (signed.error || !signed.data?.signedUrl) throw new ApplicationError("DISCLOSURE_ATTACHMENT_UNAVAILABLE", "The PDF could not be opened. Try again.", 502);
  return { url: signed.data.signedUrl as string, expiresInSeconds: 60 };
}

// ── writes ─────────────────────────────────────────────────────────────────

export async function createDisclosure(actor: Actor, input: DisclosureInput) {
  const carriers = await tenantCarriers(actor.tenantId);
  checkInput(input, new Set(carriers.map((c) => c.id)));
  const draft = await openDraftFor(actor.tenantId, input.code);
  if (draft) throw new ApplicationError("DISCLOSURE_DRAFT_EXISTS", `${input.code} already has a draft (v${draft.version}). Open it instead.`, 409);
  const version = await nextVersion(actor.tenantId, input.code);
  const inserted = await db().from("application_disclosures").insert({
    tenant_id: actor.tenantId, code: input.code, title: input.title, body_markdown: input.body, states: input.states.length ? input.states : null,
    carrier_ids: input.carrier_ids.length ? input.carrier_ids : null, version, status: "draft", created_by: actor.userId,
  }).select("id").single();
  if (inserted.error) fail(inserted.error, "Could not create the disclosure");
  await writeRules(inserted.data.id, input.rules);
  await auditSales(actor, "tenant.application_disclosure_created", "application_disclosure", inserted.data.id, { version, after: summary(input) });
  return itemById(actor.tenantId, inserted.data.id);
}

/**
 * A draft is saved in place. A published or retired version is never changed: the edit becomes
 * version N + 1 as a draft (refused if that code already has an open draft).
 */
export async function saveDisclosure(actor: Actor, id: string, input: DisclosureInput) {
  const row = await ownRow(actor.tenantId, id);
  const carriers = await tenantCarriers(actor.tenantId);
  // A carrier the version already named stays allowed even if the agency has since dropped it.
  checkInput(input, new Set([...carriers.map((c) => c.id), ...(row.carrier_ids ?? [])]));
  const before = { ...summary({ code: row.code, title: row.title, states: row.states ?? [], carrierIds: row.carrier_ids ?? [], rules: (await rulesFor([row.id])).get(row.id) ?? [] }), bodyChanged: row.body_markdown !== input.body };
  const client = db();

  if (row.status !== "draft") {
    if (input.code !== row.code) throw new ApplicationError("DISCLOSURE_CODE_FIXED", "A new version keeps its code. Start a new document for a different code.");
    const draft = await openDraftFor(actor.tenantId, row.code);
    if (draft) throw new ApplicationError("DISCLOSURE_DRAFT_EXISTS", `${row.code} already has a draft (v${draft.version}). Open it instead.`, 409);
    const version = await nextVersion(actor.tenantId, row.code);
    const inserted = await client.from("application_disclosures").insert({
      tenant_id: actor.tenantId, code: row.code, title: input.title, body_markdown: input.body, attachment_path: row.attachment_path,
      states: input.states.length ? input.states : null, carrier_ids: input.carrier_ids.length ? input.carrier_ids : null, version, status: "draft", created_by: actor.userId,
    }).select("id").single();
    if (inserted.error) fail(inserted.error, "Could not start the new version");
    await writeRules(inserted.data.id, input.rules);
    await auditSales(actor, "tenant.application_disclosure_created", "application_disclosure", inserted.data.id, { version, fromId: row.id, fromVersion: row.version, before, after: summary(input) });
    return itemById(actor.tenantId, inserted.data.id);
  }

  if (input.code !== row.code) {
    const draft = await openDraftFor(actor.tenantId, input.code, row.id);
    if (draft) throw new ApplicationError("DISCLOSURE_DRAFT_EXISTS", `${input.code} already has a draft (v${draft.version}).`, 409);
  }
  const version = input.code !== row.code ? await nextVersion(actor.tenantId, input.code) : row.version;
  const upd = await client.from("application_disclosures").update({
    code: input.code, title: input.title, body_markdown: input.body, version,
    states: input.states.length ? input.states : null, carrier_ids: input.carrier_ids.length ? input.carrier_ids : null,
  }).eq("tenant_id", actor.tenantId).eq("id", row.id).eq("status", "draft");
  if (upd.error) fail(upd.error, "Could not save the disclosure");
  const del = await client.from("application_disclosure_rules").delete().eq("disclosure_id", row.id);
  if (del.error) fail(del.error, "Could not save the rules");
  await writeRules(row.id, input.rules);
  await auditSales(actor, "tenant.application_disclosure_updated", "application_disclosure", row.id, { version, before, after: summary(input) });
  return itemById(actor.tenantId, row.id);
}

/** Draft → published; the agency's earlier published version of the same code is retired. */
export async function publishDisclosure(actor: Actor, id: string) {
  const row = await ownRow(actor.tenantId, id);
  if (row.status !== "draft") throw new ApplicationError("DISCLOSURE_NOT_DRAFT", `v${row.version} is already ${row.status}.`, 409);
  const client = db();
  const upd = await client.from("application_disclosures").update({ status: "published" }).eq("tenant_id", actor.tenantId).eq("id", row.id).eq("status", "draft");
  if (upd.error) fail(upd.error, "Could not publish the disclosure");
  const retired = await client.from("application_disclosures").update({ status: "retired" })
    .eq("tenant_id", actor.tenantId).eq("code", row.code).eq("status", "published").lt("version", row.version).select("id, version");
  if (retired.error) fail(retired.error, "Could not retire the previous version");
  await auditSales(actor, "tenant.application_disclosure_published", "application_disclosure", row.id, {
    code: row.code, version: row.version, retired: rows<{ id: string; version: number }>(retired.data),
  });
  return itemById(actor.tenantId, row.id);
}

/** A platform disclosure → the agency's own draft (rules and PDF included). The original is untouched. */
export async function copyDisclosure(actor: Actor, id: string) {
  const source = await visibleRow(actor.tenantId, id);
  if (source.tenant_id !== null) throw new ApplicationError("DISCLOSURE_NOT_PLATFORM", "This disclosure is already your agency's. Edit it directly.", 409);
  const draft = await openDraftFor(actor.tenantId, source.code);
  if (draft) throw new ApplicationError("DISCLOSURE_DRAFT_EXISTS", `You already have a draft of ${source.code} (v${draft.version}). Open it instead.`, 409);
  const version = await nextVersion(actor.tenantId, source.code);
  const inserted = await db().from("application_disclosures").insert({
    tenant_id: actor.tenantId, code: source.code, title: source.title, body_markdown: normaliseProse(source.body_markdown), attachment_path: source.attachment_path,
    states: source.states, carrier_ids: source.carrier_ids, version, status: "draft", created_by: actor.userId,
  }).select("id").single();
  if (inserted.error) fail(inserted.error, "Could not copy the disclosure");
  await writeRules(inserted.data.id, (await rulesFor([source.id])).get(source.id) ?? []);
  await auditSales(actor, "tenant.application_disclosure_created", "application_disclosure", inserted.data.id, { version, copiedFromPlatform: source.id, copiedFromVersion: source.version });
  return itemById(actor.tenantId, inserted.data.id);
}

/**
 * Published → retired: the agency stops using its own version of this code. New applications stop
 * attaching it (the Insurvas version of the same code, if there is one, applies again); one already
 * acknowledged keeps the version it was given. The row itself is kept for good.
 */
export async function retireDisclosure(actor: Actor, id: string) {
  const row = await ownRow(actor.tenantId, id);
  if (row.status !== "published") throw new ApplicationError("DISCLOSURE_NOT_PUBLISHED", row.status === "draft" ? "A draft applies to nothing. Delete it instead." : `v${row.version} is already retired.`, 409);
  const upd = await db().from("application_disclosures").update({ status: "retired" }).eq("tenant_id", actor.tenantId).eq("id", row.id).eq("status", "published").select("id");
  if (upd.error) fail(upd.error, "Could not retire the disclosure");
  if (!rows(upd.data).length) throw new ApplicationError("DISCLOSURE_CHANGED", "This version changed a moment ago. Refresh to see it.", 409);
  await auditSales(actor, "tenant.application_disclosure_retired", "application_disclosure", row.id, { code: row.code, version: row.version, before: { status: "published" }, after: { status: "retired" } });
  return itemById(actor.tenantId, row.id);
}

/** Only a draft can go; its own PDF goes with it. Published and retired versions are kept for good. */
export async function discardDraft(actor: Actor, id: string) {
  const row = await ownRow(actor.tenantId, id);
  if (row.status !== "draft") throw new ApplicationError("DISCLOSURE_PUBLISHED_IMMUTABLE", `v${row.version} is ${row.status} and is kept. Only a draft can be discarded.`, 409);
  const del = await db().from("application_disclosures").delete().eq("tenant_id", actor.tenantId).eq("id", row.id).eq("status", "draft");
  if (del.error) fail(del.error, "Could not discard the draft");
  if (row.attachment_path?.startsWith(`${actor.tenantId}/disclosures/${row.id}-`)) await db().storage.from(BUCKET).remove([row.attachment_path]);
  await auditSales(actor, "tenant.application_disclosure_discarded", "application_disclosure", row.id, { code: row.code, version: row.version });
  return { discarded: row.id };
}

/** Attaches (or replaces) a draft's PDF. A published version's PDF is part of what was acknowledged. */
export async function attachPdf(actor: Actor, id: string, file: File) {
  const row = await ownRow(actor.tenantId, id);
  if (row.status !== "draft") throw new ApplicationError("DISCLOSURE_PUBLISHED_IMMUTABLE", `v${row.version} is ${row.status}; attach the PDF to a new version.`, 409);
  if (file.size === 0) throw new ApplicationError("DISCLOSURE_PDF_EMPTY", "That file is empty.");
  if (file.size > MAX_PDF_BYTES) throw new ApplicationError("DISCLOSURE_PDF_TOO_LARGE", "The PDF must be 10 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
  if (!isPdf) throw new ApplicationError("DISCLOSURE_PDF_TYPE", "Attach a PDF file.");
  const path = `${actor.tenantId}/disclosures/${row.id}-v${row.version}.pdf`;
  const up = await db().storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (up.error) throw new ApplicationError("DISCLOSURE_PDF_UPLOAD", `The PDF could not be stored: ${up.error.message}`, 502);
  const upd = await db().from("application_disclosures").update({ attachment_path: path }).eq("tenant_id", actor.tenantId).eq("id", row.id).eq("status", "draft");
  if (upd.error) fail(upd.error, "Could not attach the PDF");
  await auditSales(actor, "tenant.application_disclosure_attached", "application_disclosure", row.id, { version: row.version, bytes: file.size, replaced: Boolean(row.attachment_path) });
  return itemById(actor.tenantId, row.id);
}

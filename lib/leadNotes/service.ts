import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { TenantRole } from "@/lib/tenantAuth/roles";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOTE_MAX = 10000;
const NOTE_ROLES: TenantRole[] = ["owner", "producer", "assistant"];

type NoteRow = { id: string; tenant_id: string; lead_id: string; author_user_id: string; body: string; visibility: string; idempotency_key: string | null; created_at: string; edited_at: string | null; deleted_at: string | null };
type EditRow = { id: string; note_id: string; action: string; old_body: string; old_visibility: string; new_body: string | null; new_visibility: string | null; actor_user_id: string; created_at: string };
type UserRow = { id: string; name: string; role?: string };

function validUuid(value: string) { return UUID.test(value); }
function cleanBody(value: unknown) {
  if (typeof value !== "string") throw new Error("Write a note before saving");
  const body = value.replaceAll("\u0000", "").trim();
  if (!body || body.length > NOTE_MAX) throw new Error(`Notes must be between 1 and ${NOTE_MAX.toLocaleString()} characters`);
  return body;
}
function visibility(value: unknown): "internal" | "shared" {
  if (value === undefined) return "internal";
  if (value !== "internal" && value !== "shared") throw new Error("Choose internal or shared visibility");
  return value;
}
function mentionIds(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20 || value.some((item) => typeof item !== "string" || !validUuid(item))) throw new Error("Choose valid teammates to mention");
  return [...new Set(value as string[])];
}

async function leadExists(tenantId: string, leadId: string) {
  if (!validUuid(leadId)) throw new Error("Choose a valid lead");
  const result = await getSupabaseServiceClient().from("agent_leads").select("id").eq("tenant_id", tenantId).eq("id", leadId).maybeSingle();
  if (result.error) throw new Error(`Could not verify lead: ${result.error.message}`);
  if (!result.data) throw new Error("Lead not found");
}

async function activeMembers(tenantId: string, ids?: string[]) {
  const db = getSupabaseServiceClient();
  let membership = db.from("tenant_users").select("user_id, role").eq("tenant_id", tenantId).not("accepted_at", "is", null);
  if (ids?.length) membership = membership.in("user_id", ids);
  const members = await membership;
  if (members.error) throw new Error(`Could not load teammates: ${members.error.message}`);
  const userIds = (members.data ?? []).map((row) => row.user_id);
  if (!userIds.length) return [] as UserRow[];
  const users = await db.from("users").select("id, name").in("id", userIds).eq("status", "active");
  if (users.error) throw new Error(`Could not load teammates: ${users.error.message}`);
  const roles = new Map((members.data ?? []).map((row) => [row.user_id, String(row.role)]));
  return (users.data ?? []).map((user) => ({ ...user, role: roles.get(user.id) })) as UserRow[];
}

async function validMentions(tenantId: string, ids: string[], authorId: string) {
  if (!ids.length) return [] as UserRow[];
  const members = await activeMembers(tenantId, ids);
  if (members.length !== ids.length) throw new Error("Mention only active teammates in this tenant");
  return members.filter((member) => member.id !== authorId);
}

async function enrich(notes: NoteRow[], tenantId: string) {
  const db = getSupabaseServiceClient();
  if (!notes.length) return [];
  const ids = notes.map((note) => note.id);
  const edits = await db.from("lead_note_edits").select("id, note_id, action, old_body, old_visibility, new_body, new_visibility, actor_user_id, created_at").eq("tenant_id", tenantId).in("note_id", ids).order("created_at", { ascending: true });
  const mentions = await db.from("lead_note_mentions").select("note_id, mentioned_user_id").eq("tenant_id", tenantId).in("note_id", ids);
  if (edits.error || mentions.error) throw new Error(`Could not load note history: ${edits.error?.message ?? mentions.error?.message}`);
  const userIds = [...new Set([...notes.map((note) => note.author_user_id), ...(edits.data ?? []).map((edit) => edit.actor_user_id)])];
  const users = userIds.length ? await db.from("users").select("id, name").in("id", userIds) : { data: [], error: null };
  if (users.error) throw new Error(`Could not load note authors: ${users.error.message}`);
  const names = new Map((users.data ?? []).map((user) => [user.id, user.name]));
  const byNote = new Map<string, EditRow[]>();
  for (const edit of (edits.data ?? []) as EditRow[]) byNote.set(edit.note_id, [...(byNote.get(edit.note_id) ?? []), edit]);
  const mentionMap = new Map<string, string[]>();
  for (const mention of mentions.data ?? []) mentionMap.set(mention.note_id, [...(mentionMap.get(mention.note_id) ?? []), mention.mentioned_user_id]);
  return notes.map((note) => ({
    id: note.id,
    leadId: note.lead_id,
    body: note.deleted_at ? null : note.body,
    visibility: note.visibility as "internal" | "shared",
    author: { id: note.author_user_id, name: names.get(note.author_user_id) ?? "Unknown user" },
    createdAt: note.created_at,
    editedAt: note.edited_at,
    deletedAt: note.deleted_at,
    mentions: mentionMap.get(note.id) ?? [],
    history: (byNote.get(note.id) ?? []).map((edit) => ({ ...edit, actor: { id: edit.actor_user_id, name: names.get(edit.actor_user_id) ?? "Unknown user" } })),
  }));
}

export async function listLeadNotes(tenantId: string, leadId: string) {
  await leadExists(tenantId, leadId);
  const result = await getSupabaseServiceClient().from("lead_notes").select("id, tenant_id, lead_id, author_user_id, body, visibility, idempotency_key, created_at, edited_at, deleted_at").eq("tenant_id", tenantId).eq("lead_id", leadId).order("created_at", { ascending: false });
  if (result.error) throw new Error(`Could not load lead notes: ${result.error.message}`);
  return enrich((result.data ?? []) as NoteRow[], tenantId);
}

export async function listTeammates(tenantId: string) { return activeMembers(tenantId); }

async function syncPartnerNote(tenantId: string, leadId: string, noteId: string, body: string, authorId: string) {
  const db = getSupabaseServiceClient();
  const queue = await db.from("lead_queue").select("id, partner_id").eq("tenant_id", tenantId).eq("lead_id", leadId).order("queued_at", { ascending: false }).limit(1).maybeSingle();
  if (queue.error) throw new Error(`Could not resolve note partner: ${queue.error.message}`);
  if (!queue.data?.partner_id) return;
  const eventKey = `lead-note:${noteId}`;
  const channel = await db.from("partner_channels").select("id, status").eq("tenant_id", tenantId).eq("partner_id", queue.data.partner_id).eq("channel_type", "partner").maybeSingle();
  if (channel.error || !channel.data || channel.data.status !== "active") throw new Error("Partner channel is not available for a shared note");
  const existing = await db.from("partner_messages").select("id").eq("tenant_id", tenantId).eq("event_key", eventKey).maybeSingle();
  if (existing.error) throw new Error(`Could not check shared note delivery: ${existing.error.message}`);
  if (existing.data) {
    const updated = await db.from("partner_messages").update({ message: body }).eq("tenant_id", tenantId).eq("id", existing.data.id);
    if (updated.error) throw new Error(`Could not update shared note: ${updated.error.message}`);
    return;
  }
  const inserted = await db.from("partner_messages").insert({ tenant_id: tenantId, partner_id: queue.data.partner_id, channel_id: channel.data.id, work_item_id: queue.data.id, message: body, message_kind: "text", card_type: null, card_payload: {}, event_key: eventKey, created_by: authorId }).select("id").maybeSingle();
  if (inserted.error && inserted.error.code !== "23505") throw new Error(`Could not post shared note: ${inserted.error.message}`);
}

async function notifyMentions(tenantId: string, leadId: string, noteId: string, body: string, members: UserRow[]) {
  if (!members.length) return;
  const db = getSupabaseServiceClient();
  const notifications = members.map((member) => ({ tenant_id: tenantId, recipient_user_id: member.id, kind: "lead_note_mention", title: "You were mentioned in a lead note", body: body.slice(0, 1000), link: `/app/leads/${leadId}?tab=notes`, source_key: `lead-note-mention:${noteId}:${member.id}` }));
  const result = await db.from("agent_notifications").upsert(notifications, { onConflict: "tenant_id,recipient_user_id,source_key", ignoreDuplicates: true });
  if (result.error) throw new Error(`Could not notify mentioned teammates: ${result.error.message}`);
}

export async function createLeadNote(input: { tenantId: string; userId: string; role: TenantRole; leadId: string; body: unknown; visibility?: unknown; mentions?: unknown; idempotencyKey?: unknown }) {
  if (!NOTE_ROLES.includes(input.role)) throw new Error("You cannot write lead notes");
  await leadExists(input.tenantId, input.leadId);
  const body = cleanBody(input.body);
  const noteVisibility = visibility(input.visibility);
  const idempotencyKey = input.idempotencyKey === undefined ? null : typeof input.idempotencyKey === "string" && input.idempotencyKey.length <= 120 ? input.idempotencyKey : (() => { throw new Error("Choose a valid idempotency key"); })();
  const db = getSupabaseServiceClient();
  const ids = mentionIds(input.mentions);
  const mentioned = await validMentions(input.tenantId, ids, input.userId);
  const inserted = await db.from("lead_notes").insert({ tenant_id: input.tenantId, lead_id: input.leadId, author_user_id: input.userId, body, visibility: noteVisibility, idempotency_key: idempotencyKey }).select("id, tenant_id, lead_id, author_user_id, body, visibility, idempotency_key, created_at, edited_at, deleted_at").maybeSingle();
  if (inserted.error?.code === "23505" && idempotencyKey) {
    const existing = await db.from("lead_notes").select("id, tenant_id, lead_id, author_user_id, body, visibility, idempotency_key, created_at, edited_at, deleted_at").eq("tenant_id", input.tenantId).eq("idempotency_key", idempotencyKey).single();
    if (existing.error || !existing.data) throw new Error("This note request was already used");
    return { note: (await enrich([existing.data as NoteRow], input.tenantId))[0], duplicate: true };
  }
  if (inserted.error || !inserted.data) throw new Error(`Could not save note: ${inserted.error?.message ?? "No note returned"}`);
  const note = inserted.data as NoteRow;
  if (mentioned.length) {
    const rows = mentioned.map((member) => ({ tenant_id: input.tenantId, note_id: note.id, mentioned_user_id: member.id }));
    const mentionResult = await db.from("lead_note_mentions").insert(rows);
    if (mentionResult.error) throw new Error(`Could not save note mentions: ${mentionResult.error.message}`);
    await notifyMentions(input.tenantId, input.leadId, note.id, body, mentioned);
  }
  if (noteVisibility === "shared") await syncPartnerNote(input.tenantId, input.leadId, note.id, body, input.userId);
  return { note: (await enrich([note], input.tenantId))[0], duplicate: false };
}

export async function updateLeadNote(input: { tenantId: string; userId: string; role: TenantRole; leadId: string; noteId: string; body?: unknown; visibility?: unknown; mentions?: unknown }) {
  if (!validUuid(input.noteId)) throw new Error("Choose a valid note");
  const db = getSupabaseServiceClient();
  const current = await db.from("lead_notes").select("id, tenant_id, lead_id, author_user_id, body, visibility, idempotency_key, created_at, edited_at, deleted_at").eq("tenant_id", input.tenantId).eq("id", input.noteId).maybeSingle();
  if (current.error || !current.data) throw new Error("Note not found");
  const row = current.data as NoteRow;
  if (row.lead_id !== input.leadId) throw new Error("Note not found");
  if (row.deleted_at) throw new Error("Deleted notes cannot be changed");
  const isAuthor = row.author_user_id === input.userId;
  const isRay = input.role === "owner";
  if (!isAuthor && !isRay) throw new Error("Only the note author or owner can change this note");
  const nextBody = input.body === undefined ? row.body : cleanBody(input.body);
  if (!isAuthor && input.body !== undefined) throw new Error("Only the note author can edit note text");
  const nextVisibility = input.visibility === undefined ? row.visibility as "internal" | "shared" : visibility(input.visibility);
  const ids = mentionIds(input.mentions);
  const mentioned = await validMentions(input.tenantId, ids, input.userId);
  const action = nextBody !== row.body && nextVisibility !== row.visibility ? "edited" : nextBody !== row.body ? "edited" : "visibility_changed";
  const history = await db.from("lead_note_edits").insert({ tenant_id: input.tenantId, note_id: row.id, lead_id: row.lead_id, actor_user_id: input.userId, action, old_body: row.body, old_visibility: row.visibility, new_body: nextBody, new_visibility: nextVisibility });
  if (history.error) throw new Error(`Could not save note history: ${history.error.message}`);
  const updated = await db.from("lead_notes").update({ body: nextBody, visibility: nextVisibility, edited_at: new Date().toISOString() }).eq("tenant_id", input.tenantId).eq("id", row.id).eq("body", row.body).eq("visibility", row.visibility).select("id, tenant_id, lead_id, author_user_id, body, visibility, idempotency_key, created_at, edited_at, deleted_at").maybeSingle();
  if (updated.error || !updated.data) throw new Error("Note changed while you were editing; reload and try again");
  if (ids.length) {
    await db.from("lead_note_mentions").upsert(mentioned.map((member) => ({ tenant_id: input.tenantId, note_id: row.id, mentioned_user_id: member.id })), { onConflict: "note_id,mentioned_user_id", ignoreDuplicates: true });
    await notifyMentions(input.tenantId, row.lead_id, row.id, nextBody, mentioned);
  }
  if (nextVisibility === "shared") await syncPartnerNote(input.tenantId, row.lead_id, row.id, nextBody, input.userId);
  return (await enrich([updated.data as NoteRow], input.tenantId))[0];
}

export async function deleteLeadNote(input: { tenantId: string; userId: string; leadId: string; noteId: string }) {
  if (!validUuid(input.noteId)) throw new Error("Choose a valid note");
  const db = getSupabaseServiceClient();
  const current = await db.from("lead_notes").select("id, tenant_id, lead_id, author_user_id, body, visibility, idempotency_key, created_at, edited_at, deleted_at").eq("tenant_id", input.tenantId).eq("id", input.noteId).maybeSingle();
  if (current.error || !current.data) throw new Error("Note not found");
  const row = current.data as NoteRow;
  if (row.lead_id !== input.leadId) throw new Error("Note not found");
  if (row.author_user_id !== input.userId) throw new Error("Only the note author can delete this note");
  if (row.deleted_at) return (await enrich([row], input.tenantId))[0];
  const history = await db.from("lead_note_edits").insert({ tenant_id: input.tenantId, note_id: row.id, lead_id: row.lead_id, actor_user_id: input.userId, action: "deleted", old_body: row.body, old_visibility: row.visibility, new_body: null, new_visibility: row.visibility });
  if (history.error) throw new Error(`Could not save deletion history: ${history.error.message}`);
  const deleted = await db.from("lead_notes").update({ deleted_at: new Date().toISOString(), edited_at: new Date().toISOString() }).eq("tenant_id", input.tenantId).eq("id", row.id).is("deleted_at", null).select("id, tenant_id, lead_id, author_user_id, body, visibility, idempotency_key, created_at, edited_at, deleted_at").maybeSingle();
  if (deleted.error || !deleted.data) throw new Error("Note changed while you were deleting it; reload and try again");
  return (await enrich([deleted.data as NoteRow], input.tenantId))[0];
}

export async function searchLeadNotes(tenantId: string, query: string) {
  const clean = query.replaceAll("\u0000", "").trim();
  if (clean.length < 2 || clean.length > 120) throw new Error("Search must be between 2 and 120 characters");
  const result = await getSupabaseServiceClient().from("lead_notes").select("id, tenant_id, lead_id, author_user_id, body, visibility, idempotency_key, created_at, edited_at, deleted_at").eq("tenant_id", tenantId).is("deleted_at", null).textSearch("body", clean, { config: "simple", type: "websearch" }).order("created_at", { ascending: false }).limit(50);
  if (result.error) throw new Error(`Could not search notes: ${result.error.message}`);
  return enrich((result.data ?? []) as NoteRow[], tenantId);
}

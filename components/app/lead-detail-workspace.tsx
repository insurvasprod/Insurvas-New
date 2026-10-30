"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Hand, Loader2 } from "lucide-react";
import { notify } from "@/lib/notify";
import { claimedMessage, releaseDialog } from "@/lib/transferInbox/constants";

import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { SamePersonPrompt } from "@/components/app/same-person-prompt";
import { Ring } from "@/components/app/inbound/stream-parts";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { PagedBody, PagedPager, PagedProvider } from "@/components/ui/paged";
import { Pager, paginate } from "@/components/ui/pager";
import { TableCard } from "@/components/ui/table-card";
import { MONTHS } from "@/lib/format/dates";
import { ErrorState } from "@/components/ui/page-states";
import type { LeadLineage, LeadNextAction } from "@/lib/leadWorkspace/lineage";
import { LeadAttemptsTab, LeadCallbacksTab, LeadNurtureTab } from "@/components/app/lead-record-tabs";
import { DispositionWizardDialog } from "@/components/app/disposition-wizard-dialog";
import { LeadSignatureReadiness } from "@/components/app/lead-signature-readiness";
import { LeadApplicationEntry } from "@/components/app/applications/lead-application-entry";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Segmented, UnderlineTabs } from "@/components/ui/view-tabs";

type Template = { product_name: string; definition_version?: number; fields: Array<{ field_key: string; label: string; type: string; is_required: boolean; options: string[]; help_text?: string | null }>; form_definition: { sections: Array<{ section_key: string; label: string; fields: Array<{ field_key: string; is_required: boolean; show_when: { field_key: string; equals: string } | null; conditional_on?: { field_key: string; equals: string } | null }> }> } };
type Event = { id: string; label: string; at: string; actor: string; detail: string | null; immutable: boolean };
type Note = { id: string; leadId: string; body: string | null; visibility: "internal" | "shared"; author: { id: string; name: string }; createdAt: string; editedAt: string | null; deletedAt: string | null; mentions: string[]; history: Array<{ id: string; action: string; old_body: string; old_visibility: string; new_body: string | null; new_visibility: string | null; created_at: string; actor: { id: string; name: string } }> };
type Workspace = { lead: { id: string; values: Record<string, unknown>; product_line: string; definition_version: number; created_at: string; updated_at: string }; template: Template; queue: { id: string; status: string; owner_user_id: string | null; claimed_at: string | null; disposition: string | null } | null; partner: { name: string; partner_type: string } | null; stage: { id: string; name: string; stage_type: string; color: string } | null; stages: Array<{ id: string; name: string; stage_type: string; color: string }>; submitter: { name: string } | null; owner: { name: string } | null; screening: { outcome: string | null; warning: string | null; checkedAt: string | null }; attemptHistory: Array<{ id: string; attempt_number: number; slot: string; attempted_at: string; disposition: string | null; dial_clicked_at: string | null }>; preflight: { status: string; checkedAt: string | null; policyMatchingIncluded?: false; policyMatchingNote?: string; matches?: Array<{ leadId: string | null; contactId: string | null; submittedAt: string; partnerName: string | null; productLine: string | null; outcome: string | null; matchedOn: string[]; sourceType: "lead" | "contact" }>; soldByPartners?: Array<{ partnerId: string; partnerName: string }>; soldByMultiplePartners?: boolean }; disposition: { label: string } | null; verification: { session: { status: string; progress_percentage: number; started_at: string; completed_at: string | null }; fields: Array<{ field_key: string; state: string; old_value: unknown; new_value: unknown; confirmed_at: string | null }> } | null; corrections: Array<{ id: string; field_key: string; old_value: unknown; new_value: unknown; actor_id: string | null; created_at: string }>; notes: Note[]; teammates: Array<{ id: string; name: string; role?: string }>; timeline: Event[]; role: string; currentUserId: string; licensedAgents: Array<{ id: string; name: string; role: string }>; pendingHandoff: { id: string; workItemId: string } | null; actions: { canClaim: boolean; canHandoff: boolean; canAcceptHandoff: boolean; canDisposition: boolean; canChangeStage: boolean; canUnassign?: boolean; canRequeue?: boolean; canEndBufferInvolvement?: boolean }; transfer?: { phase: string; phaseLabel: string; buffer: { id: string; name: string; onCall: boolean } | null; requeueCount: number } | null; lineage?: LeadLineage | null; nextAction?: LeadNextAction; readOnly: boolean; activeCall?: { startedAt: string; agentName: string | null } | null; quotedMonthlyCents?: number | null };

// A currency field holds cents and a yes/no field a boolean: shown as the form showed them, not
// "25000000" and "false" (QA pass 2026-10-22).
function display(value: unknown, type?: string) {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined || value === "") return "Not provided";
  if (type === "currency" && typeof value === "number") return (value / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
function when(value: string) { return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
function visible(field: { show_when: { field_key: string; equals: string } | null; conditional_on?: { field_key: string; equals: string } | null }, values: Record<string, unknown>) { const condition = field.show_when ?? field.conditional_on; if (!condition) return true; const current = values[condition.field_key]; return Array.isArray(current) ? current.includes(condition.equals) : String(current ?? "") === condition.equals; }
function stateTone(state: string) { return state === "outstanding" ? "danger" : state === "corrected" ? "warning" : "good"; }

function VerificationTab({ data }: { data: Workspace }) {
  if (!data.verification) return <p className="text-sm text-muted-foreground">Verification has not started for this lead.</p>;
  return <div className="space-y-5"><div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Verification progress</p><p className="mt-1 text-2xl font-semibold">{data.verification.session.progress_percentage}%</p></div><div className="flex items-center gap-2"><StatusChip tone={data.verification.session.progress_percentage === 100 ? "good" : "info"}>{data.verification.session.status}</StatusChip>{data.queue && data.queue.owner_user_id === data.currentUserId && <Button asChild><Link href={`/app/inbound/call/${data.queue.id}`}>Open live verification</Link></Button>}</div></div><div className="h-3 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${data.verification.session.progress_percentage}%` }} /></div><p className="text-xs text-muted-foreground">Started {when(data.verification.session.started_at)}{data.verification.session.completed_at ? ` · completed ${when(data.verification.session.completed_at)}` : ""}</p></div><div><h3 className="text-sm font-semibold">Field confirmation</h3><div className="mt-2 divide-y rounded-md border">{data.verification.fields.map((field) => <div key={field.field_key} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm"><span>{field.field_key}</span><div className="flex items-center gap-2"><StatusChip tone={stateTone(field.state)}>{field.state}</StatusChip>{field.state === "corrected" && <span className="text-xs text-muted-foreground">{display(field.old_value)} → {display(field.new_value)}</span>}</div></div>)}</div></div></div>;
}

// "18 Sep 4:19 pm", as the board stamps a note.
function noteTime(value: string) { const d = new Date(value); if (Number.isNaN(d.getTime())) return "—"; const h = d.getHours(); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; }
const FIELD = "rounded-lg border border-[var(--border-strong)] bg-card text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
type PartnerLine = { id: string; body: string; title: string | null; system: boolean; author: string | null; fromPartner: boolean; createdAt: string };
type ConversationView = "all" | "internal" | "shared";
type Entry = { kind: "note"; at: string; note: Note } | { kind: "partner"; at: string; line: PartnerLine };

/**
 * The lead's Conversation (Module 1 simplified, 2026-10-25): notes and the partner's channel about
 * this lead, in one place. A note is Internal (the team) or Shared (posted to the partner's channel,
 * LA-1.21); the partner's replies and the automatic cards for this lead come back in the same list.
 * The view switch narrows it to the team's own notes or to what the partner can see.
 */
function NotesTab({ data, refresh }: { data: Workspace; refresh: () => Promise<void> }) {
  const [view, setView] = useState<ConversationView>("all");
  const [partnerLines, setPartnerLines] = useState<PartnerLine[] | null>(null);
  const hasPartner = Boolean(data.partner);
  const readsPartner = hasPartner && (data.role === "owner" || data.role === "producer");
  const loadPartner = useCallback(async () => {
    if (!readsPartner) return;
    const response = await fetch(`/api/app/leads/${encodeURIComponent(data.lead.id)}/conversation`, { cache: "no-store" }).catch(() => null);
    const result = response?.ok ? await response.json().catch(() => null) as { messages?: PartnerLine[] } | null : null;
    setPartnerLines(result?.messages ?? []);
  }, [data.lead.id, readsPartner]);
  // The partner's side is read once the tab opens, and again after a note is saved.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the first read of the partner's channel
  useEffect(() => { void loadPartner(); }, [loadPartner]);
  const [body, setBody] = useState("");
  const [noteVisibility, setNoteVisibility] = useState<"internal" | "shared">("internal");
  const [mentions, setMentions] = useState<string[]>([]);
  const [editing, setEditing] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Note[] | null>(null);
  const [page, setPage] = useState(1);
  const canWrite = !data.readOnly && ["owner", "producer", "assistant"].includes(data.role);
  const edit = (note: Note) => { setEditing(note); setBody(note.body ?? ""); setNoteVisibility(note.visibility); setMentions(note.mentions); };
  const reset = () => { setEditing(null); setBody(""); setNoteVisibility("internal"); setMentions([]); };
  async function save() {
    setBusy(true);
    const path = `/api/app/leads/${encodeURIComponent(data.lead.id)}/notes`;
    const response = await fetch(path, { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing ? { note_id: editing.id, body, visibility: noteVisibility, mentions } : { body, visibility: noteVisibility, mentions, idempotency_key: crypto.randomUUID() }) });
    const result = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) { notify.block(result?.error ?? "Could not save note"); return; }
    notify.done(editing ? "Note updated" : noteVisibility === "shared" ? "Shared with the partner" : "Note saved"); reset(); await refresh(); void loadPartner();
  }
  async function remove(note: Note) {
    if (!(await confirmAction({ title: "Delete this note?", description: "It will remain as a tombstone in the timeline.", confirmLabel: "Delete note", cancelLabel: "Keep note" }))) return;
    setBusy(true); const response = await fetch(`/api/app/leads/${encodeURIComponent(data.lead.id)}/notes`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note_id: note.id }) }); const result = await response.json().catch(() => null); setBusy(false);
    if (!response.ok) { notify.block(result?.error ?? "Could not delete note"); return; } notify.done("Note deleted"); await refresh();
  }
  async function changeVisibility(note: Note) {
    setBusy(true); const response = await fetch(`/api/app/leads/${encodeURIComponent(data.lead.id)}/notes`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note_id: note.id, visibility: note.visibility === "shared" ? "internal" : "shared" }) }); const result = await response.json().catch(() => null); setBusy(false);
    if (!response.ok) { notify.block(result?.error ?? "Could not change visibility"); return; } notify.done("Note visibility changed"); await refresh();
  }
  async function runSearch() {
    setPage(1);
    if (search.trim().length < 2) { setSearchResults(null); return; }
    const response = await fetch(`/api/app/notes/search?q=${encodeURIComponent(search)}`, { cache: "no-store" }); const result = await response.json().catch(() => null); if (!response.ok) { notify.block(result?.error ?? "Could not search notes"); return; } setSearchResults(result.notes ?? []);
  }
  function toggleMention(id: string) { setMentions((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  // Searching notes across leads shows notes only; otherwise the lead's notes and partner lines, newest first.
  const entries: Entry[] = searchResults
    ? searchResults.map((note) => ({ kind: "note" as const, at: note.createdAt, note }))
    : [
        ...data.notes.filter((note) => view === "all" || (view === "internal" ? note.visibility === "internal" : note.visibility === "shared")).map((note) => ({ kind: "note" as const, at: note.createdAt, note })),
        ...(view === "internal" ? [] : (partnerLines ?? []).map((line) => ({ kind: "partner" as const, at: line.createdAt, line }))),
      ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const shown = entries;
  const paged = paginate(shown, page);
  // The board draws the tab flat: the composer, then one ruled row per note, no card inside the card.
  // Mentions, cross-lead search and edit history are not on the board but people use them, so they
  // stay, drawn in the same rows.
  return (
    <div>
      <div className="px-5 py-[18px]">
        <label className="block">
          <span className="text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--body)]">{editing ? "Edit note" : "Add a note"}</span>
          <textarea aria-label="Note text" value={body} onChange={(event) => setBody(event.target.value)} disabled={!canWrite || busy} maxLength={10000} rows={3} placeholder="What happened? Keep it plain text." className={`${FIELD} mt-1.5 box-border block w-full resize-y px-3 py-2.5 text-base leading-normal tracking-[-0.02em]`} />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div role="radiogroup" aria-label="Note visibility" className="inline-flex h-9 items-center gap-0.5 rounded-full border border-border p-0.5">
            {([["internal", "Internal", "Your team only"], ["shared", "Shared", hasPartner ? `${data.partner?.name ?? "The partner"} can see it` : "This lead has no partner to share with"]] as const).map(([value, text, hint]) => (
              <button key={value} type="button" role="radio" aria-checked={noteVisibility === value} title={hint} onClick={() => setNoteVisibility(value)} disabled={!canWrite || busy || (value === "shared" && !hasPartner && noteVisibility !== "shared")} className={`inline-flex h-8 items-center rounded-full px-3.5 text-sm font-semibold tracking-[-0.01em] transition-colors disabled:opacity-50 ${noteVisibility === value ? "bg-[var(--primary)] text-[var(--on-primary)]" : "text-muted-foreground hover:text-foreground"}`}>{text}</button>
            ))}
          </div>
          <span className="text-xs leading-normal text-muted-foreground">{noteVisibility === "shared" ? (hasPartner ? `Posted to ${data.partner?.name ?? "the partner"}’s channel` : "No partner on this lead") : "Only your team sees it"}</span>
          <span className="flex-grow" />
          {editing && <Button type="button" variant="ghost" onClick={reset}>Cancel</Button>}
          <Button type="button" disabled={!canWrite || busy || !body.trim()} onClick={() => void save()}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}{editing ? "Save changes" : "Save note"}</Button>
        </div>
        {data.teammates.length > 1 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">Mention</span>
            {data.teammates.filter((user) => user.id !== data.currentUserId).map((user) => <label key={user.id} className="inline-flex items-center gap-2 text-sm text-[var(--body)]"><input type="checkbox" checked={mentions.includes(user.id)} onChange={() => toggleMention(user.id)} disabled={!canWrite || busy} className="size-4 accent-primary" />{user.name}{user.role ? ` (${user.role})` : ""}</label>)}
          </div>
        )}
      </div>
      {!searchResults && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-5 py-3">
          <Segmented label="Show" options={[{ key: "all", label: "All" }, { key: "internal", label: "Internal" }, { key: "shared", label: hasPartner ? "Shared with partner" : "Shared" }]} value={view} onChange={(value) => { setView(value); setPage(1); }} />
          {readsPartner && partnerLines === null && <span className="text-xs text-muted-foreground">Reading the partner’s messages…</span>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
        <label className="text-sm leading-normal tracking-[-0.02em] text-[var(--body)]" htmlFor="note-search">Search notes across leads</label>
        <input id="note-search" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void runSearch(); }} placeholder="Search note text" className={`${FIELD} h-9 w-full max-w-xs px-3 text-sm`} />
        <Button type="button" variant="outline" onClick={() => void runSearch()}>Search</Button>
        {searchResults && <Button type="button" variant="ghost" onClick={() => { setSearchResults(null); setSearch(""); setPage(1); }}>Clear</Button>}
      </div>
      {paged.rows.map((entry) => {
        if (entry.kind === "partner") {
          const line = entry.line;
          return (
            <div key={`partner-${line.id}`} className="border-t border-border bg-[color-mix(in_srgb,var(--primary-soft)_45%,transparent)] px-5 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">{line.system ? line.title ?? "Update" : line.author ?? "Someone"}</span>
                  <StatusChip tone={line.fromPartner ? "action" : "neutral"}>{line.system ? "Automatic update" : line.fromPartner ? `From ${data.partner?.name ?? "the partner"}` : "Partner channel"}</StatusChip>
                </span>
                <span className="shrink-0 text-xs leading-normal tabular-nums text-muted-foreground">{noteTime(line.createdAt)}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-[1.6] tracking-[-0.02em] text-[var(--body)]">{line.body}</p>
            </div>
          );
        }
        const note = entry.note;
        const related = [note.visibility === "shared" && !note.deletedAt ? `Posted to ${data.partner?.name ? `the ${data.partner.name}` : "the partner's"} channel` : null, note.mentions.length ? `${note.mentions.length} mention${note.mentions.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
        const mine = !note.deletedAt && note.author.id === data.currentUserId;
        const canShare = !note.deletedAt && data.role === "owner" && note.author.id !== data.currentUserId;
        const link = "font-semibold text-[var(--accent-ink)] hover:underline disabled:opacity-50";
        return (
          <div key={note.id} className={`border-t border-border px-5 py-4 ${note.deletedAt ? "bg-[var(--surface-alt)]" : ""}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">{note.deletedAt ? "Note deleted" : note.author.name}</span>
                {!note.deletedAt && <StatusChip tone={note.visibility === "shared" ? "action" : "neutral"}>{note.visibility === "shared" ? "Shared" : "Internal"}</StatusChip>}
                {note.editedAt && !note.deletedAt && <span className="text-xs leading-normal text-muted-foreground">edited</span>}
              </span>
              <span className="shrink-0 text-xs leading-normal tabular-nums text-muted-foreground">{noteTime(note.createdAt)}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-[1.6] tracking-[-0.02em] text-[var(--body)]">{note.deletedAt ? "This note was deleted. The timeline record is retained." : note.body}</p>
            {(related || mine || canShare || note.history.length > 0) && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-normal text-muted-foreground">
                {related && <span>{related}</span>}
                {mine && <><button type="button" className={link} disabled={!canWrite || busy} onClick={() => edit(note)}>Edit</button><button type="button" className={link} disabled={!canWrite || busy} onClick={() => void remove(note)}>Delete</button></>}
                {canShare && <button type="button" className={link} disabled={!canWrite || busy} onClick={() => void changeVisibility(note)}>{note.visibility === "shared" ? "Make internal" : "Share note"}</button>}
                {note.history.length > 0 && <details><summary className="cursor-pointer">Edit history ({note.history.length})</summary><div className="mt-2 space-y-1 border-l border-border pl-3">{note.history.map((change) => <p key={change.id}>{change.actor.name} · {change.action} · {noteTime(change.created_at)}</p>)}</div></details>}
              </div>
            )}
          </div>
        );
      })}
      {shown.length > 10 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted-foreground"><Pager page={paged.current} total={shown.length} noun="messages" onPage={setPage} /></div>}
      {shown.length === 0 && <p className="border-t border-border px-5 py-6 text-sm leading-normal tracking-[-0.02em] text-muted-foreground">{searchResults ? "No note matches that search." : view === "internal" ? "No internal notes yet." : view === "shared" ? "Nothing shared with the partner yet." : "No conversation yet."}</p>}
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = { import: "List import", partner: "Partner submission", affiliate: "Affiliate link", recycle: "Recycled from nurture" };
const shortId = (id: string) => id.slice(0, 8).toUpperCase();
function stamp(value: string) { const d = new Date(value); return Number.isNaN(d.getTime()) ? "—" : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`; }
function dayOnly(value: string) { const d = new Date(value); return Number.isNaN(d.getTime()) ? "—" : `${d.getDate()} ${MONTHS[d.getMonth()]}`; }
/** "Callback Thu 4:30 PM CDT" — in the customer's own zone, because that is the time they asked for. */
function nextActionLabel(next: LeadNextAction): string {
  if (!next) return "—";
  if (next.kind === "dial") return `Next dial ${stamp(next.at)}`;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: next.timezone, hour: "numeric", minute: "2-digit", timeZoneName: "short", weekday: "short" }).formatToParts(new Date(next.at));
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `Callback ${get("weekday")} ${get("hour")}:${get("minute")} ${get("dayPeriod")} ${get("timeZoneName")}`.replace(/\s+/g, " ").trim();
  } catch {
    return `Callback ${stamp(next.at)}`;
  }
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">{label}</p>
      <div className="mt-1 break-words text-sm font-semibold leading-normal tracking-[-0.02em] tabular-nums text-foreground">{children}</div>
    </div>
  );
}

/** The Lead detail tab as the board draws it: the lead's facts, what screening said, and the latest notes. */
function LeadDetailTab({ data, onAllNotes }: { data: Workspace; onAllNotes: () => void }) {
  const corrections = useMemo(() => new Map(data.corrections.map((change) => [change.field_key, change])), [data.corrections]);
  const fields = useMemo(() => new Map(data.template.fields.map((field) => [field.field_key, field])), [data.template.fields]);
  // Every field the form showed for this lead, in form order — the snapshot it was submitted with.
  const shown = data.template.form_definition.sections.flatMap((section) => section.fields.filter((field) => visible(field, data.lead.values)).map((formField) => fields.get(formField.field_key)).filter((field): field is NonNullable<typeof field> => Boolean(field)));
  const notes = data.notes.filter((note) => !note.deletedAt).slice(0, 2);
  const blocked = data.screening.outcome === "blocked";
  return (
    <div className="p-5">
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((field) => {
          const change = corrections.get(field.field_key);
          return (
            <Fact key={field.field_key} label={field.label}>
              {display(data.lead.values[field.field_key], field.type)}
              {change && <span className="mt-1 block text-xs font-normal text-[var(--warning-ink)]">Was {display(change.old_value, field.type)} — corrected on verification</span>}
            </Fact>
          );
        })}
      </div>
      {shown.length === 0 && <p className="text-sm text-muted-foreground">This form version has no fields to show.</p>}
      <p className="mt-4 text-xs text-muted-foreground">As submitted on form version {data.lead.definition_version}.</p>
      {/* Under the fields: the answers are about finishing this application. Setters cannot sell. */}
      <LeadSignatureReadiness leadId={data.lead.id} readOnly={data.readOnly || data.role === "setter"} />

      {data.screening.warning && (
        <p role={blocked ? "alert" : "status"} className={`mt-5 rounded-lg border px-4 py-2.5 text-sm ${blocked ? "border-[var(--error)]/30 bg-[var(--error-surface)] text-[var(--error-ink)]" : "border-[var(--warning)]/30 bg-[var(--warning-surface)] text-[var(--warning-ink)]"}`}>
          <span className="font-semibold">{blocked ? "Screening blocked this lead" : "Screening needs review"}:</span> {data.screening.warning}
        </p>
      )}

      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em]">Recent notes</h2>
          {data.notes.length > 0 && <button type="button" onClick={onAllNotes} className="text-sm font-semibold text-foreground hover:underline">All notes</button>}
        </div>
        <div className="mt-3">
          {notes.map((note) => (
            <div key={note.id} className="border-t border-border py-3">
              <div className="flex justify-between gap-2">
                <span className="text-sm font-semibold">{note.author.name}</span>
                <span className="text-xs text-muted-foreground">{stamp(note.createdAt)}</span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-[var(--body)]">{note.body}</p>
            </div>
          ))}
          {notes.length === 0 && <p className="border-t border-border pt-3 text-sm text-muted-foreground">Nobody has written a note on this lead yet.</p>}
        </div>
      </div>
    </div>
  );
}

/** The board's identity line: phone · state · age · source · who submitted it. Only what is recorded. */
function identityLine(data: Workspace) {
  const v = data.lead.values;
  const pick = (...keys: string[]) => keys.map((key) => v[key]).find((value) => (typeof value === "string" && value.trim()) || typeof value === "number");
  const age = pick("age");
  return [
    pick("phone", "phone_number", "mobile_phone"),
    pick("state", "state_code", "address_state"),
    age != null ? `${age} yrs` : null,
    data.partner?.name ?? null,
    data.submitter ? `submitted by ${data.submitter.name}` : null,
  ].filter((part) => part != null && String(part).trim()).map(String).join(" · ");
}

/** "On a call · 4:12", ticking; a record open past four hours says it was never closed. */
function LiveCallStatus({ startedAt, agentName }: { startedAt: string; agentName: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  if (seconds > 4 * 3600) return <StatusChip tone="warning" dot>Call record open {Math.floor(seconds / 86400) ? `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h` : `${Math.floor(seconds / 3600)}h`}, never closed</StatusChip>;
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return <StatusChip tone="good" dot>On a call · {clock}{agentName ? ` · ${agentName}` : ""}</StatusChip>;
}

type TabKey = "application" | "attempts" | "verification" | "notes" | "callbacks" | "nurture" | "timeline";

export function LeadDetailWorkspace({ leadId }: { leadId: string }) {
  const [data, setData] = useState<Workspace | null>(null);
  const [tab, setTab] = useState<TabKey>("application");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [handoffTarget, setHandoffTarget] = useState("");
  const [outcomeOpen, setOutcomeOpen] = useState(false);

  const load = useCallback(async () => { const response = await fetch(`/api/app/leads/${encodeURIComponent(leadId)}`, { cache: "no-store" }); const body = await response.json().catch(() => null); if (!response.ok) { setError(body?.error ?? "Could not load this lead"); return; } setData(body); setError(""); }, [leadId]);
  // This is the server-backed detail snapshot and intentionally hydrates the client workspace.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function action(name: string, path: string, init: RequestInit, success: string) { setSaving(name); const response = await fetch(path, init); const body = await response.json().catch(() => null); setSaving(null); if (!response.ok) { notify.block(body?.error ?? "The action could not be completed"); return; } notify.done(success); await load(); }
  // The claim says whether it resumed the verification the transfer had when it was given back (LA-1.11-6).
  async function claim() {
    if (!data?.queue) return;
    setSaving("claim");
    const response = await fetch("/api/app/inbound/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ work_item_id: data.queue.id }) });
    const body = await response.json().catch(() => null);
    setSaving(null);
    if (!response.ok) { notify.block(body?.error ?? "The action could not be completed"); return; }
    notify.done(claimedMessage(body));
    await load();
  }
  function moveStage(event: React.ChangeEvent<HTMLSelectElement>) { if (!data) return; void action("stage", `/api/app/leads/${data.lead.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: data.lead.values, stage_id: event.target.value }) }, "Stage changed"); }
  function handoff() { if (!data?.queue) return; const target = handoffTarget || data.licensedAgents[0]?.id || ""; if (!target) { notify.block("Choose a licensed agent before offering the handoff"); return; } void action("handoff", "/api/app/inbound/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "offer", work_item_id: data.queue.id, target_user_id: target }) }, "Handoff offered"); }
  function acceptHandoff() { if (!data?.pendingHandoff) return; void action("accept", "/api/app/inbound/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "accept", handoff_id: data.pendingHandoff.id }) }, "Handoff accepted"); }
  function nudge() { if (!data?.queue) return; void action("nudge", "/api/app/agent-floor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "nudge", work_item_id: data.queue.id, idempotency_key: crypto.randomUUID() }) }, "Team nudged"); }
  function reopen() { if (!data) return; void action("reopen", `/api/app/leads/${encodeURIComponent(data.lead.id)}/reopen`, { method: "POST" }, "Lead reopened in the queue"); }
  // LA-1.14-9 / LA-1.10-8: give the transfer back, put a dropped call back, or end buffer involvement.
  async function release(kind: "unassign" | "requeue" | "end_buffer", acknowledgeLanguage = false) {
    if (!data?.queue) return;
    // Every one of the three asks first; the language cover prompt below is a second, separate question.
    const values = data.lead.values;
    const customer = [values.full_name, values.name, [values.first_name, values.last_name].filter(Boolean).join(" ")].find((part): part is string => typeof part === "string" && part.trim() !== "");
    if (!acknowledgeLanguage && !(await confirmAction(releaseDialog(kind, { customer, bufferName: data.transfer?.buffer?.name, agentName: data.owner?.name })))) return;
    setSaving(kind);
    const response = await fetch("/api/app/inbound/release", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: kind, work_item_id: data.queue.id, ...(acknowledgeLanguage ? { acknowledge_language: true } : {}) }) });
    const body = await response.json().catch(() => null);
    setSaving(null);
    if (response.status === 409 && body?.code === "language_cover_required" && !acknowledgeLanguage) {
      if (await confirmAction({ title: "Continue without a language match?", description: body.error, confirmLabel: "Continue", cancelLabel: "Go back", destructive: false })) void release(kind, true);
      return;
    }
    if (!response.ok) { notify.block(body?.error ?? "The action could not be completed"); return; }
    notify.done(kind === "unassign" ? "Transfer back in the queue" : kind === "requeue" ? "Back in the queue; the next claim resumes the verification" : "Buffer involvement ended; the licensed agent keeps the call");
    await load();
  }
  function recheckPreflight() { if (!data) return; void action("preflight", `/api/app/leads/${encodeURIComponent(data.lead.id)}/preflight`, { method: "POST" }, "Existing-customer check refreshed"); }

  if (error)
    return (
      <TableCard>
        <ErrorState detail={error} action={<Button type="button" variant="outline" onClick={() => void load()}>Try again</Button>} />
      </TableCard>
    );

  if (!data) return <PageLoading strip={false} rows={6} />;

  const readOnly = data.readOnly;
  // Attempts and Callbacks are tabs rather than a cramped rail card and a line buried in the
  // timeline. Both read data this workspace already loads — the attempt history RPC and the
  // callback events — so neither adds a request; they were simply not given anywhere to be read.
  // Leads A3 (2026-10-25): every section is a tab in one row; nothing hides behind "More".
  const tabs = [
    { key: "application", label: "Lead detail" },
    { key: "attempts", label: "Attempts" },
    { key: "notes", label: "Conversation" },
    { key: "callbacks", label: "Callbacks" },
    { key: "nurture", label: "Nurture" },
    { key: "verification", label: "Verification" },
    { key: "timeline", label: "Timeline" },
  ] as const;

  const leadName = display(data.lead.values.full_name ?? data.lead.values.name ?? ([data.lead.values.first_name, data.lead.values.last_name].filter(Boolean).join(" ") || "Unnamed lead"));
  const screeningTone = data.screening.outcome === "blocked" ? "danger" : data.screening.warning ? "warning" : "good";
  const screeningLabel = data.screening.outcome === "blocked" ? "blocked" : data.screening.warning ? "needs review" : data.screening.outcome ?? "pending";
  const stageTone = data.stage?.stage_type === "won" ? "good" : data.stage?.stage_type === "lost" ? "danger" : "action";
  const lineage = data.lineage;
  const sourceName = data.partner?.name ?? lineage?.vendorName ?? null;
  const canDisposition = Boolean(data.queue && data.actions.canDisposition);
  const canVerify = Boolean(data.queue && data.queue.owner_user_id === data.currentUserId);
  const expired = data.queue?.status === "expired";
  const anyAction = data.actions.canClaim || data.actions.canAcceptHandoff || Boolean(data.queue) || canDisposition || canVerify || Boolean(data.stage && data.actions.canChangeStage);
  const outline = "w-full";

  return (
    <div className="m-stagger flex flex-col gap-6">
      {/* The way back is the trail above the lead's name (owner 2026-10-30). */}
      <PageHeader title={leadName} breadcrumbs={[{ label: "Leads" }, { label: "Lead workspace", href: "/app/leads" }, { label: leadName }]} />
      <section className="m-glass rounded-xl border border-border flex flex-wrap items-center gap-5 p-5">
        <Ring value={(data.verification?.session.progress_percentage ?? 0) / 100} tone={(data.verification?.session.progress_percentage ?? 0) >= 100 ? "success" : "brand"} size={84} thickness={7} label={data.verification ? `Verification ${data.verification.session.progress_percentage}%` : "Verification not started"}>
          <span className="block text-center">
            <span className="block text-lg leading-tight font-semibold">{data.verification ? `${data.verification.session.progress_percentage}%` : "—"}</span>
            <span className="block text-xs font-medium text-muted-foreground">verified</span>
          </span>
        </Ring>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {identityLine(data) && <p className="m-0 text-sm text-muted-foreground">{identityLine(data)}</p>}
          <div className="flex flex-wrap gap-2">
            <StatusChip tone={screeningTone} dot>Screening: {screeningLabel}</StatusChip>
            {data.stage && <StatusChip tone={stageTone} dot>{data.stage.name}</StatusChip>}
            <StatusChip tone="neutral">{sourceName ?? "Direct lead"}</StatusChip>
            <StatusChip tone="neutral">{data.template.product_name}</StatusChip>
            {data.activeCall && <LiveCallStatus startedAt={data.activeCall.startedAt} agentName={data.activeCall.agentName} />}
          </div>
        </div>
      </section>

      {/* The seven facts as glass tiles (Leads A3). */}
      <section aria-label="Lead facts" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {([
          ["Lead", <span key="id" title={data.lead.id}>{shortId(data.lead.id)}</span>],
          ["Submitted", stamp(data.lead.created_at)],
          ["Owner", data.owner?.name ?? "Unclaimed"],
          ["Verification", data.verification ? `${data.verification.session.progress_percentage}%` : "Not started"],
          ["Quoted", data.quotedMonthlyCents != null ? `$${(data.quotedMonthlyCents / 100).toFixed(2)}/mo` : "No quote yet"],
          ["Attempts", data.attemptHistory.length],
          ["Next action", nextActionLabel(data.nextAction ?? null)],
        ] as const).map(([label, value]) => (
          <div key={label} className="m-glass rounded-xl border border-border min-w-0 px-3.5 py-3"><Fact label={label}>{value}</Fact></div>
        ))}
      </section>

      <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
        <section className="m-glass rounded-xl border border-border flex min-w-0 flex-grow flex-col">
          <UnderlineTabs label="Lead detail sections" tabs={tabs} value={tab} onChange={setTab} className="px-5" />

          {tab === "application" ? (
            <LeadDetailTab data={data} onAllNotes={() => setTab("notes")} />
          ) : tab === "attempts" ? (
            <LeadAttemptsTab leadId={data.lead.id} />
          ) : tab === "callbacks" ? (
            <LeadCallbacksTab leadId={data.lead.id} />
          ) : tab === "nurture" ? (
            <LeadNurtureTab leadId={data.lead.id} />
          ) : tab === "notes" ? (
            <NotesTab data={data} refresh={load} />
          ) : (
            <div className="p-5">
              {tab === "verification" && <VerificationTab data={data} />}
              {tab === "timeline" && (
                <PagedProvider>
                  <PagedBody as="ol" className="space-y-4 border-l border-border pl-5">
                    {data.timeline.map((event) => (
                      <li key={event.id} className="relative">
                        <span className="absolute -left-[1.43rem] top-1 size-2 rounded-full bg-[var(--primary)]" />
                        <p className="font-medium">{event.label}</p>
                        <p className="text-xs text-muted-foreground">{event.actor} · {when(event.at)}</p>
                        {event.detail && <p className="mt-1 break-words text-sm text-muted-foreground">{event.detail}</p>}
                      </li>
                    ))}
                  </PagedBody>
                  {data.timeline.length > 10 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground"><PagedPager total={data.timeline.length} noun="events" /></div>}
                  {data.timeline.length === 0 && <p className="text-sm text-muted-foreground">No events recorded yet.</p>}
                </PagedProvider>
              )}
            </div>
          )}
        </section>

        <div className="flex w-full shrink-0 flex-col gap-4 xl:w-[360px]">
          <section className="m-glass rounded-xl border border-border p-5">
            <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em]">Actions</h2>
            <div className="mt-3.5 flex flex-col gap-2">
              {data.actions.canClaim && (
                <Button type="button" className="w-full" disabled={readOnly || saving === "claim"} onClick={() => void claim()}>
                  {saving === "claim" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}{readOnly ? "Read-only" : "Claim"}
                </Button>
              )}
              {data.actions.canAcceptHandoff && <Button type="button" className="w-full" disabled={readOnly || saving === "accept"} onClick={acceptHandoff}>Accept handoff</Button>}
              {/* Opens the call-outcome dialog in place; /app/inbound/[id]/disposition stays for deep links. */}
              {canDisposition && data.queue && <Button type="button" className="w-full" onClick={() => setOutcomeOpen(true)}>Record call outcome</Button>}
              {canDisposition && data.queue && <DispositionWizardDialog workItemId={data.queue.id} open={outcomeOpen} onOpenChange={setOutcomeOpen} readOnly={readOnly} />}
              {data.queue && data.actions.canHandoff && (
                <div className="flex flex-col gap-2">
                  <select aria-label="Licensed agent for handoff" disabled={readOnly || saving === "handoff"} value={handoffTarget || data.licensedAgents[0]?.id || ""} onChange={(event) => setHandoffTarget(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                    <option value="">Choose agent…</option>
                    {data.licensedAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} ({agent.role})</option>)}
                  </select>
                  <Button variant="outline" className={outline} disabled={readOnly || saving === "handoff"} onClick={handoff}><Hand className="size-4" />Hand off to a licensed agent</Button>
                </div>
              )}
              {data.queue && data.actions.canRequeue && <Button type="button" className="w-full" disabled={readOnly || saving === "requeue"} onClick={() => void release("requeue")}>{saving === "requeue" && <Loader2 className="size-4 animate-spin" />}Put back in the queue</Button>}
              {data.queue && data.actions.canEndBufferInvolvement && <Button variant="outline" className={outline} disabled={readOnly || saving === "end_buffer"} onClick={() => void release("end_buffer")}>{saving === "end_buffer" && <Loader2 className="size-4 animate-spin" />}End buffer involvement</Button>}
              {data.queue && data.actions.canUnassign && <Button variant="outline" className={outline} disabled={readOnly || saving === "unassign"} onClick={() => void release("unassign")}>{saving === "unassign" && <Loader2 className="size-4 animate-spin" />}Unassign</Button>}
              {data.queue && <Button variant="outline" className={outline} disabled={readOnly || saving === "nudge"} onClick={nudge}>Nudge team</Button>}
              {expired && <Button variant="outline" className={outline} disabled={readOnly || saving === "reopen"} onClick={reopen}>{saving === "reopen" && <Loader2 className="size-4 animate-spin" />}Reopen in queue</Button>}
              {canVerify && data.queue && <Button asChild variant="outline" className={outline}><Link href={`/app/inbound/call/${data.queue.id}?phase=verify`}>Verification</Link></Button>}
              <LeadApplicationEntry leadId={data.lead.id} workItemId={data.queue?.id ?? null} canStart={!readOnly && (data.role === "owner" || data.role === "producer")} className={outline} />
              {data.stage && data.actions.canChangeStage && (
                <div className="mt-1">
                  <Label htmlFor="lead-stage" className="text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">Stage</Label>
                  <select id="lead-stage" disabled={readOnly || saving === "stage"} value={data.stage.id} onChange={moveStage} className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                    {data.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
                  </select>
                </div>
              )}
              {!anyAction && <p className="text-sm text-muted-foreground">Nothing can be done on this lead from here right now.</p>}
            </div>
            {expired && <p className="mt-3 text-xs text-muted-foreground">Expired unclaimed.</p>}
            {data.queue && <p className="mt-3 text-xs text-muted-foreground">Work item: {data.transfer?.phaseLabel ?? data.queue.status.replace(/_/g, " ")}{data.disposition ? ` · ${data.disposition.label}` : ""}{data.transfer?.requeueCount ? ` · back in the queue ${data.transfer.requeueCount === 1 ? "once" : `${data.transfer.requeueCount} times`}` : ""}</p>}
            {data.transfer?.buffer?.onCall && <p className="mt-1 text-xs text-muted-foreground">Buffer {data.transfer.buffer.name} is still on the call.</p>}
          </section>

          <SamePersonPrompt check={data.preflight} duplicateFlagged={data.lead.values?.duplicate_warning === true} busy={saving === "preflight"} onRecheck={data.readOnly ? undefined : recheckPreflight} />

          <section className="m-glass rounded-xl border border-border p-5">
            <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em]">Source &amp; cost lineage</h2>
            <div className="mt-3.5 grid grid-cols-2 gap-x-6 gap-y-4">
              <Fact label="Vendor">{lineage?.vendorName ?? (data.partner ? "—" : "Direct")}</Fact>
              <Fact label="Campaign">{lineage?.campaignName && lineage.campaignId ? <Link href={`/app/lead-lists/${lineage.campaignId}`} className="hover:underline">{lineage.campaignName}</Link> : "—"}</Fact>
              <Fact label="Source">{lineage?.sourceType ? SOURCE_LABEL[lineage.sourceType] ?? lineage.sourceType : data.partner ? "Partner submission" : "Entered by hand"}</Fact>
              <Fact label="Cost">{lineage?.money ? (lineage.costCents != null ? `$${(lineage.costCents / 100).toFixed(2)}` : "—") : "Hidden for your role"}</Fact>
              <Fact label="Cost dated">{lineage?.costAt ? dayOnly(lineage.costAt) : "—"}</Fact>
            </div>
            {/* LA-2.20-7: one person sold by two vendors is one lead with two sources. The facts above
                are the first; this is every one of them, each with its own campaign and cost. */}
            {(lineage?.sources?.length ?? 0) > 1 && lineage && <div className="mt-4 border-t border-border pt-3.5">
              <h3 className="text-sm font-semibold leading-[1.5] tracking-[-0.02em]">Every source ({lineage.sources.length})</h3>
              <PagedProvider>
              <PagedBody as="ul" className="mt-2 flex list-none flex-col gap-2 p-0">
                {lineage.sources.map((source, index) => <li key={`${source.campaignId ?? "none"}-${source.at ?? index}`} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm leading-[1.5]">
                  <span className="min-w-0">
                    {source.campaignId && source.campaignName ? <Link href={`/app/lead-lists/${source.campaignId}`} className="font-medium hover:underline">{source.campaignName}</Link> : <span className="font-medium">{source.campaignName ?? "No campaign"}</span>}
                    <span className="text-xs text-muted-foreground"> · {source.vendorName ?? "No vendor"} · {source.sourceType ? SOURCE_LABEL[source.sourceType] ?? source.sourceType : "—"}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {lineage.money ? (source.costCents != null ? `$${(source.costCents / 100).toFixed(2)}` : "No cost") : "Cost hidden"} · {source.at ? dayOnly(source.at) : "—"}
                  </span>
                </li>)}
              </PagedBody>
              {lineage.sources.length > 10 && <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-2 text-xs text-muted-foreground"><PagedPager total={lineage.sources.length} noun="sources" /></div>}
              </PagedProvider>
              {lineage.money && lineage.totalCostCents != null && <p className="mt-2 text-xs text-muted-foreground tabular-nums">All sources together: ${(lineage.totalCostCents / 100).toFixed(2)}</p>}
            </div>}
          </section>
        </div>
      </div>
    </div>
  );
}

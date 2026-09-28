"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronDown, ChevronLeft, Hand, Loader2 } from "lucide-react";
import { notify } from "@/lib/notify";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { TableCard } from "@/components/ui/table-card";
import { MONTHS } from "@/lib/format/dates";
import { ErrorState } from "@/components/ui/page-states";
import type { LeadLineage, LeadNextAction } from "@/lib/leadWorkspace/lineage";
import { LeadAttemptsTab, LeadCallbacksTab, LeadNurtureTab } from "@/components/app/lead-record-tabs";
import { DispositionWizardDialog } from "@/components/app/disposition-wizard-dialog";
import { LeadSignatureReadiness } from "@/components/app/lead-signature-readiness";

type Template = { product_name: string; definition_version?: number; fields: Array<{ field_key: string; label: string; type: string; is_required: boolean; options: string[]; help_text?: string | null }>; form_definition: { sections: Array<{ section_key: string; label: string; fields: Array<{ field_key: string; is_required: boolean; show_when: { field_key: string; equals: string } | null; conditional_on?: { field_key: string; equals: string } | null }> }> } };
type Event = { id: string; label: string; at: string; actor: string; detail: string | null; immutable: boolean };
type Note = { id: string; leadId: string; body: string | null; visibility: "internal" | "shared"; author: { id: string; name: string }; createdAt: string; editedAt: string | null; deletedAt: string | null; mentions: string[]; history: Array<{ id: string; action: string; old_body: string; old_visibility: string; new_body: string | null; new_visibility: string | null; created_at: string; actor: { id: string; name: string } }> };
type Workspace = { lead: { id: string; values: Record<string, unknown>; product_line: string; definition_version: number; created_at: string; updated_at: string }; template: Template; queue: { id: string; status: string; owner_user_id: string | null; claimed_at: string | null; disposition: string | null } | null; partner: { name: string; partner_type: string } | null; stage: { id: string; name: string; stage_type: string; color: string } | null; stages: Array<{ id: string; name: string; stage_type: string; color: string }>; submitter: { name: string } | null; owner: { name: string } | null; screening: { outcome: string | null; warning: string | null; checkedAt: string | null }; attemptHistory: Array<{ id: string; attempt_number: number; slot: string; attempted_at: string; disposition: string | null; dial_clicked_at: string | null }>; preflight: { status: string; checkedAt: string | null; policyMatchingIncluded?: false; policyMatchingNote?: string; matches?: Array<{ leadId: string | null; contactId: string | null; submittedAt: string; partnerName: string | null; productLine: string | null; outcome: string | null; matchedOn: string[]; sourceType: "lead" | "contact" }>; soldByPartners?: Array<{ partnerId: string; partnerName: string }>; soldByMultiplePartners?: boolean }; disposition: { label: string } | null; verification: { session: { status: string; progress_percentage: number; started_at: string; completed_at: string | null }; fields: Array<{ field_key: string; state: string; old_value: unknown; new_value: unknown; confirmed_at: string | null }> } | null; corrections: Array<{ id: string; field_key: string; old_value: unknown; new_value: unknown; actor_id: string | null; created_at: string }>; notes: Note[]; teammates: Array<{ id: string; name: string; role?: string }>; timeline: Event[]; role: string; currentUserId: string; licensedAgents: Array<{ id: string; name: string; role: string }>; pendingHandoff: { id: string; workItemId: string } | null; actions: { canClaim: boolean; canHandoff: boolean; canAcceptHandoff: boolean; canDisposition: boolean; canChangeStage: boolean; canUnassign?: boolean; canRequeue?: boolean; canEndBufferInvolvement?: boolean }; transfer?: { phase: string; phaseLabel: string; buffer: { id: string; name: string; onCall: boolean } | null; requeueCount: number } | null; lineage?: LeadLineage | null; nextAction?: LeadNextAction; readOnly: boolean; activeCall?: { startedAt: string; agentName: string | null } | null; quotedMonthlyCents?: number | null };

function ExistingCustomerPreflight({ data, onRecheck, busy }: { data: Workspace; onRecheck: () => void; busy: boolean }) {
  const matches = data.preflight.matches ?? [];
  const label = data.preflight.status === "already_customer" ? "Already a customer" : data.preflight.status === "spoken_before" ? "Spoken before" : data.preflight.status === "not_checked" ? "Pre-flight unavailable" : "New household";
  return <Card className={data.preflight.status === "already_customer" ? "border-[var(--error)]/50 bg-[var(--error)]/5" : data.preflight.status === "spoken_before" ? "border-[var(--warning)]/50 bg-[var(--warning)]/5" : ""}><CardContent className="space-y-3 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Existing-customer pre-flight</p><p className="mt-1 font-semibold">{label}</p>{data.preflight.soldByMultiplePartners && <p className="mt-1 text-sm font-semibold text-[var(--error-ink)]">Sold by {data.preflight.soldByPartners?.length ?? 2} partners: {(data.preflight.soldByPartners ?? []).map((partner) => partner.partnerName).join(", ")}</p>}</div><div className="flex items-center gap-2">{data.preflight.soldByMultiplePartners && <Badge variant="destructive">Sold by two partners</Badge>}<Badge variant={data.preflight.status === "already_customer" ? "destructive" : data.preflight.status === "spoken_before" ? "outline" : "secondary"}>{matches.length} prior match{matches.length === 1 ? "" : "es"}</Badge><Button type="button" variant="outline" disabled={busy} onClick={onRecheck}>{busy ? "Checking…" : "Re-check"}</Button></div></div>{matches.length > 0 && <div className="space-y-2">{matches.slice(0, 5).map((match, index) => <div key={`${match.leadId ?? match.contactId ?? "match"}-${index}`} className="rounded-md border bg-background/60 p-3 text-sm"><p className="font-medium">{match.sourceType === "contact" ? "Contact on file" : `Prior lead${match.partnerName ? ` from ${match.partnerName}` : ""}`}</p><p className="mt-1 text-xs text-muted-foreground">{match.productLine ? `${match.productLine} · ` : ""}{match.outcome ?? "No outcome recorded"} · {when(match.submittedAt)}</p><p className="mt-1 text-xs text-muted-foreground">Matched on {match.matchedOn.join(", ") || "household details"}.</p></div>)}</div>}{data.preflight.policyMatchingNote && <p className="text-xs text-muted-foreground">{data.preflight.policyMatchingNote}</p>}</CardContent></Card>;
}

function display(value: unknown) { return Array.isArray(value) ? value.join(", ") : value === null || value === undefined || value === "" ? "Not provided" : String(value); }
function when(value: string) { return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
function visible(field: { show_when: { field_key: string; equals: string } | null; conditional_on?: { field_key: string; equals: string } | null }, values: Record<string, unknown>) { const condition = field.show_when ?? field.conditional_on; if (!condition) return true; const current = values[condition.field_key]; return Array.isArray(current) ? current.includes(condition.equals) : String(current ?? "") === condition.equals; }
function stateVariant(state: string) { return state === "outstanding" ? "destructive" : state === "corrected" ? "outline" : "secondary"; }

function VerificationTab({ data }: { data: Workspace }) {
  if (!data.verification) return <p className="text-sm text-muted-foreground">Verification has not started for this lead.</p>;
  return <div className="space-y-5"><div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Verification progress</p><p className="mt-1 text-2xl font-semibold">{data.verification.session.progress_percentage}%</p></div><div className="flex items-center gap-2"><Badge variant={data.verification.session.progress_percentage === 100 ? "secondary" : "outline"}>{data.verification.session.status}</Badge>{data.queue && data.queue.owner_user_id === data.currentUserId && <Button asChild><Link href={`/app/inbound/${data.queue.id}/verification`}>Open live verification</Link></Button>}</div></div><div className="h-3 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${data.verification.session.progress_percentage}%` }} /></div><p className="text-xs text-muted-foreground">Started {when(data.verification.session.started_at)}{data.verification.session.completed_at ? ` · completed ${when(data.verification.session.completed_at)}` : ""}</p></div><div><h3 className="text-sm font-semibold">Field confirmation</h3><div className="mt-2 divide-y rounded-md border">{data.verification.fields.map((field) => <div key={field.field_key} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm"><span>{field.field_key}</span><div className="flex items-center gap-2"><Badge variant={stateVariant(field.state)}>{field.state}</Badge>{field.state === "corrected" && <span className="text-xs text-muted-foreground">{display(field.old_value)} → {display(field.new_value)}</span>}</div></div>)}</div></div></div>;
}

// "18 Sep 4:19 pm", as the board stamps a note.
function noteTime(value: string) { const d = new Date(value); if (Number.isNaN(d.getTime())) return "—"; const h = d.getHours(); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; }
const FIELD = "rounded-lg border border-[var(--border-strong)] bg-card text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
function NotesTab({ data, refresh }: { data: Workspace; refresh: () => Promise<void> }) {
  const [body, setBody] = useState("");
  const [noteVisibility, setNoteVisibility] = useState<"internal" | "shared">("internal");
  const [mentions, setMentions] = useState<string[]>([]);
  const [editing, setEditing] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Note[] | null>(null);
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
    notify.done(editing ? "Note updated" : "Note saved"); reset(); await refresh();
  }
  async function remove(note: Note) {
    if (!window.confirm("Delete this note? It will remain as a tombstone in the timeline.")) return;
    setBusy(true); const response = await fetch(`/api/app/leads/${encodeURIComponent(data.lead.id)}/notes`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note_id: note.id }) }); const result = await response.json().catch(() => null); setBusy(false);
    if (!response.ok) { notify.block(result?.error ?? "Could not delete note"); return; } notify.done("Note deleted"); await refresh();
  }
  async function changeVisibility(note: Note) {
    setBusy(true); const response = await fetch(`/api/app/leads/${encodeURIComponent(data.lead.id)}/notes`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note_id: note.id, visibility: note.visibility === "shared" ? "internal" : "shared" }) }); const result = await response.json().catch(() => null); setBusy(false);
    if (!response.ok) { notify.block(result?.error ?? "Could not change visibility"); return; } notify.done("Note visibility changed"); await refresh();
  }
  async function runSearch() {
    if (search.trim().length < 2) { setSearchResults(null); return; }
    const response = await fetch(`/api/app/notes/search?q=${encodeURIComponent(search)}`, { cache: "no-store" }); const result = await response.json().catch(() => null); if (!response.ok) { notify.block(result?.error ?? "Could not search notes"); return; } setSearchResults(result.notes ?? []);
  }
  function toggleMention(id: string) { setMentions((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  const shown = searchResults ?? data.notes;
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
          <label className="text-sm leading-normal tracking-[-0.02em] text-[var(--body)]" htmlFor="note-visibility">Visibility</label>
          <select id="note-visibility" aria-label="Note visibility" value={noteVisibility} onChange={(event) => setNoteVisibility(event.target.value as "internal" | "shared")} disabled={!canWrite || busy} className={`${FIELD} h-9 px-2.5 text-sm`}><option value="internal">Internal — team only</option><option value="shared">Shared — partner can see</option></select>
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
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
        <label className="text-sm leading-normal tracking-[-0.02em] text-[var(--body)]" htmlFor="note-search">Search notes across leads</label>
        <input id="note-search" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void runSearch(); }} placeholder="Search note text" className={`${FIELD} h-9 w-full max-w-xs px-3 text-sm`} />
        <Button type="button" variant="outline" onClick={() => void runSearch()}>Search</Button>
        {searchResults && <Button type="button" variant="ghost" onClick={() => { setSearchResults(null); setSearch(""); }}>Clear</Button>}
      </div>
      {shown.map((note) => {
        const related = [note.visibility === "shared" && !note.deletedAt ? `Posted to ${data.partner?.name ? `the ${data.partner.name}` : "the partner's"} channel` : null, note.mentions.length ? `${note.mentions.length} mention${note.mentions.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
        const mine = !note.deletedAt && note.author.id === data.currentUserId;
        const canShare = !note.deletedAt && data.role === "owner" && note.author.id !== data.currentUserId;
        const link = "font-semibold text-[var(--accent-ink)] hover:underline disabled:opacity-50";
        return (
          <div key={note.id} className={`border-t border-border px-5 py-4 ${note.deletedAt ? "bg-[var(--surface-alt)]" : ""}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">{note.deletedAt ? "Note deleted" : note.author.name}</span>
                {!note.deletedAt && <Chip tone={note.visibility === "shared" ? "accent" : "neutral"}>{note.visibility === "shared" ? "Shared" : "Internal"}</Chip>}
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
      {shown.length === 0 && <p className="border-t border-border px-5 py-6 text-sm leading-normal tracking-[-0.02em] text-muted-foreground">{searchResults ? "No note matches that search." : "No notes yet."}</p>}
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

function Chip({ tone, dot, children }: { tone: "warning" | "danger" | "good" | "accent" | "neutral"; dot?: boolean; children: React.ReactNode }) {
  const look = {
    warning: ["bg-[var(--warning-surface)] text-[var(--warning-ink)]", "bg-[var(--warning)]"],
    danger: ["bg-[var(--error-surface)] text-[var(--error-ink)]", "bg-[var(--error)]"],
    good: ["bg-[var(--success-surface)] text-[var(--success-ink)]", "bg-[var(--success)]"],
    accent: ["bg-[var(--soft-orange-surface)] text-[var(--accent-ink)]", "bg-[var(--primary)]"],
    neutral: ["bg-[var(--surface-alt)] text-[var(--body)]", "bg-[var(--muted-foreground)]"],
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold leading-normal tracking-[-0.01em] ${look[0]}`}>
      {dot && <span className={`size-1.5 shrink-0 rounded-full ${look[1]}`} aria-hidden="true" />}
      {children}
    </span>
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
              {display(data.lead.values[field.field_key])}
              {change && <span className="mt-1 block text-xs font-normal text-[var(--warning-ink)]">Was {display(change.old_value)} — corrected on verification</span>}
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
function LiveCallChip({ startedAt, agentName }: { startedAt: string; agentName: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  if (seconds > 4 * 3600) return <Chip tone="warning" dot>Call record open {Math.floor(seconds / 86400) ? `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h` : `${Math.floor(seconds / 3600)}h`}, never closed</Chip>;
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return <Chip tone="good" dot>On a call · {clock}{agentName ? ` · ${agentName}` : ""}</Chip>;
}

type TabKey = "application" | "attempts" | "verification" | "notes" | "callbacks" | "nurture" | "timeline";

export function LeadDetailWorkspace({ leadId }: { leadId: string }) {
  const [data, setData] = useState<Workspace | null>(null);
  const [tab, setTab] = useState<TabKey>("application");
  const [moreOpen, setMoreOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [handoffTarget, setHandoffTarget] = useState("");
  const [outcomeOpen, setOutcomeOpen] = useState(false);

  const load = useCallback(async () => { const response = await fetch(`/api/app/leads/${encodeURIComponent(leadId)}`, { cache: "no-store" }); const body = await response.json().catch(() => null); if (!response.ok) { setError(body?.error ?? "Could not load this lead"); return; } setData(body); setError(""); }, [leadId]);
  // This is the server-backed detail snapshot and intentionally hydrates the client workspace.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function action(name: string, path: string, init: RequestInit, success: string) { setSaving(name); const response = await fetch(path, init); const body = await response.json().catch(() => null); setSaving(null); if (!response.ok) { notify.block(body?.error ?? "The action could not be completed"); return; } notify.done(success); await load(); }
  function claim() { if (!data?.queue) return; void action("claim", "/api/app/inbound/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ work_item_id: data.queue.id }) }, "Transfer claimed"); }
  function moveStage(event: React.ChangeEvent<HTMLSelectElement>) { if (!data) return; void action("stage", `/api/app/leads/${data.lead.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: data.lead.values, stage_id: event.target.value }) }, "Stage changed"); }
  function handoff() { if (!data?.queue) return; const target = handoffTarget || data.licensedAgents[0]?.id || ""; if (!target) { notify.block("Choose a licensed agent before offering the handoff"); return; } void action("handoff", "/api/app/inbound/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "offer", work_item_id: data.queue.id, target_user_id: target }) }, "Handoff offered"); }
  function acceptHandoff() { if (!data?.pendingHandoff) return; void action("accept", "/api/app/inbound/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "accept", handoff_id: data.pendingHandoff.id }) }, "Handoff accepted"); }
  function nudge() { if (!data?.queue) return; void action("nudge", "/api/app/agent-floor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "nudge", work_item_id: data.queue.id, idempotency_key: crypto.randomUUID() }) }, "Team nudged"); }
  function reopen() { if (!data) return; void action("reopen", `/api/app/leads/${encodeURIComponent(data.lead.id)}/reopen`, { method: "POST" }, "Lead reopened in the queue"); }
  // LA-1.14-9 / LA-1.10-8: give the transfer back, put a dropped call back, or end buffer involvement.
  async function release(kind: "unassign" | "requeue" | "end_buffer", acknowledgeLanguage = false) {
    if (!data?.queue) return;
    if (kind === "unassign" && !window.confirm("Give this transfer back to the queue? Nobody will own it until someone claims it. The verification so far is kept for them.")) return;
    setSaving(kind);
    const response = await fetch("/api/app/inbound/release", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: kind, work_item_id: data.queue.id, ...(acknowledgeLanguage ? { acknowledge_language: true } : {}) }) });
    const body = await response.json().catch(() => null);
    setSaving(null);
    if (response.status === 409 && body?.code === "language_cover_required" && !acknowledgeLanguage) {
      if (window.confirm(body.error)) void release(kind, true);
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
  // The board's strip ends in "More"; Verification and the Timeline live behind it.
  const tabs = [
    { key: "application", label: "Lead detail" },
    { key: "attempts", label: "Attempts" },
    { key: "notes", label: "Notes" },
    { key: "callbacks", label: "Callbacks" },
    { key: "nurture", label: "Nurture" },
  ] as const;
  const more = [
    { key: "verification", label: "Verification" },
    { key: "timeline", label: "Timeline" },
  ] as const;
  const inMore = more.find((item) => item.key === tab);

  const leadName = display(data.lead.values.full_name ?? data.lead.values.name ?? ([data.lead.values.first_name, data.lead.values.last_name].filter(Boolean).join(" ") || "Unnamed lead"));
  const screeningTone = data.screening.outcome === "blocked" ? "danger" : data.screening.warning ? "warning" : "good";
  const screeningLabel = data.screening.outcome === "blocked" ? "blocked" : data.screening.warning ? "needs review" : data.screening.outcome ?? "pending";
  const stageTone = data.stage?.stage_type === "won" ? "good" : data.stage?.stage_type === "lost" ? "danger" : "accent";
  const lineage = data.lineage;
  const sourceName = data.partner?.name ?? lineage?.vendorName ?? null;
  const canDisposition = Boolean(data.queue && data.actions.canDisposition);
  const canVerify = Boolean(data.queue && data.queue.owner_user_id === data.currentUserId);
  const expired = data.queue?.status === "expired";
  const anyAction = data.actions.canClaim || data.actions.canAcceptHandoff || Boolean(data.queue) || canDisposition || canVerify || Boolean(data.stage && data.actions.canChangeStage);
  const tabClass = (active: boolean) => `-mb-px inline-flex h-10 items-center gap-1 border-b-2 px-1 text-sm font-semibold leading-[1.43] tracking-[-0.01em] outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "border-[var(--primary)] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`;
  const outline = "w-full";

  return (
    <div className="m-stagger flex flex-col gap-6">
      {/* The way back, then the record's own title: the lead's name is the first 32px thing on the page. */}
      <Link href="/app/leads" className="-mb-3 inline-flex w-fit items-center gap-1.5 text-sm font-semibold tracking-[-0.01em] text-muted-foreground transition-colors hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden="true" />
        Leads
      </Link>
      <PageHeader title={leadName} description={identityLine(data) || undefined} />

      <div className="flex flex-wrap gap-2">
        <Chip tone={screeningTone} dot>Screening: {screeningLabel}</Chip>
        {data.stage && <Chip tone={stageTone} dot>{data.stage.name}</Chip>}
        <Chip tone="neutral">{sourceName ?? "Direct lead"}</Chip>
        <Chip tone="neutral">{data.template.product_name}</Chip>
        {data.activeCall && <LiveCallChip startedAt={data.activeCall.startedAt} agentName={data.activeCall.agentName} />}
      </div>

      <section className="rounded-lg border border-border bg-card p-5 shadow-[0_1px_2px_rgba(16,20,26,.05)]">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4 xl:grid-cols-7">
          <Fact label="Lead"><span title={data.lead.id}>{shortId(data.lead.id)}</span></Fact>
          <Fact label="Submitted">{stamp(data.lead.created_at)}</Fact>
          <Fact label="Owner">{data.owner?.name ?? "Unclaimed"}</Fact>
          <Fact label="Verification">{data.verification ? `${data.verification.session.progress_percentage}%` : "Not started"}</Fact>
          <Fact label="Quoted">{data.quotedMonthlyCents != null ? `$${(data.quotedMonthlyCents / 100).toFixed(2)}/mo` : "No quote yet"}</Fact>
          <Fact label="Attempts">{data.attemptHistory.length}</Fact>
          <Fact label="Next action">{nextActionLabel(data.nextAction ?? null)}</Fact>
        </div>
      </section>

      <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
        <section className="flex min-w-0 flex-grow flex-col rounded-lg border border-border bg-card shadow-[0_1px_2px_rgba(16,20,26,.05)]">
          <div className="flex flex-wrap gap-6 border-b border-border px-5" role="tablist" aria-label="Lead detail sections">
            {tabs.map((item) => (
              <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} onClick={() => { setTab(item.key); setMoreOpen(false); }} className={tabClass(tab === item.key)}>
                {item.label}
              </button>
            ))}
            <span className="relative">
              <button type="button" role="tab" aria-selected={Boolean(inMore)} aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)} className={tabClass(Boolean(inMore))}>
                {inMore ? inMore.label : "More"}<ChevronDown className="size-3.5" aria-hidden="true" />
              </button>
              {moreOpen && (
                <span role="menu" className="absolute left-0 top-11 z-20 flex min-w-40 flex-col rounded-lg border border-[var(--border-strong)] bg-card p-1 shadow-[0_12px_32px_rgba(0,0,0,.16)]">
                  {more.map((item) => (
                    <button key={item.key} type="button" role="menuitem" onClick={() => { setTab(item.key); setMoreOpen(false); }} className="rounded-md px-3 py-2 text-left text-sm font-semibold hover:bg-[var(--surface-alt)]">{item.label}</button>
                  ))}
                </span>
              )}
            </span>
          </div>

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
                <div>
                  <ol className="space-y-4 border-l border-border pl-5">
                    {data.timeline.map((event) => (
                      <li key={event.id} className="relative">
                        <span className="absolute -left-[1.43rem] top-1 size-2 rounded-full bg-[var(--primary)]" />
                        <p className="font-medium">{event.label}</p>
                        <p className="text-xs text-muted-foreground">{event.actor} · {when(event.at)}</p>
                        {event.detail && <p className="mt-1 break-words text-sm text-muted-foreground">{event.detail}</p>}
                      </li>
                    ))}
                  </ol>
                  {data.timeline.length === 0 && <p className="text-sm text-muted-foreground">No events recorded yet.</p>}
                </div>
              )}
            </div>
          )}
        </section>

        <div className="flex w-full shrink-0 flex-col gap-4 xl:w-[360px]">
          <section className="rounded-lg border border-border bg-card p-5 shadow-[0_1px_2px_rgba(16,20,26,.05)]">
            <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em]">Actions</h2>
            <div className="mt-3.5 flex flex-col gap-2">
              {data.actions.canClaim && (
                <Button type="button" className="w-full" disabled={readOnly || saving === "claim"} onClick={claim}>
                  {saving === "claim" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}{readOnly ? "Read-only" : "Claim"}
                </Button>
              )}
              {data.actions.canAcceptHandoff && <Button type="button" className="w-full" disabled={readOnly || saving === "accept"} onClick={acceptHandoff}>Accept handoff</Button>}
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
              {/* Opens the call-outcome dialog in place; /app/inbound/[id]/disposition stays for deep links. */}
              {canDisposition && data.queue && <Button variant="outline" className={outline} onClick={() => setOutcomeOpen(true)}>Disposition</Button>}
              {canDisposition && data.queue && <DispositionWizardDialog workItemId={data.queue.id} open={outcomeOpen} onOpenChange={setOutcomeOpen} readOnly={readOnly} />}
              {canVerify && data.queue && <Button asChild variant="outline" className={outline}><Link href={`/app/inbound/${data.queue.id}/verification`}>Verification</Link></Button>}
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
            {data.queue && <p className="mt-3 text-xs text-muted-foreground">Work item: {data.transfer?.phaseLabel ?? data.queue.status.replace(/_/g, " ")}{data.disposition ? ` · ${data.disposition.label}` : ""}</p>}
            {data.transfer?.buffer?.onCall && <p className="mt-1 text-xs text-muted-foreground">Buffer {data.transfer.buffer.name} is still on the call.</p>}
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-[0_1px_2px_rgba(16,20,26,.05)]">
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
              <ul className="mt-2 flex list-none flex-col gap-2 p-0">
                {lineage.sources.map((source, index) => <li key={`${source.campaignId ?? "none"}-${source.at ?? index}`} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm leading-[1.5]">
                  <span className="min-w-0">
                    {source.campaignId && source.campaignName ? <Link href={`/app/lead-lists/${source.campaignId}`} className="font-medium hover:underline">{source.campaignName}</Link> : <span className="font-medium">{source.campaignName ?? "No campaign"}</span>}
                    <span className="text-xs text-muted-foreground"> · {source.vendorName ?? "No vendor"} · {source.sourceType ? SOURCE_LABEL[source.sourceType] ?? source.sourceType : "—"}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {lineage.money ? (source.costCents != null ? `$${(source.costCents / 100).toFixed(2)}` : "No cost") : "Cost hidden"} · {source.at ? dayOnly(source.at) : "—"}
                  </span>
                </li>)}
              </ul>
              {lineage.money && lineage.totalCostCents != null && <p className="mt-2 text-xs text-muted-foreground tabular-nums">All sources together: ${(lineage.totalCostCents / 100).toFixed(2)}</p>}
            </div>}
          </section>

          <ExistingCustomerPreflight data={data} busy={saving === "preflight"} onRecheck={recheckPreflight} />
        </div>
      </div>
    </div>
  );
}

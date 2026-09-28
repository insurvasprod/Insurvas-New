"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { notify } from "@/lib/notify";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { Callout, DashedCard, Field, Pill, SettingsCard, btn, control, st } from "@/components/app/settings/primitives";
import { cn } from "@/lib/utils";
import { dobConflict, matchedOnLabel } from "@/lib/contacts/matchPolicy";
import type { ContactDirectory, ContactRow, ContactWorkspace as Workspace, DuplicateMatch, FieldSchemaRow, RecentMerge, ReviewPair, ReviewQueue } from "@/lib/contacts/types";

/**
 * /app/duplicates, to board p-app-duplicates.
 *
 * The page is built around one question at a time: the head of a persisted review queue, drawn as
 * two cards of the same fields, differing rows highlighted with a radio each, and the two Keep
 * buttons under their own card. The directory is paged and searched on the server; the tiles come
 * from one stats read (the strip under the header). Every merge can be undone from Recent merges, and the page only offers the
 * undo the server will accept (see undo_contact_merge's later-merge guard).
 */

type WorkspacePayload = Workspace & { queue: ReviewQueue };
type Side = "existing" | "incoming";

const emptyForm = { first_name: "", last_name: "", dob: "", primary_phone: "", email: "", state: "", address_line1: "", city: "", postal_code: "", custom_fields: {} as Record<string, unknown> };
const PAGE_SIZE = 25;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ── formatting ─────────────────────────────────────────────────────────── */

function formatPhone(value: string | null | undefined) {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}–${digits.slice(6)}` : value;
}
function formatDob(value: string | null | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return match ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}` : "—";
}
function ago(iso: string, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
function age(iso: string, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
/** "Rinor Gllareva" → "R. Gllareva", as the board writes a person in a merge row. */
function shortName(name: string | null) {
  if (!name) return null;
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : parts[0];
}
function householdOf(contact: ContactRow & { household_state?: string | null }) {
  if (!contact.household_id) return "—";
  const place = [contact.city, contact.household_state || contact.state].filter(Boolean).join(" ");
  return [contact.last_name, place].filter(Boolean).join(", ") || "—";
}
function customFieldsText(fields: Record<string, unknown>, schema: FieldSchemaRow[]) {
  const labels = new Map(schema.filter((item) => item.entity === "contact").map((item) => [item.field_key, item.label]));
  const entries = Object.entries(fields);
  return entries.length ? entries.map(([key, value]) => `${labels.get(key) ?? key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`).join(" · ") : "—";
}

async function readJson(response: Response) {
  return response.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}
function errorOf(body: Record<string, unknown> | null, fallback: string) {
  return typeof body?.error === "string" ? body.error : fallback;
}

/* ── the pair ───────────────────────────────────────────────────────────── */

type PairRow = {
  key: string;
  label: string;
  value: (contact: ContactRow) => string;
  /** merge_contacts field_choices this row decides. Null: no choice (both kept, or derived). */
  fields: string[] | null;
  /** Shown only when the two contacts differ on it. */
  onlyWhenDifferent?: boolean;
  /** What the row says instead of a radio when it differs but is not a choice. */
  note?: string;
  same: (a: ContactRow, b: ContactRow) => boolean;
};

function pairRows(schema: FieldSchemaRow[]): PairRow[] {
  const text = (value: string | null | undefined) => (value ?? "").trim();
  return [
    { key: "name", label: "Name", value: (c) => `${c.first_name} ${c.last_name}`.trim(), fields: ["first_name", "last_name"], same: (a, b) => text(a.first_name) === text(b.first_name) && text(a.last_name) === text(b.last_name) },
    { key: "primary_phone", label: "Phone", value: (c) => formatPhone(c.primary_phone), fields: ["primary_phone"], same: (a, b) => text(a.primary_phone) === text(b.primary_phone) },
    { key: "dob", label: "Date of birth", value: (c) => formatDob(c.dob), fields: ["dob"], same: (a, b) => text(a.dob) === text(b.dob) },
    { key: "household_id", label: "Address", value: (c) => c.address_line1 || "—", fields: ["household_id"], same: (a, b) => (a.household_id ?? "") === (b.household_id ?? "") },
    // merge_contacts copies every email onto the survivor, so there is nothing to choose.
    { key: "email", label: "Email", value: (c) => c.emails.map((item) => item.email).join(", ") || "—", fields: null, note: "Both kept", same: (a, b) => a.emails.map((item) => item.email).sort().join() === b.emails.map((item) => item.email).sort().join() },
    // The household follows the Address choice; saying so is how a cross-household merge is never silent.
    { key: "household", label: "Household", value: (c) => householdOf(c), fields: null, note: "Follows address", same: (a, b) => (a.household_id ?? "") === (b.household_id ?? "") },
    { key: "state", label: "State", value: (c) => c.state || "—", fields: ["state"], onlyWhenDifferent: true, same: (a, b) => text(a.state) === text(b.state) },
    { key: "custom_fields", label: "Custom fields", value: (c) => customFieldsText(c.custom_fields, schema), fields: ["custom_fields"], onlyWhenDifferent: true, same: (a, b) => JSON.stringify(a.custom_fields) === JSON.stringify(b.custom_fields) },
  ];
}

/** The side a differing field starts on: the one that has a value, else the incoming (newer) one. */
function defaultSelection(rows: PairRow[], pair: ReviewPair): Record<string, Side> {
  const selection: Record<string, Side> = {};
  for (const row of rows) {
    if (!row.fields || row.same(pair.existing, pair.incoming)) continue;
    const existingValue = row.value(pair.existing);
    const incomingValue = row.value(pair.incoming);
    selection[row.key] = incomingValue === "—" && existingValue !== "—" ? "existing" : "incoming";
  }
  return selection;
}

function Radio({ name, checked, onChange, label, disabled }: { name: string; checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <input
      type="radio"
      name={name}
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      aria-label={label}
      className="m-0 size-[15px] shrink-0 cursor-pointer appearance-none rounded-full border-[1.5px] border-[var(--border-strong)] bg-[var(--surface)] checked:border-[5px] checked:border-[var(--primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed"
    />
  );
}

function PairCard({ side, title, contact, other, rows, selection, onSelect, headerSlot, action, disabled }: {
  side: Side;
  title: string;
  contact: ContactRow;
  other: ContactRow;
  rows: PairRow[];
  selection: Record<string, Side>;
  onSelect: (key: string, side: Side) => void;
  headerSlot?: ReactNode;
  action: ReactNode;
  disabled: boolean;
}) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-1 flex-col rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-t-[12px] border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3">
        <span className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{title}</span>
        <span className="flex flex-wrap items-center justify-end gap-2.5">{headerSlot}</span>
      </div>
      {rows.map((row) => {
        const differs = !row.same(contact, other);
        if (row.onlyWhenDifferent && !differs) return null;
        const choice = differs && row.fields !== null;
        const value = row.value(contact);
        const inner = (
          <>
            {choice ? (
              <Radio name={`pair-${row.key}`} checked={selection[row.key] === side} onChange={() => onSelect(row.key, side)} disabled={disabled} label={`${row.label}: keep ${value} from the ${side} contact`} />
            ) : (
              <span aria-hidden className="w-[15px] shrink-0" />
            )}
            <span className="w-[130px] shrink-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{row.label}</span>
            <span className={cn("min-w-0 flex-1 text-[14px] leading-[1.5] tracking-[-0.02em] break-words", differs && "font-semibold")}>{value}</span>
            {differs && row.note && <span className="shrink-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{row.note}</span>}
          </>
        );
        const rowClass = cn("flex items-center gap-2.5 border-t border-[var(--border)] px-3.5 py-[9px]", differs ? "bg-[var(--warning-surface)] text-[var(--ink)]" : "text-[var(--muted)]", choice && !disabled && "cursor-pointer");
        return choice ? <label key={row.key} className={rowClass}>{inner}</label> : <div key={row.key} className={rowClass}>{inner}</div>;
      })}
      <div className="mt-auto p-3.5">{action}</div>
    </section>
  );
}

/** A contact from a match result (before the review queue exists, pairs are only in the response). */
function matchAsContact(match: DuplicateMatch): ContactRow {
  return { id: match.contact_id, tenant_id: "", household_id: match.household_id, first_name: match.first_name, last_name: match.last_name, dob: match.dob, primary_phone: match.primary_phone, state: match.state, custom_fields: match.custom_fields, merged_into_id: null, created_at: "", updated_at: "", phones: [], emails: [], address_line1: match.address_line1, city: match.city, postal_code: match.postal_code };
}

/** The custom-field form's controls: as tall as the button beside them. */
const fieldControl = cn(toolbarControl, "mt-1.5 w-full");

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d={direction === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}

/* ── the page ───────────────────────────────────────────────────────────── */

export function ContactWorkspace({ readOnly = false }: { readOnly?: boolean }) {
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [directory, setDirectory] = useState<ContactDirectory | null>(null);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [queue, setQueue] = useState<ReviewQueue>({ ready: true, total: 0, index: 0, pair: null });
  const [localPairs, setLocalPairs] = useState<ReviewPair[]>([]);
  const [localIndex, setLocalIndex] = useState(0);
  const [selection, setSelection] = useState<Record<string, Side>>({});
  const [selectionFor, setSelectionFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [field, setField] = useState({ field_key: "", label: "", type: "text" });
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [showAllMerges, setShowAllMerges] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const directoryState = useRef({ q: "", page: 0 });
  // Search fires as the reader types; only the newest request may paint the table.
  const directoryTicket = useRef(0);

  const load = useCallback(async (options: { queueIndex?: number | "last" } = {}) => {
    const { q, page } = directoryState.current;
    const response = await fetch(`/api/app/contacts?q=${encodeURIComponent(q)}&page=${page}&pageSize=${PAGE_SIZE}`, { cache: "no-store" });
    const body = await readJson(response);
    if (!response.ok || !body) throw new Error(errorOf(body, "Could not load contacts"));
    const payload = body as unknown as WorkspacePayload;
    setWorkspace(payload);
    setDirectory(payload.directory);
    setLoadError(null);
    const wanted = options.queueIndex === "last" ? payload.queue.total - 1 : Math.min(options.queueIndex ?? 0, payload.queue.total - 1);
    if (wanted > 0 && payload.queue.ready) {
      const queued = await fetch(`/api/app/contacts/reviews?index=${wanted}`, { cache: "no-store" });
      const queueBody = await readJson(queued);
      setQueue(queued.ok && queueBody ? queueBody as unknown as ReviewQueue : payload.queue);
    } else setQueue(payload.queue);
  }, []);

  // This effect hydrates the client view from current server state.
  useEffect(() => { void load().catch((error: Error) => { setLoadError(error.message); notify.fail("Could not load contacts", { detail: error.message }); }); }, [load]);

  const loadDirectory = useCallback(async (q: string, page: number) => {
    directoryState.current = { q, page };
    const ticket = ++directoryTicket.current;
    setDirectoryLoading(true);
    try {
      const response = await fetch(`/api/app/contacts?view=directory&q=${encodeURIComponent(q)}&page=${page}&pageSize=${PAGE_SIZE}`, { cache: "no-store" });
      const body = await readJson(response);
      if (!response.ok || !body) throw new Error(errorOf(body, "Could not load contacts"));
      if (ticket !== directoryTicket.current) return;
      setDirectory((body as { directory: ContactDirectory }).directory);
      setExpanded(null);
    } catch (error) {
      notify.fail("Could not load contacts", { detail: error instanceof Error ? error.message : undefined });
    } finally { if (ticket === directoryTicket.current) setDirectoryLoading(false); }
  }, []);

  function onSearch(value: string) {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { void loadDirectory(value.trim(), 0); }, 300);
  }
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  async function goToPair(index: number) {
    if (!queue.ready) { setLocalIndex(index); return; }
    setBusy("queue");
    try {
      const response = await fetch(`/api/app/contacts/reviews?index=${index}`, { cache: "no-store" });
      const body = await readJson(response);
      if (!response.ok || !body) throw new Error(errorOf(body, "Could not load the review queue"));
      setQueue(body as unknown as ReviewQueue);
    } catch (error) {
      notify.fail("Could not load the review queue", { detail: error instanceof Error ? error.message : undefined });
    } finally { setBusy(null); }
  }

  const schema = workspace?.fieldSchema ?? [];
  const rows = pairRows(schema);
  const current: { total: number; index: number; pair: ReviewPair | null } = queue.ready
    ? queue
    : { total: localPairs.length, index: Math.min(localIndex, Math.max(0, localPairs.length - 1)), pair: localPairs[Math.min(localIndex, Math.max(0, localPairs.length - 1))] ?? null };
  const pairKey = current.pair ? `${current.pair.review.id ?? "local"}:${current.pair.existing.id}:${current.pair.incoming.id}` : null;
  if (pairKey !== selectionFor) {
    // Adjusting state while rendering, when the pair on screen changes: the React-recommended
    // alternative to an effect that would paint the old selection first.
    setSelectionFor(pairKey);
    setSelection(current.pair ? defaultSelection(rows, current.pair) : {});
  }

  function choicesFor(kept: Side) {
    const choices: Record<string, "kept" | "merged"> = {};
    if (!current.pair) return choices;
    for (const row of rows) {
      if (!row.fields || row.same(current.pair.existing, current.pair.incoming)) continue;
      const winner = selection[row.key] ?? "incoming";
      for (const key of row.fields) choices[key] = winner === kept ? "kept" : "merged";
    }
    return choices;
  }

  async function undo(mergeId: string) {
    setBusy(`undo:${mergeId}`);
    try {
      const response = await fetch("/api/app/contacts/merge/undo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ merge_id: mergeId }) });
      const body = await readJson(response);
      if (!response.ok) { notify.block("Could not undo merge", { detail: errorOf(body, "Try again.") }); return; }
      notify.done("Merge undone; both original contacts are restored");
      await load({ queueIndex: current.index });
    } catch (error) {
      notify.fail("Could not undo merge", { detail: error instanceof Error ? error.message : undefined });
    } finally { setBusy(null); }
  }

  async function merge(kept: Side) {
    const pair = current.pair; if (!pair) return;
    const keptContact = kept === "existing" ? pair.existing : pair.incoming;
    const mergedContact = kept === "existing" ? pair.incoming : pair.existing;
    setBusy("merge");
    try {
      const response = await fetch("/api/app/contacts/merge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kept_id: keptContact.id, merged_id: mergedContact.id, field_choices: choicesFor(kept), review_id: pair.review.id }) });
      const body = await readJson(response);
      if (!response.ok) { notify.block("Could not merge contacts", { detail: errorOf(body, "Try again.") }); if (response.status === 409) await load({ queueIndex: current.index }); return; }
      const mergeId = typeof body?.mergeId === "string" ? body.mergeId : null;
      notify.done("Contacts merged; the original records remain recoverable", mergeId ? { action: { label: "Undo", onClick: () => void undo(mergeId) } } : undefined);
      if (!queue.ready) setLocalPairs((pairs) => pairs.filter((item) => item.existing.id !== mergedContact.id && item.incoming.id !== mergedContact.id));
      await load({ queueIndex: current.index });
    } catch (error) {
      notify.fail("Could not merge contacts", { detail: error instanceof Error ? error.message : undefined });
    } finally { setBusy(null); }
  }

  async function dismiss() {
    const pair = current.pair; if (!pair) return;
    if (!pair.review.id) { setLocalPairs((pairs) => pairs.filter((item) => item !== pair)); return; }
    setBusy("dismiss");
    try {
      const response = await fetch("/api/app/contacts/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ review_id: pair.review.id, action: "dismiss" }) });
      const body = await readJson(response);
      if (!response.ok) { notify.block("Could not dismiss this match", { detail: errorOf(body, "Try again.") }); if (response.status === 409) await load({ queueIndex: current.index }); return; }
      notify.done("Marked as not the same person", { detail: "Both contacts are kept as they are." });
      await load({ queueIndex: current.index });
    } catch (error) {
      notify.fail("Could not dismiss this match", { detail: error instanceof Error ? error.message : undefined });
    } finally { setBusy(null); }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy("create"); setFormError(null);
    try {
      const response = await fetch("/api/app/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const body = await readJson(response);
      if (!response.ok || !body) { setFormError(errorOf(body, "Could not create contact")); return; }
      setForm(emptyForm); setAddOpen(false);
      const outcome = body.outcome as string;
      const mergeId = typeof body.mergeId === "string" ? body.mergeId : null;
      if (outcome === "auto_merged") notify.done("Probable duplicate auto-merged", { detail: "Same date of birth, and the phone or address matched. Undo it from Recent merges if that is wrong.", action: mergeId ? { label: "Undo", onClick: () => void undo(mergeId) } : undefined });
      else if (outcome === "review") notify.warn("Possible duplicate: waiting for review", { detail: "Compare the two records under Duplicate check and choose what to keep." });
      else notify.done("Contact created");
      if (outcome === "review" && body.reviewsReady === false) {
        const created = body.contact as ContactRow;
        const pairs = ((body.duplicates as DuplicateMatch[]) ?? []).filter((match) => match.confidence !== "low").map((match): ReviewPair => ({ review: { id: null, score: match.score, confidence: match.confidence, matched_on: match.matched_on, created_at: null }, existing: matchAsContact(match), incoming: created }));
        setLocalPairs(pairs); setLocalIndex(0);
      }
      await load({ queueIndex: outcome === "review" ? "last" : current.index });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not create contact");
    } finally { setBusy(null); }
  }

  async function importFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setBusy("import");
    try {
      const response = await fetch("/api/app/contacts/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv: await file.text() }) });
      const body = await readJson(response);
      if (!response.ok || !body) { notify.block("Could not import contacts", { detail: errorOf(body, "Check the file and try again.") }); return; }
      const imported = Number(body.imported ?? 0);
      const failedCount = Number(body.failedCount ?? 0);
      const failed = Array.isArray(body.failed) ? body.failed as Array<{ row: number; error: string }> : [];
      const parts = [Number(body.autoMerged ?? 0) ? `${body.autoMerged} auto-merged` : null, Number(body.queued ?? 0) ? `${body.queued} waiting for review` : null, failedCount ? `${failedCount} row${failedCount === 1 ? "" : "s"} not imported${failed[0] ? ` (row ${failed[0].row}: ${failed[0].error})` : ""}` : null].filter(Boolean);
      const title = `${imported} contact${imported === 1 ? "" : "s"} imported`;
      if (failedCount) notify.warn(title, { detail: parts.join(" · ") });
      else notify.done(title, parts.length ? { detail: parts.join(" · ") } : undefined);
      await load({ queueIndex: current.index });
    } catch (error) {
      notify.fail("Could not import contacts", { detail: error instanceof Error ? error.message : undefined });
    } finally { event.target.value = ""; setBusy(null); }
  }

  async function saveField(event: React.FormEvent) {
    event.preventDefault(); setFieldError(null); setBusy("field");
    try {
      const response = await fetch("/api/app/contacts/field-schema", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...field, options: [], is_required: false, sort_order: schema.length }) });
      const body = await readJson(response);
      if (!response.ok) { setFieldError(errorOf(body, "Could not save field")); return; }
      setField({ field_key: "", label: "", type: "text" }); notify.done("Custom field saved"); await load({ queueIndex: current.index });
    } catch (error) {
      setFieldError(error instanceof Error ? error.message : "Could not save field");
    } finally { setBusy(null); }
  }

  const header = (
    <PageHeader
      title="Duplicate check"
      actions={
        <>
          <Button asChild variant="outline"><a href="/api/app/contacts/export">Export CSV</a></Button>
          <label htmlFor="contact-import-file" className={cn(buttonVariants({ variant: "outline" }), "cursor-pointer focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2", (readOnly || busy === "import") && "pointer-events-none opacity-40")}>
            {busy === "import" ? "Importing…" : "Import contacts"}
            <input id="contact-import-file" type="file" accept=".csv,text/csv" className="sr-only" disabled={readOnly || busy === "import"} onChange={(event) => void importFile(event)} />
          </label>
          <Button type="button" disabled={readOnly} onClick={() => { setFormError(null); setAddOpen(true); }}>Add contact</Button>
        </>
      }
    />
  );

  if (!workspace || !directory) {
    if (!loadError) return <PageLoading />;
    return (
      <div className="flex w-full min-w-0 flex-col gap-6">
        {header}
        <Callout tone="error" title={<span className="flex flex-wrap items-center gap-3">Contacts could not be loaded: {loadError}<Button type="button" variant="outline" onClick={() => void load().catch((error: Error) => setLoadError(error.message))}>Try again</Button></span>} />
      </div>
    );
  }

  const { stats, merges } = workspace;
  const undonePercent = stats.mergedThisMonth ? Math.round(((stats.undoneThisMonth ?? 0) / stats.mergedThisMonth) * 1000) / 10 : 0;
  const pair = current.pair;
  const writeBlocked = readOnly || busy !== null;
  const conflict = pair ? dobConflict(pair.incoming.dob, pair.existing) : false;
  const shownMerges = showAllMerges ? merges : merges.slice(0, 5);
  const firstRow = directory.total ? directory.page * directory.pageSize + 1 : 0;
  const lastRow = directory.page * directory.pageSize + directory.rows.length;
  const clearSearch = () => { setSearch(""); void loadDirectory("", 0); };

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {header}

      <StatStrip label="Contact and merge totals">
        <StatTile label="Contacts" value={stats.contacts.toLocaleString()} footnote={stats.households === null ? "active records" : `across ${stats.households.toLocaleString()} household${stats.households === 1 ? "" : "s"}`} />
        <StatTile label="Pending review" valueTone="warning" value={stats.pending === null ? "—" : stats.pending.toLocaleString()} footnote={stats.pending === null ? "Review queue not set up yet" : stats.pending && stats.oldestPendingAt ? `oldest ${age(stats.oldestPendingAt)}` : "nothing waiting"} />
        <StatTile label="Merged this month" valueTone="good" labelTitle={`Calendar month in ${stats.timezone}`} value={(stats.mergedThisMonth ?? 0).toLocaleString()} footnote={stats.undoableThisMonth === null ? `month in ${stats.timezone}` : `${stats.undoableThisMonth.toLocaleString()} can be undone`} />
        <StatTile label="Merges undone" value={(stats.undoneThisMonth ?? 0).toLocaleString()} footnote={stats.mergedThisMonth ? `${undonePercent}% of merges` : "no merges this month"} />
      </StatStrip>

      {readOnly && <Callout tone="warning" title="This workspace is read-only: adding, importing, merging and undoing are paused." />}

      <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {pair ? (
            <>
              <div className="flex min-w-0 flex-col gap-5 md:flex-row">
                <PairCard
                  side="existing"
                  title="Existing contact"
                  contact={pair.existing}
                  other={pair.incoming}
                  rows={rows}
                  selection={selection}
                  onSelect={(key, side) => setSelection((value) => ({ ...value, [key]: side }))}
                  disabled={writeBlocked}
                  headerSlot={<>
                    <Pill tone={pair.review.confidence === "high" ? "warning" : "neutral"}>{Math.min(100, Math.round(pair.review.score * 100))}% · {pair.review.confidence === "high" ? "High" : "Medium"}</Pill>
                    {conflict && <Pill tone="error">DOB differs</Pill>}
                    <span className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">on {matchedOnLabel(pair.review.matched_on)}</span>
                  </>}
                  action={<Button type="button" variant="outline" className="w-full" disabled={writeBlocked} onClick={() => void merge("existing")}>{busy === "merge" ? "Merging…" : "Keep existing"}</Button>}
                />
                <PairCard
                  side="incoming"
                  title="Incoming contact"
                  contact={pair.incoming}
                  other={pair.existing}
                  rows={rows}
                  selection={selection}
                  onSelect={(key, side) => setSelection((value) => ({ ...value, [key]: side }))}
                  disabled={writeBlocked}
                  headerSlot={current.total > 1 ? (
                    <span className="flex items-center gap-1.5">
                      <button type="button" aria-label="Previous pair" className={btn("row", "h-7 px-1.5")} disabled={current.index === 0 || busy === "queue"} onClick={() => void goToPair(current.index - 1)}><ChevronIcon direction="left" /></button>
                      <span className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)] tabular-nums">{current.index + 1} of {current.total}</span>
                      <button type="button" aria-label="Next pair" className={btn("row", "h-7 px-1.5")} disabled={current.index >= current.total - 1 || busy === "queue"} onClick={() => void goToPair(current.index + 1)}><ChevronIcon direction="right" /></button>
                    </span>
                  ) : <span className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">1 of 1</span>}
                  action={<Button type="button" className="w-full" disabled={writeBlocked} onClick={() => void merge("incoming")}>{busy === "merge" ? "Merging…" : "Keep new"}</Button>}
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Button type="button" variant="ghost" disabled={writeBlocked} onClick={() => void dismiss()}>{busy === "dismiss" ? "Saving…" : "Not the same person"}</Button>
                {pair.review.created_at && <span className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">Waiting {age(pair.review.created_at)}</span>}
              </div>
            </>
          ) : (
            <DashedCard title="No pairs waiting">
              {queue.ready
                ? "Possible duplicates from Add contact and Import contacts wait here side by side."
                : "Matches found by Add contact appear here. Imported matches are not kept until a database update is applied."}
            </DashedCard>
          )}
        </div>

        <TableCard className="min-w-0 lg:w-[320px] lg:shrink-0" title="Recent merges">
          {merges.length ? (
            <ul className="m-0 list-none border-t border-[var(--border)] p-0">
              {shownMerges.map((row: RecentMerge) => (
                <li key={row.id} className="flex items-center gap-2.5 border-t border-[var(--border)] px-4 py-2.5 first:border-t-0">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">
                      <span className="min-w-0 break-words">{row.keptName}</span>
                      {row.source === "auto" && <Pill tone="neutral">Auto</Pill>}
                    </span>
                    <span className="block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
                      {ago(row.mergedAt)}{shortName(row.actorName) ? ` · ${shortName(row.actorName)}` : ""}
                      {!row.reversedAt && !row.undoable ? " · undo the later merge first" : ""}
                    </span>
                  </span>
                  {row.reversedAt ? (
                    <Pill tone="neutral">Undone</Pill>
                  ) : (
                    <Button type="button" size="sm" variant="outline" aria-label={`Undo merge into ${row.keptName}`} disabled={writeBlocked || !row.undoable} onClick={() => void undo(row.id)}>{busy === `undo:${row.id}` ? "Undoing…" : "Undo"}</Button>
                  )}
                </li>
              ))}
              {merges.length > 5 && (
                <li className="border-t border-[var(--border)] px-4 py-2">
                  <button type="button" className={btn("row", "px-0")} onClick={() => setShowAllMerges((value) => !value)}>{showAllMerges ? "Show fewer" : `Show all ${merges.length}`}</button>
                </li>
              )}
            </ul>
          ) : (
            <p className="m-0 border-t border-[var(--border)] px-4 py-3 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">No merges yet.</p>
          )}
        </TableCard>
      </div>

      <TableCard
        title="Contact directory"
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={() => void loadDirectory(directory.query, directory.page)} refreshing={directoryLoading} />}>
            <ToolbarSearch value={search} onChange={onSearch} placeholder="Search name, phone, email, city" label="Search contacts" className="sm:w-72" />
            {stats.flaggedContacts ? <Pill tone="warning">{stats.flaggedContacts.toLocaleString()} duplicate-suspected</Pill> : null}
          </DataToolbar>
        }
        footer={
          <>
            <span className="tabular-nums" role="status">
              {directory.total ? `Showing ${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${directory.total.toLocaleString()} contact${directory.total === 1 ? "" : "s"}` : "No contacts to show"}
            </span>
            <span className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={directory.page === 0 || directoryLoading} onClick={() => void loadDirectory(directory.query, directory.page - 1)}>Previous</Button>
              <Button type="button" variant="outline" size="sm" disabled={lastRow >= directory.total || directoryLoading} onClick={() => void loadDirectory(directory.query, directory.page + 1)}>Next</Button>
            </span>
          </>
        }
      >
        <div aria-busy={directoryLoading}>
          {directory.rows.length ? (
            <table aria-label="Contact directory" className={cn(st.table, "min-w-[720px]")}>
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={st.th}>Contact</th>
                  <th scope="col" className={cn(st.th, "w-[160px]")}>Phone</th>
                  <th scope="col" className={cn(st.th, "w-[220px]")}>Household</th>
                  <th scope="col" className={cn(st.th, "w-[80px]")}>Leads</th>
                  <th scope="col" className={cn(st.th, "w-[170px]")}>Flag</th>
                </tr>
              </thead>
              <tbody className="m-seq">
                {directory.rows.map((row) => {
                  const open = expanded === row.id;
                  return [
                    <tr key={row.id} className="m-row">
                      <td className={st.td}>
                        <button type="button" aria-expanded={open} aria-controls={`contact-detail-${row.id}`} className="cursor-pointer text-left text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)] hover:text-[var(--ink)] hover:underline" onClick={() => setExpanded(open ? null : row.id)}>{row.first_name} {row.last_name}</button>
                      </td>
                      <td className={cn(st.td, "tabular-nums whitespace-nowrap")}>{formatPhone(row.primary_phone)}</td>
                      <td className={st.td}>{row.household_label ?? "—"}</td>
                      <td className={cn(st.td, "tabular-nums")}>{row.lead_count ? row.lead_count.toLocaleString() : "—"}</td>
                      <td className={st.td}>{row.open_review === null ? "—" : row.open_review ? <Pill tone="warning" dot>Duplicate suspected</Pill> : <Pill tone="neutral" dot>No open match</Pill>}</td>
                    </tr>,
                    open ? (
                      <tr key={`${row.id}-detail`} id={`contact-detail-${row.id}`}>
                        <td colSpan={5} className={cn(st.td, "bg-[var(--surface-alt)]")}>
                          <dl className="m-0 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                            {[
                              ["Date of birth", formatDob(row.dob)],
                              ["Address", [row.address_line1, row.city, row.household_state || row.state, row.postal_code].filter(Boolean).join(", ") || "—"],
                              ["Phones", row.phones.map((item) => formatPhone(item.phone)).join(", ") || "—"],
                              ["Emails", row.emails.map((item) => item.email).join(", ") || "—"],
                              ["Custom fields", customFieldsText(row.custom_fields, schema)],
                            ].map(([label, value]) => (
                              <div key={label} className="min-w-0">
                                <dt className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">{label}</dt>
                                <dd className="m-0 mt-0.5 break-words text-[14px] leading-[1.5] text-[var(--ink)]">{value}</dd>
                              </div>
                            ))}
                          </dl>
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table>
          ) : directory.query ? (
            <NoMatches noun="contacts" onClear={clearSearch} />
          ) : (
            <EmptyState title="No contacts yet" hint="Add a contact or import a CSV; each one is checked for duplicates first." />
          )}
        </div>
      </TableCard>

      <SettingsCard title="Custom contact fields" sub="Imported from and exported to custom_<key> columns." pad={20}>
        <form onSubmit={saveField} className="grid gap-3 sm:grid-cols-[1fr_1fr_180px_auto] sm:items-end">
          <Field label="Key" htmlFor="field-key"><input id="field-key" className={fieldControl} placeholder="preferred_language" value={field.field_key} disabled={readOnly} onChange={(event) => setField((value) => ({ ...value, field_key: event.target.value }))} /></Field>
          <Field label="Label" htmlFor="field-label"><input id="field-label" className={fieldControl} placeholder="Preferred language" value={field.label} disabled={readOnly} onChange={(event) => setField((value) => ({ ...value, label: event.target.value }))} /></Field>
          <Field label="Type" htmlFor="field-type">
            <select id="field-type" className={fieldControl} value={field.type} disabled={readOnly} onChange={(event) => setField((value) => ({ ...value, type: event.target.value }))}>
              <option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="single_select">Single select</option><option value="multi_select">Multi select</option><option value="boolean">Boolean</option><option value="currency">Currency (cents)</option><option value="phone">Phone</option>
            </select>
          </Field>
          <Button type="submit" disabled={readOnly || busy === "field"}>{busy === "field" ? "Saving…" : "Add field"}</Button>
        </form>
        {fieldError && <p role="alert" className="mt-2 text-[12px] leading-[1.5] text-[var(--error-ink)]">{fieldError}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {schema.filter((item) => item.entity === "contact").map((item) => <Pill key={`${item.entity}-${item.field_key}`} tone="neutral">{item.label} · {item.type}</Pill>)}
          {!schema.some((item) => item.entity === "contact") && <span className="text-[14px] leading-[1.5] text-[var(--muted)]">No custom fields yet.</span>}
        </div>
      </SettingsCard>

      <Dialog open={addOpen} onOpenChange={(open) => { if (busy !== "create") setAddOpen(open); }}>
        <DialogContent className="rounded-[12px] border-[var(--border)] bg-[var(--surface)] sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="text-[18px] text-[var(--ink)]">Add contact</DialogTitle>
            <DialogDescription className="text-[14px] text-[var(--muted)]">Checked for duplicates before it is saved.</DialogDescription>
          </DialogHeader>
          <form onSubmit={create} className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" htmlFor="contact-first_name" required><input id="contact-first_name" className={control} required value={form.first_name} onChange={(event) => setForm((value) => ({ ...value, first_name: event.target.value }))} /></Field>
            <Field label="Last name" htmlFor="contact-last_name" required><input id="contact-last_name" className={control} required value={form.last_name} onChange={(event) => setForm((value) => ({ ...value, last_name: event.target.value }))} /></Field>
            <Field label="Phone" htmlFor="contact-primary_phone"><input id="contact-primary_phone" type="tel" className={control} value={form.primary_phone} onChange={(event) => setForm((value) => ({ ...value, primary_phone: event.target.value }))} /></Field>
            <Field label="Email" htmlFor="contact-email"><input id="contact-email" type="email" className={control} value={form.email} onChange={(event) => setForm((value) => ({ ...value, email: event.target.value }))} /></Field>
            <Field label="Date of birth" htmlFor="contact-dob"><input id="contact-dob" type="date" className={control} value={form.dob} onChange={(event) => setForm((value) => ({ ...value, dob: event.target.value }))} /></Field>
            <Field label="State code" htmlFor="contact-state"><input id="contact-state" className={control} maxLength={2} value={form.state} onChange={(event) => setForm((value) => ({ ...value, state: event.target.value.toUpperCase() }))} /></Field>
            <Field label="Address line 1" htmlFor="contact-address_line1" className="sm:col-span-2"><input id="contact-address_line1" className={control} value={form.address_line1} onChange={(event) => setForm((value) => ({ ...value, address_line1: event.target.value }))} /></Field>
            <Field label="City" htmlFor="contact-city"><input id="contact-city" className={control} value={form.city} onChange={(event) => setForm((value) => ({ ...value, city: event.target.value }))} /></Field>
            <Field label="Postal code" htmlFor="contact-postal_code"><input id="contact-postal_code" type="tel" className={control} value={form.postal_code} onChange={(event) => setForm((value) => ({ ...value, postal_code: event.target.value }))} /></Field>
            {formError && <p role="alert" className="m-0 text-[12px] leading-[1.5] text-[var(--error-ink)] sm:col-span-2">{formError}</p>}
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="ghost" disabled={busy === "create"} onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={readOnly || busy === "create"}>{busy === "create" ? "Saving…" : "Add contact"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

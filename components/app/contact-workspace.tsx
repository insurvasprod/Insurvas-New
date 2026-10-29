"use client";

import { StatusChip } from "@/components/ui/status-chip";
import { ProvisionalBadge } from "@/components/app/provisional-badge";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Check, GitMerge, TriangleAlert, Users } from "lucide-react";

import { notify } from "@/lib/notify";
import { Button, buttonVariants } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Card, cardInset } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Callout, Field, control, pillTone } from "@/components/app/settings/primitives";
import { ViewTabs, useFittingPageSize } from "@/components/app/lead-ops-view-tabs";
import { LeadsInSlot, useInLeadsFrame } from "@/components/app/lead-sources/leads-in-slot";
import { CleanListProblems, listProblemsOf, type ListProblemRow, type ListProblemsAccess } from "@/components/app/clean-list-problems";
import { cn } from "@/lib/utils";
import { dobConflict, matchedOnLabel } from "@/lib/contacts/matchPolicy";
import type { ContactDirectory, ContactRow, ContactWorkspace as Workspace, DuplicateMatch, FieldSchemaRow, RecentMerge, ReviewPair, ReviewQueue } from "@/lib/contacts/types";

/**
 * /app/duplicates, step 3 · Clean of the one Leads page (board LinB3, owner pick B 2026-10-28).
 *
 * The page is built around one question at a time: the head of a persisted review queue, drawn as
 * one "Is <name> the same person?" card (owner 2026-10-28: "really confusing") — what matched as green
 * ticks, what differs in amber, then field | incoming | already yours, where clicking a differing value
 * keeps it, then "No — keep both" or "Yes — merge them". The directory is paged and searched on the server; the tiles come
 * from one stats read (the strip under the header). Every merge can be undone from Recent merges, and the page only offers the
 * undo the server will accept (see undo_contact_merge's later-merge guard).
 */

type WorkspacePayload = Workspace & { queue: ReviewQueue };
type Side = "existing" | "incoming";

const emptyForm = { first_name: "", last_name: "", dob: "", primary_phone: "", email: "", state: "", address_line1: "", city: "", postal_code: "", custom_fields: {} as Record<string, unknown> };
const PAGE_SIZE = 10;
/** A list tab fills the step and scrolls its table inside (no page scroll, 2026-10-29); the pager stays at the foot. */
const fillCard = "flex min-w-0 flex-col lg:min-h-0 lg:flex-1 [&>.overflow-x-auto]:flex-1 lg:[&>.overflow-x-auto]:min-h-0 lg:[&>.overflow-x-auto]:overflow-y-auto";
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

/** A differing value you can keep (board LinB3): a bordered cell, ● chosen / ○ not, one radio of its row. */
function ChoiceCell({ chosen, onPick, label, disabled, children }: { chosen: boolean; onPick: () => void; label: string; disabled: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      aria-label={label}
      disabled={disabled}
      onClick={onPick}
      className={cn(
        "flex min-w-0 items-start gap-2 rounded-lg border px-2 py-1 text-left text-sm leading-[1.5] tracking-[-0.02em] break-words text-[var(--ink)] transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed",
        chosen ? "border-[var(--primary)] bg-[var(--primary-soft)] font-semibold" : "cursor-pointer border-[var(--border)] hover:border-[var(--border-strong)]",
      )}
    >
      <span aria-hidden className={cn("mt-[5px] size-3 shrink-0 rounded-full", chosen ? "border-[4px] border-[var(--primary)]" : "border-[1.5px] border-[var(--border-strong)]")} />
      <span className="min-w-0 flex-1">{children}</span>
      {chosen && <span className="shrink-0 text-xs leading-[1.5] font-semibold text-[var(--accent-ink)]">Keep</span>}
    </button>
  );
}

/** What the matcher's reasons read as, on a green tick. */
const MATCHED: Record<string, string> = { phone: "Same phone", address: "Same address", name: "Same name", dob: "Same date of birth" };

const PAIR_GRID = "grid grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)] items-start gap-2";

/** The pair as one grid: field | incoming | already yours. Same values are plain; a differing one is picked. */
function PairGrid({ pair, rows, selection, onSelect, disabled }: {
  pair: ReviewPair;
  rows: PairRow[];
  selection: Record<string, Side>;
  onSelect: (key: string, side: Side) => void;
  disabled: boolean;
}) {
  const sides: Array<{ side: Side; contact: ContactRow; name: string }> = [
    { side: "incoming", contact: pair.incoming, name: "incoming" },
    { side: "existing", contact: pair.existing, name: "existing" },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className={cn(PAIR_GRID, "px-3 text-xs leading-[1.5] font-semibold text-[var(--body)]")}>
        <span aria-hidden />
        <span>Incoming (new)</span>
        <span>Already yours</span>
      </div>
      {rows.map((row) => {
        const differs = !row.same(pair.existing, pair.incoming);
        if (row.onlyWhenDifferent && !differs) return null;
        const choice = differs && row.fields !== null;
        return (
          <div key={row.key} role={choice ? "radiogroup" : undefined} aria-label={choice ? `${row.label}: which to keep` : undefined} className={cn(cardInset, PAIR_GRID, "px-3 py-2")}>
            <span className="min-w-0 pt-1 text-xs leading-[1.5] text-[var(--body)]">
              {row.label}
              {differs && row.note && <span className="block font-semibold text-[var(--ink)]">{row.note}</span>}
            </span>
            {sides.map(({ side, contact, name }) => {
              const value = row.value(contact);
              return choice ? (
                <ChoiceCell key={side} chosen={selection[row.key] === side} onPick={() => onSelect(row.key, side)} disabled={disabled} label={`${row.label}: keep ${value} from the ${name} contact`}>{value}</ChoiceCell>
              ) : (
                <span key={side} className={cn("min-w-0 px-2 py-1 text-sm leading-[1.5] tracking-[-0.02em] break-words", differs ? "font-semibold text-[var(--ink)]" : "text-[var(--body)]")}>{value}</span>
              );
            })}
          </div>
        );
      })}
    </div>
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

export function ContactWorkspace({ readOnly = false, listProblems = null }: {
  readOnly?: boolean;
  /** Lists' gates for this person; null when they cannot see lead lists, and the List problems tab is not drawn. */
  listProblems?: ListProblemsAccess | null;
}) {
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
  const [tab, setTab] = useState<"review" | "directory" | "merges" | "problems">("review");
  const [problemLists, setProblemLists] = useState<ListProblemRow[] | null>(null);
  const [problemsError, setProblemsError] = useState<string | null>(null);
  const [problemsLoading, setProblemsLoading] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [mergePage, setMergePage] = useState(1);
  const pageSize = useFittingPageSize(400, 45);
  const inFrame = useInLeadsFrame();
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

  // List problems: the Lists step's own report (GET /api/app/lead-lists), read only for people it admits.
  const hasListProblems = listProblems !== null;
  const loadProblems = useCallback(async () => {
    if (!hasListProblems) return;
    setProblemsLoading(true);
    try {
      const response = await fetch("/api/app/lead-lists", { cache: "no-store" });
      const body = await readJson(response);
      if (!response.ok || !body) throw new Error(errorOf(body, "Could not load your lists"));
      setProblemLists((body.lists ?? []) as ListProblemRow[]);
      setProblemsError(null);
    } catch (error) {
      setProblemsError(error instanceof Error ? error.message : "Could not load your lists");
    } finally { setProblemsLoading(false); }
  }, [hasListProblems]);
  useEffect(() => { void loadProblems(); }, [loadProblems]); // eslint-disable-line react-hooks/set-state-in-effect

  // /app/duplicates#list-problems opens the List problems tab (on arrival and when the hash changes).
  useEffect(() => {
    if (!hasListProblems) return;
    const fromHash = () => { if (window.location.hash === "#list-problems") setTab("problems"); };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [hasListProblems]);

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
      // A pair waiting for review is the next thing to look at, so the queue's tab comes forward.
      if (outcome === "review") setTab("review");
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

  if (!workspace || !directory) {
    if (!loadError) return <PageLoading />;
    return (
      <div className="flex w-full min-w-0 flex-col gap-6">
        <Callout tone="error" title={<span className="flex flex-wrap items-center gap-3">Contacts could not be loaded: {loadError}<Button type="button" variant="outline" onClick={() => void load().catch((error: Error) => setLoadError(error.message))}>Try again</Button></span>} />
      </div>
    );
  }

  const { stats, merges } = workspace;
  const undonePercent = stats.mergedThisMonth ? Math.round(((stats.undoneThisMonth ?? 0) / stats.mergedThisMonth) * 1000) / 10 : 0;
  const pair = current.pair;
  const writeBlocked = readOnly || busy !== null;
  const conflict = pair ? dobConflict(pair.incoming.dob, pair.existing) : false;
  const { current: mergePageNow, rows: shownMerges } = paginate(merges, mergePage, pageSize);
  const clearSearch = () => { setSearch(""); void loadDirectory("", 0); };
  /** The newest live merge after this one that touches either of its contacts: the one undo_contact_merge wants undone first. */
  const laterMerge = (row: RecentMerge) => {
    const ids = new Set([row.keptId, row.mergedId]);
    return merges
      .filter((other) => other.id !== row.id && !other.reversedAt && Date.parse(other.mergedAt) > Date.parse(row.mergedAt) && (ids.has(other.keptId) || ids.has(other.mergedId)))
      .sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt))[0] ?? null;
  };
  /** Pages Recent merges to a merge and brings its row into view. */
  const showMerge = (id: string) => {
    const at = merges.findIndex((item) => item.id === id);
    if (at < 0) return;
    setMergePage(Math.floor(at / pageSize) + 1);
    requestAnimationFrame(() => document.getElementById(`merge-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };
  const contactFields = schema.filter((item) => item.entity === "contact");

  // 2026-10-06 redesign: the queue, the directory and the merge history are tabs, not stacked sections.
  const tabs = <ViewTabs
    label="Duplicate check views"
    controls="duplicates-panel"
    value={tab}
    onChange={setTab}
    tabs={[
      { key: "review", label: "Review queue", count: current.total },
      { key: "directory", label: "Contacts", count: directory.total },
      // "Merges", not "Recent merges": with List problems the four tabs must fit the top row at 1440px.
      { key: "merges", label: "Merges", count: merges.length },
      // Owner 2026-10-29: a list problem that stops a campaign is fixed here, not on Lists.
      ...(listProblems ? [{ key: "problems" as const, label: "List problems", count: problemLists ? listProblemsOf(problemLists).length : null, tone: "danger" as const }] : []),
    ]}
  />;
  // The page's contact actions, on the Contacts table's toolbar (they act on the directory).
  const contactActions = <>
    <Button type="button" variant="outline" onClick={() => { setFieldError(null); setFieldsOpen(true); }}>Custom fields</Button>
    <Button asChild variant="outline"><a href="/api/app/contacts/export">Export CSV</a></Button>
    <label htmlFor="contact-import-file" className={cn(buttonVariants({ variant: "outline" }), "cursor-pointer focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2", (readOnly || busy === "import") && "pointer-events-none opacity-40")}>
      {busy === "import" ? "Importing…" : "Import contacts"}
      <input id="contact-import-file" type="file" accept=".csv,text/csv" className="sr-only" disabled={readOnly || busy === "import"} onChange={(event) => void importFile(event)} />
    </label>
    <Button type="button" disabled={readOnly} onClick={() => { setFormError(null); setAddOpen(true); }}>Add contact</Button>
  </>;

  // This pair, in words: who it is, what matched (green ticks) and what differs (amber).
  const personName = pair ? (`${pair.incoming.first_name} ${pair.incoming.last_name}`.trim() || "this contact") : "";
  const matched = pair ? pair.review.matched_on.map((key) => (key === "name" && !rows[0].same(pair.existing, pair.incoming) ? "Similar name" : MATCHED[key] ?? `Same ${matchedOnLabel([key])}`)) : [];
  const differs = pair ? rows.filter((row) => row.key !== "household" && !row.same(pair.existing, pair.incoming)).map((row) => (row.key === "dob" && conflict ? "DOB differs" : `${row.label} differs`)) : [];
  // A spouse scores like a duplicate (same address, phone, surname); a different birthday or first
  // name is what tells them apart (matchPolicy), so the page then leans to "keep both".
  const firstName = (contact: ContactRow) => contact.first_name.trim().toLowerCase();
  const otherFirstName = pair ? firstName(pair.incoming) !== firstName(pair.existing) && !firstName(pair.incoming).startsWith(firstName(pair.existing)) && !firstName(pair.existing).startsWith(firstName(pair.incoming)) : false;
  const likelyTwo = pair ? conflict || otherFirstName : false;

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-4 lg:min-h-0 lg:flex-1">
      {/* Compact, as Lists draws its strip: the figures only, each one's detail behind its tip. */}
      <StatStrip label="Contact and merge totals">
        <StatTile label="Contacts" labelTitle={stats.households === null ? "Active records." : `Active records, across ${stats.households.toLocaleString()} household${stats.households === 1 ? "" : "s"}.`} value={stats.contacts.toLocaleString()} />
        <StatTile label="Pending review" valueTone="warning" labelTitle={stats.pending === null ? "The review queue is not set up yet." : stats.pending && stats.oldestPendingAt ? `Pairs waiting for an answer; the oldest has waited ${age(stats.oldestPendingAt)}.` : "Nothing waiting."} value={stats.pending === null ? "—" : stats.pending.toLocaleString()} />
        <StatTile label="Merged this month" valueTone="good" labelTitle={`Calendar month in ${stats.timezone}.${stats.undoableThisMonth === null ? "" : ` ${stats.undoableThisMonth.toLocaleString()} can be undone.`}`} value={(stats.mergedThisMonth ?? 0).toLocaleString()} />
        <StatTile label="Merges undone" labelTitle={stats.mergedThisMonth ? `${undonePercent}% of this month's merges.` : "No merges this month."} value={(stats.undoneThisMonth ?? 0).toLocaleString()} />
      </StatStrip>

      {readOnly && <Callout tone="warning" title="This workspace is read-only: adding, importing, merging and undoing are paused." />}

      {/* The tabs sit in the Lead sources frame's top row, level with the rail (owner 2026-10-28), so
          the content starts at the top; outside the frame they keep their own row. */}
      {inFrame ? <LeadsInSlot slot="lead">{tabs}</LeadsInSlot> : tabs}

      <div key={tab} role="tabpanel" id="duplicates-panel" aria-labelledby={`duplicates-panel-tab-${tab}`} className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
      {tab === "review" && (
        // Board LinB3, card 1: one pair at a time, field | incoming | already yours, each differing value
        // a cell you pick; Merge keeps the contact you already have as the record (its leads and
        // history stay put) with the values picked here.
        <Card aria-labelledby="same-person" className="min-w-0 gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="same-person" className="m-0 min-w-0 text-card-title text-[var(--ink)]">
              {pair ? <>Is {personName} the same person?</> : "Nothing to confirm"}
            </h2>
            <span className="flex flex-wrap items-center gap-2">
              {current.total > 1 && (
                <span className="flex items-center gap-1.5">
                  <Button type="button" variant="outline" size="icon-sm" aria-label="Previous pair" disabled={current.index === 0 || busy === "queue"} onClick={() => void goToPair(current.index - 1)}><ChevronIcon direction="left" /></Button>
                  <span className="text-xs leading-[1.5] text-[var(--body)] tabular-nums">{current.index + 1} of {current.total} to confirm</span>
                  <Button type="button" variant="outline" size="icon-sm" aria-label="Next pair" disabled={current.index >= current.total - 1 || busy === "queue"} onClick={() => void goToPair(current.index + 1)}><ChevronIcon direction="right" /></Button>
                </span>
              )}
              <ToggleChip onClick={() => setTab("merges")}>Recent merges · undo</ToggleChip>
            </span>
          </div>
          {pair ? (
            <>
              {/* Why they were paired (green ticks) and where they differ (amber), before the grid. */}
              <div className="flex flex-wrap items-center gap-1.5" aria-label="How these two compare">
                {matched.map((label) => <StatusChip key={label} tone="good" dot={false}><Check aria-hidden className="size-3.5" />{label}</StatusChip>)}
                {differs.map((label) => <StatusChip key={label} tone="warning" dot={false}><TriangleAlert aria-hidden className="size-3.5" />{label}</StatusChip>)}
                {!differs.length && <StatusChip tone="good" dot={false}><Check aria-hidden className="size-3.5" />Every field matches</StatusChip>}
                {likelyTwo && <StatusChip tone="info" dot={false}><Users aria-hidden className="size-3.5" />{conflict ? "Different birthday" : "Different first name"}: likely two people in one household</StatusChip>}
                <StatusChip dot={false} tone={pillTone(pair.review.confidence === "high" ? "warning" : "neutral")}>{Math.min(100, Math.round(pair.review.score * 100))}% match · {pair.review.confidence === "high" ? "High" : "Medium"}</StatusChip>
                {pair.review.created_at && <span className="text-xs leading-[1.5] text-[var(--body)]">waiting {age(pair.review.created_at)}</span>}
              </div>
              {/* One line on how the grid works: a differing value is picked by clicking it. */}
              <span className="flex items-center gap-2 text-xs leading-[1.5] text-[var(--body)]">
                <span aria-hidden className="size-3 shrink-0 rounded-full border-[4px] border-[var(--primary)]" />
                Where they differ, click the value to keep. The best one is picked already.
              </span>
              <PairGrid
                pair={pair}
                rows={rows}
                selection={selection}
                onSelect={(key, side) => setSelection((value) => ({ ...value, [key]: side }))}
                disabled={writeBlocked}
              />
              <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
                {/* The likelier answer is the primary: keep both for a probable household member. */}
                <Button type="button" variant={likelyTwo ? "default" : "outline"} disabled={writeBlocked} onClick={() => void dismiss()}><Users aria-hidden="true" />{busy === "dismiss" ? "Saving…" : "No — keep both"}</Button>
                <Button type="button" variant={likelyTwo ? "outline" : "default"} disabled={writeBlocked} onClick={() => void merge("existing")}><GitMerge aria-hidden="true" />{busy === "merge" ? "Merging…" : "Yes — merge them"}</Button>
              </div>
            </>
          ) : (
            <EmptyState
              title="No pairs waiting"
              hint={queue.ready
                ? "Every match is decided. A merge can be undone from Recent merges."
                : "Matches from Add contact appear here; imported ones need a database update."}
              action={<span className="flex flex-wrap justify-center gap-2">
                {!readOnly && <Button type="button" variant="outline" onClick={() => { setFormError(null); setAddOpen(true); }}>Add contact</Button>}
                {/* Inside the frame its own corner already says "Continue to Lists": one primary, not two. */}
                {!inFrame && <Button asChild><Link href="/app/lead-sources">Continue to Lists<ArrowRight aria-hidden="true" /></Link></Button>}
              </span>}
            />
          )}
        </Card>
      )}

      {tab === "directory" && (
        <TableCard
          className={fillCard}
          toolbar={
            <DataToolbar
              actions={
                <>
                  {directory.query && <ClearFiltersButton onClick={clearSearch} />}
                  <RefreshButton onClick={() => void loadDirectory(directory.query, directory.page)} refreshing={directoryLoading} />
                  {contactActions}
                </>
              }
            >
              <ToolbarSearch value={search} onChange={onSearch} placeholder="Search name, phone, email, city" label="Search contacts" className="sm:w-72" />
              {stats.flaggedContacts ? <StatusChip dot={false} tone="warning">{stats.flaggedContacts.toLocaleString()} duplicate-suspected</StatusChip> : null}
            </DataToolbar>
          }
          footer={<Pager page={directory.page + 1} total={directory.total} noun={directory.total === 1 ? "contact" : "contacts"} pageSize={directory.pageSize} disabled={directoryLoading} onPage={(next) => void loadDirectory(directory.query, next - 1)} />}
        >
          <div aria-busy={directoryLoading}>
            {directory.rows.length ? (
              <table aria-label="Contact directory" className="portal-lead-table w-full min-w-[980px] text-left text-sm">
                <thead>
                  <tr>
                    <th scope="col">Contact</th>
                    <th scope="col" className="w-[160px]">Phone</th>
                    <th scope="col" className="w-[220px]">Household</th>
                    <th scope="col" className="w-[140px]">Date of birth</th>
                    <th scope="col" className="w-[80px] text-right">Leads</th>
                    <th scope="col" className="w-[190px]">Flag</th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {directory.rows.map((row) => {
                    const open = expanded === row.id;
                    const name = `${row.first_name} ${row.last_name}`;
                    return [
                      <tr key={row.id} className="m-row">
                        <td className="max-w-[260px]">
                          <button type="button" title={name} aria-expanded={open} aria-controls={`contact-detail-${row.id}`} className="block max-w-full cursor-pointer truncate text-left font-semibold text-foreground hover:underline" onClick={() => setExpanded(open ? null : row.id)}>{name}</button>
                          {row.provisional && <ProvisionalBadge className="mt-1" />}
                        </td>
                        <td className="whitespace-nowrap tabular-nums">{formatPhone(row.primary_phone)}</td>
                        <td className="max-w-[220px] truncate" title={row.household_label ?? undefined}>{row.household_label ?? "—"}</td>
                        <td className="whitespace-nowrap tabular-nums">{formatDob(row.dob)}</td>
                        <td className="text-right tabular-nums">{row.lead_count ? row.lead_count.toLocaleString() : "—"}</td>
                        <td>{row.open_review === null ? "—" : row.open_review ? <StatusChip tone="warning" dot>Duplicate suspected</StatusChip> : <StatusChip tone="neutral" dot>No open match</StatusChip>}</td>
                      </tr>,
                      open ? (
                        <tr key={`${row.id}-detail`} id={`contact-detail-${row.id}`}>
                          <td colSpan={6} className="bg-[var(--surface-alt)]">
                            <dl className="m-0 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
                              {[
                                ["Address", [row.address_line1, row.city, row.household_state || row.state, row.postal_code].filter(Boolean).join(", ") || "—"],
                                ["Phones", row.phones.map((item) => formatPhone(item.phone)).join(", ") || "—"],
                                ["Emails", row.emails.map((item) => item.email).join(", ") || "—"],
                                ["Custom fields", customFieldsText(row.custom_fields, schema)],
                              ].map(([label, value]) => (
                                <div key={label} className="min-w-0">
                                  <dt className="text-xs leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">{label}</dt>
                                  <dd className="m-0 mt-0.5 break-words text-sm leading-[1.5] text-[var(--ink)]">{value}</dd>
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
              <EmptyState
                title="No contacts yet"
                hint="Each one is checked for duplicates first."
                action={readOnly ? undefined : <Button type="button" onClick={() => { setFormError(null); setAddOpen(true); }}>Add contact</Button>}
              />
            )}
          </div>
        </TableCard>
      )}

      {tab === "merges" && (
        <TableCard
          className={fillCard}
          footer={merges.length ? <Pager page={mergePageNow} total={merges.length} noun="merges" pageSize={pageSize} onPage={setMergePage} /> : undefined}
        >
          {merges.length ? (
            <table aria-label="Recent merges" className="portal-lead-table w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr>
                  <th scope="col">Kept contact</th>
                  <th scope="col" className="w-[90px]">Source</th>
                  <th scope="col" className="w-[130px]">When</th>
                  <th scope="col" className="w-[160px]">By</th>
                  <th scope="col" className="w-[220px]">Undo</th>
                  <th scope="col" className="w-[100px] text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="m-seq">
                {shownMerges.map((row: RecentMerge) => {
                  const blocker = row.undoable || row.reversedAt ? null : laterMerge(row);
                  return (
                  <tr key={row.id} className="m-row" id={`merge-${row.id}`}>
                    <td className="max-w-[280px] truncate text-foreground" title={`${row.mergedName} merged into ${row.keptName}`}><span className="font-semibold">{row.keptName}</span>{row.mergedName && row.mergedName !== row.keptName && <span className="text-xs text-muted-foreground"> ← {row.mergedName}</span>}</td>
                    <td>{row.source === "auto" ? <StatusChip dot={false} tone="neutral">Auto</StatusChip> : <span className="text-muted-foreground">Manual</span>}</td>
                    <td className="whitespace-nowrap text-muted-foreground">{ago(row.mergedAt)}</td>
                    <td className="max-w-[160px] truncate" title={row.actorName ?? undefined}>{shortName(row.actorName) ?? "—"}</td>
                    <td className="text-muted-foreground">
                      {row.reversedAt ? <StatusChip dot={false} tone="neutral">Undone</StatusChip> : row.undoable ? "Can be undone" : blocker ? (
                        // Name the merge in the way and take the reader to it, instead of a dead end.
                        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
                          <span className="truncate" title={`Undo the later merge into ${blocker.keptName} first`}>Undo {blocker.keptName} ({ago(blocker.mergedAt)}) first</span>
                          <button type="button" className="text-xs font-semibold text-[var(--accent-ink)] hover:underline" onClick={() => showMerge(blocker.id)}>Show it</button>
                        </span>
                      ) : "Undo the later merge first"}
                    </td>
                    <td className="text-right">
                      {!row.reversedAt && (
                        <Button type="button" size="sm" variant="outline" aria-label={`Undo merge into ${row.keptName}`} disabled={writeBlocked || !row.undoable} title={!row.undoable ? "A later merge involves one of these contacts" : undefined} onClick={() => void undo(row.id)}>{busy === `undo:${row.id}` ? "Undoing…" : "Undo"}</Button>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <EmptyState
              title="No merges yet"
              hint="Merges land here and can be undone."
              action={current.total > 0 ? <Button type="button" variant="outline" onClick={() => setTab("review")}>Review pairs</Button> : undefined}
            />
          )}
        </TableCard>
      )}

      {tab === "problems" && listProblems && (
        <section id="list-problems" aria-label="List problems" className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
          <CleanListProblems lists={problemLists} error={problemsError} loading={problemsLoading} access={listProblems} onReload={() => void loadProblems()} />
        </section>
      )}
      </div>


      <Dialog open={fieldsOpen} onOpenChange={(open) => { if (busy !== "field") setFieldsOpen(open); }}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>Custom contact fields</DialogTitle>
            <DialogDescription>Imported from and exported to custom_&lt;key&gt; columns.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveField} className="grid gap-3 sm:grid-cols-[1fr_1fr_160px_auto] sm:items-end">
            <Field label="Key" htmlFor="field-key"><input id="field-key" className={fieldControl} placeholder="preferred_language" value={field.field_key} disabled={readOnly} onChange={(event) => setField((value) => ({ ...value, field_key: event.target.value }))} /></Field>
            <Field label="Label" htmlFor="field-label"><input id="field-label" className={fieldControl} placeholder="Preferred language" value={field.label} disabled={readOnly} onChange={(event) => setField((value) => ({ ...value, label: event.target.value }))} /></Field>
            <Field label="Type" htmlFor="field-type">
              <select id="field-type" className={fieldControl} value={field.type} disabled={readOnly} onChange={(event) => setField((value) => ({ ...value, type: event.target.value }))}>
                <option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="single_select">Single select</option><option value="multi_select">Multi select</option><option value="boolean">Boolean</option><option value="currency">Currency (cents)</option><option value="phone">Phone</option>
              </select>
            </Field>
            <Button type="submit" disabled={readOnly || busy === "field"}>{busy === "field" ? "Saving…" : "Add field"}</Button>
          </form>
          {fieldError && <p role="alert" className="m-0 text-xs leading-[1.5] text-[var(--error-ink)]">{fieldError}</p>}
          <div className="flex flex-wrap gap-2">
            {contactFields.map((item) => <StatusChip dot={false} key={`${item.entity}-${item.field_key}`} tone="neutral">{item.label} · {item.type}</StatusChip>)}
            {!contactFields.length && <span className="text-sm leading-[1.5] text-[var(--muted)]">No custom fields yet.</span>}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={(open) => { if (busy !== "create") setAddOpen(open); }}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Add contact</DialogTitle>
            <DialogDescription>Checked for duplicates before it is saved.</DialogDescription>
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
            {formError && <p role="alert" className="m-0 text-xs leading-[1.5] text-[var(--error-ink)] sm:col-span-2">{formError}</p>}
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

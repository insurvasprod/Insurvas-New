"use client";

/**
 * Settings › Sales process › Disclosures (LA-3.10 + LA-2.23). Reads and writes /api/app/settings/sales/disclosures;
 * `?preview=sample` renders the design fixtures and saves nothing.
 *
 * Settings round 8 (owner pick A, sales-process board "5 · Disclosures", 2026-11-12): one list of documents, one
 * line each (what it is, when it is required, where it applies, its version, one status chip). A document opens
 * as a right sheet with sections — Wording · When required · Call scripts · Versions — never a second row of
 * tabs. What used to be the Needs you, When they are required, Read on the call and Try a case tabs are the status
 * line, the Required when column, the Call scripts sheet and the Try a case sheet.
 *
 * REPLACEMENT_NOTICE and 1035_EXCHANGE are Insurvas platform rows: read-only until copied to the agency. A version
 * is superseded, never overwritten (Draft → Publish): editing a published or retired one saves version N + 1 as a
 * draft, and publishing it retires the one before, so an application acknowledged on version N keeps it. The PDF
 * is private and opens through a short-lived signed link. Owners edit; producers read.
 *
 * Not in the stored model, so not drawn: the step a document is acknowledged on, how the client agrees, and
 * per-document call scripts (call wording is per state and product, maintained by Insurvas).
 */

import { StatusChip } from "@/components/ui/status-chip";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Copy, Plus } from "lucide-react";
import { notify } from "@/lib/notify";

import { ReviewChip } from "@/components/app/settings/defaults";
import { Field, SettingsSectionHeader, control, st } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, confirmAction } from "@/components/ui/confirm-dialog";
import { ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { Sheet } from "@/components/ui/sheet";
import { DISCLOSURES, SALES_CARRIERS } from "@/lib/applications/settingsFixtures";
import { attention as needsYou, callCoverage, docMatches, documents, duplicateCode, searchDocs, versionChanges, wordDiff, type CallProduct, type DocFilter, type LibraryDoc } from "@/lib/salesSettings/disclosureLibrary";
import type { Clause } from "@/lib/salesSettings/editing";
import type { DisclosureInput, DisclosureItem, DisclosureLibrary } from "@/lib/salesSettings/disclosures";
import { US_STATES } from "@/lib/signup/constants";
import { cn } from "@/lib/utils";

import { SheetAnchors, SheetSection, StatusLine, TabFrame, WIDE_SHEET } from "../sales-process/parts";
import { CallWording, callsNeedingWork } from "./disclosures-calls";
import { ScopeFields, WordingFields, ruleSentence, toDraft, toInput, type DisclosureDraft, type PdfUpload } from "./disclosures-editor";
import { TryACase } from "./disclosures-try";
import { LifecyclePill, NOT_SAVED, RowMenu, SalesPanelTop, WithReason, shortDay, useSalesSample, type Lifecycle, type RowMenuItem } from "./shared";

const API = "/api/app/settings/sales/disclosures";

type EditorTab = "wording" | "where" | "versions";
type Confirm = "discard" | "retire" | "publish" | "removePdf" | "deleteDoc";
type AddMode = "blank" | "platform" | "duplicate";

/* ── sample (design fixtures in the API's shape) ────────────────────────── */

function sampleLibrary(): DisclosureLibrary {
  const carrierId = (name: string) => SALES_CARRIERS.find((c) => c.name === name)?.id ?? name;
  return {
    canEdit: true,
    carriers: SALES_CARRIERS.map((c) => ({ id: c.id, name: c.name })),
    interviewFields: [
      { key: "health.existing_coverage", label: "Do you have any life insurance now?", type: "boolean" },
      { key: "health.existing_cash_value", label: "Does that policy have a cash value you plan to move?", type: "boolean" },
    ],
    items: DISCLOSURES.map((d) => ({
      id: d.id, code: d.code, title: d.title, body: d.body, states: d.states, carrierIds: d.carriers.map(carrierId), version: d.version, status: d.status,
      platform: d.platform, hasAttachment: Boolean(d.attachmentName), updatedAt: new Date().toISOString(), acknowledged: 0, createdBy: null,
      rules: d.rules.map((r) => ({ clauses: r.clauses.map((c): Clause => ({ field: c.field, op: c.op, value: c.op === "in" ? c.value.split(",").map((s) => s.trim()) : c.value === "yes" ? true : c.value })) })),
    })),
  };
}

function sampleCalls(): CallProduct[] {
  const rows = US_STATES.map(([state]) => ({ id: state, state, product_code: "term_life", required_text: "[PLACEHOLDER — NOT COMPLIANCE-APPROVED.]\nSample wording.", effective_from: "2026-09-23" }));
  return callCoverage(rows, US_STATES.map(([code]) => code), [], "2026-10-30");
}

/* ── cells ──────────────────────────────────────────────────────────────── */

const listOr = (items: string[], all: string) => (items.length ? items.join(", ") : all);
const apps = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "application" : "applications"}`;

function lifecycleOf(item: DisclosureItem): Lifecycle {
  return item.platform ? "platform" : item.status === "published" ? "live" : item.status === "retired" ? "retired" : "draft";
}

function StatusCell({ doc }: { doc: LibraryDoc }) {
  // One chip a row (round 8): what applies now, or what waits.
  if (doc.draft) return <StatusChip tone="info">{doc.live ? "Draft waiting" : "Draft"}</StatusChip>;
  if (doc.live && !doc.live.platform) return doc.live.rules.length ? <LifecyclePill state="live" /> : <StatusChip tone="warning">Live, no rule</StatusChip>;
  // Insurvas wording is a starting point, never final legal text (docs/settings/DEFAULTS.md §2.5).
  if (doc.shown.platform) return <StatusChip tone="warning">Needs legal review</StatusChip>;
  return <LifecyclePill state="retired" />;
}

async function call(url: string, init: RequestInit = {}) {
  const res = await fetch(url, { cache: "no-store", ...init, headers: init.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "That didn't save. Try again.");
  return data;
}

/** A multipart upload with progress (fetch cannot report it). Resolves with the JSON body. */
function upload(url: string, form: FormData, onProgress: (sent: number) => void, signal: AbortSignal) {
  return new Promise<{ item: DisclosureItem }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      const data = (() => { try { return JSON.parse(xhr.responseText); } catch { return null; } })();
      if (xhr.status >= 200 && xhr.status < 300 && data?.item) resolve(data);
      else reject(new Error(data?.error ?? "The PDF could not be attached. Try again."));
    };
    xhr.onerror = () => reject(new Error("Couldn't reach Insurvas. Check your connection and try again."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    signal.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}

/** The draft read back as a version, for "what this changes". */
function draftAsItem(draft: DisclosureDraft, library: DisclosureLibrary, hasAttachment: boolean) {
  const { input } = toInput(draft, library);
  return { title: input.title, body: input.body, states: input.states, carrierIds: input.carrier_ids, rules: input.rules.map((r) => ({ clauses: r.clauses as Clause[] })), hasAttachment };
}

/** A version as the API's body: the same wording, scope and rules. */
function asInput(item: DisclosureItem, code = item.code, title = item.title, carrierIds?: Set<string>): DisclosureInput {
  return {
    code, title, body: item.body, states: item.states,
    carrier_ids: carrierIds ? item.carrierIds.filter((id) => carrierIds.has(id)) : item.carrierIds,
    rules: item.rules.map((r) => ({ clauses: r.clauses as DisclosureInput["rules"][number]["clauses"] })),
  };
}

/* ── compare ────────────────────────────────────────────────────────────── */

function CompareDialog({ pair, onClose, scope }: { pair: [DisclosureItem, DisclosureItem] | null; onClose: () => void; scope: (item: DisclosureItem) => string }) {
  if (!pair) return null;
  const [older, newer] = pair;
  const parts = wordDiff(older.body, newer.body);
  const label = (v: DisclosureItem) => `v${v.version}${v.platform ? " (Insurvas)" : ""} · ${lifecycleOf(v) === "live" ? "live" : lifecycleOf(v) === "platform" ? "Insurvas" : lifecycleOf(v)}`;
  const column = (v: DisclosureItem, side: "del" | "add") => (
    <div className="m-glass-inset flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border)] p-3">
      <StatusChip dot={false} tone={side === "add" ? "good" : "neutral"}>{label(v)}</StatusChip>
      <p className="m-0 font-semibold text-[var(--ink)]">{v.title}</p>
      <p className="m-0 max-h-[320px] overflow-y-auto whitespace-pre-line text-sm leading-[1.6] text-[var(--ink)]">
        {parts.filter((p) => p.kind === "same" || p.kind === side).map((p, i) => (
          p.kind === "same" ? <span key={i}>{p.text}</span>
            : side === "del" ? <del key={i} className="rounded-sm bg-[var(--error-surface)] px-0.5 text-[var(--ink)]">{p.text}</del>
            : <ins key={i} className="rounded-sm bg-[var(--success-surface)] px-0.5 text-[var(--ink)] no-underline">{p.text}</ins>
        ))}
      </p>
      <p className="m-0 text-xs text-[var(--muted)]">{scope(v)} · {v.rules.length} {v.rules.length === 1 ? "rule" : "rules"}{v.hasAttachment ? " · PDF" : ""}</p>
    </div>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl" className="max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>v{older.version} compared with v{newer.version}</DialogTitle>
          <DialogDescription>Struck through on the left is gone; highlighted on the right is new.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">{column(older, "del")}{column(newer, "add")}</div>
        <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SalesDisclosures({ focus = null }: { focus?: string | null } = {}) {
  const sample = useSalesSample();
  const [library, setLibrary] = useState<DisclosureLibrary | null>(sample ? sampleLibrary() : null);
  const [loading, setLoading] = useState(!sample);
  const [error, setError] = useState<{ text: string; pending: boolean } | null>(null);
  const [calls, setCalls] = useState<CallProduct[] | null>(sample ? sampleCalls() : null);
  const [callsError, setCallsError] = useState<string | null>(null);
  /** A sheet beside the list: Try a case, or the call scripts. */
  const [panel, setPanel] = useState<"try" | "calls" | null>(null);
  const [filter, setFilter] = useState<DocFilter>("all");
  const [query, setQuery] = useState("");
  /** The open version: an id, "new", or null for the list. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [editorTab, setEditorTab] = useState<EditorTab>("wording");
  const [draft, setDraft] = useState<DisclosureDraft | null>(null);
  const [clauseErrors, setClauseErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [adding, setAdding] = useState<{ mode: AddMode; platformCode: string; ownCode: string } | null>(null);
  const [duplicating, setDuplicating] = useState<{ source: DisclosureItem; code: string; title: string } | null>(null);
  const [comparing, setComparing] = useState<[DisclosureItem, DisclosureItem] | null>(null);
  /** Ctrl/Cmd+S: what saving means right now, or null when there is nothing to save. */
  const saveShortcut = useRef<(() => void) | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && saveShortcut.current) {
        e.preventDefault();
        saveShortcut.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(API, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) setError({ text: data?.error ?? "Disclosures could not be loaded.", pending: Boolean(data?.schemaPending) });
      else {
        setLibrary(data as DisclosureLibrary);
        setError(null);
      }
    } catch {
      setError({ text: "Couldn't reach Insurvas. Check your connection and try again.", pending: false });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCalls = useCallback(async () => {
    setCallsError(null);
    try {
      const data = await call(`${API}/calls`);
      setCalls(data.products as CallProduct[]);
    } catch (e) {
      setCallsError(e instanceof Error ? e.message : "The call wording could not be loaded.");
    }
  }, []);

  useEffect(() => {
    if (sample) return;
    const t = window.setTimeout(() => { load(); loadCalls(); }, 0);
    return () => window.clearTimeout(t);
  }, [load, loadCalls, sample]);

  const docs = useMemo(() => documents(library?.items ?? []), [library]);
  const shownDocs = useMemo(() => searchDocs(docs, query).filter((d) => docMatches(d, filter)), [docs, query, filter]);
  const needs = useMemo(() => needsYou(docs), [docs]);
  const open = openId && openId !== "new" ? library?.items.find((i) => i.id === openId) ?? null : null;
  const openDoc = open ? docs.find((d) => d.code === open.code) ?? null : null;
  const callsOpen = callsNeedingWork(calls);

  // Kept current after every render, so the shortcut saves exactly what Save draft would.
  useEffect(() => {
    saveShortcut.current = null;
    if (!library || !draft || !openId || busy) return;
    const readOnly = !library.canEdit || Boolean(open?.platform) || open?.status === "retired";
    const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(open, library));
    if (readOnly || (!dirty && open !== null)) return;
    saveShortcut.current = () => { saveDraft(false); };
  });
  const platformDocs = docs.filter((d) => d.platform);
  const ownDocs = docs.filter((d) => d.own.length > 0);

  function openItem(item: DisclosureItem | null, where: EditorTab = "wording") {
    if (!library) return;
    setOpenId(item ? item.id : "new");
    setDraft(toDraft(item, library));
    setEditorTab(where);
    setClauseErrors({});
    setSaveError(null);
  }

  function close() {
    setOpenId(null);
    setDraft(null);
    setSaveError(null);
  }

  /** Put the server's version in the library and keep it open. */
  function accept(item: DisclosureItem, message: string, detail?: string) {
    setLibrary((lib) => (lib ? { ...lib, items: [item, ...lib.items.filter((i) => i.id !== item.id)] } : lib));
    notify.done(message, detail ? { detail } : undefined);
    setOpenId(item.id);
    if (library) setDraft(toDraft(item, library));
    setClauseErrors({});
    setSaveError(null);
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setSaveError(null);
    try {
      await fn();
    } catch (e) {
      // What was typed stays on screen.
      setSaveError(e instanceof Error ? e.message : "That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function prepared(): DisclosureInput | null {
    if (!draft || !library) return null;
    const { input, clauseErrors: errs, error: problem } = toInput(draft, library);
    setClauseErrors(errs);
    if (problem) {
      setSaveError(problem);
      if (Object.keys(errs).length) setEditorTab("where");
      return null;
    }
    return input;
  }

  async function saveDraft(publish: boolean) {
    const input = prepared();
    if (!input) return;
    if (sample) return notify.done(NOT_SAVED);
    await run(async () => {
      const wasPublished = open && open.status !== "draft";
      let item: DisclosureItem = open === null
        ? (await call(API, { method: "POST", body: JSON.stringify(input) })).item
        : (await call(`${API}/${open.id}`, { method: "PUT", body: JSON.stringify(input) })).item;
      if (publish) {
        item = (await call(`${API}/${item.id}/publish`, { method: "POST" })).item;
        await load();
        accept(item, `${item.code} v${item.version} published`, "The version before it is kept for applications that acknowledged it.");
        return;
      }
      accept(item, wasPublished ? `Draft v${item.version} started` : `Draft v${item.version} saved`);
    });
  }

  async function publishOpen() {
    if (!open) return;
    if (sample) return notify.done(NOT_SAVED);
    await run(async () => {
      const item = (await call(`${API}/${open.id}/publish`, { method: "POST" })).item as DisclosureItem;
      await load();
      accept(item, `${item.code} v${item.version} published`, "The version before it is kept for applications that acknowledged it.");
    });
  }

  async function copyToAgency(item: DisclosureItem) {
    if (sample) return notify.done(NOT_SAVED);
    await run(async () => {
      const copy = (await call(`${API}/${item.id}/copy`, { method: "POST" })).item as DisclosureItem;
      accept(copy, `${copy.code} copied as draft v${copy.version}`, "It applies once you publish it. The Insurvas version is untouched.");
    });
  }

  /** An old (published or retired) version's content as a new draft: the server numbers it N + 1. */
  async function draftFrom(item: DisclosureItem) {
    if (sample) return notify.done(NOT_SAVED);
    if (item.platform) return copyToAgency(item);
    await run(async () => {
      const next = (await call(`${API}/${item.id}`, { method: "PUT", body: JSON.stringify(asInput(item, item.code, item.title, new Set([...(library?.carriers ?? []).map((c) => c.id), ...item.carrierIds]))) })).item as DisclosureItem;
      accept(next, `Draft v${next.version} started from v${item.version}`, "Check it, then publish it to use it.");
    });
  }

  async function duplicate() {
    if (!duplicating || !library) return;
    const { source, code, title } = duplicating;
    if (!/^[A-Z0-9][A-Z0-9_]{1,63}$/.test(code)) return notify.block("Give it a code in capital letters, digits and _.");
    if (docs.some((d) => d.code === code)) return notify.block(`${code} is already taken. Pick another code.`);
    if (!title.trim()) return notify.block("Give the copy a title.");
    setDuplicating(null);
    if (sample) return notify.done(NOT_SAVED);
    await run(async () => {
      const item = (await call(API, { method: "POST", body: JSON.stringify(asInput(source, code, title.trim(), new Set(library.carriers.map((c) => c.id)))) })).item as DisclosureItem;
      accept(item, `Duplicated as ${item.code}, draft v${item.version}`, source.hasAttachment ? "The PDF is not copied; attach it to the new draft." : undefined);
    });
  }

  function startDuplicate(source: DisclosureItem) {
    setDuplicating({ source, code: duplicateCode(source.code, docs.map((d) => d.code)), title: `${source.title} (copy)` });
  }

  function continueAdd() {
    if (!adding) return;
    const { mode, platformCode, ownCode } = adding;
    setAdding(null);
    if (mode === "blank") return openItem(null);
    if (mode === "platform") {
      const doc = docs.find((d) => d.code === platformCode);
      if (doc?.draft) return openItem(doc.draft);
      if (doc?.platform) copyToAgency(doc.platform);
      return;
    }
    const doc = docs.find((d) => d.code === ownCode);
    if (doc) startDuplicate(doc.draft ?? doc.live ?? doc.shown);
  }

  async function discard() {
    if (!open) return;
    setConfirm(null);
    if (sample) return notify.done(NOT_SAVED);
    await run(async () => {
      await call(`${API}/${open.id}`, { method: "DELETE" });
      setLibrary((lib) => (lib ? { ...lib, items: lib.items.filter((i) => i.id !== open.id) } : lib));
      notify.done(`Draft v${open.version} deleted`);
      close();
    });
  }

  async function retireOpen() {
    if (!open) return;
    setConfirm(null);
    if (sample) return notify.done(NOT_SAVED);
    await run(async () => {
      const item = (await call(`${API}/${open.id}`, { method: "PATCH", body: JSON.stringify({ status: "retired" }) })).item as DisclosureItem;
      await load();
      accept(item, `${item.code} v${item.version} retired`, "New applications stop attaching it. Applications that acknowledged it keep it.");
    });
  }

  const uploadPdf: PdfUpload = async (file, onProgress, signal) => {
    if (!open) return;
    if (sample) { notify.done(NOT_SAVED); return; }
    const form = new FormData();
    form.set("file", file);
    const { item } = await upload(`${API}/${open.id}/attachment`, form, onProgress, signal);
    setLibrary((lib) => (lib ? { ...lib, items: lib.items.map((i) => (i.id === item.id ? item : i)) } : lib));
    notify.done(open.hasAttachment ? "PDF replaced" : "PDF attached");
  };

  async function removePdf() {
    if (!open) return;
    setConfirm(null);
    if (sample) return notify.done(NOT_SAVED);
    await run(async () => {
      const item = (await call(`${API}/${open.id}/attachment`, { method: "DELETE" })).item as DisclosureItem;
      setLibrary((lib) => (lib ? { ...lib, items: lib.items.map((i) => (i.id === item.id ? item : i)) } : lib));
      notify.done("PDF removed");
    });
  }

  async function openPdf(item: DisclosureItem | null = open) {
    if (!item) return;
    if (sample) return notify.done("Sample data — there is no file to open.");
    try {
      const data = await call(`${API}/${item.id}/attachment`);
      window.open(data.url as string, "_blank", "noopener,noreferrer");
    } catch (e) {
      notify.block(e instanceof Error ? e.message : "The PDF could not be opened.");
    }
  }

  /** Opens a version and asks to retire, delete or publish it, from the list. */
  function openAndAsk(item: DisclosureItem, what: Confirm) {
    openItem(item);
    setConfirm(what);
  }

  const canEdit = Boolean(library?.canEdit);
  const carrierName = (id: string) => library?.carriers.find((c) => c.id === id)?.name ?? "Former carrier";
  const scopeLine = (item: Pick<DisclosureItem, "states" | "carrierIds">) => `${listOr(item.states, "Every state")} · ${item.carrierIds.length ? item.carrierIds.map(carrierName).join(", ") : "every carrier"}`;

  /** Applications that acknowledged any version of it: a document they carry can't be deleted, only retired. */
  const carried = (d: LibraryDoc) => d.own.reduce((n, v) => n + v.acknowledged, 0);
  const inUse = (d: LibraryDoc) => `${apps(carried(d))} carry it, so it can't be deleted. Retire it instead.`;

  async function deleteDocument() {
    if (!open) return;
    setConfirm(null);
    if (sample) return notify.done(NOT_SAVED);
    await run(async () => {
      await call(`${API}/${open.id}?document=1`, { method: "DELETE" });
      setLibrary((lib) => (lib ? { ...lib, items: lib.items.filter((i) => i.platform || i.code !== open.code) } : lib));
      notify.done(`${open.title} deleted`, { detail: library?.items.some((i) => i.platform && i.code === open.code) ? "The Insurvas version of it applies again." : undefined });
      close();
    });
  }

  /** The ⋯ menu of a document row: everything the row's one button does not. */
  function rowMenu(d: LibraryDoc): Array<RowMenuItem | false | null> {
    const ownLive = d.live && !d.live.platform ? d.live : null;
    const latestOld = !d.live && !d.draft ? d.own[0] ?? null : null;
    return [
      canEdit && d.draft && { label: `Publish v${d.draft.version}`, onSelect: () => openAndAsk(d.draft!, "publish"), disabled: busy },
      d.shown.platform && canEdit && { label: "Copy to my agency", onSelect: () => copyToAgency(d.shown), disabled: busy || Boolean(d.draft), reason: d.draft ? `You already have draft v${d.draft.version}.` : null },
      canEdit && latestOld && { label: `Start a draft from v${latestOld.version}`, onSelect: () => draftFrom(latestOld), disabled: busy },
      canEdit && { label: "Duplicate as a new document", onSelect: () => startDuplicate(d.draft ?? d.live ?? d.shown), disabled: busy },
      d.versions.length > 0 && { label: "Versions", onSelect: () => openItem(d.draft ?? d.live ?? d.shown, "versions") },
      d.live && { label: "Try it on a case", onSelect: () => setPanel("try") },
      (d.live ?? d.shown).hasAttachment && { label: "Open its PDF", onSelect: () => openPdf(d.live ?? d.shown) },
      // With an Insurvas version of the same code behind it, retiring is the way back to the default.
      canEdit && ownLive && { label: d.platform ? "Reset to default…" : `Retire v${ownLive.version}…`, onSelect: () => openAndAsk(ownLive, "retire"), danger: true, disabled: busy },
      canEdit && d.draft && d.own.length > 1 && { label: `Delete draft v${d.draft.version}…`, onSelect: () => openAndAsk(d.draft!, "discard"), danger: true, disabled: busy },
      canEdit && d.own.length > 0 && { label: "Delete document…", onSelect: () => openAndAsk(d.own[0], "deleteDoc"), danger: true, disabled: busy || carried(d) > 0, reason: carried(d) > 0 ? inUse(d) : null },
    ];
  }

  const dialogs = library && (
    <>
      <Dialog open={adding !== null} onOpenChange={(o) => !o && setAdding(null)}>
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>Add a document</DialogTitle>
            <DialogDescription>It starts as a draft and applies to nothing until you publish it.</DialogDescription>
          </DialogHeader>
          {adding && (
            <div role="radiogroup" aria-label="How to start" className="flex flex-col gap-2">
              {([
                ["blank", "Start blank", "Write the wording and its rules yourself."],
                ["platform", "Start from an Insurvas document", "Copies its wording, rules and PDF. The Insurvas one stays as it is."],
                ["duplicate", "Duplicate one of yours", "A new document with its own code; the original is untouched."],
              ] as const).map(([mode, title, hint]) => {
                const on = adding.mode === mode;
                const off = (mode === "platform" && !platformDocs.length) || (mode === "duplicate" && !ownDocs.length);
                return (
                  <div key={mode} className={cn("flex flex-col gap-2 rounded-lg border p-3 transition-colors duration-150", on ? "border-[var(--primary)] bg-[var(--surface-alt)]" : "border-[var(--border)]", off && "opacity-60")}>
                    <label className="flex cursor-pointer items-start gap-3">
                      <input type="radio" name="add-mode" className="mt-1 size-4 accent-[var(--brand-500)]" checked={on} disabled={off} onChange={() => setAdding({ ...adding, mode })} />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-[var(--ink)]">{title}</span>
                        <span className="block text-xs leading-[1.5] text-[var(--muted)]">{off ? "Nothing to start from yet." : hint}</span>
                      </span>
                    </label>
                    {on && mode === "platform" && (
                      <select aria-label="Insurvas document" className={cn(control, "mt-0")} value={adding.platformCode} onChange={(e) => setAdding({ ...adding, platformCode: e.target.value })}>
                        {platformDocs.map((d) => <option key={d.code} value={d.code}>{d.platform!.title}{d.draft ? ` — you have draft v${d.draft.version}` : ""}</option>)}
                      </select>
                    )}
                    {on && mode === "duplicate" && (
                      <select aria-label="Your document" className={cn(control, "mt-0")} value={adding.ownCode} onChange={(e) => setAdding({ ...adding, ownCode: e.target.value })}>
                        {ownDocs.map((d) => <option key={d.code} value={d.code}>{d.own[0].title}</option>)}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAdding(null)}>Cancel</Button>
            <Button type="button" disabled={busy} onClick={continueAdd}>Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={duplicating !== null} onOpenChange={(o) => !o && setDuplicating(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Duplicate {duplicating?.source.title}</DialogTitle>
            <DialogDescription>A new draft with the same wording, states, carriers and rules, under its own code.</DialogDescription>
          </DialogHeader>
          {duplicating && (
            <div className="flex flex-col gap-4">
              <Field label="Code" htmlFor="dup-code" required hint="Capital letters, digits and _.">
                <input id="dup-code" className={cn(control, "font-mono uppercase")} value={duplicating.code} spellCheck={false} onChange={(e) => setDuplicating({ ...duplicating, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") })} />
              </Field>
              <Field label="Title" htmlFor="dup-title" required>
                <input id="dup-title" className={control} value={duplicating.title} onChange={(e) => setDuplicating({ ...duplicating, title: e.target.value })} />
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDuplicating(null)}>Cancel</Button>
            <Button type="button" disabled={busy} onClick={duplicate}>Duplicate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CompareDialog pair={comparing} onClose={() => setComparing(null)} scope={scopeLine} />
    </>
  );

  // A link names a document ("doc.<code>"): open it once the library is here.
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (!library || !focus?.startsWith("doc.") || focused.current === focus) return;
    focused.current = focus;
    const doc = docs.find((d) => d.code === focus.slice(4));
    if (!doc) return;
    const t = window.setTimeout(() => openItem(doc.draft && library.canEdit ? doc.draft : doc.shown), 0);
    return () => window.clearTimeout(t);
    // openItem reads the same state; it is rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, focus]);

  // The sheet opens on the section asked for (a rule to add opens on When required).
  useEffect(() => {
    if (!openId) return;
    const id = editorTab === "where" ? "dc-when" : editorTab === "versions" ? "dc-versions" : null;
    if (!id) return;
    const t = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 120);
    return () => window.clearTimeout(t);
  }, [openId, editorTab]);

  /* ── the document's sheet ── */
  let sheet: ReactNode = null;
  if (library && draft && openId) {
    const readOnly = !canEdit || Boolean(open?.platform) || open?.status === "retired";
    const baseline = toDraft(open, library);
    const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
    const isDraft = open === null || open.status === "draft";
    const next = open ? (open.status === "draft" ? open.version : Math.max(...library.items.filter((i) => i.code === open.code).map((i) => i.version)) + 1) : null;
    const leave = async () => {
      if (dirty && !readOnly && !(await confirmAction({
        title: "Leave without saving?",
        description: `${open?.title || draft.title.trim() || "This document"} has changes that are not saved.`,
        confirmLabel: "Discard changes",
        cancelLabel: "Keep editing",
      }))) return;
      close();
    };
    const state: Lifecycle | null = open === null ? null : lifecycleOf(open);
    const revert = () => { setDraft(baseline); setClauseErrors({}); setSaveError(null); };
    const live = openDoc?.live && openDoc.live.id !== open?.id ? openDoc.live : open?.status === "published" ? open : null;
    const changes = live && !readOnly && (isDraft || dirty) ? versionChanges(live, draftAsItem(draft, library, Boolean(open?.hasAttachment))) : null;
    const versions = openDoc?.versions ?? [];
    const previewRules = toInput(draft, library).input.rules.filter((r) => r.clauses.every((c) => c.value !== ""));
    const publishLabel = `Publish v${next ?? 1}`;
    const needed = [!/^[A-Z0-9][A-Z0-9_]{1,63}$/.test(draft.code) && "a code", !draft.title.trim() && "a title", !draft.body.trim() && "the wording"].filter(Boolean) as string[];
    const neededReason = needed.length ? `Give it ${needed.join(", ").replace(/, ([^,]*)$/, " and $1")} first.` : null;
    const retiring = openDoc?.live && !openDoc.live.platform && openDoc.live.id !== open?.id ? openDoc.live : null;
    const older = open && openDoc && open.status === "retired" ? open : null;
    const draftBlock = openDoc?.draft ? `Draft v${openDoc.draft.version} already exists. Open it, or delete it first.` : null;
    const openVersion = (v: DisclosureItem) => (dirty && !readOnly ? leave().then(() => openItem(v, "versions")) : openItem(v, "versions"));
    const subtitle = !open ? "New document · applies to nothing until you publish it"
      : open.status === "published" ? `v${open.version} live · ${apps(open.acknowledged)} acknowledged it`
      : open.status === "retired" ? `v${open.version} retired · kept for the ${apps(open.acknowledged)} that acknowledged it`
      : open.platform ? `Insurvas v${open.version} · read-only until copied to your agency`
      : `v${open.version} draft${live ? ` · v${live.version}${live.platform ? " (Insurvas)" : ""} stays in use until you publish` : " · applies to nothing until you publish it"}`;

    sheet = (
      <Sheet
        title={draft.title.trim() || (open ? open.title : "New document")}
        subtitle={subtitle}
        status={<><LifecyclePill state={state ?? "draft"} />{open?.platform && <ReviewChip />}</>}
        actions={canEdit && open ? (
          <RowMenu
            label={open.title}
            items={[
              live && open.id !== live.id && { label: `Compare with live v${live.version}`, onSelect: () => setComparing(open.version < live.version ? [open, live] : [live, open]) },
              (open.hasAttachment) && { label: "Open its PDF", onSelect: () => openPdf(open) },
              state === "live" && { label: `Retire v${open.version}…`, onSelect: () => setConfirm("retire"), disabled: busy || dirty, reason: dirty ? "Save or discard your changes first." : null, danger: true },
              openDoc && openDoc.own.length > 0 && !open.platform && { label: "Delete document…", onSelect: () => setConfirm("deleteDoc"), disabled: busy || carried(openDoc) > 0, reason: carried(openDoc) > 0 ? inUse(openDoc) : null, danger: true },
            ]}
          />
        ) : undefined}
        onClose={() => { void leave(); }}
        className={WIDE_SHEET}
        footer={
          readOnly ? (
            <span className="flex w-full flex-wrap items-center gap-2">
              {older && live && <Button type="button" variant="outline" onClick={() => setComparing([older, live])}>Compare with live v{live.version}</Button>}
              <span className="ml-auto flex gap-2">
                {open?.platform && canEdit && (
                  <WithReason reason={draftBlock}><Button type="button" disabled={busy || Boolean(openDoc?.draft)} onClick={() => copyToAgency(open)}><Copy aria-hidden="true" />Copy to my agency</Button></WithReason>
                )}
                {older && canEdit && (
                  <WithReason reason={draftBlock}><Button type="button" disabled={busy || Boolean(draftBlock)} onClick={() => draftFrom(older)}>Start a draft from this version</Button></WithReason>
                )}
                {!canEdit && <Button type="button" variant="outline" onClick={close}>Close</Button>}
              </span>
            </span>
          ) : isDraft ? (
            <span className="flex w-full flex-wrap items-center gap-2">
              {open && <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirm("discard")} className="text-[var(--error-ink)]">Delete draft</Button>}
              <span className="ml-auto flex gap-2">
                {dirty && open && <Button type="button" variant="ghost" disabled={busy} onClick={revert}>Discard</Button>}
                <WithReason reason={!dirty && open !== null ? "No changes to save." : neededReason}>
                  <Button type="button" variant="outline" disabled={busy || (!dirty && open !== null) || Boolean(neededReason)} onClick={() => saveDraft(false)}>Save draft</Button>
                </WithReason>
                <WithReason reason={neededReason}>
                  <Button type="button" disabled={busy || Boolean(neededReason)} onClick={() => { if (prepared()) setConfirm("publish"); }}>{open?.platform === false && live?.platform ? `Mark reviewed & ${publishLabel.toLowerCase()}` : publishLabel}</Button>
                </WithReason>
              </span>
            </span>
          ) : (
            <span className="flex w-full flex-wrap items-center justify-end gap-2">
              {dirty ? (
                <>
                  <Button type="button" variant="ghost" disabled={busy} onClick={revert}>Discard</Button>
                  <Button type="button" disabled={busy} onClick={() => saveDraft(false)}>Save as draft v{next}</Button>
                </>
              ) : <span className="text-sm text-[var(--muted)]">A change starts draft v{next}; v{open?.version} stays live until you publish it.</span>}
            </span>
          )
        }
      >
        <SheetAnchors items={[{ id: "dc-wording", label: "Wording" }, { id: "dc-when", label: "When required" }, { id: "dc-scripts", label: "Call scripts" }, { id: "dc-versions", label: "Versions" }]} />
        {saveError && <StatusLine tone="bad">{saveError}</StatusLine>}
        {neededReason && !readOnly && dirty && <StatusLine tone="warn">To save it, {neededReason.charAt(0).toLowerCase()}{neededReason.slice(1)}</StatusLine>}
        <SheetSection id="dc-wording" title="Wording" sub="The text the client receives and agrees to, as the agent reads or sends it.">
          <WordingFields bare item={open} draft={draft} setDraft={setDraft} readOnly={readOnly} onUpload={uploadPdf} onOpenPdf={() => openPdf()} onRemovePdf={() => setConfirm("removePdf")} busy={busy} />
        </SheetSection>
        <SheetSection id="dc-when" title="When required" sub={previewRules.length ? `Required when ${previewRules.map((r) => ruleSentence(r.clauses as Clause[], library)).join(", or when ")}.` : "No rule means never required."}>
          <ScopeFields bare draft={draft} setDraft={setDraft} library={library} readOnly={readOnly} clauseErrors={clauseErrors} />
        </SheetSection>
        <SheetSection id="dc-scripts" title="Call scripts" sub="What the agent reads aloud before pressing Call, by state and product. Insurvas compliance maintains it.">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-[var(--body)]">{callsOpen ? `${callsOpen} ${callsOpen === 1 ? "state is" : "states are"} not compliance-approved yet.` : calls ? "Every state's wording is approved." : "Read on the call, per state."}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => setPanel("calls")}>Open scripts</Button>
          </div>
        </SheetSection>
        <SheetSection id="dc-versions" title="Versions" sub={changes ? (changes.length ? `This draft changes ${changes.join(", ").toLowerCase()} from v${live!.version}.` : `Nothing changed from v${live!.version} yet.`) : "A version is never overwritten: applications keep the version they acknowledged."}>
          {versions.length === 0 ? (
            <p className="m-0 text-sm text-[var(--muted)]">Not saved yet. Save the draft and it becomes version 1.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {versions.map((v) => (
                <li key={v.id} className={cn("flex flex-wrap items-center gap-2 border-t border-[var(--border)] py-2 first:border-t-0", v.id === open?.id && "font-semibold")}>
                  <LifecyclePill state={lifecycleOf(v)} />
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--body)]">v{v.version}{v.platform ? " (Insurvas)" : ""} · {shortDay(v.updatedAt)}{v.createdBy ? ` · ${v.createdBy}` : ""}{v.status === "draft" ? "" : ` · ${apps(v.acknowledged)}`}{v.id === open?.id ? " · open" : ""}</span>
                  {v.id !== open?.id && <Button type="button" variant="ghost" size="sm" onClick={() => { void openVersion(v); }}>Open</Button>}
                  {live && v.id !== live.id && <Button type="button" variant="ghost" size="sm" onClick={() => setComparing(v.version < live.version ? [v, live] : [live, v])}>Compare</Button>}
                  {canEdit && v.status === "retired" && !v.platform && <Button type="button" variant="ghost" size="sm" disabled={busy || Boolean(draftBlock)} title={draftBlock ?? undefined} onClick={() => draftFrom(v)}>Start a draft</Button>}
                </li>
              ))}
            </ul>
          )}
        </SheetSection>

        <LeaveGuard dirty={dirty && !readOnly} onDiscard={revert} what={open?.title || "this document"} />
        <ConfirmDialog
          open={confirm === "publish"}
          onOpenChange={(o) => setConfirm(o ? "publish" : null)}
          destructive={false}
          busy={busy}
          title={`Publish ${draft.title.trim() || draft.code} v${next ?? 1}?`}
          description={[
            "New applications attach this version from now on.",
            retiring ? `v${retiring.version} is retired; the ${apps(retiring.acknowledged)} that acknowledged it keep it.` : live?.platform ? `It replaces the Insurvas v${live.version} for your agency.` : "",
            previewRules.length ? "" : "It has no rule yet, so nothing will require it.",
          ].filter(Boolean).join(" ")}
          confirmLabel={publishLabel}
          cancelLabel="Not yet"
          onConfirm={() => { setConfirm(null); if (dirty || open === null) saveDraft(true); else publishOpen(); }}
        >
          {`Applies in ${scopeLine({ states: toInput(draft, library).input.states, carrierIds: draft.carrierIds })} · ${previewRules.length} ${previewRules.length === 1 ? "rule" : "rules"}`}
        </ConfirmDialog>
        <ConfirmDialog
          open={confirm === "retire"}
          onOpenChange={(o) => setConfirm(o ? "retire" : null)}
          busy={busy}
          title={`Retire ${open?.title ?? ""} v${open?.version ?? ""}?`}
          description={`New applications stop attaching it. The ${apps(open?.acknowledged ?? 0)} that acknowledged it keep it. The retired version is kept for good.`}
          confirmLabel={`Retire v${open?.version ?? ""}`}
          cancelLabel="Keep it"
          onConfirm={retireOpen}
        >
          {library.items.some((i) => i.platform && i.code === open?.code) ? "The Insurvas version of this document applies again." : "No Insurvas version of this code, so nothing replaces it."}
        </ConfirmDialog>
        <ConfirmDialog
          open={confirm === "discard"}
          onOpenChange={(o) => setConfirm(o ? "discard" : null)}
          busy={busy}
          title={`Delete draft v${open?.version ?? ""}?`}
          description={`The draft and its PDF are removed.${live ? ` v${live.version} stays in use.` : ""}`}
          confirmLabel="Delete draft"
          cancelLabel="Keep it"
          onConfirm={discard}
        />
        <ConfirmDialog
          open={confirm === "deleteDoc"}
          onOpenChange={(o) => setConfirm(o ? "deleteDoc" : null)}
          busy={busy}
          title={`Delete ${open?.title ?? "this document"}?`}
          description={`Every version of ${open?.code ?? "it"} is deleted for good, with its rules and PDF. This can't be undone.`}
          confirmLabel="Delete document"
          cancelLabel="Keep it"
          onConfirm={deleteDocument}
        >
          {openDoc ? `${openDoc.own.length} ${openDoc.own.length === 1 ? "version" : "versions"}: ${openDoc.own.map((v) => `v${v.version} ${lifecycleOf(v) === "live" ? "live" : lifecycleOf(v)}`).join(", ")}${openDoc.platform ? " · the Insurvas version applies again" : ""}` : ""}
        </ConfirmDialog>
        <ConfirmDialog
          open={confirm === "removePdf"}
          onOpenChange={(o) => setConfirm(o ? "removePdf" : null)}
          busy={busy}
          title={`Remove the PDF from draft v${open?.version ?? ""}?`}
          description={`It comes off this draft only.${live?.hasAttachment ? ` v${live.version} keeps its own PDF.` : ""}`}
          confirmLabel="Remove PDF"
          cancelLabel="Keep it"
          onConfirm={removePdf}
        />
      </Sheet>
    );
  }

  /* ── the list ── */
  const addReason = canEdit ? null : "Only an owner can add a document.";
  const startAdding = () => setAdding({ mode: "blank", platformCode: platformDocs[0]?.code ?? "", ownCode: ownDocs[0]?.code ?? "" });
  const liveCount = docs.filter((d) => d.live).length;
  const statusParts = [
    `${docs.length} ${docs.length === 1 ? "document" : "documents"}`,
    `${liveCount} live`,
    needs.drafts.length ? `${needs.drafts.length} ${needs.drafts.length === 1 ? "draft waits" : "drafts wait"} to be reviewed and published` : null,
    needs.noRule.length ? `${needs.noRule.length} live with no rule, so never required` : null,
    callsOpen ? `call wording for ${callsOpen} ${callsOpen === 1 ? "state" : "states"} not approved yet` : null,
  ].filter(Boolean);
  const attention = needs.drafts.length + needs.noRule.length + (callsOpen ? 1 : 0);

  return (
    <TabFrame>
      <SettingsSectionHeader
        actions={library && (
          <>
            <Button type="button" variant="outline" onClick={() => setPanel("calls")}>Call scripts</Button>
            <Button type="button" variant="outline" onClick={() => setPanel("try")}>Try a case</Button>
            <WithReason reason={addReason}>
              <Button type="button" disabled={!canEdit} onClick={startAdding}><Plus aria-hidden="true" />Add a document</Button>
            </WithReason>
          </>
        )}
      />
      <SalesPanelTop sample={sample} />
      {loading && !library ? <StatusLine tone="muted">Reading your disclosures</StatusLine>
        : error ? (error.pending
          ? <StatusLine tone="warn">The disclosure library needs a database update. Ask your Insurvas admin to apply the latest migrations.</StatusLine>
          : <StatusLine tone="bad" action={<Button type="button" variant="outline" size="sm" onClick={load}>Try again</Button>}>{error.text}</StatusLine>)
        : <StatusLine tone={attention ? "warn" : "ok"}>{statusParts.join(" · ")}{!canEdit ? " · read only: only an owner changes disclosures" : ""}</StatusLine>}

      <PagedTableCard
        className="min-h-0 flex-1"
        total={shownDocs.length}
        noun="documents"
        toolbar={library && docs.length > 0 ? (
          <>
            <ToolbarSearch value={query} onChange={setQuery} placeholder="Search title or wording" />
            <select aria-label="Show" className={toolbarControl} value={filter} onChange={(e) => setFilter(e.target.value as DocFilter)}>
              <option value="all">All · {docs.length}</option>
              <option value="live">Live · {docs.filter((d) => docMatches(d, "live")).length}</option>
              <option value="draft">Drafts · {needs.drafts.length}</option>
              <option value="platform">Insurvas · {docs.filter((d) => docMatches(d, "platform")).length}</option>
              <option value="retired">Retired · {docs.filter((d) => docMatches(d, "retired")).length}</option>
            </select>
          </>
        ) : undefined}
      >
        {!library ? <SectionLoading rows={7} columns={5} label="Loading disclosures" /> : docs.length === 0 ? (
          <EmptyState
            title="No disclosures yet"
            hint="Add the documents an application must carry, and the rules that decide which ones."
            action={canEdit ? <Button type="button" onClick={startAdding}><Plus aria-hidden="true" />Add a document</Button> : undefined}
          />
        ) : shownDocs.length === 0 ? (
          <EmptyState
            title={query.trim() ? `No document matches "${query.trim()}"` : "No document here"}
            hint={filter === "retired" ? "Nothing has been retired." : "Retired documents are under Retired."}
            action={<Button type="button" variant="outline" onClick={() => { setQuery(""); setFilter("all"); }}>Clear search</Button>}
          />
        ) : (
          <table className={cn(st.table, "min-w-[760px]")}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={cn(st.th, "min-w-[220px]")}>Document</th>
                <th scope="col" className={st.th}>Required when</th>
                <th scope="col" className={cn(st.th, "w-[170px]")}>Applies to</th>
                <th scope="col" className={cn(st.th, "w-[110px]")}>Version</th>
                <th scope="col" className={cn(st.th, "w-[170px]")}>Status</th>
                <th scope="col" className={cn(st.th, "w-[1%]")}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <PagedBody className="m-seq">
              {shownDocs.map((d) => {
                const ref = d.live ?? d.shown;
                const rules = ref.rules;
                return (
                  // One line a row: the row opens the document; the menu keeps its own click.
                  <tr key={d.code} className="m-row cursor-pointer" onClick={(e) => { if (!(e.target as HTMLElement).closest("button, a, [role=menu], [role=menuitem]")) openItem(d.draft && canEdit ? d.draft : d.shown); }}>
                    <td className={cn(st.td, "max-w-[320px] truncate font-semibold text-[var(--ink)]")} title={d.shown.title}>{d.shown.title}{d.shown.hasAttachment ? " · PDF" : ""}</td>
                    <td className={cn(st.td, "max-w-[360px] truncate")} title={rules.map((r) => ruleSentence(r.clauses, library)).join(" · or ")}>
                      {rules.length === 0 ? (d.live ? "Never: no rule" : "No rule") : rules.map((r) => ruleSentence(r.clauses, library)).join(" · or ")}
                    </td>
                    <td className={cn(st.td, "max-w-[200px] truncate")} title={scopeLine(ref)}>{scopeLine(ref)}</td>
                    <td className={cn(st.td, "whitespace-nowrap tabular-nums")}>v{ref.version}{d.draft && d.draft.id !== ref.id ? ` · v${d.draft.version} draft` : ""}</td>
                    <td className={cn(st.td, "whitespace-nowrap")}><StatusCell doc={d} /></td>
                    <td className={cn(st.td, "whitespace-nowrap text-right")}><RowMenu label={d.shown.title} items={rowMenu(d)} /></td>
                  </tr>
                );
              })}
            </PagedBody>
          </table>
        )}
      </PagedTableCard>

      {sheet}
      {panel === "try" && library && (
        <Sheet title="Try a case" subtitle="Answer as a client would; see which documents the application would carry. Nothing is saved." onClose={() => setPanel(null)} className={WIDE_SHEET}>
          <TryACase docs={docs} library={library} onOpen={(item) => { setPanel(null); openItem(item, "where"); }} />
        </Sheet>
      )}
      {panel === "calls" && (
        <Sheet title="Read on the call · by state" subtitle="The wording an agent reads before pressing Call. Insurvas compliance maintains it." onClose={() => setPanel(null)} className={WIDE_SHEET}>
          <CallWording products={calls} error={callsError} onRetry={loadCalls} />
        </Sheet>
      )}
      {dialogs}
    </TabFrame>
  );
}

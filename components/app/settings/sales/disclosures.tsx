"use client";

/**
 * Settings › Sales › Disclosures (LA-3.10 + LA-2.23; board A of the 2026-10-30 round, with its "every
 * action and state" boards). Reads and writes /api/app/settings/sales/disclosures; `?preview=sample`
 * renders the design fixtures and saves nothing.
 *
 * Four tabs: Documents (the library — one row per document, its live version, a draft waiting), When
 * they are required (every live rule, read top to bottom), Read on the call (the per-state wording the
 * dialer shows, read-only — Insurvas maintains it) and Try a case (which documents an application with
 * these answers would carry). Above them, the few things that need the owner. Each row has one button
 * and a menu with the rest; Add a document starts blank, from an Insurvas document, or as a duplicate.
 *
 * A document opens in place: Wording, Where and when, Versions, with the wording as the agent sees it
 * and what this draft changes beside them. REPLACEMENT_NOTICE and 1035_EXCHANGE are Insurvas platform
 * rows: read-only until copied to the agency. A version is superseded, never overwritten: editing a
 * published or retired one saves version N + 1 as a draft (that is how an old version is restored), and
 * publishing it retires the one before, so an application acknowledged on version N keeps it. The PDF
 * is private and opens through a short-lived signed link. Owners edit; producers read.
 */

import { StatusChip } from "@/components/ui/status-chip";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Plus } from "lucide-react";
import { notify } from "@/lib/notify";

import { Callout, Field, SettingsCard, SettingsStack, control, st, pillTone } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, confirmAction } from "@/components/ui/confirm-dialog";
import { ToolbarSearch } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/page-states";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { TableCard } from "@/components/ui/table-card";
import { Segmented, UnderlineTabs, ViewTabs } from "@/components/ui/view-tabs";
import { DISCLOSURES, SALES_CARRIERS } from "@/lib/applications/settingsFixtures";
import { attention as needsYou, callCoverage, docMatches, documents, duplicateCode, readAloudLine, searchDocs, versionChanges, wordDiff, type CallProduct, type DocFilter, type LibraryDoc } from "@/lib/salesSettings/disclosureLibrary";
import type { Clause } from "@/lib/salesSettings/editing";
import type { DisclosureInput, DisclosureItem, DisclosureLibrary } from "@/lib/salesSettings/disclosures";
import { US_STATES } from "@/lib/signup/constants";
import { cn } from "@/lib/utils";

import { CallWording, callsNeedingWork } from "./disclosures-calls";
import { ScopeFields, WordingFields, ruleSentence, toDraft, toInput, type DisclosureDraft, type PdfUpload } from "./disclosures-editor";
import { TryACase } from "./disclosures-try";
import {
  BackButton, DiscardSave, LifecyclePill, NOT_SAVED, ReadOnlyNotice, RowAction, RowMenu, SalesLoadError, SalesLoading, SalesPanelTop,
  SalesSetupPending, WithReason, shortDay, useSalesSample, type Lifecycle, type RowMenuItem,
} from "./shared";

const API = "/api/app/settings/sales/disclosures";

type Tab = "documents" | "needs" | "rules" | "calls" | "try";
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
  if (doc.live && !doc.live.platform) return <LifecyclePill state="live" />;
  if (doc.shown.platform) return <LifecyclePill state="platform" />;
  if (doc.draft && !doc.live) return <LifecyclePill state="draft" />;
  if (doc.draft && doc.live?.platform) return <span className="flex flex-wrap items-center gap-2"><LifecyclePill state="draft" /><span className="text-xs text-[var(--muted)]">Insurvas v{doc.live.version} in use</span></span>;
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

export function SalesDisclosures() {
  const sample = useSalesSample();
  const [library, setLibrary] = useState<DisclosureLibrary | null>(sample ? sampleLibrary() : null);
  const [loading, setLoading] = useState(!sample);
  const [error, setError] = useState<{ text: string; pending: boolean } | null>(null);
  const [calls, setCalls] = useState<CallProduct[] | null>(sample ? sampleCalls() : null);
  const [callsError, setCallsError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("documents");
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
  const liveRules = useMemo(() => docs.flatMap((d) => (d.live ? d.live.rules.map((rule, i) => ({ doc: d, item: d.live!, rule, i })) : [])), [docs]);
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
      d.live && { label: "Try it on a case", onSelect: () => setTab("try") },
      (d.live ?? d.shown).hasAttachment && { label: "Open its PDF", onSelect: () => openPdf(d.live ?? d.shown) },
      canEdit && ownLive && { label: `Retire v${ownLive.version}…`, onSelect: () => openAndAsk(ownLive, "retire"), danger: true, disabled: busy },
      canEdit && d.draft && d.own.length > 1 && { label: `Delete draft v${d.draft.version}…`, onSelect: () => openAndAsk(d.draft!, "discard"), danger: true, disabled: busy },
      canEdit && d.own.length > 0 && { label: "Delete document…", onSelect: () => openAndAsk(d.own[0], "deleteDoc"), danger: true, disabled: busy || carried(d) > 0, reason: carried(d) > 0 ? inUse(d) : null },
    ];
  }

  // One width for Edit and View, so the column lines up; which draft opens is in the menu and the editor.
  const rowButton = (d: LibraryDoc) => (
    <span className="inline-flex [&_button]:w-[72px]">
      <RowAction onClick={() => openItem(d.draft && canEdit ? d.draft : d.shown)} label={`Open ${d.shown.title}`}>
        {canEdit && !d.shown.platform && (d.draft || d.shown.status === "published") ? "Edit" : "View"}
      </RowAction>
    </span>
  );

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

  /* ── editor ── */
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
    // What this draft (or these unsaved edits) changes against what applications attach now.
    const live = openDoc?.live && openDoc.live.id !== open?.id ? openDoc.live : open?.status === "published" ? open : null;
    const changes = live && !readOnly && (isDraft || dirty) ? versionChanges(live, draftAsItem(draft, library, Boolean(open?.hasAttachment))) : null;
    const versions = openDoc?.versions ?? [];
    const previewRules = toInput(draft, library).input.rules.filter((r) => r.clauses.every((c) => c.value !== ""));
    const publishLabel = `Publish v${next ?? 1}`;
    // Say what is still needed instead of letting Save or Publish fail on it.
    const needed = [!/^[A-Z0-9][A-Z0-9_]{1,63}$/.test(draft.code) && "a code", !draft.title.trim() && "a title", !draft.body.trim() && "the wording"].filter(Boolean) as string[];
    const neededReason = needed.length ? `Give it ${needed.join(", ").replace(/, ([^,]*)$/, " and $1")} first.` : null;
    const retiring = openDoc?.live && !openDoc.live.platform && openDoc.live.id !== open?.id ? openDoc.live : null;
    // An older version, open to read: say so, and offer Compare and a new draft from it.
    const older = open && openDoc && open.status === "retired" ? open : null;
    const draftBlock = openDoc?.draft ? `Draft v${openDoc.draft.version} already exists. Open it, or delete it first.` : null;
    const openVersion = (v: DisclosureItem) => (dirty && !readOnly ? leave().then(() => openItem(v, "versions")) : openItem(v, "versions"));

    return (
      <SettingsStack>
        <SalesPanelTop sample={sample} />
        {/* A click away from an unsaved document asks first, like Back does (foundation v3). */}
        <LeaveGuard dirty={dirty && !readOnly} onDiscard={revert} what={open?.title || "this document"} />
        <BackButton onClick={leave}>All documents</BackButton>

        <div className="flex flex-wrap items-center gap-3">
          <h2 className="m-0 min-w-0 text-title-sm leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">{draft.title.trim() || (open ? open.title : "New document")}</h2>
          {open && <StatusChip dot={false} tone={pillTone(open.platform ? "neutral" : "brand")}>v{open.version}</StatusChip>}
          <LifecyclePill state={state ?? "draft"} />
          <span className="text-sm text-[var(--muted)]">
            {!open ? "Applies to nothing until you publish it"
              : open.status === "published" ? `${apps(open.acknowledged)} acknowledged it`
              : open.status === "retired" ? `Kept for the ${apps(open.acknowledged)} that acknowledged it`
              : live ? `v${live.version}${live.platform ? " (Insurvas)" : ""} stays in use until you publish`
              : "Applies to nothing until you publish it"}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {open?.platform && canEdit && (
              <WithReason reason={draftBlock}>
                <Button type="button" variant="outline" disabled={busy || Boolean(openDoc?.draft)} onClick={() => copyToAgency(open)}><Copy aria-hidden="true" />Copy to my agency</Button>
              </WithReason>
            )}
            {state === "live" && canEdit && (
              <WithReason reason={dirty ? "Save or discard your changes first." : null}>
                <Button type="button" variant="outline" disabled={busy || dirty} onClick={() => setConfirm("retire")}>Retire this version</Button>
              </WithReason>
            )}
            {canEdit && openDoc && openDoc.own.length > 0 && !open?.platform && (
              <WithReason reason={carried(openDoc) > 0 ? inUse(openDoc) : null}>
                <Button type="button" variant="ghost" disabled={busy || carried(openDoc) > 0} onClick={() => setConfirm("deleteDoc")} className="text-[var(--error-ink)]">Delete document</Button>
              </WithReason>
            )}
          </span>
        </div>

        {saveError && <Callout tone="error" title={saveError} />}
        {!canEdit && <ReadOnlyNotice what="disclosures" />}
        {open?.platform && canEdit && <Callout tone="info" title="This is Insurvas wording. Copy it to your agency to change it; the copy applies once you publish it." />}
        {older && (
          <div className="m-glass-inset flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] px-4 py-3">
            <span className="min-w-0 flex-1 text-sm text-[var(--body)]">You&apos;re viewing <strong className="font-semibold text-[var(--ink)]">v{older.version}</strong>{older.createdBy ? ` by ${older.createdBy}` : ""}, retired. The {apps(older.acknowledged)} that acknowledged it keep it. It can&apos;t be edited.</span>
            {live && <Button type="button" variant="outline" size="sm" onClick={() => setComparing([older, live])}>Compare with live v{live.version}</Button>}
            {canEdit && (
              <WithReason reason={draftBlock}>
                <Button type="button" size="sm" disabled={busy || Boolean(draftBlock)} onClick={() => draftFrom(older)}>Start a draft from this version</Button>
              </WithReason>
            )}
          </div>
        )}

        <UnderlineTabs<EditorTab>
          label="Document"
          value={editorTab}
          onChange={setEditorTab}
          tabs={[
            { key: "wording", label: "Wording" },
            // A count only when a condition needs fixing, so the tab says where the problem is.
            { key: "where", label: "Where and when", count: Object.keys(clauseErrors).length || null, tone: "danger" },
            { key: "versions", label: "Versions", count: versions.length || null },
          ]}
        />

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-4">
            {editorTab === "wording" && (
              <WordingFields item={open} draft={draft} setDraft={setDraft} readOnly={readOnly} onUpload={uploadPdf} onOpenPdf={() => openPdf()} onRemovePdf={() => setConfirm("removePdf")} busy={busy} />
            )}
            {editorTab === "where" && (
              <ScopeFields draft={draft} setDraft={setDraft} library={library} readOnly={readOnly} clauseErrors={clauseErrors} />
            )}
            {editorTab === "versions" && (
              <TableCard>
                {versions.length === 0 ? (
                  <EmptyState title="Not saved yet" hint="Save the draft and it becomes version 1." />
                ) : (
                  <table className={cn(st.table, "min-w-[640px]")}>
                    <thead>
                      <tr className={st.headRow}>
                        <th scope="col" className={st.th}>Version</th>
                        <th scope="col" className={st.th}>Status</th>
                        <th scope="col" className={st.th}>Changed</th>
                        <th scope="col" className={st.th}>Acknowledged on it</th>
                        <th scope="col" className={cn(st.th, "text-right")}><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {versions.map((v) => (
                        <tr key={v.id} className={cn(v.id === open?.id && "bg-[var(--surface-alt)]/40")}>
                          <td className={st.td}>v{v.version}{v.platform ? " (Insurvas)" : ""}{v.id === open?.id ? " · open" : ""}</td>
                          <td className={st.td}><LifecyclePill state={lifecycleOf(v)} /></td>
                          <td className={st.td}>{shortDay(v.updatedAt)}{v.createdBy ? ` · ${v.createdBy}` : v.platform ? " · Insurvas" : ""}</td>
                          <td className={st.td}>{v.status === "draft" ? "—" : apps(v.acknowledged)}</td>
                          <td className={cn(st.td, "whitespace-nowrap text-right")}>
                            <span className="inline-flex gap-2">
                              {v.id !== open?.id && <RowAction onClick={() => openVersion(v)} label={`Open v${v.version}`}>{canEdit && !v.platform && v.status === "draft" ? "Edit" : "View"}</RowAction>}
                              <RowMenu
                                label={`v${v.version}`}
                                items={[
                                  live && v.id !== live.id && v.status !== "draft" && { label: `Compare with live v${live.version}`, onSelect: () => setComparing(v.version < live.version ? [v, live] : [live, v]) },
                                  live && v.status === "draft" && { label: `Compare with live v${live.version}`, onSelect: () => setComparing([live, v]) },
                                  canEdit && v.status === "retired" && !v.platform && { label: `Start a draft from v${v.version}`, onSelect: () => draftFrom(v), disabled: busy || Boolean(draftBlock), reason: draftBlock },
                                  v.hasAttachment && { label: "Open its PDF", onSelect: () => openPdf(v) },
                                ]}
                              />
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </TableCard>
            )}
          </div>

          <aside className="flex min-w-0 flex-col gap-4" aria-label="Preview">
            <SettingsCard title="As the agent sees it" info="The application's Disclosures panel shows this wording when a rule holds. The agent reads it aloud, emails or mails it, and records how.">
              <div className="flex flex-col gap-3">
                <p className="m-0 text-sm font-semibold text-[var(--ink)]">{draft.title.trim() || "Untitled document"}</p>
                {draft.body.trim()
                  ? <p className="m-0 max-h-[320px] overflow-y-auto whitespace-pre-line text-base leading-[1.7] text-[var(--ink)]">{draft.body.trim()}</p>
                  : <p className="m-0 text-sm text-[var(--muted)]">The wording shows here as you type it.</p>}
                <p className="m-0 text-xs text-[var(--muted)]">{readAloudLine(draft.body)}</p>
                <div className="border-t border-[var(--border)] pt-3 text-sm leading-[1.5] text-[var(--body)]">
                  <div>{scopeLine({ states: toInput(draft, library).input.states, carrierIds: draft.carrierIds })}</div>
                  {previewRules.length
                    ? previewRules.map((r, i) => <div key={i} className="text-[var(--muted)]">{i > 0 ? "or " : "Required when "}{ruleSentence(r.clauses as Clause[], library)}</div>)
                    : <div className="text-[var(--warning-ink)]">No rule: never required.</div>}
                </div>
              </div>
            </SettingsCard>
            {changes && (
              <SettingsCard title={`Changed from v${live!.version}${live!.platform ? " (Insurvas)" : ""}`} action={changes.length && open && open.id !== live!.id ? <Button type="button" variant="ghost" size="sm" onClick={() => setComparing([live!, open])}>Compare</Button> : undefined}>
                {changes.length ? (
                  <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm text-[var(--body)]">{changes.map((c) => <li key={c}>{c}</li>)}</ul>
                ) : <p className="m-0 text-sm text-[var(--muted)]">Nothing yet — it matches v{live!.version}.</p>}
              </SettingsCard>
            )}
          </aside>
        </div>

        {!readOnly && isDraft && (
          <SettingsSaveBar note={neededReason ? `To save it, ${neededReason.charAt(0).toLowerCase()}${neededReason.slice(1, -7)}.` : dirty || open === null ? "Unsaved changes — a draft applies to nothing until it is published · Ctrl+S saves" : `Draft v${open.version} is saved — publish it to use it`}>
            {open && <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirm("discard")} className="text-[var(--error-ink)]">Delete draft</Button>}
            {dirty && <Button type="button" variant="outline" disabled={busy} onClick={open ? revert : close}>Discard</Button>}
            <WithReason reason={!dirty && open !== null ? "No changes to save." : neededReason}>
              <Button type="button" variant="outline" disabled={busy || (!dirty && open !== null) || Boolean(neededReason)} onClick={() => saveDraft(false)}>Save draft</Button>
            </WithReason>
            <WithReason reason={neededReason}>
              <Button type="button" disabled={busy || Boolean(neededReason)} onClick={() => { if (prepared()) setConfirm("publish"); }}>{publishLabel}</Button>
            </WithReason>
          </SettingsSaveBar>
        )}
        {!readOnly && !isDraft && (
          <SettingsSaveBar visible={dirty} note={`Unsaved changes — saving makes version ${next}, a draft`}>
            <DiscardSave saving={busy} onDiscard={revert} onSave={() => saveDraft(false)} saveLabel={`Save as draft v${next}`} />
          </SettingsSaveBar>
        )}

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
        {dialogs}
      </SettingsStack>
    );
  }

  /* ── list ── */
  const addReason = canEdit ? null : "Only an owner can add a document.";
  const needCount = needs.noRule.length + needs.drafts.length + (callsOpen ? 1 : 0);
  const startAdding = () => setAdding({ mode: "blank", platformCode: platformDocs[0]?.code ?? "", ownCode: ownDocs[0]?.code ?? "" });

  return (
    <SettingsStack>
      <SalesPanelTop
        sample={sample}
        actions={library && (
          <WithReason reason={addReason}>
            <Button type="button" disabled={!canEdit} onClick={startAdding}><Plus aria-hidden="true" />Add a document</Button>
          </WithReason>
        )}
      />
      {loading && !library ? <SalesLoading label="Loading disclosures" columns={5} /> : error ? (
        error.pending
          ? <SalesSetupPending what="The disclosure library" />
          : <SalesLoadError message={error.text} onRetry={load} />
      ) : library && (
        <>
          {!canEdit && <ReadOnlyNotice what="disclosures" />}

          <ViewTabs<Tab>
            label="Disclosures"
            value={tab}
            onChange={setTab}
            tabs={[
              { key: "documents", label: "Documents", count: docs.length },
              { key: "needs", label: "Needs you", count: needCount || null, tone: "danger" },
              { key: "rules", label: "When they are required", count: liveRules.length },
              { key: "calls", label: "Read on the call", count: callsOpen, tone: "danger" },
              { key: "try", label: "Try a case" },
            ]}
          />

          {tab === "needs" && (
            <TableCard info="What stands between this library and every application carrying the right documents.">
              {needCount === 0 ? (
                <EmptyState title="Nothing needs you" hint="Every live document has a rule, no draft is waiting and the call wording is approved." />
              ) : (
              <ul className="m-0 list-none p-0">
                {needs.noRule.map((d) => (
                  <li key={`r-${d.code}`} className="m-row flex flex-wrap items-center gap-3 border-t border-[var(--border)] px-4 py-3 first:border-t-0">
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[var(--warning)]" />
                    <span className="min-w-0 flex-1 text-sm text-[var(--body)]"><strong className="font-semibold text-[var(--ink)]">{d.live!.title}</strong> is live but never required: it has no rule.</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => openItem(d.draft ?? d.live!, "where")}>{canEdit ? "Add a rule" : "Open"}</Button>
                  </li>
                ))}
                {needs.drafts.map((d) => (
                  <li key={`d-${d.code}`} className="m-row flex flex-wrap items-center gap-3 border-t border-[var(--border)] px-4 py-3 first:border-t-0">
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[var(--warning)]" />
                    <span className="min-w-0 flex-1 text-sm text-[var(--body)]"><strong className="font-semibold text-[var(--ink)]">{d.draft!.title}</strong> has draft v{d.draft!.version} waiting to be published.</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => openItem(d.draft!)}>Review draft</Button>
                    {canEdit && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => openAndAsk(d.draft!, "publish")}>Publish v{d.draft!.version}</Button>}
                  </li>
                ))}
                {callsOpen ? (
                  <li className="m-row flex flex-wrap items-center gap-3 border-t border-[var(--border)] px-4 py-3 first:border-t-0">
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[var(--error)]" />
                    <span className="min-w-0 flex-1 text-sm text-[var(--body)]">Call wording for <strong className="font-semibold text-[var(--ink)]">{callsOpen} {callsOpen === 1 ? "state" : "states"}</strong> is not compliance-approved yet.</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => setTab("calls")}>See states</Button>
                  </li>
                ) : null}
              </ul>
              )}
            </TableCard>
          )}

          {tab === "documents" && (
            <PagedTableCard
              total={shownDocs.length}
              noun="documents"
              toolbar={
                <>
                  <ToolbarSearch value={query} onChange={setQuery} placeholder="Search title, code or wording" />
                  <Segmented<DocFilter>
                    label="Show"
                    value={filter}
                    onChange={setFilter}
                    options={[
                      { key: "all", label: "All", count: docs.length },
                      { key: "live", label: "Live", count: docs.filter((d) => docMatches(d, "live")).length },
                      { key: "draft", label: "Drafts", count: needs.drafts.length },
                      { key: "platform", label: "Insurvas", count: docs.filter((d) => docMatches(d, "platform")).length },
                      { key: "retired", label: "Retired", count: docs.filter((d) => docMatches(d, "retired")).length },
                    ]}
                  />
                </>
              }
            >
              {docs.length === 0 ? (
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
                <>
                  {/* Phone: one card per document, its one button and the same menu. */}
                  <PagedBody as="ul" className="m-0 flex list-none flex-col gap-2 p-3 md:hidden">
                    {shownDocs.map((d) => {
                      const ref = d.live ?? d.shown;
                      return (
                        <li key={d.code} className="m-glass-inset flex flex-col gap-1.5 rounded-lg border border-[var(--border)] p-3">
                          <div className="flex items-start justify-between gap-2">
                            <span className="min-w-0 text-sm font-semibold text-[var(--ink)]">{d.shown.title}</span>
                            {ref.rules.length === 0 && d.live ? <StatusChip tone="warning" dot={false}>No rule</StatusChip> : <StatusCell doc={d} />}
                          </div>
                          <span className="font-mono text-xs text-[var(--muted)]">{d.code} · v{ref.version}{d.draft && d.live ? ` · draft v${d.draft.version} waiting` : ""}{d.live ? ` · ${d.live.acknowledged} acknowledged` : ""}</span>
                          <span className="text-xs text-[var(--body)]">{scopeLine(ref)}{ref.rules.length ? ` · ${ruleSentence(ref.rules[0].clauses, library)}` : ""}</span>
                          <span className="mt-1 flex items-center gap-2 [&>*:first-child]:flex-1 [&>*:first-child>button]:w-full">
                            {rowButton(d)}
                            <RowMenu label={d.shown.title} items={rowMenu(d)} />
                          </span>
                        </li>
                      );
                    })}
                  </PagedBody>
                  <table className={cn(st.table, "hidden min-w-[980px] md:table")}>
                    <thead>
                      <tr className={st.headRow}>
                        <th scope="col" className={st.th}>Document</th>
                        <th scope="col" className={cn(st.th, "w-[200px]")}>Applies to</th>
                        <th scope="col" className={cn(st.th, "w-[230px]")}>Required when</th>
                        <th scope="col" className={cn(st.th, "w-[110px]")}>Version</th>
                        <th scope="col" className={cn(st.th, "w-[170px]")}>Status</th>
                        <th scope="col" className={cn(st.th, "w-[110px] text-right")}>Acknowledged</th>
                        <th scope="col" className={cn(st.th, "w-[170px] text-right")}><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <PagedBody className="m-seq">
                      {shownDocs.map((d) => {
                        const ref = d.live ?? d.shown;
                        const rules = ref.rules;
                        return (
                          // The whole row opens the document; its buttons and menu keep their own clicks.
                          <tr key={d.code} className="m-row cursor-pointer" onClick={(e) => { if (!(e.target as HTMLElement).closest("button, a, [role=menu], [role=menuitem]")) openItem(d.draft && canEdit ? d.draft : d.shown); }}>
                            <td className={st.td}>
                              <span className={cn(st.strong, "block")}>{d.shown.title}</span>
                              <span className={cn(st.sub, "font-mono")}>{d.code}{d.shown.hasAttachment ? " · PDF" : ""}</span>
                            </td>
                            <td className={cn(st.td, "text-sm")}>{scopeLine(ref)}</td>
                            <td className={cn(st.td, "text-sm")}>
                              {rules.length === 0
                                ? (d.live ? <StatusChip tone="warning" dot={false}>Never — no rule</StatusChip> : <span className="text-[var(--muted)]">No rule</span>)
                                : <span className="line-clamp-2">{rules.map((r) => ruleSentence(r.clauses, library)).join(" · or ")}</span>}
                            </td>
                            <td className={st.td}>
                              <StatusChip dot={false} tone={pillTone(d.shown.platform ? "neutral" : "brand")}>v{ref.version}</StatusChip>
                              {d.draft && d.live && <span className={cn(st.sub, "block")}>draft v{d.draft.version} waiting</span>}
                              <span className={cn(st.sub, "block")}>Changed {shortDay(d.shown.updatedAt)}</span>
                            </td>
                            <td className={st.td}><StatusCell doc={d} /></td>
                            <td className={cn(st.td, "text-right tabular-nums")}>{d.live ? d.live.acknowledged.toLocaleString("en-US") : "—"}</td>
                            <td className={cn(st.td, "whitespace-nowrap text-right")}>
                              <span className="inline-flex gap-2">
                                {rowButton(d)}
                                <RowMenu label={d.shown.title} items={rowMenu(d)} />
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </PagedBody>
                  </table>
                </>
              )}
            </PagedTableCard>
          )}

          {tab === "rules" && (
            <PagedTableCard total={liveRules.length + needs.noRule.length} noun="rules" info="Read top to bottom against each application. Every condition in a rule must hold; a document named twice is attached once.">
              {liveRules.length === 0 && needs.noRule.length === 0 ? (
                <EmptyState title="No rules yet" hint="No published document has a rule, so none is required on its own. Open a document to add one." />
              ) : (
                <PagedBody as="ol" className="m-0 list-none p-0">
                  {[
                    ...liveRules.map(({ doc, item, rule, i }) => (
                      <li key={`${item.id}-${i}`} className="border-t border-[var(--border)] px-4 py-3 first:border-t-0">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <span className="min-w-0 flex-1 text-sm leading-[1.5] text-[var(--body)]">
                            If {ruleSentence(rule.clauses, library)}
                            <span className="text-[var(--muted)]"> → </span>
                            <strong className="font-semibold text-[var(--ink)]">{item.title}</strong>
                          </span>
                          <StatusChip dot={false} tone="danger">Required</StatusChip>
                          <RowAction onClick={() => openItem(doc.draft ?? item, "where")} label={`Open ${item.title}`}>Open</RowAction>
                        </div>
                        <div className="text-xs leading-[1.5] text-[var(--muted)]">
                          {item.states.length ? `Only in ${item.states.join(", ")}` : "Every state"} · {item.carrierIds.length ? `only ${item.carrierIds.map(carrierName).join(", ")}` : "every carrier"} · v{item.version}{item.platform ? " (Insurvas)" : ""}
                          {doc.draft ? ` · draft v${doc.draft.version} waiting to be published` : ""}
                        </div>
                      </li>
                    )),
                    ...needs.noRule.map((d) => (
                      <li key={`n-${d.code}`} className="border-t border-[var(--border)] px-4 py-3 first:border-t-0">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <span className="min-w-0 flex-1 text-sm leading-[1.5] text-[var(--body)]">No rule <span className="text-[var(--muted)]">→</span> <strong className="font-semibold text-[var(--ink)]">{d.live!.title}</strong></span>
                          <StatusChip dot={false} tone="warning">Never required</StatusChip>
                          <RowAction onClick={() => openItem(d.draft ?? d.live!, "where")} label={`Open ${d.live!.title}`}>{canEdit ? "Add a rule" : "Open"}</RowAction>
                        </div>
                      </li>
                    )),
                  ]}
                </PagedBody>
              )}
            </PagedTableCard>
          )}

          {tab === "calls" && <CallWording products={calls} error={callsError} onRetry={loadCalls} />}

          {tab === "try" && <TryACase docs={docs} library={library} onOpen={(item) => openItem(item, "where")} />}
          {dialogs}
        </>
      )}
    </SettingsStack>
  );
}

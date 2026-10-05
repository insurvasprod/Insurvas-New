"use client";

/**
 * Settings › Sales › Disclosures (board l3-set-disclosures, LA-3.10). Reads and writes
 * /api/app/settings/sales/disclosures; `?preview=sample` renders the design fixtures and saves nothing.
 *
 * The library — one row per document, its current version — and the rules that decide which ones an
 * application needs, read the way the workspace reads them. REPLACEMENT_NOTICE and 1035_EXCHANGE are
 * Insurvas platform rows: read-only until copied to the agency. A version is superseded, never
 * overwritten: editing a published one saves version N + 1 as a draft, and publishing it retires the
 * one before, so an application acknowledged on version N keeps it. The PDF is private and opens
 * through a short-lived signed link. Owners edit; producers read.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Plus } from "lucide-react";
import { notify } from "@/lib/notify";

import { Callout, Pill, SettingsStack, st } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { TableCard } from "@/components/ui/table-card";
import { DISCLOSURES, SALES_CARRIERS } from "@/lib/applications/settingsFixtures";
import { describeClause, type Clause } from "@/lib/salesSettings/editing";
import type { DisclosureInput, DisclosureItem, DisclosureLibrary } from "@/lib/salesSettings/disclosures";
import { cn } from "@/lib/utils";

import { DisclosureEditor, fieldKind, fieldLabel, toDraft, toInput, type DisclosureDraft } from "./disclosures-editor";
import {
  BackButton, DialogActions, DiscardSave, LifecyclePill, NOT_SAVED, ReadOnlyNotice, RowAction, SalesDialog, SalesLoadError, SalesLoading, SalesPanelTop,
  SalesSetupPending, WithReason, notRefreshed, useSalesSample, warnUnsaved, type Lifecycle,
} from "./shared";

const API = "/api/app/settings/sales/disclosures";

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
      platform: d.platform, hasAttachment: Boolean(d.attachmentName), updatedAt: new Date().toISOString(), acknowledged: 0,
      rules: d.rules.map((r) => ({ clauses: r.clauses.map((c): Clause => ({ field: c.field, op: c.op, value: c.op === "in" ? c.value.split(",").map((s) => s.trim()) : c.value === "yes" ? true : c.value })) })),
    })),
  };
}

/* ── the library, one row per document ──────────────────────────────────── */

type Doc = { code: string; shown: DisclosureItem; live: DisclosureItem | null; platform: DisclosureItem | null; own: DisclosureItem[] };

/** Per code: the agency's newest version if it has any, else the platform's; `live` is what applies now. */
function documents(items: DisclosureItem[]): Doc[] {
  const byCode = new Map<string, DisclosureItem[]>();
  for (const item of items) byCode.set(item.code, [...(byCode.get(item.code) ?? []), item]);
  return [...byCode.entries()].map(([code, list]) => {
    const own = list.filter((i) => !i.platform).sort((a, b) => b.version - a.version);
    const platform = list.filter((i) => i.platform && i.status === "published").sort((a, b) => b.version - a.version)[0] ?? null;
    const live = own.find((i) => i.status === "published") ?? platform;
    return { code, own, platform, live, shown: own[0] ?? platform! };
  }).filter((d) => d.shown).sort((a, b) => a.shown.title.localeCompare(b.shown.title));
}

const listOr = (items: string[], all: string) => (items.length ? items.join(", ") : all);

function StatusCell({ doc }: { doc: Doc }) {
  const s = doc.shown;
  if (s.platform) return <LifecyclePill state="platform" />;
  if (s.status === "published") return <LifecyclePill state="live" />;
  if (s.status === "retired") return <LifecyclePill state="retired" />;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <LifecyclePill state="draft" />
      {doc.live && <span className="text-[12px] text-[var(--muted)]">v{doc.live.version}{doc.live.platform ? " (Insurvas)" : ""} in use</span>}
    </span>
  );
}

async function call(url: string, init: RequestInit = {}) {
  const res = await fetch(url, { cache: "no-store", ...init, headers: init.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "That didn't save. Try again.");
  return data;
}

export function SalesDisclosures() {
  const sample = useSalesSample();
  const [library, setLibrary] = useState<DisclosureLibrary | null>(sample ? sampleLibrary() : null);
  const [loading, setLoading] = useState(!sample);
  const [error, setError] = useState<{ text: string; pending: boolean } | null>(null);
  /** The open version: an id, "new", or null for the list. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DisclosureDraft | null>(null);
  const [clauseErrors, setClauseErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);

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

  useEffect(() => {
    if (sample) return;
    const t = window.setTimeout(load, 0);
    return () => window.clearTimeout(t);
  }, [load, sample]);

  const docs = useMemo(() => documents(library?.items ?? []), [library]);
  const liveRules = useMemo(() => docs.flatMap((d) => (d.live ? d.live.rules.map((rule, i) => ({ doc: d, item: d.live!, rule, i })) : [])), [docs]);
  const open = openId && openId !== "new" ? library?.items.find((i) => i.id === openId) ?? null : null;

  function openItem(item: DisclosureItem | null) {
    if (!library) return;
    setOpenId(item ? item.id : "new");
    setDraft(toDraft(item, library));
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
      accept(copy, `${copy.code} copied to your agency as draft v${copy.version}`, "It applies once you publish it. The Insurvas version is untouched.");
    });
  }

  async function discard() {
    if (!open) return;
    setConfirmDiscard(false);
    if (sample) return notify.done(NOT_SAVED);
    await run(async () => {
      await call(`${API}/${open.id}`, { method: "DELETE" });
      setLibrary((lib) => (lib ? { ...lib, items: lib.items.filter((i) => i.id !== open.id) } : lib));
      notify.done(`Draft v${open.version} discarded`);
      close();
    });
  }

  async function retireOpen() {
    if (!open) return;
    setConfirmRetire(false);
    if (sample) return notify.done(NOT_SAVED);
    await run(async () => {
      const item = (await call(`${API}/${open.id}`, { method: "PATCH", body: JSON.stringify({ status: "retired" }) })).item as DisclosureItem;
      await load();
      accept(item, `${item.code} v${item.version} retired`, "New applications stop attaching it. Applications that acknowledged it keep it.");
    });
  }

  async function attach(file: File) {
    if (!open) return;
    if (sample) return notify.done(NOT_SAVED);
    const form = new FormData();
    form.set("file", file);
    await run(async () => {
      const item = (await call(`${API}/${open.id}/attachment`, { method: "POST", body: form })).item as DisclosureItem;
      setLibrary((lib) => (lib ? { ...lib, items: lib.items.map((i) => (i.id === item.id ? item : i)) } : lib));
      notify.done("PDF attached");
    });
  }

  async function openPdf() {
    if (!open) return;
    if (sample) return notify.done("Sample data — there is no file to open.");
    try {
      const data = await call(`${API}/${open.id}/attachment`);
      window.open(data.url as string, "_blank", "noopener,noreferrer");
    } catch (e) {
      notify.block(e instanceof Error ? e.message : "The PDF could not be opened.");
    }
  }

  const canEdit = Boolean(library?.canEdit);

  /* ── editor ── */
  if (library && draft && openId) {
    const readOnly = !canEdit || Boolean(open?.platform) || open?.status === "retired";
    const baseline = toDraft(open, library);
    const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
    const isDraft = open === null || open.status === "draft";
    const next = open ? (open.status === "draft" ? open.version : Math.max(...library.items.filter((i) => i.code === open.code).map((i) => i.version)) + 1) : null;
    const leave = () => (dirty && !readOnly ? warnUnsaved(open?.title || "This document") : close());
    const state: Lifecycle | null = open === null ? null : open.platform ? "platform" : open.status === "published" ? "live" : open.status === "retired" ? "retired" : "draft";
    const revert = () => { setDraft(baseline); setClauseErrors({}); setSaveError(null); };
    return (
      <SettingsStack>
        <SalesPanelTop sample={sample} />
        <BackButton onClick={leave}>All documents</BackButton>
        {saveError && <Callout tone="error" title={saveError} />}
        {!canEdit && <ReadOnlyNotice what="disclosures" />}
        <DisclosureEditor
          item={open}
          draft={draft}
          setDraft={setDraft}
          library={library}
          readOnly={readOnly}
          clauseErrors={clauseErrors}
          onAttach={attach}
          onOpenPdf={openPdf}
          busy={busy}
          action={open?.platform && canEdit ? (
            <Button type="button" variant="outline" disabled={busy} onClick={() => copyToAgency(open)}><Copy aria-hidden="true" />Copy to my agency</Button>
          ) : state ? (
            <span className="flex shrink-0 items-center gap-2">
              <Pill tone={open?.platform ? "neutral" : "brand"}>v{open?.version}</Pill><LifecyclePill state={state} />
              {state === "live" && canEdit && <Button type="button" variant="outline" disabled={busy || dirty} title={dirty ? "Save or discard your changes first." : undefined} onClick={() => setConfirmRetire(true)}>Retire</Button>}
            </span>
          ) : <LifecyclePill state="draft" />}
        />
        {!readOnly && isDraft && (
          <SettingsSaveBar note={dirty || open === null ? "Unsaved changes — a draft applies to nothing until it is published" : `Draft v${open.version} is saved — publish it to use it`}>
            {open && <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmDiscard(true)}>Delete draft</Button>}
            {dirty && <Button type="button" variant="outline" disabled={busy} onClick={open ? revert : close}>Discard</Button>}
            <WithReason reason={!dirty && open !== null ? "No changes to save." : null}>
              <Button type="button" variant="outline" disabled={busy || (!dirty && open !== null)} onClick={() => saveDraft(false)}>Save draft</Button>
            </WithReason>
            <Button type="button" disabled={busy} onClick={() => (dirty || open === null ? saveDraft(true) : publishOpen())}>Publish v{next ?? 1}</Button>
          </SettingsSaveBar>
        )}
        {!readOnly && !isDraft && (
          <SettingsSaveBar visible={dirty} note={`Unsaved changes — saving makes version ${next}, a draft`}>
            <DiscardSave saving={busy} onDiscard={revert} onSave={() => saveDraft(false)} saveLabel={`Save as draft v${next}`} />
          </SettingsSaveBar>
        )}
        <SalesDialog
          open={confirmRetire}
          onOpenChange={setConfirmRetire}
          title={`Retire ${open?.code ?? ""} v${open?.version ?? ""}?`}
          description={`New applications stop attaching it${library.items.some((i) => i.platform && i.code === open?.code) ? " and the Insurvas version applies again" : ""}. Applications that acknowledged it keep it. The retired version is kept for good.`}
        >
          <DialogActions>
            <Button type="button" variant="outline" onClick={() => setConfirmRetire(false)}>Keep it</Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={retireOpen}>Retire v{open?.version ?? ""}</Button>
          </DialogActions>
        </SalesDialog>
        <SalesDialog open={confirmDiscard} onOpenChange={setConfirmDiscard} title={`Delete draft v${open?.version ?? ""}?`} description="The draft and its PDF are removed. Published versions are not affected.">
          <DialogActions>
            <Button type="button" variant="outline" onClick={() => setConfirmDiscard(false)}>Keep it</Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={discard}>Delete draft</Button>
          </DialogActions>
        </SalesDialog>
      </SettingsStack>
    );
  }

  /* ── list ── */
  const carrierName = (id: string) => library?.carriers.find((c) => c.id === id)?.name ?? "Former carrier";
  const addReason = canEdit ? null : "Only an owner can add a document.";

  return (
    <SettingsStack>
      <SalesPanelTop sample={sample} />
      {loading && !library ? <SalesLoading label="Loading disclosures" columns={5} /> : error ? (
        error.pending
          ? <SalesSetupPending what="The disclosure library" />
          : <SalesLoadError message={error.text} onRetry={load} />
      ) : library && (
        <>
          {!canEdit && <ReadOnlyNotice what="disclosures" />}

          <TableCard
            title="The library"
            description="One row per document. A version is superseded, never overwritten."
            toolbar={
              <DataToolbar
                actions={
                  <>
                    <WithReason reason={addReason}>
                      <Button type="button" disabled={!canEdit} onClick={() => openItem(null)}><Plus aria-hidden="true" />Add a document</Button>
                    </WithReason>
                    <RefreshButton onClick={sample ? notRefreshed : load} refreshing={loading && !sample} />
                  </>
                }
              />
            }
          >
            {docs.length === 0 ? (
              <EmptyState title="No disclosures yet" hint="Add the documents that go with an application, and the conditions that decide which ones." />
            ) : (
              <table className={cn(st.table, "min-w-[860px]")}>
                <thead>
                  <tr className={st.headRow}>
                    <th scope="col" className={st.th}>Document</th>
                    <th scope="col" className={cn(st.th, "w-[150px]")}>States</th>
                    <th scope="col" className={cn(st.th, "w-[170px]")}>Carriers</th>
                    <th scope="col" className={cn(st.th, "w-[80px]")}>Version</th>
                    <th scope="col" className={cn(st.th, "w-[190px]")}>Status</th>
                    <th scope="col" className={cn(st.th, "w-[210px] text-right")}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {docs.map((d) => (
                    <tr key={d.code} className="m-row">
                      <td className={st.td}>
                        <span className={cn(st.strong, "block")}>{d.shown.title}</span>
                        <span className={cn(st.sub, "font-mono")}>{d.code}{d.shown.hasAttachment ? " · PDF attached" : ""}</span>
                      </td>
                      <td className={st.td}>{listOr(d.shown.states, "All states")}</td>
                      <td className={st.td}>{listOr(d.shown.carrierIds.map(carrierName), "All carriers")}</td>
                      <td className={st.td}><Pill tone={d.shown.platform ? "neutral" : "brand"}>v{d.shown.version}</Pill></td>
                      <td className={st.td}><StatusCell doc={d} /></td>
                      <td className={cn(st.td, "whitespace-nowrap text-right")}>
                        <span className="inline-flex gap-2">
                          {d.shown.platform && canEdit && (
                            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => copyToAgency(d.shown)} aria-label={`Copy ${d.shown.title} to my agency`}>Copy to my agency</Button>
                          )}
                          <RowAction onClick={() => openItem(d.shown)} label={`Open ${d.shown.title}`}>{canEdit && !d.shown.platform && d.shown.status !== "retired" ? "Edit" : "View"}</RowAction>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </TableCard>

          <TableCard title="What triggers them" description="Read top to bottom against the case. A document named twice is attached once.">
            {liveRules.length === 0 ? (
              <EmptyState title="No rules yet" hint="No published document has a rule, so none is required on its own. Open a document to add one." />
            ) : (
              <ol className="m-0 list-none p-0">
                {liveRules.map(({ doc, item, rule, i }) => (
                  <li key={`${item.id}-${i}`} className="border-t border-[var(--border)] px-4 py-3 first:border-t-0">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <span className="min-w-0 text-[14px] leading-[1.5] text-[var(--body)]">
                        {rule.clauses.map((c, j) => (
                          <span key={j}>
                            {j > 0 && <span className="font-semibold text-[var(--muted)]"> AND </span>}
                            {describeClause(c, fieldLabel(c.field, library).toLowerCase(), fieldKind(c.field, library))}
                          </span>
                        ))}
                        <span className="text-[var(--muted)]"> → </span>
                        <strong className="font-semibold text-[var(--ink)]">{item.title}</strong>
                      </span>
                      <Pill tone="error">Required</Pill>
                    </div>
                    <div className="text-[12px] leading-[1.5] text-[var(--muted)]">
                      {item.states.length ? `Only in ${item.states.join(", ")}` : "Every state"} · {item.carrierIds.length ? `only ${item.carrierIds.map(carrierName).join(", ")}` : "every carrier"} · v{item.version}{item.platform ? " (Insurvas)" : ""}
                      {doc.own[0] && doc.own[0].status === "draft" ? ` · draft v${doc.own[0].version} waiting to be published` : ""}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </TableCard>
        </>
      )}
    </SettingsStack>
  );
}

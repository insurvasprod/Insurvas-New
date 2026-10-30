"use client";

/**
 * Settings › Sales › Quotation templates (LA-3.4). Reads and writes
 * /api/app/settings/sales/templates?kind=quotation; `?preview=sample` (outside production) renders the
 * design fixtures and saves nothing.
 *
 * Owner pick A (canvas page settings-quotation, 2026-10-30), split into two pages the same day: the
 * grid of every carrier × product line, each square naming the template a quote for that pair is
 * typed on today — worked out with the Quote step's own ladder (pickQuotationTemplate), so the page
 * and the call never disagree. A square opens its pair's page (← back to the grid): the inputs the
 * Quote step asks (wording, required, note, choices, order, the agency's own inputs), the age basis
 * and validity, and beside them the agent's view and the versions.
 *
 * Polish pass (same day): each pair's page has its own link (Back and refresh keep it); "Give it its
 * own" is one click (a copy of what the pair uses now); ⋯ copies a template to another carrier, stops
 * using it, or deletes the draft; Publish says what the version changes; the grid filters to own
 * templates, pairs on the default, or drafts. Publishing makes an immutable version; a saved quote keeps the
 * (template, version) it was made with. No rate tables.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, Plus } from "lucide-react";

import { Callout, Field, SettingsCard, SettingsStack, control, st } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { EmptyState } from "@/components/ui/page-states";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import { notify } from "@/lib/notify";
import type { StoredDefinition } from "@/lib/applications/templates";
import { pickQuotationTemplate } from "@/lib/quotes/quotationTemplate";
import { templateChanges, type TemplateChanges } from "@/lib/salesSettings/templateCoverage";
import { parseSettingsHash } from "@/lib/settings/registry";
import { quoteDefinitionFrom, quoteDraftFields, quoteDraftProblem, quoteValidDays, type QuoteDraftField } from "@/lib/salesSettings/templateDefinition";
import { definitionProblem, QUOTE_VALID_DAYS } from "@/lib/salesSettings/templateSchemas";
import type { TemplateRowView } from "@/lib/salesSettings/views";
import { cn } from "@/lib/utils";

import { QuoteAgentView, QuoteInputsEditor } from "./quotation-inputs";
import { DiscardSave, LifecyclePill, ReadOnlyNotice, RowAction, SalesLoadError, SalesLoading, SalesPanelTop, SalesSetupPending, RowMenu, WithReason, changedLine, shortDay, warnUnsaved } from "./shared";
import { lineageKey, liveOf, useSalesTemplates } from "./templates-data";
import { PairDialog, PublishDialog, RetireDialog } from "./templates-dialogs";

type AgeBasis = "nearest" | "last";
const AGE_BASIS_LABEL: Record<AgeBasis, string> = { nearest: "Nearest birthday", last: "Last birthday" };
const DEFAULT_INPUTS = ["dob", "gender", "state", "tobacco", "face_amount", "tier"];
/** Stands in for the agency's tenant id: pickQuotationTemplate only compares it with each row's owner. */
const MINE = "agency";

const ageBasisOf = (def: StoredDefinition | null | undefined): AgeBasis => (def?.age_basis === "last" ? "last" : "nearest");
/** A stored definition as the editor would save it untouched, so "changed" means the owner changed something. */
const normal = (def: StoredDefinition | null | undefined) => JSON.stringify(quoteDefinitionFrom(def, quoteDraftFields(def), ageBasisOf(def), quoteValidDays(def)));
const askedCount = (def: StoredDefinition | null | undefined) => quoteDraftFields(def).filter((f) => f.on).length;
const newest = (list: TemplateRowView[]) => [...list].sort((a, b) => b.version - a.version)[0] ?? null;

type Dialog = { kind: "pair"; carrierId?: string | null; productCode?: string } | { kind: "copyTo"; template: TemplateRowView } | { kind: "publish"; template: TemplateRowView } | { kind: "retire"; template: TemplateRowView } | null;
type GridFilter = "all" | "own" | "default" | "drafts";
/** One square of the grid: a carrier (null = every carrier, the defaults row) and a product line. */
type Cell = { carrierId: string | null; productCode: string };
type CellView = {
  /** The pair's own template: its open draft before its live version. */
  own: TemplateRowView | null;
  /** What a quote for the pair is typed on today. */
  uses: TemplateRowView | null;
  /** The carrier sells this line (always true on the defaults row). */
  sold: boolean;
  /** Its own versions were all retired. */
  retiredOwn: TemplateRowView | null;
};

/** A pair's page has its own link, "#sales-quotation/pair.<carrier id | all>.<product code>", so Back and a refresh keep it. */
const PAIR = "pair.";
const pairHash = (c: Cell | null) => (c ? `#sales-quotation/${PAIR}${c.carrierId ?? "all"}.${c.productCode}` : "#sales-quotation");
function cellOfHash(): Cell | null {
  const { tab, anchor } = parseSettingsHash(window.location.hash.slice(1));
  if (tab !== "sales-quotation" || !anchor?.startsWith(PAIR)) return null;
  const [carrier, code] = anchor.slice(PAIR.length).split(".");
  return carrier && code ? { carrierId: carrier === "all" ? null : carrier, productCode: code } : null;
}
const sameCell = (a: Cell | null, b: Cell | null) => (a?.carrierId ?? null) === (b?.carrierId ?? null) && (a?.productCode ?? null) === (b?.productCode ?? null);

/** "+1 input · 2 reworded · new order": what a draft changes against the live version, in the page's words. */
function quoteChangesSummary(c: TemplateChanges) {
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  return [
    c.added.length > 0 && `+${n(c.added.length, "input")}`,
    c.removed.length > 0 && `−${n(c.removed.length, "input")}`,
    c.reworded.length > 0 && `${c.reworded.length} reworded`,
    c.changed.length > 0 && `${n(c.changed.length, "input")} changed`,
    c.reordered && "new order",
  ].filter(Boolean).join(" · ");
}

export function SalesQuotationTemplates() {
  const api = useSalesTemplates("quotation");
  const { payload, sample } = api;
  const [cell, setCell] = useState<Cell | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<QuoteDraftField[]>([]);
  const [ageBasis, setAgeBasis] = useState<AgeBasis>("nearest");
  const [validDays, setValidDays] = useState(30);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [gridFilter, setGridFilter] = useState<GridFilter>("all");
  const hashRead = useRef(false);

  const all = useMemo(() => payload?.templates ?? [], [payload]);
  const selected = all.find((t) => t.id === selectedId) ?? null;
  const canEdit = Boolean(payload?.canEdit);
  const readOnly = !canEdit || !selected?.tenantOwned;
  const definition = useMemo(() => (selected ? quoteDefinitionFrom(selected.definition, draft, ageBasis, validDays) : null), [selected, draft, ageBasis, validDays]);
  const dirty = Boolean(selected && definition && JSON.stringify(definition) !== normal(selected.definition));
  const problem = definition && !readOnly ? quoteDraftProblem(draft) ?? definitionProblem("quotation", definition) : null;

  const productName = (code: string) => payload?.productLines.find((p) => p.code === code)?.name ?? all.find((t) => t.productCode === code)?.productName ?? code;
  const carrierLabel = (t: TemplateRowView) => t.carrierName ?? (t.tenantOwned ? "Your default" : "Insurvas default");
  const productLabel = (t: TemplateRowView) => {
    if (!t.carrierId) return `${t.productName}, every carrier`;
    const names = (payload?.carrierProducts ?? []).filter((p) => p.carrierId === t.carrierId && p.productCode === t.productCode).map((p) => p.name);
    return names.length ? names.join(", ") : t.productName;
  };
  const nameOf = (t: TemplateRowView) => `${carrierLabel(t)} · ${productLabel(t)}`;
  /** "your Final Expense default v1", "Insurvas's Final Expense default v1", "Aetna / CVS v2" — the template a cell falls back to. */
  const shortName = (t: TemplateRowView) => (t.carrierId ? `${t.carrierName ?? "Carrier"} v${t.version}` : `${t.tenantOwned ? "your" : "Insurvas's"} ${productName(t.productCode)} default v${t.version}`);

  // The grid: product lines the agency sells (and any it has a template for), carriers it works with.
  const lines = useMemo(() => {
    const sold = (payload?.productLines ?? []).filter((l) => l.sold !== false).map((l) => l.code);
    const templated = all.filter((t) => t.tenantOwned && t.status !== "retired").map((t) => t.productCode);
    return [...new Set([...sold, ...templated])];
  }, [payload, all]);
  const carriers = useMemo(() => {
    const list = [...(payload?.carriers ?? [])];
    for (const t of all) if (t.tenantOwned && t.carrierId && !list.some((c) => c.id === t.carrierId)) list.push({ id: t.carrierId, name: t.carrierName ?? "Carrier" });
    // A carrier that sells none of these lines, with no template of its own, has nothing to set here.
    return list.filter((c) => lines.some((code) => (payload?.carrierProducts ?? []).some((p) => p.carrierId === c.id && p.productCode === code))
      || all.some((t) => t.tenantOwned && t.carrierId === c.id));
  }, [payload, all, lines]);
  const hiddenCarriers = (payload?.carriers.length ?? 0) - carriers.filter((c) => payload?.carriers.some((x) => x.id === c.id)).length;

  const cellView = (c: Cell): CellView => {
    const mine = all.filter((t) => t.tenantOwned && (t.carrierId ?? null) === c.carrierId && t.productCode === c.productCode);
    const ownDraft = newest(mine.filter((t) => t.status === "draft"));
    const ownLive = newest(mine.filter((t) => t.status === "published"));
    const live = all.filter((t) => t.status === "published");
    const rows = live.map((t) => ({ id: t.id, version: t.version, tenant_id: t.tenantOwned ? MINE : null, carrier_id: t.carrierId, product_code: t.productCode, row: t }));
    const usesRow = pickQuotationTemplate(rows, { productCode: c.productCode, carrierId: c.carrierId, tenantId: MINE })?.row ?? null;
    // On the defaults row, Insurvas's own template for the line stands in for one the agency has not copied.
    const platform = c.carrierId === null && !ownDraft && !ownLive ? newest(all.filter((t) => !t.tenantOwned && !t.carrierId && t.productCode === c.productCode && t.status === "published")) : null;
    const sold = c.carrierId === null || (payload?.carrierProducts ?? []).some((p) => p.carrierId === c.carrierId && p.productCode === c.productCode) || mine.length > 0;
    return { own: ownDraft ?? ownLive ?? platform, uses: usesRow, sold, retiredOwn: !ownDraft && !ownLive ? newest(mine) : null };
  };
  const current = cell ? cellView(cell) : null;

  const load = (t: TemplateRowView) => {
    setSelectedId(t.id);
    setDraft(quoteDraftFields(t.definition));
    setAgeBasis(ageBasisOf(t.definition));
    setValidDays(quoteValidDays(t.definition));
    setSaveError(null);
  };
  /** Show a pair's page (or the grid, for null) with `t` open — the pair's own template when none is named. */
  const show = (c: Cell | null, t?: TemplateRowView | null) => {
    setCell(c);
    const open = t === undefined ? (c ? cellView(c).own : null) : t;
    if (open) load(open);
    else setSelectedId(null);
    if (window.location.hash !== pairHash(c)) window.history.pushState(null, "", pairHash(c));
    // Each is a page of its own: it opens at the top.
    window.scrollTo({ top: 0 });
  };
  const leaving = () => { warnUnsaved(selected ? nameOf(selected) : "This template"); };
  const pickCell = (c: Cell) => (dirty ? leaving() : show(c));
  /** A version from the Versions list (a retired one, say), or a template just made, opened in the editor. */
  const openVersion = (t: TemplateRowView) => {
    if (dirty && t.id !== selectedId) return leaving();
    show({ carrierId: t.carrierId ?? null, productCode: t.productCode }, t);
  };
  const discard = () => { if (selected) load(selected); };
  /** Back to the grid. */
  const close = () => (dirty ? leaving() : show(null));

  // The link, Back and Forward: open the pair the address names once the templates have loaded.
  useEffect(() => {
    if (!payload) return;
    const sync = () => {
      const want = cellOfHash();
      if (sameCell(want, cell)) return;
      if (dirty) {
        leaving();
        window.history.pushState(null, "", pairHash(cell));
        return;
      }
      show(want);
    };
    if (!hashRead.current) { hashRead.current = true; sync(); }
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
    // show/leaving read the same state these list; they are rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, cell, dirty]);
  const save = async () => {
    if (!selected || !definition) return;
    setSaving(true);
    const { saved, error } = await api.save(selected.id, { definition: definition as Record<string, unknown> });
    setSaving(false);
    setSaveError(error);
    if (saved) {
      setSelectedId(saved.template.id);
      setDraft(quoteDraftFields(saved.template.definition));
    }
  };
  const copyPlatform = async (t: TemplateRowView) => {
    const mine = all.find((x) => x.tenantOwned && x.status === "draft" && x.productCode === t.productCode && (x.carrierId ?? null) === (t.carrierId ?? null));
    if (mine) { notify.block("Your agency already has a draft of this template", { detail: `Open ${nameOf(mine)} to keep editing it.` }); return; }
    const copied = await api.copy(t.id, {});
    if (copied) openVersion(copied);
  };
  const removeDraft = async (t: TemplateRowView) => {
    const live = liveOf(all, t);
    const ok = await confirmAction({ title: `Delete draft v${t.version}?`, description: `${nameOf(t)} v${t.version} has never been published, so no quote uses it.${live ? ` Live v${live.version} stays in use.` : ""}`, confirmLabel: "Delete draft", cancelLabel: "Keep draft" });
    if (!ok) return;
    if (await api.remove(t.id)) {
      if (t.id === selectedId) { if (live) load(live); else setSelectedId(null); }
    }
  };
  /** What a new pair starts from: the template the pair is quoted on today. */
  const startingPoint = (c: Cell) => {
    const from = cellView(c).uses;
    if (from) return quoteDefinitionFrom(from.definition, quoteDraftFields(from.definition), ageBasisOf(from.definition), quoteValidDays(from.definition));
    return quoteDefinitionFrom(null, quoteDraftFields(null).map((f) => ({ ...f, on: DEFAULT_INPUTS.includes(f.key) })), "nearest", 30);
  };

  /**
   * A pair on the default gets its own template in one step: a draft copied from what it uses now (a copy
   * also numbers past a template the pair once had and retired). On the "Every carrier" row it is the
   * product line's default.
   */
  const giveOwn = async (c: Cell) => {
    const from = cellView(c).uses;
    const name = `${c.carrierId ? carriers.find((x) => x.id === c.carrierId)?.name ?? "Carrier" : "Every carrier"} · ${productName(c.productCode)}`;
    const t = from
      ? await api.copy(from.id, { carrier_id: c.carrierId, product_code: c.productCode, name }, "Draft ready — change what it asks, then publish")
      : await api.create({ product_code: c.productCode, carrier_id: c.carrierId, name, definition: startingPoint(c) as Record<string, unknown> });
    if (t) openVersion(t);
  };

  const ownerOnly = canEdit ? null : "Only an owner can change templates.";
  const shownProblem = saveError ?? (dirty ? problem : null);
  const lineage = selected ? all.filter((x) => lineageKey(x) === lineageKey(selected)).sort((a, b) => b.version - a.version) : current?.retiredOwn ? all.filter((x) => lineageKey(x) === lineageKey(current.retiredOwn!)).sort((a, b) => b.version - a.version) : [];
  const nextVersion = lineage.length ? lineage[0].version + 1 : 1;
  const live = selected ? liveOf(all, selected) : null;
  const usedForPreview = selected ? null : current?.uses ?? null;

  const statusOf = (t: TemplateRowView) => (!t.tenantOwned ? "platform" : t.status === "published" ? "live" : t.status === "draft" ? "draft" : "retired") as "platform" | "live" | "draft" | "retired";
  const sentence = (t: TemplateRowView) => {
    if (!t.tenantOwned) return "Insurvas's default, read-only. Copy it to your agency to change it.";
    if (t.status === "draft") return live ? `Draft v${t.version}. Quotes keep using live v${live.version} until you publish this one.` : `Draft v${t.version}. No quote uses it until you publish it.`;
    if (t.status === "published") return `Live v${t.version}${t.publishedAt ? ` since ${shortDay(t.publishedAt)}` : ""}. Saving a change makes v${nextVersion}, a draft; quotes keep using v${t.version} until you publish it.`;
    return `Retired v${t.version}. Quotes already made on it keep it.`;
  };

  // The page's one primary action: publish the open draft, or copy Insurvas's template to change it.
  const primary = selected && (
    !selected.tenantOwned ? (
      <WithReason reason={ownerOnly}><Button type="button" disabled={!canEdit} onClick={() => { void copyPlatform(selected); }}><Copy aria-hidden="true" />Copy to my agency</Button></WithReason>
    ) : selected.status === "draft" ? (
      <WithReason reason={dirty ? "Save your changes first, then publish." : ownerOnly}>
        <Button type="button" disabled={!canEdit || dirty} onClick={() => setDialog({ kind: "publish", template: selected })}>Publish v{selected.version}</Button>
      </WithReason>
    ) : null
  );

  const cellButton = (c: Cell, label: string) => {
    const v = cellView(c);
    const isOpen = cell?.carrierId === c.carrierId && cell?.productCode === c.productCode;
    // A carrier with no product on this line: a square to add one (owner 2026-10-30: never a bare dash).
    if (!v.sold) {
      return (
        <button
          type="button"
          aria-pressed={isOpen}
          aria-label={`${label}: add a template`}
          onClick={() => pickCell(c)}
          className={cn(
            "flex min-h-[60px] w-full min-w-0 flex-col items-start justify-center gap-1 rounded-[12px] border border-dashed px-3 py-2 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring",
            isOpen ? "border-[var(--primary)] bg-[var(--brand-50)]" : "border-[var(--border-strong)] hover:border-[var(--primary)] hover:bg-[var(--brand-50)]",
          )}
        >
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold tracking-[-0.02em] text-[var(--ink)]"><Plus aria-hidden="true" className="size-4 text-[var(--accent-ink)]" />Add a template</span>
          <span className="text-xs leading-[1.5] tracking-[-0.01em] text-[var(--body)]">Not in this carrier&apos;s Contracting yet</span>
        </button>
      );
    }
    const t = v.own;
    const chip = t ? <LifecyclePill state={statusOf(t)} /> : <span className="text-xs font-semibold text-[var(--warning-ink)]">On the default</span>;
    const line = t
      ? `${t.tenantOwned ? "Own" : "Insurvas"} v${t.version} · ${askedCount(t.definition)} inputs · ${AGE_BASIS_LABEL[ageBasisOf(t.definition)].toLowerCase()}`
      : v.uses ? `Uses ${shortName(v.uses)}` : "Uses the standard inputs";
    return (
      <button
        type="button"
        aria-pressed={isOpen}
        aria-label={`${label}: ${t ? `${statusOf(t)} v${t.version}` : "on the default"}`}
        onClick={() => pickCell(c)}
        className={cn(
          "flex min-h-[60px] w-full min-w-0 flex-col items-start justify-center gap-1 rounded-[12px] border px-3 py-2 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring",
          isOpen ? "border-[var(--primary)] bg-[var(--brand-50)]" : "border-[var(--border)] hover:border-[var(--border-strong)]",
        )}
      >
        {chip}
        <span className="text-xs leading-[1.5] tracking-[-0.01em] text-[var(--body)]">{line}</span>
      </button>
    );
  };

  // The grid's filter: every square the agency can quote on, and which of them a filter keeps.
  const squares: Cell[] = [null, ...carriers.map((c) => c.id)].flatMap((carrierId) => lines.map((productCode) => ({ carrierId, productCode }))).filter((q) => cellView(q).sold);
  const matches = (q: Cell, f: GridFilter) => {
    if (f === "all") return true;
    const v = cellView(q);
    if (f === "own") return Boolean(v.own?.tenantOwned);
    if (f === "default") return !v.own?.tenantOwned;
    return Boolean(v.own?.tenantOwned && v.own.status === "draft");
  };
  const rowShown = (carrierId: string | null) => squares.some((q) => q.carrierId === carrierId && matches(q, gridFilter));

  const pairTitle = cell ? `${cell.carrierId ? carriers.find((c) => c.id === cell.carrierId)?.name ?? selected?.carrierName ?? "Carrier" : "Every carrier"} · ${productName(cell.productCode)}` : "";
  // On the pair page, its one action: publish, copy, or give a pair on the default its own.
  // The pair's other actions behind ⋯: copy it to another carrier, stop using it, delete the draft.
  const pairMenu = selected?.tenantOwned && (
    <RowMenu
      label={pairTitle}
      items={[
        { label: "Copy to another carrier", onSelect: () => setDialog({ kind: "copyTo", template: selected }), disabled: !canEdit, reason: ownerOnly },
        live && { label: `Stop using it (retire v${live.version})`, onSelect: () => setDialog({ kind: "retire", template: live }), disabled: !canEdit, reason: ownerOnly, danger: true },
        selected.status === "draft" && { label: `Delete draft v${selected.version}`, onSelect: () => { void removeDraft(selected); }, disabled: !canEdit, reason: ownerOnly, danger: true },
      ]}
    />
  );
  const pairAction = selected ? <>{pairMenu}{primary}</> : cell && current && (
    <WithReason reason={ownerOnly}>
      {cell.carrierId ? (
        <Button type="button" disabled={!canEdit} onClick={() => { void giveOwn(cell); }}><Plus aria-hidden="true" />{current.sold ? "Give it its own" : "Add a template"}</Button>
      ) : (
        <Button type="button" disabled={!canEdit} onClick={() => { void giveOwn(cell); }}><Plus aria-hidden="true" />Make a {productName(cell.productCode)} default</Button>
      )}
    </WithReason>
  );

  return (
    <SettingsStack>
      {/* Two pages (owner 2026-10-30): the grid of every pair, and one pair's page — the section
          title, then → the pair, its state, and its one action on that line. */}
      <SalesPanelTop
        sample={sample}
        trail={cell ? (
          <>
            <Button type="button" variant="ghost" size="icon" aria-label="Back to all carriers and products" title="Back to all carriers and products" onClick={close}>
              <ArrowLeft aria-hidden="true" />
            </Button>
            <span className="min-w-0 truncate text-title-sm font-semibold text-[var(--ink)]">{pairTitle}</span>
            {selected ? <LifecyclePill state={statusOf(selected)} /> : <StatusChip dot={false} tone="warning">{current?.sold === false ? "Not in Contracting" : "On the default"}</StatusChip>}
          </>
        ) : undefined}
        actions={cell ? pairAction : (
          <WithReason reason={ownerOnly}><Button type="button" variant="outline" disabled={!canEdit || !payload} onClick={() => setDialog({ kind: "pair" })}><Plus aria-hidden="true" />Add a pair</Button></WithReason>
        )}
      />

      {api.schemaPending ? (
        <SalesSetupPending what="Quotation templates" />
      ) : api.loading && !payload ? (
        <SalesLoading label="Loading quotation templates" columns={3} />
      ) : api.error && !payload ? (
        <SalesLoadError message={api.error} onRetry={() => { void api.reload(); }} />
      ) : !cell || !current ? (
        <>
          {!canEdit && <ReadOnlyNotice what="quotation templates" />}
          <ol aria-label="How this page works" className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">
            {["Pick a carrier and product", "Choose what the agent is asked", "Publish — new quotes use it, old ones keep theirs"].map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span aria-hidden="true" className={cn("inline-grid size-6 place-items-center rounded-full text-xs", i === 0 ? "bg-[var(--primary)] text-[var(--on-primary)]" : "bg-[var(--surface-alt)] text-[var(--ink)]")}>{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>

          <TableCard
            title="Which template each pair uses"
            info="A quote is typed on the pair's own template, or on your default when it has none — the same choice the Quote step makes. A quote keeps the version it was made with."
            toolbar={lines.length > 0 && (
              <Segmented
                label="Show"
                value={gridFilter}
                onChange={setGridFilter}
                options={[
                  { key: "all", label: "All", count: squares.length },
                  { key: "own", label: "Own template", count: squares.filter((q) => matches(q, "own")).length },
                  { key: "default", label: "On the default", count: squares.filter((q) => matches(q, "default")).length },
                  { key: "drafts", label: "Drafts", count: squares.filter((q) => matches(q, "drafts")).length },
                ]}
              />
            )}
          >
            {lines.length === 0 ? (
              <EmptyState title="No product lines switched on" hint="Switch on the products you sell in Settings › Products, then give each carrier its own template here." />
            ) : (
              <div className="overflow-x-auto">
                {/* Each product column keeps room for its squares; a narrow screen scrolls the grid in its box. */}
                <table className={st.table} style={{ minWidth: 168 + lines.length * 168 }}>
                  <thead>
                    <tr className={st.headRow}>
                      <th scope="col" className={cn(st.th, "w-[200px]")}>Carrier</th>
                      {lines.map((code) => <th key={code} scope="col" className={st.th}>{productName(code)}</th>)}
                    </tr>
                  </thead>
                  <tbody className="m-seq">
                    {rowShown(null) && (
                      <tr>
                        <th scope="row" className={cn(st.td, "text-left")}>
                          <span className={st.strong}>Every carrier</span>
                          <span className={st.sub}>Your default</span>
                        </th>
                        {lines.map((code) => <td key={code} className={cn(st.td, "py-1.5")}>{cellButton({ carrierId: null, productCode: code }, `Every carrier, ${productName(code)}`)}</td>)}
                      </tr>
                    )}
                    {carriers.filter((c) => rowShown(c.id)).map((c) => (
                      <tr key={c.id}>
                        <th scope="row" className={cn(st.td, "text-left")}><span className={st.strong}>{c.name}</span></th>
                        {lines.map((code) => <td key={code} className={cn(st.td, "py-1.5")}>{cellButton({ carrierId: c.id, productCode: code }, `${c.name}, ${productName(code)}`)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {gridFilter !== "all" && !rowShown(null) && !carriers.some((c) => rowShown(c.id)) && (
                  <p className="m-0 px-4 py-3 text-sm leading-[1.5] text-[var(--ink)]">
                    {gridFilter === "drafts" ? "No drafts open." : gridFilter === "own" ? "No pair has its own template yet." : "Every pair has its own template."}
                  </p>
                )}
                {hiddenCarriers > 0 && (
                  <p className="m-0 border-t border-[var(--border)] px-4 py-2.5 text-xs leading-[1.5] text-[var(--body)]">
                    {hiddenCarriers} more {hiddenCarriers === 1 ? "carrier sells" : "carriers sell"} none of these product lines, so {hiddenCarriers === 1 ? "it is" : "they are"} not listed. Add their products in Contracting to quote them.
                  </p>
                )}
              </div>
            )}
          </TableCard>
        </>
      ) : (
        <>
          {!canEdit && <ReadOnlyNotice what="quotation templates" />}
          <div className="m-stagger grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="min-w-0">
              {!selected ? (
                <SettingsCard
                  title={current.sold ? "No template of its own" : "No template yet"}
                  sub={!current.sold
                    ? `Add a template and it starts as a copy of ${current.uses ? shortName(current.uses) : "the standard inputs"} — see What the agent sees.`
                    : current.uses ? `Quotes for ${pairTitle} use ${shortName(current.uses)} — see What the agent sees.` : "There is no default for this product yet either."}
                >
                  {!current.sold && cell.carrierId && (
                    <Callout tone="info" className="mb-4" title={`${carriers.find((x) => x.id === cell.carrierId)?.name ?? "This carrier"} has no ${productName(cell.productCode)} product in Contracting yet, so agents can't quote it there.`}>
                      Add the product in <Link href="/app/settings#carriers" className="font-semibold text-[var(--accent-ink)] hover:underline">Contracting</Link>. The template you add here is used as soon as they can.
                    </Callout>
                  )}
                  <p className={cn("m-0 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--ink)]", !current.sold && "hidden")}>
                    {cell.carrierId
                      ? "Give it its own when this carrier asks for something your default does not, or words it differently. It starts as a copy of what it uses now."
                      : `A ${productName(cell.productCode)} default is what every carrier without its own uses for this product. It starts as a copy of what it uses now.`}
                  </p>
                </SettingsCard>
              ) : (
                <SettingsCard key={selected.id} title="What the agent is asked" sub={sentence(selected)}>
                  {shownProblem && <Callout tone="error" title={shownProblem} className="mb-4" />}
                  <div className="flex flex-col gap-6">
                    <QuoteInputsEditor draft={draft} onChange={setDraft} readOnly={readOnly} />
                    <section aria-labelledby="qt-rules" className="flex flex-col gap-3 border-t border-[var(--border)] pt-4">
                      <h4 id="qt-rules" className="m-0 text-label text-[var(--ink)]">Age and how long a quote stands</h4>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Age basis" htmlFor="qt-age-basis" hint="Nearest birthday ages a client up six months before their birthday, which can change the band and the premium.">
                          <select id="qt-age-basis" className={control} value={ageBasis} disabled={readOnly} onChange={(e) => setAgeBasis(e.target.value as AgeBasis)}>
                            <option value="nearest">{AGE_BASIS_LABEL.nearest}</option>
                            <option value="last">{AGE_BASIS_LABEL.last}</option>
                          </select>
                        </Field>
                        <Field label="A quote stays valid for" htmlFor="qt-valid" hint="After this a quote is shown struck through on the case, never silently repriced.">
                          <select id="qt-valid" className={control} value={validDays} disabled={readOnly} onChange={(e) => setValidDays(Number(e.target.value))}>
                            {[30, ...QUOTE_VALID_DAYS.filter((d) => d !== 30)].map((d) => <option key={d} value={d}>{d} days</option>)}
                          </select>
                        </Field>
                      </div>
                    </section>
                  </div>
                </SettingsCard>
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-4">
              <SettingsCard
                title="What the agent sees"
                sub={selected ? `Version ${selected.version}${dirty ? ", with your unsaved changes" : ""}` : usedForPreview ? (current?.sold === false ? `A new template starts as ${shortName(usedForPreview)}` : `This pair uses ${shortName(usedForPreview)} now`) : undefined}
              >
                {selected && definition ? (
                  <QuoteAgentView key={selected.id} definition={definition} ageBasis={ageBasis} validDays={validDays} />
                ) : usedForPreview ? (
                  <QuoteAgentView key={usedForPreview.id} definition={usedForPreview.definition} ageBasis={ageBasisOf(usedForPreview.definition)} validDays={quoteValidDays(usedForPreview.definition)} />
                ) : null}
              </SettingsCard>

              {lineage.length > 0 && (
                <SettingsCard title="Versions" sub="A quote keeps the version it was made with.">
                  <ul className="m-0 flex list-none flex-col p-0">
                    {lineage.map((v) => (
                      <li key={v.id} className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] py-2.5 first:border-t-0 first:pt-0">
                        <span className="w-8 text-sm font-semibold tabular-nums text-[var(--ink)]">v{v.version}</span>
                        <LifecyclePill state={statusOf(v)} />
                        <span className="min-w-0 flex-1 basis-40 text-xs leading-[1.5] tracking-[-0.01em] text-[var(--body)]">
                          {v.status === "published" && v.publishedAt ? `Published ${shortDay(v.publishedAt)}. ` : ""}{changedLine(v.updatedAt, v.editedBy, "")}
                        </span>
                        <span className="flex gap-2">
                          {v.id !== selectedId && <Button type="button" variant="ghost" size="sm" onClick={() => openVersion(v)}>Open</Button>}
                          {v.tenantOwned && v.status === "draft" && <RowAction disabled={!canEdit} reason={ownerOnly} onClick={() => { void removeDraft(v); }} label={`Delete draft v${v.version}`}>Delete draft</RowAction>}
                          {v.tenantOwned && v.status === "published" && <RowAction disabled={!canEdit} reason={ownerOnly} onClick={() => setDialog({ kind: "retire", template: v })} label={`Retire v${v.version}`}>Retire</RowAction>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </SettingsCard>
              )}
            </div>
          </div>
        </>
      )}

      {!api.schemaPending && payload && (
        <>
          <LeaveGuard dirty={Boolean(selected && !readOnly && dirty)} onDiscard={discard} what="this quotation template" />
          <SettingsSaveBar
            visible={Boolean(selected && !readOnly && dirty)}
            note={selected?.status === "draft" ? `Unsaved changes to ${nameOf(selected)}` : `Unsaved changes — saving makes version ${nextVersion}, a draft`}
          >
            <DiscardSave saving={saving} problem={problem} onDiscard={discard} onSave={() => { void save(); }} saveLabel={selected?.status === "draft" ? "Save draft" : `Save as v${nextVersion}`} />
          </SettingsSaveBar>
        </>
      )}

      {dialog?.kind === "pair" && payload && (
        <PairDialog
          title="Add a pair"
          description="A quotation template for one carrier and product line. It starts as a copy of what that pair uses now; publish it when it is right."
          submitLabel="Create draft"
          carriers={payload.carriers}
          productLines={payload.productLines}
          allowGeneral={false}
          withName={false}
          initial={{ productCode: dialog.productCode ?? lines[0] ?? "final_expense", carrierId: dialog.carrierId ?? payload.carriers[0]?.id ?? null, name: "" }}
          problem={(c) => (all.some((x) => x.tenantOwned && x.productCode === c.productCode && x.carrierId === c.carrierId && x.status !== "retired") ? "That pair already has a template. Pick its square in the grid." : null)}
          onClose={() => setDialog(null)}
          onSubmit={async (c) => {
            const carrier = payload.carriers.find((x) => x.id === c.carrierId)?.name ?? "Carrier";
            const t = await api.create({ product_code: c.productCode, carrier_id: c.carrierId, name: `${carrier} · ${productName(c.productCode)}`, definition: startingPoint({ carrierId: c.carrierId, productCode: c.productCode }) as Record<string, unknown> });
            setDialog(null);
            if (t) openVersion(t);
          }}
        />
      )}
      {dialog?.kind === "copyTo" && payload && (
        <PairDialog
          title="Copy to another carrier"
          description={`A draft for the carrier you pick, with the same inputs as ${nameOf(dialog.template)} v${dialog.template.version}. Publish it when it is right.`}
          submitLabel="Copy as a draft"
          carriers={payload.carriers}
          productLines={payload.productLines}
          allowGeneral={false}
          withName={false}
          initial={{ productCode: dialog.template.productCode, carrierId: payload.carriers.find((c) => c.id !== dialog.template.carrierId)?.id ?? null, name: "" }}
          problem={(c) => (c.carrierId === dialog.template.carrierId && c.productCode === dialog.template.productCode ? "Pick another carrier or product line." : all.some((x) => x.tenantOwned && x.productCode === c.productCode && x.carrierId === c.carrierId && x.status !== "retired") ? "That pair already has its own template. Open it from the grid." : null)}
          onClose={() => setDialog(null)}
          onSubmit={async (c) => {
            const carrier = payload.carriers.find((x) => x.id === c.carrierId)?.name ?? "Carrier";
            const t = await api.copy(dialog.template.id, { carrier_id: c.carrierId, product_code: c.productCode, name: `${carrier} · ${productName(c.productCode)}` }, `Copied to ${carrier} as a draft`);
            setDialog(null);
            if (t) openVersion(t);
          }}
        />
      )}
      {dialog?.kind === "publish" && (
        <PublishDialog
          name={nameOf(dialog.template)}
          version={dialog.template.version}
          liveVersion={liveOf(all, dialog.template)?.version ?? null}
          changes={(() => {
            // What this version changes against the one quotes use now, said before it goes live.
            const was = liveOf(all, dialog.template);
            if (!was) return null;
            const detail = templateChanges(was.definition, dialog.template.definition);
            const extra = [ageBasisOf(was.definition) !== ageBasisOf(dialog.template.definition) && "age basis", quoteValidDays(was.definition) !== quoteValidDays(dialog.template.definition) && "how long a quote stands"].filter(Boolean) as string[];
            const summary = [quoteChangesSummary(detail), ...extra.map((x) => `${x} changed`)].filter(Boolean).join(" · ") || "nothing changed";
            return { against: was.version, summary, detail: { ...detail, changed: [...detail.changed, ...extra.map((x) => x.charAt(0).toUpperCase() + x.slice(1))] } };
          })()}
          onClose={() => setDialog(null)}
          onConfirm={async (retirePrevious) => { await api.publish(dialog.template.id, retirePrevious); setDialog(null); }}
        />
      )}
      {dialog?.kind === "retire" && (
        <RetireDialog
          name={nameOf(dialog.template)}
          version={dialog.template.version}
          onClose={() => setDialog(null)}
          onConfirm={async () => { await api.retire(dialog.template.id); setDialog(null); }}
        />
      )}
    </SettingsStack>
  );
}

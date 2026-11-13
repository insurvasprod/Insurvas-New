"use client";

/**
 * Settings › Sales process › Quote inputs (was Quotation templates, LA-3.4). Reads and writes
 * /api/app/settings/sales/templates?kind=quotation; `?preview=sample` (outside production) renders the design
 * fixtures and saves nothing.
 *
 * Settings round 8 (owner pick A, sales-process board "2 · Quote inputs", 2026-11-12): the grid of every carrier ×
 * product line the agency sells, each cell one line ("5 inputs · 30 days", "Your default", "Not sold"), and a status
 * chip per carrier. A cell opens that pair in a right sheet: the inputs the Quote step asks in order (each Not asked,
 * Optional or Required), the age basis and how long a quote stands, what the agent sees, and its versions. Which
 * template a pair is quoted on is the Quote step's own ladder (pickQuotationTemplate), so the page and the call
 * never disagree. One save model: edits go into the pair's draft as they are made; Publish vN puts it live. A saved
 * quote keeps the (template, version) it was made with. No prices or rate tables live here.
 *
 * A pair's sheet has its own link, "#sales-process/pair.<carrier id | all>.<product code>" (the old
 * "#sales-quotation/pair…" links land on it too).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Copy, Plus } from "lucide-react";

import { resetConfirmOptions } from "@/components/app/settings/defaults";
import { SettingsSectionHeader, control, st } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import type { StoredDefinition } from "@/lib/applications/templates";
import { pickQuotationTemplate } from "@/lib/quotes/quotationTemplate";
import { agoText, lastChange } from "@/lib/salesSettings/salesProcess";
import { templateChanges, type TemplateChanges } from "@/lib/salesSettings/templateCoverage";
import { quoteDefinitionFrom, quoteDraftFields, quoteDraftProblem, quoteValidDays, type QuoteDraftField } from "@/lib/salesSettings/templateDefinition";
import { definitionProblem, QUOTE_VALID_DAYS } from "@/lib/salesSettings/templateSchemas";
import type { TemplateRowView } from "@/lib/salesSettings/views";
import { cn } from "@/lib/utils";

import { SheetSection, StatusLine, TabFrame, ThreeWay, useDraftAutosave, WIDE_SHEET, type StatusTone } from "../sales-process/parts";
import { QuoteAgentView, QuoteInputsEditor } from "./quotation-inputs";
import { LifecyclePill, RowAction, RowMenu, SalesPanelTop, WithReason, changedLine, shortDay } from "./shared";
import { lineageKey, liveOf, useSalesTemplates } from "./templates-data";
import { PairDialog, PublishDialog, RetireDialog } from "./templates-dialogs";

type AgeBasis = "nearest" | "last";
const AGE_BASIS_LABEL: Record<AgeBasis, string> = { nearest: "Age nearest birthday", last: "Age last birthday" };
const DEFAULT_INPUTS = ["dob", "gender", "state", "tobacco", "face_amount", "tier"];
/** Stands in for the agency's tenant id: pickQuotationTemplate only compares it with each row's owner. */
const MINE = "agency";

const ageBasisOf = (def: StoredDefinition | null | undefined): AgeBasis => (def?.age_basis === "last" ? "last" : "nearest");
/** A stored definition as the editor would save it untouched, so "changed" means the owner changed something. */
const normal = (def: StoredDefinition | null | undefined) => JSON.stringify(quoteDefinitionFrom(def, quoteDraftFields(def), ageBasisOf(def), quoteValidDays(def)));
const askedCount = (def: StoredDefinition | null | undefined) => quoteDraftFields(def).filter((f) => f.on).length;
const newest = (list: TemplateRowView[]) => [...list].sort((a, b) => b.version - a.version)[0] ?? null;

type Dialog = { kind: "copyTo"; template: TemplateRowView } | { kind: "publish"; template: TemplateRowView } | { kind: "retire"; template: TemplateRowView } | null;
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

const PAIR = "pair.";
const pairHash = (c: Cell | null) => (c ? `#sales-process/${PAIR}${c.carrierId ?? "all"}.${c.productCode}` : "#sales-process/quote-inputs");
function cellOf(anchor: string | null | undefined): Cell | null {
  if (!anchor?.startsWith(PAIR)) return null;
  const [carrier, code] = anchor.slice(PAIR.length).split(".");
  return carrier && code ? { carrierId: carrier === "all" ? null : carrier, productCode: code } : null;
}

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

export function SalesQuotationTemplates({ focus = null }: { focus?: string | null } = {}) {
  const api = useSalesTemplates("quotation");
  const { payload, sample } = api;
  const [cell, setCell] = useState<Cell | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<QuoteDraftField[]>([]);
  const [ageBasis, setAgeBasis] = useState<AgeBasis>("nearest");
  const [validDays, setValidDays] = useState(30);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const all = useMemo(() => payload?.templates ?? [], [payload]);
  const selected = all.find((t) => t.id === selectedId) ?? null;
  const canEdit = Boolean(payload?.canEdit);
  const readOnly = !canEdit || !selected?.tenantOwned;
  const definition = useMemo(() => (selected ? quoteDefinitionFrom(selected.definition, draft, ageBasis, validDays) : null), [selected, draft, ageBasis, validDays]);
  const dirty = Boolean(selected && definition && JSON.stringify(definition) !== normal(selected.definition));
  const problem = definition && !readOnly ? quoteDraftProblem(draft) ?? definitionProblem("quotation", definition) : null;

  const productName = (code: string) => payload?.productLines.find((p) => p.code === code)?.name ?? all.find((t) => t.productCode === code)?.productName ?? code;
  const carrierName = (id: string | null) => (id ? payload?.carriers.find((c) => c.id === id)?.name ?? all.find((t) => t.carrierId === id)?.carrierName ?? "Carrier" : "Every carrier");
  const shortName = (t: TemplateRowView) => (t.carrierId ? `${t.carrierName ?? "Carrier"} v${t.version}` : `${t.tenantOwned ? "your" : "the Insurvas"} ${productName(t.productCode)} default v${t.version}`);

  // The grid: product lines the agency sells (and any it has a template for), carriers it works with.
  const lines = useMemo(() => {
    const sold = (payload?.productLines ?? []).filter((l) => l.sold !== false).map((l) => l.code);
    const templated = all.filter((t) => t.tenantOwned && t.status !== "retired").map((t) => t.productCode);
    return [...new Set([...sold, ...templated])];
  }, [payload, all]);
  const carriers = useMemo(() => {
    const list = [...(payload?.carriers ?? [])];
    for (const t of all) if (t.tenantOwned && t.carrierId && !list.some((c) => c.id === t.carrierId)) list.push({ id: t.carrierId, name: t.carrierName ?? "Carrier" });
    return list.filter((c) => lines.some((code) => (payload?.carrierProducts ?? []).some((p) => p.carrierId === c.id && p.productCode === code))
      || all.some((t) => t.tenantOwned && t.carrierId === c.id));
  }, [payload, all, lines]);

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
  const autosave = useDraftAutosave({
    signature: JSON.stringify({ id: selected ? lineageKey(selected) : null, definition }),
    dirty,
    enabled: Boolean(selected && !readOnly && !problem && !sample),
    save: async () => {
      if (!selected || !definition) return false;
      const { saved, error } = await api.save(selected.id, { definition: definition as Record<string, unknown> });
      setSaveError(error);
      if (saved) setSelectedId(saved.template.id);
      return Boolean(saved);
    },
  });
  /** Open a pair's sheet (or close it, for null) with `t` open — the pair's own template when none is named. */
  const show = (c: Cell | null, t?: TemplateRowView | null) => {
    setCell(c);
    autosave.reset();
    const open = t === undefined ? (c ? cellView(c).own : null) : t;
    if (open) load(open);
    else setSelectedId(null);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${pairHash(c)}`);
  };
  const openVersion = (t: TemplateRowView) => show({ carrierId: t.carrierId ?? null, productCode: t.productCode }, t);

  // A link names a pair: open it once the templates are here.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!payload || !focus || opened.current === focus) return;
    const want = cellOf(focus);
    if (!want) return;
    opened.current = focus;
    const t = window.setTimeout(() => show(want), 0);
    return () => window.clearTimeout(t);
    // show reads the same state; it is rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, focus]);

  const copyPlatform = async (t: TemplateRowView) => {
    const mine = all.find((x) => x.tenantOwned && x.status === "draft" && x.productCode === t.productCode && (x.carrierId ?? null) === (t.carrierId ?? null));
    if (mine) { openVersion(mine); return; }
    const copied = await api.copy(t.id, {});
    if (copied) openVersion(copied);
  };
  const removeDraft = async (t: TemplateRowView) => {
    const live = liveOf(all, t);
    const ok = await confirmAction({ title: `Discard draft v${t.version}?`, description: `It has never been published, so no quote uses it.${live ? ` Live v${live.version} stays in use.` : ""}`, confirmLabel: "Discard draft", cancelLabel: "Keep draft" });
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
  /** A pair on the default gets its own in one step: a draft copied from what it uses now. */
  const giveOwn = async (c: Cell) => {
    const from = cellView(c).uses;
    const name = `${carrierName(c.carrierId)} · ${productName(c.productCode)}`;
    const t = from
      ? await api.copy(from.id, { carrier_id: c.carrierId, product_code: c.productCode, name }, "Draft ready — change what it asks, then publish")
      : await api.create({ product_code: c.productCode, carrier_id: c.carrierId, name, definition: startingPoint(c) as Record<string, unknown> });
    if (t) openVersion(t);
  };
  const hasPlatform = (productCode: string) => all.some((t) => !t.tenantOwned && !t.carrierId && t.status === "published" && t.productCode === productCode);
  const resetLine = async (productCode: string) => {
    if (!(await confirmAction(resetConfirmOptions(`the ${productName(productCode)} quote inputs for every carrier`, "Your versions are retired, not deleted: quotes already made keep theirs. Carrier-specific templates stay.")))) return;
    if (await api.resetToDefault(productCode, null)) show(cell);
  };

  const ownerOnly = canEdit ? null : "Only an owner can change quote inputs.";
  const lineage = selected ? all.filter((x) => lineageKey(x) === lineageKey(selected)).sort((a, b) => b.version - a.version) : current?.retiredOwn ? all.filter((x) => lineageKey(x) === lineageKey(current.retiredOwn!)).sort((a, b) => b.version - a.version) : [];
  const live = selected ? liveOf(all, selected) : null;
  const statusOf = (t: TemplateRowView) => (!t.tenantOwned ? "platform" : t.status === "published" ? "live" : t.status === "draft" ? "draft" : "retired") as "platform" | "live" | "draft" | "retired";

  // ── the grid's figures, for the status line and the status column ──
  const squares: Cell[] = carriers.flatMap((c) => lines.map((productCode) => ({ carrierId: c.id, productCode }))).filter((q) => cellView(q).sold);
  const onInsurvas = squares.filter((q) => { const u = cellView(q).uses; return !u || !u.tenantOwned; });
  const ownCount = squares.filter((q) => cellView(q).own?.tenantOwned).length;
  const last = lastChange(all.filter((t) => t.tenantOwned).map((t) => ({ at: t.updatedAt, by: t.editedBy, what: "" })));
  const gridStatus: { tone: StatusTone; text: string } = !payload ? { tone: "muted", text: "Reading your quote inputs" }
    : { tone: onInsurvas.length ? "warn" : "ok", text: `${squares.length - onInsurvas.length} of ${squares.length} pairs set${ownCount ? ` · ${ownCount} with their own` : ""}${onInsurvas.length ? ` · ${onInsurvas.length} on the Insurvas default` : ""}${last ? ` · last change${last.by ? ` by ${last.by}` : ""}, ${agoText(last.at)}` : ""}` };

  /** One cell, one line: what the pair is quoted on, in the grid's words. */
  const cellText = (c: Cell) => {
    const v = cellView(c);
    if (!v.sold) return { text: "Not sold", muted: true };
    if (v.own?.tenantOwned) return { text: `${askedCount(v.own.definition)} inputs · ${quoteValidDays(v.own.definition)} days${v.own.status === "draft" ? " · draft" : ""}`, muted: false };
    if (v.uses?.tenantOwned) return { text: c.carrierId ? "Your default" : `${askedCount(v.uses.definition)} inputs · ${quoteValidDays(v.uses.definition)} days`, muted: true };
    return { text: "Insurvas default", muted: true };
  };
  const rowStatus = (carrierId: string | null) => {
    const mine = lines.map((productCode) => ({ carrierId, productCode })).filter((q) => cellView(q).sold);
    const onDefault = mine.filter((q) => { const u = cellView(q).uses; return !u || !u.tenantOwned; }).length;
    const drafts = mine.filter((q) => cellView(q).own?.tenantOwned && cellView(q).own?.status === "draft").length;
    if (onDefault) return <StatusChip tone="warning">{onDefault} on default</StatusChip>;
    if (drafts) return <StatusChip tone="info">{drafts === 1 ? "1 draft" : `${drafts} drafts`}</StatusChip>;
    return <StatusChip tone="good">Set</StatusChip>;
  };

  const pairTitle = cell ? `${carrierName(cell.carrierId)} · ${productName(cell.productCode)}` : "";
  const firstLine = lines[0];

  // ── the sheet ──
  const sheetStatus = !selected ? (current?.uses ? `Quoted on ${shortName(current.uses)} today` : "No template yet")
    : !selected.tenantOwned ? "The Insurvas default · read-only: copy it to change it"
    : selected.status === "draft" ? `v${selected.version} draft${live ? ` · v${live.version} live` : " · not live yet"}${autosave.state === "saving" || dirty ? " · saving" : ""}`
    : selected.status === "published" ? `v${selected.version} live${selected.publishedAt ? ` since ${shortDay(selected.publishedAt)}` : ""} · a change starts v${(lineage[0]?.version ?? 0) + 1} as a draft`
    : `v${selected.version} retired`;
  const sheetMenu = selected?.tenantOwned && canEdit && (
    <RowMenu
      label={pairTitle}
      items={[
        live && !selected.carrierId && hasPlatform(selected.productCode)
          ? { label: "Reset to the Insurvas default", onSelect: () => { void resetLine(selected.productCode); }, danger: true }
          : live && { label: `Stop using it (retire v${live.version})`, onSelect: () => setDialog({ kind: "retire", template: live }), danger: true },
        selected.status === "draft" && { label: `Discard draft v${selected.version}`, onSelect: () => { void removeDraft(selected); }, danger: true },
      ]}
    />
  );
  const sheetPrimary = !cell || !current ? null : !selected ? (
    <WithReason reason={ownerOnly}>
      <Button type="button" disabled={!canEdit} onClick={() => { void giveOwn(cell); }}><Plus aria-hidden="true" />{cell.carrierId ? (current.sold ? "Give it its own" : "Add a template") : `Make a ${productName(cell.productCode)} default`}</Button>
    </WithReason>
  ) : !selected.tenantOwned ? (
    <WithReason reason={ownerOnly}><Button type="button" disabled={!canEdit} onClick={() => { void copyPlatform(selected); }}><Copy aria-hidden="true" />Copy to my agency</Button></WithReason>
  ) : selected.status === "draft" ? (
    <WithReason reason={dirty ? "Saving to the draft — a moment." : problem ?? ownerOnly}>
      <Button type="button" disabled={!canEdit || dirty || Boolean(problem)} onClick={() => setDialog({ kind: "publish", template: selected })}>Publish v{selected.version}</Button>
    </WithReason>
  ) : null;

  return (
    <TabFrame>
      <SettingsSectionHeader
        actions={firstLine ? <Button type="button" variant="outline" disabled={!payload} onClick={() => show({ carrierId: null, productCode: firstLine })}>Your default</Button> : undefined}
      />
      <SalesPanelTop sample={sample} />
      {api.schemaPending ? (
        <StatusLine tone="warn">Quote inputs need a database update. Ask your Insurvas admin to apply the latest migrations.</StatusLine>
      ) : api.error && !payload ? (
        <StatusLine tone="bad" action={<Button type="button" variant="outline" size="sm" onClick={() => { void api.reload(); }}>Try again</Button>}>{api.error}</StatusLine>
      ) : (
        <StatusLine tone={gridStatus.tone}>{gridStatus.text}{!canEdit && payload ? " · read only: only an owner changes quote inputs" : ""}</StatusLine>
      )}

      <TableCard className="min-h-0 flex-1" title="What the agent types on the Quote step" description="Click a cell to edit that carrier × product" bodyClassName="min-h-0 flex-1 overflow-auto">
        {!payload ? <SectionLoading rows={6} columns={4} label="Loading quote inputs" /> : lines.length === 0 ? (
          <EmptyState title="No product lines switched on" hint="Switch on the products you sell in Settings › Products, then give each carrier its own inputs here." action={<Button asChild variant="outline"><Link href="/app/settings#products">Open Products</Link></Button>} />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className={st.table} style={{ minWidth: 200 + lines.length * 170 + 140 }}>
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={cn(st.th, "w-[200px]")}>Carrier</th>
                  {lines.map((code) => <th key={code} scope="col" className={st.th}>{productName(code)}</th>)}
                  <th scope="col" className={cn(st.th, "w-[140px]")}>Status</th>
                </tr>
              </thead>
              <tbody className="m-seq">
                {[{ id: null as string | null, name: "Your default" }, ...carriers].map((c) => (
                  <tr key={c.id ?? "default"} className="m-row">
                    <th scope="row" className={cn(st.td, "text-left font-semibold whitespace-nowrap text-[var(--ink)]")}>{c.id ? c.name : "Your default · every carrier"}</th>
                    {lines.map((code) => {
                      const q = { carrierId: c.id, productCode: code };
                      const { text, muted } = cellText(q);
                      const isOpen = cell?.carrierId === c.id && cell?.productCode === code;
                      return (
                        <td key={code} className={cn(st.td, "p-0")}>
                          <button
                            type="button"
                            aria-pressed={isOpen}
                            aria-label={`${c.id ? c.name : "Every carrier"}, ${productName(code)}: ${text}`}
                            onClick={() => show(q)}
                            className={cn("block h-full w-full truncate px-4 py-2.5 text-left text-sm outline-none transition-colors hover:bg-[var(--surface-alt)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset", muted ? "text-[var(--muted)]" : "text-[var(--ink)]", isOpen && "bg-[var(--primary-soft)]")}
                          >
                            {text}
                          </button>
                        </td>
                      );
                    })}
                    <td className={cn(st.td, "whitespace-nowrap")}>{c.id ? rowStatus(c.id) : <StatusChip tone="neutral">Fallback</StatusChip>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>

      {cell && current && (
        <Sheet
          title={pairTitle}
          subtitle={`Quote inputs · ${sheetStatus}`}
          status={selected ? <LifecyclePill state={statusOf(selected)} /> : !current.sold ? <StatusChip dot={false} tone="warning">Not in Contracting</StatusChip> : undefined}
          actions={sheetMenu || undefined}
          onClose={() => show(null)}
          className={WIDE_SHEET}
          footer={
            <>
              {selected?.tenantOwned && canEdit && <Button type="button" variant="ghost" onClick={() => setDialog({ kind: "copyTo", template: selected })}>Copy to another carrier</Button>}
              <span className="ml-auto flex items-center gap-2">{sheetPrimary}</span>
            </>
          }
        >
          {saveError && <StatusLine tone="bad">Couldn&apos;t save to the draft: {saveError}</StatusLine>}
          {dirty && problem && <StatusLine tone="warn">Not saved yet: {problem}</StatusLine>}
          {!selected ? (
            <SheetSection title={current.sold ? "No template of its own" : "Not sold yet"} sub={current.uses ? `Quotes for ${pairTitle} use ${shortName(current.uses)}. Give it its own when this carrier asks for something different; it starts as a copy.` : "There is no default for this product yet either."}>
              {!current.sold && cell.carrierId && (
                <p className="m-0 text-sm text-[var(--body)]">{carrierName(cell.carrierId)} has no {productName(cell.productCode)} product in <Link href="/app/settings#carriers" className="font-semibold text-[var(--accent-ink)] hover:underline">Carriers</Link> yet, so agents can&apos;t quote it there. The template you add here is used as soon as they can.</p>
              )}
              {current.uses && <QuoteAgentView key={current.uses.id} definition={current.uses.definition} ageBasis={ageBasisOf(current.uses.definition)} validDays={quoteValidDays(current.uses.definition)} />}
            </SheetSection>
          ) : (
            <>
              <SheetSection title="Asked on the Quote step, in this order" sub="Required inputs must be filled before a price shows.">
                <QuoteInputsEditor draft={draft} onChange={(next) => { setDraft(next); setSaveError(null); }} readOnly={readOnly} />
              </SheetSection>
              <SheetSection title="Age and how long a quote stands" sub="How the carrier counts age, and when the agent must quote again.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-label text-[var(--body)]">Age basis</span>
                    <ThreeWay size="md" label="Age basis" disabled={readOnly} value={ageBasis} onChange={setAgeBasis} options={[{ key: "last", label: AGE_BASIS_LABEL.last }, { key: "nearest", label: AGE_BASIS_LABEL.nearest }]} />
                  </div>
                  <label className="flex flex-col gap-1.5 text-label text-[var(--body)]" htmlFor="qt-valid">
                    A quote stays valid for
                    <select id="qt-valid" className={cn(control, "mt-0")} value={validDays} disabled={readOnly} onChange={(e) => setValidDays(Number(e.target.value))}>
                      {[30, ...QUOTE_VALID_DAYS.filter((d) => d !== 30)].map((d) => <option key={d} value={d}>{d} days</option>)}
                    </select>
                  </label>
                </div>
              </SheetSection>
              <SheetSection title="What the agent sees" sub={`Version ${selected.version}${dirty ? ", with your latest edits" : ""}`}>
                {definition && <QuoteAgentView key={selected.id} definition={definition} ageBasis={ageBasis} validDays={validDays} />}
              </SheetSection>
            </>
          )}
          {lineage.length > 0 && (
            <SheetSection title="Versions" sub="A quote keeps the version it was made with.">
              <ul className="m-0 flex list-none flex-col p-0">
                {lineage.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] py-2 first:border-t-0">
                    <LifecyclePill state={statusOf(v)} />
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--body)]">v{v.version} · {v.status === "published" && v.publishedAt ? `published ${shortDay(v.publishedAt)} · ` : ""}{changedLine(v.updatedAt, v.editedBy, "")}</span>
                    {v.id !== selectedId && <Button type="button" variant="ghost" size="sm" onClick={() => openVersion(v)}>Open</Button>}
                    {v.tenantOwned && v.status === "published" && canEdit && <RowAction onClick={() => setDialog({ kind: "retire", template: v })} label={`Retire v${v.version}`}>Retire</RowAction>}
                  </li>
                ))}
              </ul>
            </SheetSection>
          )}
        </Sheet>
      )}

      <LeaveGuard dirty={Boolean(selected && !readOnly && dirty)} onDiscard={() => { if (selected) load(selected); }} what="these quote inputs" />

      {dialog?.kind === "copyTo" && payload && (
        <PairDialog
          title="Copy to another carrier"
          description={`A draft for the carrier you pick, with the same inputs as ${pairTitle} v${dialog.template.version}. Publish it when it is right.`}
          submitLabel="Copy as a draft"
          carriers={payload.carriers}
          productLines={payload.productLines}
          allowGeneral={false}
          withName={false}
          initial={{ productCode: dialog.template.productCode, carrierId: payload.carriers.find((c) => c.id !== dialog.template.carrierId)?.id ?? null, name: "" }}
          problem={(c) => (c.carrierId === dialog.template.carrierId && c.productCode === dialog.template.productCode ? "Pick another carrier or product line." : all.some((x) => x.tenantOwned && x.productCode === c.productCode && x.carrierId === c.carrierId && x.status !== "retired") ? "That pair already has its own template. Open it from the grid." : null)}
          onClose={() => setDialog(null)}
          onSubmit={async (c) => {
            const name = `${carrierName(c.carrierId)} · ${productName(c.productCode)}`;
            const t = await api.copy(dialog.template.id, { carrier_id: c.carrierId, product_code: c.productCode, name }, `Copied to ${carrierName(c.carrierId)} as a draft`);
            setDialog(null);
            if (t) openVersion(t);
          }}
        />
      )}
      {dialog?.kind === "publish" && (
        <PublishDialog
          name={pairTitle}
          version={dialog.template.version}
          liveVersion={liveOf(all, dialog.template)?.version ?? null}
          changes={(() => {
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
        <RetireDialog name={pairTitle} version={dialog.template.version} onClose={() => setDialog(null)} onConfirm={async () => { await api.retire(dialog.template.id); setDialog(null); }} />
      )}
    </TabFrame>
  );
}

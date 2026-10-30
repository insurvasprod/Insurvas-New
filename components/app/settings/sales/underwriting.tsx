"use client";

/**
 * Settings › Sales › Underwriting templates (LA-3.1). Reads and writes
 * /api/app/settings/sales/templates?kind=underwriting; `?preview=sample` (outside production) renders
 * the design fixtures and saves nothing.
 *
 * Round 2, owner pick B (2026-10-30, canvas page settings-uw-templates-r2): one list grouped by
 * product line, each group saying which template a call loads now (the interview's own ladder,
 * lib/salesSettings/templateCoverage.ts); each row says what it is for and who changed it last.
 * The editor has one primary action (Publish, or Copy to my agency), the rest under ⋯, and the save
 * bar at the bottom naming what the edit changes. Tabs: Questions (with the bank), Try it (the
 * preview, asked as a client of an age and tobacco use) and Versions. Saving a draft changes it in
 * place; saving an edit to a live version makes version N + 1 as a draft, and interviews already
 * started keep the version they began on.
 */

import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Check, Plus, Search } from "lucide-react";

import { Callout, SettingsStack, st } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { Segmented, ViewTabs } from "@/components/ui/view-tabs";
import { dayMonth, viewerTimeZone } from "@/lib/format/dates";
import { notify } from "@/lib/notify";
import { changesSummary, inUseNow, scopeOf, templateChanges, usesOf, type ProductUse } from "@/lib/salesSettings/templateCoverage";
import { definitionFromDraft, draftFromDefinition, knockoutCount, questionCount, type UwDraft } from "@/lib/salesSettings/templateDefinition";
import { definitionProblem } from "@/lib/salesSettings/templateSchemas";
import type { TemplateRowView } from "@/lib/salesSettings/views";
import { cn } from "@/lib/utils";

import {
  LifecyclePill, plural, ReadOnlyNotice, RowAction, RowMenu, SalesLoadError, SalesLoading, SalesPanelTop, SalesSetupPending, VersionPill, WithReason,
  warnUnsaved,
} from "./shared";
import { QuestionBuilder } from "./templates-builder";
import { lineageKey, liveOf, tableRows, useSalesTemplates } from "./templates-data";
import { PairDialog, RetireDialog, type PairChoice } from "./templates-dialogs";
import { TemplatePreview } from "./templates-preview";
import { AgentTemplatesView, ReviewPanel, VersionsPanel } from "./templates-review";
import { NewTemplateDialog, StartPanel, type NewTemplateInit } from "./templates-start";
import { LeaveGuard } from "@/components/ui/leave-guard";

type Dialog =
  | { kind: "new"; init: NewTemplateInit }
  | { kind: "duplicate"; source: TemplateRowView }
  | { kind: "retire"; template: TemplateRowView }
  | null;

type Filter = "all" | "live" | "draft" | "retired" | "insurvas";
type EditorTab = "questions" | "preview" | "versions";

const normalised = (t: TemplateRowView) => JSON.stringify(definitionFromDraft(draftFromDefinition(t.definition)));

function StatusPill({ t }: { t: TemplateRowView }) {
  return <LifecyclePill state={!t.tenantOwned ? "platform" : t.status === "published" ? "live" : t.status === "draft" ? "draft" : "retired"} />;
}

/** "Final Expense — our intake v3", bold, for the group lines. */
const named = (t: TemplateRowView) => <b className="font-semibold text-[var(--ink)]">{t.name} v{t.version}</b>;

/** The group's line: which template a call for this product line loads now. */
function InUseLine({ use }: { use: ProductUse | undefined }) {
  if (!use) return <>Not sold. Switch it on in Products to use it.</>;
  if (!use.general && use.carriers.length === 0) return <>Nothing published: calls for {use.productName} have no health questions.</>;
  const parts: ReactNode[] = [];
  if (use.general) {
    parts.push(
      <Fragment key="general">
        {named(use.general)}{!use.general.tenantOwned && " (Insurvas default)"} for {use.carriers.length ? "every other carrier" : "every carrier"}
        {use.fallback && ` — ${use.productName} has none of its own`}
      </Fragment>,
    );
  }
  for (const c of use.carriers) parts.push(<Fragment key={c.carrierId}>{named(c.template)} for {c.carrierName}</Fragment>);
  return <>In use now: {parts.map((p, i) => <Fragment key={i}>{i > 0 && " · "}{p}</Fragment>)}</>;
}

const STEPS = ["Pick a product", "Choose the questions", "Publish"] as const;

/**
 * The page's three steps as one progress bar (owner 2026-10-30): done steps ticked and filled,
 * the current one lit, the rest waiting. The list is step 1 (2 once a product is picked), the
 * editor step 2, the review before publishing step 3.
 */
function StepsBar({ current }: { current: 0 | 1 | 2 }) {
  return (
    <ol aria-label="Steps" className="m-0 grid list-none grid-cols-3 gap-2 p-0 sm:gap-3">
      {STEPS.map((label, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li key={label} aria-current={now ? "step" : undefined} className="flex min-w-0 flex-col gap-2">
            <span className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]">
              <span className={cn("block h-full rounded-full bg-[var(--primary)] transition-[width] duration-500 ease-out", done ? "w-full" : now ? "w-1/2" : "w-0")} />
            </span>
            <span className="flex min-w-0 items-center gap-2 text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">
              <span aria-hidden="true" className={cn("inline-grid size-6 shrink-0 place-items-center rounded-full text-xs transition-colors duration-300", done || now ? "bg-[var(--primary)] text-[var(--on-primary)]" : "bg-[var(--surface-alt)] text-[var(--ink)]")}>
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className="min-w-0 truncate"><span className="sr-only">Step {i + 1}{done ? ", done" : now ? ", now" : ""}: </span>{label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function SalesUnderwritingTemplates() {
  const api = useSalesTemplates("underwriting");
  const { payload, sample } = api;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<UwDraft | null>(null);
  const [name, setName] = useState("");
  const [questionKey, setQuestionKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [editorTab, setEditorTab] = useState<EditorTab>("questions");
  // S8: the review of a draft before it goes live replaces the tabs until it is published or left.
  const [reviewing, setReviewing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  // Front page (owner 2026-10-30, after the Quotation page): one product at a time, or All.
  const [product, setProduct] = useState<string>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLSpanElement>(null);
  const [query, setQuery] = useState("");
  // The editor's own tabs move between views of the same unsaved draft: the leave guard lets them through.
  const editorRef = useRef<HTMLElement>(null);
  const saveErrorRef = useRef<string | null>(null);

  const all = useMemo(() => payload?.templates ?? [], [payload]);
  const uses = useMemo(() => inUseNow(all, payload?.productLines ?? [], payload?.carriers ?? []), [all, payload]);
  const selected = all.find((t) => t.id === selectedId) ?? null;
  const canEdit = Boolean(payload?.canEdit);
  const readOnly = !canEdit || !selected?.tenantOwned;
  const definition = useMemo(() => (draft ? definitionFromDraft(draft) : null), [draft]);
  const dirty = Boolean(selected && definition && (JSON.stringify(definition) !== normalised(selected) || name.trim() !== selected.name));
  const problem = definition && !readOnly ? definitionProblem("underwriting", definition) : null;
  const zone = useMemo(() => viewerTimeZone(), []);

  // ── the list ──
  const isLive = (t: TemplateRowView) => t.tenantOwned && t.status === "published" && liveOf(all, t)?.id === t.id;
  const byFilter: Record<Filter, TemplateRowView[]> = useMemo(() => {
    const live = (t: TemplateRowView) => t.tenantOwned && t.status === "published" && liveOf(all, t)?.id === t.id;
    return {
      all: tableRows(all),
      live: all.filter(live),
      draft: all.filter((t) => t.tenantOwned && t.status === "draft"),
      // Every version that is no longer loaded: retired ones, and an older published one a newer replaced.
      retired: all.filter((t) => t.tenantOwned && (t.status === "retired" || (t.status === "published" && !live(t)))),
      insurvas: all.filter((t) => !t.tenantOwned),
    };
  }, [all]);
  const needle = query.trim().toLowerCase();
  const matches = (t: TemplateRowView) => !needle || [t.name, t.productName, t.carrierName ?? ""].some((s) => s.toLowerCase().includes(needle));
  const lineOrder = (code: string) => {
    const i = (payload?.productLines ?? []).findIndex((p) => p.code === code);
    return i < 0 ? 999 : i;
  };
  const shown = byFilter[filter].filter(matches).sort((a, b) => lineOrder(a.productCode) - lineOrder(b.productCode) || a.productCode.localeCompare(b.productCode)
    || Number(b.tenantOwned) - Number(a.tenantOwned) || Number(Boolean(a.carrierId)) - Number(Boolean(b.carrierId)) || (a.carrierName ?? "").localeCompare(b.carrierName ?? "")
    || a.name.localeCompare(b.name) || b.version - a.version);
  // The product chips: every line the agency sells, plus any line it has a template for; a count of
  // the templates the status filter shows in it.
  const productTabs = (() => {
    const codes = [...new Set([...uses.map((u) => u.productCode), ...byFilter[filter].map((t) => t.productCode)])].sort((a, b) => lineOrder(a) - lineOrder(b));
    return codes.map((code) => ({
      code,
      name: (payload?.productLines ?? []).find((p) => p.code === code)?.name ?? all.find((t) => t.productCode === code)?.productName ?? code,
      count: byFilter[filter].filter((t) => t.productCode === code).length,
      use: uses.find((u) => u.productCode === code),
    }));
  })();
  const picked = product === "all" ? null : productTabs.find((t) => t.code === product) ?? null;
  const rows = shown.filter((t) => !picked || t.productCode === picked.code);
  const counts: Record<Filter, number> = { all: byFilter.all.length, live: byFilter.live.length, draft: byFilter.draft.length, retired: byFilter.retired.length, insurvas: byFilter.insurvas.length };

  const open = (t: TemplateRowView) => {
    if (dirty && t.id !== selectedId) return warnUnsaved(selected?.name ?? "This template");
    setSelectedId(t.id);
    setDraft(draftFromDefinition(t.definition));
    setName(t.name);
    setQuestionKey(null);
    setSaveError(null);
    setReviewing(false);
  };
  /** Back to the list (unless there are unsaved edits). */
  const close = () => {
    if (dirty) return warnUnsaved(selected?.name ?? "This template");
    setSelectedId(null);
    setDraft(null);
    setEditorTab("questions");
    setReviewing(false);
  };
  /** Delete a version, after a confirm. One already used by interviews is refused by the server and kept. */
  const remove = async (t: TemplateRowView) => {
    const ok = await confirmAction({
      title: `Delete ${t.name} v${t.version}?`,
      description: t.status === "draft"
        ? `It's a draft no call has loaded. Its ${questionCount(t.definition)} questions are removed for good.`
        : "It is removed for good. A version interviews already used can't be deleted: it stays for their records, so retire it instead.",
      confirmLabel: "Delete template",
    });
    if (!ok) return;
    if (await api.remove(t.id) && t.id === selectedId) { setSelectedId(null); setDraft(null); }
  };
  const discard = () => { if (selected) { setDraft(draftFromDefinition(selected.definition)); setName(selected.name); setSaveError(null); } };

  const save = async () => {
    if (!selected || !definition) return;
    setSaving(true);
    const { saved, error } = await api.save(selected.id, { name: name.trim() || selected.name, definition: definition as Record<string, unknown> });
    setSaving(false);
    setSaveError(error);
    saveErrorRef.current = error;
    if (saved) { setSelectedId(saved.template.id); setDraft(draftFromDefinition(saved.template.definition)); setName(saved.template.name); }
  };

  const tenantLineageExists = (c: PairChoice) => all.some((x) => x.tenantOwned && x.productCode === c.productCode && (x.carrierId ?? null) === c.carrierId);
  const copyPlatform = async (t: TemplateRowView) => {
    const mine = all.find((x) => x.tenantOwned && x.status === "draft" && x.productCode === t.productCode && (x.carrierId ?? null) === (t.carrierId ?? null));
    if (mine) { notify.block("Your agency already has a draft of this template", { detail: `Open ${mine.name} v${mine.version} to keep editing it.` }); return; }
    const copied = await api.copy(t.id, {});
    if (copied) open(copied);
  };

  const ownerOnly = canEdit ? null : "Only an owner can change templates.";
  const lastChanged = (t: TemplateRowView) => (t.tenantOwned ? `${t.editedBy ?? "Someone"} · ${dayMonth(t.updatedAt, zone)}` : "Insurvas");
  const rowMenu = (t: TemplateRowView, isOpen: boolean) => (
    <RowMenu
      label={`${t.name} v${t.version}`}
      items={!t.tenantOwned ? [
        { label: "Copy to my agency", onSelect: () => { void copyPlatform(t); }, disabled: !canEdit, reason: ownerOnly },
      ] : [
        t.status === "draft" && !isOpen && { label: "Review & publish", onSelect: () => { open(t); setReviewing(true); }, disabled: !canEdit, reason: ownerOnly },
        !t.carrierId && t.status !== "retired" && { label: "Different questions for one carrier", onSelect: () => setDialog({ kind: "new", init: { productCode: t.productCode, carrierId: null, startFrom: "copy", sourceId: t.id, forCarrier: true } }), disabled: !canEdit, reason: ownerOnly },
        t.status === "published" && { label: "Retire", onSelect: () => setDialog({ kind: "retire", template: t }), disabled: !canEdit || (isOpen && dirty), reason: isOpen && dirty ? "Save or discard your changes first." : ownerOnly },
        { label: "Duplicate", onSelect: () => setDialog({ kind: "duplicate", source: t }), disabled: !canEdit, reason: ownerOnly },
        { label: "Delete", onSelect: () => { void remove(t); }, disabled: !canEdit, reason: ownerOnly, danger: true },
      ]}
    />
  );
  /**
   * A group's one action, when a call loads something the agency cannot change: the Insurvas
   * default made for this line is copied to the agency; a line borrowing another line's template
   * gets a new one of its own.
   */
  const groupAction = (use: ProductUse | undefined) => {
    if (!canEdit || !use) return null;
    if (!use.general || use.fallback) {
      return <Button type="button" variant="outline" size="sm" onClick={() => setDialog({ kind: "new", init: { ...newInit(), productCode: use.productCode } })}><Plus aria-hidden="true" />New {use.productName} template</Button>;
    }
    if (!use.general.tenantOwned) return <Button type="button" variant="outline" size="sm" onClick={() => { void copyPlatform(use.general!); }}>Make it yours</Button>;
    return null;
  };
  /** A row's sub-line: what it is for, and for a draft that replaces a live version, which. */
  const rowSub = (t: TemplateRowView) => {
    const live = t.tenantOwned && t.status === "draft" ? liveOf(all, t) : null;
    const loaded = usesOf(t, uses);
    return [t.carrierId ? `only ${t.carrierName ?? "one carrier"}` : "every carrier", live ? `replaces v${live.version} when published` : null, !live && t.status === "draft" ? "not used until published" : null, loaded.length && !t.tenantOwned ? "in use now" : null].filter(Boolean).join(" · ");
  };

  /** Where a new template starts: the first line the agency sells, from Insurvas's default. */
  const newInit = (): NewTemplateInit => ({ productCode: (payload?.productLines.find((p) => p.sold !== false) ?? payload?.productLines[0])?.code ?? "final_expense", carrierId: null, startFrom: "insurvas" });
  const hasOwn = all.some((t) => t.tenantOwned);
  const firstLine = uses[0];

  /** Which calls load `t` once it is live, in words (S8). */
  const publishImpact = (t: TemplateRowView) => {
    const base = liveOf(all, t);
    const live = { ...t, status: "published" as const };
    const after = inUseNow([...all.filter((x) => x.id !== base?.id && x.id !== t.id), live], payload?.productLines ?? [], payload?.carriers ?? []);
    const loads = usesOf(live, after).map((u) => u.replace(" · every other carrier", " calls with every carrier but the ones with their own").replace(" · every carrier", " calls with every carrier").replace(/^(.+) · (.+)$/, "$1 calls with $2"));
    return `${loads.length ? `New ${loads.join(", ")} load it.` : "No call loads it: another template takes these calls first."} Interviews already started keep the version they began on.${base ? ` v${base.version} is retired.` : ""}`;
  };
  /** What calls fall back to once `t` is retired (S12). */
  const retireImpact = (t: TemplateRowView) => {
    if (!usesOf(t, uses).length) return null;
    const after = inUseNow(all.filter((x) => x.id !== t.id), payload?.productLines ?? [], payload?.carriers ?? []);
    const parts = after.flatMap((u) => {
      const was = uses.find((x) => x.productCode === u.productCode);
      const out: string[] = [];
      if (was?.general?.id === t.id) out.push(u.general ? `${u.productName} calls will load ${u.general.name} v${u.general.version}${u.general.tenantOwned ? "" : " (Insurvas default)"}` : `${u.productName} calls will have no health questions`);
      for (const c of was?.carriers ?? []) {
        if (c.template.id !== t.id) continue;
        const next = u.carriers.find((x) => x.carrierId === c.carrierId)?.template ?? u.general;
        out.push(next ? `${c.carrierName} calls will load ${next.name} v${next.version}` : `${c.carrierName} calls will have no health questions`);
      }
      return out;
    });
    return parts.length ? `${parts.join("; ")}.` : null;
  };
  /** S10: an older version's questions become the next draft (into the open draft, after a confirm). */
  const restore = async (v: TemplateRowView) => {
    const openDraft = all.find((x) => lineageKey(x) === lineageKey(v) && x.status === "draft");
    if (openDraft) {
      const ok = await confirmAction({ title: `Put v${v.version}'s questions into draft v${openDraft.version}?`, description: `Draft v${openDraft.version}'s own changes are replaced by v${v.version}'s questions. Nothing goes live until you publish.`, confirmLabel: `Restore v${v.version}` });
      if (!ok) return;
    }
    const { saved, error } = await api.save(openDraft?.id ?? v.id, { definition: v.definition as Record<string, unknown> });
    if (error) notify.block(error);
    if (saved) { setSelectedId(saved.template.id); setDraft(draftFromDefinition(saved.template.definition)); setName(saved.template.name); setEditorTab("questions"); }
  };
  const publishNow = async (t: TemplateRowView) => {
    const ok = await api.publish(t.id, true, `${t.name} v${t.version} is live`, publishImpact(t));
    if (ok) { setReviewing(false); setSelectedId(null); setDraft(null); setEditorTab("questions"); }
  };

  // ── the editor ──
  const lineage = selected ? all.filter((x) => lineageKey(x) === lineageKey(selected)).sort((a, b) => b.version - a.version) : [];
  const nextVersion = lineage.length ? lineage[0].version + 1 : 1;
  // Against the saved version read the way the builder reads it, so only the owner's edits count.
  const saveSummary = selected && definition ? changesSummary(templateChanges(definitionFromDraft(draftFromDefinition(selected.definition)), definition)) : "";
  const publishBase = (t: TemplateRowView) => liveOf(all, t) ?? all.filter((x) => lineageKey(x) === lineageKey(t) && x.version < t.version).sort((a, b) => b.version - a.version)[0] ?? null;
  const selectedUses = selected ? usesOf(selected, uses) : [];
  const editorNote = !selected ? "" : selectedUses.length ? `In use now for ${[...new Set(selectedUses.map((u) => u.replace(/ · every (other )?carrier$/, "")))].join(", ")}` : selected.status === "draft" ? "Not used until it is published" : selected.status === "retired" ? "Retired: kept for the interviews that used it" : !selected.tenantOwned ? "Not in use: copy it to your agency to change and use it" : "Not in use";

  return (
    <SettingsStack>
      {/* With a template open (owner 2026-10-28): the section title, then → the template's name, its
          version and state, and its one primary action on that line; the rest under ⋯. */}
      <SalesPanelTop
        sample={sample}
        trail={selected && draft ? (
          <>
            <Button type="button" variant="ghost" size="icon" aria-label="Back to templates" title="Back to templates" onClick={close}>
              <ArrowLeft aria-hidden="true" />
            </Button>
            {readOnly ? (
              <span className="min-w-0 truncate text-title-sm font-semibold text-[var(--ink)]">{selected.name}</span>
            ) : (
              <input
                aria-label="Template name"
                className="min-w-[8ch] max-w-[24ch] flex-none [field-sizing:content] rounded-md border border-transparent bg-transparent px-2 py-1 text-title-sm font-semibold text-[var(--ink)] outline-none transition-colors hover:border-[var(--border)] focus:border-[var(--ring-color)]"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
            {/* Owner 2026-10-30: the template's views sit beside its name, not on a row of their own. */}
            {!reviewing && (
              <span className="hidden shrink-0 sm:block">
              <ViewTabs
                label="Template"
                value={editorTab}
                onChange={setEditorTab}
                tabs={[
                  { key: "questions", label: "Questions", count: questionCount(definition ?? selected.definition) },
                  { key: "preview", label: "Try it" },
                  { key: "versions", label: "Versions", count: lineage.length },
                ]}
              />
              </span>
            )}
          </>
        ) : undefined}
        actions={selected && draft ? (<>
          <span className="hidden max-w-[30ch] truncate text-sm text-[var(--body)] xl:inline" title={`${scopeOf(selected)} · ${editorNote}`}>{scopeOf(selected)} · {editorNote}</span>
          <VersionPill version={selected.version} live={isLive(selected)} />
          <StatusPill t={selected} />
          {!selected.tenantOwned ? (
            <WithReason reason={ownerOnly}>
              <Button type="button" disabled={!canEdit} onClick={() => { void copyPlatform(selected); }}>Copy to my agency</Button>
            </WithReason>
          ) : canEdit ? (
            <>
              {rowMenu(selected, true)}
              {selected.status === "draft" && (
                <WithReason reason={dirty ? "Save your changes before publishing." : problem}>
                  <Button type="button" onClick={() => setReviewing(true)} disabled={dirty || Boolean(problem) || reviewing}>Review & publish</Button>
                </WithReason>
              )}
            </>
          ) : undefined}
        </>) : canEdit && payload ? (
          <Button type="button" onClick={() => setDialog({ kind: "new", init: picked ? { ...newInit(), productCode: picked.code } : newInit() })}><Plus aria-hidden="true" />New template</Button>
        ) : undefined}
      />

      {api.schemaPending ? (
        <SalesSetupPending what="Underwriting templates" />
      ) : api.loading && !payload ? (
        <SalesLoading label="Loading templates" columns={6} />
      ) : api.error && !payload ? (
        <SalesLoadError message={api.error} onRetry={() => { void api.reload(); }} />
      ) : (
        <>
          {(saveError ?? (dirty ? problem : null)) && <Callout tone="error" title={(saveError ?? problem)!} />}
          {!canEdit && <ReadOnlyNotice what="underwriting templates" />}

          {selected && draft ? (
            <section ref={editorRef} aria-label={`Edit ${selected.name}`} className="flex flex-col gap-4">
              {!readOnly && <StepsBar current={reviewing ? 2 : 1} />}
              {/* A phone: the title row has no room for the tabs, so they lead the editor. */}
              {!reviewing && (
                <div className="sm:hidden">
                  <ViewTabs
                    label="Template"
                    value={editorTab}
                    onChange={setEditorTab}
                    tabs={[
                      { key: "questions", label: "Questions", count: questionCount(definition ?? selected.definition) },
                      { key: "preview", label: "Try it" },
                      { key: "versions", label: "Versions", count: lineage.length },
                    ]}
                  />
                </div>
              )}
              {/* Below xl the scope line has no room on the title row: it sits here, one line. */}
              <p className="m-0 text-sm text-[var(--body)] xl:hidden">{scopeOf(selected)} · {editorNote}</p>

              {reviewing && selected.status === "draft" ? (
                <ReviewPanel draft={selected} base={publishBase(selected)} impact={publishImpact(selected)} problem={problem} onBack={() => setReviewing(false)} onPublish={() => publishNow(selected)} />
              ) : editorTab === "questions" ? (
                <QuestionBuilder
                  title="Questions"
                  bank={{ templateName: selected.name, carrierName: selected.carrierId ? selected.carrierName ?? "this carrier" : null }}
                  draft={draft}
                  onChange={setDraft}
                  readOnly={readOnly}
                  selectedKey={questionKey}
                  onSelect={setQuestionKey}
                />
              ) : editorTab === "preview" ? (
                definition && <TemplatePreview key={selected.id} definition={definition} sample={sample} name={name.trim() || selected.name} version={selected.version} />
              ) : (
                <VersionsPanel
                  lineage={lineage}
                  current={selected}
                  isLive={isLive}
                  lastChanged={lastChanged}
                  canRestore={!canEdit ? ownerOnly : dirty ? "Save or discard your changes first." : null}
                  onOpen={(v) => { open(v); setEditorTab("questions"); }}
                  onRestore={(v) => { void restore(v); }}
                />
              )}

              {!readOnly && (
                <SettingsSaveBar visible={dirty} note={`${saveSummary || "Unsaved changes"}${selected.status === "draft" ? "" : ` — saving makes version ${nextVersion}, a draft`}`}>
                  <Button type="button" variant="outline" onClick={discard} disabled={saving}>Discard</Button>
                  <WithReason reason={problem}>
                    <Button type="button" onClick={() => { void save(); }} disabled={saving || Boolean(problem)}>
                      {saving ? "Saving…" : selected.status === "draft" ? "Save draft" : `Save as draft v${nextVersion}`}
                    </Button>
                  </WithReason>
                </SettingsSaveBar>
              )}
            </section>
          ) : !canEdit ? (
            <AgentTemplatesView uses={uses} onOpen={open} />
          ) : (
            <>
            {!hasOwn && firstLine && <StartPanel all={all} productCode={firstLine.productCode} productName={firstLine.productName} canEdit={canEdit} onStart={(init) => setDialog({ kind: "new", init })} />}
            <StepsBar current={picked ? 1 : 0} />
            <PagedTableCard
              key={product}
              total={rows.length}
              noun="templates"
              title={picked ? `${picked.name} templates` : "Every template, by product"}
              info="A call loads the template made for its product and carrier, else the product's own, else Insurvas's — the same choice the interview makes. An interview keeps the version it started on."
              toolbar={
                /* One row (owner 2026-10-30): search (an icon until it is used), status, then the product
                   chips, which scroll sideways in their own strip rather than wrap onto a second line. */
                <div className="flex w-full flex-wrap items-center gap-2 sm:flex-nowrap">
                  {searchOpen || query ? (
                    <span ref={searchRef} className="w-full shrink-0 sm:w-48" onBlur={(e) => { if (!query && !e.currentTarget.contains(e.relatedTarget as Node | null)) setSearchOpen(false); }}>
                      <ToolbarSearch value={query} onChange={setQuery} placeholder={picked ? `Search ${picked.name}` : "Search templates"} className="sm:w-full" />
                    </span>
                  ) : (
                    <Button type="button" variant="outline" size="icon" aria-label="Search templates" title="Search templates" className="shrink-0" onClick={() => { setSearchOpen(true); requestAnimationFrame(() => searchRef.current?.querySelector("input")?.focus()); }}>
                      <Search aria-hidden="true" />
                    </Button>
                  )}
                  <select aria-label="Status" className={cn(toolbarControl, "w-full shrink-0 sm:w-auto")} value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
                    <option value="all">Any status · {counts.all}</option>
                    <option value="live">Live · {counts.live}</option>
                    <option value="draft">Drafts · {counts.draft}</option>
                    <option value="retired">Retired · {counts.retired}</option>
                    <option value="insurvas">Insurvas · {counts.insurvas}</option>
                  </select>
                  <div className="w-full min-w-0 py-0.5 sm:flex-1 sm:overflow-x-auto sm:[scrollbar-width:thin] sm:[&_[role=radiogroup]]:flex-nowrap">
                    <Segmented
                      label="Product"
                      value={picked ? picked.code : "all"}
                      onChange={setProduct}
                      options={[{ key: "all", label: "All", count: byFilter[filter].length }, ...productTabs.map((t) => ({ key: t.code, label: t.name, count: t.count }))]}
                    />
                  </div>
                </div>
              }
            >
              {/* The picked product's line: what its calls load now, and the one way to change that. */}
              {picked && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--border)] bg-[var(--primary-soft)] px-4 py-3 text-sm leading-[1.5] text-[var(--ink)]">
                  <span className="min-w-0 flex-1"><InUseLine use={picked.use} /></span>
                  {groupAction(picked.use)}
                </div>
              )}
              {all.length === 0 ? (
                <EmptyState
                  title="No underwriting templates yet"
                  hint="Create one so agents run a health interview before they quote."
                  action={canEdit ? <Button type="button" onClick={() => setDialog({ kind: "new", init: newInit() })}><Plus aria-hidden="true" />New template</Button> : undefined}
                />
              ) : rows.length === 0 ? (
                needle || filter !== "all" ? (
                  <NoMatches noun="templates" by={needle && filter === "all" ? "search" : "filters"} onClear={() => { setQuery(""); setFilter("all"); }} />
                ) : (
                  <EmptyState
                    title={`No ${picked?.name ?? ""} template of your own yet`}
                    hint="Until you make one, its calls load the template named above."
                    action={canEdit && picked ? <Button type="button" onClick={() => setDialog({ kind: "new", init: { ...newInit(), productCode: picked.code } })}><Plus aria-hidden="true" />New {picked.name} template</Button> : undefined}
                  />
                )
              ) : (
                <>
                  <table className={cn(st.table, "hidden sm:table", picked ? "min-w-[880px]" : "min-w-[1000px]")}>
                    <thead>
                      <tr className={st.headRow}>
                        <th scope="col" className={st.th}>Template</th>
                        {!picked && <th scope="col" className={cn(st.th, "w-[130px]")}>Product</th>}
                        <th scope="col" className={cn(st.th, st.num, "w-[96px]")}>Questions</th>
                        <th scope="col" className={cn(st.th, st.num, "w-[96px]")}>Knockouts</th>
                        <th scope="col" className={cn(st.th, "w-[72px]")}>Version</th>
                        <th scope="col" className={cn(st.th, "w-[150px]")}>Status</th>
                        <th scope="col" className={cn(st.th, picked ? "w-[170px]" : "w-[140px]")}>Last changed</th>
                        <th scope="col" className={cn(st.th, "w-[1%] text-right")}><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <PagedBody className="m-seq">
                      {rows.map((t) => (
                            <tr key={t.id} className="m-row cursor-pointer" onClick={(event) => { if (!(event.target as HTMLElement).closest("button, a, [role=menu]")) open(t); }}>
                              <td className={st.td}>
                                <span className={cn(st.strong, "block")}>{t.name}</span>
                                <span className={st.sub}>{rowSub(t)}</span>
                              </td>
                              {!picked && (
                                <td className={st.td}>
                                  <button type="button" className="rounded-[6px] text-left text-[var(--ink)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]" onClick={() => setProduct(t.productCode)}>{t.productName}</button>
                                </td>
                              )}
                              <td className={cn(st.td, st.num)}>{questionCount(t.definition)}</td>
                              <td className={cn(st.td, st.num)}>{knockoutCount(t.definition)}</td>
                              <td className={st.td}><VersionPill version={t.version} live={isLive(t)} /></td>
                              <td className={st.td}><StatusPill t={t} /></td>
                              <td className={cn(st.td, "whitespace-nowrap")}>{lastChanged(t)}</td>
                              <td className={cn(st.td, "whitespace-nowrap text-right")}>
                                <span className="inline-flex gap-2">
                                  <RowAction onClick={() => open(t)} label={`${canEdit && t.tenantOwned ? "Edit" : "View"} ${t.name} v${t.version}`}>
                                    {canEdit && t.tenantOwned ? "Edit" : "View"}
                                  </RowAction>
                                  {rowMenu(t, false)}
                                </span>
                              </td>
                            </tr>
                      ))}
                    </PagedBody>
                  </table>

                  {/* A phone: the same rows stacked; under All each row names its product. */}
                  <PagedBody as="ul" className="m-0 list-none p-0 sm:hidden">
                    {rows.map((t) => (
                          <li key={t.id} className="flex items-center gap-3 border-t border-[var(--border)] px-4 py-3 first:border-t-0">
                            <span className="min-w-0 flex-1">
                              <span className={cn(st.strong, "block text-sm")}>{t.name}</span>
                              <span className={st.sub}>{picked ? rowSub(t) : `${t.productName} · ${rowSub(t)}`}</span>
                              <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--body)]">
                                <StatusPill t={t} />
                                <VersionPill version={t.version} live={isLive(t)} />
                                <span>{plural(questionCount(t.definition), "question")} · {plural(knockoutCount(t.definition), "knockout")}</span>
                              </span>
                            </span>
                            <RowAction onClick={() => open(t)} label={`${canEdit && t.tenantOwned ? "Edit" : "View"} ${t.name} v${t.version}`}>
                              {canEdit && t.tenantOwned ? "Edit" : "View"}
                            </RowAction>
                            {rowMenu(t, false)}
                          </li>
                    ))}
                  </PagedBody>
                </>
              )}
            </PagedTableCard>
            </>
          )}

          <LeaveGuard dirty={Boolean(selected && !readOnly && dirty)} scope={editorRef} onSave={async () => { await save(); return !saveErrorRef.current; }} onDiscard={discard} what="this underwriting template" />
        </>
      )}

      {dialog?.kind === "new" && payload && (
        <NewTemplateDialog
          init={dialog.init}
          all={all}
          carriers={payload.carriers}
          productLines={payload.productLines}
          api={api}
          onClose={() => setDialog(null)}
          onCreated={(t) => { setDialog(null); open(t); }}
        />
      )}
      {dialog?.kind === "duplicate" && payload && (
        <PairDialog
          title={`Duplicate ${dialog.source.name}`}
          description="The copy is a draft for another product line or carrier. The original is not changed."
          submitLabel="Duplicate"
          carriers={payload.carriers}
          productLines={payload.productLines}
          allowGeneral
          initial={{ productCode: dialog.source.productCode, carrierId: dialog.source.carrierId, name: `${dialog.source.name} (copy)` }}
          problem={(c) => (c.productCode === dialog.source.productCode && c.carrierId === dialog.source.carrierId ? "Choose a different product line or carrier. To change this template, edit it." : tenantLineageExists(c) ? "Your agency already has a template for this product and carrier." : null)}
          onClose={() => setDialog(null)}
          onSubmit={async (c) => {
            const t = await api.copy(dialog.source.id, { product_code: c.productCode, carrier_id: c.carrierId, name: c.name }, "Duplicated as a draft");
            setDialog(null);
            if (t) open(t);
          }}
        />
      )}
      {dialog?.kind === "retire" && (
        <RetireDialog
          name={dialog.template.name}
          version={dialog.template.version}
          impact={retireImpact(dialog.template)}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.retire(dialog.template.id);
            setDialog(null);
          }}
        />
      )}
    </SettingsStack>
  );
}

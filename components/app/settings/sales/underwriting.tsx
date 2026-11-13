"use client";

/**
 * Settings › Sales process › Health questions (was Underwriting templates, LA-3.1). Reads and writes
 * /api/app/settings/sales/templates?kind=underwriting; `?preview=sample` (outside production) renders the design
 * fixtures and saves nothing.
 *
 * Settings round 8 (owner pick A, sales-process board "1 · Health questions", 2026-11-12): three cards side by
 * side — the question sets (one per carrier × product), the open set's questions in the order the Interview asks
 * them, and Try it beside them. A question opens in a right sheet. One save model: every edit goes into the set's
 * draft as it is made (a live set's first edit starts version N + 1 as a draft), and Publish vN puts the draft
 * live after a review of what it changes. Interviews already started keep the version they began on.
 *
 * Knockouts rule a carrier out; the board's other outcomes (Rate up, Graded only, Postpone, a decline reason
 * code) are not in the stored template, so they are not offered here.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, RotateCcw } from "lucide-react";

import { resetConfirmOptions } from "@/components/app/settings/defaults";
import { control, SettingsSectionHeader } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { dayMonth, viewerTimeZone } from "@/lib/format/dates";
import { notify } from "@/lib/notify";
import { agoText } from "@/lib/salesSettings/salesProcess";
import { changesSummary, inUseNow, templateChanges, usesOf } from "@/lib/salesSettings/templateCoverage";
import { definitionFromDraft, draftFromDefinition, questionCount, type UwDraft } from "@/lib/salesSettings/templateDefinition";
import { definitionProblem } from "@/lib/salesSettings/templateSchemas";
import type { TemplateRowView } from "@/lib/salesSettings/views";
import { cn } from "@/lib/utils";

import { GoldCount, Pane, SelectRow, StatusLine, TabBody, TabFrame, ThreeWay, useDraftAutosave, WIDE_SHEET, type StatusTone } from "../sales-process/parts";
import { LifecyclePill, RowMenu, SalesDialog, DialogActions, SalesPanelTop, WithReason } from "./shared";
import { QuestionBank } from "./question-bank";
import { QuestionBuilder } from "./templates-builder";
import { lineageKey, liveOf, useSalesTemplates } from "./templates-data";
import { PairDialog, RetireDialog } from "./templates-dialogs";
import { TemplatePreview } from "./templates-preview";
import { ReviewPanel, VersionsPanel } from "./templates-review";
import { NewTemplateDialog, type NewTemplateInit } from "./templates-start";

type Dialog =
  | { kind: "new"; init: NewTemplateInit }
  | { kind: "duplicate"; source: TemplateRowView }
  | { kind: "retire"; template: TemplateRowView }
  | { kind: "rename" }
  | null;
type Side = "bank" | "versions" | "review" | "preview" | null;

const normalised = (t: TemplateRowView) => JSON.stringify(definitionFromDraft(draftFromDefinition(t.definition)));

function StatusPill({ t }: { t: TemplateRowView }) {
  return <LifecyclePill state={!t.tenantOwned ? "platform" : t.status === "published" ? "live" : t.status === "draft" ? "draft" : "retired"} />;
}

/** One row per set (carrier × product): its open draft, else its live version, else what is left of it. */
function setRows(all: TemplateRowView[]): TemplateRowView[] {
  const byLineage = new Map<string, TemplateRowView[]>();
  for (const t of all) byLineage.set(lineageKey(t), [...(byLineage.get(lineageKey(t)) ?? []), t]);
  const pick = (list: TemplateRowView[]) => {
    const newest = (s: TemplateRowView["status"]) => list.filter((t) => t.status === s).sort((a, b) => b.version - a.version)[0];
    return newest("draft") ?? newest("published") ?? [...list].sort((a, b) => b.version - a.version)[0];
  };
  const own = [...byLineage.values()].map(pick).filter(Boolean);
  // A platform set the agency already has its own of is not listed twice.
  return own
    .filter((t) => t.tenantOwned || !all.some((x) => x.tenantOwned && x.status !== "retired" && x.productCode === t.productCode && (x.carrierId ?? null) === (t.carrierId ?? null)))
    .sort((a, b) => Number(b.tenantOwned) - Number(a.tenantOwned) || (a.carrierName ?? "").localeCompare(b.carrierName ?? "") || a.productName.localeCompare(b.productName));
}

export function SalesUnderwritingTemplates({ focus = null }: { focus?: string | null } = {}) {
  const api = useSalesTemplates("underwriting");
  const { payload, sample } = api;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<UwDraft | null>(null);
  const [name, setName] = useState("");
  const [questionKey, setQuestionKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [side, setSide] = useState<Side>(null);
  const [query, setQuery] = useState("");
  const [renameText, setRenameText] = useState("");
  const zone = useMemo(() => viewerTimeZone(), []);

  const all = useMemo(() => payload?.templates ?? [], [payload]);
  const uses = useMemo(() => inUseNow(all, payload?.productLines ?? [], payload?.carriers ?? []), [all, payload]);
  const rows = useMemo(() => setRows(all), [all]);
  const selected = all.find((t) => t.id === selectedId) ?? null;
  const canEdit = Boolean(payload?.canEdit);
  const readOnly = !canEdit || !selected?.tenantOwned;
  const definition = useMemo(() => (draft ? definitionFromDraft(draft) : null), [draft]);
  const dirty = Boolean(selected && definition && (JSON.stringify(definition) !== normalised(selected) || (name.trim() && name.trim() !== selected.name)));
  const problem = definition && !readOnly ? definitionProblem("underwriting", definition) : null;
  const ownerOnly = canEdit ? null : "Only an owner can change health questions.";

  const load = (t: TemplateRowView) => {
    setSelectedId(t.id);
    setDraft(draftFromDefinition(t.definition));
    setName(t.name);
    setQuestionKey(null);
    setSaveError(null);
  };
  const autosave = useDraftAutosave({
    signature: JSON.stringify({ id: selected ? lineageKey(selected) : null, name: name.trim(), definition }),
    dirty,
    enabled: Boolean(selected && !readOnly && !problem && !sample),
    save: async () => {
      if (!selected || !definition) return false;
      const { saved, error } = await api.save(selected.id, { name: name.trim() || selected.name, definition: definition as Record<string, unknown> });
      setSaveError(error);
      // The edits in hand stay on screen: a save only moves the page onto the version it stored.
      if (saved) setSelectedId(saved.template.id);
      return Boolean(saved);
    },
  });
  const open = (t: TemplateRowView) => {
    if (t.id === selectedId) return;
    autosave.reset();
    load(t);
  };

  // The first set opens by itself (a wide screen never shows an empty middle); a link may name one ("set.<id>").
  const opened = useRef(false);
  useEffect(() => {
    if (!payload) return;
    const named = focus?.startsWith("set.") ? all.find((t) => t.id === focus.slice(4)) : null;
    if (named) { opened.current = true; const t = window.setTimeout(() => load(named), 0); return () => window.clearTimeout(t); }
    if (opened.current || selectedId || !rows.length) return;
    opened.current = true;
    const t = window.setTimeout(() => load(rows[0]), 0);
    return () => window.clearTimeout(t);
    // load reads the same state; it is rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, focus]);

  /** Delete a version, after a confirm. One already used by interviews is refused by the server and kept. */
  const remove = async (t: TemplateRowView) => {
    const ok = await confirmAction({
      title: `Delete ${t.name} v${t.version}?`,
      description: t.status === "draft"
        ? `It's a draft no call has loaded. Its ${questionCount(t.definition)} questions are removed for good.`
        : "It is removed for good. A version interviews already used can't be deleted: it stays for their records, so retire it instead.",
      confirmLabel: t.status === "draft" ? "Discard draft" : "Delete version",
    });
    if (!ok) return;
    if (await api.remove(t.id) && t.id === selectedId) {
      const live = liveOf(all.filter((x) => x.id !== t.id), t);
      if (live) load(live); else { setSelectedId(null); setDraft(null); }
    }
  };
  const copyPlatform = async (t: TemplateRowView) => {
    const mine = all.find((x) => x.tenantOwned && x.status === "draft" && x.productCode === t.productCode && (x.carrierId ?? null) === (t.carrierId ?? null));
    if (mine) { load(mine); return; }
    const copied = await api.copy(t.id, {});
    if (copied) load(copied);
  };

  /** Which calls load `t` once it is live, in words. */
  const publishImpact = (t: TemplateRowView) => {
    const base = liveOf(all, t);
    const live = { ...t, status: "published" as const };
    const after = inUseNow([...all.filter((x) => x.id !== base?.id && x.id !== t.id), live], payload?.productLines ?? [], payload?.carriers ?? []);
    const loads = usesOf(live, after).map((u) => u.replace(" · every other carrier", " calls with every carrier but the ones with their own").replace(" · every carrier", " calls with every carrier").replace(/^(.+) · (.+)$/, "$1 calls with $2"));
    return `${loads.length ? `New ${loads.join(", ")} load it.` : "No call loads it: another set takes these calls first."} Interviews already started keep the version they began on.${base ? ` v${base.version} is retired.` : ""}`;
  };
  /** What calls fall back to once `t` is retired. */
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
  /** An older version's questions become the next draft (into the open draft, after a confirm). */
  const restore = async (v: TemplateRowView) => {
    const openDraft = all.find((x) => lineageKey(x) === lineageKey(v) && x.status === "draft");
    if (openDraft) {
      const ok = await confirmAction({ title: `Put v${v.version}'s questions into draft v${openDraft.version}?`, description: `Draft v${openDraft.version}'s own changes are replaced by v${v.version}'s questions. Nothing goes live until you publish.`, confirmLabel: `Restore v${v.version}` });
      if (!ok) return;
    }
    const { saved, error } = await api.save(openDraft?.id ?? v.id, { definition: v.definition as Record<string, unknown> });
    if (error) notify.block(error);
    if (saved) { load(saved.template); setSide(null); }
  };
  const publishNow = async (t: TemplateRowView) => {
    const ok = await api.publish(t.id, true, `${t.name} v${t.version} is live`, publishImpact(t));
    if (ok) { setSide(null); const live = { ...t, status: "published" as const }; autosave.reset(); load(live); }
  };

  const lineage = selected ? all.filter((x) => lineageKey(x) === lineageKey(selected)).sort((a, b) => b.version - a.version) : [];
  const live = selected ? liveOf(all, selected) : null;
  const publishBase = (t: TemplateRowView) => liveOf(all, t) ?? all.filter((x) => lineageKey(x) === lineageKey(t) && x.version < t.version).sort((a, b) => b.version - a.version)[0] ?? null;
  const pair = selected ? `${selected.carrierId ? selected.carrierName ?? "One carrier" : "Every carrier"} · ${selected.productName}` : "";
  const changed = selected && definition && live && live.id !== selected.id ? changesSummary(templateChanges(definitionFromDraft(draftFromDefinition(live.definition)), definition)) : "";
  const newInit = (): NewTemplateInit => ({ productCode: (payload?.productLines.find((p) => p.sold !== false) ?? payload?.productLines[0])?.code ?? "final_expense", carrierId: null, startFrom: "insurvas" });
  const drafts = rows.filter((t) => t.tenantOwned && t.status === "draft").length;
  const lastChanged = (t: TemplateRowView) => (t.tenantOwned ? `${t.editedBy ?? "Someone"} · ${dayMonth(t.updatedAt, zone)}` : "Insurvas");

  // ── the status line: where the open set stands ──
  const status: { tone: StatusTone; text: string } = !payload ? { tone: "muted", text: "Reading your health questions" }
    : !selected ? { tone: rows.length ? "muted" : "warn", text: rows.length ? "Pick a question set" : "No health questions yet" }
    : saveError ? { tone: "bad", text: `${pair} · couldn't save to the draft: ${saveError}` }
    : dirty && problem ? { tone: "warn", text: `${pair} · not saved yet: ${problem}` }
    : autosave.state === "saving" || dirty ? { tone: "muted", text: `${pair} · saving to the draft` }
    : !selected.tenantOwned ? { tone: "muted", text: `${pair} · the Insurvas set${canEdit ? ", read-only: copy it to your agency to change it" : ""}` }
    : selected.status === "draft" ? { tone: "warn", text: `${pair} · v${selected.version} draft, not live${live ? ` · agents still see v${live.version}` : " · no call loads it yet"}${changed ? ` · ${changed}` : ""} · edited by ${selected.editedBy ?? "someone"} ${agoText(selected.updatedAt)}` }
    : selected.status === "retired" ? { tone: "muted", text: `${pair} · v${selected.version} retired, kept for the interviews that used it` }
    : { tone: "ok", text: `${pair} · v${selected.version} live · edited by ${selected.editedBy ?? "someone"} ${agoText(selected.updatedAt)}${canEdit ? " · a change starts a draft" : ""}` };

  const needle = query.trim().toLowerCase();
  const listed = rows.filter((t) => !needle || `${t.carrierName ?? "every carrier"} ${t.productName} ${t.name}`.toLowerCase().includes(needle));

  const menu = selected && canEdit && (
    <RowMenu
      label={`${pair} health questions`}
      items={!selected.tenantOwned ? [
        { label: "Versions", onSelect: () => setSide("versions") },
      ] : [
        { label: "Rename", onSelect: () => { setRenameText(name); setDialog({ kind: "rename" }); } },
        { label: "Versions", onSelect: () => setSide("versions") },
        !selected.carrierId && selected.status !== "retired" && { label: "Different questions for one carrier", onSelect: () => setDialog({ kind: "new", init: { productCode: selected.productCode, carrierId: null, startFrom: "copy", sourceId: selected.id, forCarrier: true } }) },
        { label: "Duplicate for another product or carrier", onSelect: () => setDialog({ kind: "duplicate", source: selected }) },
        live && live.tenantOwned && !selected.carrierId && all.some((t) => !t.tenantOwned && t.status === "published" && t.productCode === selected.productCode && !t.carrierId)
          && { label: "Reset to the Insurvas set", danger: true, onSelect: () => { void (async () => { if (await confirmAction(resetConfirmOptions(`the ${selected.productName} health questions`, "Your versions are retired, not deleted: interviews already started keep theirs. Carrier-specific sets stay."))) await api.resetToDefault(selected.productCode, null); })(); } },
        live && { label: `Retire v${live.version}`, danger: true, onSelect: () => setDialog({ kind: "retire", template: live }) },
        selected.status === "draft" && { label: `Discard draft v${selected.version}`, danger: true, onSelect: () => { void remove(selected); } },
      ]}
    />
  );

  const primary = !selected ? (
    canEdit && payload ? <Button type="button" variant="outline" onClick={() => setDialog({ kind: "new", init: newInit() })}><Plus aria-hidden="true" />New question set</Button> : null
  ) : (
    <>
      {!readOnly && <Button type="button" variant="outline" onClick={() => setSide("bank")}>Question bank</Button>}
      {menu}
      {!selected.tenantOwned ? (
        <WithReason reason={ownerOnly}><Button type="button" disabled={!canEdit} onClick={() => { void copyPlatform(selected); }}>Copy to my agency</Button></WithReason>
      ) : selected.status === "draft" && canEdit ? (
        <WithReason reason={dirty ? "Saving to the draft — a moment." : problem}>
          <Button type="button" disabled={dirty || Boolean(problem)} onClick={() => setSide("review")}>Publish v{selected.version}</Button>
        </WithReason>
      ) : null}
    </>
  );

  return (
    <TabFrame>
      <SettingsSectionHeader actions={primary} />
      <SalesPanelTop sample={sample} />
      {api.schemaPending ? (
        <StatusLine tone="warn">Health questions need a database update. Ask your Insurvas admin to apply the latest migrations.</StatusLine>
      ) : api.error && !payload ? (
        <StatusLine tone="bad" action={<Button type="button" variant="outline" size="sm" onClick={() => { void api.reload(); }}>Try again</Button>}>{api.error}</StatusLine>
      ) : (
        <StatusLine tone={status.tone}>{status.text}{!canEdit && payload ? " · read only: only an owner changes health questions" : ""}</StatusLine>
      )}

      <TabBody>
        <Pane
          className="lg:w-[260px] lg:shrink-0"
          title="Question sets"
          actions={canEdit && payload ? <Button type="button" variant="ghost" size="sm" onClick={() => setDialog({ kind: "new", init: newInit() })}><Plus aria-hidden="true" />New</Button> : <GoldCount value={drafts} label={`${drafts} drafts`} />}
        >
          {!payload ? <SectionLoading rows={6} columns={1} label="Loading question sets" /> : (
            <>
              {rows.length > 6 && (
                <div className="border-b border-[var(--border)] px-3 py-2">
                  <input type="search" aria-label="Find a set" placeholder="Find a carrier or product" className={cn(control, "mt-0")} value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
              )}
              {listed.map((t) => (
                <SelectRow
                  key={t.id}
                  selected={selected ? lineageKey(selected) === lineageKey(t) : false}
                  onClick={() => open(t)}
                  title={t.carrierId ? t.carrierName ?? "One carrier" : "Every carrier"}
                  sub={`${t.productName} · v${t.version}${t.status === "draft" ? " draft" : t.status === "retired" ? " retired" : ""}${t.tenantOwned ? "" : " · Insurvas"}`}
                  end={questionCount(t.definition)}
                />
              ))}
              {rows.length > 0 && listed.length === 0 && <p className="m-0 px-4 py-3 text-sm text-[var(--muted)]">No set matches.</p>}
            </>
          )}
        </Pane>

        <Pane
          className="lg:flex-1"
          title="Asked on the Interview, in this order"
          sub={selected ? `${questionCount(definition ?? selected.definition)} questions` : undefined}
          actions={selected ? <StatusPill t={selected} /> : undefined}
          footer={selected?.tenantOwned && selected.status === "draft" && canEdit ? (
            <>
              <span className="min-w-0 flex-1">Draft v{selected.version}{changed ? ` · ${changed} from v${live!.version}` : live ? ` · same questions as v${live.version}` : " · not published yet"}</span>
              {live && <Button type="button" variant="ghost" size="sm" onClick={() => setSide("review")}>See changes</Button>}
              <Button type="button" variant="outline" size="sm" onClick={() => { void remove(selected); }}>Discard draft</Button>
            </>
          ) : undefined}
        >
          {!payload ? <SectionLoading rows={7} columns={2} label="Loading questions" /> : all.length === 0 ? (
            <EmptyState
              title="No health questions yet"
              hint="Start from the Insurvas set for Final Expense, or build your own."
              action={canEdit ? <Button type="button" onClick={() => setDialog({ kind: "new", init: newInit() })}><Plus aria-hidden="true" />New question set</Button> : undefined}
            />
          ) : selected && draft ? (
            <QuestionBuilder
              layout="sheet"
              title="Questions"
              bank={{ templateName: selected.name, carrierName: selected.carrierId ? selected.carrierName ?? "this carrier" : null }}
              draft={draft}
              onChange={(next) => { setDraft(next); setSaveError(null); }}
              readOnly={readOnly}
              selectedKey={questionKey}
              onSelect={setQuestionKey}
            />
          ) : <p className="m-0 px-4 py-6 text-sm text-[var(--muted)]">Pick a question set.</p>}
        </Pane>

        <Pane
          className="lg:w-[320px] lg:shrink-0"
          title="Try it"
          sub="as the agent sees it"
          actions={selected && definition ? <Button type="button" variant="ghost" size="sm" onClick={() => setSide("preview")}>Full preview</Button> : undefined}
        >
          {selected && draft ? <TryKnockouts key={selected.id} draft={draft} carrier={selected.carrierId ? selected.carrierName ?? "this carrier" : `the ${selected.productName} carrier being quoted`} /> : <p className="m-0 px-4 py-6 text-sm text-[var(--muted)]">Open a set to try its questions.</p>}
        </Pane>
      </TabBody>

      <LeaveGuard dirty={Boolean(selected && !readOnly && dirty)} onSave={async () => { if (!selected || !definition) return false; const { saved, error } = await api.save(selected.id, { name: name.trim() || selected.name, definition: definition as Record<string, unknown> }); setSaveError(error); return Boolean(saved); }} onDiscard={() => { if (selected) load(selected); }} what="this question set" />

      {side === "bank" && selected && draft && (
        <Sheet title="Question bank" subtitle={`Tick a question to ask it on ${pair}. It joins this draft.`} onClose={() => setSide(null)} className={WIDE_SHEET}>
          <QuestionBank draft={draft} onChange={(next) => setDraft(next)} readOnly={readOnly} templateName={selected.name} />
        </Sheet>
      )}
      {side === "versions" && selected && (
        <Sheet title="Versions" subtitle={`${pair} · a published version never changes`} onClose={() => setSide(null)} className={WIDE_SHEET}>
          <VersionsPanel
            lineage={lineage}
            current={selected}
            isLive={(t) => t.tenantOwned && t.status === "published" && liveOf(all, t)?.id === t.id}
            lastChanged={lastChanged}
            canRestore={!canEdit ? ownerOnly : dirty ? "Saving to the draft — a moment." : null}
            onOpen={(v) => { setSide(null); autosave.reset(); load(v); }}
            onRestore={(v) => { void restore(v); }}
          />
        </Sheet>
      )}
      {side === "review" && selected && selected.status === "draft" && (
        <Sheet title={`Publish ${selected.name} v${selected.version}`} subtitle={pair} onClose={() => setSide(null)} className={WIDE_SHEET}>
          <ReviewPanel draft={selected} base={publishBase(selected)} impact={publishImpact(selected)} problem={problem} onBack={() => setSide(null)} onPublish={() => publishNow(selected)} />
        </Sheet>
      )}
      {side === "preview" && selected && definition && (
        <Sheet title="The Interview, as the agent sees it" subtitle={`${pair} · v${selected.version}${dirty ? ", with edits not yet saved" : ""}`} onClose={() => setSide(null)} className={WIDE_SHEET}>
          <TemplatePreview key={selected.id} definition={definition} sample={sample} name={name.trim() || selected.name} version={selected.version} />
        </Sheet>
      )}

      {dialog?.kind === "new" && payload && (
        <NewTemplateDialog init={dialog.init} all={all} carriers={payload.carriers} productLines={payload.productLines} api={api} onClose={() => setDialog(null)} onCreated={(t) => { setDialog(null); autosave.reset(); load(t); }} />
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
          problem={(c) => (c.productCode === dialog.source.productCode && c.carrierId === dialog.source.carrierId ? "Choose a different product line or carrier. To change this set, edit it." : all.some((x) => x.tenantOwned && x.productCode === c.productCode && (x.carrierId ?? null) === c.carrierId) ? "Your agency already has a set for this product and carrier." : null)}
          onClose={() => setDialog(null)}
          onSubmit={async (c) => {
            const t = await api.copy(dialog.source.id, { product_code: c.productCode, carrier_id: c.carrierId, name: c.name }, "Duplicated as a draft");
            setDialog(null);
            if (t) { autosave.reset(); load(t); }
          }}
        />
      )}
      {dialog?.kind === "retire" && (
        <RetireDialog name={dialog.template.name} version={dialog.template.version} impact={retireImpact(dialog.template)} onClose={() => setDialog(null)} onConfirm={async () => { await api.retire(dialog.template.id); setDialog(null); }} />
      )}
      {dialog?.kind === "rename" && selected && (
        <SalesDialog open onOpenChange={(o) => { if (!o) setDialog(null); }} title="Rename this set" description="The name agents see at the foot of the Interview. It goes into the draft.">
          <input aria-label="Set name" className={control} value={renameText} maxLength={120} onChange={(e) => setRenameText(e.target.value)} />
          <DialogActions>
            <Button type="button" variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button type="button" disabled={!renameText.trim()} onClick={() => { setName(renameText.trim()); setDialog(null); }}>Rename</Button>
          </DialogActions>
        </SalesDialog>
      )}
    </TabFrame>
  );
}

/**
 * Try it (the board's right card): answer the set's yes / no questions as a client would, and see whether this
 * carrier can still be quoted or a knockout rules it out, and why. Nothing is saved.
 */
function TryKnockouts({ draft, carrier }: { draft: UwDraft; carrier: string }) {
  const [answers, setAnswers] = useState<Record<string, "true" | "false">>({});
  const asked = draft.questions.filter((q) => q.type === "boolean" && !q.showWhen).slice(0, 12);
  const hits = draft.questions.filter((q) => q.knockout && answers[q.key] === q.knockout.when);
  const number = new Map(draft.questions.map((q, i) => [q.key, i + 1]));
  if (!asked.length) return <p className="m-0 px-4 py-6 text-sm text-[var(--muted)]">This set has no yes / no question to try.</p>;
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-[var(--muted)]">Answers</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => setAnswers({})}><RotateCcw aria-hidden="true" />Reset</Button>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {asked.map((q) => (
          <li key={q.key} className="flex items-center justify-between gap-2 text-sm text-[var(--ink)]">
            <span className="min-w-0 truncate" title={q.label}>{number.get(q.key)} · {q.label}</span>
            <ThreeWay label={q.label} value={answers[q.key] ?? ("" as "true")} onChange={(v) => setAnswers((a) => ({ ...a, [q.key]: v }))} options={[{ key: "true", label: "Yes" }, { key: "false", label: "No" }]} />
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1.5 rounded-[10px] border border-[var(--border)] p-3">
        <span className="text-xs text-[var(--muted)]">With these answers</span>
        <span className="flex items-center justify-between gap-2 text-sm text-[var(--ink)]">
          <span className="min-w-0 truncate">{carrier}</span>
          {hits.length ? <StatusChip tone="danger">Ruled out</StatusChip> : <StatusChip tone="good">Can quote</StatusChip>}
        </span>
        <span className="text-xs text-[var(--muted)]">
          {hits.length ? `Ruled out by question ${hits.map((q) => number.get(q.key)).join(", ")}${hits[0].knockout?.note ? `: ${hits[0].knockout.note}` : ""}. ` : ""}Nothing is saved.
        </span>
      </div>
    </div>
  );
}

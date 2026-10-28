"use client";

/**
 * Settings › Sales › Underwriting templates (LA-3.1). Reads and writes
 * /api/app/settings/sales/templates?kind=underwriting; `?preview=sample` (outside production) renders
 * the design fixtures and saves nothing.
 *
 * The board (l3-set-uw-templates): the templates table, then the question builder for the
 * template picked, then its preview. Saving a draft changes it in place; saving an edit to a live
 * version makes version N + 1 as a draft, and interviews already started keep the version they began
 * on. The preview renders the draft through the interview's own converter and question rows.
 */

import { useMemo, useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

import { Callout, SettingsStack, st } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { ViewTabs } from "@/components/ui/view-tabs";
import { notify } from "@/lib/notify";
import { definitionFromDraft, draftFromDefinition, knockoutCount, newUnderwritingDefinition, questionCount, type UwDraft } from "@/lib/salesSettings/templateDefinition";
import { definitionProblem } from "@/lib/salesSettings/templateSchemas";
import type { TemplateRowView } from "@/lib/salesSettings/views";
import { cn } from "@/lib/utils";

import {
  LifecyclePill, ReadOnlyNotice, RowAction, SalesLoadError, SalesLoading, SalesPanelTop, SalesSetupPending, VersionPill, WithReason,
  notRefreshed, warnUnsaved,
} from "./shared";
import { QuestionBuilder } from "./templates-builder";
import { liveOf, tableRows, useSalesTemplates } from "./templates-data";
import { PairDialog, PublishDialog, RetireDialog, type PairChoice } from "./templates-dialogs";
import { TemplatePreview } from "./templates-preview";
import { LeaveGuard } from "@/components/ui/leave-guard";

type Dialog =
  | { kind: "new" }
  | { kind: "duplicate"; source: TemplateRowView }
  | { kind: "publish"; template: TemplateRowView }
  | { kind: "retire"; template: TemplateRowView }
  | null;

const normalised = (t: TemplateRowView) => JSON.stringify(definitionFromDraft(draftFromDefinition(t.definition)));

function StatusPill({ t }: { t: TemplateRowView }) {
  return <LifecyclePill state={!t.tenantOwned ? "platform" : t.status === "published" ? "live" : t.status === "draft" ? "draft" : "retired"} />;
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
  const [editorTab, setEditorTab] = useState<"questions" | "preview">("questions");

  const all = useMemo(() => payload?.templates ?? [], [payload]);
  const rowsShown = useMemo(() => tableRows(all), [all]);
  const selected = all.find((t) => t.id === selectedId) ?? null;
  const canEdit = Boolean(payload?.canEdit);
  const readOnly = !canEdit || !selected?.tenantOwned;
  const definition = useMemo(() => (draft ? definitionFromDraft(draft) : null), [draft]);
  const dirty = Boolean(selected && definition && (JSON.stringify(definition) !== normalised(selected) || name.trim() !== selected.name));
  const problem = definition && !readOnly ? definitionProblem("underwriting", definition) : null;

  const open = (t: TemplateRowView) => {
    if (dirty && t.id !== selectedId) return warnUnsaved(selected?.name ?? "This template");
    setSelectedId(t.id);
    setDraft(draftFromDefinition(t.definition));
    setName(t.name);
    setQuestionKey(null);
    setSaveError(null);
  };
  /** Back to the list (unless there are unsaved edits). */
  const close = () => {
    if (dirty) return warnUnsaved(selected?.name ?? "This template");
    setSelectedId(null);
    setDraft(null);
    setEditorTab("questions");
  };
  /** Delete a version, after a confirm. One already used by interviews is refused by the server and kept. */
  const remove = async (t: TemplateRowView) => {
    const ok = await confirmAction({
      title: `Delete ${t.name} v${t.version}?`,
      description: t.status === "draft" ? "The draft and its questions are removed." : "It is removed for good. A version interviews or quotes already used is kept; retire it instead.",
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

  return (
    <SettingsStack>
      {/* With a template open (owner 2026-10-28): the section title, then → the template's name, its
          version and state, and every action on that one line; no box, no purpose line. */}
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
                className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-title-sm font-semibold text-[var(--ink)] outline-none transition-colors hover:border-[var(--border)] focus:border-[var(--ring-color)]"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
            <VersionPill version={selected.version} live={selected.tenantOwned && selected.status === "published" && liveOf(all, selected)?.id === selected.id} />
            <StatusPill t={selected} />
          </>
        ) : undefined}
        actions={selected && draft ? (
          !selected.tenantOwned ? (
            <WithReason reason={ownerOnly}>
              <Button type="button" disabled={!canEdit} onClick={() => { void copyPlatform(selected); }}>Copy to my agency</Button>
            </WithReason>
          ) : canEdit ? (
            <>
              <Button type="button" variant="outline" onClick={() => { void remove(selected); }}><Trash2 aria-hidden="true" />Delete</Button>
              {dirty && <Button type="button" variant="outline" onClick={discard} disabled={saving}>Discard</Button>}
              <WithReason reason={dirty ? problem : null}>
                <Button type="button" variant={selected.status === "draft" && !dirty ? "outline" : "default"} onClick={() => { void save(); }} disabled={!dirty || saving || Boolean(problem)}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </WithReason>
              {selected.status === "draft" && (
                <WithReason reason={dirty ? "Save your changes before publishing." : null}>
                  <Button type="button" onClick={() => setDialog({ kind: "publish", template: selected })} disabled={dirty}>Publish</Button>
                </WithReason>
              )}
            </>
          ) : undefined
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
            /* ── The editor (owner 2026-10-28): the template on its own, its name and every action on
                  one row, then the questions or the preview. The list comes back with Back. ── */
            <section aria-label={`Edit ${selected.name}`} className="flex flex-col gap-4">
              <ViewTabs
                label="Template"
                value={editorTab}
                onChange={setEditorTab}
                tabs={[
                  { key: "questions", label: "Questions", count: questionCount(definition ?? selected.definition) },
                  { key: "preview", label: "Preview" },
                ]}
              />

              {editorTab === "questions" ? (
                <QuestionBuilder
                  title="Questions"
                  bank={{ templateName: selected.name }}
                  draft={draft}
                  onChange={setDraft}
                  readOnly={readOnly}
                  selectedKey={questionKey}
                  onSelect={setQuestionKey}
                />
              ) : (
                definition && <TemplatePreview key={selected.id} definition={definition} sample={sample} name={name.trim() || selected.name} version={selected.version} />
              )}
            </section>
          ) : (
          <PagedTableCard
            total={rowsShown.length}
            noun="templates"
            title="Templates"
            toolbar={
              <DataToolbar
                actions={
                  <>
                    <WithReason reason={ownerOnly}>
                      <Button type="button" disabled={!canEdit} onClick={() => setDialog({ kind: "new" })}><Plus aria-hidden="true" />New template</Button>
                    </WithReason>
                    <RefreshButton onClick={sample ? notRefreshed : () => { void api.reload(); }} refreshing={api.loading && !sample} />
                  </>
                }
              />
            }
          >
            {rowsShown.length === 0 ? (
              <EmptyState title="No underwriting templates yet" hint="Create one, or copy the Insurvas default, so agents can run a health interview before they quote." />
            ) : (
              <table className={cn(st.table, "min-w-[720px]")}>
                <thead>
                  <tr className={st.headRow}>
                    <th scope="col" className={st.th}>Template</th>
                    <th scope="col" className={cn(st.th, st.num, "w-[96px]")}>Questions</th>
                    <th scope="col" className={cn(st.th, st.num, "w-[96px]")}>Knockouts</th>
                    <th scope="col" className={cn(st.th, "w-[72px]")}>Version</th>
                    <th scope="col" className={cn(st.th, "w-[130px]")}>Status</th>
                    <th scope="col" className={cn(st.th, "w-[1%] text-right")}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <PagedBody className="m-seq">
                  {rowsShown.map((t) => {
                    const isLive = t.tenantOwned && t.status === "published" && liveOf(all, t)?.id === t.id;
                    const isOpen = t.id === selectedId;
                    return (
                      <tr key={t.id} className={cn("m-row", isOpen && "bg-[var(--brand-50)]")}>
                        <td className={st.td}>
                          <span className={cn(st.strong, "block")}>{t.name}</span>
                        </td>
                        <td className={cn(st.td, st.num)}>{questionCount(t.definition)}</td>
                        <td className={cn(st.td, st.num)}>{knockoutCount(t.definition)}</td>
                        <td className={st.td}><VersionPill version={t.version} live={isLive} /></td>
                        <td className={st.td}><StatusPill t={t} /></td>
                        <td className={cn(st.td, "whitespace-nowrap text-right")}>
                          <span className="inline-flex gap-2">
                            <RowAction onClick={() => open(t)} label={`${canEdit && t.tenantOwned ? "Edit" : "View"} ${t.name} v${t.version}`}>
                              {canEdit && t.tenantOwned ? "Edit" : "View"}
                            </RowAction>
                            {!t.tenantOwned ? (
                              <RowAction onClick={() => { void copyPlatform(t); }} disabled={!canEdit} reason={ownerOnly}>Copy to my agency</RowAction>
                            ) : (
                              <>
                                {t.status === "published" && <RowAction onClick={() => setDialog({ kind: "retire", template: t })} disabled={!canEdit} reason={ownerOnly}>Retire</RowAction>}
                                {t.status === "draft" && <RowAction onClick={() => setDialog({ kind: "publish", template: t })} disabled={!canEdit || (isOpen && dirty)} reason={isOpen && dirty ? "Save your changes before publishing." : ownerOnly}>Publish</RowAction>}
                                <RowAction onClick={() => setDialog({ kind: "duplicate", source: t })} disabled={!canEdit} reason={ownerOnly}>Duplicate</RowAction>
                                <RowAction onClick={() => { void remove(t); }} disabled={!canEdit} reason={ownerOnly} label={`Delete ${t.name} v${t.version}`}><Trash2 aria-hidden="true" /></RowAction>
                              </>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </PagedBody>
              </table>
            )}
          </PagedTableCard>
          )}

          <LeaveGuard dirty={Boolean(selected && !readOnly && dirty)} onDiscard={discard} what="this underwriting template" />
        </>
      )}

      {dialog?.kind === "new" && payload && (
        <PairDialog
          title="New underwriting template"
          description="It starts with the five persistency questions. Add the health questions, then publish it."
          submitLabel="Create draft"
          carriers={payload.carriers}
          productLines={payload.productLines}
          allowGeneral
          initial={{ productCode: (payload.productLines.find((p) => p.sold !== false) ?? payload.productLines[0])?.code ?? "final_expense", carrierId: null, name: "" }}
          problem={(c) => (tenantLineageExists(c) ? "Your agency already has a template for this product and carrier. Edit or duplicate it instead." : null)}
          onClose={() => setDialog(null)}
          onSubmit={async (c) => {
            const t = await api.create({ product_code: c.productCode, carrier_id: c.carrierId, name: c.name, definition: newUnderwritingDefinition() as Record<string, unknown> });
            setDialog(null);
            if (t) open(t);
          }}
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
      {dialog?.kind === "publish" && (
        <PublishDialog
          name={dialog.template.name}
          version={dialog.template.version}
          liveVersion={liveOf(all, dialog.template)?.version ?? null}
          onClose={() => setDialog(null)}
          onConfirm={async (retirePrevious) => { await api.publish(dialog.template.id, retirePrevious); setDialog(null); }}
        />
      )}
      {dialog?.kind === "retire" && (
        <RetireDialog
          name={dialog.template.name}
          version={dialog.template.version}
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

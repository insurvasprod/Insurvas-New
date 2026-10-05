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
import { Plus } from "lucide-react";

import { Callout, Field, SettingsStack, control, st } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { TableCard } from "@/components/ui/table-card";
import { notify } from "@/lib/notify";
import { definitionFromDraft, draftFromDefinition, knockoutCount, newUnderwritingDefinition, questionCount, type UwDraft } from "@/lib/salesSettings/templateDefinition";
import { definitionProblem } from "@/lib/salesSettings/templateSchemas";
import type { TemplateRowView } from "@/lib/salesSettings/views";
import { cn } from "@/lib/utils";

import {
  DiscardSave, LifecyclePill, ReadOnlyNotice, RowAction, SalesLoadError, SalesLoading, SalesPanelTop, SalesSetupPending, VersionPill, WithReason,
  notRefreshed, shortDay, warnUnsaved,
} from "./shared";
import { QuestionBuilder } from "./templates-builder";
import { lineageKey, liveOf, tableRows, useSalesTemplates } from "./templates-data";
import { PairDialog, PublishDialog, RetireDialog, type PairChoice } from "./templates-dialogs";
import { TemplatePreview } from "./templates-preview";

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
  /** The row's Edit / View opens it; on the open row it closes it (unless there are unsaved edits). */
  const toggle = (t: TemplateRowView) => {
    if (t.id !== selectedId) return open(t);
    if (dirty) return warnUnsaved(t.name);
    setSelectedId(null);
    setDraft(null);
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

  /** The carriers a general (carrier-less) template serves: every listed carrier without its own. */
  const coverage = (t: TemplateRowView) => {
    if (t.carrierName) return t.carrierName;
    const own = new Set(all.filter((x) => x.tenantOwned && x.carrierId && x.productCode === t.productCode && x.status === "published").map((x) => x.carrierId));
    const names = (payload?.carriers ?? []).filter((c) => !own.has(c.id)).map((c) => c.name);
    if (!names.length) return "Every carrier";
    return names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
  };
  const subLine = (t: TemplateRowView) => {
    if (!t.tenantOwned) return "Shipped by Insurvas · read-only";
    if (t.status === "published") return `${coverage(t)} · live since ${shortDay(t.publishedAt)}`;
    if (t.status === "draft") return `${coverage(t)} · edited${t.editedBy ? ` by ${t.editedBy}` : ""}, ${shortDay(t.updatedAt)}`;
    return `${coverage(t)} · retired`;
  };
  const statusLine = (t: TemplateRowView) => {
    if (!t.tenantOwned) return "Insurvas default · copy it to your agency to change it";
    if (dirty) return "unsaved edits";
    if (t.status === "published") return `live · saving makes version ${Math.max(...all.filter((x) => lineageKey(x) === lineageKey(t)).map((x) => x.version)) + 1}, a draft`;
    if (t.status === "draft") return `draft · saved ${shortDay(t.updatedAt)}`;
    return "retired · saving makes a new draft version";
  };

  const nextVersion = selected ? Math.max(...all.filter((x) => lineageKey(x) === lineageKey(selected)).map((x) => x.version)) + 1 : 0;
  const saveNote = !selected ? undefined
    : selected.status === "draft" ? `Unsaved changes to ${selected.name}`
    : `Unsaved changes — saving makes version ${nextVersion}, a draft`;

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
      <SalesPanelTop sample={sample} />

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

          <TableCard
            title="Templates"
            description="One template per product and audience. Only a live version can be loaded by an interview."
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
              <table className={cn(st.table, "min-w-[860px]")}>
                <thead>
                  <tr className={st.headRow}>
                    <th scope="col" className={st.th}>Template</th>
                    <th scope="col" className={cn(st.th, st.num, "w-[96px]")}>Questions</th>
                    <th scope="col" className={cn(st.th, st.num, "w-[96px]")}>Knockouts</th>
                    <th scope="col" className={cn(st.th, "w-[72px]")}>Version</th>
                    <th scope="col" className={cn(st.th, "w-[130px]")}>Status</th>
                    <th scope="col" className={cn(st.th, "w-[240px] text-right")}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {rowsShown.map((t) => {
                    const isLive = t.tenantOwned && t.status === "published" && liveOf(all, t)?.id === t.id;
                    const isOpen = t.id === selectedId;
                    return (
                      <tr key={t.id} className={cn("m-row", isOpen && "bg-[var(--brand-50)]")}>
                        <td className={st.td}>
                          <span className={cn(st.strong, "block")}>{t.name}</span>
                          <span className={st.sub}>{subLine(t)}</span>
                        </td>
                        <td className={cn(st.td, st.num)}>{questionCount(t.definition)}</td>
                        <td className={cn(st.td, st.num)}>{knockoutCount(t.definition)}</td>
                        <td className={st.td}><VersionPill version={t.version} live={isLive} /></td>
                        <td className={st.td}><StatusPill t={t} /></td>
                        <td className={cn(st.td, "whitespace-nowrap text-right")}>
                          <span className="inline-flex gap-2">
                            {!t.tenantOwned ? (
                              <RowAction onClick={() => { void copyPlatform(t); }} disabled={!canEdit} reason={ownerOnly}>Copy to my agency</RowAction>
                            ) : (
                              <>
                                {t.status === "published" && <RowAction onClick={() => setDialog({ kind: "retire", template: t })} disabled={!canEdit} reason={ownerOnly}>Retire</RowAction>}
                                {t.status === "draft" && <RowAction onClick={() => setDialog({ kind: "publish", template: t })} disabled={!canEdit || (isOpen && dirty)} reason={isOpen && dirty ? "Save your changes before publishing." : ownerOnly}>Publish</RowAction>}
                                <RowAction onClick={() => setDialog({ kind: "duplicate", source: t })} disabled={!canEdit} reason={ownerOnly}>Duplicate</RowAction>
                              </>
                            )}
                            <RowAction onClick={() => toggle(t)} label={`${isOpen ? "Close" : canEdit && t.tenantOwned ? "Edit" : "View"} ${t.name} v${t.version}`}>
                              {isOpen ? "Close" : canEdit && t.tenantOwned ? "Edit" : "View"}
                            </RowAction>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </TableCard>

          {selected && draft && (
            <QuestionBuilder
              title="The question builder"
              sub={`${selected.name} · v${selected.version} · ${statusLine(selected)}`}
              draft={draft}
              onChange={setDraft}
              readOnly={readOnly}
              selectedKey={questionKey}
              onSelect={setQuestionKey}
            >
              {!readOnly && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Template name" htmlFor="uw-name" required>
                    <input id="uw-name" className={control} value={name} onChange={(e) => setName(e.target.value)} />
                  </Field>
                  <Field label="Product and carrier" htmlFor="uw-scope" hint="Duplicate the template to use it for another product or carrier.">
                    <input id="uw-scope" className={control} disabled value={`${selected.productName} · ${selected.carrierName ?? "every carrier without its own"}`} />
                  </Field>
                </div>
              )}
            </QuestionBuilder>
          )}

          {selected && definition && <TemplatePreview key={selected.id} definition={definition} sample={sample} />}

          <SettingsSaveBar visible={Boolean(selected && !readOnly && dirty)} note={saveNote}>
            <DiscardSave saving={saving} problem={problem} onDiscard={discard} onSave={() => { void save(); }} />
          </SettingsSaveBar>
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
          initial={{ productCode: payload.productLines[0]?.code ?? "final_expense", carrierId: null, name: "" }}
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

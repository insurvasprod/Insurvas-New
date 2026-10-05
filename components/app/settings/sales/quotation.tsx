"use client";

/**
 * Settings › Sales › Quotation templates (LA-3.4). Reads and writes
 * /api/app/settings/sales/templates?kind=quotation; `?preview=sample` (outside production) renders the
 * design fixtures and saves nothing.
 *
 * The board (l3-set-quotation-templates): one row per carrier × product, and for the pair picked, the
 * inputs the Quote step asks for, the age basis and how long a quote stays valid. Publishing makes an
 * immutable version; a saved quote keeps the (template, version) it was made with. The generic Final
 * Expense template is the platform default every pair without its own falls back to. No rate tables.
 */

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

import { Callout, Field, SettingsCard, SettingsStack, ToggleRow, control, st } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { TableCard } from "@/components/ui/table-card";
import { notify } from "@/lib/notify";
import type { StoredDefinition } from "@/lib/applications/templates";
import { QUOTE_INPUTS, quoteInputsOn, quoteInputsSummary, quoteValidDays, withQuoteInputs } from "@/lib/salesSettings/templateDefinition";
import { definitionProblem, QUOTE_VALID_DAYS } from "@/lib/salesSettings/templateSchemas";
import type { TemplateRowView } from "@/lib/salesSettings/views";
import { cn } from "@/lib/utils";

import {
  DiscardSave, LifecyclePill, ReadOnlyNotice, RowAction, SalesLoadError, SalesLoading, SalesPanelTop, SalesSetupPending, VersionPill, WithReason,
  notRefreshed, warnUnsaved,
} from "./shared";
import { lineageKey, liveOf, tableRows, useSalesTemplates } from "./templates-data";
import { PairDialog, PublishDialog, RetireDialog } from "./templates-dialogs";

// The Quote step reads the premium per $1,000 of face and prices the age from the date of birth, so a
// template without either cannot save a quote. The server refuses one too (templateSchemas).
const ALWAYS_ASKED = new Set(["face_amount", "dob"]);
const withAlwaysAsked = (keys: string[]) => [...new Set([...keys, ...ALWAYS_ASKED])];

type AgeBasis = "nearest" | "last";
const AGE_BASIS_LABEL: Record<AgeBasis, string> = { nearest: "Nearest birthday", last: "Last birthday" };
const DEFAULT_INPUTS = ["dob", "gender", "state", "tobacco", "face_amount", "tier"];

const ageBasisOf = (def: StoredDefinition | null | undefined): AgeBasis => (def?.age_basis === "last" ? "last" : "nearest");
const stored = (t: TemplateRowView) => JSON.stringify(withQuoteInputs(t.definition, quoteInputsOn(t.definition), ageBasisOf(t.definition), quoteValidDays(t.definition)));

type Dialog = { kind: "pair" } | { kind: "publish"; template: TemplateRowView } | { kind: "retire"; template: TemplateRowView } | null;

export function SalesQuotationTemplates() {
  const api = useSalesTemplates("quotation");
  const { payload, sample } = api;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [on, setOn] = useState<string[]>([]);
  const [ageBasis, setAgeBasis] = useState<AgeBasis>("nearest");
  const [validDays, setValidDays] = useState(30);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const all = useMemo(() => payload?.templates ?? [], [payload]);
  const rowsShown = useMemo(() => tableRows(all), [all]);
  const selected = all.find((t) => t.id === selectedId) ?? null;
  const canEdit = Boolean(payload?.canEdit);
  const readOnly = !canEdit || !selected?.tenantOwned;
  const definition = useMemo(() => (selected ? withQuoteInputs(selected.definition, on, ageBasis, validDays) : null), [selected, on, ageBasis, validDays]);
  const dirty = Boolean(selected && definition && JSON.stringify(definition) !== stored(selected));
  const problem = definition && !readOnly ? definitionProblem("quotation", definition) : null;

  const open = (t: TemplateRowView) => {
    if (dirty && t.id !== selectedId) return warnUnsaved(selected ? `${carrierLabel(selected)} · ${productLabel(selected)}` : "This template");
    setSelectedId(t.id);
    setOn(withAlwaysAsked(quoteInputsOn(t.definition)));
    setAgeBasis(ageBasisOf(t.definition));
    setValidDays(quoteValidDays(t.definition));
    setSaveError(null);
  };
  const discard = () => { if (selected) open(selected); };
  /** The row's Edit / View opens it; on the open row it closes it (unless there are unsaved edits). */
  const toggle = (t: TemplateRowView) => {
    if (t.id !== selectedId) return open(t);
    if (dirty) return warnUnsaved(`${carrierLabel(t)} · ${productLabel(t)}`);
    setSelectedId(null);
  };
  const save = async () => {
    if (!selected || !definition) return;
    setSaving(true);
    const { saved, error } = await api.save(selected.id, { definition: definition as Record<string, unknown> });
    setSaving(false);
    setSaveError(error);
    if (saved) {
      setSelectedId(saved.template.id);
      setOn(withAlwaysAsked(quoteInputsOn(saved.template.definition)));
    }
  };

  const carrierLabel = (t: TemplateRowView) => t.carrierName ?? "Every carrier";
  const productLabel = (t: TemplateRowView) => {
    if (!t.carrierId) return t.productName;
    const names = (payload?.carrierProducts ?? []).filter((p) => p.carrierId === t.carrierId && p.productCode === t.productCode).map((p) => p.name);
    return names.length ? names.join(", ") : t.productName;
  };
  const copyPlatform = async (t: TemplateRowView) => {
    const mine = all.find((x) => x.tenantOwned && x.status === "draft" && x.productCode === t.productCode && (x.carrierId ?? null) === (t.carrierId ?? null));
    if (mine) { notify.block("Your agency already has a draft of this template", { detail: `Open ${carrierLabel(mine)} · ${productLabel(mine)} to keep editing it.` }); return; }
    const copied = await api.copy(t.id, {});
    if (copied) open(copied);
  };
  /** What a new pair starts from: the agency's generic template if it has one live, else the platform's. */
  const startingPoint = (productCode: string) => {
    const generic = all.filter((t) => !t.carrierId && t.productCode === productCode && t.status === "published").sort((a, b) => Number(b.tenantOwned) - Number(a.tenantOwned) || b.version - a.version)[0]
      ?? all.filter((t) => !t.carrierId && t.status === "published").sort((a, b) => Number(b.tenantOwned) - Number(a.tenantOwned) || b.version - a.version)[0];
    return generic ? withQuoteInputs(generic.definition, quoteInputsOn(generic.definition), ageBasisOf(generic.definition), quoteValidDays(generic.definition)) : withQuoteInputs(null, DEFAULT_INPUTS, "nearest", 30);
  };

  const ownerOnly = canEdit ? null : "Only an owner can change templates.";
  const shownProblem = saveError ?? (dirty ? problem : null);
  const nextVersion = selected ? Math.max(...all.filter((x) => lineageKey(x) === lineageKey(selected)).map((x) => x.version)) + 1 : 0;

  return (
    <SettingsStack>
      <SalesPanelTop sample={sample} />

      {api.schemaPending ? (
        <SalesSetupPending what="Quotation templates" />
      ) : api.loading && !payload ? (
        <SalesLoading label="Loading quotation templates" columns={6} />
      ) : api.error && !payload ? (
        <SalesLoadError message={api.error} onRetry={() => { void api.reload(); }} />
      ) : (
        <>
          {shownProblem && <Callout tone="error" title={shownProblem} />}
          {!canEdit && <ReadOnlyNotice what="quotation templates" />}

          <TableCard
            title="What each carrier and product needs"
            description="One row per pair. A pair with no template falls back to the platform one."
            toolbar={
              <DataToolbar
                actions={
                  <>
                    <WithReason reason={ownerOnly}>
                      <Button type="button" disabled={!canEdit} onClick={() => setDialog({ kind: "pair" })}><Plus aria-hidden="true" />Add a pair</Button>
                    </WithReason>
                    <RefreshButton onClick={sample ? notRefreshed : () => { void api.reload(); }} refreshing={api.loading && !sample} />
                  </>
                }
              />
            }
          >
            {rowsShown.length === 0 ? (
              <EmptyState title="No quotation templates yet" hint="The generic Final Expense template ships with every agency. Ask support if it is missing." />
            ) : (
              <table className={cn(st.table, "min-w-[900px]")}>
                <thead>
                  <tr className={st.headRow}>
                    <th scope="col" className={cn(st.th, "w-[128px]")}>Carrier</th>
                    <th scope="col" className={cn(st.th, "w-[132px]")}>Product</th>
                    <th scope="col" className={st.th}>Required inputs</th>
                    <th scope="col" className={cn(st.th, "w-[128px]")}>Age basis</th>
                    <th scope="col" className={cn(st.th, "w-[78px]")}>Version</th>
                    <th scope="col" className={cn(st.th, "w-[130px]")}>Status</th>
                    <th scope="col" className={cn(st.th, "w-[200px] text-right")}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {rowsShown.map((t) => {
                    const isOpen = t.id === selectedId;
                    const verb = isOpen ? "Close" : canEdit && t.tenantOwned ? "Edit" : "View";
                    return (
                      <tr key={t.id} className={cn("m-row", isOpen && "bg-[var(--brand-50)]")}>
                        <td className={st.td}><span className={st.strong}>{carrierLabel(t)}</span></td>
                        <td className={st.td}>{productLabel(t)}</td>
                        <td className={st.td}>{quoteInputsSummary(t.definition)}</td>
                        <td className={st.td}>{AGE_BASIS_LABEL[ageBasisOf(t.definition)]}</td>
                        <td className={st.td}><VersionPill version={t.version} live={t.tenantOwned && t.status === "published" && liveOf(all, t)?.id === t.id} /></td>
                        <td className={st.td}><LifecyclePill state={!t.tenantOwned ? "platform" : t.status === "published" ? "live" : t.status === "draft" ? "draft" : "retired"} /></td>
                        <td className={cn(st.td, "whitespace-nowrap text-right")}>
                          <span className="inline-flex gap-2">
                            {!t.tenantOwned && (
                              <RowAction onClick={() => { void copyPlatform(t); }} disabled={!canEdit} reason={ownerOnly}>Copy to my agency</RowAction>
                            )}
                            {t.tenantOwned && t.status === "published" && (
                              <RowAction onClick={() => setDialog({ kind: "retire", template: t })} disabled={!canEdit} reason={ownerOnly}>Retire</RowAction>
                            )}
                            {t.tenantOwned && t.status === "draft" && (
                              <RowAction onClick={() => setDialog({ kind: "publish", template: t })} disabled={!canEdit || (isOpen && dirty)} reason={isOpen && dirty ? "Save your changes before publishing." : ownerOnly}>Publish</RowAction>
                            )}
                            <RowAction onClick={() => toggle(t)} label={`${verb} ${carrierLabel(t)} · ${productLabel(t)} v${t.version}`}>{verb}</RowAction>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </TableCard>

          {selected && (
            <SettingsCard
              title={`${carrierLabel(selected)} · ${productLabel(selected)} · v${selected.version}`}
              sub="Switch an input on and the Quote step asks for it. Switch it off and it is not asked, not stored."
            >
              <div className="flex flex-col gap-5">
                <div className="grid gap-[18px] sm:grid-cols-2">
                  {QUOTE_INPUTS.map((input) => {
                    const always = ALWAYS_ASKED.has(input.key);
                    return (
                      <ToggleRow
                        key={input.key}
                        id={`qt-${input.key}`}
                        title={input.title}
                        help={always ? `${input.hint} Always asked: a quote cannot be saved without it.` : input.hint}
                        checked={always || on.includes(input.key)}
                        disabled={readOnly || always}
                        onChange={(next) => setOn((prev) => (next ? [...prev, input.key] : prev.filter((k) => k !== input.key)))}
                      />
                    );
                  })}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Age basis" htmlFor="qt-age-basis" hint="Nearest birthday ages a client up six months before their birthday, which changes the band and the premium.">
                    <select id="qt-age-basis" className={control} value={ageBasis} disabled={readOnly} onChange={(e) => setAgeBasis(e.target.value as AgeBasis)}>
                      <option value="nearest">{AGE_BASIS_LABEL.nearest}</option>
                      <option value="last">{AGE_BASIS_LABEL.last}</option>
                    </select>
                  </Field>
                  <Field label="Quote is valid for" htmlFor="qt-valid" hint="After this a quote is shown struck through on the case, never silently repriced.">
                    <select id="qt-valid" className={control} value={validDays} disabled={readOnly} onChange={(e) => setValidDays(Number(e.target.value))}>
                      {[30, ...QUOTE_VALID_DAYS.filter((d) => d !== 30)].map((d) => <option key={d} value={d}>{d} days</option>)}
                    </select>
                  </Field>
                </div>
              </div>
            </SettingsCard>
          )}

          <SettingsSaveBar
            visible={Boolean(selected && !readOnly && dirty)}
            note={selected?.status === "draft" ? `Unsaved changes to ${carrierLabel(selected)} · ${productLabel(selected)}` : `Unsaved changes — saving makes version ${nextVersion}, a draft`}
          >
            <DiscardSave saving={saving} problem={problem} onDiscard={discard} onSave={() => { void save(); }} />
          </SettingsSaveBar>
        </>
      )}

      {dialog?.kind === "pair" && payload && (
        <PairDialog
          title="Add a pair"
          description="A quotation template for one carrier and product line. It starts from the generic template; publish it when it is right."
          submitLabel="Create draft"
          carriers={payload.carriers}
          productLines={payload.productLines}
          allowGeneral={false}
          withName={false}
          initial={{ productCode: payload.productLines[0]?.code ?? "final_expense", carrierId: payload.carriers[0]?.id ?? null, name: "" }}
          problem={(c) => (all.some((x) => x.tenantOwned && x.productCode === c.productCode && x.carrierId === c.carrierId) ? "That pair already has a template. Edit it from the table." : null)}
          onClose={() => setDialog(null)}
          onSubmit={async (c) => {
            const carrier = payload.carriers.find((x) => x.id === c.carrierId)?.name ?? "Carrier";
            const line = payload.productLines.find((x) => x.code === c.productCode)?.name ?? c.productCode;
            const t = await api.create({ product_code: c.productCode, carrier_id: c.carrierId, name: `${carrier} · ${line}`, definition: startingPoint(c.productCode) as Record<string, unknown> });
            setDialog(null);
            if (t) open(t);
          }}
        />
      )}
      {dialog?.kind === "publish" && (
        <PublishDialog
          name={`${carrierLabel(dialog.template)} · ${productLabel(dialog.template)}`}
          version={dialog.template.version}
          liveVersion={liveOf(all, dialog.template)?.version ?? null}
          onClose={() => setDialog(null)}
          onConfirm={async (retirePrevious) => { await api.publish(dialog.template.id, retirePrevious); setDialog(null); }}
        />
      )}
      {dialog?.kind === "retire" && (
        <RetireDialog
          name={`${carrierLabel(dialog.template)} · ${productLabel(dialog.template)}`}
          version={dialog.template.version}
          onClose={() => setDialog(null)}
          onConfirm={async () => { await api.retire(dialog.template.id); setDialog(null); }}
        />
      )}
    </SettingsStack>
  );
}

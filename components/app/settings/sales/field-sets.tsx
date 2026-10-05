"use client";

/**
 * Settings › Sales › Application field sets (LA-3.7). Reads and writes
 * /api/app/settings/sales/templates?kind=application_field_set; `?preview=sample` (outside
 * production) renders the design fixtures and saves nothing.
 *
 * The board (l3-set-field-sets): one row per carrier and product on the agency's list, each showing
 * the set the application actually uses — the agency's own, else the platform Final Expense set —
 * and, for the row picked, its fields: canonical key, the carrier's label for it, type, required and
 * sensitive handling. One row per field is stored, so a new carrier field needs no migration.
 */

import { useMemo, useState } from "react";
import { Lock, Plus, Trash2 } from "lucide-react";

import { Callout, Pill, SettingsStack, control, st } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { TableCard } from "@/components/ui/table-card";
import { fieldMeta, fieldSetEntries, fieldSetFromEntries, type FieldSetEntry } from "@/lib/salesSettings/templateDefinition";
import { definitionProblem, FIELD_SET_KEYS } from "@/lib/salesSettings/templateSchemas";
import type { TemplateRowView } from "@/lib/salesSettings/views";
import { isSensitiveKey } from "@/lib/applications/constants";
import { cn } from "@/lib/utils";

import {
  DiscardSave, LifecyclePill, ReadOnlyNotice, RowAction, SalesLoadError, SalesLoading, SalesPanelTop, SalesSetupPending, WithReason, checkbox,
  notRefreshed, warnUnsaved,
} from "./shared";
import { liveOf, useSalesTemplates } from "./templates-data";
import { PairDialog, PublishDialog, RetireDialog } from "./templates-dialogs";

type SetRow = {
  key: string;
  carrierId: string | null;
  carrierName: string;
  productCode: string;
  productLabel: string;
  /** The agency's own set for this pair: its open draft, else its live version. */
  own: TemplateRowView | null;
  /** What an application for this pair uses right now. */
  inUse: TemplateRowView | null;
  /** The agency's own live version for this pair, if any — what Retire retires. */
  liveOwn: TemplateRowView | null;
};

type Dialog = { kind: "add" } | { kind: "publish"; template: TemplateRowView } | { kind: "retire"; template: TemplateRowView } | null;

const newestOf = (list: TemplateRowView[]) => [...list].sort((a, b) => b.version - a.version)[0] ?? null;
const storedJson = (t: TemplateRowView) => JSON.stringify(fieldSetFromEntries(fieldSetEntries(t.definition)));

export function SalesFieldSets() {
  const api = useSalesTemplates("application_field_set");
  const { payload, sample } = api;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [entries, setEntries] = useState<FieldSetEntry[]>([]);
  const [adding, setAdding] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const all = useMemo(() => payload?.templates ?? [], [payload]);
  const canEdit = Boolean(payload?.canEdit);

  const rowsShown = useMemo<SetRow[]>(() => {
    if (!payload) return [];
    const lineName = new Map(payload.productLines.map((p) => [p.code, p.name]));
    const pick = (tenant: boolean, carrierId: string | null, code: string, statuses: string[]) =>
      newestOf(all.filter((t) => t.tenantOwned === tenant && (t.carrierId ?? null) === carrierId && t.productCode === code && statuses.includes(t.status)));
    const platformGeneric = pick(false, null, "final_expense", ["published"]);
    const make = (carrierId: string | null, carrierName: string, code: string): SetRow => {
      const names = payload.carrierProducts.filter((p) => p.carrierId === carrierId && p.productCode === code).map((p) => p.name);
      const own = pick(true, carrierId, code, ["draft"]) ?? pick(true, carrierId, code, ["published"]);
      const inUse = pick(true, carrierId, code, ["published"]) ?? pick(false, carrierId, code, ["published"]) ?? pick(false, null, code, ["published"]) ?? platformGeneric;
      return { key: `${carrierId ?? ""}|${code}`, carrierId, carrierName, productCode: code, productLabel: names.length ? names.join(", ") : lineName.get(code) ?? code, own, inUse, liveOwn: pick(true, carrierId, code, ["published"]) };
    };
    const out: SetRow[] = [];
    for (const c of payload.carriers) {
      const codes = [...new Set(payload.carrierProducts.filter((p) => p.carrierId === c.id).map((p) => p.productCode))];
      for (const code of codes.length ? codes : ["final_expense"]) out.push(make(c.id, c.name, code));
    }
    // The agency's sets for a pair not on the list above (a carrier-less set, or a product line added here).
    for (const t of all.filter((x) => x.tenantOwned)) {
      const key = `${t.carrierId ?? ""}|${t.productCode}`;
      if (!out.some((r) => r.key === key)) out.push(make(t.carrierId, t.carrierName ?? "Every carrier", t.productCode));
    }
    return out;
  }, [payload, all]);

  const selected = rowsShown.find((r) => r.key === selectedKey) ?? null;
  const editing = selected?.own ?? null;
  const shown = editing ?? selected?.inUse ?? null;
  const readOnly = !canEdit || !editing;
  const definition = useMemo(() => fieldSetFromEntries(entries), [entries]);
  const dirty = Boolean(editing && JSON.stringify(definition) !== storedJson(editing));
  const problem = editing && !readOnly ? definitionProblem("application_field_set", definition) : null;

  const open = (r: SetRow) => {
    if (dirty && r.key !== selectedKey) return warnUnsaved(selected ? `The ${selected.carrierName} · ${selected.productLabel} field set` : "This field set");
    setSelectedKey(r.key);
    setEntries(fieldSetEntries((r.own ?? r.inUse)?.definition));
    setAdding("");
    setSaveError(null);
  };
  const discard = () => { if (selected) open(selected); };
  /** The row's Edit / View opens it; on the open row it closes it (unless there are unsaved edits). */
  const toggle = (r: SetRow) => {
    if (r.key !== selectedKey) return open(r);
    if (dirty) return warnUnsaved(`The ${r.carrierName} · ${r.productLabel} field set`);
    setSelectedKey(null);
  };
  const patch = (key: string, p: Partial<FieldSetEntry>) => setEntries((list) => list.map((e) => (e.key === key ? { ...e, ...p } : e)));
  const add = (key: string) => {
    if (!key) return;
    const meta = fieldMeta(key);
    const next = [...entries, { key, canonicalLabel: meta.label, label: meta.label, typeLabel: meta.type, required: false, sensitive: isSensitiveKey(key) }];
    setEntries(FIELD_SET_KEYS.flatMap((k) => next.filter((e) => e.key === k)));
    setAdding("");
  };
  const save = async () => {
    if (!editing) return;
    setSaving(true);
    const { saved, error } = await api.save(editing.id, { definition: definition as Record<string, unknown> });
    setSaving(false);
    setSaveError(error);
    if (saved) setEntries(fieldSetEntries(saved.template.definition));
  };
  const copyFor = async (r: SetRow) => {
    if (!r.inUse) return;
    const copied = await api.copy(r.inUse.id, { product_code: r.productCode, carrier_id: r.carrierId, name: `${r.carrierName} · ${r.productLabel}` }, "Copied to your agency as a draft");
    if (copied) {
      setSelectedKey(r.key);
      setEntries(fieldSetEntries(copied.definition));
    }
  };

  const missing = FIELD_SET_KEYS.filter((k) => !entries.some((e) => e.key === k));
  const ownerOnly = canEdit ? null : "Only an owner can change field sets.";
  const shownProblem = saveError ?? (dirty ? problem : null);

  return (
    <SettingsStack>
      <SalesPanelTop sample={sample} />

      {api.schemaPending ? (
        <SalesSetupPending what="Application field sets" />
      ) : api.loading && !payload ? (
        <SalesLoading label="Loading field sets" columns={6} />
      ) : api.error && !payload ? (
        <SalesLoadError message={api.error} onRetry={() => { void api.reload(); }} />
      ) : (
        <>
          {shownProblem && <Callout tone="error" title={shownProblem} />}
          {!canEdit && <ReadOnlyNotice what="field sets" />}

          <TableCard
            title="Field sets"
            description="One per carrier and product, with the platform set behind them."
            toolbar={
              <DataToolbar
                actions={
                  <>
                    <WithReason reason={ownerOnly}>
                      <Button type="button" disabled={!canEdit} onClick={() => setDialog({ kind: "add" })}><Plus aria-hidden="true" />Add a field set</Button>
                    </WithReason>
                    <RefreshButton onClick={sample ? notRefreshed : () => { void api.reload(); }} refreshing={api.loading && !sample} />
                  </>
                }
              />
            }
          >
            {rowsShown.length === 0 ? (
              <EmptyState title="No carriers yet" hint="Add a carrier in Carriers and products. It uses the platform Final Expense set until you give it its own." />
            ) : (
              <table className={cn(st.table, "min-w-[860px]")}>
                <thead>
                  <tr className={st.headRow}>
                    <th scope="col" className={cn(st.th, "w-[150px]")}>Carrier</th>
                    <th scope="col" className={cn(st.th, "w-[150px]")}>Product</th>
                    <th scope="col" className={cn(st.th, st.num, "w-[80px]")}>Fields</th>
                    <th scope="col" className={cn(st.th, st.num, "w-[96px]")}>Sensitive</th>
                    <th scope="col" className={cn(st.th, "w-[110px]")}>Source</th>
                    <th scope="col" className={cn(st.th, "w-[140px]")}>Status</th>
                    <th scope="col" className={cn(st.th, "w-[200px] text-right")}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {rowsShown.map((r) => {
                    const def = (r.own ?? r.inUse)?.definition;
                    const list = fieldSetEntries(def);
                    const isOpen = r.key === selectedKey;
                    const verb = isOpen ? "Close" : canEdit && r.own ? "Edit" : "View";
                    return (
                      <tr key={r.key} className={cn("m-row", isOpen && "bg-[var(--brand-50)]")}>
                        <td className={st.td}><span className={st.strong}>{r.carrierName}</span></td>
                        <td className={st.td}>{r.productLabel}</td>
                        <td className={cn(st.td, st.num)}>{list.length}</td>
                        <td className={cn(st.td, st.num)}>{list.filter((e) => e.sensitive).length}</td>
                        <td className={st.td}>{r.own ? <Pill tone="brand">Your agency</Pill> : <Pill tone="neutral">Platform</Pill>}</td>
                        <td className={st.td}>
                          <LifecyclePill state={!r.own ? "platform" : r.own.status === "draft" ? "draft" : "live"} />
                        </td>
                        <td className={cn(st.td, "whitespace-nowrap text-right")}>
                          <span className="inline-flex gap-2">
                            {!r.own && (
                              <RowAction onClick={() => { void copyFor(r); }} disabled={!canEdit || !r.inUse} reason={!r.inUse ? "There is no platform set to copy for this product." : ownerOnly}>Copy to my agency</RowAction>
                            )}
                            {r.liveOwn && (
                              <RowAction onClick={() => setDialog({ kind: "retire", template: r.liveOwn! })} disabled={!canEdit} reason={ownerOnly}>Retire</RowAction>
                            )}
                            {r.own?.status === "draft" && (
                              <RowAction onClick={() => setDialog({ kind: "publish", template: r.own! })} disabled={!canEdit || (isOpen && dirty)} reason={isOpen && dirty ? "Save your changes before publishing." : ownerOnly}>Publish</RowAction>
                            )}
                            <RowAction onClick={() => toggle(r)} disabled={!isOpen && !(r.own ?? r.inUse)} reason="There is no field set to show for this product." label={`${verb} the ${r.carrierName} · ${r.productLabel} field set`}>{verb}</RowAction>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </TableCard>

          {selected && shown && (
            <TableCard
              title={`${selected.carrierName} · ${selected.productLabel} · ${entries.length} fields`}
              description={editing ? "A sensitive field is masked everywhere and reveals one at a time." : "The platform set, read-only — copy it to your agency to change it."}
              toolbar={!readOnly && missing.length > 0 ? (
                <DataToolbar>
                  <label htmlFor="fs-add" className="sr-only">Field to add</label>
                  <select id="fs-add" className={cn(toolbarControl, "min-w-64")} value={adding} onChange={(e) => setAdding(e.target.value)}>
                    <option value="">Add a field…</option>
                    {missing.map((k) => <option key={k} value={k}>{fieldMeta(k).label} ({k})</option>)}
                  </select>
                  <WithReason reason={adding ? null : "Choose a field to add first."}>
                    <Button type="button" variant="outline" disabled={!adding} onClick={() => add(adding)}><Plus aria-hidden="true" />Add field</Button>
                  </WithReason>
                </DataToolbar>
              ) : undefined}
            >
              {entries.length === 0 ? (
                <EmptyState title="No fields in this set" hint="Add the fields the carrier's application asks for." />
              ) : (
                <table className={cn(st.table, "min-w-[720px]")}>
                  <thead>
                    <tr className={st.headRow}>
                      <th scope="col" className={cn(st.th, "w-[210px]")}>Our field</th>
                      <th scope="col" className={st.th}>Label on the form</th>
                      <th scope="col" className={cn(st.th, "w-[130px]")}>Type</th>
                      <th scope="col" className={cn(st.th, "w-[96px]")}>Required</th>
                      <th scope="col" className={cn(st.th, "w-[128px]")}>Handling</th>
                      {!readOnly && <th scope="col" className={cn(st.th, "w-[56px] text-right")}><span className="sr-only">Remove</span></th>}
                    </tr>
                  </thead>
                  <tbody className="m-seq">
                    {entries.map((e) => (
                      <tr key={e.key} className="m-row">
                        <td className={st.td}><code className="font-mono text-[12px] text-[var(--ink)]">{e.key}</code></td>
                        <td className={st.td}>
                          {readOnly ? e.label : (
                            <input aria-label={`Label on the form for ${e.key}`} className={cn(control, "mt-0")} value={e.label} placeholder={e.canonicalLabel} onChange={(ev) => patch(e.key, { label: ev.target.value })} />
                          )}
                        </td>
                        <td className={st.td}>{e.typeLabel}</td>
                        <td className={st.td}>
                          {readOnly ? (e.required ? <Pill tone="success">Yes</Pill> : "—") : (
                            <label className="inline-flex items-center gap-2">
                              <input type="checkbox" className={checkbox} checked={e.required} onChange={(ev) => patch(e.key, { required: ev.target.checked })} aria-label={`${e.key} is required`} />
                              {e.required ? <Pill tone="success">Yes</Pill> : <span className="text-[var(--muted)]">—</span>}
                            </label>
                          )}
                        </td>
                        <td className={st.td}>
                          {e.sensitive ? (
                            <span className="inline-flex items-center gap-1.5 text-[var(--error-ink)]"><Lock className="size-3.5" aria-hidden="true" /><span className="text-[12px] font-semibold">Sensitive</span></span>
                          ) : "—"}
                        </td>
                        {!readOnly && (
                          <td className={cn(st.td, "text-right")}>
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${e.key} from the set`} onClick={() => setEntries((list) => list.filter((x) => x.key !== e.key))}><Trash2 aria-hidden="true" /></Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </TableCard>
          )}

          <SettingsSaveBar
            visible={Boolean(editing && !readOnly && dirty)}
            note={editing?.status === "draft" ? `Unsaved changes to the ${selected?.carrierName ?? ""} field set` : "Unsaved changes — saving makes a new draft version"}
          >
            <DiscardSave saving={saving} problem={problem} onDiscard={discard} onSave={() => { void save(); }} />
          </SettingsSaveBar>
        </>
      )}

      {dialog?.kind === "add" && payload && (
        <PairDialog
          title="Add a field set"
          description="It starts as a copy of the set this pair uses now. Publish it when it matches the carrier's form."
          submitLabel="Create draft"
          carriers={payload.carriers}
          productLines={payload.productLines}
          allowGeneral={false}
          withName={false}
          initial={{ productCode: payload.productLines[0]?.code ?? "final_expense", carrierId: payload.carriers[0]?.id ?? null, name: "" }}
          problem={(c) => (all.some((x) => x.tenantOwned && x.productCode === c.productCode && x.carrierId === c.carrierId) ? "That pair already has its own set. Edit it from the table." : null)}
          onClose={() => setDialog(null)}
          onSubmit={async (c) => {
            const carrier = payload.carriers.find((x) => x.id === c.carrierId)?.name ?? "Carrier";
            const line = payload.productLines.find((x) => x.code === c.productCode)?.name ?? c.productCode;
            const row: SetRow = rowsShown.find((r) => r.carrierId === c.carrierId && r.productCode === c.productCode)
              ?? { key: `${c.carrierId}|${c.productCode}`, carrierId: c.carrierId, carrierName: carrier, productCode: c.productCode, productLabel: line, own: null, liveOwn: null,
                inUse: newestOf(all.filter((t) => !t.tenantOwned && !t.carrierId && t.status === "published" && t.productCode === c.productCode)) ?? newestOf(all.filter((t) => !t.tenantOwned && !t.carrierId && t.status === "published")) };
            await copyFor(row);
            setDialog(null);
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
          onConfirm={async () => { await api.retire(dialog.template.id); setDialog(null); }}
        />
      )}
    </SettingsStack>
  );
}

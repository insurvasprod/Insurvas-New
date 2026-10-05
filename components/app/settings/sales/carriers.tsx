"use client";

/**
 * Settings › Sales › Carriers and products (LA-3.6, 3.17, 3.22, 3.25). Reads GET
 * /api/app/settings/sales/carriers and writes through its carriers / products / portals routes;
 * `?preview=sample` (outside production) renders the design fixtures and saves nothing.
 *
 * The board (l3-set-carriers): the agency's carriers — products, portal, reference pattern, billing
 * descriptor, payment methods, field set and field map for each — and, for the carrier picked, its
 * portal account. Picking a carrier also opens what the board's columns are edited with: the agency's
 * own portal origin, reference pattern and descriptor (the Insurvas library row is shared and never
 * written), and its products. There is no password field anywhere.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";

import { Callout, Field, Pill, SettingsCard, SettingsStack, control, st, type PillTone } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { TableCard } from "@/components/ui/table-card";
import type { PaymentMethod } from "@/lib/applications/constants";
import { notify } from "@/lib/notify";
import { patternProblem, toHttpsOrigin, toHttpsUrl } from "@/lib/salesSettings/carrierSchemas";
import type { CarriersPayload, FieldMapChip, SalesCarrierView } from "@/lib/salesSettings/views";
import { cn } from "@/lib/utils";

import { draftOfPortal, openPortal, portalIsBlank, PortalAccountCard, type PortalDraft } from "./carriers-portal";
import { draftOfProduct, newProductDraft, productBody, ProductEditor, type ProductDraft } from "./carriers-products";
import { sampleCarriers } from "./carriers-sample";
import {
  DialogActions, DiscardSave, ReadOnlyNotice, RowAction, SalesDialog, SalesLoadError, SalesLoading, SalesPanelTop, SalesSetupPending, WithReason,
  notRefreshed, notSaved, salesApi, useSalesSample, warnUnsaved,
} from "./shared";

type Facts = { portalOrigin: string; referencePattern: string; billingDescriptor: string };

const factsDraft = (c: SalesCarrierView): Facts => ({
  portalOrigin: c.override?.portalOrigin ?? "",
  referencePattern: c.override?.referencePattern ?? "",
  billingDescriptor: c.override?.billingDescriptor ?? "",
});

const METHOD_SHORT: Record<PaymentMethod, string> = { ach: "bank draft", direct_express: "Direct Express", debit_card: "card", credit_card: "card", direct_bill: "direct bill" };
function methodsSummary(c: SalesCarrierView) {
  const methods = new Set(c.products.filter((p) => p.isActive).flatMap((p) => p.acceptedPaymentMethods));
  const words = [...new Set((["ach", "direct_express", "debit_card", "credit_card", "direct_bill"] as PaymentMethod[]).filter((m) => methods.has(m)).map((m) => METHOD_SHORT[m]))];
  const text = words.join(", ");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "—";
}

function appointmentLine(c: SalesCarrierView) {
  const { activeStates, pendingStates } = c.appointment;
  if (activeStates.length) return `Appointed in ${activeStates.length > 4 ? `${activeStates.length} states` : activeStates.join(", ")}`;
  if (pendingStates.length) return `Appointment pending in ${pendingStates.length > 4 ? `${pendingStates.length} states` : pendingStates.join(", ")}`;
  return "Not appointed";
}

const MAP_PILL: Record<FieldMapChip["status"], PillTone> = { published: "success", needs_review: "warning", draft: "info", none: "error" };
const mapLabel = (m: FieldMapChip) => (m.status === "published" ? `v${m.version}` : m.status === "needs_review" ? "Needs review" : m.status === "draft" ? "Draft" : "None");

const productsDirty = (c: SalesCarrierView, drafts: ProductDraft[]) =>
  drafts.filter((d) => d.tenantOwned && (d.id === null || JSON.stringify(d) !== JSON.stringify(draftOfProduct(c.products.find((p) => p.id === d.id)!))));

export function SalesCarriersSettings() {
  const sample = useSalesSample();
  const [payload, setPayload] = useState<CarriersPayload | null>(() => (sample ? sampleCarriers() : null));
  const [loading, setLoading] = useState(!sample);
  const [error, setError] = useState<string | null>(null);
  const [schemaPending, setSchemaPending] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [facts, setFacts] = useState<Facts>({ portalOrigin: "", referencePattern: "", billingDescriptor: "" });
  const [portal, setPortal] = useState<PortalDraft>(draftOfPortal(null, null));
  const [products, setProducts] = useState<ProductDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const reload = useCallback(async () => {
    if (sample) return null;
    setLoading(true);
    const res = await salesApi<CarriersPayload>("/api/app/settings/sales/carriers");
    setLoading(false);
    if (!res.ok) {
      setSchemaPending(Boolean(res.schemaPending));
      setError(res.error);
      return null;
    }
    setPayload(res.data);
    setError(null);
    setSchemaPending(false);
    return res.data;
  }, [sample]);

  useEffect(() => {
    if (sample) return;
    const t = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(t);
  }, [reload, sample]);

  const carriers = useMemo(() => payload?.carriers ?? [], [payload]);
  const selected = carriers.find((c) => c.id === selectedId) ?? null;
  const canEdit = Boolean(payload?.canEdit);
  const readOnly = !canEdit;

  const load = (c: SalesCarrierView) => {
    setSelectedId(c.id);
    setFacts(factsDraft(c));
    setPortal(draftOfPortal(c.portal, c.effective.portalOrigin));
    setProducts(c.products.map(draftOfProduct));
    setSaveError(null);
  };

  const factsChanged = Boolean(selected && JSON.stringify(facts) !== JSON.stringify(factsDraft(selected)));
  const portalChanged = Boolean(selected && JSON.stringify(portal) !== JSON.stringify(draftOfPortal(selected.portal, selected.effective.portalOrigin)) && (selected.portal || !portalIsBlank(portal)));
  const changedProducts = selected ? productsDirty(selected, products) : [];
  const dirty = factsChanged || portalChanged || changedProducts.length > 0;

  const open = (c: SalesCarrierView) => {
    if (dirty && c.id !== selectedId) return warnUnsaved(selected?.name ?? "This carrier");
    load(c);
  };

  const originProblem = facts.portalOrigin.trim() && !toHttpsOrigin(facts.portalOrigin) ? "The portal origin must be an https address." : null;
  const factsProblem = originProblem
    ?? (facts.referencePattern.trim() ? patternProblem(facts.referencePattern.trim()) : null)
    ?? (facts.billingDescriptor.trim().length > 60 ? "A billing descriptor is at most 60 characters." : null);

  const save = async () => {
    if (!selected) return;
    if (sample) { notSaved(); return; }
    setSaving(true);
    setSaveError(null);
    const fail = (message: string) => { setSaveError(message); setSaving(false); };
    if (factsChanged) {
      if (factsProblem) return fail(factsProblem);
      const res = await salesApi(`/api/app/settings/sales/carriers/${selected.id}`, {
        method: "PATCH",
        body: {
          portal_origin: facts.portalOrigin.trim() ? toHttpsOrigin(facts.portalOrigin) : null,
          reference_pattern: facts.referencePattern.trim() || null,
          billing_descriptor: facts.billingDescriptor.trim().toUpperCase() || null,
        },
      });
      if (!res.ok) return fail(res.error);
    }
    if (portalChanged) {
      const url = toHttpsUrl(portal.portalUrl);
      if (!url) return fail("Add the portal's https address before saving the account.");
      const res = await salesApi("/api/app/settings/sales/portals", {
        method: "PUT",
        body: {
          carrier_id: selected.id, portal_url: url, username: portal.username.trim() || null, writing_number: portal.writingNumber.trim() || null,
          mfa_type: portal.mfaType, notes: selected.portal?.notes ?? null, last_verified_on: portal.lastVerifiedOn || null,
        },
      });
      if (!res.ok) return fail(res.error);
    }
    for (const d of changedProducts) {
      const { body, error: problem } = productBody(d);
      if (!body) return fail(problem ?? "Check the product.");
      const res = d.id
        ? await salesApi(`/api/app/settings/sales/products/${d.id}`, { method: "PATCH", body })
        : await salesApi("/api/app/settings/sales/products", { method: "POST", body: { carrier_id: selected.id, ...body } });
      if (!res.ok) return fail(res.error);
    }
    const fresh = await reload();
    setSaving(false);
    notify.done(`${selected.name} saved`);
    const again = fresh?.carriers.find((c) => c.id === selected.id);
    if (again) load(again);
  };

  const verify = async () => {
    if (!selected?.portal) return;
    if (sample) { notSaved(); return; }
    setVerifying(true);
    const res = await salesApi(`/api/app/settings/sales/portals/${selected.portal.id}/verify`, { method: "POST" });
    setVerifying(false);
    if (!res.ok) { notify.block(res.error); return; }
    notify.done("Marked verified today");
    const fresh = await reload();
    const again = fresh?.carriers.find((c) => c.id === selected.id);
    if (again) setPortal((d) => ({ ...d, lastVerifiedOn: draftOfPortal(again.portal, again.effective.portalOrigin).lastVerifiedOn }));
  };

  const removePortal = async () => {
    if (!selected?.portal) return;
    if (sample) { notSaved(); setConfirmRemove(false); return; }
    setRemoving(true);
    const res = await salesApi(`/api/app/settings/sales/portals?id=${encodeURIComponent(selected.portal.id)}`, { method: "DELETE" });
    setRemoving(false);
    if (!res.ok) { notify.block(res.error); return; }
    setConfirmRemove(false);
    notify.done(`${selected.name} portal account removed`, { detail: "The workspace opens the carrier's portal address instead." });
    const fresh = await reload();
    const again = fresh?.carriers.find((c) => c.id === selected.id);
    if (again) setPortal(draftOfPortal(again.portal, again.effective.portalOrigin));
  };

  const copyProduct = async (productId: string) => {
    if (!selected) return;
    if (sample) { notSaved(); return; }
    const res = await salesApi(`/api/app/settings/sales/products/${productId}/copy`, { method: "POST" });
    if (!res.ok) { notify.block(res.error); return; }
    notify.done("Copied to your agency", { detail: "Your copy replaces the Insurvas product for your agency only." });
    const fresh = await reload();
    const again = fresh?.carriers.find((c) => c.id === selected.id);
    if (again) setProducts(again.products.map(draftOfProduct));
  };

  const ownerOnly = canEdit ? null : "Only an owner can change carriers.";
  /** The row's Edit / View opens the carrier; on the open row it closes it (unless there are unsaved edits). */
  const toggle = (c: SalesCarrierView) => {
    if (c.id !== selectedId) return open(c);
    if (dirty) return warnUnsaved(c.name);
    setSelectedId(null);
  };

  return (
    <SettingsStack>
      <SalesPanelTop sample={sample} />

      {schemaPending ? (
        <SalesSetupPending what="Carriers and products" />
      ) : loading && !payload ? (
        <SalesLoading label="Loading carriers" columns={8} />
      ) : error && !payload ? (
        <SalesLoadError message={error} onRetry={() => { void reload(); }} />
      ) : (
        <>
          {saveError && <Callout tone="error" title={saveError} />}
          {!canEdit && <ReadOnlyNotice what="carriers and products" />}

          <TableCard
            title="Carriers"
            description="The reference pattern is what validates a number typed in after submission."
            toolbar={
              <DataToolbar
                actions={
                  <>
                    <WithReason reason={ownerOnly}>
                      <Button type="button" disabled={!canEdit} onClick={() => setAdding(true)}><Plus aria-hidden="true" />Add a carrier</Button>
                    </WithReason>
                    <RefreshButton onClick={sample ? notRefreshed : () => { void reload(); }} refreshing={loading && !sample} />
                  </>
                }
              />
            }
          >
            {carriers.length === 0 ? (
              <EmptyState title="No carriers yet" hint="Add a carrier from the Insurvas library before you quote." />
            ) : (
              <table className={cn(st.table, "min-w-[1060px]")}>
                <thead>
                  <tr className={st.headRow}>
                    <th scope="col" className={cn(st.th, "w-[150px]")}>Carrier</th>
                    <th scope="col" className={cn(st.th, "w-[140px]")}>Products</th>
                    <th scope="col" className={cn(st.th, "w-[96px]")}>Portal</th>
                    <th scope="col" className={cn(st.th, "w-[120px]")}>Reference pattern</th>
                    <th scope="col" className={cn(st.th, "w-[130px]")}>Billing descriptor</th>
                    <th scope="col" className={cn(st.th, "w-[120px]")}>Payment methods</th>
                    <th scope="col" className={cn(st.th, "w-[110px]")}>Field set</th>
                    <th scope="col" className={cn(st.th, "w-[110px]")}>Field map</th>
                    <th scope="col" className={cn(st.th, "w-[80px] text-right")}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {carriers.map((c) => {
                    const url = c.portal?.portalUrl ?? c.effective.portalOrigin;
                    const isOpen = c.id === selectedId;
                    const verb = isOpen ? "Close" : canEdit ? "Edit" : "View";
                    return (
                      <tr key={c.id} className={cn("m-row", isOpen && "bg-[var(--brand-50)]")}>
                        <td className={st.td}>
                          <span className={cn(st.strong, "block")}>{c.name}</span>
                          <span className={st.sub}>{appointmentLine(c)}</span>
                        </td>
                        <td className={st.td}>{c.products.length ? c.products.map((p, i) => (
                          <span key={p.id}>{i > 0 && ", "}{p.name}{!p.isActive && <span className="text-[var(--muted)]"> (not offered)</span>}</span>
                        )) : <span className="text-[var(--muted)]">—</span>}</td>
                        <td className={st.td}>
                          {url ? (
                            <span className="flex flex-col items-start gap-1">
                              <button type="button" className="text-[14px] text-[var(--ink)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]" onClick={() => { void openPortal(url, c.portal?.username ?? null); }} aria-label={`Open the ${c.name} portal${c.portal?.username ? " and copy the username" : ""}`}>
                                Open
                              </button>
                              {c.portal?.needsCheck && <Pill tone="warning">{c.portal.lastVerifiedAt ? "Check it still works" : "Not verified yet"}</Pill>}
                            </span>
                          ) : <span className="text-[var(--muted)]">—</span>}
                        </td>
                        <td className={st.td}>{c.effective.referencePattern ? <code className="font-mono text-[12px] text-[var(--ink)]">{c.effective.referencePattern}</code> : <span className="text-[var(--muted)]">—</span>}</td>
                        <td className={st.td}>{c.effective.billingDescriptor ?? <span className="text-[var(--muted)]">—</span>}</td>
                        <td className={st.td}>{methodsSummary(c)}</td>
                        <td className={st.td}>
                          {c.fieldSet === "tenant" ? <Pill tone="success">Your agency</Pill> : c.fieldSet === "tenant_draft" ? <Pill tone="info">Draft</Pill> : <Pill tone="neutral">Platform</Pill>}
                        </td>
                        <td className={st.td}><Pill tone={MAP_PILL[c.fieldMap.status]}>{mapLabel(c.fieldMap)}</Pill></td>
                        <td className={cn(st.td, "whitespace-nowrap text-right")}>
                          <RowAction onClick={() => toggle(c)} label={`${verb} ${c.name}`}>{verb}</RowAction>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </TableCard>

          {selected && (
            <PortalAccountCard
              carrierName={selected.name}
              account={selected.portal}
              draft={portal}
              onChange={(p) => setPortal((d) => ({ ...d, ...p }))}
              onVerify={() => { void verify(); }}
              onRemove={() => { if (portalChanged) warnUnsaved(`${selected.name} · portal account`); else setConfirmRemove(true); }}
              readOnly={readOnly}
              verifying={verifying}
            />
          )}

          {selected && (
            <SettingsCard title="Carrier details" sub="Your agency's values. Leave one blank to use the Insurvas library's.">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Portal origin" htmlFor="carrier-origin" error={originProblem} hint={`The extension may work on this site and nowhere else.${selected.platform.portalOrigin ? ` Insurvas: ${selected.platform.portalOrigin}` : ""}`}>
                  <input id="carrier-origin" className={cn(control, "font-mono")} spellCheck={false} value={facts.portalOrigin} placeholder={selected.platform.portalOrigin ?? "https://agents.carrier.com"} disabled={readOnly} onChange={(e) => setFacts((f) => ({ ...f, portalOrigin: e.target.value }))} />
                </Field>
                <Field
                  label="Reference pattern"
                  htmlFor="carrier-pattern"
                  error={facts.referencePattern.trim() ? patternProblem(facts.referencePattern.trim()) : null}
                  hint={`A number that does not match warns and still saves.${selected.platform.referencePattern ? ` Insurvas: ${selected.platform.referencePattern}` : ""}`}
                >
                  <input id="carrier-pattern" className={cn(control, "font-mono")} spellCheck={false} value={facts.referencePattern} placeholder={selected.platform.referencePattern ?? "^GL-\\d{8}$"} disabled={readOnly} onChange={(e) => setFacts((f) => ({ ...f, referencePattern: e.target.value }))} />
                </Field>
                <Field label="Billing descriptor" htmlFor="carrier-descriptor" hint={`What the client's bank statement shows. The welcome pack quotes it.${selected.platform.billingDescriptor ? ` Insurvas: ${selected.platform.billingDescriptor}` : ""}`}>
                  <input id="carrier-descriptor" className={cn(control, "uppercase")} maxLength={60} value={facts.billingDescriptor} placeholder={selected.platform.billingDescriptor ?? ""} disabled={readOnly} onChange={(e) => setFacts((f) => ({ ...f, billingDescriptor: e.target.value.toUpperCase() }))} />
                </Field>
              </div>
            </SettingsCard>
          )}

          {selected && payload && (
            <SettingsCard
              title="Products"
              sub="Issue ages, face limits, the per-$1,000 band the quote check reads, and the payment methods each product accepts."
              action={!readOnly ? <Button type="button" variant="outline" onClick={() => setProducts((list) => [...list, newProductDraft(payload.productLines[0]?.code ?? "final_expense")])}><Plus aria-hidden="true" />Add a product</Button> : undefined}
            >
              {products.length === 0 ? (
                <p className="m-0 text-[14px] text-[var(--muted)]">No products yet. Add one to quote it.</p>
              ) : (
                <div className="flex flex-col gap-4">
                  {products.map((d) => (
                    <ProductEditor
                      key={d.key}
                      draft={d}
                      productLines={payload.productLines}
                      readOnly={readOnly}
                      canCopy={canEdit}
                      onCopy={() => { if (d.id) void copyProduct(d.id); }}
                      onChange={(p) => setProducts((list) => list.map((x) => (x.key === d.key ? { ...x, ...p } : x)))}
                    />
                  ))}
                </div>
              )}
            </SettingsCard>
          )}

          <SettingsSaveBar visible={Boolean(selected && !readOnly && dirty)} note={selected ? `Unsaved changes to ${selected.name}` : undefined}>
            <DiscardSave saving={saving} problem={factsChanged ? factsProblem : null} onDiscard={() => { if (selected) load(selected); }} onSave={() => { void save(); }} />
          </SettingsSaveBar>
        </>
      )}

      {confirmRemove && selected?.portal && (
        <SalesDialog
          open
          onOpenChange={(o) => { if (!o && !removing) setConfirmRemove(false); }}
          title={`Remove the ${selected.name} portal account?`}
          description="The username, writing number and MFA method are removed. The change is kept in the audit log. Open portal falls back to the carrier's portal address."
        >
          <DialogActions>
            <Button type="button" variant="outline" disabled={removing} onClick={() => setConfirmRemove(false)}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={removing} onClick={() => { void removePortal(); }}>{removing ? "Removing…" : "Remove account"}</Button>
          </DialogActions>
        </SalesDialog>
      )}

      {adding && payload && (
        <AddCarrierDialog
          payload={payload}
          onClose={() => setAdding(false)}
          onAdded={async (id) => {
            setAdding(false);
            const fresh = await reload();
            const c = fresh?.carriers.find((x) => x.id === id);
            if (c) load(c);
          }}
          sample={sample}
        />
      )}
    </SettingsStack>
  );
}

function AddCarrierDialog({ payload, onClose, onAdded, sample }: { payload: CarriersPayload; onClose: () => void; onAdded: (id: string) => Promise<void>; sample: boolean }) {
  const [carrierId, setCarrierId] = useState(payload.addable[0]?.id ?? "");
  const [pattern, setPattern] = useState("");
  const [descriptor, setDescriptor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = !carrierId ? "Choose a carrier." : pattern.trim() ? patternProblem(pattern.trim()) : null;
  const submit = async () => {
    if (sample) { notSaved(); onClose(); return; }
    setBusy(true);
    const res = await salesApi<{ carrierId: string }>("/api/app/settings/sales/carriers", {
      method: "POST",
      body: { carrier_id: carrierId, reference_pattern: pattern.trim() || null, billing_descriptor: descriptor.trim().toUpperCase() || null },
    });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    notify.done(`${payload.addable.find((c) => c.id === carrierId)?.name ?? "Carrier"} added`);
    await onAdded(res.data.carrierId);
  };
  return (
    <SalesDialog open onOpenChange={(o) => !o && onClose()} title="Add a carrier" description="From the Insurvas library. Its products, field set and field map come with it; you can set your own values afterwards.">
      <div className="flex flex-col gap-4">
        <Field label="Carrier" htmlFor="add-carrier" required hint={payload.addable.length === 0 ? "Every carrier in the library is already on your list." : undefined}>
          <select id="add-carrier" className={control} value={carrierId} onChange={(e) => setCarrierId(e.target.value)} disabled={payload.addable.length === 0}>
            {payload.addable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Reference pattern" htmlFor="add-pattern" error={pattern.trim() ? patternProblem(pattern.trim()) : null} hint="Optional. Leave blank to use the library's.">
          <input id="add-pattern" className={cn(control, "font-mono")} spellCheck={false} value={pattern} onChange={(e) => setPattern(e.target.value)} />
        </Field>
        <Field label="Billing descriptor" htmlFor="add-descriptor" hint="Optional. What the client's bank statement shows.">
          <input id="add-descriptor" className={cn(control, "uppercase")} maxLength={60} value={descriptor} onChange={(e) => setDescriptor(e.target.value.toUpperCase())} />
        </Field>
        {error && <p role="alert" className="m-0 text-[12px] text-[var(--error-ink)]">{error}</p>}
        <DialogActions>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <WithReason reason={payload.addable.length === 0 ? "Every carrier in the library is already on your list." : problem}>
            <Button type="button" disabled={Boolean(problem) || busy} onClick={() => { void submit(); }}>{busy ? "Adding…" : "Add carrier"}</Button>
          </WithReason>
        </DialogActions>
      </div>
    </SalesDialog>
  );
}

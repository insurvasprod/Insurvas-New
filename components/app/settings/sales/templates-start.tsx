"use client";

/**
 * Settings › Underwriting templates, round 3 (owner picks 2026-10-30, canvas page
 * settings-uw-templates-steps): how a template starts.
 *
 * - `StartPanel` (S1): an agency with no template of its own sees what calls load today and three
 *   ways in: from Insurvas's, blank (the five always-on questions), or a copy of one it has.
 * - `NewTemplateDialog` (S2 A, S11): one dialog — product, carrier, where it starts from, name — and
 *   the line saying which calls will load it once published. With `forCarrier` it is the "different
 *   questions for one carrier" flow: a carrier is required and it starts from the general one.
 */

import { useState } from "react";

import { Field, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/view-tabs";
import { insurvasStart, scopeOf } from "@/lib/salesSettings/templateCoverage";
import { knockoutCount, newUnderwritingDefinition, questionCount } from "@/lib/salesSettings/templateDefinition";
import type { NamedCarrier, ProductLine, TemplateRowView } from "@/lib/salesSettings/views";

import { DialogActions, SalesDialog, WithReason } from "./shared";
import { liveOf, tableRows } from "./templates-data";

export type StartFrom = "insurvas" | "blank" | "copy";
export type NewTemplateInit = { productCode: string; carrierId: string | null; startFrom: StartFrom; sourceId?: string | null; forCarrier?: boolean };

type Api = {
  create: (body: { product_code: string; carrier_id: string | null; name: string; definition: Record<string, unknown> }) => Promise<TemplateRowView | null>;
  copy: (id: string, body: { product_code?: string; carrier_id?: string | null; name?: string }, done?: string) => Promise<TemplateRowView | null>;
  save: (id: string, body: { name?: string; definition: Record<string, unknown> }) => Promise<{ saved: { template: TemplateRowView } | null; error: string | null }>;
};

/** The agency's own templates a new one can be copied from: each one's newest version, live first. */
const copySources = (all: readonly TemplateRowView[]) => tableRows([...all]).filter((t) => t.tenantOwned);

export function StartPanel({ all, productCode, productName, canEdit, onStart }: {
  all: readonly TemplateRowView[];
  productCode: string;
  productName: string;
  canEdit: boolean;
  onStart: (init: NewTemplateInit) => void;
}) {
  const ins = insurvasStart(all, productCode);
  const hasCopy = copySources(all).length > 0;
  const choice = (title: string, sub: string, label: string, init: NewTemplateInit, primary = false, disabled = false) => (
    <div className="m-glass flex flex-col gap-3 rounded-xl border border-[var(--border)] p-4">
      <span>
        <span className="block text-sm font-semibold text-[var(--ink)]">{title}</span>
        <span className="mt-0.5 block text-xs leading-[1.5] text-[var(--body)]">{sub}</span>
      </span>
      <span className="mt-auto">
        <WithReason reason={!canEdit ? "Only an owner can change templates." : null}>
          <Button type="button" size="sm" variant={primary ? "default" : "outline"} disabled={!canEdit || disabled} onClick={() => onStart(init)}>{label}</Button>
        </WithReason>
      </span>
    </div>
  );
  return (
    <section aria-label="Start your first template" className="m-glass flex flex-col gap-4 rounded-xl border border-[var(--border)] p-5">
      <div>
        <h3 className="m-0 text-card-title font-semibold text-[var(--ink)]">Your agents don&apos;t have health questions of your own yet</h3>
        <p className="m-0 mt-1 text-sm leading-[1.5] text-[var(--body)]">
          {ins ? <>{productName} calls load Insurvas&apos;s <b className="font-semibold text-[var(--ink)]">{ins.name}</b> today.</> : <>{productName} calls have no health questions today.</>} Start from it, or start with only the five questions that keep a policy on the books.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {ins && choice("Start from Insurvas's", `${questionCount(ins.definition)} questions, ${knockoutCount(ins.definition)} knockouts. Change anything.`, "Use it", { productCode, carrierId: null, startFrom: "insurvas" }, true)}
        {choice("Start blank", "The five always-on questions, then pick from the bank.", "Start blank", { productCode, carrierId: null, startFrom: "blank" }, !ins)}
        {choice("Copy one you have", hasCopy ? "From another product line or carrier." : "You have no template to copy yet.", "Choose…", { productCode, carrierId: null, startFrom: "copy" }, false, !hasCopy)}
      </div>
    </section>
  );
}

export function NewTemplateDialog({ init, all, carriers, productLines, api, onClose, onCreated }: {
  init: NewTemplateInit;
  all: readonly TemplateRowView[];
  carriers: NamedCarrier[];
  productLines: ProductLine[];
  api: Api;
  onClose: () => void;
  onCreated: (t: TemplateRowView) => void;
}) {
  const sources = copySources(all);
  const generalFor = (code: string) => sources.find((t) => t.productCode === code && !t.carrierId && t.status === "published") ?? sources.find((t) => t.productCode === code && !t.carrierId) ?? null;
  const [productCode, setProductCode] = useState(init.productCode);
  const [carrierId, setCarrierId] = useState<string | null>(init.carrierId);
  const [startFrom, setStartFrom] = useState<StartFrom>(init.startFrom);
  const [sourceId, setSourceId] = useState<string>(init.sourceId ?? (init.forCarrier ? generalFor(init.productCode)?.id : sources[0]?.id) ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const product = productLines.find((p) => p.code === productCode);
  const carrier = carriers.find((c) => c.id === carrierId) ?? null;
  const ins = insurvasStart(all, productCode);
  const source = startFrom === "insurvas" ? ins : startFrom === "copy" ? sources.find((t) => t.id === sourceId) ?? null : null;
  const suggested = `${product?.name ?? "Template"}${carrier ? ` — ${carrier.name}` : " — our intake"}`;
  const finalName = name.trim() || suggested;
  // A product and carrier the agency already has versions of: a new one becomes its next version
  // (the old ones stay for their interviews); only an open draft stops it, as there is one per template.
  const lineage = all.filter((x) => x.tenantOwned && x.productCode === productCode && (x.carrierId ?? null) === carrierId).sort((a, b) => b.version - a.version);
  const openDraft = lineage.find((x) => x.status === "draft") ?? null;
  const issue = init.forCarrier && !carrierId ? "Choose the carrier that asks different questions."
    : openDraft ? `${openDraft.name} v${openDraft.version} is already a draft for ${product?.name ?? "this product"}${carrier ? ` with ${carrier.name}` : ""}. Edit it, or pick another carrier.`
      : startFrom !== "blank" && !source ? (startFrom === "insurvas" ? "Insurvas has no default to start from here." : "Choose a template to copy.") : null;
  const general = all.find((t) => t.tenantOwned && t.productCode === productCode && !t.carrierId && liveOf([...all], t)?.id === t.id) ?? null;

  const submit = async () => {
    setBusy(true);
    try {
      const body = { product_code: productCode, carrier_id: carrierId, name: finalName };
      const blank = newUnderwritingDefinition() as Record<string, unknown>;
      const t = source ? await api.copy(source.id, body, "Draft created")
        : lineage[0] ? (await api.save(lineage[0].id, { name: finalName, definition: blank })).saved?.template ?? null
          : await api.create({ ...body, definition: blank });
      if (t) onCreated(t);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SalesDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={init.forCarrier ? "Different questions for one carrier" : "New underwriting template"}
      description={init.forCarrier ? "That carrier's calls load this one; every other carrier keeps the general template." : "It's a draft until you publish it."}
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="For which product" htmlFor="new-uw-product" required>
            <select id="new-uw-product" className={control} value={productCode} onChange={(e) => { setProductCode(e.target.value); if (init.forCarrier) setSourceId(generalFor(e.target.value)?.id ?? ""); }}>
              {productLines.filter((p) => p.sold !== false || p.code === productCode).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="For which carrier" htmlFor="new-uw-carrier" required={init.forCarrier} hint={init.forCarrier ? undefined : "Pick one only when that carrier asks different questions."}>
            <select id="new-uw-carrier" className={control} value={carrierId ?? ""} onChange={(e) => setCarrierId(e.target.value || null)}>
              {init.forCarrier ? <option value="">Choose a carrier…</option> : <option value="">Every carrier without its own</option>}
              {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-[var(--ink)]">Start from</span>
          <Segmented<StartFrom>
            label="Start from"
            value={startFrom}
            onChange={setStartFrom}
            options={[
              ...(ins ? [{ key: "insurvas" as const, label: "Insurvas's" }] : []),
              { key: "blank" as const, label: "Blank" },
              ...(sources.length ? [{ key: "copy" as const, label: "Copy of…" }] : []),
            ]}
          />
          {startFrom === "copy" ? (
            <select aria-label="Template to copy" className={control} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              {sources.map((t) => <option key={t.id} value={t.id}>{t.name} v{t.version} · {scopeOf(t)}</option>)}
            </select>
          ) : (
            <span className="text-xs leading-[1.5] text-[var(--body)]">
              {startFrom === "insurvas" && ins ? `${ins.name}: ${questionCount(ins.definition)} questions, ${knockoutCount(ins.definition)} knockouts.` : "The five always-on questions; add the rest from the bank."}
            </span>
          )}
        </div>
        <Field label="Name" htmlFor="new-uw-name" hint={name.trim() ? undefined : `Leave it empty to call it “${suggested}”.`}>
          <input id="new-uw-name" className={control} value={name} placeholder={suggested} onChange={(e) => setName(e.target.value)} />
        </Field>
        <p className="m-0 rounded-[10px] border border-[var(--border)] px-3 py-2.5 text-sm leading-[1.5] text-[var(--ink)]">
          Once published, {product?.name ?? "these"} calls {carrier ? <>with <b className="font-semibold">{carrier.name}</b></> : "with every carrier that has no template of its own"} load it.
          {carrier && general && <span className="block text-xs text-[var(--body)]">Every other carrier keeps {general.name} v{general.version}.</span>}
          {lineage[0] && !openDraft && <span className="block text-xs text-[var(--body)]">It becomes v{lineage[0].version + 1} of {lineage[0].name}; earlier versions stay for the interviews that used them.</span>}
        </p>
        {issue && <p role="alert" className="m-0 text-xs leading-[1.5] text-[var(--error-ink)]">{issue}</p>}
        <DialogActions>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <WithReason reason={issue}>
            <Button type="button" disabled={Boolean(issue) || busy} onClick={() => { void submit(); }}>{busy ? "Creating…" : carrier && init.forCarrier ? `Create ${carrier.name} draft` : "Create draft"}</Button>
          </WithReason>
        </DialogActions>
      </div>
    </SalesDialog>
  );
}

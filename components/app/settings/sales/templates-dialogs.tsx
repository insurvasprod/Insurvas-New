"use client";

/** The template panels' three dialogs: choose a product and carrier, publish a version, retire one. */

import { useState } from "react";

import { Field, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import type { NamedCarrier, ProductLine } from "@/lib/salesSettings/views";

import { DialogActions, SalesDialog, WithReason } from "./shared";

export type PairChoice = { productCode: string; carrierId: string | null; name: string };

export function PairDialog({
  title,
  description,
  submitLabel,
  carriers,
  productLines,
  initial,
  allowGeneral,
  withName = true,
  problem,
  onSubmit,
  onClose,
}: {
  title: string;
  description?: string;
  submitLabel: string;
  carriers: NamedCarrier[];
  productLines: ProductLine[];
  initial: PairChoice;
  /** Offer "Every carrier" (carrier null): a template every carrier without its own uses. */
  allowGeneral: boolean;
  withName?: boolean;
  /** Why the chosen pair cannot be used, or null. */
  problem?: (choice: PairChoice) => string | null;
  onSubmit: (choice: PairChoice) => Promise<void>;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<PairChoice>(initial);
  const [busy, setBusy] = useState(false);
  const issue = problem?.(choice) ?? (!allowGeneral && !choice.carrierId ? "Choose a carrier." : withName && !choice.name.trim() ? "Give it a name." : null);
  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit({ ...choice, name: choice.name.trim() });
    } finally {
      setBusy(false);
    }
  };
  return (
    <SalesDialog open onOpenChange={(open) => !open && onClose()} title={title} description={description}>
      <div className="flex flex-col gap-4">
        {withName && (
          <Field label="Name" htmlFor="pair-name" required>
            <input id="pair-name" className={control} value={choice.name} onChange={(e) => setChoice({ ...choice, name: e.target.value })} />
          </Field>
        )}
        <Field label="Product line" htmlFor="pair-product" required>
          <select id="pair-product" className={control} value={choice.productCode} onChange={(e) => setChoice({ ...choice, productCode: e.target.value })}>
            {productLines.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Carrier" htmlFor="pair-carrier" required={!allowGeneral} hint={carriers.length === 0 ? "Add a carrier in Carriers and products first." : undefined}>
          <select id="pair-carrier" className={control} value={choice.carrierId ?? ""} onChange={(e) => setChoice({ ...choice, carrierId: e.target.value || null })}>
            {allowGeneral ? <option value="">Every carrier without its own</option> : <option value="">Choose a carrier…</option>}
            {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        {issue && <p role="alert" className="m-0 text-[12px] leading-[1.5] text-[var(--error-ink)]">{issue}</p>}
        <DialogActions>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <WithReason reason={issue}>
            <Button type="button" disabled={Boolean(issue) || busy} onClick={() => { void submit(); }}>{busy ? "Working…" : submitLabel}</Button>
          </WithReason>
        </DialogActions>
      </div>
    </SalesDialog>
  );
}

export function PublishDialog({ name, version, liveVersion, onConfirm, onClose }: { name: string; version: number; liveVersion: number | null; onConfirm: (retirePrevious: boolean) => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <SalesDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Publish ${name} v${version}`}
      description="Once published, this version cannot be changed. New work loads it; work already started keeps the version it began on."
    >
      <div className="flex flex-col gap-4">
        {liveVersion !== null && (
          <p className="m-0 text-[14px] leading-[1.5] text-[var(--body)]">
            Version {liveVersion} is retired at the same time.
            <span className="block text-[12px] text-[var(--muted)]">Interviews and quotes already started on it keep it.</span>
          </p>
        )}
        <DialogActions>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={busy} onClick={() => { setBusy(true); void onConfirm(true).finally(() => setBusy(false)); }}>{busy ? "Publishing…" : `Publish v${version}`}</Button>
        </DialogActions>
      </div>
    </SalesDialog>
  );
}

export function RetireDialog({ name, version, onConfirm, onClose }: { name: string; version: number; onConfirm: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <SalesDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Retire ${name} v${version}?`}
      description="New work stops loading it. Anything already started or submitted under it keeps pointing at it. A retired version cannot be published again — edit it to start a new draft version."
    >
      <DialogActions>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="destructive" disabled={busy} onClick={() => { setBusy(true); void onConfirm().finally(() => setBusy(false)); }}>{busy ? "Retiring…" : `Retire v${version}`}</Button>
      </DialogActions>
    </SalesDialog>
  );
}

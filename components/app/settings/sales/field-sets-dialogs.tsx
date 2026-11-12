"use client";

/**
 * Settings › Application field sets: its dialogs (owner pick B, 2026-10-30). Give a carrier its own
 * set (with what to start from), publish and retire in a field set's own words (the shared template
 * dialogs speak of interviews and quotes), and use one set for other carriers.
 */

import { useState, type ReactNode } from "react";

import { Field, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { ThreeWay } from "@/components/app/settings/sales-process/parts";
import type { QuestionDraft } from "@/lib/salesSettings/fieldSetView";
import type { NamedCarrier, ProductLine } from "@/lib/salesSettings/views";

import { DialogActions, SalesDialog, WithReason, checkbox, plural } from "./shared";

/** A set the new one can start from: what the pair uses now, or one of the agency's own. */
export type StartFrom = { id: string; label: string; detail: string };

export function AddFieldSetDialog({
  carriers,
  productLines,
  initial,
  startFrom,
  taken,
  onSubmit,
  onClose,
}: {
  carriers: NamedCarrier[];
  productLines: ProductLine[];
  initial: { carrierId: string | null; productCode: string };
  /** For the chosen pair: the set it uses today first, then the agency's own sets. */
  startFrom: (carrierId: string | null, productCode: string) => StartFrom[];
  /** Why the pair cannot have a new set (it already has its own), or null. */
  taken: (carrierId: string | null, productCode: string) => string | null;
  onSubmit: (choice: { carrierId: string; productCode: string; fromId: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [carrierId, setCarrierId] = useState(initial.carrierId);
  const [productCode, setProductCode] = useState(initial.productCode);
  const [fromId, setFromId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sources = startFrom(carrierId, productCode);
  const from = sources.find((s) => s.id === fromId) ?? sources[0] ?? null;
  const issue = !carrierId ? "Choose a carrier." : taken(carrierId, productCode) ?? (!from ? "There is no set to start from for this product." : null);
  const submit = async () => {
    if (!carrierId || !from) return;
    setBusy(true);
    try {
      await onSubmit({ carrierId, productCode, fromId: from.id });
    } finally {
      setBusy(false);
    }
  };
  return (
    <SalesDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Give a carrier its own set"
      description="Until a carrier has its own set, its applications use the platform set. The new set starts as a draft; publish it when it matches the carrier's form."
    >
      <div className="flex flex-col gap-4">
        <Field label="Carrier" htmlFor="fs-new-carrier" required hint={carriers.length === 0 ? "Add a carrier in Carriers first." : undefined}>
          <select id="fs-new-carrier" className={control} value={carrierId ?? ""} onChange={(e) => { setCarrierId(e.target.value || null); setFromId(null); }}>
            <option value="">Choose a carrier…</option>
            {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Product line" htmlFor="fs-new-product" required>
          <select id="fs-new-product" className={control} value={productCode} onChange={(e) => { setProductCode(e.target.value); setFromId(null); }}>
            {/* Only the lines the agency sells (Settings › Products); the one already chosen stays listed. */}
            {productLines.filter((p) => p.sold !== false || p.code === productCode).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </select>
        </Field>
        {sources.length > 0 && (
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 text-sm font-semibold text-[var(--ink)]">Start from</legend>
            {sources.map((s) => (
              <label key={s.id} className="flex cursor-pointer items-center gap-3 rounded-md border border-[var(--border)] px-3 py-2.5 text-sm has-[:checked]:border-[var(--brand-500)] has-[:checked]:bg-[var(--primary-soft)]">
                <input type="radio" name="fs-new-from" className={checkbox} checked={from?.id === s.id} onChange={() => setFromId(s.id)} />
                <span className="min-w-0 flex-1 font-semibold text-[var(--ink)]">{s.label}</span>
                <span className="text-xs text-[var(--body)]">{s.detail}</span>
              </label>
            ))}
          </fieldset>
        )}
        {issue && <p role="alert" className="m-0 text-xs leading-[1.5] text-[var(--error-ink)]">{issue}</p>}
        <DialogActions>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <WithReason reason={issue}>
            <Button type="button" disabled={Boolean(issue) || busy} onClick={() => { void submit(); }}>{busy ? "Creating…" : "Create draft"}</Button>
          </WithReason>
        </DialogActions>
      </div>
    </SalesDialog>
  );
}

export function FieldSetPublishDialog({ pair, version, liveVersion, required, optional, onConfirm, onClose }: {
  pair: string;
  version: number;
  liveVersion: number | null;
  required: number;
  optional: number;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <SalesDialog open onOpenChange={(open) => !open && onClose()} title={`Publish ${pair} v${version}?`}>
      <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-sm leading-[1.5] text-[var(--ink)]">
        <li>New {pair} applications ask for {plural(required, "required field")} and {optional} optional.</li>
        {liveVersion !== null && <li>Version {liveVersion} is retired at the same time. Applications already started keep it.</li>}
        <li>A published version never changes. To change it later, edit it to start a new draft.</li>
      </ul>
      <DialogActions>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={busy} onClick={() => { setBusy(true); void onConfirm().finally(() => setBusy(false)); }}>{busy ? "Publishing…" : `Publish v${version}`}</Button>
      </DialogActions>
    </SalesDialog>
  );
}

export function FieldSetRetireDialog({ pair, version, fallback, onConfirm, onClose }: {
  pair: string;
  version: number;
  /** What new applications use after it: "the platform set (13 required)". */
  fallback: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <SalesDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Retire ${pair} v${version}?`}
      description={`New ${pair} applications use ${fallback} instead. Applications already started or submitted keep v${version}. A retired version cannot be published again.`}
    >
      <DialogActions>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="destructive" disabled={busy} onClick={() => { setBusy(true); void onConfirm().finally(() => setBusy(false)); }}>{busy ? "Retiring…" : `Retire v${version}`}</Button>
      </DialogActions>
    </SalesDialog>
  );
}

/**
 * Add a question, or edit one (owner 2026-10-30). A built-in field changes only what the carrier's
 * form calls it and its help line; its key and type stay, because autofill maps, copy-assist and QA
 * rely on them. The agency's own question changes everything, and can be removed.
 */
export function QuestionDialog({ mode, builtIn, initial, groups, types, onSubmit, onRemove, onClose, pair, extra }: {
  mode: "add" | "edit";
  /** Set when editing a built-in field: its own name and type, shown locked. */
  builtIn?: { key: string; name: string; typeLabel: string; sensitive: boolean } | null;
  initial: QuestionDraft;
  groups: readonly { key: string; label: string }[];
  types: Record<string, string>;
  onSubmit: (draft: QuestionDraft) => void;
  onRemove?: () => void;
  onClose: () => void;
  /** "American Amicable · Final Expense": the sheet's subtitle. */
  pair?: string;
  /** More sections under the field's own (round 8: where autofill puts it, the set's versions). */
  extra?: ReactNode;
}) {
  // Settings round 8 (sales-process board, Carrier application): a field opens as a right sheet, not a dialog.
  const [draft, setDraft] = useState<QuestionDraft>(initial);
  const [optionsText, setOptionsText] = useState(initial.options.join("\n"));
  const set = (p: Partial<QuestionDraft>) => setDraft((d) => ({ ...d, ...p }));
  const options = optionsText.split("\n").map((o) => o.trim()).filter(Boolean);
  const issue = !builtIn && !draft.label.trim() ? "Write the question." : !builtIn && draft.type === "choice" && options.length === 0 ? "Add at least one choice, one per line." : null;
  const title = builtIn ? builtIn.name : mode === "add" ? "Add a question" : draft.label || "Your question";
  return (
    <Sheet
      title={title}
      subtitle={pair}
      onClose={onClose}
      footer={
        <>
          {onRemove && <Button type="button" variant="ghost" className="text-[var(--error-ink)]" onClick={onRemove}>Remove question</Button>}
          <span className="ml-auto flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <WithReason reason={issue}>
              <Button type="button" disabled={Boolean(issue)} onClick={() => onSubmit({ ...draft, options })}>{mode === "add" ? "Add question" : "Save to draft"}</Button>
            </WithReason>
          </span>
        </>
      }
    >
      <section aria-label="On the Application step" className="flex flex-col gap-4 border-b border-[var(--border)] pb-5">
        <div>
          <h3 className="m-0 text-sm font-semibold text-[var(--ink)]">On the Application step</h3>
          <p className="m-0 text-xs text-[var(--muted)]">
            {builtIn
              ? `A built-in field (${builtIn.typeLabel.toLowerCase()}${builtIn.sensitive ? ", masked, each reveal is logged" : ""}). Its type stays: autofill maps, copy-assist and pre-submit checks rely on it.`
              : "Your own question. Agents must answer it before Submit when it is Required."}
          </p>
        </div>
        <ThreeWay size="md" label="Asked as" value={draft.state} onChange={(state) => set({ state })} options={[{ key: "optional", label: "Optional" }, { key: "required", label: "Required" }]} />
        {builtIn ? (
          <Field label="Label the agent sees" htmlFor="fs-q-label" hint={`Leave it as "${builtIn.name}" when the carrier's form uses the same words.`}>
            <input id="fs-q-label" className={control} value={draft.label} placeholder={builtIn.name} onChange={(e) => set({ label: e.target.value })} />
          </Field>
        ) : (
          <>
            <Field label="Question" htmlFor="fs-q-label" required>
              <input id="fs-q-label" className={control} value={draft.label} placeholder="For example: Spouse's occupation" onChange={(e) => set({ label: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Answer type" htmlFor="fs-q-type" required>
                <select id="fs-q-type" className={control} value={draft.type} onChange={(e) => set({ type: e.target.value })}>
                  {Object.entries(types).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </Field>
              <Field label="Section" htmlFor="fs-q-group" required>
                <select id="fs-q-group" className={control} value={draft.group} onChange={(e) => set({ group: e.target.value })}>
                  {groups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                </select>
              </Field>
            </div>
            {draft.type === "choice" && (
              <Field label="Choices" htmlFor="fs-q-options" required hint="One per line.">
                <textarea id="fs-q-options" className={`${control} min-h-24 py-2`} value={optionsText} onChange={(e) => setOptionsText(e.target.value)} />
              </Field>
            )}
          </>
        )}
        <Field label="Help under it" htmlFor="fs-q-help" hint="Shown under the field in the application step. Optional.">
          <textarea id="fs-q-help" className={`${control} min-h-20 py-2`} value={draft.help} maxLength={300} placeholder="For example: as written on the insured's driver's licence" onChange={(e) => set({ help: e.target.value })} />
        </Field>
        {issue && <p role="alert" className="m-0 text-xs leading-[1.5] text-[var(--error-ink)]">{issue}</p>}
      </section>
      {extra}
    </Sheet>
  );
}

export type CopyTarget = { key: string; label: string; free: boolean; why: string };

export function CopyToCarriersDialog({ pair, targets, onSubmit, onClose }: {
  pair: string;
  targets: CopyTarget[];
  onSubmit: (keys: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const toggle = (key: string) => setPicked((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));
  const free = targets.filter((t) => t.free);
  return (
    <SalesDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Use this set for other carriers"
      description={`Each carrier you tick gets a draft copy of ${pair}. Publish each one when it matches that carrier's form.`}
    >
      <div className="flex max-h-[44vh] flex-col gap-1 overflow-y-auto">
        {targets.length === 0 && <p className="m-0 text-sm text-[var(--body)]">No other carrier sells this product line yet.</p>}
        {targets.map((t) => (
          <label key={t.key} className={`flex items-center gap-3 rounded-md px-2 py-2 text-sm ${t.free ? "cursor-pointer hover:bg-[var(--surface-alt)]" : "opacity-60"}`}>
            <input type="checkbox" className={checkbox} disabled={!t.free} checked={picked.includes(t.key)} onChange={() => toggle(t.key)} />
            <span className="min-w-0 flex-1 font-semibold text-[var(--ink)]">{t.label}</span>
            <span className="text-xs text-[var(--body)]">{t.why}</span>
          </label>
        ))}
      </div>
      {free.length > 1 && (
        <button type="button" className="self-start text-xs font-semibold text-[var(--accent-ink)] underline-offset-2 hover:underline" onClick={() => setPicked(picked.length === free.length ? [] : free.map((t) => t.key))}>
          {picked.length === free.length ? "Clear all" : `Tick all ${free.length}`}
        </button>
      )}
      <DialogActions>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <WithReason reason={picked.length ? null : "Tick at least one carrier."}>
          <Button type="button" disabled={!picked.length || busy} onClick={() => { setBusy(true); void onSubmit(picked).finally(() => setBusy(false)); }}>
            {busy ? "Creating…" : `Create ${plural(picked.length, "draft")}`}
          </Button>
        </WithReason>
      </DialogActions>
    </SalesDialog>
  );
}

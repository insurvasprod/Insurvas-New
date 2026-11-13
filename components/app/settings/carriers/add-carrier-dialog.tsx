"use client";

import { Check } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ToolbarSearch } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, control } from "@/components/app/settings/primitives";
import { ChoiceCard } from "@/components/app/settings/team/parts";
import { US_STATES } from "@/lib/appointments/constants";
import { levelToBp, todayIso } from "@/lib/appointments/tickModel";
import { cn } from "@/lib/utils";

import { writersIn, type Writer } from "./model";

type Step = 1 | 2 | 3;
const STEPS: { n: Step; label: string }[] = [{ n: 1, label: "Carrier" }, { n: 2, label: "Contract" }, { n: 3, label: "States and writers" }];

export type NewCarrier = { carrierId: string; level: string; from: string; writing: string; states: string[] };

/** The three steps, drawn as the board draws them: a number, a label, a line between. */
export function StepTrack({ step, steps }: { step: number; steps: { n: number; label: string }[] }) {
  return (
    <ol aria-label="Steps" className="m-0 flex list-none items-center gap-2 p-0">
      {steps.map((item, index) => (
        <li key={item.n} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none" aria-current={item.n === step ? "step" : undefined}>
          <span className={cn("flex items-center gap-1.5 text-xs whitespace-nowrap", item.n === step ? "font-semibold text-[var(--ink)]" : "text-[var(--muted)]")}>
            <span
              aria-hidden="true"
              className={cn(
                "grid size-[22px] place-items-center rounded-full text-xs font-bold",
                item.n < step ? "bg-[var(--primary-soft)] text-[var(--accent-ink)]" : item.n === step ? "bg-[var(--primary)] text-[var(--on-primary)]" : "bg-[var(--surface-alt)] text-[var(--muted)]",
              )}
            >
              {item.n < step ? <Check className="size-3" /> : item.n}
            </span>
            {item.label}
          </span>
          {index < steps.length - 1 && <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-[var(--border)]" />}
        </li>
      ))}
    </ol>
  );
}

/**
 * Board screen 9 · Add carrier: the first-run steps as a short dialog, carrier → contract → states and
 * writers. Nothing is saved until Add; then the carrier's sheet opens for its products and portal.
 */
export function AddCarrierDialog({ choices, writers, defaultStates, onClose, onAdd }: {
  /** Carriers the agency does not sell yet (switched-off ones included: adding turns them back on). */
  choices: { id: string; name: string; off: boolean }[];
  writers: Writer[] | null;
  /** The states the agency already sells in, offered as a one-click start. */
  defaultStates: string[];
  onClose: () => void;
  onAdd: (input: NewCarrier) => Promise<string | null>;
}) {
  const [step, setStep] = useState<Step>(1);
  const [query, setQuery] = useState("");
  const [carrierId, setCarrierId] = useState("");
  const [level, setLevel] = useState("");
  const [from, setFrom] = useState(todayIso());
  const [writing, setWriting] = useState("");
  const [states, setStates] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const picked = choices.find((choice) => choice.id === carrierId) ?? null;
  const needle = query.trim().toLowerCase();
  const shown = choices.filter((choice) => !needle || choice.name.toLowerCase().includes(needle));
  const levelBad = level.trim() !== "" && levelToBp(level) === null;

  async function add() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    const failure = await onAdd({ carrierId: picked.id, level, from, writing, states: [...states] });
    setBusy(false);
    if (failure) setError(failure);
  }

  const toggle = (code: string) => setStates((current) => { const next = new Set(current); if (next.has(code)) next.delete(code); else next.add(code); return next; });

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent size="xl" className="max-h-[90vh] gap-0 overflow-hidden p-0">
        <div className="flex max-h-[90vh] flex-col">
          <DialogHeader className="gap-1 border-b border-[var(--border)] px-5 pt-5 pb-4">
            <DialogTitle>{picked ? `Add ${picked.name}` : "Add a carrier"}</DialogTitle>
            <DialogDescription>Takes a minute. You can change all of this later in the carrier&rsquo;s sheet.</DialogDescription>
            <div className="mt-3"><StepTrack step={step} steps={STEPS} /></div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {step === 1 && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold text-[var(--ink)]">Which carrier?</span>
                  <ToolbarSearch value={query} onChange={setQuery} placeholder="Find a carrier" className="ml-auto sm:w-60" />
                </div>
                {shown.length === 0 ? (
                  <p className="m-0 text-sm text-[var(--muted)]">{query.trim() ? `No carrier matches “${query.trim()}”. Ask Insurvas support to add it; it usually takes a day.` : "Every carrier in the library is already yours."}</p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Carrier">
                    {shown.map((choice) => (
                      <ChoiceCard key={choice.id} name="add-carrier" selected={carrierId === choice.id} onSelect={() => setCarrierId(choice.id)} title={choice.name} help={choice.off ? "Switched off · adding turns it back on" : undefined} />
                    ))}
                  </div>
                )}
                <p className="m-0 text-xs text-[var(--muted)]">Can&rsquo;t find yours? Ask Insurvas support to add it, usually within a day.</p>
              </div>
            )}
            {step === 2 && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Contracted from" htmlFor="add-from">
                  <input id="add-from" type="date" className={control} value={from} onChange={(event) => setFrom(event.target.value)} />
                </Field>
                <Field label="First-year commission" htmlFor="add-level" error={levelBad ? "Write it as a number, like 110." : undefined} hint="Optional. Ask your upline if unsure; most final-expense contracts are 80–120%.">
                  <input id="add-level" className={control} inputMode="decimal" value={level} placeholder="100" onChange={(event) => setLevel(event.target.value)} />
                </Field>
                <Field label="Agency writing number" htmlFor="add-writing" hint="Optional. Kept behind technical details on the carrier's sheet." className="sm:col-span-2">
                  <input id="add-writing" className={control} value={writing} autoComplete="off" spellCheck={false} onChange={(event) => setWriting(event.target.value)} />
                </Field>
                <p className="m-0 text-xs text-[var(--muted)] sm:col-span-2">Products and the carrier&rsquo;s portal are picked on its sheet, which opens when you add it.</p>
              </div>
            )}
            {step === 3 && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-[var(--body)]">{states.size ? `${states.size} ${states.size === 1 ? "state" : "states"} picked` : "Tick the states you're appointed in."}</span>
                  {defaultStates.length > 0 && <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setStates(new Set(defaultStates))}>Same as your other carriers ({defaultStates.length})</Button>}
                  {states.size > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => setStates(new Set())}>Clear</Button>}
                </div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
                  {US_STATES.map(([code, name]) => {
                    const count = writers ? writersIn(writers, code).length : null;
                    return (
                      <label key={code} className={cn("flex min-w-0 cursor-pointer items-center gap-2 rounded-[8px] border px-2.5 py-1.5 text-sm text-[var(--body)]", states.has(code) ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border)]")}>
                        <input type="checkbox" className="size-4 shrink-0 accent-[var(--primary)]" checked={states.has(code)} onChange={() => toggle(code)} />
                        <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
                        {count !== null && <span className="shrink-0 text-xs text-[var(--muted)]" title="Licensed writers there">{count}</span>}
                      </label>
                    );
                  })}
                </div>
                {writers && <p className="m-0 text-xs text-[var(--muted)]">The number is how many of your writers are licensed in the state.</p>}
              </div>
            )}
            {error && <p role="alert" className="m-0 mt-3 text-xs text-[var(--error-ink)]">{error}</p>}
          </div>

          <div className="flex items-center gap-2 border-t border-[var(--border)] px-5 py-3">
            {step > 1 ? <Button type="button" variant="ghost" onClick={() => setStep((step - 1) as Step)} disabled={busy}>Back</Button> : <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>}
            <span className="ml-auto text-xs text-[var(--muted)]">Step {step} of 3</span>
            {step === 1 && <Button type="button" disabled={!picked} onClick={() => setStep(2)}>Next: contract</Button>}
            {step === 2 && <Button type="button" disabled={levelBad} onClick={() => setStep(3)}>Next: states and writers</Button>}
            {step === 3 && <Button type="button" disabled={busy} onClick={() => void add()}>{busy ? "Adding…" : `Add ${picked?.name ?? "carrier"}`}</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

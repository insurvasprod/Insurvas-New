"use client";

import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { CONTACT_INCOME_TYPE_LABELS, CONTACT_INCOME_TYPES, type ContactIncomeType } from "@/lib/retention/income";
import type { IncomeView } from "@/lib/retention/incomeStore";
import { notify } from "@/lib/notify";

const field = `${toolbarControl} w-full`;
const dollars = (cents: number) => (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/**
 * LA-5.10 (Notion sprint) · the client's monthly income — optional, one figure per person, wherever
 * it is asked. Reads and saves through the route it is given (each logs the access). Never blocks
 * anything: leave it empty and nothing waits.
 */
export function IncomeCapture({ readUrl, save, defaultType, prompt, readOnly, compact, onSaved }: {
  /** GET → IncomeView. */
  readUrl: string;
  /** PUT a figure (or null to clear) → IncomeView. */
  save: (income: { monthly_dollars: string; income_type: ContactIncomeType | null; household_total: boolean; estimate: boolean } | null) => Promise<Response>;
  defaultType?: ContactIncomeType | null;
  prompt?: string;
  readOnly?: boolean;
  compact?: boolean;
  onSaved?: () => void;
}) {
  const id = useId();
  const [view, setView] = useState<IncomeView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<ContactIncomeType | "">(defaultType ?? "");
  const [household, setHousehold] = useState(false);
  const [estimate, setEstimate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(readUrl, { cache: "no-store" })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error ?? "The income could not be read.");
        return data as IncomeView;
      })
      .then((v) => {
        if (!live) return;
        setView(v);
        if (v.income) {
          setAmount(dollars(v.income.monthlyIncomeCents));
          setType(v.income.incomeType ?? "");
          setHousehold(v.income.householdTotal);
          setEstimate(v.income.confidence === "estimated");
        }
      })
      .catch((e) => live && setLoadError(e instanceof Error ? e.message : "The income could not be read."));
    return () => { live = false; };
  }, [readUrl]);

  async function submit(clear: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await save(clear ? null : { monthly_dollars: amount.trim(), income_type: type || null, household_total: household, estimate });
      const data = (await response.json().catch(() => ({}))) as IncomeView & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "The income could not be saved.");
      setView(data);
      if (clear) { setAmount(""); setHousehold(false); setEstimate(false); }
      notify.done(clear ? "Income removed." : "Income saved. It is used for the payment-risk score and nothing else.");
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The income could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <p className="m-0 text-sm text-muted-foreground">{loadError}</p>;
  if (!view) return <p className="m-0 text-sm text-muted-foreground" aria-busy="true">Reading the client&apos;s record</p>;
  if (view.unavailable) return <p className="m-0 text-sm text-muted-foreground">{view.unavailable}</p>;

  return (
    <div className="grid gap-3">
      {prompt && <p className="m-0 text-sm text-foreground">&ldquo;{prompt}&rdquo;</p>}
      <div className={compact ? "grid gap-3" : "grid gap-3 sm:grid-cols-2"}>
        <label htmlFor={`${id}-amount`} className="grid gap-1.5 text-sm font-medium text-foreground">
          Monthly income ($)
          <input id={`${id}-amount`} inputMode="decimal" autoComplete="off" className={field} value={amount} disabled={readOnly || busy} onChange={(e) => setAmount(e.target.value)} placeholder="Optional" />
        </label>
        <label htmlFor={`${id}-type`} className="grid gap-1.5 text-sm font-medium text-foreground">
          Mostly from
          <select id={`${id}-type`} className={field} value={type} disabled={readOnly || busy} onChange={(e) => setType(e.target.value as ContactIncomeType | "")}>
            <option value="">Not said</option>
            {CONTACT_INCOME_TYPES.map((t) => <option key={t} value={t}>{CONTACT_INCOME_TYPE_LABELS[t]}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-foreground">
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={household} disabled={readOnly || busy} onChange={(e) => setHousehold(e.target.checked)} />The household&apos;s total</label>
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={estimate} disabled={readOnly || busy} onChange={(e) => setEstimate(e.target.checked)} />My estimate, not what they said</label>
      </div>
      {error && <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={busy || amount.trim() === ""} onClick={() => void submit(false)}>{busy ? "Saving…" : view.income ? "Update income" : "Save income"}</Button>
          {view.income && <Button type="button" variant="ghost" disabled={busy} onClick={() => void submit(true)}>Remove</Button>}
          {view.income && <span className="text-xs text-muted-foreground">{view.income.confidence === "estimated" ? "An estimate" : "As they said"}{view.income.householdTotal ? " · household total" : ""}{view.onLead ? " · kept with the lead until the policy issues" : ""}</span>}
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * "Can they finish on this call?" (LeadWorkspace concept board): six answers the agent records while
 * the customer is on the line, and what they add up to. Each answer is Yes, No or Not asked; not asked
 * is never read as no. Saved per lead through /api/app/leads/[id]/signature-readiness.
 */

import { useEffect, useState } from "react";

import { EMPTY_SIGNATURE, SIGNATURE_KEYS, SIGNATURE_LABELS, signatureGuidance, type SignatureAnswers, type SignatureKey } from "@/lib/leadWorkspace/signatureReadiness";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

type State = { schemaPending: boolean; answers: SignatureAnswers; updatedAt: string | null };

const TONE: Record<string, string> = {
  success: "border-[var(--success)]/30 bg-[var(--success-surface)] text-[var(--success-ink)]",
  warning: "border-[var(--warning)]/30 bg-[var(--warning-surface)] text-[var(--warning-ink)]",
  error: "border-[var(--error)]/30 bg-[var(--error-surface)] text-[var(--error-ink)]",
  neutral: "border-border bg-[var(--surface-alt)] text-[var(--ink)]",
};

export function LeadSignatureReadiness({ leadId, readOnly }: { leadId: string; readOnly: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<SignatureKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/app/leads/${encodeURIComponent(leadId)}/signature-readiness`, { cache: "no-store" })
      .then(async (response) => { const body = await response.json().catch(() => null); if (cancelled) return; if (!response.ok || !body) { setFailed(true); return; } setState(body as State); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [leadId]);

  async function answer(key: SignatureKey, value: boolean | null) {
    if (!state) return;
    const previous = state;
    setState({ ...state, answers: { ...state.answers, [key]: value } });
    setSaving(key);
    const response = await fetch(`/api/app/leads/${encodeURIComponent(leadId)}/signature-readiness`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [key]: value }) }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setSaving(null);
    if (!response || !response.ok) { setState(previous); notify.block(body?.error ?? "Could not save that answer"); return; }
    setState(body as State);
  }

  if (failed) return <p className="mt-5 text-sm text-muted-foreground">Signature availability could not be loaded.</p>;
  const answers = state?.answers ?? EMPTY_SIGNATURE;
  const guidance = signatureGuidance(answers);
  const locked = readOnly || !state || state.schemaPending;

  return (
    <section aria-labelledby="signature-readiness-title" className="mt-6 border-t border-border pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="signature-readiness-title" className="text-lg font-semibold leading-[1.28] tracking-[-0.015em]">Can they finish on this call?</h2>
        <span className="text-sm font-semibold tabular-nums text-muted-foreground">{guidance.yes} of {SIGNATURE_KEYS.length}</span>
      </div>
      {state?.schemaPending && <p role="status" className="mt-2 text-sm text-[var(--warning-ink)]">Answers cannot be saved until a pending database update is applied.</p>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {SIGNATURE_KEYS.map((key) => {
          const value = answers[key];
          return (
            <div key={key} role="group" aria-label={SIGNATURE_LABELS[key]} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
              <span className={cn("text-sm", value === false ? "font-semibold text-[var(--error-ink)]" : value === true ? "text-foreground" : "text-muted-foreground")}>{SIGNATURE_LABELS[key]}</span>
              <span className="flex shrink-0 gap-1">
                {([[true, "Yes"], [false, "No"], [null, "Not asked"]] as Array<[boolean | null, string]>).map(([option, label]) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={value === option}
                    disabled={locked || saving === key}
                    onClick={() => void answer(key, option)}
                    className={cn("h-7 rounded-md border px-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60", value === option ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--surface)]" : "border-[var(--border-strong)] bg-card text-foreground hover:bg-[var(--surface-alt)]")}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </div>
          );
        })}
      </div>
      <p role="status" className={cn("mt-3 rounded-lg border px-4 py-2.5 text-sm", TONE[guidance.tone])}>
        <span className="font-semibold">{guidance.headline}</span> <span className="text-[var(--body)]">{guidance.detail}</span>
      </p>
    </section>
  );
}

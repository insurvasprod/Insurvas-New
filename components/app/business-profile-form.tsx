"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

import { AuthCard, authControl, authLabel } from "@/components/app/auth-card";
import { Button } from "@/components/ui/button";
import { deriveRecommendedSetupSteps, LEAD_SOURCE_OPTIONS, PRODUCT_OPTIONS, US_STATES, VOLUME_OPTIONS } from "@/lib/signup/constants";
import { cn } from "@/lib/utils";

const chip = (on: boolean) =>
  cn(
    "rounded-lg px-3.5 py-2.5 text-sm font-semibold tracking-[-0.02em]",
    on ? "border-[1.5px] border-[var(--primary)] bg-[var(--soft-orange-surface)] text-[var(--accent-ink)]" : "border border-[var(--border-strong)] bg-card text-[var(--body)]",
  );

function Stepper() {
  return (
    <ol className="mt-6 flex items-center rounded-xl border border-border bg-card px-5 py-3.5" aria-label="Signup steps">
      <li className="flex items-center gap-2.5">
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-[var(--success)] text-white" aria-hidden="true"><Check className="size-3.5 stroke-[3]" /></span>
        <span className="text-sm font-semibold text-foreground">Account complete</span>
      </li>
      <li className="m-track mx-3 h-0.5 flex-grow bg-[var(--success)]" aria-hidden="true" />
      <li className="flex items-center gap-2.5" aria-current="step">
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-[var(--primary)] text-xs font-semibold text-[var(--on-primary)]">2</span>
        <span className="text-sm font-semibold text-foreground">Business profile</span>
      </li>
      <li className="m-track mx-3 h-0.5 flex-grow bg-border" aria-hidden="true" />
      <li className="flex items-center gap-2.5">
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-[var(--surface-alt)] text-xs font-semibold text-muted-foreground">3</span>
        <span className="text-sm font-semibold text-muted-foreground">Checkout</span>
      </li>
    </ol>
  );
}

/**
 * Step 2 of 3. The answers decide the setup checklist shown after checkout, and the preview on the
 * right is that checklist, computed by the same function the server saves it with — so what the
 * reader sees here is exactly what they will get, not an illustration of it.
 */
export function BusinessProfileForm() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState("");
  const [npn, setNpn] = useState("");
  const [primaryState, setPrimaryState] = useState("");
  const [products, setProducts] = useState<string[]>([]);
  const [volume, setVolume] = useState("");
  const [leadSources, setLeadSources] = useState<string[]>([]);
  const [leadSourceOther, setLeadSourceOther] = useState("");
  const [submitting, setSubmitting] = useState<"continue" | "exit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const steps = useMemo(() => deriveRecommendedSetupSteps({ productsSold: products, monthlyVolumeRange: volume, leadSources }), [products, volume, leadSources]);
  const missing = [
    businessName.trim().length < 2 && "business name",
    !/^\d{1,10}$/.test(npn.trim()) && "NPN",
    !primaryState && "primary state",
    products.length === 0 && "a product",
    !volume && "monthly applications",
    leadSources.length === 0 && "a lead source",
    leadSources.includes("other") && !leadSourceOther.trim() && "the other lead source",
  ].filter(Boolean) as string[];

  function toggle(value: string, current: string[], set: (next: string[]) => void) {
    set(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  async function save(event: FormEvent<HTMLFormElement> | null, then: "continue" | "exit") {
    event?.preventDefault();
    setError(null);
    if (missing.length) { setError(`Still needed: ${missing.join(", ")}.`); return; }
    setSubmitting(then);
    try {
      const response = await fetch("/api/app/onboarding/business-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessName, npn, primaryState, productsSold: products, monthlyVolumeRange: volume, leadSources, leadSourceOther: leadSources.includes("other") ? leadSourceOther : null }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.error ?? "Could not save your business profile"); return; }
      if (then === "exit") {
        // Saved; the next sign-in lands on checkout, where this left off.
        await fetch("/api/app/auth/logout", { method: "POST" }).catch(() => null);
        router.push("/app/login");
      } else {
        router.push(body?.redirectTo ?? "/app/checkout");
      }
      router.refresh();
    } catch {
      setError("Could not save your business profile. Check your connection and try again.");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <AuthCard width={1040} eyebrow="Step 2 of 3" title="Tell us about your agency" description="Six questions. The answers set up your workspace checklist, and you can change any of it later in Settings.">
      <Stepper />
      <form onSubmit={(event) => void save(event, "continue")} noValidate>
        <div className="mt-7 flex flex-col gap-6 lg:flex-row">
          <div className="flex min-w-0 flex-grow flex-col gap-4">
            <label className="block">
              <span className={authLabel}>Business name</span>
              <input className={authControl} autoComplete="organization" maxLength={160} value={businessName} onChange={(event) => setBusinessName(event.target.value)} />
            </label>
            <label className="block">
              <span className={authLabel}>NPN</span>
              <input className={authControl} inputMode="numeric" maxLength={10} value={npn} onChange={(event) => setNpn(event.target.value.replace(/\D/g, ""))} />
              <span className="mt-1.5 block text-xs text-muted-foreground">Your National Producer Number. Used for agency setup and verification. It is never shown to partners.</span>
            </label>
            <label className="block">
              <span className={authLabel}>Primary state</span>
              <select className={authControl} value={primaryState} onChange={(event) => setPrimaryState(event.target.value)}>
                <option value="" disabled>Choose a state</option>
                {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </label>
            <fieldset>
              <legend className={authLabel}>Products sold</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {PRODUCT_OPTIONS.map((option) => <button key={option.value} type="button" aria-pressed={products.includes(option.value)} className={chip(products.includes(option.value))} onClick={() => toggle(option.value, products, setProducts)}>{option.label}</button>)}
              </div>
            </fieldset>
            <label className="block">
              <span className={authLabel}>Monthly applications</span>
              <select className={authControl} value={volume} onChange={(event) => setVolume(event.target.value)}>
                <option value="" disabled>Choose a range</option>
                {VOLUME_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <fieldset>
              <legend className={authLabel}>Where your leads come from</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {LEAD_SOURCE_OPTIONS.map((option) => <button key={option.value} type="button" aria-pressed={leadSources.includes(option.value)} className={chip(leadSources.includes(option.value))} onClick={() => toggle(option.value, leadSources, setLeadSources)}>{option.label}</button>)}
              </div>
            </fieldset>
            {leadSources.includes("other") && (
              <label className="block">
                <span className={authLabel}>Other lead source</span>
                <input className={authControl} maxLength={120} value={leadSourceOther} onChange={(event) => setLeadSourceOther(event.target.value)} />
              </label>
            )}
          </div>

          <aside className="w-full shrink-0 lg:w-[300px]">
            <div className="rounded-xl border border-border bg-card p-5 lg:sticky lg:top-6">
              <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-foreground">Your setup preview</h2>
              <p className="mt-1 text-sm text-muted-foreground">Recomputed as you answer. It is why the questions are being asked.</p>
              <ol className="mt-2" aria-live="polite">
                {steps.map((step, index) => (
                  <li key={step} className="flex gap-2.5 border-t border-border py-2.5">
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-xs font-semibold" aria-hidden="true">{index + 1}</span>
                    <span className="text-sm text-[var(--body)]">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </aside>
        </div>

        {error && <p role="alert" className="mt-6 rounded-lg border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] p-3 text-sm text-[var(--error-ink)]">{error}</p>}
        <div className="mt-7 flex flex-wrap items-center justify-end gap-3">
          <Button type="button" variant="outline" className="h-11 border-[var(--border-strong)] px-4" disabled={submitting !== null} onClick={() => void save(null, "exit")}>{submitting === "exit" ? "Saving…" : "Save and exit"}</Button>
          <Button type="submit" className="h-11 px-4" disabled={submitting !== null}>{submitting === "continue" ? "Saving…" : "Save and continue"}</Button>
        </div>
      </form>
    </AuthCard>
  );
}

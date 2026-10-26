"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneCountryPicker } from "@/components/public/phone-country-picker";
import { FunnelHeading } from "@/components/app/funnel-frame";
import { NewPasswordField, passwordLongEnough } from "@/components/app/password-field";
import { BILLING_CYCLES, type BillingCycle } from "@/lib/money";
import { DEFAULT_PHONE_COUNTRY, checkPhone, phoneCountry } from "@/lib/signup/phone";
import { cn } from "@/lib/utils";

type LegalDoc = { id: string; doc_type: string; version: number; title: string; is_draft: boolean };

type Props = { initialPlanCode?: string; initialCycle?: string; /** CHECKOUT_PAYMENT_MODE=none: no card is asked for anywhere. */ noPayment?: boolean };

const fieldClass = "h-11 border-[var(--border-strong)] bg-card px-3 text-base";

/**
 * Step 1 of 5 (redesign A, 2026-10-24): the account. First and last name, email, password (typed
 * twice), phone number with its country code, and the legal box. No card here.
 *
 * 2026-10-26 (owner): the name is two fields, "Work email" is "Email", the phone has a country prefix
 * and is checked as it is typed (lib/signup/phone.ts; the server checks it again), a confirm-password
 * field. The plan moved to its own step, Step 4 of 5; a plan picked on the pricing page is still
 * carried through and preselected there.
 */
export function SignupForm({ initialPlanCode, initialCycle, noPayment = false }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legalDocs, setLegalDocs] = useState<LegalDoc[]>([]);
  const [legalState, setLegalState] = useState<"loading" | "ready" | "failed">("loading");
  // Unticked, and initialised unticked — never derived from anything that could arrive true.
  const [accepted, setAccepted] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [phoneCountryCode, setPhoneCountryCode] = useState(DEFAULT_PHONE_COUNTRY);
  const [phone, setPhone] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);

  const loadLegal = useCallback(() => {
    setLegalState("loading");
    fetch("/api/public/legal", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error();
        setLegalDocs(body?.documents ?? []);
        setLegalState("ready");
      })
      .catch(() => setLegalState("failed"));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first load of the legal text
    loadLegal();
  }, [loadLegal]);

  const phoneCheck = checkPhone(phoneCountryCode, phone);
  const phoneError = phoneTouched && !phoneCheck.ok ? phoneCheck.error : null;
  const mismatch = confirmTouched && confirm.length > 0 && confirm !== password;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!passwordLongEnough(password)) { setError("Use at least 12 characters for your password."); return; }
    if (confirm !== password) { setConfirmTouched(true); setError("The two passwords don't match."); return; }
    if (!phoneCheck.ok) { setPhoneTouched(true); setError(phoneCheck.error); return; }
    if (!accepted) { setError("Tick the box to accept the terms and privacy policy."); return; }

    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    try {
      const response = await fetch("/api/public/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: `${String(form.get("firstName") ?? "").trim()} ${String(form.get("lastName") ?? "").trim()}`.trim(),
          email: form.get("email"),
          password,
          phone: phoneCheck.e164,
          // A plan picked on the pricing page; Step 4 of 5 is where it is chosen or changed.
          planCode: initialPlanCode || undefined,
          billingCycle: BILLING_CYCLES.includes(initialCycle as BillingCycle) ? initialCycle : undefined,
          // The exact versions shown next to the box that was ticked.
          acceptedDocumentIds: accepted ? legalDocs.map((doc) => doc.id) : [],
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.error ?? "Could not create your workspace. Try again."); return; }
      router.push(body?.redirectTo ?? "/app/verify-email");
      router.refresh();
    } catch {
      // Everything typed stays in the form; only the request is repeated.
      setError("Could not reach Insurvas. Check your connection and press the button again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <FunnelHeading title="Start your free trial">
        {noPayment ? "No card needed. Your workspace opens after a few short steps." : "$0 today. No card on this step. You choose your plan in step 4."}
      </FunnelHeading>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 pointer-coarse:[&_input:not([type=checkbox])]:min-h-11">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="firstName">First name</Label>
            <Input id="firstName" name="firstName" autoComplete="given-name" minLength={1} maxLength={60} required autoFocus className={fieldClass} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lastName">Last name</Label>
            <Input id="lastName" name="lastName" autoComplete="family-name" minLength={1} maxLength={60} required className={fieldClass} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" required className={fieldClass} />
        </div>

        <NewPasswordField id="password" name="password" value={password} onChange={setPassword} inputClassName={fieldClass} />

        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            onBlur={() => setConfirmTouched(true)}
            aria-invalid={mismatch || undefined}
            aria-describedby="confirm-note"
            className={cn(fieldClass, mismatch && "border-[var(--error)]")}
          />
          <p id="confirm-note" aria-live="polite" className={cn("text-xs leading-normal", mismatch ? "text-[var(--error-ink)]" : confirm && confirm === password ? "text-[var(--success-ink)]" : "text-muted-foreground")}>
            {mismatch ? "The passwords don't match" : confirm && confirm === password ? "Passwords match" : "Type the same password again"}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone number</Label>
          <div className="flex gap-2">
            {/* The prefix in the app's own dark list, a flag on each (2026-10-26: the browser's white list didn't match). */}
            <PhoneCountryPicker value={phoneCountryCode} onChange={setPhoneCountryCode} className="h-11 w-[120px] shrink-0" />
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              maxLength={24}
              required
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              onBlur={() => setPhoneTouched(true)}
              placeholder={phoneCountry(phoneCountryCode)?.example}
              aria-invalid={phoneError ? true : undefined}
              aria-describedby="phone-note"
              className={cn(fieldClass, "min-w-0 flex-1", phoneError && "border-[var(--error)]")}
            />
          </div>
          <p id="phone-note" aria-live="polite" className={cn("text-xs leading-normal tracking-[-0.01em]", phoneError ? "text-[var(--error-ink)]" : "text-muted-foreground")}>
            {phoneError ?? "Only for your account: during the trial, or if a payment fails."}
          </p>
        </div>

        {legalState === "failed" ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--surface-alt)] p-4 text-sm">
            <span className="text-[var(--body)]">The terms could not be loaded, so they cannot be accepted yet.</span>
            <button type="button" className="font-semibold text-[var(--accent-ink)] hover:underline" onClick={loadLegal}>Try again</button>
          </div>
        ) : legalDocs.length > 0 ? (
          <div className="space-y-2">
            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">
              <input
                type="checkbox"
                name="acceptTerms"
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
                className="mt-0.5 size-5 shrink-0 accent-[var(--accent-ink)]"
              />
              <span>
                I agree to the{" "}
                {legalDocs.map((doc, index) => (
                  <span key={doc.id}>
                    {index > 0 && (index === legalDocs.length - 1 ? " and the " : ", ")}
                    <Link href={`/legal/${doc.doc_type}?v=${doc.version}`} target="_blank" className="font-semibold text-foreground underline-offset-2 hover:underline">
                      {doc.title}
                    </Link>
                  </span>
                ))}
                .
              </span>
            </label>
            {legalDocs.some((doc) => doc.is_draft) && (
              <p className="pl-8 text-xs text-[var(--warning-ink)]">These documents are drafts and have not been reviewed by a lawyer.</p>
            )}
          </div>
        ) : legalState === "loading" ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Loading the terms…</div>
        ) : null}

        {error && (
          <div role="alert" className="rounded-lg border border-[color-mix(in_srgb,var(--error)_24%,transparent)] bg-[var(--error-surface)] px-4 py-3 text-sm text-[var(--error-ink)]">
            {error}
          </div>
        )}

        <Button type="submit" className="mt-1 h-12 w-full" disabled={submitting || !accepted}>
          {submitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {submitting ? "Creating your workspace…" : "Create my workspace"}
        </Button>

        <p className="text-sm leading-normal tracking-[-0.02em] text-muted-foreground">
          Already have an account?{" "}
          <Link href="/app/login" className="font-semibold text-[var(--accent-ink)] hover:text-foreground hover:underline">Sign in</Link>
        </p>
      </form>
    </div>
  );
}

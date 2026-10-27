"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

import { Input } from "@/components/ui/input";
import { AuthAlert, AuthSubmit, authLabel } from "@/components/portal/auth-controls";
import { PhoneCountryPicker } from "@/components/public/phone-country-picker";
import { FunnelHeading } from "@/components/app/funnel-frame";
import { NewPasswordField, passwordLongEnough } from "@/components/app/password-field";
import { BILLING_CYCLES, type BillingCycle } from "@/lib/money";
import { DEFAULT_PHONE_COUNTRY, checkPhone, phoneCountry } from "@/lib/signup/phone";
import { cn } from "@/lib/utils";

type LegalDoc = { id: string; doc_type: string; version: number; title: string; is_draft: boolean };

type Props = { initialPlanCode?: string; initialCycle?: string; /** CHECKOUT_PAYMENT_MODE=none: no card is asked for anywhere. */ noPayment?: boolean };

// The auth field (components/portal/auth-controls.tsx): 44px, 16px text at every width.
const fieldClass = "h-11 border-[var(--border-strong)] bg-card px-3 text-base md:text-base";

/**
 * Step 1 of 5 (redesign A, 2026-10-24): the account. First and last name, email, password (typed
 * twice), phone number with its country code, and the legal box. No card here.
 *
 * 2026-10-26 (owner): the name is two fields, "Work email" is "Email", the phone has a country prefix
 * and is checked as it is typed (lib/signup/phone.ts; the server checks it again), a confirm-password
 * field. The plan moved to its own step, Step 4 of 5; a plan picked on the pricing page is still
 * carried through and preselected there.
 */
export function SignupForm({ initialPlanCode, initialCycle }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legalDocs, setLegalDocs] = useState<LegalDoc[]>([]);
  const [legalState, setLegalState] = useState<"loading" | "ready" | "failed">("loading");
  // Unticked, and initialised unticked — never derived from anything that could arrive true.
  const [accepted, setAccepted] = useState(false);
  const [password, setPassword] = useState("");
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!passwordLongEnough(password)) { setError("Use at least 12 characters for your password."); return; }
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
      if (!response.ok) { setError(body?.error ?? "Could not create your account. Try again."); return; }
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
      <FunnelHeading title="Create your account">
        Already have an account?{" "}
        <Link href="/app/login" className="font-semibold text-[var(--accent-ink)] hover:text-foreground hover:underline">Sign in</Link>
      </FunnelHeading>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 pointer-coarse:[&_input:not([type=checkbox])]:min-h-11">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="firstName" className={authLabel}>First name</label>
            <Input id="firstName" name="firstName" autoComplete="given-name" minLength={1} maxLength={60} required autoFocus className={fieldClass} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="lastName" className={authLabel}>Last name</label>
            <Input id="lastName" name="lastName" autoComplete="family-name" minLength={1} maxLength={60} required className={fieldClass} />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="email" className={authLabel}>Work email</label>
          <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" required className={fieldClass} />
        </div>

        <NewPasswordField id="password" name="password" value={password} onChange={setPassword} inputClassName={fieldClass} />

        <div className="space-y-1.5">
          <label htmlFor="phone" className={authLabel}>Phone number</label>
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
          {/* Only when something is wrong: the field's purpose is in its placeholder and label. */}
          <p id="phone-note" aria-live="polite" className="text-xs leading-normal tracking-[-0.01em] text-[var(--error-ink)] empty:hidden">
            {phoneError}
          </p>
        </div>

        {legalState === "failed" ? (
          <AuthAlert>
            The terms could not be loaded, so they cannot be accepted yet.{" "}
            <button type="button" className="font-semibold underline underline-offset-2" onClick={loadLegal}>Try again</button>
          </AuthAlert>
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
          </div>
        ) : legalState === "loading" ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Loading the terms…</div>
        ) : null}

        {error && (
          <AuthAlert>{error}</AuthAlert>
        )}

        <AuthSubmit className="mt-1" disabled={submitting || !accepted}>
          {submitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {submitting ? "Creating your account…" : "Create account"}
        </AuthSubmit>

      </form>
    </div>
  );
}

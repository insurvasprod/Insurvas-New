"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

import { Input } from "@/components/ui/input";
import { AuthAlert, AuthSubmit, authLabel } from "@/components/portal/auth-controls";
import { GoogleButton } from "@/components/portal/google-button";
import { FunnelHeading } from "@/components/app/funnel-frame";
import { NewPasswordField, passwordLongEnough } from "@/components/app/password-field";
import { BILLING_CYCLES, type BillingCycle } from "@/lib/money";

type LegalDoc = { id: string; doc_type: string; version: number; title: string; is_draft: boolean };

type Props = {
  initialPlanCode?: string;
  initialCycle?: string;
  /** CHECKOUT_PAYMENT_MODE=none: no card is asked for anywhere. */
  noPayment?: boolean;
  /** "Continue with Google" above the fields, once Google is switched on in Supabase. */
  googleEnabled?: boolean;
  /** Why Google sent the person back, as a sentence (lib/tenantAuth/googleMessages.ts). */
  notice?: string | null;
};

// The auth field (components/portal/auth-controls.tsx): 44px, 16px text at every width.
const fieldClass = "h-11 border-[var(--border-strong)] bg-card px-3 text-base md:text-base";

/**
 * Step 1 of 5: the account. Email, password and the legal box, nothing else (manager review,
 * 2026-10-28: "the first one should only have email and password", with Google above). Name and phone
 * moved to step 3, About you (components/app/business-profile-form.tsx).
 *
 * The plan has its own step, Step 4 of 5; a plan picked on the pricing page is still carried through
 * and preselected there.
 */
export function SignupForm({ initialPlanCode, initialCycle, googleEnabled = false, notice = null }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(notice);
  const [legalDocs, setLegalDocs] = useState<LegalDoc[]>([]);
  const [legalState, setLegalState] = useState<"loading" | "ready" | "failed">("loading");
  // Unticked, and initialised unticked — never derived from anything that could arrive true.
  const [accepted, setAccepted] = useState(false);
  const [password, setPassword] = useState("");

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!passwordLongEnough(password)) { setError("Use at least 12 characters for your password."); return; }
    if (!accepted) { setError("Tick the box to accept the terms and privacy policy."); return; }

    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    try {
      const response = await fetch("/api/public/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password,
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
      {/* "Have an account? Sign in" sits on the step line (app/signup/page.tsx), so the heading stands
          alone. With Google on, it comes first, the fast path (owner, 2026-10-27). */}
      <FunnelHeading title="Create your account" />
      {googleEnabled && (
        <>
          <GoogleButton intent="sign-up" plan={initialPlanCode} cycle={initialCycle} className="w-full" />
          <div data-auth-divider="" className="my-4 flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />or use your email<span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      <form onSubmit={handleSubmit} noValidate data-auth-fields="" className="flex flex-col gap-4 pointer-coarse:[&_input:not([type=checkbox])]:min-h-11">
        {/* Only what an account needs (manager review, 2026-10-28): email and password, each on its own
            full-width line. Name and phone are asked on "About you", with the business details. */}
        <div className="space-y-1.5">
          <label htmlFor="email" className={authLabel}>Email</label>
          <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" required autoFocus className={fieldClass} />
        </div>

        <NewPasswordField id="password" name="password" value={password} onChange={setPassword} inputClassName={fieldClass} />

        {legalState === "failed" ? (
          <AuthAlert>
            The terms could not be loaded, so they cannot be accepted yet.{" "}
            <button type="button" className="font-semibold underline underline-offset-2" onClick={loadLegal}>Try again</button>
          </AuthAlert>
        ) : legalDocs.length > 0 ? (
          <div className="space-y-2">
            {/* 44px tall only for a finger; with a mouse the line is its own height. */}
            <label className="flex cursor-pointer items-start gap-3 text-sm leading-normal tracking-[-0.02em] text-[var(--body)] pointer-coarse:min-h-11">
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

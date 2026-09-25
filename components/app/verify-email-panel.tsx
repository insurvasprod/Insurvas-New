"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";

import { AuthCard, authControl, authLabel } from "@/components/app/auth-card";
import { LogoutButton } from "@/components/app/logout-button";
import { Button } from "@/components/ui/button";

const linkButton = "inline-flex items-center gap-1.5 text-sm font-semibold leading-[1.43] tracking-[-0.01em] text-foreground hover:text-[var(--accent-ink)] disabled:opacity-50 [&_svg]:transition-transform hover:[&_svg]:translate-x-[3px]";

/**
 * Step 1 of 3: the only screen a pending account can reach. It watches for the verification to
 * land — the link can be opened on a phone — and moves on by itself, which is the promise the first
 * line of "What to expect" makes.
 */
export function VerifyEmailPanel({ ttlHours }: { ttlHours: number }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [changing, setChanging] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sentNow, setSentNow] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async (initial: boolean) => {
    try {
      const response = await fetch("/api/app/onboarding/status", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load your account");
      if (body.userStatus !== "pending_verification") { router.replace(body.destination ?? "/app"); return; }
      if (initial) { setEmail(body.email); setNewEmail(body.email); }
    } catch (reason) {
      if (initial) setError(reason instanceof Error ? reason.message : "Could not load your account");
    } finally {
      if (initial) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating from the authenticated API
    void check(true);
    // Every 5 seconds while the tab is visible, and the moment it comes back into view.
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void check(false); }, 5000);
    const onFocus = () => void check(false);
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [check]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function send(action: "resend" | "change_email", event?: FormEvent) {
    event?.preventDefault();
    if (cooldown > 0) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/app/onboarding/verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "resend" ? { action } : { action, email: newEmail }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const retryAfter = Number(response.headers.get("retry-after"));
        if (Number.isFinite(retryAfter) && retryAfter > 0) setCooldown(retryAfter);
        setError(body?.error ?? "Could not send the link");
        return;
      }
      const sentEmail = typeof body?.email === "string" ? body.email : newEmail;
      setEmail(sentEmail);
      setNewEmail(sentEmail);
      setChanging(false);
      setSentNow(true);
      setMessage(action === "change_email" ? `Address updated. A new link is on its way to ${sentEmail}.` : `A new link is on its way to ${sentEmail}. The earlier one no longer works.`);
      setCooldown(60);
    } catch {
      setError("Could not send the link. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const steps = [
    "Open the link on any device. You will return here automatically once it is verified.",
    `The link expires after ${ttlHours} hours, and after the first use.`,
    "Nothing was charged. Payment happens at checkout, after the business profile.",
  ];

  return (
    <AuthCard width={680} eyebrow="Step 1 of 3" title="Check your email" description={`We sent a link to the address below. It works once and lasts ${ttlHours} hours.`}>
      {loading ? (
        <div className="flex h-28 items-center justify-center" role="status" aria-label="Loading your account"><LoaderCircle className="animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <div className="mt-7 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--surface-alt)] px-4 py-3.5">
            <span className="min-w-0 break-all text-base font-semibold tracking-[-0.02em] text-foreground">{email || "—"}</span>
            <span className={sentNow ? "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--success-surface)] px-2.5 py-[3px] text-xs font-semibold text-[var(--success-ink)]" : "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-card px-2.5 py-[3px] text-xs font-semibold text-[var(--body)]"}>
              <span className={sentNow ? "size-1.5 rounded-full bg-[var(--success)]" : "size-1.5 rounded-full bg-[var(--muted)]"} aria-hidden="true" />
              {sentNow ? "Sent just now" : "Sent at sign-up"}
            </span>
          </div>

          <section className="mt-6" aria-labelledby="verify-email-steps">
            <h2 id="verify-email-steps" className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-foreground">What to expect</h2>
            <ol className="mt-1">
              {steps.map((step, index) => (
                <li key={step} className="flex gap-3 border-t border-border py-2.5">
                  <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-xs font-semibold" aria-hidden="true">{index + 1}</span>
                  <span className="text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">{step}</span>
                </li>
              ))}
            </ol>
          </section>

          {changing && (
            <form onSubmit={(event) => send("change_email", event)} className="mt-4 rounded-lg border border-border p-4">
              <label className="block">
                <span className={authLabel}>Correct work email</span>
                <input type="email" required autoComplete="email" className={authControl} value={newEmail} onChange={(event) => setNewEmail(event.target.value)} />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="submit" className="h-10 px-4" disabled={submitting || cooldown > 0 || !newEmail.trim() || newEmail.trim() === email}>{submitting ? "Sending…" : "Update and send a new link"}</Button>
                <Button type="button" variant="outline" className="h-10 border-[var(--border-strong)] px-4" onClick={() => { setChanging(false); setNewEmail(email); }}>Cancel</Button>
              </div>
            </form>
          )}

          {message && <p role="status" className="mt-4 text-center text-sm font-semibold text-[var(--success-ink)]">{message}</p>}
          {error && <p role="alert" className="mt-4 rounded-lg border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] p-3 text-sm text-[var(--error-ink)]">{error}</p>}

          <div className="mt-7 flex flex-col gap-3">
            <Button type="button" className="h-11 w-full" onClick={() => void send("resend")} disabled={submitting || cooldown > 0}>
              {cooldown > 0 ? `Available again in ${cooldown} ${cooldown === 1 ? "second" : "seconds"}` : submitting && !changing ? "Sending…" : "Send the link again"}
            </Button>
            <div className="flex flex-wrap justify-center gap-4">
              <button type="button" className={linkButton} aria-expanded={changing} onClick={() => setChanging((value) => !value)}>Wrong address?<ArrowRight className="size-[13px] stroke-[2.4]" aria-hidden="true" /></button>
              <LogoutButton variant="link" className={linkButton} />
            </div>
          </div>
        </>
      )}
    </AuthCard>
  );
}

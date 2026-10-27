"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";

import { authControl, authLabel } from "@/components/app/auth-card";
import { FunnelHeading } from "@/components/app/funnel-frame";
import { Button } from "@/components/ui/button";
import Link from "next/link";

const linkButton = "inline-flex items-center gap-1.5 text-sm font-semibold leading-[1.43] tracking-[-0.01em] text-foreground hover:text-[var(--accent-ink)] disabled:opacity-50 [&_svg]:transition-transform hover:[&_svg]:translate-x-[3px]";

/** The account-created step has one way forward; email verification is the next step. */
export function AccountCreatedPanel() {
  return (
    <div>
      <FunnelHeading title="Your account is created">Next, confirm your email to continue setting up your workspace.</FunnelHeading>
      <Button asChild className="h-12 w-full">
        <Link href="/app/verify-email" replace>Continue</Link>
      </Button>
    </div>
  );
}

/** Allows Back from About you to revisit the completed email step without redirecting in a loop. */
export function EmailConfirmedPanel({ nextHref = "/app/onboarding/about-you" }: { nextHref?: string }) {
  return (
    <div>
      <FunnelHeading title="Email confirmed">Your address is verified. Continue when you’re ready to finish setting up your workspace.</FunnelHeading>
      <Button asChild className="h-12 w-full">
        <Link href={nextHref}>Continue</Link>
      </Button>
    </div>
  );
}

/**
 * Step 2 of 5: the only screen a pending account can reach. It watches for the verification to
 * land — the link can be opened on a phone — and moves on by itself, which is the promise the first
 * line of "What to expect" makes.
 */
export function VerifyEmailPanel({ ttlHours, noPayment = false }: { ttlHours: number; noPayment?: boolean }) {
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

  return (
    <div>
      <FunnelHeading title="Confirm your email">
        Open the link we sent. It works once, for {ttlHours} hours, and keeps anyone else from opening a workspace in your name.
        {noPayment ? " Nothing is charged." : " Nothing has been charged."}
      </FunnelHeading>
      {loading ? (
        <div className="flex h-28 items-center justify-center" role="status" aria-label="Loading your account"><LoaderCircle className="animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--surface-alt)] px-4 py-3.5">
            <span className="min-w-0 break-all text-base font-semibold tracking-[-0.02em] text-foreground">{email || "—"}</span>
            <span className={sentNow ? "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--success-surface)] px-2.5 py-[3px] text-xs font-semibold text-[var(--success-ink)]" : "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-card px-2.5 py-[3px] text-xs font-semibold text-[var(--body)]"}>
              <span className={sentNow ? "size-1.5 rounded-full bg-[var(--success)]" : "size-1.5 rounded-full bg-[var(--muted)]"} aria-hidden="true" />
              {sentNow ? "Sent just now" : "Sent at sign-up"}
            </span>
          </div>

          <div className="mt-4 flex flex-wrap gap-2.5">
            <Button asChild variant="outline" className="h-12 border-[var(--border-strong)] px-4">
              <a href="https://mail.google.com/mail/u/0/#search/from%3Ainsurvas" target="_blank" rel="noopener noreferrer">Open Gmail</a>
            </Button>
            <Button asChild variant="outline" className="h-12 border-[var(--border-strong)] px-4">
              <a href="https://outlook.office.com/mail/" target="_blank" rel="noopener noreferrer">Open Outlook</a>
            </Button>
          </div>

          <p className="mt-4 flex items-center gap-2.5 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]" role="status">
            <LoaderCircle className="size-4 shrink-0 animate-spin text-[var(--accent-ink)] motion-reduce:animate-none" aria-hidden="true" />
            Waiting for the link to be opened. This page moves on by itself, even if you open it on your phone.
          </p>

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
            <Button type="button" variant="outline" className="h-12 w-full border-[var(--border-strong)]" onClick={() => void send("resend")} disabled={submitting || cooldown > 0}>
              {cooldown > 0 ? `Send again in ${cooldown} ${cooldown === 1 ? "second" : "seconds"}` : submitting && !changing ? "Sending…" : "Send the link again"}
            </Button>
            <div className="flex flex-wrap justify-start gap-4">
              <button type="button" className={linkButton} aria-expanded={changing} onClick={() => setChanging((value) => !value)}>Wrong address?<ArrowRight className="size-[13px] stroke-[2.4]" aria-hidden="true" /></button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

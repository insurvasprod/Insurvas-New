"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, LoaderCircle, Mail, MailCheck } from "lucide-react";

import { authControl, authLabel } from "@/components/app/auth-card";
import { AuthAlert } from "@/components/portal/auth-controls";
import { FunnelHeading } from "@/components/app/funnel-frame";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const linkButton = "inline-flex items-center gap-1.5 text-sm font-semibold leading-[1.43] tracking-[-0.01em] text-[var(--accent-ink)] hover:text-foreground hover:underline disabled:opacity-50";

const INBOXES = [
  { label: "Open Gmail", href: "https://mail.google.com/mail/u/0/#search/from%3Ainsurvas" },
  { label: "Open Outlook", href: "https://outlook.office.com/mail/" },
] as const;

/**
 * Step 1 of 3 (the email check): the only screen a pending account can reach. It watches for the verification to
 * land — the link can be opened on a phone — and moves on by itself, which is the promise the first
 * line of "What to expect" makes.
 */
// `noPayment` is still passed by the page; this step no longer mentions charging, so it is unused.
export function VerifyEmailPanel({ ttlHours, back }: { ttlHours: number; noPayment?: boolean; back?: string }) {
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
        We sent a link to the address below. It works once, for {ttlHours} hours, and this page moves on by itself when you open it.
      </FunnelHeading>
      {loading ? (
        <div className="flex h-28 items-center justify-center" role="status" aria-label="Loading your account"><LoaderCircle className="animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {/* The address, where it was sent, and the one way to fix a typo, in one card (owner, 2026-10-28:
              the step had "no good structure"). */}
          <div className="flex items-center gap-3.5 rounded-lg border border-border bg-card px-4 py-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[var(--accent-ink)]" aria-hidden="true">
              <MailCheck className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block break-all text-base font-semibold tracking-[-0.02em] text-foreground">{email || "—"}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn("size-1.5 rounded-full", sentNow ? "bg-[var(--success)]" : "bg-[var(--muted)]")} aria-hidden="true" />
                {sentNow ? "Sent just now" : "Sent when you signed up"}
              </span>
            </span>
            <button type="button" className={cn(linkButton, "shrink-0")} aria-expanded={changing} onClick={() => setChanging((value) => !value)}>
              {changing ? "Cancel" : "Change"}
            </button>
          </div>

          {changing && (
            <form onSubmit={(event) => send("change_email", event)} className="mt-3 rounded-lg border border-border bg-card p-4">
              <label className="block">
                <span className={authLabel}>Correct email</span>
                <input type="email" required autoComplete="email" autoFocus className={authControl} value={newEmail} onChange={(event) => setNewEmail(event.target.value)} />
              </label>
              <Button type="submit" className="mt-3 h-11 w-full" disabled={submitting || cooldown > 0 || !newEmail.trim() || newEmail.trim() === email}>
                {submitting ? "Sending…" : "Update and send a new link"}
              </Button>
            </form>
          )}

          {/* The two inboxes most agents use, as two equal buttons in one row. */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            {INBOXES.map((inbox) => (
              <Button key={inbox.label} asChild variant="outline" className="h-11 justify-center gap-2 border-[var(--border-strong)]">
                <a href={inbox.href} target="_blank" rel="noopener noreferrer">
                  <Mail className="size-4" aria-hidden="true" />
                  {inbox.label}
                  <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden="true" />
                </a>
              </Button>
            ))}
          </div>

          <p className="sr-only" role="status">Waiting for the link to be opened.</p>
          {message && <AuthAlert tone="success" className="mt-4">{message}</AuthAlert>}
          {error && <AuthAlert className="mt-4">{error}</AuthAlert>}

          {/* Footer: Back on the left; sending again is a quiet text action, not a second big button. */}
          <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
            {back ? (
              <Button asChild variant="outline" className="h-11 border-[var(--border-strong)] px-5">
                <Link href={back}><ArrowLeft aria-hidden="true" />Back</Link>
              </Button>
            ) : <span />}
            <p className="m-0 text-sm text-muted-foreground">
              Didn&rsquo;t get it?{" "}
              <button type="button" className="font-semibold text-[var(--accent-ink)] hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline" onClick={() => void send("resend")} disabled={submitting || cooldown > 0}>
                {cooldown > 0 ? `Send again in ${cooldown}s` : submitting && !changing ? "Sending…" : "Send it again"}
              </button>
            </p>
          </div>
        </>
      )}
    </div>
  );
}

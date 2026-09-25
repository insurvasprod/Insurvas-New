"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

type Phase = "verifying" | "activating";

/**
 * How many times to ask, and how far apart. Whop usually records a payment within a couple of
 * seconds of sending the customer back; ten seconds of asking covers the slow case, and past that
 * the webhook finishes the job while the checkout page tells them so calmly.
 */
const ATTEMPTS = 5;
const GAP_MS = 2000;

function Step({ n, label, state }: { n: number; label: string; state: "done" | "current" | "next" }) {
  const circle =
    state === "done"
      ? "bg-[var(--success)] text-[var(--on-success)]"
      : state === "current"
        ? "bg-[var(--primary)] text-[var(--on-primary)]"
        : "bg-[var(--surface-alt)] text-muted-foreground";
  return (
    <span className="flex items-center gap-2.5">
      <span className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold ${circle}`} aria-hidden="true">
        {state === "done" ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        ) : (
          n
        )}
      </span>
      <span className={`text-sm font-semibold leading-normal tracking-[-0.02em] ${state === "next" ? "text-muted-foreground" : "text-foreground"}`}>
        {label}
        <span className="sr-only">{state === "done" ? ", complete" : state === "current" ? ", in progress" : ""}</span>
      </span>
    </span>
  );
}

function Track({ done }: { done: boolean }) {
  return <li className={`m-track mx-3 hidden h-0.5 flex-1 sm:block ${done ? "bg-[var(--success)]" : "bg-border"}`} aria-hidden="true" />;
}

/**
 * The live half of the return page: asks the server to confirm with the provider, advances the
 * steps as the answer comes in, and moves on — to the dashboard when confirmed, back to checkout
 * with a calm notice when it is not. The browser only ever learns the outcome.
 */
export function CheckoutReturnStatus() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("verifying");

  useEffect(() => {
    let cancelled = false;
    // Aborting, not just ignoring, so a discarded run (React's development double-mount, or leaving
    // the page) does not keep asking the provider on this customer's behalf.
    const controller = new AbortController();

    async function run() {
      for (let attempt = 1; attempt <= ATTEMPTS && !cancelled; attempt += 1) {
        try {
          const response = await fetch("/api/app/checkout/verify", { method: "POST", cache: "no-store", signal: controller.signal });
          const body = await response.json().catch(() => null);
          if (cancelled) return;
          if (response.ok && body?.status === "confirmed") {
            setPhase("activating");
            router.replace("/app/dashboard?welcome=1");
            return;
          }
          if (response.ok && body?.status === "done") {
            router.replace("/app/dashboard");
            return;
          }
          if (response.status === 401) {
            router.replace("/app/login");
            return;
          }
        } catch {
          // A dropped request is another "not yet"; the next attempt asks again.
        }
        if (attempt < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, GAP_MS));
      }
      if (!cancelled) router.replace("/app/checkout?pending=1");
    }

    void run();
    return () => { cancelled = true; controller.abort(); };
  }, [router]);

  return (
    <>
      <ol className="mt-7 flex flex-col gap-3 rounded-lg border border-border bg-card px-5 py-3.5 sm:flex-row sm:items-center sm:gap-0" aria-label="Payment confirmation progress">
        <li><Step n={1} label="Returned" state="done" /></li>
        <Track done />
        <li><Step n={2} label="Verifying" state={phase === "verifying" ? "current" : "done"} /></li>
        <Track done={phase === "activating"} />
        <li><Step n={3} label="Activate" state={phase === "activating" ? "current" : "next"} /></li>
      </ol>
      <p className="sr-only" role="status" aria-live="polite">
        {phase === "verifying" ? "Confirming your payment with the provider." : "Payment confirmed. Opening your workspace."}
      </p>

      <div className="mt-7 rounded-lg border border-border border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em]">
        <p className="font-semibold text-[var(--info-ink)]">Landing here proves nothing</p>
        <p className="mt-1.5 text-[var(--body)]">
          We ask the payment provider directly whether your payment went through, and the provider also tells us on its own.
          If you closed the payment page early, nothing was charged — you can pick up where you left off.
        </p>
      </div>

      <div className="mt-6 flex justify-center gap-3">
        <Button asChild variant="outline" className="h-11 border-[var(--border-strong)] px-4">
          <Link href="/app/checkout?pending=1">Return to checkout</Link>
        </Button>
      </div>
    </>
  );
}

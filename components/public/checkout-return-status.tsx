"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AFTER_PAYMENT } from "@/lib/signup/destination";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

type Phase = "verifying" | "activating";

/**
 * How many times to ask, and how far apart. Whop usually records a payment within a couple of
 * seconds of sending the customer back; ten seconds of asking covers the slow case, and past that
 * the webhook finishes the job while the checkout page tells them so calmly.
 */
const ATTEMPTS = 5;
const GAP_MS = 2000;

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
            // On to "About you", the last step; it forwards to the workspace when already filled
            // (manager review, 2026-10-28: payment before the business questions).
            router.replace(AFTER_PAYMENT);
            return;
          }
          if (response.ok && body?.status === "done") {
            router.replace(AFTER_PAYMENT);
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
      <div className="flex items-center gap-3 rounded-lg bg-[var(--surface-alt)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]" role="status" aria-live="polite">
        <LoaderCircle className="size-4 shrink-0 animate-spin text-[var(--accent-ink)] motion-reduce:animate-none" aria-hidden="true" />
        {phase === "verifying" ? "Checking with the payment provider…" : "Payment confirmed. Opening your workspace…"}
      </div>
      <p className="mt-4 text-sm leading-normal tracking-[-0.02em] text-muted-foreground">
        If you closed the payment page early, nothing was charged and you can pick up where you left off.
      </p>
      <div className="mt-6">
        <Button asChild variant="outline" className="h-11 border-[var(--border-strong)] px-4">
          <Link href="/app/checkout?pending=1">Return to checkout</Link>
        </Button>
      </div>
    </>
  );
}
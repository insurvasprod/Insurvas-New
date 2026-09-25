"use client";

import { useState } from "react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The part of checkout that acts: the coupon card, the button that leaves for the provider, and the
 * line saying the card never reaches us. The plan, dates and summary around it are the server's.
 */
export function CheckoutStart() {
  const [couponCode, setCouponCode] = useState("");
  const [valid, setValid] = useState<{ code: string; summary: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  async function applyCoupon() {
    if (!couponCode.trim()) return;
    setBusy(true);
    // A dropped connection must hand the form back, not leave every control disabled.
    const res = await fetch("/api/app/checkout/coupon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: couponCode.trim() }),
    }).catch(() => null);
    setBusy(false);
    if (!res) { notify.block("Could not reach Insurvas. Check your connection and try again."); return; }
    const body = await res.json().catch(() => null);

    if (!res.ok) {
      // Rejected BEFORE the hosted page opens, which is the acceptance criterion.
      setValid(null);
      notify.block(body?.error ?? "That code could not be applied");
      return;
    }

    // Not "will be applied": Whop's hosted checkout cannot be handed a promo code, so the buyer
    // types it themselves. Saying otherwise promised a discount we could not deliver.
    setValid({ code: body.code, summary: body.summary ?? null });
  }

  async function start() {
    setBusy(true);
    const res = await fetch("/api/app/checkout/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ couponCode: valid?.code ?? undefined }),
    }).catch(() => null);
    if (!res) { setBusy(false); notify.block("Could not reach Insurvas. Check your connection and try again."); return; }
    const body = await res.json().catch(() => null);

    if (!res.ok) {
      setBusy(false);
      notify.block(body?.error ?? "Could not open checkout");
      return;
    }

    // Leaves our site entirely. The card is entered on the provider's page and never reaches us.
    window.location.href = body.checkoutUrl;
  }

  return (
    <>
      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-foreground">
          <label htmlFor="coupon">Coupon</label>
        </h2>
        <div className="mt-3 flex gap-3">
          <Input
            id="coupon"
            value={couponCode}
            onChange={(e) => {
              setCouponCode(e.target.value.toUpperCase());
              setValid(null);
            }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void applyCoupon(); } }}
            autoComplete="off"
            className="h-11 flex-1 border-[var(--border-strong)] px-3 text-base tracking-[-0.02em]"
            disabled={busy}
          />
          <Button variant="outline" onClick={applyCoupon} disabled={busy || !couponCode.trim()} className="h-11 border-[var(--border-strong)] px-4">
            Apply
          </Button>
        </div>
        {valid && (
          /* The buyer has to type the code on the provider's page — a hosted checkout cannot be
             handed a promo code — so the note under the chip is the thing that gets them the
             discount they were promised. */
          <>
            <div className="mt-3">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--success-surface)] px-2.5 py-[3px] text-xs font-semibold leading-normal tracking-[-0.01em] text-[var(--success-ink)]">
                <span className="size-1.5 shrink-0 rounded-full bg-[var(--success)]" aria-hidden="true" />
                {valid.summary ? `Valid — ${valid.summary}` : `${valid.code} is valid`}
              </span>
            </div>
            <p className="mt-2.5 text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
              Enter it on the payment page to get your discount — it is not applied automatically.
            </p>
          </>
        )}
      </div>

      <Button onClick={start} disabled={busy} className="h-11 w-full px-4">
        Continue to secure checkout
      </Button>

      <p className="flex items-center justify-center gap-2 text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
        Card details are entered on the provider’s hosted page and never reach Insurvas.
      </p>
    </>
  );
}

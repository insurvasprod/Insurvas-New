"use client";

import { useState } from "react";
import { CreditCard, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CheckoutStart({ trialDays }: { trialDays: number }) {
  const [couponCode, setCouponCode] = useState("");
  const [couponOk, setCouponOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function applyCoupon() {
    if (!couponCode.trim()) return;
    setBusy(true);
    const res = await fetch("/api/app/checkout/coupon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: couponCode.trim() }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);

    if (!res.ok) {
      // Rejected BEFORE the hosted page opens, which is the acceptance criterion.
      setCouponOk(null);
      toast.error(body?.error ?? "That code could not be applied");
      return;
    }

    setCouponOk(body.code);
    toast.success(`${body.code} will be applied at checkout`);
  }

  async function start() {
    setBusy(true);
    const res = await fetch("/api/app/checkout/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ couponCode: couponOk ?? undefined }),
    });
    const body = await res.json().catch(() => null);

    if (!res.ok) {
      setBusy(false);
      toast.error(body?.error ?? "Could not open checkout");
      return;
    }

    // Leaves our site entirely. The card is entered on the provider's page and never reaches us.
    window.location.href = body.checkoutUrl;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="coupon">Have a code?</Label>
        <div className="flex gap-2">
          <Input
            id="coupon"
            value={couponCode}
            onChange={(e) => {
              setCouponCode(e.target.value);
              setCouponOk(null);
            }}
            placeholder="WELCOME50"
            className="font-mono uppercase"
            disabled={busy}
          />
          <Button variant="outline" onClick={applyCoupon} disabled={busy || !couponCode.trim()}>
            Apply
          </Button>
        </div>
        {couponOk && (
          <p className="text-xs text-[var(--color-success)]">{couponOk} will be applied at checkout.</p>
        )}
      </div>

      <Button size="lg" className="w-full" onClick={start} disabled={busy}>
        <CreditCard />
        Continue to secure checkout
      </Button>

      <p className="flex items-center justify-center gap-1.5 text-xs text-[var(--color-text-muted)]">
        <ShieldCheck className="size-3.5" />
        Your card is entered on our payment provider&apos;s page and never touches our servers. Free for{" "}
        {trialDays} days — cancel any time before then and you are not charged.
      </p>
    </div>
  );
}

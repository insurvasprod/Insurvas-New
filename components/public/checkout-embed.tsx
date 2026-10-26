"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { Checkout, CheckoutElement, WhopElements } from "@whop/elements-react";
import { loadWhop } from "@whop/elements";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Step 5 of 5, Payment (owner pick A, 2026-10-26): Whop's Checkout element embedded on our page
 * instead of a redirect to whop.com. It opens from the checkout configuration (`ch_…`) our server
 * creates — the plan, the trial and the tenant metadata the webhook reads all live there — so the
 * card still goes straight to Whop and never touches Insurvas.
 *
 * One state shared by the form on the left (the embed) and the receipt on the right (the coupon).
 */

type Coupon = { code: string; summary: string | null; fullComp: boolean };
type Phase = "starting" | "ready" | "failed" | "free" | "opening";

type PaymentState = {
  phase: Phase;
  configId: string | null;
  hostedUrl: string | null;
  coupon: Coupon | null;
  error: string | null;
  busy: boolean;
  applyCoupon: (code: string) => Promise<boolean>;
  removeCoupon: () => void;
  startFree: () => void;
  retry: () => void;
};

const PaymentContext = createContext<PaymentState | null>(null);
const usePayment = () => {
  const value = useContext(PaymentContext);
  if (!value) throw new Error("Payment parts must sit inside PaymentProvider");
  return value;
};

type Started = { checkoutUrl: string; configId: string | null };

async function postStart(couponCode?: string): Promise<{ ok: true; started: Started } | { ok: false; error: string }> {
  const response = await fetch("/api/app/checkout/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(couponCode ? { couponCode } : {}),
  }).catch(() => null);
  if (!response) return { ok: false, error: "Could not reach Insurvas. Check your connection and try again." };
  const body = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: body?.error ?? "Could not open the payment form." };
  return { ok: true, started: { checkoutUrl: body.checkoutUrl, configId: body.configId ?? null } };
}

export function PaymentProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [started, setStarted] = useState<Started | null>(null);
  const [coupon, setCoupon] = useState<Coupon | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = useCallback(async (couponCode?: string) => {
    setPhase("starting");
    setError(null);
    const result = await postStart(couponCode);
    if (!result.ok) { setError(result.error); setPhase("failed"); return; }
    // Nothing to pay (a free coupon was redeemed, or no-payment mode): the server has already started the plan.
    if (!result.started.configId) { window.location.href = result.started.checkoutUrl; return; }
    setStarted(result.started);
    setPhase("ready");
  }, []);

  // Opening the form IS starting checkout: the configuration is created (or the open one reused) on arrival.
  // Once per page: React runs effects twice in development, and two starts at once opened two sessions.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    void open();
  }, [open]);

  const value: PaymentState = {
    phase,
    configId: started?.configId ?? null,
    hostedUrl: started?.checkoutUrl ?? null,
    coupon,
    error,
    busy,
    applyCoupon: async (code) => {
      setBusy(true);
      setError(null);
      const response = await fetch("/api/app/checkout/coupon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      }).catch(() => null);
      setBusy(false);
      if (!response) { setError("Could not reach Insurvas. Check your connection and try again."); return false; }
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.error ?? "That code could not be applied."); return false; }
      const next = { code: body.code as string, summary: (body.summary ?? null) as string | null, fullComp: body.fullComp === true };
      setCoupon(next);
      if (next.fullComp) { setPhase("free"); return true; }
      // A fresh configuration carrying the coupon; the embed opens with the code already applied.
      await open(next.code);
      return true;
    },
    removeCoupon: () => { setCoupon(null); void open(); },
    startFree: () => {
      if (!coupon) return;
      setPhase("opening");
      setError(null);
      void postStart(coupon.code).then((result) => {
        if (!result.ok) { setError(result.error); setPhase("free"); return; }
        // A full page load, so the shell reads the finished sign-up rather than a cached route.
        window.location.assign(result.started.checkoutUrl);
      });
    },
    retry: () => void open(coupon?.fullComp ? undefined : coupon?.code),
  };

  return <PaymentContext.Provider value={value}>{children}</PaymentContext.Provider>;
}

/** The pay button in the brand green (--primary on --on-primary). The frame cannot read our CSS variables, so the values are spelled out. */
const PAY_BUTTON = { backgroundColor: "rgb(7, 214, 160)", color: "rgb(13, 64, 55)", borderRadius: "999px", fontWeight: "600" };

/**
 * The country (and state) drop-downs in Whop's address form are native selects. Their open list is
 * drawn by the browser from the select's own colours, so without these it opened white with Whop's
 * dark-mode grey text on it — unreadable (owner, 2026-10-26: "fix the dropdown").
 */
const addressSelect = (dark: boolean) => (dark
  ? { backgroundColor: "rgb(23, 23, 23)", color: "rgb(237, 237, 237)", colorScheme: "dark" }
  : { backgroundColor: "rgb(255, 255, 255)", color: "rgb(23, 23, 23)", colorScheme: "light" });

/** The app's resolved theme, read from the html class the ThemeProvider sets. */
function subscribeDark(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
const isDark = () => document.documentElement.classList.contains("dark");

/** The left side: Whop's embedded checkout, or the free-coupon face, or the retry line. */
export function PaymentEmbed({ email, environment }: { email: string; environment: "production" | "sandbox" }) {
  const router = useRouter();
  const payment = usePayment();
  const dark = useSyncExternalStore(subscribeDark, isDark, () => false);
  // One loader per page: loadWhop() injects Whop's hosted script.
  const [whop] = useState(() => (typeof window === "undefined" ? null : loadWhop()));
  const [loadFailed, setLoadFailed] = useState(false);

  // Whop accepts https return addresses, and http only on localhost. Elsewhere in development the
  // element rests on its own success face and onComplete moves the buyer on instead.
  const [returnUrl] = useState(() => {
    if (typeof window === "undefined") return undefined;
    const { protocol, hostname, origin } = window.location;
    return protocol === "https:" || hostname === "localhost" ? `${origin}/app/checkout/return` : undefined;
  });

  if (payment.phase === "free" || payment.phase === "opening") {
    return (
      <div className="rounded-xl border border-[color-mix(in_srgb,var(--primary)_35%,transparent)] bg-[var(--primary-soft)] p-5">
        <h2 className="text-lg font-semibold tracking-[-0.015em] text-foreground">No card needed</h2>
        <p className="mt-1 text-sm leading-normal text-[var(--body)]">Your coupon covers the plan forever, so there is nothing to pay and no card form. Your workspace opens as soon as you start.</p>
        {payment.error && <p role="alert" className="mt-3 rounded-lg border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] p-3 text-sm text-[var(--error-ink)]">{payment.error}</p>}
        <Button className="mt-4 h-12 w-full" disabled={payment.phase === "opening"} onClick={payment.startFree}>
          {payment.phase === "opening" && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {payment.phase === "opening" ? "Opening your workspace…" : "Start using Insurvas"}
        </Button>
      </div>
    );
  }

  if (payment.phase === "failed" || loadFailed) {
    return (
      <div role="alert" className="rounded-xl border border-border bg-card p-5 text-sm leading-normal">
        <p className="font-semibold text-foreground">The payment form did not open</p>
        <p className="mt-1 text-[var(--body)]">{payment.error ?? "The secure payment form could not be loaded."}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" className="border-[var(--border-strong)]" onClick={() => { setLoadFailed(false); payment.retry(); }}>Try again</Button>
          {/* The hosted page as it worked before the embed: the same configuration, on whop.com. */}
          {payment.hostedUrl && <Button asChild variant="ghost"><a href={payment.hostedUrl}>Use the secure payment page instead</a></Button>}
        </div>
      </div>
    );
  }

  if (payment.phase === "starting" || !payment.configId || !whop) {
    return (
      <div role="status" className="flex min-h-[420px] items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Opening the secure payment form
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card p-1">
      <WhopElements
        elements={whop}
        environment={environment}
        onLoadError={() => setLoadFailed(true)}
        appearance={{
          theme: { appearance: dark ? "dark" : "light", accentColor: "jade", grayColor: "sage" },
          // The plan, price and coupon are on the receipt beside it; the form keeps only what it collects.
          classes: { "whop-CheckoutDetails": { display: "none" }, "whop-CheckoutDetailsToggle": { display: "none" }, "whop-CheckoutPayButton": PAY_BUTTON, "whop-AddressFieldSelect": addressSelect(dark) },
        }}
      >
        <Checkout
          // A new configuration (a coupon applied) is a new purchase: remount rather than update.
          key={`${payment.configId}:${payment.coupon?.code ?? ""}`}
          checkoutConfiguration={payment.configId}
          promoCode={payment.coupon && !payment.coupon.fullComp ? payment.coupon.code : undefined}
          returnUrl={returnUrl}
          // Not proof of payment: the return page asks Whop, and the webhook is the second path.
          onComplete={() => { if (!returnUrl) router.push("/app/checkout/return"); }}
        >
          <CheckoutElement buyerEmail={email} />
        </Checkout>
      </WhopElements>
    </div>
  );
}

/** The coupon box on the receipt. Applying it reopens the form with the code already applied. */
export function PaymentCoupon({ dark = false }: { dark?: boolean }) {
  const payment = usePayment();
  const [code, setCode] = useState("");
  const label = cn("text-xs font-semibold uppercase tracking-[0.08em]", dark ? "text-[var(--nav-muted)]" : "text-muted-foreground");

  if (payment.coupon) {
    return (
      <div>
        <p className={label}>Coupon</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--success-surface)] px-2.5 py-[3px] text-xs font-semibold text-[var(--success-ink)]">
            <span className="size-1.5 rounded-full bg-[var(--success)]" aria-hidden="true" />
            {payment.coupon.code} · {payment.coupon.summary ?? "valid"}
          </span>
          <button type="button" className={cn("text-xs font-semibold hover:underline", dark ? "text-[var(--nav-ink)]" : "text-[var(--accent-ink)]")} onClick={payment.removeCoupon}>Remove</button>
        </div>
        <p className={cn("mt-2 text-xs leading-normal", dark ? "text-[var(--nav-muted)]" : "text-muted-foreground")}>
          {payment.coupon.fullComp ? "The card form goes away: the plan will never be charged." : "Applied to the payment form, so the price there matches."}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); if (code.trim()) void payment.applyCoupon(code.trim()).then((ok) => { if (ok) setCode(""); }); }}>
      <label htmlFor="coupon" className={label}>Coupon</label>
      <div className="mt-2 flex gap-2">
        <Input
          id="coupon"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          autoComplete="off"
          placeholder="Enter code"
          disabled={payment.busy}
          className={cn("h-9 flex-1 px-3 tracking-[0.04em]", dark && "border-[var(--nav-line)] bg-black/25 text-[var(--on-dark)] placeholder:text-[var(--nav-muted)]")}
        />
        <Button type="submit" variant="outline" disabled={payment.busy || !code.trim()} className={cn("h-9 px-4", dark ? "border-[var(--nav-line)] bg-transparent text-[var(--on-dark)] hover:bg-white/10" : "border-[var(--border-strong)]")}>
          {payment.busy ? "Checking…" : "Apply"}
        </Button>
      </div>
      {payment.error && payment.phase !== "failed" && <p role="alert" className={cn("mt-2 text-xs", dark ? "text-[var(--on-dark)]" : "text-[var(--error-ink)]")}>{payment.error}</p>}
    </form>
  );
}

/** "$0.00" while a trial runs, or what the free coupon leaves: the line that changes with the coupon. */
export function usePaymentCoupon() {
  return usePayment().coupon;
}

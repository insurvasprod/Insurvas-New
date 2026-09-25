"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";

type State =
  | { status: "checking" }
  | { status: "valid"; newEmail: string; currentEmail: string | null }
  | { status: "invalid" }
  | { status: "done"; newEmail: string };

/** Email changes are started by Insurvas staff, so "your administrator" is support. */
const SUPPORT = "mailto:support@insurvas.com?subject=Email%20change%20I%20did%20not%20request";

function Card({ title, lede, children }: { title: string; lede: ReactNode; children?: ReactNode }) {
  return (
    <div className="m-in rounded-lg border border-border bg-card p-6 sm:p-10">
      <h1 className="mt-2 text-center text-[32px] font-semibold leading-[1.13] tracking-[-0.025em] text-foreground">{title}</h1>
      <p className="mt-2.5 text-center text-base leading-normal tracking-[-0.02em] text-muted-foreground">{lede}</p>
      {children}
    </div>
  );
}

function Chip({ tone, children }: { tone: "good" | "action"; children: ReactNode }) {
  const style =
    tone === "good"
      ? { chip: "bg-[var(--success-surface)] text-[var(--success-ink)]", dot: "bg-[var(--success)]" }
      : { chip: "bg-[var(--soft-orange-surface)] text-[var(--accent-ink)]", dot: "bg-[var(--primary)]" };
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold leading-normal tracking-[-0.01em] ${style.chip}`}>
      <span className={`size-1.5 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
      {children}
    </span>
  );
}

function AddressRow({ label, email, chip, highlight }: { label: string; email: string; chip: ReactNode; highlight?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 px-4 py-3.5 ${highlight ? "border-t border-border bg-[var(--soft-orange-surface)]" : "bg-card"}`}>
      <span className="min-w-0">
        <span className="block text-xs leading-normal tracking-[-0.01em] text-muted-foreground">{label}</span>
        <span className="mt-0.5 block break-all text-base font-semibold leading-normal tracking-[-0.02em] text-foreground">{email}</span>
      </span>
      {chip}
    </div>
  );
}

/**
 * Confirming an email change. Opening the link changes nothing — link previewers and mail scanners
 * open links too — so the change happens only when the person presses the button.
 */
export function ConfirmEmailPanel() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  // A missing token is knowable at first render, so it's the initial state rather than
  // something an effect corrects afterwards.
  const [state, setState] = useState<State>(token ? { status: "checking" } : { status: "invalid" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    fetch(`/api/app/auth/confirm-email?token=${encodeURIComponent(token)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        setState(
          body?.valid
            ? { status: "valid", newEmail: body.newEmail, currentEmail: body.currentEmail ?? null }
            : { status: "invalid" },
        );
      })
      .catch(() => !cancelled && setState({ status: "invalid" }));

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function confirm() {
    setError(null);
    setLoading(true);

    const res = await fetch("/api/app/auth/confirm-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = await res.json().catch(() => null);
    setLoading(false);

    if (!res.ok) {
      setError(body?.error ?? "Something went wrong");
      return;
    }

    setState({ status: "done", newEmail: body.email });
    setTimeout(() => router.push("/app/login"), 2000);
  }

  if (state.status === "checking") {
    return (
      <Card title="Confirm your new address" lede="Checking your link…" />
    );
  }

  if (state.status === "invalid") {
    return (
      <Card
        title="This link no longer works"
        lede="It has expired or was already used. Your email address is unchanged."
      >
        <p className="mt-6 text-center text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
          Still need the change? <a href={SUPPORT} className="font-semibold text-foreground underline underline-offset-2">Contact your administrator</a> for a new link.
        </p>
      </Card>
    );
  }

  if (state.status === "done") {
    return (
      <Card title="Email updated" lede={<>Sign in with <span className="font-semibold text-foreground">{state.newEmail}</span> from now on. Taking you to sign in…</>}>
        <div className="mt-7 overflow-hidden rounded-md border border-border">
          <AddressRow label="Your address" email={state.newEmail} chip={<Chip tone="good">Active</Chip>} />
        </div>
      </Card>
    );
  }

  return (
    <Card title="Confirm your new address" lede="Your current address keeps working until you confirm. Nothing changes by opening this page.">
      <div className="mt-7 overflow-hidden rounded-md border border-border">
        {state.currentEmail && (
          <AddressRow label="Current" email={state.currentEmail} chip={<Chip tone="good">Still active</Chip>} />
        )}
        <AddressRow label="New" email={state.newEmail} highlight={Boolean(state.currentEmail)} chip={<Chip tone="action">Awaiting confirmation</Chip>} />
      </div>

      {error && (
        <div role="alert" className="mt-5 rounded-lg border border-[color-mix(in_srgb,var(--error)_24%,transparent)] bg-[var(--error-surface)] px-4 py-3 text-sm text-[var(--error-ink)]">
          {error}
        </div>
      )}

      <Button onClick={confirm} disabled={loading} className="mt-6 h-11 w-full px-4">
        {loading ? "Confirming…" : "Confirm email address"}
      </Button>

      <p className="mt-4 text-center text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
        This link is single-use. Didn’t request the change? <a href={SUPPORT} className="font-semibold text-foreground underline underline-offset-2">Contact your administrator</a>.
      </p>

      <div className="mt-5 rounded-lg border border-border border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em]">
        <p className="font-semibold text-[var(--info-ink)]">Nothing is confirmed by loading this page</p>
        <p className="mt-1.5 text-[var(--body)]">
          Only the button above changes your address, so a link preview or an email security scanner opening this page cannot change it for you.
        </p>
      </div>
    </Card>
  );
}

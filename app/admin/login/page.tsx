"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Step = "credentials" | "totp";

// Local overrides of the shared controls to the board's sizes (p-adm-login). components/ui/* is
// shared by every plane, so the board's 44px field and 48px button live here, not there.
const FIELD_LABEL = "block text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--body)]";
const FIELD_INPUT =
  "h-11 rounded-md border-[var(--border-strong)] bg-card px-3 text-base tracking-[-0.02em] text-foreground shadow-none md:text-base " +
  // The step-two field is disabled until step one passes; the board draws it as an ordinary field.
  "disabled:opacity-100";
const STEP_BUTTON =
  "h-12 w-full rounded-md border border-transparent " +
  // The board's inactive button: a grey plate with muted text, not the accent faded out.
  "disabled:border-[var(--border)] disabled:bg-[var(--surface-alt)] disabled:text-muted-foreground disabled:opacity-100";

// Each line is a statement about what the code does, checked against it:
//   audit      lib/audit/log.ts writes ip + user agent on every admin write; audit_log is append-only
//              (20260912193000). Reads are not audited, hence "change", not "action".
//   same answer app/api/admin/auth/login returns one 401 body for an unknown address, a wrong
//              password, an inactive account or a non-staff role, with a dummy hash to level timing.
//              Passing it does reveal the password was right (it is what opens step two), so the
//              line does not claim a failure hides "which factor".
//   maintenance proxy.ts lets /admin/login through; no admin auth route reads maintenance status.
//   12 hours   lib/adminAuth/session.ts: 12h token expiry; the cookie ends with the browser.
const SIGN_IN_FACTS = [
  "Every change you make from here is written to the append-only audit log, with your IP.",
  "A wrong address, a wrong password and a disabled account all get the same answer.",
  "This door stays open during maintenance — staff need in while customers are out.",
  "Sessions last 12 hours.",
];

export default function AdminLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  const onTotp = step === "totp";

  // Step two is a second card; move the keyboard there when it opens.
  useEffect(() => {
    if (onTotp) codeRef.current?.focus();
  }, [onTotp]);

  async function handleCredentials(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/admin/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    setLoading(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Something went wrong");
      return;
    }

    const body = await res.json().catch(() => null);
    if (body?.requires2fa) {
      setStep("totp");
      return;
    }

    router.push("/admin");
    router.refresh();
  }

  async function handleTotp(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/admin/auth/verify-2fa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    setLoading(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Something went wrong");
      return;
    }

    router.push("/admin");
    router.refresh();
  }

  // The authenticator entry is labelled "Insurvas Admin" + the account's email (lib/adminAuth/totp.ts).
  // Shown only once the credentials step has passed, so it never echoes an address nobody confirmed.
  const accountEmail = onTotp ? email.trim().toLowerCase() : "";

  return (
    <div className="m-stagger flex min-h-screen w-full min-w-0 flex-col bg-[var(--canvas)]">
      {/* ── The staff header. Outside the admin shell, so drawn here to the board. ───────────── */}
      <header className="flex flex-wrap items-center justify-between gap-3 bg-[var(--nav-bg)] px-4 py-3.5 sm:px-12">
        <span className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="inline-flex size-[26px] items-center justify-center rounded-md border-[1.5px] border-[var(--nav-muted)] text-xs font-semibold tracking-[-0.01em] text-[var(--nav-ink)]"
          >
            I
          </span>
          <span className="text-sm font-semibold uppercase leading-[1.43] tracking-[0.04em] text-[var(--nav-ink)]">
            Insurvas · Super Admin
          </span>
        </span>
        <span className="text-xs leading-normal tracking-[-0.01em] text-[var(--nav-muted)]">
          Staff only. Customers sign in at{" "}
          <Link href="/app/login" className="font-semibold text-[var(--nav-ink)]">
            app.insurvas.com
          </Link>
          .
        </span>
      </header>

      <main className="flex flex-1 items-center justify-center p-6 sm:p-12">
        <div className="flex w-full min-w-0 flex-col items-start gap-8 lg:w-auto lg:flex-row">
          {/* ── Step one ─────────────────────────────────────────────────────────────────── */}
          <div className="w-full min-w-0 lg:w-[400px]">
            <h1 className="text-[32px] font-semibold leading-[1.13] tracking-[-0.025em] text-foreground">
              Platform administration
            </h1>
            <p className="mb-6 mt-2.5 text-sm leading-normal tracking-[-0.02em] text-muted-foreground">
              Two steps, two requests. This screen is deliberately plain: a screenshot of it must never be mistaken for
              the customer product.
            </p>

            <section aria-labelledby="step-credentials" className="rounded-lg border border-border bg-card p-7">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className={`inline-flex size-[22px] items-center justify-center rounded-full text-xs font-semibold ${
                    onTotp
                      ? "bg-[var(--surface-alt)] text-muted-foreground"
                      : "bg-[var(--primary)] text-[var(--on-primary)]"
                  }`}
                >
                  1
                </span>
                <h2
                  id="step-credentials"
                  className={`text-lg font-semibold leading-[1.28] tracking-[-0.015em] ${
                    onTotp ? "text-muted-foreground" : "text-foreground"
                  }`}
                >
                  Credentials
                </h2>
              </div>

              <form className="mt-5 flex flex-col gap-4" onSubmit={handleCredentials}>
                <div className="space-y-1.5">
                  <Label htmlFor="email" className={FIELD_LABEL}>
                    Staff email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={FIELD_INPUT}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password" className={FIELD_LABEL}>
                    Password
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={FIELD_INPUT}
                  />
                </div>
                {!onTotp && error && (
                  <p role="alert" className="text-sm text-[var(--error-ink)]">
                    {error}
                  </p>
                )}
                <Button type="submit" className={STEP_BUTTON} disabled={loading}>
                  {loading ? "Checking…" : "Continue"}
                </Button>
              </form>
            </section>

            <p className="mt-4 text-sm text-muted-foreground">
              Tenant or agent?{" "}
              <Link className="font-semibold text-[var(--accent-ink)]" href="/app/login">
                Sign in to the Insurvas app
              </Link>
            </p>
          </div>

          {/* ── Step two. A second request, drawn as a second card rather than a field that
                appears in the first one. ─────────────────────────────────────────────────── */}
          <div className="w-full min-w-0 lg:w-[400px]">
            <section aria-labelledby="step-second-factor" className="rounded-lg border border-border bg-card p-7">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className={`inline-flex size-[22px] items-center justify-center rounded-full text-xs font-semibold ${
                    onTotp
                      ? "bg-[var(--primary)] text-[var(--on-primary)]"
                      : "bg-[var(--surface-alt)] text-muted-foreground"
                  }`}
                >
                  2
                </span>
                <h2
                  id="step-second-factor"
                  className={`text-lg font-semibold leading-[1.28] tracking-[-0.015em] ${
                    onTotp ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  Second factor
                </h2>
              </div>

              {/* The board says the code "goes to" the email. It does not: it is a TOTP code from an
                  authenticator app (lib/adminAuth/totp.ts), and nothing is ever emailed. */}
              <p className="mt-3.5 text-sm leading-normal tracking-[-0.02em] text-muted-foreground">
                A separate request, not a field revealed on the same form. The code comes from your authenticator app
                {accountEmail ? (
                  <>
                    , under <strong className="font-semibold text-foreground">Insurvas Admin</strong> for{" "}
                    <strong className="font-semibold text-foreground">{accountEmail}</strong>.
                  </>
                ) : (
                  "."
                )}
              </p>

              <form className="mt-4 flex flex-col gap-4" onSubmit={handleTotp}>
                <div className="space-y-1.5">
                  <Label htmlFor="code" className={FIELD_LABEL}>
                    Six-digit code
                  </Label>
                  <Input
                    ref={codeRef}
                    id="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    disabled={!onTotp}
                    aria-describedby="code-hint"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    className={FIELD_INPUT}
                  />
                  <p id="code-hint" className="text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
                    Numeric keypad, one-time-code autofill.
                  </p>
                </div>
                {onTotp && error && (
                  <p role="alert" className="text-sm text-[var(--error-ink)]">
                    {error}
                  </p>
                )}
                <Button
                  type="submit"
                  className={STEP_BUTTON}
                  disabled={!onTotp || loading || code.length !== 6}
                  aria-describedby={onTotp ? undefined : "step-two-locked"}
                >
                  {loading ? "Verifying…" : "Verify and enter"}
                </Button>
                {!onTotp && (
                  <span id="step-two-locked" className="sr-only">
                    Available once your email and password are accepted.
                  </span>
                )}
              </form>
            </section>
          </div>

          {/* ── What signing in commits you to ────────────────────────────────────────────── */}
          <div className="w-full min-w-0 lg:w-[340px]">
            <section aria-labelledby="sign-in-facts" className="rounded-lg border border-border bg-card p-6">
              <h2
                id="sign-in-facts"
                className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground"
              >
                What happens when you sign in
              </h2>
              <ul className="mt-3.5">
                {SIGN_IN_FACTS.map((line) => (
                  <li key={line} className="flex gap-2.5 py-[7px]">
                    <Lock
                      className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                      strokeWidth={2.2}
                      aria-hidden="true"
                    />
                    <span className="text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">{line}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

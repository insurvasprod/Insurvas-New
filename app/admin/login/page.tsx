"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

type Step = "credentials" | "totp";

export default function AdminLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-[var(--soft-orange-surface)] text-[var(--accent-ink)]">
            <ShieldCheck className="size-5" />
          </div>
          {/*
            A real <h1>, not CardTitle — which renders a <div>. This is the entry point to the whole
            control plane and it was the one admin screen with no heading element at all, so a
            screen-reader user landed on a page that announced no title. Every other admin screen
            gets its <h1> from AdminPageHeader. No stylesheet rule targets card-title here; the
            `[data-slot="card-title"]` selectors in globals.css are all scoped to `.portal-*`.
          */}
          <h1 className="text-xl leading-none font-semibold">Insurvas Super Admin</h1>
          <CardDescription>
            {step === "credentials"
              ? "Sign in to the platform admin panel. You will be asked for your authenticator code next."
              : "Enter your 6-digit authenticator code"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "credentials" ? (
            <form className="space-y-4" onSubmit={handleCredentials}>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Checking…" : "Continue"}
              </Button>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={handleTotp}>
              <div className="space-y-1.5">
                <Label htmlFor="code">Authenticator code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
                {loading ? "Verifying…" : "Verify & sign in"}
              </Button>
            </form>
          )}
          {step === "credentials" && (
            <p className="mt-4 text-center text-sm text-muted-foreground">
              Tenant or agent?{" "}
              <Link className="font-medium text-[var(--color-blue)] underline-offset-4 hover:underline" href="/app/login">
                Sign in to the Insurvas app
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, CircleCheck, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type TokenState = { status: "checking" } | { status: "valid"; email: string; name: string } | { status: "invalid" };

export function SetPasswordForm({
  endpoint = "/api/app/auth/set-password",
  loginPath = "/app/login",
}: { endpoint?: string; loginPath?: string } = {}) {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

  // A missing token is knowable at first render, so it's the initial state rather than
  // something an effect corrects afterwards.
  const [tokenState, setTokenState] = useState<TokenState>(
    token ? { status: "checking" } : { status: "invalid" },
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // Check the link up front so an expired invite says so before anyone types a password.
  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    fetch(`${endpoint}?token=${encodeURIComponent(token)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        setTokenState(body?.valid ? { status: "valid", email: body.email, name: body.name } : { status: "invalid" });
      })
      .catch(() => !cancelled && setTokenState({ status: "invalid" }));

    return () => {
      cancelled = true;
    };
  }, [endpoint, token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    setLoading(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Something went wrong");
      return;
    }

    setDone(true);
    setTimeout(() => router.push(loginPath), 1800);
  }

  if (tokenState.status === "checking") {
    return (
      <Card className="w-full max-w-sm">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">Checking your link…</CardContent>
      </Card>
    );
  }

  if (tokenState.status === "invalid") {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-[var(--color-danger)]/10 text-[var(--color-danger)]">
            <TriangleAlert className="size-5" />
          </div>
          <CardTitle className="text-xl">Link no longer valid</CardTitle>
          <CardDescription>
            This invitation has expired or has already been used. Ask your administrator to send a new one.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (done) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-[var(--color-success)]/10 text-[var(--color-success)]">
            <CircleCheck className="size-5" />
          </div>
          <CardTitle className="text-xl">Password set</CardTitle>
          <CardDescription>Taking you to sign in…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="items-center text-center">
        <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-[var(--color-blue-faint)] text-[var(--color-blue)]">
          <KeyRound className="size-5" />
        </div>
        <CardTitle className="text-xl">Set your password</CardTitle>
        <CardDescription>
          Welcome, {tokenState.name} — choose a password for {tokenState.email}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">At least 12 characters.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirm password</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Saving…" : "Set password & continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

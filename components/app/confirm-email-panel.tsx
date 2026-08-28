"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AtSign, CircleCheck, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type State =
  | { status: "checking" }
  | { status: "valid"; newEmail: string }
  | { status: "invalid" }
  | { status: "done"; newEmail: string };

export function ConfirmEmailPanel() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<State>({ status: "checking" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setState({ status: "invalid" });
      return;
    }

    let cancelled = false;
    fetch(`/api/app/auth/confirm-email?token=${encodeURIComponent(token)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        setState(body?.valid ? { status: "valid", newEmail: body.newEmail } : { status: "invalid" });
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
      <Card className="w-full max-w-sm">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">Checking your link…</CardContent>
      </Card>
    );
  }

  if (state.status === "invalid") {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-[var(--color-danger)]/10 text-[var(--color-danger)]">
            <TriangleAlert className="size-5" />
          </div>
          <CardTitle className="text-xl">Link no longer valid</CardTitle>
          <CardDescription>
            This confirmation has expired or was already used. Your email address is unchanged — ask your
            administrator to try again.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (state.status === "done") {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-[var(--color-success)]/10 text-[var(--color-success)]">
            <CircleCheck className="size-5" />
          </div>
          <CardTitle className="text-xl">Email updated</CardTitle>
          <CardDescription>Sign in with {state.newEmail} from now on.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="items-center text-center">
        <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-[var(--color-blue-faint)] text-[var(--color-blue)]">
          <AtSign className="size-5" />
        </div>
        <CardTitle className="text-xl">Confirm your new email</CardTitle>
        <CardDescription>
          Confirm that <span className="font-medium text-foreground">{state.newEmail}</span> is your address. Until
          you do, your existing email keeps working.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
        <Button className="w-full" onClick={confirm} disabled={loading}>
          {loading ? "Confirming…" : "Confirm email address"}
        </Button>
      </CardContent>
    </Card>
  );
}

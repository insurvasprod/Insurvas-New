"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const validEmail = (value: string) => /^\S+@\S+\.\S+$/.test(value.trim());

export function PartnerLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldError(null);
    if (!email.trim()) { setFieldError("Enter your email address"); return; }
    if (!validEmail(email)) { setFieldError("Enter a valid email address"); return; }
    if (!password) { setFieldError("Enter your password"); return; }
    setLoading(true);
    const response = await fetch("/api/partner/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const body = await response.json().catch(() => null);
    setLoading(false);
    if (!response.ok) { setError(body?.error ?? "Something went wrong"); return; }
    router.push(body?.redirectTo ?? "/partner");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-page-bg)] p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-[var(--color-blue-faint)] text-[var(--color-blue)]"><Building2 className="size-5" /></div>
          <CardTitle className="text-xl">Partner portal</CardTitle>
          <CardDescription>Sign in to manage your lead partnership</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-1.5"><Label htmlFor="partner-email">Email</Label><Input id="partner-email" type="text" inputMode="email" autoComplete="username" aria-required="true" aria-invalid={Boolean(fieldError && !validEmail(email))} value={email} onChange={(event) => { setEmail(event.target.value); setFieldError(null); }} />{fieldError && !validEmail(email) && <p className="text-sm text-[var(--color-danger)]">{fieldError}</p>}</div>
            <div className="space-y-1.5"><Label htmlFor="partner-password">Password</Label><Input id="partner-password" type="password" autoComplete="current-password" aria-required="true" aria-invalid={Boolean(fieldError && validEmail(email) && !password)} value={password} onChange={(event) => { setPassword(event.target.value); setFieldError(null); }} />{fieldError && validEmail(email) && !password && <p className="text-sm text-[var(--color-danger)]">{fieldError}</p>}</div>
            {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

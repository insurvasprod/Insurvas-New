"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, MailCheck, Pencil, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function VerifyEmailPanel() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [changing, setChanging] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/app/onboarding/status", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "Could not load your account");
        if (body.userStatus !== "pending_verification") {
          router.replace(body.destination ?? "/app");
          return;
        }
        setEmail(body.email);
        setNewEmail(body.email);
      })
      .catch((reason) => setError(reason?.message ?? "Could not load your account"))
      .finally(() => setLoading(false));
  }, [router]);

  async function send(action: "resend" | "change_email", event?: FormEvent) {
    event?.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    const response = await fetch("/api/app/onboarding/verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "resend" ? { action } : { action, email: newEmail }),
    });
    const body = await response.json().catch(() => null);
    setSubmitting(false);
    if (!response.ok) {
      setError(body?.error ?? "Could not send verification email");
      return;
    }
    setEmail(body.email);
    setNewEmail(body.email);
    setChanging(false);
    setMessage(`Verification email sent to ${body.email}`);
  }

  return (
    <Card className="mx-auto max-w-xl bg-white shadow-[0_18px_50px_rgba(0,64,127,0.12)]">
      <CardHeader className="items-center text-center">
        <span className="mb-2 flex size-14 items-center justify-center rounded-2xl bg-[var(--brand-50)] text-[var(--brand-600)]">
          <MailCheck className="size-7" />
        </span>
        <CardTitle className="text-2xl font-extrabold">Check your email</CardTitle>
        <p className="max-w-md text-sm leading-6 text-[var(--color-text-muted)]">
          We sent a verification link valid for 24 hours. Until you verify, this is the only part of the product available.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex h-28 items-center justify-center"><LoaderCircle className="animate-spin" /></div>
        ) : (
          <>
            <div className="rounded-xl border bg-[var(--color-row-bg)] p-4 text-center">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Sent to</p>
              <p className="mt-1 break-all font-extrabold">{email}</p>
            </div>

            {changing ? (
              <form onSubmit={(event) => send("change_email", event)} className="space-y-3 rounded-xl border p-4">
                <div className="space-y-1.5">
                  <Label htmlFor="newEmail">Correct work email</Label>
                  <Input id="newEmail" type="email" required value={newEmail} onChange={(event) => setNewEmail(event.target.value)} />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={submitting}>{submitting ? <LoaderCircle className="animate-spin" /> : <Send />}Update and send</Button>
                  <Button type="button" variant="outline" onClick={() => setChanging(false)}>Cancel</Button>
                </div>
              </form>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Button variant="outline" onClick={() => send("resend")} disabled={submitting}>
                  {submitting ? <LoaderCircle className="animate-spin" /> : <Send />} Resend email
                </Button>
                <Button variant="ghost" onClick={() => setChanging(true)} disabled={submitting}>
                  <Pencil /> Wrong address?
                </Button>
              </div>
            )}

            {message && <p role="status" className="text-center text-sm font-semibold text-[var(--color-success)]">{message}</p>}
            {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-[var(--color-danger)]">{error}</p>}
            <p className="text-center text-xs text-[var(--color-text-muted)]">The message may take a minute. Check spam or promotions before resending.</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

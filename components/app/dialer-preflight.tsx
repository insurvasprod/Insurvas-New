"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DialerPreflight() {
  const [phone, setPhone] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [result, setResult] = useState<{ tone: "success" | "blocked"; message: string } | null>(null);
  const [checking, setChecking] = useState(false);

  async function checkBeforeDialing() {
    setFieldError("");
    setResult(null);
    setChecking(true);
    const response = await fetch("/api/app/dial/preflight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    const body = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    setChecking(false);
    if (!response.ok) {
      if (body?.error && response.status === 400) setFieldError(body.error);
      else setResult({ tone: "blocked", message: body?.error ?? "The number could not be cleared. Dialing remains blocked." });
      toast.error(body?.error ?? "DNC check failed");
      return;
    }
    setResult({ tone: "success", message: body?.message ?? "DNC check passed. The number is ready for your connected dialer." });
    toast.success("DNC check passed");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Dialer</h1>
        <p className="mt-1 text-sm text-muted-foreground">Check every number immediately before calling.</p>
      </div>

      <Card className="border-amber-300 bg-amber-50/70">
        <CardContent className="flex flex-wrap items-start justify-between gap-3 p-6 text-sm text-amber-950">
          <div><p className="font-semibold">DNC compliance is mandatory</p><p className="mt-1 max-w-xl">If no enabled DNC scrub vendor can respond, dialing is blocked platform-wide. Calling without a check can expose the platform to $500-$1,500 penalties per call.</p></div>
          <Badge variant="outline" className="border-amber-400 bg-white/60 text-amber-900">Fail closed</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Check a number before dialing</CardTitle><p className="text-sm text-muted-foreground">Your number is sent to the configured DNC vendor over HTTPS. Only a masked number is retained in provider logs.</p></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2"><Label htmlFor="dial-phone">Phone number</Label><Input id="dial-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(555) 123-4567" value={phone} onChange={(event) => { setPhone(event.target.value); setFieldError(""); setResult(null); }} aria-invalid={Boolean(fieldError)} />{fieldError && <p className="text-sm text-destructive" role="alert">{fieldError}</p>}</div>
          <Button type="button" onClick={() => void checkBeforeDialing()} disabled={checking || !phone.trim()}>{checking ? "Checking…" : "Check before dialing"}</Button>
          {result && <div role="status" className={`rounded-md border p-4 text-sm ${result.tone === "success" ? "border-green-300 bg-green-50 text-green-900" : "border-red-300 bg-red-50 text-red-900"}`}><p className="font-semibold">{result.tone === "success" ? "Number cleared" : "Dialing blocked"}</p><p className="mt-1">{result.message}</p></div>}
        </CardContent>
      </Card>
    </div>
  );
}

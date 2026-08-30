"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, Plug } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MODE_COPY, type ProviderMode } from "@/lib/payments/statusRules";

export type StatusView = {
  mode: ProviderMode;
  baseUrl: string | null;
  apiKeyFingerprint: string | null;
  webhookSecretPresent: boolean;
  productId: string | null;
  accountId: string | null;
  health: {
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    failures24h: number;
    totalCalls: number;
  };
};

const MODE_STYLE: Record<ProviderMode, string> = {
  production: "border-[var(--color-danger)] bg-[var(--color-danger)]/5 text-[var(--color-danger)]",
  sandbox: "border-[var(--color-blue)] bg-[var(--color-blue)]/5 text-[var(--color-blue)]",
  unknown: "border-[var(--color-warning)] bg-[var(--color-warning)]/5 text-[var(--color-warning)]",
};

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

export function PaymentStatusPanel({ status }: { status: StatusView }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function testConnection() {
    setBusy(true);
    setResult(null);

    try {
      const res = await fetch("/api/admin/payments/test-connection", { method: "POST" });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        setResult({ ok: false, message: body?.error ?? `The test could not run (HTTP ${res.status}).` });
        return;
      }
      // The route reports the real reason on both paths — never a generic "something went wrong",
      // because a connection test that hides why it failed is worse than no test.
      setResult({ ok: Boolean(body?.ok), message: body?.message ?? "No answer from the test." });
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  const facts: { label: string; value: string; hint?: string }[] = [
    { label: "API base URL", value: status.baseUrl ?? "Not set" },
    {
      label: "API key",
      value: status.apiKeyFingerprint ?? "Not set",
      hint: status.apiKeyFingerprint ? "Last four characters only." : "No Whop call can succeed without it.",
    },
    {
      label: "Webhook signing secret",
      value: status.webhookSecretPresent ? "Present" : "Not set",
      hint: status.webhookSecretPresent
        ? undefined
        : "Every incoming webhook is rejected, so payments never reach us.",
    },
    { label: "Whop product", value: status.productId ?? "Not set" },
    { label: "Whop account", value: status.accountId ?? "Not set" },
  ];

  return (
    <div className="space-y-5">
      <div className={`rounded-lg border-2 p-5 ${MODE_STYLE[status.mode]}`}>
        <p className="text-xs font-bold uppercase tracking-wider opacity-80">Mode</p>
        <p className="mt-0.5 text-2xl font-extrabold tracking-tight">{MODE_COPY[status.mode].label}</p>
        <p className="mt-1 text-sm font-medium">{MODE_COPY[status.mode].detail}</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-start">
      <Card>
        <CardContent className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand-700)]">Configuration</h2>

          <dl className="space-y-3">
            {facts.map((f) => (
              <div key={f.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                <dt className="text-sm text-muted-foreground">{f.label}</dt>
                <dd className="font-mono text-sm">{f.value}</dd>
                {f.hint && <p className="w-full text-xs text-muted-foreground">{f.hint}</p>}
              </div>
            ))}
          </dl>

          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            These are environment variables, not settings. Changing one is a redeploy, not a code
            change — deliberately, so a payment credential never sits in a database row.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand-700)]">Health</h2>

          <dl className="space-y-2">
            <div className="flex justify-between gap-4 text-sm">
              <dt className="text-muted-foreground">Last successful call</dt>
              <dd>{when(status.health.lastSuccessAt)}</dd>
            </div>
            <div className="flex justify-between gap-4 text-sm">
              <dt className="text-muted-foreground">Last failure</dt>
              <dd>{when(status.health.lastFailureAt)}</dd>
            </div>
            <div className="flex justify-between gap-4 text-sm">
              <dt className="text-muted-foreground">Failures in the last 24 hours</dt>
              <dd className={status.health.failures24h > 0 ? "font-semibold text-[var(--color-danger)]" : ""}>
                {status.health.failures24h}
              </dd>
            </div>
            <div className="flex justify-between gap-4 text-sm">
              <dt className="text-muted-foreground">Calls recorded in total</dt>
              <dd>{status.health.totalCalls.toLocaleString("en-US")}</dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button onClick={testConnection} disabled={busy}>
              <Plug className="size-4" />
              {busy ? "Testing…" : "Test connection"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Makes a real authenticated request and records it below.
            </p>
          </div>

          {result && (
            <p
              className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                result.ok
                  ? "border-[var(--color-success)]/40 bg-[var(--color-success)]/5 text-[var(--color-success)]"
                  : "border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5 text-[var(--color-danger)]"
              }`}
            >
              {result.ok ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              ) : (
                <XCircle className="mt-0.5 size-4 shrink-0" />
              )}
              <span>{result.message}</span>
            </p>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";

import { StatusChip, type StatusTone } from "@/components/admin/status-chip";
import { formatUtcDateTime } from "@/lib/adminDashboard/figures";
import { MODE_COPY, type ProviderMode } from "@/lib/payments/statusRules";
import { cn } from "@/lib/utils";

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

export type WebhookView = { lastReceivedAt: string | null; lastProcessedAt: string | null; stuck: number };

const card = "min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)]";
const th = "px-3 py-2 text-left text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";
const td = "border-t border-[var(--border)] px-3 py-2 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]";

/** The mode callout's colour: production is the dangerous one, unknown means payments are down. */
const MODE_CALLOUT: Record<ProviderMode, { edge: string; ink: string; title: string }> = {
  production: { edge: "border-l-[var(--error)] bg-[var(--error-surface)]", ink: "text-[var(--error-ink)]", title: "Production is active" },
  sandbox: { edge: "border-l-[var(--info)] bg-[var(--info-surface)]", ink: "text-[var(--info-ink)]", title: "Sandbox is active" },
  unknown: { edge: "border-l-[var(--warning)] bg-[var(--warning-surface)]", ink: "text-[var(--warning-ink)]", title: "The payment provider is not configured" },
};

function when(value: string | null) {
  return formatUtcDateTime(value) ?? "Never";
}

/**
 * Payment setup (p-adm-payments), drawn from what the platform is actually pointed at.
 *
 * The board shows replaceable Stripe keys and a live/test switch. Neither exists here, on purpose:
 * the provider is Whop, the credentials are environment variables (a payment credential never sits
 * in a database row), and the mode is read from the API host rather than stored. So each credential
 * shows presence and a fingerprint only — never a reveal — and the mode card says how it changes
 * instead of offering a switch that would be a lie.
 */
export function PaymentStatusPanel({ status, webhooks }: { status: StatusView; webhooks: WebhookView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; at: string } | null>(null);

  async function testConnection() {
    setBusy(true);
    setResult(null);
    const at = new Date().toISOString();
    try {
      const res = await fetch("/api/admin/payments/test-connection", { method: "POST" });
      const body = await res.json().catch(() => null);
      // The route reports the real reason on both paths — never a generic "something went wrong".
      if (!res.ok) setResult({ ok: false, message: body?.error ?? `The test could not run (HTTP ${res.status}).`, at });
      else setResult({ ok: Boolean(body?.ok), message: body?.message ?? "No answer from the test.", at });
      router.refresh(); // the call is recorded in provider_calls, so the health table moves with it
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : String(error), at });
    } finally {
      setBusy(false);
    }
  }

  const callout = MODE_CALLOUT[status.mode];
  const credentials: Array<{ label: string; value: string; note: string; missing: boolean }> = [
    { label: "API key", value: status.apiKeyFingerprint ?? "Not set", note: status.apiKeyFingerprint ? "WHOP_API_KEY · last four characters only" : "WHOP_API_KEY · no Whop call can succeed without it", missing: !status.apiKeyFingerprint },
    { label: "Webhook signing secret", value: status.webhookSecretPresent ? "Present" : "Not set", note: status.webhookSecretPresent ? "WHOP_WEBHOOK_SECRET · presence only" : "WHOP_WEBHOOK_SECRET · every incoming webhook is rejected, so payments never reach us", missing: !status.webhookSecretPresent },
    { label: "API base URL", value: status.baseUrl ?? "Not set", note: "WHOP_API_BASE_URL · decides the mode", missing: !status.baseUrl },
    { label: "Product", value: status.productId ?? "Not set", note: "WHOP_PRODUCT_ID", missing: !status.productId },
    { label: "Account", value: status.accountId ?? "Not set", note: "WHOP_ACCOUNT_ID", missing: !status.accountId },
  ];

  const apiOk = status.health.lastSuccessAt && (!status.health.lastFailureAt || status.health.lastSuccessAt > status.health.lastFailureAt);
  const checks: Array<{ check: string; result: string; tone: StatusTone; last: string | null }> = [
    { check: "API reachable", result: status.health.totalCalls === 0 ? "No call recorded yet" : apiOk ? "Pass" : "Failing", tone: status.health.totalCalls === 0 ? "neutral" : apiOk ? "good" : "danger", last: apiOk ? status.health.lastSuccessAt : status.health.lastFailureAt ?? status.health.lastSuccessAt },
    { check: "Failed calls, last 24 hours", result: status.health.failures24h === 0 ? "None" : `${status.health.failures24h.toLocaleString()} failed`, tone: status.health.failures24h === 0 ? "good" : "danger", last: status.health.lastFailureAt },
    { check: "Webhook endpoint", result: webhooks.lastReceivedAt ? "Receiving" : "Nothing received yet", tone: webhooks.lastReceivedAt ? "good" : "warning", last: webhooks.lastReceivedAt },
    { check: "Webhook processing", result: webhooks.stuck === 0 ? "Nothing stuck" : `${webhooks.stuck.toLocaleString()} failed and unprocessed`, tone: webhooks.stuck === 0 ? "good" : "danger", last: webhooks.lastProcessedAt },
    { check: "Signature verification", result: status.webhookSecretPresent ? "Secret present" : "No secret — every webhook is rejected", tone: status.webhookSecretPresent ? "good" : "danger", last: null },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className={cn("min-w-0 flex-1 rounded-[12px] border border-[var(--border)] border-l-[3px] px-4 py-3.5", callout.edge)}>
          <p className={cn("text-[14px] font-semibold", callout.ink)}>{callout.title}</p>
          <p className="mt-1.5 text-[14px] leading-normal text-[var(--body)]">{MODE_COPY[status.mode].detail} The mode is read from the API host, so it cannot disagree with what the platform is actually calling.</p>
        </div>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <section className={cn(card, "overflow-hidden")} aria-labelledby="payments-credentials">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3">
            <h2 id="payments-credentials" className="text-[14px] font-semibold text-[var(--ink)]">Credentials</h2>
            <StatusChip tone="neutral">Super admin only</StatusChip>
          </div>
          <dl className="m-0">
            {credentials.map((item) => (
              <div key={item.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-[var(--border)] px-4 py-3 first:border-t-0">
                <dt className="min-w-0">
                  <span className="block text-[14px] font-semibold text-[var(--ink)]">{item.label}</span>
                  <span className="block text-[12px] text-[var(--muted)]">{item.note}</span>
                </dt>
                <dd className={cn("m-0 font-mono text-[14px] break-all", item.missing ? "text-[var(--error-ink)]" : "text-[var(--ink)]")}>{item.value}</dd>
              </div>
            ))}
          </dl>
          <p className="border-t border-[var(--border)] bg-[var(--canvas)] px-4 py-2.5 text-[12px] leading-normal text-[var(--body)]">There is no reveal. A secret is shown as presence and its last four characters — nothing more, ever. These are environment variables: replacing one is a redeploy, so a payment credential never sits in a database row.</p>
        </section>

        <section className={cn(card, "overflow-hidden")} aria-labelledby="payments-health">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3">
            <h2 id="payments-health" className="text-[14px] font-semibold text-[var(--ink)]">Provider health</h2>
            <span className="text-[12px] text-[var(--muted)] tabular-nums">{status.health.totalCalls.toLocaleString("en-US")} calls recorded</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse">
              <thead><tr className="bg-[var(--surface-alt)]"><th scope="col" className={th}>Check</th><th scope="col" className={th}>Result</th><th scope="col" className={cn(th, "w-[200px]")}>Last seen</th></tr></thead>
              <tbody>
                {checks.map((row) => (
                  <tr key={row.check}>
                    <td className={cn(td, "font-semibold text-[var(--ink)]")}>{row.check}</td>
                    <td className={td}><StatusChip tone={row.tone} dot>{row.result}</StatusChip></td>
                    <td className={cn(td, "text-[12px] text-[var(--muted)] tabular-nums")}>{row.last ? when(row.last) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-[var(--border)] px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void testConnection()} disabled={busy} className="inline-flex h-10 items-center justify-center rounded-[8px] border border-transparent bg-[var(--primary)] px-4 text-[14px] font-semibold text-[var(--on-primary)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50">
                {busy ? "Testing…" : "Test connection"}
              </button>
              <p className="text-[12px] text-[var(--muted)]">Makes a real authenticated request and records it in the table above.</p>
            </div>
            {result && (
              <p role="status" className={cn("flex items-start gap-2 rounded-[8px] border-l-[3px] p-3 text-[14px]", result.ok ? "border-l-[var(--success)] bg-[var(--success-surface)] text-[var(--success-ink)]" : "border-l-[var(--error)] bg-[var(--error-surface)] text-[var(--error-ink)]")}>
                {result.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />}
                <span>{result.message} <span className="text-[12px] opacity-80">· {when(result.at)}</span></span>
              </p>
            )}
          </div>
        </section>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <section className={cn(card, "p-5")} aria-labelledby="payments-mode">
          <h2 id="payments-mode" className="text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">Billing mode</h2>
          <p className="mt-1 text-[14px] text-[var(--muted)]">The single most dangerous setting on the platform — which is why it is not a button.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(["production", "sandbox"] as const).map((mode) => (
              <div key={mode} className={cn("rounded-[12px] px-4 py-3", status.mode === mode ? "border-[1.5px] border-[var(--primary)] bg-[var(--brand-50)]" : "border border-[var(--border)]")}>
                <p className="flex items-center justify-between gap-2 text-[14px] font-semibold text-[var(--ink)]">{MODE_COPY[mode].label}{status.mode === mode && <StatusChip tone="info">Current</StatusChip>}</p>
                <p className="mt-1 text-[12px] leading-normal text-[var(--muted)]">{MODE_COPY[mode].detail}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[12px] leading-normal text-[var(--body)]">Sandbox and production are two different Whop hosts with two different keys. Changing mode means changing WHOP_API_BASE_URL and WHOP_API_KEY together and redeploying; the page then shows the new mode by itself.</p>
        </section>
        <section className={cn(card, "p-5")} aria-labelledby="payments-provider">
          <h2 id="payments-provider" className="text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">Provider</h2>
          <p className="mt-1 text-[14px] leading-normal text-[var(--body)]">Whop. Changing provider is a migration, not a setting, and is not offered here.</p>
        </section>
      </div>
    </div>
  );
}

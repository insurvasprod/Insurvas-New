import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { formatUtcDateTime } from "@/lib/adminDashboard/figures";
import type { ProviderMode } from "@/lib/payments/statusRules";

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

function when(value: string | null) {
  return formatUtcDateTime(value) ?? "Never";
}

/**
 * Payment provider's credentials and checks (admin round 1, billing-r2 screen 12), drawn from what the platform is
 * actually pointed at.
 *
 * The provider is Whop, the credentials are environment variables (a payment credential never sits in a database
 * row), and the mode is read from the API host rather than stored. So each credential shows presence and a
 * fingerprint only — never a reveal — and there is no mode switch. The mode itself is said in the page's status line;
 * Test connection is on the title line.
 */
export function PaymentStatusPanel({ status, webhooks }: { status: StatusView; webhooks: WebhookView }) {
  const credentials: Array<{ label: string; value: string; note: string; missing: boolean }> = [
    { label: "API base URL", value: status.baseUrl ?? "Not set", note: "WHOP_API_BASE_URL · decides the mode", missing: !status.baseUrl },
    { label: "API key", value: status.apiKeyFingerprint ?? "Not set", note: status.apiKeyFingerprint ? "WHOP_API_KEY · last four characters only" : "WHOP_API_KEY · no Whop call can succeed without it", missing: !status.apiKeyFingerprint },
    { label: "Webhook signing secret", value: status.webhookSecretPresent ? "Present" : "Not set", note: status.webhookSecretPresent ? "WHOP_WEBHOOK_SECRET · presence only" : "WHOP_WEBHOOK_SECRET · every incoming webhook is rejected, so payments never reach us", missing: !status.webhookSecretPresent },
    { label: "Product", value: status.productId ?? "Not set", note: "WHOP_PRODUCT_ID", missing: !status.productId },
    { label: "Account", value: status.accountId ?? "Not set", note: "WHOP_ACCOUNT_ID", missing: !status.accountId },
  ];

  const apiOk = status.health.lastSuccessAt && (!status.health.lastFailureAt || status.health.lastSuccessAt > status.health.lastFailureAt);
  const checks: Array<{ check: string; result: string; tone: StatusTone; last: string | null }> = [
    { check: "API reachable", result: status.health.totalCalls === 0 ? "No call recorded yet" : apiOk ? "Pass" : "Failing", tone: status.health.totalCalls === 0 ? "neutral" : apiOk ? "good" : "danger", last: apiOk ? status.health.lastSuccessAt : status.health.lastFailureAt ?? status.health.lastSuccessAt },
    { check: "Failed calls, last 24 hours", result: status.health.failures24h === 0 ? "None" : `${status.health.failures24h.toLocaleString("en-US")} failed`, tone: status.health.failures24h === 0 ? "good" : "danger", last: status.health.lastFailureAt },
    { check: "Webhook last received", result: webhooks.lastReceivedAt ? "Receiving" : "Nothing received yet", tone: webhooks.lastReceivedAt ? "good" : "warning", last: webhooks.lastReceivedAt },
    { check: "Webhook last processed", result: webhooks.stuck === 0 ? "Nothing stuck" : `${webhooks.stuck.toLocaleString("en-US")} failed and unprocessed`, tone: webhooks.stuck === 0 ? "good" : "danger", last: webhooks.lastProcessedAt },
    { check: "Signature verification", result: status.webhookSecretPresent ? "Secret present" : "No secret — every webhook is rejected", tone: status.webhookSecretPresent ? "good" : "danger", last: null },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <TableCard
        className="min-w-0"
        title="Credentials"
        info="Read-only. To replace a key or move between sandbox and production, change these environment variables in the hosting project and redeploy; the mode follows WHOP_API_BASE_URL. Views and connection tests are recorded in the audit log."
        footer={<p className="m-0 text-xs text-muted-foreground">Read-only: change these environment variables in the hosting project and redeploy. Super admin only.</p>}
      >
        <Table>
          <TableBody>
            {credentials.map((item) => (
              <TableRow key={item.label}>
                <TableCell className="font-medium text-foreground" title={item.note}>{item.label}</TableCell>
                <TableCell className="max-w-[16rem] truncate text-right font-mono text-xs" title={item.value}>
                  {item.missing ? <StatusChip tone="danger" dot>Not set</StatusChip> : item.value}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>

      <TableCard className="min-w-0" title="Checks" description={`${status.health.totalCalls.toLocaleString("en-US")} calls recorded`}>
        <Table className="min-w-[420px]">
          <TableHeader>
            <TableRow>
              <TableHead>Check</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Last seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {checks.map((row) => (
              <TableRow key={row.check}>
                <TableCell className="font-medium text-foreground">{row.check}</TableCell>
                <TableCell><StatusChip tone={row.tone} dot>{row.result}</StatusChip></TableCell>
                <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{row.last ? when(row.last) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}

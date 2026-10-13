import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { PaymentStatusPanel } from "@/components/admin/payment-status-panel";
import { getProviderStatus } from "@/lib/payments/status";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";

export default async function PaymentsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // The per-section role map from SA-4.3 is still the authority on who may open this screen; only
  // the hub that used to wrap it is gone.
  if (!canAccessConfigurationSection(admin.role, "payments")) redirect("/admin");

  const db = getSupabaseServiceClient();
  const [status, lastReceived, lastProcessed, stuck] = await Promise.all([
    getProviderStatus(),
    db.from("webhook_events").select("received_at").eq("provider", "whop").order("received_at", { ascending: false }).limit(1).maybeSingle<{ received_at: string }>(),
    db.from("webhook_events").select("processed_at").eq("provider", "whop").not("processed_at", "is", null).order("processed_at", { ascending: false }).limit(1).maybeSingle<{ processed_at: string }>(),
    // Events that failed and were never processed: a payment the provider told us about that never
    // reached an invoice.
    db.from("webhook_events").select("id", { count: "exact", head: true }).eq("provider", "whop").is("processed_at", null).not("process_error", "is", null),
  ]);

  const stuckCount = stuck.count ?? 0;
  // Presence only, from what getProviderStatus() already reports; no value is read here.
  const missing = [
    status.baseUrl ? null : "API address",
    status.apiKeyFingerprint ? null : "API key",
    status.webhookSecretPresent ? null : "webhook secret",
    status.productId ? null : "product",
    status.accountId ? null : "account",
  ].filter((name): name is string => name !== null);
  const modeLabel = status.mode === "production" ? "Production" : status.mode === "sandbox" ? "Sandbox" : "Unknown";

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <PageHeader title="Payment setup" />
      <StatStrip label="Payments at a glance">
        <StatTile label="Mode" valueSize="text" value={modeLabel} valueTone={status.mode === "unknown" ? "warning" : undefined} footnote={status.mode === "sandbox" ? "test payments only" : status.mode === "production" ? "real payments" : "address not recognised"} />
        <StatTile label="Failed calls, 24h" value={status.health.failures24h.toLocaleString("en-US")} valueTone={status.health.failures24h > 0 ? "danger" : undefined} footnote={`${status.health.totalCalls.toLocaleString("en-US")} calls logged in all`} />
        <StatTile label="Stuck webhooks" labelTitle="Events that failed and were never processed" value={stuckCount.toLocaleString("en-US")} valueTone={stuckCount > 0 ? "danger" : undefined} footnote={stuckCount > 0 ? "failed, never processed" : "none stuck"} />
        <StatTile label="Credentials missing" value={missing.length.toLocaleString("en-US")} valueTone={missing.length > 0 ? "warning" : undefined} footnote={missing.length > 0 ? missing.join(", ") : "all set"} />
      </StatStrip>
      <PaymentStatusPanel
        status={status}
        webhooks={{ lastReceivedAt: lastReceived.data?.received_at ?? null, lastProcessedAt: lastProcessed.data?.processed_at ?? null, stuck: stuckCount }}
      />
    </div>
  );
}

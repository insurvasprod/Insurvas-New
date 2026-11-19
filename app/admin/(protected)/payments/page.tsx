import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { BillingPage } from "@/components/admin/billing/billing-page";
import { ProviderEvents, type ProviderEvent } from "@/components/admin/billing/provider-events";
import { ProviderTestButton } from "@/components/admin/billing/provider-test-button";
import { PaymentStatusPanel } from "@/components/admin/payment-status-panel";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { getProviderStatus } from "@/lib/payments/status";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";
import { MODE_COPY, deriveMode } from "@/lib/payments/statusRules";

const RECENT_EVENTS = 50;
const PAYLOAD_CHARS = 6000;

type EventRow = { id: string; event_id: string; event_type: string; tenant_id: string | null; received_at: string; processed_at: string | null; process_error: string | null; attempts: number | null; payload: unknown };
const EVENT_COLUMNS = "id, event_id, event_type, tenant_id, received_at, processed_at, process_error, attempts, payload";

/**
 * Payment provider (admin round 1, docs/design/admin-r1/billing-r2.html screen 12): the Billing rail's foot, super
 * admin only through the per-section role map (SA-4.3), as before.
 */
export default async function PaymentsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "payments")) redirect("/admin");

  // SA-4.2: opening payment setup is recorded, like testing it. The keys cannot be changed here (they are
  // environment variables), so the trail of who looked at which mode, and when, is the configuration history this
  // screen has. Presence and mode only — never a value. A failed write is logged, not shown: the page still renders.
  await audit({
    actorId: admin.id,
    action: "payment_provider.config_viewed",
    targetType: "payment_provider",
    targetId: "whop",
    metadata: { mode: deriveMode(process.env.WHOP_API_BASE_URL) },
    request: new Request("https://admin.invalid/admin/payments", { headers: await headers() }),
  }).catch((error) => console.error("[payments] could not audit the page view", error));

  const db = getSupabaseServiceClient();
  const [status, lastReceived, lastProcessed, stuckRead, recentRead] = await Promise.all([
    getProviderStatus(),
    db.from("webhook_events").select("received_at").eq("provider", "whop").order("received_at", { ascending: false }).limit(1).maybeSingle<{ received_at: string }>(),
    db.from("webhook_events").select("processed_at").eq("provider", "whop").not("processed_at", "is", null).order("processed_at", { ascending: false }).limit(1).maybeSingle<{ processed_at: string }>(),
    // Events that failed and were never processed: a payment the provider told us about that never reached an
    // invoice. Every one of them is listed, whatever its age.
    db.from("webhook_events").select(EVENT_COLUMNS, { count: "exact" }).eq("provider", "whop").is("processed_at", null).not("process_error", "is", null).order("received_at", { ascending: true }).limit(500),
    db.from("webhook_events").select(EVENT_COLUMNS).eq("provider", "whop").order("received_at", { ascending: false }).limit(RECENT_EVENTS),
  ]);
  if (lastReceived.error) throw new Error(`Could not read webhook events: ${lastReceived.error.message}`);
  if (lastProcessed.error) throw new Error(`Could not read webhook events: ${lastProcessed.error.message}`);
  if (stuckRead.error) throw new Error(`Could not read stuck webhook events: ${stuckRead.error.message}`);
  if (recentRead.error) throw new Error(`Could not read webhook events: ${recentRead.error.message}`);

  const stuckRows = (stuckRead.data ?? []) as unknown as EventRow[];
  const recentRows = (recentRead.data ?? []) as unknown as EventRow[];
  const byId = new Map<string, EventRow>();
  for (const row of [...stuckRows, ...recentRows]) byId.set(row.id, row);
  const tenantIds = [...new Set([...byId.values()].map((row) => row.tenant_id).filter((id): id is string => Boolean(id)))];
  const tenantsRead = tenantIds.length ? await db.from("tenants").select("id, name").in("id", tenantIds) : { data: [] as { id: string; name: string }[], error: null };
  if (tenantsRead.error) throw new Error(`Could not read customers: ${tenantsRead.error.message}`);
  const tenantName = new Map(((tenantsRead.data ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));

  const now = new Date().getTime();
  const events: ProviderEvent[] = [...byId.values()]
    .sort((a, b) => b.received_at.localeCompare(a.received_at))
    .map((row) => {
      const text = JSON.stringify(row.payload, null, 2) ?? "";
      return {
        id: row.id,
        eventId: row.event_id,
        type: row.event_type,
        tenantId: row.tenant_id,
        tenantName: row.tenant_id ? tenantName.get(row.tenant_id) ?? null : null,
        receivedAt: row.received_at,
        processedAt: row.processed_at,
        error: row.process_error,
        attempts: row.attempts ?? 0,
        payload: text.length > PAYLOAD_CHARS ? `${text.slice(0, PAYLOAD_CHARS)}\n… (${(text.length - PAYLOAD_CHARS).toLocaleString("en-US")} more characters)` : text,
        state: row.processed_at ? "processed" : row.process_error ? "stuck" : "waiting",
      };
    });

  const stuckCount = stuckRead.count ?? stuckRows.length;
  const oldestStuckDays = stuckRows[0] ? Math.floor((now - Date.parse(stuckRows[0].received_at)) / 86_400_000) : null;
  // Presence only, from what getProviderStatus() already reports; no value is read here.
  const missing = [
    status.baseUrl ? null : "API address",
    status.apiKeyFingerprint ? null : "API key",
    status.webhookSecretPresent ? null : "webhook secret",
    status.productId ? null : "product",
    status.accountId ? null : "account",
  ].filter((name): name is string => name !== null);
  const modeLabel = status.mode === "production" ? "Live" : status.mode === "sandbox" ? "Sandbox" : "Unknown";
  const failures = status.health.failures24h;
  const n = (value: number) => value.toLocaleString("en-US");

  return (
    <BillingPage
      step="provider"
      title="Payment provider"
      info={`Whop, the provider that charges every card. ${MODE_COPY[status.mode].detail}`}
      actions={<ProviderTestButton />}
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        <StatStrip label="Payments at a glance">
          <StatTile label="Mode" valueSize="text" value={modeLabel} valueTone={status.mode === "unknown" ? "warning" : undefined} footnote={status.mode === "sandbox" ? "test payments only" : status.mode === "production" ? "Whop · real payments" : "address not recognised"} />
          <StatTile label="Failed calls · 24h" value={n(failures)} valueTone={failures > 0 ? "danger" : undefined} footnote={`${n(status.health.totalCalls)} calls logged in all`} />
          <StatTile label="Stuck webhooks" labelTitle="Events that failed and were never processed" value={n(stuckCount)} valueTone={stuckCount > 0 ? "danger" : undefined} footnote={stuckCount > 0 && oldestStuckDays !== null ? `oldest ${n(oldestStuckDays)} days` : "none stuck"} href={stuckCount > 0 ? "/admin/payments?events=stuck" : undefined} />
          <StatTile label="Credentials missing" value={n(missing.length)} valueTone={missing.length > 0 ? "warning" : undefined} footnote={missing.length > 0 ? missing.join(", ") : "of 5 · all set"} />
        </StatStrip>

        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)] xl:items-start">
          <ProviderEvents events={events} truncatedAt={RECENT_EVENTS} />
          <PaymentStatusPanel
            status={status}
            webhooks={{ lastReceivedAt: lastReceived.data?.received_at ?? null, lastProcessedAt: lastProcessed.data?.processed_at ?? null, stuck: stuckCount }}
          />
        </div>
      </div>
    </BillingPage>
  );
}

import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { AdminPageHeader } from "@/components/admin/page-header";
import { PaymentStatusPanel } from "@/components/admin/payment-status-panel";
import { getProviderStatus } from "@/lib/payments/status";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

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

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <AdminPageHeader title="Payment setup" subtitle="Provider, mode, keys and payment health. Live credentials are super-admin only." />
      <PaymentStatusPanel
        status={status}
        webhooks={{ lastReceivedAt: lastReceived.data?.received_at ?? null, lastProcessedAt: lastProcessed.data?.processed_at ?? null, stuck: stuck.count ?? 0 }}
      />
    </div>
  );
}

import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { BillingPage } from "@/components/admin/billing/billing-page";
import { CreditsActions } from "@/components/admin/billing/credits-actions";
import { CreditLimitsPanel } from "@/components/admin/credit-limits-panel";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { getCreditsLimitsData } from "@/lib/creditsLimits/service";
import { buildMonitorEntries, tenantsOverCount } from "@/lib/creditsLimits/present";

/**
 * Credits & limits (admin round 1, docs/design/admin-r1/billing-r2.html screen 10), inside the Billing frame. The
 * per-section role map from SA-4.3 is still the authority on who may open this screen; it matches the API routes:
 * super_admin and platform_config (billing ops still cannot, as before).
 */
export default async function CreditsLimitsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "credits-limits")) redirect("/admin");

  const data = await getCreditsLimitsData();
  const now = new Date();
  const entries = buildMonitorEntries(data.monitor, data.seats, data.warnPercent / 100);
  const over = tenantsOverCount(entries);
  const near = new Set(entries.filter((e) => e.state === "near").map((e) => e.tenantId)).size;
  const priced = data.pricing.filter((m) => m.sell_cents > 0).length;
  const onSale = data.packs.filter((p) => p.is_active).length;
  const n = (value: number) => value.toLocaleString("en-US");

  return (
    <BillingPage
      step="credits"
      info="Who is near or over a usage limit, the credit packs on sale, each plan's default allowances, and what each meter costs and sells for."
      actions={<CreditsActions />}
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        <StatStrip label="Credits and limits">
          <StatTile label="Over a limit" value={n(over)} valueTone={over > 0 ? "danger" : undefined} footnote={over === 1 ? "customer" : "customers"} href="/admin/credits-limits?show=over" />
          <StatTile label="Near a limit" value={n(near)} footnote={`at ${data.warnPercent}% or more`} href="/admin/credits-limits?show=watch" />
          <StatTile label="Limits watched" value={n(entries.length)} footnote="meters and seats" />
          <StatTile label="Credit packs" value={n(onSale)} footnote={`on sale · ${n(data.packs.length - onSale)} retired`} href="/admin/credits-limits?lens=packs" />
          <StatTile label="Meters priced" value={n(priced)} footnote={`of ${n(data.pricing.length)} meters`} href="/admin/credits-limits?lens=pricing" />
        </StatStrip>

        <CreditLimitsPanel data={data} nowIso={now.toISOString()} />
      </div>
    </BillingPage>
  );
}

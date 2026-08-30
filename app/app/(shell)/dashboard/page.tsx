import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "@/lib/entitlements/get";
import { effectiveFeatures } from "@/lib/features/killSwitch";
import { grantedAndBuilt, featureLabel, menuItemForFeature } from "@/lib/menu/definition";
import { planDisplayName } from "@/lib/plans/display";
import { fetchMeters } from "@/lib/metering/queries";
import { meterWarnThreshold } from "@/lib/settings/queries";
import { Card, CardContent } from "@/components/ui/card";
import { UsageBar } from "@/components/app/usage-bar";

/** Always visible — the menu definition gives Dashboard no required_feature. */
export default async function AgentDashboardPage() {
  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");

  const entitlement = await getEntitlement(context.tenantId);

  // The same effective set the sidebar uses, so the dashboard cannot advertise a screen the menu
  // has hidden because it is switched off platform-wide.
  const available = await effectiveFeatures(entitlement.features, context.tenantId);
  const openNow = grantedAndBuilt(available).filter((item) => item.id !== "dashboard");

  // Features the plan grants that have no screen yet — worth naming, because the customer is
  // paying for them and silence reads as them not existing.
  const onTheWay = [...available]
    .map((key) => menuItemForFeature(key))
    .filter((item): item is NonNullable<typeof item> => Boolean(item) && !item!.built);

  const meterRows = Object.entries(entitlement.meters);
  // Meter labels live in the catalog, not in the entitlement blob. Reading them here rather than
  // shipping `dials` to a customer's screen.
  const meterCatalog = meterRows.length > 0 ? await fetchMeters().catch(() => []) : [];
  const labelOf = new Map(meterCatalog.map((m) => [m.meter_key, { label: m.label, unit: m.unit }]));

  // The operator-configured warning band (SA-4.1), so the agent's bar turns amber at the same
  // point the admin usage monitor calls a tenant "near".
  const warnThreshold = await meterWarnThreshold().catch(() => undefined);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm font-medium text-muted-foreground">
          {entitlement.plan_code
            ? `You're on the ${planDisplayName(entitlement.plan_code)} plan.`
            : "You don't have an active subscription."}
        </p>
      </div>

      {/* Usage first. It is the only thing on this screen that changes day to day, and the only
          thing with a deadline attached — running out mid-month is the surprise worth preventing. */}
      {meterRows.length > 0 && (
        <Card>
          <CardContent className="space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand-700)]">
              This period
            </h2>
            <div className="space-y-4">
              {meterRows.map(([key, meter]) => {
                const known = labelOf.get(key);
                return (
                  <UsageBar
                    key={key}
                    label={known?.label ?? featureLabel(key)}
                    unit={known?.unit ?? ""}
                    used={meter.used}
                    included={meter.included}
                    hardCap={meter.hard_cap}
                    warnThreshold={warnThreshold}
                  />
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {openNow.length > 0 && (
        <Card>
          <CardContent className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand-700)]">
              Where to go
            </h2>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {openNow.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/app/${item.id}`}
                    className="group flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-[var(--color-blue)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-blue)]"
                  >
                    <span>
                      <span className="font-medium">{item.label}</span>
                      <span className="block text-xs text-muted-foreground">{item.sectionLabel}</span>
                    </span>
                    <ArrowRight
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {onTheWay.length > 0 && (
        <Card>
          <CardContent className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand-700)]">
              Included in your plan, on the way
            </h2>
            <p className="text-sm text-muted-foreground">
              These are part of what you pay for and we are still building them. Nothing to buy and
              nothing to switch on.
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {onTheWay.map((item) => (
                <li
                  key={item.id}
                  className="rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {item.label}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {openNow.length === 0 && onTheWay.length === 0 && (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {entitlement.plan_code
                ? "Your plan doesn't include any features yet. Contact your administrator."
                : "Once a subscription is active, everything it includes will appear here."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

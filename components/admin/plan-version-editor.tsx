"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert, Lock } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FeatureModuleGroup } from "@/lib/features/constants";
import { buildAgentMenu } from "@/lib/menu/definition";
import {
  BILLING_CYCLE_LABELS,
  formatCents,
  formatCentsAsCurrency,
  monthlyEquivalentCents,
  parseDollarsToCents,
  type PlanPrices,
} from "@/lib/money";

/** Blank means "this cycle isn't offered"; anything else must parse to whole cents. */
function centsFromInput(value: string): { cents: number | null; invalid: boolean } {
  if (value.trim() === "") return { cents: null, invalid: false };
  const cents = parseDollarsToCents(value);
  return { cents, invalid: cents === null };
}

export function PlanVersionEditor({
  planId,
  planVersion,
  groups,
  initialGranted,
  initialPrices,
  subscriberCount,
}: {
  planId: string;
  planVersion: number;
  groups: FeatureModuleGroup[];
  initialGranted: string[];
  initialPrices: PlanPrices | null;
  subscriberCount: number;
}) {
  const router = useRouter();
  const [granted, setGranted] = useState<Set<string>>(new Set(initialGranted));
  const [monthly, setMonthly] = useState(
    initialPrices?.price_monthly_cents != null ? formatCents(initialPrices.price_monthly_cents) : "",
  );
  const [quarterly, setQuarterly] = useState(
    initialPrices?.price_quarterly_cents != null ? formatCents(initialPrices.price_quarterly_cents) : "",
  );
  const [yearly, setYearly] = useState(
    initialPrices?.price_yearly_cents != null ? formatCents(initialPrices.price_yearly_cents) : "",
  );
  const [setupFee, setSetupFee] = useState(formatCents(initialPrices?.setup_fee_cents ?? 0));
  const [trialDays, setTrialDays] = useState(String(initialPrices?.trial_days ?? 0));
  const [saving, setSaving] = useState(false);

  // An archived feature this plan already grants stays granted (SA-2.1) and can't be offered by
  // the picker. Shown locked rather than hidden, so the ticked list matches what the plan does.
  const lockedArchived = useMemo(
    () =>
      new Set(
        groups
          .flatMap((g) => g.features.filter((f) => f.is_archived && granted.has(f.feature_key)))
          .map((f) => f.feature_key),
      ),
    [groups, granted],
  );

  // Preview and the agent's real menu render from the SAME definition, so they can't drift.
  const previewMenu = useMemo(() => buildAgentMenu(granted), [granted]);

  const parsedMonthly = centsFromInput(monthly);
  const parsedQuarterly = centsFromInput(quarterly);
  const parsedYearly = centsFromInput(yearly);
  const parsedSetup = centsFromInput(setupFee);

  const priceInvalid =
    parsedMonthly.invalid || parsedQuarterly.invalid || parsedYearly.invalid || parsedSetup.invalid;
  const noCyclePriced =
    parsedMonthly.cents === null && parsedQuarterly.cents === null && parsedYearly.cents === null;

  function toggle(key: string) {
    if (lockedArchived.has(key)) return;
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleModule(group: FeatureModuleGroup) {
    const selectable = group.features.filter((f) => !f.is_archived);
    const allOn = selectable.length > 0 && selectable.every((f) => granted.has(f.feature_key));

    setGranted((prev) => {
      const next = new Set(prev);
      for (const f of selectable) {
        if (allOn) next.delete(f.feature_key);
        else next.add(f.feature_key);
      }
      return next;
    });
  }

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/admin/plans/${planId}/version`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feature_keys: [...granted],
        price_monthly_cents: parsedMonthly.cents,
        price_quarterly_cents: parsedQuarterly.cents,
        price_yearly_cents: parsedYearly.cents,
        setup_fee_cents: parsedSetup.cents ?? 0,
        trial_days: Number(trialDays) || 0,
      }),
    });
    const body = await res.json().catch(() => null);
    setSaving(false);

    if (!res.ok) {
      toast.error(body?.error ?? "Could not save");
      return;
    }

    if (body.createdNewVersion) {
      toast.success(
        `Published v${body.version} — the ${subscriberCount} existing subscriber(s) keep v${planVersion}'s features and price`,
      );
      router.push(`/admin/plans/${body.planId}/edit`);
    } else {
      toast.success("Plan saved");
    }
    router.refresh();
  }

  const grantedCount = granted.size;
  const canSave = grantedCount > 0 && !priceInvalid;

  return (
    <div className="space-y-4">
      {subscriberCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-4 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--color-warning)]" />
          <p>
            <span className="font-medium">
              {subscriberCount} live subscriber{subscriberCount === 1 ? "" : "s"} on this version.
            </span>{" "}
            Saving publishes <span className="font-medium">v{planVersion + 1}</span>. They stay on v{planVersion} —
            same features, same price — until migrated.
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {/* ── Pricing ──────────────────────────────────────────── */}
          <Card>
            <CardContent className="space-y-3">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand-700)]">Pricing</h2>
                <p className="text-xs text-muted-foreground">
                  Leave a cycle blank to not offer it. USD only. Stored as whole cents.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {(
                  [
                    ["monthly", monthly, setMonthly, parsedMonthly],
                    ["quarterly", quarterly, setQuarterly, parsedQuarterly],
                    ["yearly", yearly, setYearly, parsedYearly],
                  ] as const
                ).map(([cycle, value, setValue, parsed]) => (
                  <div key={cycle} className="space-y-1.5">
                    <Label htmlFor={`price-${cycle}`}>{BILLING_CYCLE_LABELS[cycle]}</Label>
                    <Input
                      id={`price-${cycle}`}
                      inputMode="decimal"
                      placeholder="Not offered"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      aria-invalid={parsed.invalid || undefined}
                    />
                    <p className="text-xs text-muted-foreground">
                      {parsed.invalid ? (
                        <span className="text-[var(--color-danger)]">Enter an amount like 449.99</span>
                      ) : parsed.cents === null ? (
                        "Not offered"
                      ) : cycle === "monthly" ? (
                        formatCentsAsCurrency(parsed.cents)
                      ) : (
                        `${formatCentsAsCurrency(parsed.cents)} · ${formatCentsAsCurrency(
                          monthlyEquivalentCents(parsed.cents, cycle),
                        )}/mo equiv.`
                      )}
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="setup-fee">Setup fee (one-time)</Label>
                  <Input
                    id="setup-fee"
                    inputMode="decimal"
                    value={setupFee}
                    onChange={(e) => setSetupFee(e.target.value)}
                    aria-invalid={parsedSetup.invalid || undefined}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="trial-days">Trial days</Label>
                  <Input
                    id="trial-days"
                    type="number"
                    min={0}
                    max={365}
                    value={trialDays}
                    onChange={(e) => setTrialDays(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">0 = no trial.</p>
                </div>
              </div>

              {noCyclePriced && !priceInvalid && (
                <p className="text-xs text-[var(--color-warning)]">
                  No cycle priced — this plan can be saved, but not sold.
                </p>
              )}
            </CardContent>
          </Card>

          {/* ── Features ─────────────────────────────────────────── */}
          {groups.map((group) => {
            const selectable = group.features.filter((f) => !f.is_archived);
            const visible = group.features.filter((f) => !f.is_archived || granted.has(f.feature_key));
            const allOn = selectable.length > 0 && selectable.every((f) => granted.has(f.feature_key));

            if (visible.length === 0) return null;

            return (
              <Card key={group.module.key}>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand-700)]">
                      {group.module.label}
                    </h2>
                    {selectable.length > 0 && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => toggleModule(group)}>
                        {allOn ? "Clear all" : "Select all"}
                      </Button>
                    )}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {visible.map((feature) => {
                      const isLocked = lockedArchived.has(feature.feature_key);
                      const isOn = granted.has(feature.feature_key);

                      return (
                        <label
                          key={feature.id}
                          className={`flex items-start gap-2 rounded-md border border-border p-2.5 text-sm ${
                            isLocked ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-muted"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isOn}
                            disabled={isLocked}
                            onChange={() => toggle(feature.feature_key)}
                            className="mt-0.5 size-4 shrink-0 accent-[var(--color-blue)]"
                          />
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 font-medium">
                              {feature.label}
                              {isLocked && (
                                <span title="Archived, but still granted by this plan">
                                  <Lock className="size-3 text-muted-foreground" />
                                </span>
                              )}
                            </span>
                            <code className="text-xs text-muted-foreground">{feature.feature_key}</code>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* ── Preview ────────────────────────────────────────────── */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardContent className="space-y-3">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand-700)]">
                  Agent will see
                </h2>
                <p className="text-xs text-muted-foreground">
                  Rendered from the same menu definition the agent app uses.
                </p>
              </div>

              <div className="rounded-md bg-[var(--brand-700)] p-3 text-sm text-white">
                {previewMenu.map((section) => (
                  <div key={section.id} className="mb-3 last:mb-0">
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-white/60">
                      {section.label}
                    </p>
                    {section.items.map((item) => (
                      <p key={item.id} className="py-0.5 pl-2 text-white/90">
                        {item.label}
                      </p>
                    ))}
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between">
                <Badge variant="outline">
                  {grantedCount} feature{grantedCount === 1 ? "" : "s"}
                </Badge>
                {grantedCount === 0 && (
                  <span className="text-xs text-[var(--color-danger)]">At least one required</span>
                )}
              </div>

              <Button className="w-full" onClick={save} disabled={saving || !canSave}>
                {saving ? "Saving…" : subscriberCount > 0 ? `Publish v${planVersion + 1}` : "Save plan"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

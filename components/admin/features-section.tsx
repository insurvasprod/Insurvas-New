"use client";

import { useState } from "react";

import { FeatureCatalog } from "@/components/admin/feature-catalog";
import { FeatureSwitchesPanel, type SwitchableFeature } from "@/components/admin/feature-switches-panel";
import type { FeatureModuleGroup, FeatureModuleRow } from "@/lib/features/constants";
import type { FeatureSwitch } from "@/lib/features/killSwitchRules";

/**
 * Two genuinely separate jobs on one route, so they get tabs rather than a stack.
 *
 * Stacked, the kill switches sat below the whole catalog — eight module tables and twenty-seven
 * rows of scrolling before you reached the control you open this page for during an incident.
 * Tabs also stop the page implying the switches are part of editing the catalog: naming a feature
 * and taking it away from every paying customer are not the same kind of act, and they do not even
 * have the same permission.
 */
export function FeaturesSection({
  groups,
  modules,
  switchable,
  switches,
  canToggle,
}: {
  groups: FeatureModuleGroup[];
  modules: FeatureModuleRow[];
  switchable: SwitchableFeature[];
  switches: FeatureSwitch[];
  canToggle: boolean;
}) {
  const [tab, setTab] = useState<"catalog" | "switches">("catalog");
  const offCount = switches.filter((s) => s.state !== "on").length;

  const tabs = [
    { id: "catalog" as const, label: "Catalog", count: switchable.length },
    // The count is on the tab so an active kill switch is visible without opening it.
    { id: "switches" as const, label: "Kill switches", count: offCount || null },
  ];

  return (
    <div>
      <div role="tablist" aria-label="Features" className="mb-6 flex gap-1 border-b border-border">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-blue)] ${
                active
                  ? "border-[var(--color-blue)] font-semibold text-[var(--brand-700)]"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              {t.count !== null && (
                <span
                  className={`rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums ${
                    t.id === "switches" && offCount > 0
                      ? "bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === "catalog" ? (
        <FeatureCatalog initialGroups={groups} modules={modules} />
      ) : canToggle ? (
        <div>
          <p className="mb-4 max-w-[72ch] text-sm text-muted-foreground">
            Switching a feature off takes it away from every tenant immediately, whatever their plan says.
            Entitlements are untouched &mdash; nobody loses anything they paid for, and agents see a maintenance
            notice rather than an upgrade prompt.
          </p>
          <FeatureSwitchesPanel features={switchable} initialSwitches={switches} />
        </div>
      ) : (
        // platform_config maintains the catalog but cannot switch a feature off. Saying so beats a
        // tab that silently does nothing, and the API refuses them regardless.
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Only a super admin can switch a feature off for everyone. You can still edit the catalog.
        </p>
      )}
    </div>
  );
}

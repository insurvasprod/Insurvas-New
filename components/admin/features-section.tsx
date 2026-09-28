"use client";

import { useCallback, useId, useState } from "react";
import { useRouter } from "next/navigation";

import { FeatureCatalog } from "@/components/admin/feature-catalog";
import { FeatureDialog } from "@/components/admin/feature-dialog";
import { FeatureSwitchesPanel, type SwitchableFeature } from "@/components/admin/feature-switches-panel";
import { Callout } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import type { FeatureModuleGroup, FeatureModuleRow } from "@/lib/features/constants";
import { switchSummaryTitle, type FeatureSwitch, type SwitchReason } from "@/lib/features/killSwitchRules";
import { cn } from "@/lib/utils";

type Tab = "catalog" | "switches";

/**
 * The Features page (board p-adm-features): header, the platform-wide headline, and two tabs.
 *
 * Two genuinely separate jobs on one route, so they get tabs rather than a stack. Stacked, the kill
 * switches sat below eight module tables — twenty-seven rows of scrolling before the control you
 * open this page for during an incident. Tabs also stop the page implying the switches are part of
 * editing the catalog: naming a feature and taking it away from every paying customer are not the
 * same kind of act, and they do not have the same permission.
 */
export function FeaturesSection({
  groups: initialGroups,
  modules,
  switchable,
  switches,
  reasons,
  counts,
  canToggle,
}: {
  groups: FeatureModuleGroup[];
  modules: FeatureModuleRow[];
  switchable: SwitchableFeature[];
  switches: FeatureSwitch[];
  reasons: Record<string, SwitchReason>;
  counts: { off: number; beta: number };
  canToggle: boolean;
}) {
  const router = useRouter();
  const baseId = useId();
  // A switch that is not fully on is the reason anyone opens this page during an incident.
  const [tab, setTab] = useState<Tab>(counts.off + counts.beta > 0 ? "switches" : "catalog");
  const [groups, setGroups] = useState(initialGroups);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/features");
    if (res.ok) {
      const body = await res.json();
      setGroups(body.groups);
    }
    // The switch list and the override counts are read on the server.
    router.refresh();
  }, [router]);

  const title = switchSummaryTitle(counts);
  const tabs: { id: Tab; label: string }[] = [
    { id: "catalog", label: "Catalog" },
    { id: "switches", label: "Switches" },
  ];

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Features"
        actions={
          <Button type="button" onClick={() => setCreating(true)}>
            New feature
          </Button>
        }
      />

      {title && <Callout tone="warning" title={title} />}

      <div role="tablist" aria-label="Features" className="flex gap-6 border-b border-[var(--border)]">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              id={`${baseId}-tab-${t.id}`}
              role="tab"
              type="button"
              aria-selected={active}
              aria-controls={`${baseId}-panel-${t.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                event.preventDefault();
                const next = tabs[(tabs.findIndex((x) => x.id === t.id) + 1) % tabs.length];
                setTab(next.id);
                document.getElementById(`${baseId}-tab-${next.id}`)?.focus();
              }}
              className={cn(
                "-mb-px h-10 cursor-pointer border-0 border-b-2 bg-transparent px-1 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]",
                active
                  ? "border-[var(--primary)] text-[var(--ink)]"
                  : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-panel-${tab}`}
        aria-labelledby={`${baseId}-tab-${tab}`}
        className="flex min-w-0 flex-col"
      >
        {tab === "catalog" ? (
          <FeatureCatalog groups={groups} modules={modules} onRefresh={refresh} />
        ) : (
          <FeatureSwitchesPanel
            features={switchable}
            initialSwitches={switches}
            initialReasons={reasons}
            canToggle={canToggle}
          />
        )}
      </div>

      <FeatureDialog
        mode="create"
        open={creating}
        modules={modules}
        onClose={() => setCreating(false)}
        onSaved={refresh}
      />
    </div>
  );
}

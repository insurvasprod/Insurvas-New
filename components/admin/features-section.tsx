"use client";

import { useCallback, useId, useState } from "react";
import { useRouter } from "next/navigation";

import { FeatureCatalog } from "@/components/admin/feature-catalog";
import { FeatureDialog } from "@/components/admin/feature-dialog";
import { FeatureSwitchesPanel, type SwitchableFeature } from "@/components/admin/feature-switches-panel";
import { Callout } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { UnderlineTabs } from "@/components/ui/view-tabs";
import type { FeatureModuleGroup, FeatureModuleRow } from "@/lib/features/constants";
import { switchSummaryTitle, type FeatureSwitch, type SwitchReason } from "@/lib/features/killSwitchRules";

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

      {(() => {
        const all = groups.flatMap((group) => group.features);
        const live = all.filter((feature) => !feature.is_archived);
        const unsold = live.filter((feature) => feature.plan_reference_count + feature.addon_reference_count === 0).length;
        return (
          <StatStrip label="Features">
            <StatTile label="Features" value={live.length.toLocaleString("en-US")} footnote={`${(all.length - live.length).toLocaleString("en-US")} archived`} />
            <StatTile label="Modules" value={modules.length.toLocaleString("en-US")} footnote="groups in the catalog" />
            <StatTile label="In no plan or add-on" value={unsold.toLocaleString("en-US")} valueTone={unsold > 0 ? "warning" : undefined} footnote="not sold anywhere" />
            <StatTile label="Switched off" value={counts.off.toLocaleString("en-US")} valueTone={counts.off > 0 ? "danger" : undefined} footnote="for every customer" />
            <StatTile label="In beta" value={counts.beta.toLocaleString("en-US")} footnote={`of ${switchable.length.toLocaleString("en-US")} switchable`} />
          </StatStrip>
        );
      })()}

      {title && <Callout tone="warning" title={title} />}

      <UnderlineTabs
        label="Features"
        tabs={tabs.map((t) => ({ key: t.id, label: t.label }))}
        value={tab}
        onChange={setTab}
        idPrefix={`${baseId}-tab`}
        controls={(key) => `${baseId}-panel-${key}`}
      />

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

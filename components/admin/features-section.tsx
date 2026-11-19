"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { FeatureSheet } from "@/components/admin/catalog/feature-sheet";
import { FeatureCatalog, type CatalogFilters } from "@/components/admin/feature-catalog";
import { FeatureDialog } from "@/components/admin/feature-dialog";
import { FeatureSwitchesPanel, type SwitchableFeature, type SwitchFilters } from "@/components/admin/feature-switches-panel";
import { Button } from "@/components/ui/button";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { UnderlineTabs } from "@/components/ui/view-tabs";
import type { CatalogAuditItem } from "@/lib/adminCatalog/audit";
import type { FeatureModuleGroup, FeatureModuleRow, FeatureRow } from "@/lib/features/constants";
import type { FeatureGrant } from "@/lib/features/grants";
import { SWITCH_STATES, type FeatureSwitch, type SwitchReason, type SwitchState } from "@/lib/features/killSwitchRules";

type Tab = "catalog" | "switches";

/** The tab in the address, or the page's default (Switches when one is off or in beta). */
function useTab(defaultTab: Tab): Tab {
  const value = useSearchParams().get("tab");
  return value === "catalog" || value === "switches" ? value : defaultTab;
}

/**
 * Catalog | Switches on the title line (catalog.html screen 4), in the address (`?tab=`) so a link lands on the right
 * one; the page opens on Switches when one is off or in beta, the reason anyone opens it during an incident.
 */
export function FeatureTabs({ defaultTab, catalogCount, notOn }: { defaultTab: Tab; catalogCount: number; notOn: number }) {
  const tab = useTab(defaultTab);
  return (
    <UnderlineTabs
      label="Features"
      value={tab}
      onChange={(next) => setParamsInPlace({ tab: next, feature: null })}
      idPrefix="features-tab"
      controls="features-panel"
      tabs={[
        { key: "catalog", label: "Catalog", count: catalogCount },
        { key: "switches", label: "Switches", count: notOn > 0 ? notOn : null, tone: "danger" },
      ]}
    />
  );
}

/** New feature on the title line: the create dialog, then the page re-reads. */
export function FeatureNewButton({ modules }: { modules: FeatureModuleRow[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setCreating(true)}>New feature</Button>
      <FeatureDialog mode="create" open={creating} modules={modules} onClose={() => setCreating(false)} onSaved={() => router.refresh()} />
    </>
  );
}

/**
 * The Features page's body (admin round 1, catalog.html screen 4): the tab the address names, and the feature sheet.
 * Every filter lives in the address, written in place; a feature opens its sheet (`?feature=<key>`) at once with its
 * switch and what grants it, and its history arrives with the server's read.
 *
 * Naming a feature and taking it away from every paying customer are not the same act and do not share a permission:
 * the switch is changed by a super admin only, and platform config reads it.
 */
export function FeaturesSection({
  groups,
  modules,
  switchable,
  switches,
  reasons,
  grants,
  history,
  canToggle,
  canOpenPlans,
  defaultTab,
}: {
  groups: FeatureModuleGroup[];
  modules: FeatureModuleRow[];
  switchable: SwitchableFeature[];
  switches: FeatureSwitch[];
  reasons: Record<string, SwitchReason>;
  /** Null when the grants could not be read. */
  grants: Record<string, FeatureGrant[]> | null;
  /** The open feature's history, read on the server; items null when the read failed. */
  history: { key: string; items: CatalogAuditItem[] | null } | null;
  canToggle: boolean;
  canOpenPlans: boolean;
  defaultTab: Tab;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const tab = useTab(defaultTab);
  const [editing, setEditing] = useState<FeatureRow | null>(null);

  const refresh = useCallback(() => router.refresh(), [router]);
  const byKey = useMemo(() => new Map(switches.map((s) => [s.feature_key, s])), [switches]);
  const states = useMemo(() => Object.fromEntries(switches.map((s) => [s.feature_key, s.state])) as Record<string, SwitchState>, [switches]);
  const features = useMemo(() => new Map(groups.flatMap((group) => group.features.map((feature) => [feature.feature_key, feature] as const))), [groups]);
  const switchInfo = useMemo(() => new Map(switchable.map((item) => [item.featureKey, item])), [switchable]);

  const stateParam = params.get("state");
  const switchFilters: SwitchFilters = {
    q: params.get("q") ?? "",
    module: params.get("module") ?? "all",
    state: stateParam && (SWITCH_STATES as readonly string[]).includes(stateParam) ? (stateParam as SwitchState) : "all",
  };
  const catalogFilters: CatalogFilters = {
    q: switchFilters.q,
    module: switchFilters.module,
    archived: params.get("archived") === "1",
    sold: params.get("sold") === "none" ? "none" : "all",
  };
  const write = (patch: Record<string, string | boolean | undefined>) => {
    const out: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      out[key] = value === true ? "1" : value === false || value === "" || value === "all" ? null : value;
    }
    setParamsInPlace(out);
  };

  // The sheet opens (and closes) at once; the address follows. A local choice holds only while the address is still
  // the one it was made against, so Back and Forward always win. The history is a server read.
  const urlOpen = params.get("feature");
  const [asked, setAsked] = useState<{ key: string | null; against: string | null } | null>(null);
  const openKey = asked && asked.against === urlOpen ? asked.key : urlOpen;
  const openFeature = openKey ? features.get(openKey) ?? null : null;
  const open = (key: string) => {
    setAsked({ key, against: urlOpen });
    const next = new URLSearchParams(window.location.search);
    next.set("feature", key);
    router.replace(`?${next.toString()}`, { scroll: false });
  };
  const close = () => {
    setAsked({ key: null, against: urlOpen });
    setParamsInPlace({ feature: null });
  };

  return (
    <>
      <div role="tabpanel" id="features-panel" aria-labelledby={`features-tab-${tab}`} className="flex min-w-0 flex-col">
        {tab === "catalog" ? (
          <FeatureCatalog groups={groups} modules={modules} states={states} filters={catalogFilters} onFilters={write} onOpen={open} openKey={openKey} onRefresh={refresh} />
        ) : (
          <FeatureSwitchesPanel features={switchable} switches={Object.fromEntries(byKey)} reasons={reasons} modules={modules} canToggle={canToggle} filters={switchFilters} onFilters={write} onOpen={open} openKey={openKey} />
        )}
      </div>

      {openFeature && (
        <FeatureSheet
          key={openFeature.feature_key}
          feature={openFeature}
          moduleLabel={switchInfo.get(openFeature.feature_key)?.moduleLabel ?? openFeature.module}
          overrideCount={switchInfo.get(openFeature.feature_key)?.overrideCount ?? 0}
          featureSwitch={byKey.get(openFeature.feature_key)}
          reason={reasons[openFeature.feature_key]}
          grants={grants ? grants[openFeature.feature_key] ?? [] : null}
          canToggle={canToggle}
          canOpenPlans={canOpenPlans}
          history={history?.key === openFeature.feature_key ? history.items : undefined}
          historyLoading={urlOpen !== openKey}
          onEdit={() => setEditing(openFeature)}
          onClose={close}
        />
      )}

      <FeatureDialog
        key={`edit-${editing?.id ?? "none"}`}
        mode="edit"
        open={editing !== null}
        feature={editing}
        modules={modules}
        onClose={() => setEditing(null)}
        onSaved={refresh}
      />
    </>
  );
}

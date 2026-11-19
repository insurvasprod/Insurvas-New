"use client";

import Link from "next/link";
import { useState } from "react";

import { FeatureSwitchForm, SwitchDetail, SwitchStateChip } from "@/components/admin/feature-switches-panel";
import { Button } from "@/components/ui/button";
import { FactTable } from "@/components/ui/fact-table";
import { EmptyState } from "@/components/ui/page-states";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { UnderlineTabs } from "@/components/ui/view-tabs";
import type { CatalogAuditItem } from "@/lib/adminCatalog/audit";
import type { FeatureRow } from "@/lib/features/constants";
import type { FeatureGrant } from "@/lib/features/grants";
import type { FeatureSwitch, SwitchReason } from "@/lib/features/killSwitchRules";
import { cn } from "@/lib/utils";
import { AuditHistory } from "./plan-sheet";

type Part = "switch" | "granted" | "history";
const ROW = "flex min-h-11 min-w-0 items-center gap-3 border-b border-border px-4 py-2 text-sm last:border-b-0";

/**
 * One feature as a right sheet (admin round 1, catalog.html screen 4): Switch (its state, what agents see, why; a
 * super admin changes it here, platform config reads it), Granted by (the plan versions and add-ons behind its
 * reference counts, each opening its own sheet) and History (the audit log). Edit feature opens the same dialog as
 * the catalog's menu.
 */
export function FeatureSheet({
  feature,
  moduleLabel,
  overrideCount,
  featureSwitch,
  reason,
  grants,
  canToggle,
  canOpenPlans,
  history,
  historyLoading,
  onEdit,
  onClose,
}: {
  feature: FeatureRow;
  moduleLabel: string;
  overrideCount: number;
  featureSwitch: FeatureSwitch | undefined;
  reason: SwitchReason | undefined;
  /** Null when the grants could not be read. */
  grants: FeatureGrant[] | null;
  canToggle: boolean;
  /** Plans and add-ons open only for roles that may open those pages (platform config may not). */
  canOpenPlans: boolean;
  /** Undefined while the server read is on its way; null when it failed. */
  history: CatalogAuditItem[] | null | undefined;
  historyLoading: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const [part, setPart] = useState<Part>("switch");
  const [changing, setChanging] = useState(false);
  const state = featureSwitch?.state ?? "on";
  const sold = grants?.filter((grant) => !grant.retired) ?? [];

  const sections = (
    <UnderlineTabs
      label={`${feature.label} sections`}
      value={part}
      onChange={setPart}
      tabs={[
        { key: "switch", label: "Switch" },
        { key: "granted", label: "Granted by", count: grants ? grants.length : null },
        { key: "history", label: "History", count: history?.length ?? null },
      ]}
    />
  );

  return (
    <Sheet
      title={feature.label}
      subtitle={`${feature.feature_key} · ${moduleLabel}${feature.is_archived ? " · archived" : ""}`}
      status={<SwitchStateChip state={state} />}
      onClose={onClose}
      closeLabel="Close the feature"
      bodyClassName="flex flex-col"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onEdit}>Edit feature…</Button>
          <span className="flex-1" />
          <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="sticky top-0 z-10 bg-card px-4">{sections}</div>

      {part === "switch" && (
        <div className="flex flex-col gap-4 p-4">
          <FactTable
            rows={[
              ["State", state === "off" ? "Off for everyone" : state === "beta" ? "Named tenants only" : "On"],
              ["What agents see", <SwitchDetail key="detail" featureSwitch={featureSwitch} reason={reason} />],
              ["Agency overrides", overrideCount > 0 ? `${overrideCount} ${overrideCount === 1 ? "agency has" : "agencies have"} an override, either way` : "None"],
              ["Last changed", reason ? `${reason.changedAtUtc}${reason.changedBy ? ` by ${reason.changedBy}` : ""}` : "No change on record"],
            ]}
          />
          {grants && (
            <p className="m-0 text-xs leading-[1.5] text-muted-foreground">
              {sold.length === 0
                ? "No live plan or add-on grants it, so nobody can buy it."
                : `Granted by ${sold.slice(0, 3).map((grant) => grant.label).join(", ")}${sold.length > 3 ? ` and ${sold.length - 3} more` : ""}. A switch beats every grant: switching off hides it from all of them at once.`}
            </p>
          )}
          {canToggle ? (
            changing ? (
              <section className="flex flex-col gap-3 rounded-lg border border-border p-4" aria-label={`Change the switch on ${feature.label}`}>
                <FeatureSwitchForm featureKey={feature.feature_key} current={featureSwitch} onSaved={() => setChanging(false)} onCancel={() => setChanging(false)} />
              </section>
            ) : (
              <div>
                <Button type="button" onClick={() => setChanging(true)}>Change the switch…</Button>
              </div>
            )
          ) : (
            <p className="m-0 text-xs text-muted-foreground">Read-only. Only a super admin can change a kill switch.</p>
          )}
        </div>
      )}

      {part === "granted" && (
        grants === null ? (
          <EmptyState title="Who grants it could not be read" hint="Reload the page; if it keeps failing, the error is in the server log." />
        ) : grants.length === 0 ? (
          <EmptyState title="In no plan or add-on" hint="Nobody can buy it until a plan version or an add-on grants it. Tick it in a plan's editor or an add-on." />
        ) : (
          <ul className="m-0 list-none p-0" aria-label={`What grants ${feature.label}`}>
            {grants.map((grant) => {
              const href = grant.kind === "plan" ? `/admin/plans?plan=${grant.id}` : `/admin/addons?addon=${grant.id}`;
              const body = (
                <>
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">{grant.label}</span>
                  <span className="w-20 shrink-0 text-muted-foreground">{grant.kind === "plan" ? "Plan" : "Add-on"}</span>
                  {grant.retired
                    ? <StatusChip tone="neutral">{grant.kind === "plan" ? "Archived" : "Retired"}</StatusChip>
                    : grant.kind === "plan" && !grant.latest
                      ? <StatusChip tone="neutral">Older version</StatusChip>
                      : <StatusChip tone="good" dot>Sold</StatusChip>}
                </>
              );
              return (
                <li key={`${grant.kind}-${grant.id}`}>
                  {canOpenPlans ? <Link href={href} className={cn(ROW, "no-underline hover:bg-[var(--hover-wash)]")}>{body}</Link> : <div className={ROW}>{body}</div>}
                </li>
              );
            })}
          </ul>
        )
      )}

      {part === "history" && (
        historyLoading || history === undefined ? (
          <div role="status" aria-live="polite" className="flex flex-col gap-3 p-4">
            <span className="sr-only">Loading the history</span>
            {Array.from({ length: 4 }, (_, i) => <span key={i} aria-hidden="true" className="m-skel h-6 w-full rounded-md" />)}
          </div>
        ) : (
          <AuditHistory items={history} empty="Creating, editing, archiving and switching this feature is recorded here." />
        )
      )}
    </Sheet>
  );
}

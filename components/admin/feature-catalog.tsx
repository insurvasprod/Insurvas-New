"use client";

import { Fragment, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { NoMatches } from "@/components/ui/page-states";
import { Pager } from "@/components/ui/pager";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FeatureModuleGroup, FeatureModuleRow, FeatureRow } from "@/lib/features/constants";
import type { SwitchState } from "@/lib/features/killSwitchRules";
import { cn } from "@/lib/utils";
import { tableHeaderRow, tableHeadCell } from "./table-styles";
import { FeatureDialog } from "./feature-dialog";
import { SwitchStateChip } from "./feature-switches-panel";

export type CatalogFilters = { q: string; module: string; archived: boolean; sold: "all" | "none" };

/**
 * The Catalog tab (admin round 1, catalog.html screen 4): grouped by module — feature, key, description,
 * references and its switch state — with search, module, archived and "in no plan or add-on" (all in the address,
 * owned by FeaturesSection). A row opens the feature's sheet; the ⋯ menu keeps Edit, Archive and Restore.
 */
export function FeatureCatalog({
  groups,
  modules,
  states,
  filters,
  onFilters,
  onOpen,
  openKey,
  onRefresh,
}: {
  groups: FeatureModuleGroup[];
  modules: FeatureModuleRow[];
  /** Each feature's switch state, keyed by feature key; a missing key is on. */
  states: Record<string, SwitchState>;
  filters: CatalogFilters;
  onFilters: (patch: Partial<CatalogFilters>) => void;
  onOpen: (featureKey: string) => void;
  openKey: string | null;
  /** Re-reads the catalog (and the switch list beside it) after an edit, archive or restore. */
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState<FeatureRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const refresh = onRefresh;
  const showArchived = filters.archived;

  async function setArchived(feature: FeatureRow, is_archived: boolean) {
    setPendingId(feature.id);
    const res = await fetch(`/api/admin/features/${feature.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_archived }),
    });
    setPendingId(null);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      notify.block(body?.error ?? "Could not update the feature");
      return;
    }

    notify.done(`${feature.label} ${is_archived ? "archived" : "restored"}`);
    refresh();
  }

  const totalActive = groups.reduce((n, g) => n + g.features.filter((f) => !f.is_archived).length, 0);
  const totalArchived = groups.reduce((n, g) => n + g.features.filter((f) => f.is_archived).length, 0);
  const normalizedQuery = filters.q.trim().toLowerCase();
  const narrowed = normalizedQuery !== "" || filters.sold === "none";
  const filteredGroups = groups
    .filter((group) => filters.module === "all" || group.module.key === filters.module)
    .map((group) => ({
      ...group,
      features: group.features.filter((feature) => {
        if (filters.sold === "none" && feature.plan_reference_count + feature.addon_reference_count > 0) return false;
        if (!normalizedQuery) return true;
        return [feature.label, feature.feature_key, feature.description ?? ""].some((value) =>
          value.toLowerCase().includes(normalizedQuery),
        );
      }),
    }))
    // Keep the intentionally empty Agency section visible in the normal catalog, but do not
    // make a search result feel broken by rendering eight empty tables around one match.
    .filter((group) => !narrowed || group.features.length > 0);

  const shown = filteredGroups.reduce((n, group) => n + group.features.filter((f) => !f.is_archived).length, 0);

  // Paged by feature row, as many as the window holds (10 at most), across the module groups: a group
  // split by a page boundary repeats its module row at the top of the next page, so every row still
  // sits under its module.
  const pageSize = useFittingPageSize(480, 45);
  const listed = filteredGroups.map((group) => ({
    group,
    visible: showArchived ? group.features : group.features.filter((f) => !f.is_archived),
  }));
  const rowTotal = listed.reduce((n, entry) => n + entry.visible.length, 0);
  const pages = Math.max(1, Math.ceil(rowTotal / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  const pageStart = (current - 1) * pageSize;
  const pageEnd = pageStart + pageSize;
  // Each group's first row's position in the whole list.
  const starts = listed.reduce<number[]>((acc, entry, index) => [...acc, index === 0 ? 0 : acc[index - 1] + listed[index - 1].visible.length], []);
  const onPage = listed.flatMap(({ group, visible }, index) => {
    const from = starts[index];
    // An empty module shows on the page where it falls in the order (the last page if at the end).
    if (visible.length === 0) return from >= pageStart && (from < pageEnd || current === pages) ? [{ group, visible }] : [];
    const rows = visible.filter((_, index) => from + index >= pageStart && from + index < pageEnd);
    return rows.length > 0 ? [{ group, visible: rows }] : [];
  });
  const filter = (patch: Partial<CatalogFilters>) => { onFilters(patch); setPage(1); };
  const clear = () => filter({ q: "", module: "all", sold: "all" });

  return (
    <div className="space-y-4">
      <TableCard
        toolbar={
          <DataToolbar
            actions={
              <>
                {totalArchived > 0 && (
                  <Button type="button" variant="outline" onClick={() => filter({ archived: !showArchived })}>
                    {showArchived ? "Hide archived" : "Show archived"}
                  </Button>
                )}
                <RefreshButton onClick={refresh} />
              </>
            }
          >
            <ToolbarSearch value={filters.q} onChange={(value) => filter({ q: value })} placeholder="Search features or keys" label="Search features" />
            <select
              id="feature-module-filter"
              aria-label="Filter by module"
              value={filters.module}
              onChange={(event) => filter({ module: event.target.value })}
              className={toolbarControl}
            >
              <option value="all">All modules</option>
              {modules.map((module) => <option key={module.key} value={module.key}>{module.label}</option>)}
            </select>
            <select aria-label="Sold in" value={filters.sold} onChange={(event) => filter({ sold: event.target.value as CatalogFilters["sold"] })} className={toolbarControl}>
              <option value="all">Sold or not</option>
              <option value="none">In no plan or add-on</option>
            </select>
            <span className="text-xs text-muted-foreground tabular-nums">
              {shown} shown · {totalActive} active
              {totalArchived > 0 && ` · ${totalArchived} archived`}
            </span>
          </DataToolbar>
        }
        footer={rowTotal > 0 ? <Pager page={current} pageSize={pageSize} total={rowTotal} noun="features" onPage={setPage} /> : undefined}
      >
        {filteredGroups.length === 0 ? (
          <NoMatches noun="features" onClear={clear} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className={tableHeaderRow}>
                <TableHead className={tableHeadCell}>Feature</TableHead>
                <TableHead className={tableHeadCell}>Key</TableHead>
                <TableHead className={tableHeadCell}>Description</TableHead>
                <TableHead className={tableHeadCell}>References</TableHead>
                <TableHead className={tableHeadCell}>State</TableHead>
                <TableHead className={`${tableHeadCell} w-10`} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {onPage.map(({ group, visible }) => {
                return (
                  <Fragment key={group.module.key}>
                    <TableRow className="bg-[var(--canvas)] hover:bg-[var(--canvas)]">
                      <TableCell colSpan={6} className="py-2">
                        <span className="text-sm font-semibold text-foreground">{group.module.label}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{group.module.key}</span>
                      </TableCell>
                    </TableRow>
                    {visible.length === 0 && (
                      <TableRow>
                        {/* The 'agency' module is seeded deliberately empty. */}
                        <TableCell colSpan={6} className="text-sm text-muted-foreground">
                          No features in this module yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {visible.map((feature) => (
                      <TableRow
                        key={feature.id}
                        onClick={() => onOpen(feature.feature_key)}
                        className={cn("cursor-pointer hover:bg-[var(--hover-wash)]", openKey === feature.feature_key && "bg-[var(--hover-wash)]", feature.is_archived && "opacity-55")}
                      >
                        <TableCell className="font-medium">
                          <button
                            type="button"
                            onClick={(event) => { event.stopPropagation(); onOpen(feature.feature_key); }}
                            className="cursor-pointer rounded-[4px] text-left text-inherit hover:text-[var(--accent-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                          >
                            {feature.label}
                          </button>
                          {feature.is_archived && <span className="ml-2 text-xs font-normal text-muted-foreground">archived</span>}
                        </TableCell>
                        <TableCell>
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{feature.feature_key}</code>
                        </TableCell>
                        <TableCell className="max-w-[280px] truncate text-muted-foreground">
                          {feature.description ?? "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          <span title={`${feature.plan_reference_count} plan references · ${feature.addon_reference_count} add-on references`}>
                            {feature.plan_reference_count + feature.addon_reference_count === 0 ? "In no plan or add-on" : `${feature.plan_reference_count} plans · ${feature.addon_reference_count} add-ons`}
                          </span>
                        </TableCell>
                        <TableCell>
                          <SwitchStateChip state={states[feature.feature_key] ?? "on"} />
                        </TableCell>
                        <TableCell onClick={(event) => event.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" disabled={pendingId === feature.id}>
                                <MoreHorizontal />
                                <span className="sr-only">Actions for {feature.label}</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => onOpen(feature.feature_key)}>Open</DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  setEditing(feature);
                                  setEditOpen(true);
                                }}
                              >
                                Edit
                              </DropdownMenuItem>
                              {feature.is_archived ? (
                                <DropdownMenuItem onSelect={() => setArchived(feature, false)}>
                                  Restore
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem variant="destructive" onSelect={() => setArchived(feature, true)}>
                                  Archive
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableCard>

      <FeatureDialog
        key={`edit-${editing?.id ?? "none"}`}
        mode="edit"
        open={editOpen}
        feature={editing}
        modules={modules}
        onClose={() => setEditOpen(false)}
        onSaved={refresh}
      />
    </div>
  );
}

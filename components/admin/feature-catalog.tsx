"use client";

import { Fragment, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { notify } from "@/lib/notify";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { NoMatches } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
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
import { tableHeaderRow, tableHeadCell } from "./table-styles";
import { FeatureDialog } from "./feature-dialog";

/**
 * The catalog tab. The groups are owned by FeaturesSection, because "New feature" lives in the page
 * header (board p-adm-features) and a feature created from the Switches tab has to land here too.
 */
export function FeatureCatalog({
  groups,
  modules,
  onRefresh,
}: {
  groups: FeatureModuleGroup[];
  modules: FeatureModuleRow[];
  /** Re-reads the catalog (and the switch list beside it) after an edit, archive or restore. */
  onRefresh: () => void;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<FeatureRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const refresh = onRefresh;

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
  const normalizedQuery = query.trim().toLowerCase();
  const filteredGroups = groups
    .filter((group) => moduleFilter === "all" || group.module.key === moduleFilter)
    .map((group) => ({
      ...group,
      features: group.features.filter((feature) => {
        if (!normalizedQuery) return true;
        return [feature.label, feature.feature_key, feature.description ?? ""].some((value) =>
          value.toLowerCase().includes(normalizedQuery),
        );
      }),
    }))
    // Keep the intentionally empty Agency section visible in the normal catalog, but do not
    // make a search result feel broken by rendering eight empty tables around one match.
    .filter((group) => !normalizedQuery || group.features.length > 0);

  const shown = filteredGroups.reduce((n, group) => n + group.features.filter((f) => !f.is_archived).length, 0);

  return (
    <div className="space-y-4">
      <TableCard
        toolbar={
          <DataToolbar
            actions={
              <>
                {totalArchived > 0 && (
                  <Button type="button" variant="outline" onClick={() => setShowArchived((v) => !v)}>
                    {showArchived ? "Hide archived" : "Show archived"}
                  </Button>
                )}
                <RefreshButton onClick={refresh} />
              </>
            }
          >
            <ToolbarSearch value={query} onChange={setQuery} placeholder="Search features or keys" label="Search features" />
            <select
              id="feature-module-filter"
              aria-label="Filter by module"
              value={moduleFilter}
              onChange={(event) => setModuleFilter(event.target.value)}
              className={toolbarControl}
            >
              <option value="all">All modules</option>
              {modules.map((module) => <option key={module.key} value={module.key}>{module.label}</option>)}
            </select>
            <span className="text-xs text-muted-foreground tabular-nums">
              {shown} shown · {totalActive} active
              {totalArchived > 0 && ` · ${totalArchived} archived`}
            </span>
          </DataToolbar>
        }
      >
        {filteredGroups.length === 0 ? (
          <NoMatches
            noun="features"
            onClear={() => {
              setQuery("");
              setModuleFilter("all");
            }}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className={tableHeaderRow}>
                <TableHead className={tableHeadCell}>Feature</TableHead>
                <TableHead className={tableHeadCell}>Key</TableHead>
                <TableHead className={tableHeadCell}>Description</TableHead>
                <TableHead className={tableHeadCell}>References</TableHead>
                <TableHead className={`${tableHeadCell} w-10`} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredGroups.map((group) => {
                const visible = showArchived ? group.features : group.features.filter((f) => !f.is_archived);
                return (
                  <Fragment key={group.module.key}>
                    <TableRow className="bg-[var(--canvas)] hover:bg-[var(--canvas)]">
                      <TableCell colSpan={5} className="py-2">
                        <span className="text-sm font-semibold text-foreground">{group.module.label}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{group.module.key}</span>
                      </TableCell>
                    </TableRow>
                    {visible.length === 0 && (
                      <TableRow>
                        {/* The 'agency' module is seeded deliberately empty. */}
                        <TableCell colSpan={5} className="text-sm text-muted-foreground">
                          No features in this module yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {visible.map((feature) => (
                      <TableRow key={feature.id} className={feature.is_archived ? "opacity-55" : undefined}>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            {feature.label}
                            {feature.is_archived && (
                              <Badge variant="outline" className="border-transparent bg-muted text-muted-foreground">
                                Archived
                              </Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{feature.feature_key}</code>
                        </TableCell>
                        <TableCell className="max-w-[280px] truncate text-muted-foreground">
                          {feature.description ?? "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          <span title={`${feature.plan_reference_count} plan references · ${feature.addon_reference_count} add-on references`}>
                            {feature.plan_reference_count} plans · {feature.addon_reference_count} add-ons
                          </span>
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" disabled={pendingId === feature.id}>
                                <MoreHorizontal />
                                <span className="sr-only">Actions</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
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

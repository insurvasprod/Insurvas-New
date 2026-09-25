"use client";

import { useState } from "react";
import { MoreHorizontal, Search } from "lucide-react";
import { notify } from "@/lib/notify";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/page-states";
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
import { tableHeaderRow, tableHeadCell, tableShell } from "./table-styles";
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search features"
            placeholder="Search features or keys"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
          />
        </div>
        <label className="sr-only" htmlFor="feature-module-filter">Filter by module</label>
        <select
          id="feature-module-filter"
          aria-label="Filter by module"
          value={moduleFilter}
          onChange={(event) => setModuleFilter(event.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          <option value="all">All modules</option>
          {modules.map((module) => <option key={module.key} value={module.key}>{module.label}</option>)}
        </select>
        <p className="text-sm text-muted-foreground">
          {filteredGroups.reduce((n, group) => n + group.features.filter((f) => !f.is_archived).length, 0)} shown · {totalActive} active
          {totalArchived > 0 && ` · ${totalArchived} archived`}
        </p>
        {totalArchived > 0 && (
          <Button variant="outline" size="sm" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "Hide archived" : "Show archived"}
          </Button>
        )}
      </div>

      {filteredGroups.map((group) => {
        const visible = showArchived ? group.features : group.features.filter((f) => !f.is_archived);

        return (
          <div key={group.module.key} className="space-y-2">
            <div className="flex items-baseline gap-2">
              <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em]">
                {group.module.label}
              </h2>
              <span className="text-xs text-muted-foreground">{group.module.key}</span>
            </div>

            <div className={tableShell}>
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
                  {visible.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="p-0">
                        {/* The 'agency' module is seeded deliberately empty. */}
                        <EmptyState
                          title="No features in this module yet"
                          hint="A feature here is what a plan can switch on. Until one exists, nothing in this module can be sold or gated."
                        />
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
                </TableBody>
              </Table>
            </div>
          </div>
        );
      })}

      {filteredGroups.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No features match the current search and module filter.
        </div>
      )}

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

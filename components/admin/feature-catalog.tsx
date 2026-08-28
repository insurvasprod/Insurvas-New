"use client";

import { useCallback, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export function FeatureCatalog({
  initialGroups,
  modules,
}: {
  initialGroups: FeatureModuleGroup[];
  modules: FeatureModuleRow[];
}) {
  const [groups, setGroups] = useState(initialGroups);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<FeatureRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/features");
    if (res.ok) {
      const body = await res.json();
      setGroups(body.groups);
    }
  }, []);

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
      toast.error(body?.error ?? "Could not update the feature");
      return;
    }

    toast.success(`${feature.label} ${is_archived ? "archived" : "restored"}`);
    refresh();
  }

  const totalActive = groups.reduce((n, g) => n + g.features.filter((f) => !f.is_archived).length, 0);
  const totalArchived = groups.reduce((n, g) => n + g.features.filter((f) => f.is_archived).length, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          {totalActive} active
          {totalArchived > 0 && ` · ${totalArchived} archived`}
        </p>
        {totalArchived > 0 && (
          <Button variant="outline" size="sm" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "Hide archived" : "Show archived"}
          </Button>
        )}
        <div className="ml-auto">
          <Button size="sm" onClick={() => setCreating(true)}>
            New feature
          </Button>
        </div>
      </div>

      {groups.map((group) => {
        const visible = showArchived ? group.features : group.features.filter((f) => !f.is_archived);

        return (
          <div key={group.module.key} className="space-y-2">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand-700)]">
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
                    <TableHead className={`${tableHeadCell} w-10`} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="h-16 text-center text-sm text-muted-foreground">
                        {/* The 'agency' module is seeded deliberately empty. */}
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

      <FeatureDialog
        mode="create"
        open={creating}
        modules={modules}
        onClose={() => setCreating(false)}
        onSaved={refresh}
      />

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

"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { PLAN_TYPE_LABELS, type PlanListRow } from "@/lib/plans/constants";
import {
  availableBillingCycles,
  formatCentsAsCurrency,
  priceForCycle,
  type PlanPrices,
} from "@/lib/money";
import { tableHeaderRow, tableHeadCell, tableShell } from "./table-styles";
import { PlanDialog } from "./plan-dialog";

/** Shows the cheapest-cycle price, with the other offered cycles noted on hover. */
function PriceCell({ prices }: { prices: PlanPrices | null }) {
  const cycles = availableBillingCycles(prices);

  if (cycles.length === 0) {
    return <span className="text-[var(--color-warning)]">Not sellable</span>;
  }

  const primary = cycles[0];
  const cents = priceForCycle(prices, primary);

  return (
    <span title={cycles.map((c) => `${c}: ${formatCentsAsCurrency(priceForCycle(prices, c) ?? 0)}`).join(" · ")}>
      {formatCentsAsCurrency(cents ?? 0)}
      <span className="text-xs"> /{primary === "monthly" ? "mo" : primary === "quarterly" ? "qtr" : "yr"}</span>
      {cycles.length > 1 && <span className="text-xs"> +{cycles.length - 1}</span>}
    </span>
  );
}

export function PlansTable({
  initialPlans,
  prices,
}: {
  initialPlans: PlanListRow[];
  /** Keyed by plan id. A missing entry means pricing was never set — the plan isn't sellable. */
  prices: Record<string, PlanPrices>;
}) {
  const [plans, setPlans] = useState(initialPlans);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PlanListRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/plans");
    if (res.ok) {
      const body = await res.json();
      setPlans(body.plans);
    }
  }, []);

  async function setArchived(plan: PlanListRow, is_archived: boolean) {
    setPendingId(plan.id);
    const res = await fetch(`/api/admin/plans/${plan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: plan.code,
        name: plan.name,
        description: plan.description ?? "",
        is_public: plan.is_public,
        is_archived,
        sort_order: plan.sort_order,
      }),
    });
    setPendingId(null);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast.error(body?.error ?? "Could not update the plan");
      return;
    }

    toast.success(`${plan.name} ${is_archived ? "archived" : "restored"}`);
    refresh();
  }

  async function newVersion(plan: PlanListRow) {
    setPendingId(plan.id);
    const res = await fetch(`/api/admin/plans/${plan.id}/new-version`, { method: "POST" });
    const body = await res.json().catch(() => null);
    setPendingId(null);

    if (!res.ok) {
      toast.error(body?.error ?? "Could not create a new version");
      return;
    }

    toast.success(`${plan.name} v${body.plan?.version} published — existing subscribers stay on v${plan.version}`);
    refresh();
  }

  async function remove(plan: PlanListRow) {
    setPendingId(plan.id);
    const res = await fetch(`/api/admin/plans/${plan.id}`, { method: "DELETE" });
    const body = await res.json().catch(() => null);
    setPendingId(null);

    if (!res.ok) {
      toast.error(body?.error ?? "Could not delete the plan");
      return;
    }

    toast.success(`${plan.name} deleted`);
    refresh();
  }

  const visible = showArchived ? plans : plans.filter((p) => !p.is_archived);
  const archivedCount = plans.filter((p) => p.is_archived).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          {plans.length - archivedCount} active
          {archivedCount > 0 && ` · ${archivedCount} archived`}
        </p>
        {archivedCount > 0 && (
          <Button variant="outline" size="sm" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "Hide archived" : "Show archived"}
          </Button>
        )}
        <div className="ml-auto">
          <Button size="sm" onClick={() => setCreating(true)}>
            New plan
          </Button>
        </div>
      </div>

      <div className={tableShell}>
        <Table>
          <TableHeader>
            <TableRow className={tableHeaderRow}>
              <TableHead className={tableHeadCell}>Code</TableHead>
              <TableHead className={tableHeadCell}>Name</TableHead>
              <TableHead className={tableHeadCell}>Type</TableHead>
              <TableHead className={tableHeadCell}>Price</TableHead>
              <TableHead className={tableHeadCell}>Subscribers</TableHead>
              <TableHead className={tableHeadCell}>Status</TableHead>
              <TableHead className={`${tableHeadCell} w-10`} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  No plans yet.
                </TableCell>
              </TableRow>
            )}
            {visible.map((plan) => (
              <TableRow key={plan.id} className={plan.is_archived ? "opacity-55" : undefined}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{plan.code}</code>
                    <Badge variant="outline" className="text-[10px]" title={`${plan.version_count} version(s)`}>
                      v{plan.version}
                    </Badge>
                  </span>
                </TableCell>
                <TableCell className="font-medium">{plan.name}</TableCell>
                <TableCell className="text-muted-foreground">{PLAN_TYPE_LABELS[plan.plan_type]}</TableCell>
                <TableCell className="text-muted-foreground">
                  <PriceCell prices={prices[plan.id] ?? null} />
                </TableCell>
                <TableCell className="text-muted-foreground">{plan.subscriber_count}</TableCell>
                <TableCell>
                  {plan.is_archived ? (
                    <Badge variant="outline" className="border-transparent bg-muted text-muted-foreground">
                      Archived
                    </Badge>
                  ) : plan.is_public ? (
                    <Badge
                      variant="outline"
                      className="border-transparent bg-[var(--color-success)]/10 text-[var(--color-success)]"
                    >
                      Public
                    </Badge>
                  ) : (
                    <Badge variant="outline">Private</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" disabled={pendingId === plan.id}>
                        <MoreHorizontal />
                        <span className="sr-only">Actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/admin/plans/${plan.id}/edit`}>Edit features & pricing</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => {
                          setEditing(plan);
                          setEditOpen(true);
                        }}
                      >
                        Edit details
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => newVersion(plan)}>Publish new version</DropdownMenuItem>

                      <DropdownMenuSeparator />

                      {plan.is_archived ? (
                        <DropdownMenuItem onSelect={() => setArchived(plan, false)}>Restore</DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem variant="destructive" onSelect={() => setArchived(plan, true)}>
                          Archive
                        </DropdownMenuItem>
                      )}

                      {/* Delete is only offered for a plan nobody has ever been on — anything
                          else must be archived, and the API refuses it regardless. */}
                      {plan.ever_subscribed_count === 0 && (
                        <DropdownMenuItem variant="destructive" onSelect={() => remove(plan)}>
                          Delete
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

      <PlanDialog mode="create" open={creating} onClose={() => setCreating(false)} onSaved={refresh} />

      <PlanDialog
        key={`edit-${editing?.id ?? "none"}`}
        mode="edit"
        open={editOpen}
        plan={editing}
        onClose={() => setEditOpen(false)}
        onSaved={refresh}
      />
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABELS,
  type SubscriptionStatus,
} from "@/lib/subscriptions/access";
import { BILLING_CYCLE_LABELS } from "@/lib/money";
import type { SubscriptionRow } from "@/lib/subscriptions/queries";
import { tableHeaderRow, tableHeadCell, tableShell } from "./table-styles";
import { EmptyState, NoMatches } from "@/components/admin/empty-state";
import { StatusChip, subscriptionTone } from "@/components/admin/status-chip";

export function SubscriptionsTable({
  initialSubscriptions,
  plans,
}: {
  initialSubscriptions: SubscriptionRow[];
  plans: { id: string; name: string; version: number }[];
}) {
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions);
  const [status, setStatus] = useState<"all" | SubscriptionStatus>("all");
  const [planId, setPlanId] = useState("all");
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }

    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (planId !== "all") params.set("planId", planId);

    let cancelled = false;
    fetch(`/api/admin/subscriptions?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body) setSubscriptions(body.subscriptions);
      });

    return () => {
      cancelled = true;
    };
  }, [status, planId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={status} onValueChange={(v) => setStatus(v as "all" | SubscriptionStatus)}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {SUBSCRIPTION_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {SUBSCRIPTION_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={planId} onValueChange={setPlanId}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Plan" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All plans</SelectItem>
            {plans.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name} v{p.version}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className={tableShell}>
        <Table>
          <TableHeader>
            <TableRow className={tableHeaderRow}>
              <TableHead className={tableHeadCell}>Tenant</TableHead>
              <TableHead className={tableHeadCell}>Plan</TableHead>
              <TableHead className={tableHeadCell}>Cycle</TableHead>
              <TableHead className={tableHeadCell}>Status</TableHead>
              <TableHead className={tableHeadCell}>Period ends</TableHead>
              <TableHead className={tableHeadCell}>Queued change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subscriptions.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="p-0">
                  {status === "all" && planId === "all" ? (
                    <EmptyState
                      title="No subscriptions yet"
                      hint="A subscription is what puts a tenant on a plan and starts their billing period. Assign one from a tenant's page."
                    />
                  ) : (
                    <NoMatches
                      noun="subscriptions"
                      onClear={() => { setStatus("all"); setPlanId("all"); }}
                    />
                  )}
                </TableCell>
              </TableRow>
            )}
            {subscriptions.map((sub) => (
              <TableRow key={sub.id}>
                <TableCell className="font-medium">
                  <Link href={`/admin/tenants/${sub.tenant_id}`} className="hover:underline">
                    {sub.tenant_name ?? sub.tenant_id}
                  </Link>
                </TableCell>
                <TableCell>
                  {sub.plan_name} <span className="text-xs text-muted-foreground">v{sub.plan_version}</span>
                </TableCell>
                <TableCell className="text-muted-foreground">{BILLING_CYCLE_LABELS[sub.billing_cycle]}</TableCell>
                <TableCell>
                  <StatusChip tone={subscriptionTone(sub.status)} dot>
                    {SUBSCRIPTION_STATUS_LABELS[sub.status]}
                  </StatusChip>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString() : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {sub.cancel_at_period_end ? (
                    <span className="text-[var(--color-danger)]">Cancelling</span>
                  ) : sub.pending_plan_name ? (
                    `→ ${sub.pending_plan_name}`
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

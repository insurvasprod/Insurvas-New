"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SUBSCRIPTION_STATUS_BADGE_CLASS,
  SUBSCRIPTION_STATUS_LABELS,
  accessLevelForStatus,
  availableActions,
} from "@/lib/subscriptions/access";
import {
  BILLING_CYCLE_LABELS,
  availableBillingCycles,
  formatCentsAsCurrency,
  priceForCycle,
  type BillingCycle,
  type PlanPrices,
} from "@/lib/money";
import type { SubscriptionRow } from "@/lib/subscriptions/queries";

export type AssignablePlan = {
  id: string;
  code: string;
  name: string;
  version: number;
  prices: PlanPrices | null;
};

const ACCESS_NOTE: Record<ReturnType<typeof accessLevelForStatus>, string> = {
  full: "Full access to everything their plan grants.",
  read_only:
    "Read-only: they can still open their book of business, but cannot dial, import or sell. Suspend the doing, preserve the seeing.",
  none: "No access.",
};

export function SubscriptionPanel({
  tenantId,
  subscription,
  plans,
}: {
  tenantId: string;
  subscription: SubscriptionRow | null;
  plans: AssignablePlan[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  async function post(url: string, body: unknown, successMessage: string) {
    setBusy(true);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => null);
    setBusy(false);

    if (!res.ok) {
      toast.error(payload?.error ?? "Something went wrong");
      return null;
    }

    toast.success(successMessage);
    router.refresh();
    return payload;
  }

  if (!subscription) {
    return (
      <>
        <Card>
          <CardContent className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--color-accent-ink)]">Subscription</h2>
            <p className="text-sm text-muted-foreground">
              Nothing sold to this tenant yet — no plan, no allowances, no seat limit.
            </p>
            <Button size="sm" onClick={() => setAssignOpen(true)}>
              Assign a plan
            </Button>
          </CardContent>
        </Card>

        <AssignDialog
          open={assignOpen}
          onClose={() => setAssignOpen(false)}
          plans={plans}
          busy={busy}
          onAssign={(planId, cycle) =>
            post("/api/admin/subscriptions", { tenant_id: tenantId, plan_id: planId, billing_cycle: cycle }, "Plan assigned").then(
              (ok) => {
                if (ok) setAssignOpen(false);
              },
            )
          }
        />
      </>
    );
  }

  const status = subscription.status;
  const actions = availableActions(status);
  const access = accessLevelForStatus(status);

  return (
    <>
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--color-accent-ink)]">Subscription</h2>
            <Badge variant="outline" className={SUBSCRIPTION_STATUS_BADGE_CLASS[status]}>
              {SUBSCRIPTION_STATUS_LABELS[status]}
            </Badge>
          </div>

          {access !== "full" && (
            <div className="flex items-start gap-2 rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--color-warning)]" />
              <p>{ACCESS_NOTE[access]}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-sm">
            <div>
              <p className="text-muted-foreground">Plan</p>
              <p className="font-medium">
                {subscription.plan_name} <span className="text-xs">v{subscription.plan_version}</span>
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Billing</p>
              <p className="font-medium">{BILLING_CYCLE_LABELS[subscription.billing_cycle]}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Period ends</p>
              <p className="font-medium">
                {subscription.current_period_end
                  ? new Date(subscription.current_period_end).toLocaleDateString()
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Trial ends</p>
              <p className="font-medium">
                {subscription.trial_ends_at ? new Date(subscription.trial_ends_at).toLocaleDateString() : "—"}
              </p>
            </div>
          </div>

          {/* A queued change must be visible and dated — SA-2.7 is explicit about labelling it. */}
          {subscription.pending_plan_name && (
            <p className="rounded-md bg-muted px-3 py-2 text-sm">
              Moving to <span className="font-medium">{subscription.pending_plan_name}</span> — takes effect{" "}
              <span className="font-medium">
                {subscription.current_period_end
                  ? new Date(subscription.current_period_end).toLocaleDateString()
                  : "at period end"}
              </span>
            </p>
          )}
          {subscription.cancel_at_period_end && (
            <p className="rounded-md bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
              Cancelling — ends{" "}
              {subscription.current_period_end
                ? new Date(subscription.current_period_end).toLocaleDateString()
                : "at period end"}
              {subscription.cancel_reason && ` · ${subscription.cancel_reason}`}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {actions.canChangePlan && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setChangeOpen(true)}>
                Change plan
              </Button>
            )}
            {actions.canPause && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  post(
                    `/api/admin/subscriptions/${subscription.id}`,
                    { action: "pause", reason: "Paused by administrator" },
                    "Subscription paused",
                  )
                }
              >
                Pause
              </Button>
            )}
            {actions.canResume && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  post(`/api/admin/subscriptions/${subscription.id}`, { action: "resume" }, "Subscription resumed")
                }
              >
                Resume
              </Button>
            )}
            {actions.canCancel && !subscription.cancel_at_period_end && (
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => setCancelOpen(true)}>
                Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <ChangePlanDialog
        open={changeOpen}
        onClose={() => setChangeOpen(false)}
        plans={plans.filter((p) => p.id !== subscription.plan_id)}
        cycle={subscription.billing_cycle}
        currentPrice={
          plans.find((p) => p.id === subscription.plan_id)?.prices
            ? priceForCycle(plans.find((p) => p.id === subscription.plan_id)!.prices, subscription.billing_cycle)
            : null
        }
        periodEnd={subscription.current_period_end}
        busy={busy}
        onChange={(planId, applyNow) =>
          post(
            `/api/admin/subscriptions/${subscription.id}`,
            { action: "change_plan", plan_id: planId, apply_now: applyNow },
            applyNow ? "Plan changed" : "Plan change queued for period end",
          ).then((ok) => {
            if (ok) setChangeOpen(false);
          })
        }
      />

      <CancelDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        periodEnd={subscription.current_period_end}
        busy={busy}
        onCancel={(reason, immediate) =>
          post(
            `/api/admin/subscriptions/${subscription.id}`,
            { action: "cancel", reason, immediate },
            immediate ? "Subscription cancelled" : "Cancellation queued for period end",
          ).then((ok) => {
            if (ok) setCancelOpen(false);
          })
        }
      />
    </>
  );
}

function AssignDialog({
  open,
  onClose,
  plans,
  busy,
  onAssign,
}: {
  open: boolean;
  onClose: () => void;
  plans: AssignablePlan[];
  busy: boolean;
  onAssign: (planId: string, cycle: BillingCycle) => void;
}) {
  const [planId, setPlanId] = useState("");
  const [cycle, setCycle] = useState<BillingCycle | "">("");

  const plan = plans.find((p) => p.id === planId);
  const cycles = availableBillingCycles(plan?.prices ?? null);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign a plan</DialogTitle>
          <DialogDescription>
            Only cycles this plan is actually priced for are offered.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="assign-plan">Plan</Label>
            <Select
              value={planId}
              onValueChange={(v) => {
                setPlanId(v);
                setCycle("");
              }}
            >
              <SelectTrigger id="assign-plan" className="w-full">
                <SelectValue placeholder="Choose…" />
              </SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} v{p.version}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="assign-cycle">Billing cycle</Label>
            <Select value={cycle} onValueChange={(v) => setCycle(v as BillingCycle)} disabled={!plan}>
              <SelectTrigger id="assign-cycle" className="w-full">
                <SelectValue placeholder={plan ? "Choose…" : "Pick a plan first"} />
              </SelectTrigger>
              <SelectContent>
                {cycles.map((c) => (
                  <SelectItem key={c} value={c}>
                    {BILLING_CYCLE_LABELS[c]} — {formatCentsAsCurrency(priceForCycle(plan!.prices, c) ?? 0)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {plan && cycles.length === 0 && (
              <p className="text-xs text-[var(--color-danger)]">
                This plan has no prices set, so it can&apos;t be sold.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button disabled={busy || !planId || !cycle} onClick={() => onAssign(planId, cycle as BillingCycle)}>
            {busy ? "Assigning…" : "Assign plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangePlanDialog({
  open,
  onClose,
  plans,
  cycle,
  currentPrice,
  periodEnd,
  busy,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  plans: AssignablePlan[];
  cycle: BillingCycle;
  currentPrice: number | null;
  periodEnd: string | null;
  busy: boolean;
  onChange: (planId: string, applyNow: boolean) => void;
}) {
  const [planId, setPlanId] = useState("");
  const [override, setOverride] = useState<boolean | null>(null);

  const plan = plans.find((p) => p.id === planId);
  const newPrice = plan ? priceForCycle(plan.prices, cycle) : null;

  // Upgrade = costs more on the same cycle -> immediate. Otherwise queued to period end, so the
  // customer keeps what they already paid for. The admin can override either way.
  const inferredUpgrade = newPrice !== null && currentPrice !== null && newPrice > currentPrice;
  const applyNow = override ?? inferredUpgrade;
  const sellableOnCycle = newPrice !== null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change plan</DialogTitle>
          <DialogDescription>
            Upgrades apply immediately; downgrades wait for period end so nothing already paid for is
            taken away.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="change-plan">New plan</Label>
            <Select
              value={planId}
              onValueChange={(v) => {
                setPlanId(v);
                setOverride(null);
              }}
            >
              <SelectTrigger id="change-plan" className="w-full">
                <SelectValue placeholder="Choose…" />
              </SelectTrigger>
              <SelectContent>
                {plans.map((p) => {
                  const price = priceForCycle(p.prices, cycle);
                  return (
                    <SelectItem key={p.id} value={p.id} disabled={price === null}>
                      {p.name} v{p.version}
                      {price === null
                        ? ` — not sold ${BILLING_CYCLE_LABELS[cycle].toLowerCase()}`
                        : ` — ${formatCentsAsCurrency(price)}`}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {plan && sellableOnCycle && (
            <div className="space-y-2 rounded-md bg-muted p-3 text-sm">
              <p>
                {formatCentsAsCurrency(currentPrice ?? 0)} → {formatCentsAsCurrency(newPrice)} per{" "}
                {BILLING_CYCLE_LABELS[cycle].toLowerCase()} —{" "}
                <span className="font-medium">{inferredUpgrade ? "an upgrade" : "a downgrade"}</span>
              </p>
              <p className="text-muted-foreground">
                {applyNow
                  ? "Takes effect immediately."
                  : `Takes effect ${periodEnd ? new Date(periodEnd).toLocaleDateString() : "at period end"}.`}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setOverride(!applyNow)}
              >
                {applyNow ? "Queue for period end instead" : "Apply immediately instead"}
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button disabled={busy || !planId || !sellableOnCycle} onClick={() => onChange(planId, applyNow)}>
            {busy ? "Saving…" : applyNow ? "Change now" : "Queue change"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({
  open,
  onClose,
  periodEnd,
  busy,
  onCancel,
}: {
  open: boolean;
  onClose: () => void;
  periodEnd: string | null;
  busy: boolean;
  onCancel: (reason: string, immediate: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [immediate, setImmediate] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel subscription</DialogTitle>
          <DialogDescription>
            By default this ends at period end — they keep what they paid for until then.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Reason</Label>
            <textarea
              id="cancel-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer moved to a competitor"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <p className="text-xs text-muted-foreground">Required, and recorded in the audit log.</p>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={immediate}
              onChange={(e) => setImmediate(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--color-danger)]"
            />
            <span>
              Cancel immediately instead of{" "}
              {periodEnd ? new Date(periodEnd).toLocaleDateString() : "at period end"}
              <span className="block text-xs text-muted-foreground">
                Ends access now, even though the period is paid for.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button
            variant="destructive"
            disabled={busy || reason.trim().length < 5}
            onClick={() => onCancel(reason, immediate)}
          >
            {busy ? "Cancelling…" : immediate ? "Cancel now" : "Cancel at period end"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

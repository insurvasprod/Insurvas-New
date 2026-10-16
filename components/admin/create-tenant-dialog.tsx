"use client";

import { useState, type FormEvent } from "react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { InviteLinkPanel } from "@/components/admin/invite-link-panel";
import { Input } from "@/components/ui/input";
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
import type { PlanListRow } from "@/lib/plans/constants";
import {
  TENANT_BILLING_CHOICES,
  TENANT_BILLING_LABELS,
  TRIAL_DAYS_MAX,
  type TenantBillingChoice,
} from "@/lib/tenants/createOptions";

type Form = {
  tenantName: string;
  ownerName: string;
  ownerEmail: string;
  planId: string;
  billing: TenantBillingChoice;
  compReason: string;
  /** Empty = the plan's own trial. */
  trialDays: string;
  startBillingNow: boolean;
};

const EMPTY_FORM: Form = {
  tenantName: "",
  ownerName: "",
  ownerEmail: "",
  planId: "",
  billing: "card",
  compReason: "",
  trialDays: "",
  startBillingNow: false,
};

type Invite = { url: string; expiresAt: string; delivered: boolean };

/**
 * Create tenant (doc 2 §5.3): business, owner, plan, billing (card / manual invoice / comped with a
 * mandatory reason) and trial ("[14] days or [ ] start billing now"). The coupon line of the board
 * is not here yet — a coupon is applied to the subscription afterwards from the tenant record.
 */
export function CreateTenantDialog({ onCreated, plans }: { onCreated: () => void; plans: PlanListRow[] }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [invite, setInvite] = useState<Invite | null>(null);

  const comped = form.billing === "comped";
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setTimeout(() => {
        setForm(EMPTY_FORM);
        setInvite(null);
      }, 150);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);

    const trialDays = comped || form.startBillingNow ? 0 : form.trialDays.trim() === "" ? null : Number(form.trialDays);
    const res = await fetch("/api/admin/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantName: form.tenantName,
        ownerName: form.ownerName,
        ownerEmail: form.ownerEmail,
        planId: form.planId,
        billing: form.billing,
        compReason: comped ? form.compReason : "",
        trialDays,
      }),
    });
    const body = await res.json().catch(() => null);
    setLoading(false);

    if (!res.ok) {
      notify.block(body?.error ?? "Could not create tenant");
      return;
    }

    // The dialog stays open on success, showing the invite link. Closing it would be right if the
    // administrator had nothing left to do, but when the mail did not go out the link is the only
    // way the owner reaches their account, and it is not recoverable once this closes.
    notify.done(
      body.invite?.delivered
        ? `${body.tenant.name} created — the owner has been emailed an invitation`
        : `${body.tenant.name} created — copy the invitation link below`,
    );
    setInvite(body.invite ?? null);
    onCreated();
    if (!body.invite) handleOpenChange(false);
  }

  const missing =
    !form.planId || (comped && form.compReason.trim().length < 5);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* The header action, "Create tenant" — the same words as the dialog it opens. */}
      <Button type="button" onClick={() => setOpen(true)}>
        Create tenant
      </Button>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create tenant</DialogTitle>
            <DialogDescription>
              Provisions the tenant on a plan and invites its owner — for a sales-closed deal or a
              migration. The owner sets their own password from the invitation; nobody here ever
              types it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="tenant-name">Business name</Label>
              <Input
                id="tenant-name"
                required
                value={form.tenantName}
                onChange={(e) => set("tenantName", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner-name">Owner name</Label>
              <Input
                id="owner-name"
                required
                value={form.ownerName}
                onChange={(e) => set("ownerName", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner-email">Owner email</Label>
              <Input
                id="owner-email"
                type="email"
                required
                value={form.ownerEmail}
                onChange={(e) => set("ownerEmail", e.target.value)}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="tenant-plan">Plan</Label>
              <Select value={form.planId} onValueChange={(v) => set("planId", v)}>
                <SelectTrigger id="tenant-plan" className="w-full">
                  <SelectValue placeholder="Choose a plan…" />
                </SelectTrigger>
                <SelectContent>
                  {plans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.name} ({plan.code}, v{plan.version})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <fieldset className="col-span-2 space-y-1.5">
              <legend className="text-sm font-medium">Billing</legend>
              {TENANT_BILLING_CHOICES.map((choice) => (
                <label key={choice} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="tenant-billing"
                    value={choice}
                    checked={form.billing === choice}
                    onChange={() => set("billing", choice)}
                  />
                  {TENANT_BILLING_LABELS[choice]}
                </label>
              ))}
            </fieldset>
            {comped ? (
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="comp-reason">Reason for comping</Label>
                <Input
                  id="comp-reason"
                  required
                  minLength={5}
                  maxLength={500}
                  value={form.compReason}
                  onChange={(e) => set("compReason", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Required. Recorded with the tenant and listed in the comped-tenants report. A comped
                  tenant has no trial.
                </p>
              </div>
            ) : (
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="trial-days">Trial</Label>
                <div className="flex items-center gap-3">
                  <Input
                    id="trial-days"
                    type="number"
                    min={1}
                    max={TRIAL_DAYS_MAX}
                    placeholder="Plan default"
                    className="w-32"
                    disabled={form.startBillingNow}
                    value={form.trialDays}
                    onChange={(e) => set("trialDays", e.target.value)}
                  />
                  <span className="text-sm text-muted-foreground">days, or</span>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.startBillingNow}
                      onChange={(e) => set("startBillingNow", e.target.checked)}
                    />
                    Start billing now
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Empty keeps the plan&apos;s own trial. The subscription is monthly.
                </p>
              </div>
            )}
          </div>
          {invite ? (
            <div className="space-y-3 pb-2">
              {!invite.delivered && (
                <p className="text-sm text-[var(--color-text-muted)]">
                  The invitation email could not be delivered. Send this link to the owner yourself —
                  it is the only way into the account, and it is not shown again.
                </p>
              )}
              <InviteLinkPanel url={invite.url} expiresAt={invite.expiresAt} />
            </div>
          ) : null}
          <DialogFooter>
            {invite ? (
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            ) : (
              <Button type="submit" disabled={loading || missing}>
                {loading ? "Creating…" : "Create tenant"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

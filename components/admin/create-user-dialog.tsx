"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
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
import { TENANT_ROLES, TENANT_ROLE_LABELS, type TenantRole } from "@/lib/tenantAuth/roles";
import type { PlanListRow } from "@/lib/plans/constants";
import { InviteLinkPanel } from "./invite-link-panel";

export type TenantOption = { id: string; name: string };

const NEW_TENANT = "__new__";

type Form = {
  name: string;
  email: string;
  phone: string;
  tenantId: string;
  newTenantName: string;
  planId: string;
  role: TenantRole;
};

const EMPTY: Form = { name: "", email: "", phone: "", tenantId: "", newTenantName: "", planId: "", role: "producer" };

export function CreateUserDialog({
  tenants,
  plans,
  onCreated,
  triggerLabel,
  triggerClassName,
}: {
  tenants: TenantOption[];
  plans: PlanListRow[];
  onCreated: () => void;
  /** The Users board's header button ("Create user", 44px). Omitted: the original small button. */
  triggerLabel?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [invite, setInvite] = useState<{ url: string; expiresAt: string; email: string } | null>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setTimeout(() => {
        setForm(EMPTY);
        setInvite(null);
      }, 150);
    }
  }

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const creatingNewTenant = form.tenantId === NEW_TENANT;

  function chooseTenant(value: string) {
    setForm((prev) => ({
      ...prev,
      tenantId: value,
      role: value === NEW_TENANT ? "owner" : prev.tenantId === NEW_TENANT ? "producer" : prev.role,
      planId: value === NEW_TENANT ? prev.planId : "",
    }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);

    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        email: form.email,
        phone: form.phone,
        tenantId: creatingNewTenant ? undefined : form.tenantId,
        newTenantName: creatingNewTenant ? form.newTenantName : "",
        planId: creatingNewTenant ? form.planId : undefined,
        role: form.role,
      }),
    });
    const body = await res.json().catch(() => null);
    setLoading(false);

    if (!res.ok) {
      notify.block(body?.error ?? "Could not create user");
      return;
    }

    notify.done(`${body.user.email} created`);
    setInvite({ url: body.invite.url, expiresAt: body.invite.expiresAt, email: body.user.email });
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {triggerLabel ? (
        <button type="button" className={triggerClassName} onClick={() => setOpen(true)}>
          {triggerLabel}
        </button>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus />
          New user
        </Button>
      )}
      <DialogContent>
        {invite ? (
          <>
            <DialogHeader>
              <DialogTitle>User created</DialogTitle>
              <DialogDescription>
                {invite.email} must set their own password before they can sign in.
              </DialogDescription>
            </DialogHeader>
            <InviteLinkPanel url={invite.url} expiresAt={invite.expiresAt} />
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Create user</DialogTitle>
              <DialogDescription>
                Creates the account and issues a set-password invitation. Admins never see or set a
                customer&apos;s password.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="user-name">Full name</Label>
                <Input id="user-name" required value={form.name} onChange={(e) => set("name", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="user-phone">Phone</Label>
                <Input id="user-phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="user-email">Email</Label>
                <Input
                  id="user-email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="user-tenant">Tenant</Label>
                <Select value={form.tenantId} onValueChange={chooseTenant}>
                  <SelectTrigger id="user-tenant" className="w-full">
                    <SelectValue placeholder="Choose…" />
                  </SelectTrigger>
                  <SelectContent>
                    {/*
                      The action goes before the data, not after it. This list is every tenant on
                      the platform — 563 entries on 2026-09-21 — and "+ Create new tenant" sat at
                      the very bottom, past all of them. It was not merely awkward: the option
                      rendered off-canvas and could not be clicked at all without scrolling the
                      listbox to its end.
                      That matters because creating a tenant is the whole reason SA-1.2 exists
                      ("sales closes a deal on a call and wants the account ready before hanging
                      up"), and it is also the only route to the plan picker below.
                    */}
                    <SelectItem value={NEW_TENANT}>+ Create new tenant</SelectItem>
                    {tenants.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {creatingNewTenant && (
                <div className="space-y-1.5">
                  <Label htmlFor="user-plan">Initial plan</Label>
                  <Select value={form.planId} onValueChange={(v) => set("planId", v)}>
                    <SelectTrigger id="user-plan" className="w-full">
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
                  {/*
                    The trial half of this sentence was missing, and the omission had a price. A
                    plan with trial days produces a subscription in `trialing`, not `active` — so
                    an admin creating an account for a customer who has ALREADY agreed to pay was
                    silently starting a free trial, and the first charge landed a fortnight after
                    the business expected it. Stated rather than left to be discovered on an
                    invoice.
                  */}
                  <p className="text-xs text-muted-foreground">
                    The new tenant starts on this plan at the monthly cycle. If the plan includes
                    trial days, the subscription begins as a trial — not as active — and is not
                    charged until the trial ends.
                  </p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="user-role">Role in tenant</Label>
                <Select value={form.role} onValueChange={(v) => set("role", v as TenantRole)} disabled={creatingNewTenant}>
                  <SelectTrigger id="user-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TENANT_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {TENANT_ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {creatingNewTenant && <p className="text-xs text-muted-foreground">The first member of a new tenant is always its owner.</p>}
              </div>
              {creatingNewTenant && (
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="user-new-tenant">New tenant name</Label>
                  <Input
                    id="user-new-tenant"
                    required
                    value={form.newTenantName}
                    onChange={(e) => set("newTenantName", e.target.value)}
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={loading || !form.tenantId || (creatingNewTenant && (!form.newTenantName.trim() || !form.planId))}>
                {loading ? "Creating…" : "Create & invite"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

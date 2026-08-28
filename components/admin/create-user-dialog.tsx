"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

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
import { InviteLinkPanel } from "./invite-link-panel";

export type TenantOption = { id: string; name: string };

const NEW_TENANT = "__new__";

type Form = {
  name: string;
  email: string;
  phone: string;
  tenantId: string;
  newTenantName: string;
  role: TenantRole;
};

const EMPTY: Form = { name: "", email: "", phone: "", tenantId: "", newTenantName: "", role: "producer" };

export function CreateUserDialog({
  tenants,
  onCreated,
}: {
  tenants: TenantOption[];
  onCreated: () => void;
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
        role: form.role,
      }),
    });
    const body = await res.json().catch(() => null);
    setLoading(false);

    if (!res.ok) {
      toast.error(body?.error ?? "Could not create user");
      return;
    }

    toast.success(`${body.user.email} created`);
    setInvite({ url: body.invite.url, expiresAt: body.invite.expiresAt, email: body.user.email });
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus />
        New user
      </Button>
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
                <Select value={form.tenantId} onValueChange={(v) => set("tenantId", v)}>
                  <SelectTrigger id="user-tenant" className="w-full">
                    <SelectValue placeholder="Choose…" />
                  </SelectTrigger>
                  <SelectContent>
                    {tenants.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                    <SelectItem value={NEW_TENANT}>+ Create new tenant</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="user-role">Role in tenant</Label>
                <Select value={form.role} onValueChange={(v) => set("role", v as TenantRole)}>
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
              <Button type="submit" disabled={loading || !form.tenantId}>
                {loading ? "Creating…" : "Create & invite"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

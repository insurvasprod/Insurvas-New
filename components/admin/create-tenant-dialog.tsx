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

const EMPTY_FORM = { tenantName: "", ownerName: "", ownerEmail: "", ownerPassword: "" };

export function CreateTenantDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setTimeout(() => setForm(EMPTY_FORM), 150);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);

    const res = await fetch("/api/admin/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const body = await res.json().catch(() => null);
    setLoading(false);

    if (!res.ok) {
      toast.error(body?.error ?? "Could not create tenant");
      return;
    }

    toast.success(`${body.tenant.name} created`);
    handleOpenChange(false);
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus />
        New tenant
      </Button>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create tenant</DialogTitle>
            <DialogDescription>
              Provisions the tenant and its owner account directly — for a sales-closed deal or a
              migration. Most tenants will arrive through self-serve signup once that exists.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="tenant-name">Business name</Label>
              <Input
                id="tenant-name"
                required
                value={form.tenantName}
                onChange={(e) => setForm((f) => ({ ...f, tenantName: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner-name">Owner name</Label>
              <Input
                id="owner-name"
                required
                value={form.ownerName}
                onChange={(e) => setForm((f) => ({ ...f, ownerName: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner-email">Owner email</Label>
              <Input
                id="owner-email"
                type="email"
                required
                value={form.ownerEmail}
                onChange={(e) => setForm((f) => ({ ...f, ownerEmail: e.target.value }))}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="owner-password">Temporary password</Label>
              <Input
                id="owner-password"
                type="password"
                minLength={12}
                required
                value={form.ownerPassword}
                onChange={(e) => setForm((f) => ({ ...f, ownerPassword: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating…" : "Create tenant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

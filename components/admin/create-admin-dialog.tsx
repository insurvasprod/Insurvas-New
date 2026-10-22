"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
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
import { ADMIN_ROLES, ADMIN_ROLE_LABELS, type AdminRole } from "@/lib/adminAuth/roles";

const EMPTY_FORM = { email: "", name: "", role: "support_agent" as AdminRole, password: "" };

/**
 * The header's "Create admin" (board p-adm-admins): a 44px primary button and the create dialog.
 * With no `onCreated`, the page re-renders on the server so the new row, the tiles and the callout
 * all include the new account.
 *
 * No enrolment step here any more: the new admin sets up their own authenticator at first sign-in
 * (/admin/login), and the creator never sees their secret or QR code.
 */
export function CreateAdminDialog({ onCreated }: { onCreated?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Reset once the close animation finishes so the form doesn't flash empty mid-close.
      setTimeout(() => {
        setForm(EMPTY_FORM);
      }, 150);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);

    const res = await fetch("/api/admin/admins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const body = await res.json().catch(() => null);
    setLoading(false);

    if (!res.ok) {
      notify.block(body?.error ?? "Could not create admin");
      return;
    }

    notify.done(`${body.admin.email} created — they set up two-factor authentication at first sign-in`);
    handleOpenChange(false);
    if (onCreated) onCreated();
    else router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button type="button" onClick={() => setOpen(true)}>
        Create admin
      </Button>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create admin</DialogTitle>
            <DialogDescription>
              Platform staff account. They set up their own authenticator app the first time they
              sign in; two-factor authentication is mandatory.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="new-name">Name</Label>
              <Input
                id="new-name"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="new-email">Email</Label>
              <Input
                id="new-email"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-role">Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v as AdminRole }))}>
                <SelectTrigger id="new-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ADMIN_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ADMIN_ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password">Temporary password</Label>
              <Input
                id="new-password"
                type="password"
                minLength={12}
                required
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating…" : "Create admin"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

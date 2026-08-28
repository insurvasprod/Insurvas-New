"use client";

import { useEffect, useState, type FormEvent } from "react";
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
import type { UserListRow } from "@/lib/users/list";
import { InviteLinkPanel } from "./invite-link-panel";

export function EditUserDialog({
  user,
  onClose,
  onSaved,
}: {
  user: UserListRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TenantRole>("producer");
  const [loading, setLoading] = useState(false);
  const [emailChange, setEmailChange] = useState<{ url: string; expiresAt: string; newEmail: string } | null>(null);

  // Re-seed the form whenever a different row is opened.
  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setPhone("");
    setEmail(user.email);
    setRole((user.tenant_role as TenantRole) ?? "producer");
    setEmailChange(null);
  }, [user]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!user) return;

    setLoading(true);
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, email, role }),
    });
    const body = await res.json().catch(() => null);
    setLoading(false);

    if (!res.ok) {
      toast.error(body?.error ?? "Could not update user");
      return;
    }

    onSaved();

    if (body.emailChange) {
      // Keep the dialog open so the admin can hand over the confirmation link.
      toast.success("Saved — the new email needs confirming");
      setEmailChange(body.emailChange);
      return;
    }

    toast.success(`${name} updated`);
    onClose();
  }

  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {emailChange ? (
          <>
            <DialogHeader>
              <DialogTitle>Confirm the new email</DialogTitle>
              <DialogDescription>
                {emailChange.newEmail} must be confirmed before it takes effect. Until then, this user signs in with
                their old address.
              </DialogDescription>
            </DialogHeader>
            <InviteLinkPanel url={emailChange.url} expiresAt={emailChange.expiresAt} />
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Edit user</DialogTitle>
              <DialogDescription>
                Changing the role applies immediately. A new email address has to be confirmed by the user before it
                takes effect.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-name">Full name</Label>
                <Input id="edit-name" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-phone">Phone</Label>
                <Input id="edit-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="edit-role">Role in tenant</Label>
                <Select value={role} onValueChange={(v) => setRole(v as TenantRole)}>
                  <SelectTrigger id="edit-role" className="w-full">
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
            </div>
            <DialogFooter>
              <Button type="submit" disabled={loading}>
                {loading ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

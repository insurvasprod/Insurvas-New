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
import { ADMIN_ROLES, ADMIN_ROLE_LABELS, type AdminRole } from "@/lib/adminAuth/roles";

type Enrollment = {
  email: string;
  totpUri: string;
  qrDataUrl: string;
};

const EMPTY_FORM = { email: "", name: "", role: "support_agent" as AdminRole, password: "" };

export function CreateAdminDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Reset once the close animation finishes so the form doesn't flash empty mid-close.
      setTimeout(() => {
        setForm(EMPTY_FORM);
        setEnrollment(null);
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
      toast.error(body?.error ?? "Could not create admin");
      return;
    }

    toast.success(`${body.admin.email} created`);
    setEnrollment({ email: body.admin.email, totpUri: body.totpUri, qrDataUrl: body.qrDataUrl });
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus />
        New admin
      </Button>
      <DialogContent>
        {enrollment ? (
          <>
            <DialogHeader>
              <DialogTitle>Enroll two-factor auth</DialogTitle>
              <DialogDescription>
                {enrollment.email} must scan this before their first login — 2FA is mandatory.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-3 py-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- local data: URI */}
              <img
                src={enrollment.qrDataUrl}
                alt="TOTP enrollment QR code"
                width={180}
                height={180}
                // Stays white in dark mode on purpose: a QR code needs a light quiet zone, and a
                // scanner reading it off a dark card is a support ticket nobody enjoys.
                className="rounded-md border border-border bg-white p-2"
              />
              <p className="w-full break-all rounded-md bg-muted px-3 py-2 text-center text-xs text-muted-foreground">
                {enrollment.totpUri}
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Create admin</DialogTitle>
              <DialogDescription>
                Platform staff account. 2FA enrollment is required before they can sign in.
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
        )}
      </DialogContent>
    </Dialog>
  );
}

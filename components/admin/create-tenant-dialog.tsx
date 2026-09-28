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

const EMPTY_FORM = { tenantName: "", ownerName: "", ownerEmail: "" };

type Invite = { url: string; expiresAt: string; delivered: boolean };

export function CreateTenantDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [invite, setInvite] = useState<Invite | null>(null);

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

    const res = await fetch("/api/admin/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
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
              Provisions the tenant and invites its owner — for a sales-closed deal or a
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
              <Button type="submit" disabled={loading}>
                {loading ? "Creating…" : "Create tenant"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState, type FormEvent } from "react";
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
import type { UserListRow } from "@/lib/users/list";

/**
 * SA-1.4 · delete a user, with the typed confirmation the ticket asks for.
 *
 * The confirmation is the user's **email address**, not the word "delete". A fixed word can be
 * typed from muscle memory on the wrong row; the address can only be typed by someone who has read
 * which account they are about to remove.
 *
 * The copy states the consequences the four-state table draws a distinction over — the seat is
 * freed, the address stays reserved, and there is a recovery window — because "delete" is the one
 * user action whose end state is permanent, and support will otherwise reach for it when they mean
 * deactivate.
 */
export function DeleteUserDialog({
  user,
  open,
  onClose,
  onDeleted,
}: {
  user: UserListRow | null;
  /** Separate from `user` so the row stays rendered while the dialog animates closed. */
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  // The parent keys this component by row id, so it remounts (and these clear) when a different
  // user is opened — no effect needed to reset them.
  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const matches = Boolean(user) && confirm.trim().toLowerCase() === (user?.email ?? "").toLowerCase();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!user || !matches) return;

    setLoading(true);
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: confirm.trim(), reason: reason.trim() }),
    });
    const body = await res.json().catch(() => null);
    setLoading(false);

    if (!res.ok) {
      notify.block(body?.error ?? "Could not delete this user");
      return;
    }

    // Report the real window rather than a hardcoded "7 days" — it is a setting, and the server is
    // the only thing that knows what it was when this deletion happened.
    const until = body?.deletionScheduledUntil
      ? new Date(body.deletionScheduledUntil).toLocaleDateString()
      : null;
    notify.done(
      until ? `${user.email} deleted — recoverable until ${until}` : `${user.email} deleted`,
      body?.warning ? { detail: body.warning } : undefined,
    );
    onDeleted();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Delete {user?.name}</DialogTitle>
            <DialogDescription>
              They lose access immediately and their seat is freed. The account stays recoverable for the
              soft-delete window, and their email address cannot be reused until it elapses. After that the
              removal is permanent.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="delete-confirm">
                Type <span className="font-mono">{user?.email}</span> to confirm
              </Label>
              <Input
                id="delete-confirm"
                autoComplete="off"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={user?.email ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="delete-reason">Reason (optional)</Label>
              <textarea
                id="delete-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Left the agency — requested by the owner"
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
              <p className="text-xs text-muted-foreground">Permanently recorded in the audit log.</p>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={loading || !matches}>
              {loading ? "Deleting…" : "Delete user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

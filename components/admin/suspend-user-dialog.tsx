"use client";

import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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

export function SuspendUserDialog({
  user,
  onClose,
  onSuspended,
}: {
  user: UserListRow | null;
  onClose: () => void;
  onSuspended: () => void;
}) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) setReason("");
  }, [user]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!user) return;

    setLoading(true);
    const res = await fetch(`/api/admin/users/${user.id}/suspend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const body = await res.json().catch(() => null);
    setLoading(false);

    if (!res.ok) {
      toast.error(body?.error ?? "Could not suspend this user");
      return;
    }

    toast.success(`${user.email} suspended`);
    onSuspended();
    onClose();
  }

  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Suspend {user?.name}</DialogTitle>
            <DialogDescription>
              They&apos;ll be signed out on their next request and told to contact their administrator. Their seat is
              kept. Reversible at any time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-4">
            <Label htmlFor="suspend-reason">Reason</Label>
            <textarea
              id="suspend-reason"
              required
              minLength={5}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Non-payment — invoice INV-2026-08-0412 unpaid 45 days"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <p className="text-xs text-muted-foreground">
              Required, and permanently recorded in the audit log.
            </p>
          </div>
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={loading || reason.trim().length < 5}>
              {loading ? "Suspending…" : "Suspend user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

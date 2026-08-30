"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function VoidInvoiceDialog({
  invoiceId,
  number,
  refusalReason,
}: {
  invoiceId: string;
  number: string;
  /** Non-null when this invoice cannot be voided; shown instead of hiding the button. */
  refusalReason: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (refusalReason) {
    return (
      <div className="text-right">
        <Button variant="outline" size="sm" disabled>
          Void invoice
        </Button>
        <p className="mt-1.5 max-w-xs text-xs text-muted-foreground">{refusalReason}</p>
      </div>
    );
  }

  async function submit() {
    setBusy(true);
    const res = await fetch(`/api/admin/invoices/${invoiceId}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);

    if (!res.ok) {
      toast.error(body?.error ?? "Could not void the invoice");
      return;
    }

    toast.success(`${number} voided`);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Void invoice
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void {number}?</DialogTitle>
            <DialogDescription>
              The invoice is kept and its number is never reissued — voiding only changes its status.
              The reason is recorded in the audit log.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="void-reason">Reason</Label>
            <Input
              id="void-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Duplicate of INV-2026-08-0004"
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy || reason.trim().length < 5}>
              Void invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

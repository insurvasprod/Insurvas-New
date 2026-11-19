"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notify";

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
  trigger,
}: {
  invoiceId: string;
  number: string;
  /** Non-null when this invoice cannot be voided; shown instead of hiding the button. */
  refusalReason: string | null;
  /** The trigger, when it is not the full-width outline button of the detail page (the invoice sheet's footer). */
  trigger?: { /** Refused: the reason rides on the disabled button (the sheet prints it once, beside the footer). */ compact?: boolean; label?: string; variant?: "default" | "outline" | "ghost" | "secondary" | "destructive"; className?: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (refusalReason && trigger?.compact) {
    return (
      <span title={refusalReason}>
        <Button variant={trigger.variant ?? "outline"} className={trigger.className} disabled>
          {trigger.label ?? "Void invoice"}
        </Button>
      </span>
    );
  }

  if (refusalReason) {
    return (
      <div>
        <Button variant="outline" className="w-full" disabled>
          Void invoice
        </Button>
        <p className="mt-1.5 text-xs leading-normal text-muted-foreground">{refusalReason}</p>
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
      notify.block(body?.error ?? "Could not void the invoice");
      return;
    }

    notify.done(`${number} voided`);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant={trigger?.variant ?? "outline"} className={trigger?.className ?? "w-full"} onClick={() => setOpen(true)}>
        {trigger?.label ?? "Void invoice"}
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

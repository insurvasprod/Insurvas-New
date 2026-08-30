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
import { formatCents } from "@/lib/money";

export function MarkPaidDialog({
  invoiceId,
  number,
  remainingCents,
}: {
  invoiceId: string;
  number: string;
  remainingCents: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(formatCents(remainingCents));
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const res = await fetch(`/api/admin/invoices/${invoiceId}/mark-paid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amount.trim(), reference: reference.trim() }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);

    if (!res.ok) {
      toast.error(body?.error ?? "Could not record the payment");
      return;
    }

    toast.success(
      body.settled
        ? `${number} marked paid`
        : `Payment recorded — ${formatCents(body.remainingCents)} still outstanding`,
    );
    setOpen(false);
    setReference("");
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Record payment
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record a payment for {number}</DialogTitle>
            <DialogDescription>
              For money that arrived outside the payment provider — a wire, a cheque, a negotiated
              deal. Recorded against your name and the bank reference in the audit log.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="amount">Amount</Label>
              <Input id="amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="249.00" />
              <p className="text-xs text-muted-foreground">
                Outstanding: {formatCents(remainingCents)}. A smaller amount is recorded as a partial
                payment and the invoice stays open.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reference">Bank reference</Label>
              <Input
                id="reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="FT26081400123"
              />
              <p className="text-xs text-muted-foreground">
                Also the idempotency key — the same reference cannot be recorded twice for this tenant.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy || reference.trim().length < 3 || !amount.trim()}>
              Record payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

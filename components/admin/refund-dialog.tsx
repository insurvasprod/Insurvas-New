"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { RefundFields, useRefundForm } from "@/components/admin/billing/refund-fields";

export function RefundDialog({
  tenantId,
  invoiceId,
  number,
  totalCents,
  hasProviderPayment,
  approvalThresholdCents,
  defaultCents,
  trigger,
}: {
  tenantId: string;
  invoiceId: string;
  number: string;
  totalCents: number;
  hasProviderPayment: boolean;
  /** Resolved from settings on the server (SA-4.1) — never read the constant here. */
  approvalThresholdCents: number;
  /** The amount the form starts at (Reconciliation passes the difference); the invoice total when absent. */
  defaultCents?: number;
  /** The trigger, when it is not the full-width outline button of the detail page (the invoice sheet's footer). */
  trigger?: { label?: string; variant?: "default" | "outline" | "ghost" | "secondary" | "destructive"; className?: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const target = { tenantId, invoiceId, number, totalCents, hasProviderPayment, defaultCents };
  // The fields and the POST are shared with Refunds & credits' in-place sheet (billing-r2 screen 6).
  const form = useRefundForm(target, approvalThresholdCents);

  async function submit() {
    if (await form.submit()) {
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <>
      <Button variant={trigger?.variant ?? "outline"} className={trigger?.className ?? "w-full"} onClick={() => setOpen(true)}>
        {trigger?.label ?? "Raise a credit note"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Refund or credit {number}</DialogTitle>
            <DialogDescription>
              The invoice itself is never edited — this raises a credit note alongside it.
            </DialogDescription>
          </DialogHeader>

          <RefundFields form={form} target={target} approvalThresholdCents={approvalThresholdCents} idPrefix={`refund-${invoiceId}`} />

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={form.busy}>Cancel</Button>
            <Button onClick={() => void submit()} disabled={form.busy || form.cents <= 0}>{form.submitLabel}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

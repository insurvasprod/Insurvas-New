"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCents, formatCentsAsCurrency } from "@/lib/money";
import {
  CREDIT_REASONS, CREDIT_REASON_LABELS, needsSecondApprover,
  type CreditReason,
} from "@/lib/credits/rules";

export function RefundDialog({
  tenantId,
  invoiceId,
  number,
  totalCents,
  hasProviderPayment,
  approvalThresholdCents,
}: {
  tenantId: string;
  invoiceId: string;
  number: string;
  totalCents: number;
  hasProviderPayment: boolean;
  /** Resolved from settings on the server (SA-4.1) — never read the constant here. */
  approvalThresholdCents: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<"refund" | "credit">(hasProviderPayment ? "refund" : "credit");
  const [amount, setAmount] = useState(formatCents(totalCents));
  const [reasonCode, setReasonCode] = useState<CreditReason>("service_issue");
  const [reasonText, setReasonText] = useState("");

  const cents = Math.round(Number(amount.replace(/[^0-9.]/g, "")) * 100) || 0;
  const willNeedApproval = needsSecondApprover(type, cents, approvalThresholdCents);

  async function submit() {
    setBusy(true);
    const res = await fetch("/api/admin/credit-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        invoice_id: invoiceId,
        type,
        amount: amount.trim(),
        reason_code: reasonCode,
        reason_text: reasonText.trim() || null,
      }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);

    if (!res.ok) {
      toast.error(body?.error ?? "Could not raise the credit note");
      return;
    }

    if (body.awaitingApproval) toast.warning(body.message);
    else toast.success(body.message);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Refund or credit
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Refund or credit {number}</DialogTitle>
            <DialogDescription>
              The invoice itself is never edited — this raises a credit note alongside it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as "refund")}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="refund" disabled={!hasProviderPayment}>
                    Refund — money back to the card
                  </SelectItem>
                  <SelectItem value="credit">Credit — applied against future billing</SelectItem>
                </SelectContent>
              </Select>
              {!hasProviderPayment && (
                <p className="text-xs text-muted-foreground">
                  This invoice was settled outside the provider, so there is no card charge to reverse.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="amount">Amount</Label>
              <Input id="amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Invoice total {formatCentsAsCurrency(totalCents)}.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Select value={reasonCode} onValueChange={(v) => setReasonCode(v as CreditReason)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CREDIT_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>{CREDIT_REASON_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder="Optional detail"
              />
            </div>

            {willNeedApproval && (
              <p className="rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/5 p-2.5 text-xs text-[var(--color-warning)]">
                Above {formatCentsAsCurrency(approvalThresholdCents)}, so this will wait for a second
                admin. No money moves until then, and you cannot approve it yourself.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={busy || cents <= 0}>
              {willNeedApproval ? "Request approval" : type === "refund" ? "Refund" : "Apply credit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

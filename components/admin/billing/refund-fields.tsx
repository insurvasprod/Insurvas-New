"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inputControl } from "@/components/ui/field";
import { formatCents, formatCentsAsCurrency } from "@/lib/money";
import { CREDIT_REASONS, CREDIT_REASON_LABELS, needsSecondApprover, type CreditReason } from "@/lib/credits/rules";
import { notify } from "@/lib/notify";

/** The invoice a credit note goes back against. */
export type RefundTarget = { tenantId: string; invoiceId: string; number: string; totalCents: number; hasProviderPayment: boolean; /** The amount the form starts at (Reconciliation: the difference); the total when absent. */ defaultCents?: number };

/**
 * The credit note's fields — type, amount, reason and detail — and their rules, shared by the invoice's
 * "Raise a credit note" dialog and the sheet that raises one in place on Refunds & credits (billing-r2 screen 6:
 * "same dialog fields as the invoice's"). One form, one POST /api/admin/credit-notes, one approval rule.
 */
export function useRefundForm(target: RefundTarget | null, approvalThresholdCents: number) {
  const [type, setType] = useState<"refund" | "credit">(target?.hasProviderPayment ? "refund" : "credit");
  const [amount, setAmount] = useState(target ? formatCents(target.defaultCents ?? target.totalCents) : "");
  const [reasonCode, setReasonCode] = useState<CreditReason>("service_issue");
  const [reasonText, setReasonText] = useState("");
  const [busy, setBusy] = useState(false);

  const cents = Math.round(Number(amount.replace(/[^0-9.]/g, "")) * 100) || 0;
  const willNeedApproval = needsSecondApprover(type, cents, approvalThresholdCents);

  /** Point the form at another invoice (the in-place sheet's picker): its total and whether it can be refunded. */
  function retarget(next: RefundTarget) {
    setType(next.hasProviderPayment ? "refund" : "credit");
    setAmount(formatCents(next.defaultCents ?? next.totalCents));
  }

  async function submit(): Promise<boolean> {
    if (!target) return false;
    setBusy(true);
    const res = await fetch("/api/admin/credit-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: target.tenantId, invoice_id: target.invoiceId, type, amount: amount.trim(), reason_code: reasonCode, reason_text: reasonText.trim() || null }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      notify.block(body?.error ?? "Could not raise the credit note");
      return false;
    }
    if (body.awaitingApproval) notify.warn(body.message);
    else notify.done(body.message);
    return true;
  }

  const submitLabel = willNeedApproval ? "Request approval" : type === "refund" ? "Refund" : "Apply credit";
  return { type, setType, amount, setAmount, reasonCode, setReasonCode, reasonText, setReasonText, busy, cents, willNeedApproval, submit, submitLabel, retarget };
}

export type RefundForm = ReturnType<typeof useRefundForm>;

export function RefundFields({ form, target, approvalThresholdCents, idPrefix = "refund" }: { form: RefundForm; target: RefundTarget; approvalThresholdCents: number; idPrefix?: string }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-type`}>Type</Label>
        <select id={`${idPrefix}-type`} aria-label="Type" className={inputControl} value={form.type} onChange={(event) => form.setType(event.target.value as "refund" | "credit")}>
          <option value="refund" disabled={!target.hasProviderPayment}>Refund — money back to the card</option>
          <option value="credit">Credit — applied against future billing</option>
        </select>
        {!target.hasProviderPayment && (
          <p className="text-xs text-muted-foreground">This invoice was settled outside the provider, so there is no card charge to reverse.</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-amount`}>Amount</Label>
        <Input id={`${idPrefix}-amount`} value={form.amount} onChange={(event) => form.setAmount(event.target.value)} />
        <p className="text-xs text-muted-foreground">Invoice total {formatCentsAsCurrency(target.totalCents)}.</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-reason`}>Reason</Label>
        <select id={`${idPrefix}-reason`} aria-label="Reason" className={inputControl} value={form.reasonCode} onChange={(event) => form.setReasonCode(event.target.value as CreditReason)}>
          {CREDIT_REASONS.map((reason) => <option key={reason} value={reason}>{CREDIT_REASON_LABELS[reason]}</option>)}
        </select>
        <Input aria-label="Reason detail" value={form.reasonText} onChange={(event) => form.setReasonText(event.target.value)} placeholder="Optional detail" />
      </div>

      {form.willNeedApproval && (
        <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground" role="status">
          <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--warning)]" aria-hidden="true" />
          Above {formatCentsAsCurrency(approvalThresholdCents)}, so this waits for a second admin. No money moves until then, and you cannot approve it yourself.
        </p>
      )}
    </div>
  );
}

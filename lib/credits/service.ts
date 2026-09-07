import "server-only";

// SA-3.8 · Raising, approving and executing credit notes.
//
// An issued invoice is never edited (SA-3.2): a refund produces a credit note alongside it. The
// approval threshold is enforced in SQL as well as here, because Whop refunds whatever an
// authenticated key asks for — nothing downstream will stop a mistake or a compromised account.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { buildProvider } from "@/lib/payments/registry";
import { WhopProvider } from "@/lib/payments/whop/provider";
import { rebuildEntitlement } from "@/lib/entitlements/rebuild";
import { refundApprovalThresholdCents } from "@/lib/settings/queries";
import { priceForCycle, type PlanPrices } from "@/lib/money";
import {
  approvalRefusalReason,
  creditToFreeDays,
  needsSecondApprover,
  requestRefusalReason,
  type CreditNoteType,
  type CreditReason,
} from "./rules";
import type { AdminRole } from "@/lib/adminAuth/roles";

export type RequestInput = {
  tenantId: string;
  invoiceId: string | null;
  type: CreditNoteType;
  amountCents: number;
  reasonCode: CreditReason;
  reasonText: string | null;
  requestedBy: string;
  requesterRole: AdminRole;
};

export type CreditNoteOutcome = {
  id: string;
  number: string;
  status: string;
  /** True when it is waiting on a second admin rather than done. */
  awaitingApproval: boolean;
  message: string;
};

export class CreditNoteError extends Error {}

/** What Whop says is still refundable. Throws rather than guessing when we cannot ask. */
async function assertRefundable(invoiceId: string, amountCents: number): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data: invoice } = await supabase
    .from("invoices")
    .select("provider_payment_id, total_cents, tenant_id")
    .eq("id", invoiceId)
    .maybeSingle<{ provider_payment_id: string | null; total_cents: number; tenant_id: string }>();

  if (!invoice) throw new CreditNoteError("That invoice does not exist.");

  if (!invoice.provider_payment_id) {
    // Settled by bank transfer, so there is no card charge to reverse. Refunding it means sending
    // money back the same way, which is a human action — not something to fake as a provider call.
    throw new CreditNoteError(
      "This invoice has no provider payment behind it, so it cannot be refunded to a card. Return the money by bank transfer and record a credit instead.",
    );
  }

  const provider = buildProvider("whop", { tenantId: invoice.tenant_id });
  if (!(provider instanceof WhopProvider)) throw new CreditNoteError("Refunds require the Whop provider.");

  const refundability = await provider.getRefundability(invoice.provider_payment_id);

  if (!refundability.refundable) {
    throw new CreditNoteError("The provider reports this payment is not refundable.");
  }
  if (amountCents > refundability.remainingCents) {
    // Checked against WHOP's remaining figure, not our invoice total — a payment already partly
    // refunded reads as fully refundable if you only look at our own records.
    throw new CreditNoteError(
      `Only ${(refundability.remainingCents / 100).toFixed(2)} of this payment is still refundable` +
        (refundability.refundedCents > 0
          ? `; ${(refundability.refundedCents / 100).toFixed(2)} has already been returned.`
          : "."),
    );
  }
}

export async function requestCreditNote(input: RequestInput): Promise<CreditNoteOutcome> {
  const refusal = requestRefusalReason(input.requesterRole, input.type, input.amountCents);
  if (refusal) throw new CreditNoteError(refusal);

  if (input.type === "refund") {
    if (!input.invoiceId) throw new CreditNoteError("A refund must be against a specific invoice.");
    await assertRefundable(input.invoiceId, input.amountCents);
  }

  // Resolved once and passed to BOTH the RPC and needsSecondApprover below. The database holds
  // no copy of this number, so the two cannot drift apart (SA-4.1).
  const thresholdCents = await refundApprovalThresholdCents();

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("request_credit_note", {
    p_tenant_id: input.tenantId,
    p_invoice_id: input.invoiceId,
    p_type: input.type,
    p_amount_cents: input.amountCents,
    p_reason_code: input.reasonCode,
    p_reason_text: input.reasonText,
    p_requested_by: input.requestedBy,
    p_threshold_cents: thresholdCents,
  });

  if (error) throw new CreditNoteError(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new CreditNoteError("The credit note was not created.");

  if (needsSecondApprover(input.type, input.amountCents, thresholdCents)) {
    return {
      id: row.credit_note_id,
      number: row.number,
      status: row.status,
      awaitingApproval: true,
      message: `${row.number} is waiting for a second admin to approve it. No money has moved.`,
    };
  }

  const executed = await executeCreditNote(row.credit_note_id);
  return {
    id: row.credit_note_id,
    number: row.number,
    status: executed.status,
    awaitingApproval: false,
    message: executed.message,
  };
}

export async function approveCreditNote(
  id: string,
  approverId: string,
  approverRole: AdminRole,
): Promise<CreditNoteOutcome> {
  const supabase = getSupabaseServiceClient();
  const { data: note } = await supabase
    .from("credit_notes")
    .select("id, number, status, requested_by")
    .eq("id", id)
    .maybeSingle<{ id: string; number: string; status: string; requested_by: string | null }>();

  if (!note) throw new CreditNoteError("That credit note does not exist.");
  if (note.status !== "pending_approval") {
    throw new CreditNoteError(`${note.number} is ${note.status.replace("_", " ")}, so it cannot be approved.`);
  }

  const refusal = approvalRefusalReason(approverRole, approverId, note.requested_by);
  if (refusal) throw new CreditNoteError(refusal);

  const { error } = await supabase
    .from("credit_notes")
    .update({ status: "approved", approved_by: approverId, approved_at: new Date().toISOString() })
    .eq("id", id);

  // The database check constraint refuses a self-approval too, so this is belt and braces rather
  // than the only guard.
  if (error) throw new CreditNoteError(`Could not approve: ${error.message}`);

  const executed = await executeCreditNote(id);
  return {
    id,
    number: note.number,
    status: executed.status,
    awaitingApproval: false,
    message: executed.message,
  };
}

/** Actually moves the money, or the balance. Only called once a note is approved. */
export async function executeCreditNote(id: string): Promise<{ status: string; message: string }> {
  const supabase = getSupabaseServiceClient();

  const { data: note, error: noteError } = await supabase
    .from("credit_notes")
    .select("id, number, tenant_id, invoice_id, type, amount_cents, status, reconciliation_state")
    .eq("id", id)
    .single<{
      id: string;
      number: string;
      tenant_id: string;
      invoice_id: string | null;
      type: CreditNoteType;
      amount_cents: number;
      status: string;
      reconciliation_state: string;
    }>();

  if (noteError || !note) throw new CreditNoteError("That credit note does not exist.");

  if (note.type === "refund") {
    let claim;
    try {
      const result = await supabase.rpc("claim_credit_note_refund", { p_credit_note_id: id });
      if (result.error) throw result.error;
      claim = Array.isArray(result.data) ? result.data[0] : result.data;
    } catch (error) {
      throw new CreditNoteError(error instanceof Error ? error.message : String(error));
    }

    if (!claim) throw new CreditNoteError("The refund could not be claimed for execution.");
    if (claim.provider_refund_id) {
      return { status: "succeeded", message: `${claim.number}: refund is already reconciled.` };
    }

    const invoiceId = note.invoice_id ?? claim.invoice_id;
    if (!invoiceId) {
      const { data: failed, error: failedError } = await supabase.rpc("fail_credit_note_refund", {
        p_credit_note_id: id,
        p_reason: "refund has no invoice",
      });
      if (failedError || failed !== true) {
        throw new CreditNoteError(`Could not record refund failure: ${failedError?.message ?? "credit note was not processing"}`);
      }
      throw new CreditNoteError("That refund has no invoice to refund against.");
    }

    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select("provider_payment_id")
      .eq("id", invoiceId)
      .single<{ provider_payment_id: string | null }>();

    if (invoiceError || !invoice?.provider_payment_id) {
      const { data: failed, error: failedError } = await supabase.rpc("fail_credit_note_refund", {
        p_credit_note_id: id,
        p_reason: "no provider payment on the invoice",
      });
      if (failedError || failed !== true) {
        throw new CreditNoteError(`Could not record refund failure: ${failedError?.message ?? "credit note was not processing"}`);
      }
      throw new CreditNoteError("That invoice has no provider payment to refund against.");
    }

    try {
      const provider = buildProvider("whop", { tenantId: note.tenant_id });
      if (!(provider instanceof WhopProvider)) throw new Error("Refunds require the Whop provider");

      const result = await provider.refund({
        chargeId: invoice.provider_payment_id,
        amountCents: note.amount_cents,
        idempotencyKey: `refund_${note.id}`,
      });

      const { data: reconciled, error: reconcileError } = await supabase.rpc("finish_credit_note_refund", {
        p_credit_note_id: id,
        p_provider_refund_id: result.id,
      });

      if (reconcileError || reconciled !== true) {
        // The provider has already accepted the idempotent refund. Keep the row recoverable and
        // make the next attempt repeat the same provider key, never a new refund.
        const { data: pending, error: pendingError } = await supabase.rpc("mark_credit_note_provider_pending", {
          p_credit_note_id: id,
          p_reason: reconcileError?.message ?? "local reconciliation affected no row",
        });
        if (pendingError || pending !== true) {
          throw new CreditNoteError(
            `The provider accepted the refund, and local reconciliation also failed: ${pendingError?.message ?? "credit note was not marked recoverable"}`,
          );
        }
        throw new CreditNoteError(
          "The provider accepted the refund, but local reconciliation did not finish. Retry this credit note with the same idempotency key.",
        );
      }

      return { status: "succeeded", message: `${note.number}: refund sent to the provider.` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // This branch already recorded provider_pending. Do not let the generic failure handler
      // overwrite a recoverable provider success with a permanent failure.
      if (/provider accepted the refund/i.test(message)) {
        throw new CreditNoteError(message);
      }
      // A timeout means the provider's outcome is unknown. Keep provider_pending so a retry uses
      // the same key. A definite provider refusal is safe to mark failed.
      if (/timed out|outcome is unknown/i.test(message)) {
        const { data: pending, error: pendingError } = await supabase.rpc("mark_credit_note_provider_pending", {
          p_credit_note_id: id,
          p_reason: message,
        });
        if (pendingError || pending !== true) {
          throw new CreditNoteError(`Could not record unknown provider outcome: ${pendingError?.message ?? "credit note was not marked recoverable"}`);
        }
        throw new CreditNoteError(`${note.number}: provider outcome is unknown; retry reconciliation.`);
      }

      const { data: current } = await supabase
        .from("credit_notes")
        .select("status, provider_refund_id")
        .eq("id", id)
        .maybeSingle<{ status: string; provider_refund_id: string | null }>();
      if (current?.status === "succeeded" && current.provider_refund_id) {
        return { status: "succeeded", message: `${note.number}: refund is already reconciled.` };
      }

      const { data: failed, error: failedError } = await supabase.rpc("fail_credit_note_refund", {
        p_credit_note_id: id,
        p_reason: message,
      });
      if (failedError || failed !== true) {
        throw new CreditNoteError(`Could not record refund failure: ${failedError?.message ?? "credit note was not processing"}`);
      }
      console.error(`[credit-note] ${note.number} refund FAILED: ${message}`);
      return { status: "failed", message: `${note.number}: the provider refused the refund — ${message}` };
    }
  }

  // A credit: balance adjustment and success are one database transaction, so retrying after a
  // local failure cannot apply the same credit twice.
  const { data: balanceResult, error: balanceError } = await supabase.rpc("apply_credit_note_balance", {
    p_credit_note_id: id,
  });
  if (balanceError) throw new CreditNoteError(`Could not apply the credit: ${balanceError.message}`);
  const balanceRow = Array.isArray(balanceResult) ? balanceResult[0] : balanceResult;
  if (!balanceRow) throw new CreditNoteError("The credit balance was not updated.");

  await rebuildEntitlement(note.tenant_id, "subscription.plan_changed");

  return {
    status: "succeeded",
    message: `${note.number}: credit applied. Balance is now ${((balanceRow.balance_cents ?? 0) / 100).toFixed(2)}.`,
  };
}

/**
 * Turns a tenant's credit balance into free days on their membership.
 *
 * Whop bills the plan price regardless, so a credit cannot reduce a charge; days they are not
 * billed for are the closest equivalent that actually reaches them.
 */
export async function redeemCreditAsFreeDays(tenantId: string): Promise<{ days: number; message: string }> {
  const supabase = getSupabaseServiceClient();

  const { data: credit } = await supabase
    .from("tenant_credits").select("balance_cents").eq("tenant_id", tenantId).maybeSingle<{ balance_cents: number }>();

  if (!credit || credit.balance_cents <= 0) return { days: 0, message: "This tenant has no credit balance." };

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("id, whop_membership_id, current_period_start, current_period_end, plan_id, billing_cycle")
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      whop_membership_id: string | null;
      current_period_start: string | null;
      current_period_end: string | null;
      plan_id: string;
      billing_cycle: "monthly" | "quarterly" | "yearly";
    }>();

  if (!subscription?.whop_membership_id) {
    return { days: 0, message: "No provider membership is known for this tenant, so free days cannot be added." };
  }

  const { data: prices } = await supabase
    .from("plan_prices")
    .select("price_monthly_cents, price_quarterly_cents, price_yearly_cents, setup_fee_cents, trial_days, currency")
    .eq("plan_id", subscription.plan_id)
    .maybeSingle<PlanPrices>();

  const periodPrice = priceForCycle(prices, subscription.billing_cycle as "monthly" | "quarterly" | "yearly") ?? 0;
  const periodDays =
    subscription.current_period_start && subscription.current_period_end
      ? Math.max(
          1,
          Math.round(
            (new Date(subscription.current_period_end).getTime() -
              new Date(subscription.current_period_start).getTime()) /
              86_400_000,
          ),
        )
      : 30;

  const days = creditToFreeDays(credit.balance_cents, periodPrice, periodDays);
  if (days <= 0) {
    return { days: 0, message: "The balance is worth less than a single day, so no free days were added." };
  }

  const provider = buildProvider("whop", { tenantId });
  if (!(provider instanceof WhopProvider)) throw new CreditNoteError("Free days require the Whop provider.");

  await provider.addFreeDays(subscription.whop_membership_id, days);

  // Only the value actually given is deducted, so the remainder stays owed rather than evaporating.
  const spentCents = Math.round(days * (periodPrice / periodDays));
  await supabase.rpc("adjust_tenant_credit", { p_tenant_id: tenantId, p_delta_cents: -spentCents });

  return { days, message: `${days} free day(s) added; ${(spentCents / 100).toFixed(2)} of credit used.` };
}

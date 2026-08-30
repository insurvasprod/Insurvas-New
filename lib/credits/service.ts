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
import {
  REFUND_APPROVAL_THRESHOLD_CENTS,
  approvalRefusalReason,
  creditBalanceDelta,
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
    .select("provider_payment_id, total_cents")
    .eq("id", invoiceId)
    .maybeSingle<{ provider_payment_id: string | null; total_cents: number }>();

  if (!invoice) throw new CreditNoteError("That invoice does not exist.");

  if (!invoice.provider_payment_id) {
    // Settled by bank transfer, so there is no card charge to reverse. Refunding it means sending
    // money back the same way, which is a human action — not something to fake as a provider call.
    throw new CreditNoteError(
      "This invoice has no provider payment behind it, so it cannot be refunded to a card. Return the money by bank transfer and record a credit instead.",
    );
  }

  const provider = buildProvider("whop");
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

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("request_credit_note", {
    p_tenant_id: input.tenantId,
    p_invoice_id: input.invoiceId,
    p_type: input.type,
    p_amount_cents: input.amountCents,
    p_reason_code: input.reasonCode,
    p_reason_text: input.reasonText,
    p_requested_by: input.requestedBy,
    p_threshold_cents: REFUND_APPROVAL_THRESHOLD_CENTS,
  });

  if (error) throw new CreditNoteError(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new CreditNoteError("The credit note was not created.");

  if (needsSecondApprover(input.type, input.amountCents)) {
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

  const { data: note } = await supabase
    .from("credit_notes")
    .select("id, number, tenant_id, invoice_id, type, amount_cents, status")
    .eq("id", id)
    .single<{
      id: string;
      number: string;
      tenant_id: string;
      invoice_id: string | null;
      type: CreditNoteType;
      amount_cents: number;
      status: string;
    }>();

  if (!note) throw new CreditNoteError("That credit note does not exist.");
  if (note.status !== "approved") {
    throw new CreditNoteError(`${note.number} is not approved, so it cannot be executed.`);
  }

  if (note.type === "refund") {
    await supabase.from("credit_notes").update({ status: "processing" }).eq("id", id);

    const { data: invoice } = await supabase
      .from("invoices")
      .select("provider_payment_id")
      .eq("id", note.invoice_id!)
      .single<{ provider_payment_id: string | null }>();

    if (!invoice?.provider_payment_id) {
      await supabase
        .from("credit_notes")
        .update({ status: "failed", failure_reason: "no provider payment on the invoice" })
        .eq("id", id);
      throw new CreditNoteError("That invoice has no provider payment to refund against.");
    }

    try {
      const provider = buildProvider("whop");
      if (!(provider instanceof WhopProvider)) throw new Error("Refunds require the Whop provider");

      const result = await provider.refund({
        chargeId: invoice.provider_payment_id,
        amountCents: note.amount_cents,
        idempotencyKey: `refund_${note.id}`,
      });

      await supabase
        .from("credit_notes")
        .update({ status: "succeeded", provider_refund_id: result.id })
        .eq("id", id);

      return { status: "succeeded", message: `${note.number}: refund sent to the provider.` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Left in `failed` rather than rolled back: the attempt happened and the record of it is
      // what an admin needs in order to decide what to do next.
      await supabase.from("credit_notes").update({ status: "failed", failure_reason: message }).eq("id", id);
      console.error(`[credit-note] ${note.number} refund FAILED: ${message}`);
      return { status: "failed", message: `${note.number}: the provider refused the refund — ${message}` };
    }
  }

  // A credit: no money moves, a balance is held against future billing.
  const delta = creditBalanceDelta(note.type, note.amount_cents);
  const { data: balance } = await supabase.rpc("adjust_tenant_credit", {
    p_tenant_id: note.tenant_id,
    p_delta_cents: delta,
  });

  await supabase.from("credit_notes").update({ status: "succeeded" }).eq("id", id);
  await rebuildEntitlement(note.tenant_id, "subscription.plan_changed").catch(() => {});

  return {
    status: "succeeded",
    message: `${note.number}: credit applied. Balance is now ${((balance ?? 0) / 100).toFixed(2)}.`,
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
    .select("id, whop_membership_id, current_period_start, current_period_end, plan_id")
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      whop_membership_id: string | null;
      current_period_start: string | null;
      current_period_end: string | null;
      plan_id: string;
    }>();

  if (!subscription?.whop_membership_id) {
    return { days: 0, message: "No provider membership is known for this tenant, so free days cannot be added." };
  }

  const { data: prices } = await supabase
    .from("plan_prices").select("price_monthly_cents").eq("plan_id", subscription.plan_id).maybeSingle<{
      price_monthly_cents: number | null;
    }>();

  const periodPrice = prices?.price_monthly_cents ?? 0;
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

  const provider = buildProvider("whop");
  if (!(provider instanceof WhopProvider)) throw new CreditNoteError("Free days require the Whop provider.");

  await provider.addFreeDays(subscription.whop_membership_id, days);

  // Only the value actually given is deducted, so the remainder stays owed rather than evaporating.
  const spentCents = Math.round(days * (periodPrice / periodDays));
  await supabase.rpc("adjust_tenant_credit", { p_tenant_id: tenantId, p_delta_cents: -spentCents });

  return { days, message: `${days} free day(s) added; ${(spentCents / 100).toFixed(2)} of credit used.` };
}

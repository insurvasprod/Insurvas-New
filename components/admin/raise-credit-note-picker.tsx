"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet } from "@/components/ui/sheet";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { BodyPortal } from "@/components/admin/billing/inv-sheet";
import { RefundFields, useRefundForm, type RefundTarget } from "@/components/admin/billing/refund-fields";
import { fullDate } from "@/components/admin/tenant-record/billing-format";
import { formatCentsAsCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";

export type PaidInvoice = { id: string; number: string; tenant_id: string; tenant_name: string; total_cents: number; provider_payment_id: string | null; paid_at: string | null };

const targetOf = (invoice: PaidInvoice): RefundTarget => ({ tenantId: invoice.tenant_id, invoiceId: invoice.id, number: invoice.number, totalCents: invoice.total_cents, hasProviderPayment: Boolean(invoice.provider_payment_id) });

/**
 * "Raise a credit note" on Refunds & credits, in place (billing-r2 screen 6): a sheet that asks which paid invoice
 * the money goes back against, then the same fields the invoice's own dialog uses (type, amount, reason,
 * detail) and the same POST /api/admin/credit-notes, so the amount and the second-approver rule follow what was
 * actually collected. `?raise=<invoice id>` opens it on that invoice (Reconciliation's Settle links here).
 */
export function RaiseCreditNotePicker({ invoices, approvalThresholdCents }: { invoices: PaidInvoice[]; approvalThresholdCents: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const asked = params.get("raise");
  const [open, setOpen] = useState(Boolean(asked));
  const [query, setQuery] = useState("");
  const [chosenId, setChosenId] = useState<string | null>(asked && invoices.some((invoice) => invoice.id === asked) ? asked : null);
  const chosen = invoices.find((invoice) => invoice.id === chosenId) ?? null;
  const target = chosen ? targetOf(chosen) : null;
  const form = useRefundForm(target, approvalThresholdCents);
  const needle = query.trim().toLowerCase();
  const matches = useMemo(() => invoices.filter((invoice) => !needle || invoice.number.toLowerCase().includes(needle) || invoice.tenant_name.toLowerCase().includes(needle)).slice(0, 50), [invoices, needle]);

  function close() {
    setOpen(false);
    setQuery("");
    setChosenId(null);
    if (asked) setParamsInPlace({ raise: null });
  }
  function choose(invoice: PaidInvoice) {
    setChosenId(invoice.id);
    form.retarget(targetOf(invoice));
  }
  async function submit() {
    if (await form.submit()) {
      close();
      router.refresh();
    }
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>Raise a credit note</Button>
      {open && (
        <BodyPortal>
        <Sheet
          title="Raise a credit note"
          subtitle="Against a paid invoice. The invoice itself is never edited."
          onClose={close}
          footer={<>
            <span className="flex-1" />
            <Button type="button" variant="outline" onClick={close} disabled={form.busy}>Cancel</Button>
            <Button type="button" onClick={() => void submit()} disabled={!target || form.busy || form.cents <= 0}>{target ? form.submitLabel : "Raise credit note"}</Button>
          </>}
        >
          {invoices.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No invoice has been paid yet, so there is nothing to give back.</p>
          ) : chosen && target ? (
            <>
              <div className="space-y-1.5">
                <Label>Invoice</Label>
                <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                  <span className="min-w-0 text-sm">
                    <span className="font-semibold text-[var(--ink)] tabular-nums">{chosen.number}</span>
                    <span className="text-[var(--muted)]"> · {chosen.tenant_name} · {formatCentsAsCurrency(chosen.total_cents)} paid{chosen.paid_at ? ` ${fullDate(chosen.paid_at)}` : ""}</span>
                  </span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setChosenId(null)}>Change</Button>
                </div>
              </div>
              <RefundFields form={form} target={target} approvalThresholdCents={approvalThresholdCents} idPrefix="raise" />
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="raise-search">Invoice</Label>
              <Input id="raise-search" type="search" placeholder="Search invoice or customer" value={query} onChange={(event) => setQuery(event.target.value)} />
              <p className="m-0 text-xs text-muted-foreground">Paid invoices only.</p>
              <div role="listbox" aria-label="Paid invoices" className="max-h-[420px] overflow-y-auto rounded-md border border-[var(--border)]">
                {matches.map((invoice) => (
                  <button key={invoice.id} type="button" role="option" aria-selected={false} onClick={() => choose(invoice)} className={cn("flex w-full items-center justify-between gap-3 border-t border-[var(--border)] px-3 py-2 text-left first:border-t-0 hover:bg-[var(--surface-alt)]")}>
                    <span className="min-w-0"><span className="block text-sm font-semibold text-[var(--ink)] tabular-nums">{invoice.number}</span><span className="block truncate text-xs text-[var(--muted)]">{invoice.tenant_name}</span></span>
                    <span className="text-sm font-semibold tabular-nums text-[var(--ink)]">{formatCentsAsCurrency(invoice.total_cents)}</span>
                  </button>
                ))}
                {matches.length === 0 && <p className="px-3 py-4 text-sm text-[var(--muted)]">No paid invoice matches &ldquo;{query.trim()}&rdquo;.</p>}
              </div>
            </div>
          )}
        </Sheet>
        </BodyPortal>
      )}
    </>
  );
}

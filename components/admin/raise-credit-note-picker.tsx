"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCentsAsCurrency } from "@/lib/money";

type PaidInvoice = { id: string; number: string; tenant_name: string; total_cents: number };

/**
 * "Raise a credit note" from Refunds & credits. A credit note always gives back money collected
 * against one invoice, so this asks which, then opens that invoice — where the note is raised, with
 * its amount capped by what was paid and the second-approver rule applied.
 */
export function RaiseCreditNotePicker({ invoices }: { invoices: PaidInvoice[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = useMemo(() => invoices.filter((invoice) => !needle || invoice.number.toLowerCase().includes(needle) || invoice.tenant_name.toLowerCase().includes(needle)).slice(0, 50), [invoices, needle]);

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>Raise a credit note</Button>
      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setQuery(""); setChosen(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Raise a credit note</DialogTitle>
            <DialogDescription>Choose the paid invoice the money goes back against. The note is raised from that invoice, so its amount and approval rules follow what was actually collected.</DialogDescription>
          </DialogHeader>
          {invoices.length === 0 ? (
            <p className="text-[14px] text-[var(--muted)]">No invoice has been paid yet, so there is nothing to give back.</p>
          ) : (
            <div className="flex flex-col gap-2">
              <Input type="search" aria-label="Search paid invoices" placeholder="Search invoice or tenant" value={query} onChange={(event) => setQuery(event.target.value)} />
              <div role="listbox" aria-label="Paid invoices" className="max-h-[320px] overflow-y-auto rounded-[8px] border border-[var(--border)]">
                {matches.map((invoice) => (
                  <button key={invoice.id} type="button" role="option" aria-selected={chosen === invoice.id} onClick={() => setChosen(invoice.id)} className={`flex w-full items-center justify-between gap-3 border-t border-[var(--border)] px-3 py-2 text-left first:border-t-0 ${chosen === invoice.id ? "bg-[var(--brand-50)]" : "hover:bg-[var(--surface-alt)]"}`}>
                    <span className="min-w-0"><span className="block text-[14px] font-semibold text-[var(--ink)] tabular-nums">{invoice.number}</span><span className="block truncate text-[12px] text-[var(--muted)]">{invoice.tenant_name}</span></span>
                    <span className="text-[14px] font-semibold tabular-nums text-[var(--ink)]">{formatCentsAsCurrency(invoice.total_cents)}</span>
                  </button>
                ))}
                {matches.length === 0 && <p className="px-3 py-4 text-[14px] text-[var(--muted)]">No paid invoice matches &ldquo;{query.trim()}&rdquo;.</p>}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!chosen} onClick={() => router.push(`/admin/invoices/${chosen}`)}>Open the invoice</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

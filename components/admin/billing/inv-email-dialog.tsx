"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { notify } from "@/lib/notify";

export type InvoiceEmailPreview =
  | { ok: true; to: string; subject: string; text: string; delivery: "on" | "off" }
  | { ok: false; reason: string };

/**
 * "Email to customer" (billing-r2 screen 5): the exact email, previewed — recipient, subject and body — then
 * sent through POST /api/admin/invoices/[id]/email. When email delivery is off here the dialog says so before
 * sending, and the send is recorded (Emails sent shows it as not sent) rather than claimed.
 */
export function InvoiceEmailDialog({ invoiceId, number, preview, canAct }: { invoiceId: string; number: string; preview: InvoiceEmailPreview; canAct: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const blocked = !canAct ? "Only billing admins and super admins can email an invoice." : preview.ok ? null : preview.reason;

  async function send() {
    setBusy(true);
    const res = await fetch(`/api/admin/invoices/${invoiceId}/email`, { method: "POST" });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      notify.block(body?.error ?? "Could not email the invoice");
      return;
    }
    if (body?.delivered) notify.done(body.message);
    else notify.warn(body?.message ?? "Recorded, not sent");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button type="button" variant="ghost" className="px-2.5" disabled={Boolean(blocked)} title={blocked ?? undefined} onClick={() => setOpen(true)}>
        <Mail aria-hidden="true" />Email to customer
      </Button>
      {preview.ok && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent size="lg">
            <DialogHeader>
              <DialogTitle>Email {number} to the customer</DialogTitle>
              <DialogDescription>
                {preview.delivery === "on"
                  ? "This is the email that will be sent. It links to the owner's own copy of the invoice."
                  : "Email delivery is off here, so this will be recorded under Emails sent but not delivered."}
              </DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">To</dt><dd className="min-w-0 truncate text-foreground">{preview.to}</dd>
              <dt className="text-muted-foreground">Subject</dt><dd className="min-w-0 text-foreground">{preview.subject}</dd>
            </dl>
            <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-[var(--surface-alt)] p-3 font-sans text-sm leading-6 text-foreground">{preview.text}</pre>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button type="button" onClick={() => void send()} disabled={busy}>{preview.delivery === "on" ? "Send email" : "Record without sending"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

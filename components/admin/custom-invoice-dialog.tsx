"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Line = { label: string; amount: string };

export function CustomInvoiceDialog({ tenants }: { tenants: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tenantId, setTenantId] = useState("");
  const [reason, setReason] = useState("");
  const [dueDays, setDueDays] = useState("15");
  const [lines, setLines] = useState<Line[]>([{ label: "", amount: "" }]);

  function setLine(index: number, patch: Partial<Line>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function submit() {
    setBusy(true);

    // Net-15 by default, which is the term the ticket specifies for manual billing.
    const dueAt = new Date(Date.now() + Number(dueDays || 15) * 86_400_000).toISOString();

    const res = await fetch("/api/admin/invoices/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        reason: reason.trim(),
        due_at: dueAt,
        lines: lines.filter((l) => l.label.trim() && l.amount.trim()),
      }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);

    if (!res.ok) {
      toast.error(body?.error ?? "Could not create the invoice");
      return;
    }

    // The invoice exists either way; whether it could be sent for online payment is a separate
    // outcome and is reported as such rather than as a failure.
    if (body.sendWarning) toast.warning(`${body.number} created. ${body.sendWarning}`);
    else toast.success(`${body.number} created and sent`);

    setOpen(false);
    setReason("");
    setLines([{ label: "", amount: "" }]);
    router.refresh();
  }

  const ready = tenantId && reason.trim().length >= 5 && lines.some((l) => l.label.trim() && l.amount.trim());

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Custom invoice
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Raise a custom invoice</DialogTitle>
            <DialogDescription>
              For anything outside a subscription — a negotiated deal, a one-off service, a setup fee.
              It takes its number from the same sequence as automatic invoices.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Tenant</Label>
              <Select value={tenantId} onValueChange={setTenantId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a tenant…" />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((tenant) => (
                    <SelectItem key={tenant.id} value={tenant.id}>
                      {tenant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason</Label>
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Agreed migration fee, per contract of 14 August"
              />
              <p className="text-xs text-muted-foreground">Required, and recorded in the audit log.</p>
            </div>

            <div className="space-y-1.5">
              <Label>Lines</Label>
              {lines.map((line, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={line.label}
                    onChange={(e) => setLine(index, { label: e.target.value })}
                    placeholder="Data migration"
                    className="flex-1"
                  />
                  <Input
                    value={line.amount}
                    onChange={(e) => setLine(index, { amount: e.target.value })}
                    placeholder="500.00"
                    className="w-28"
                  />
                  {lines.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setLines((c) => c.filter((_, i) => i !== index))}
                    >
                      <X />
                      <span className="sr-only">Remove line</span>
                    </Button>
                  )}
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLines((c) => [...c, { label: "", amount: "" }])}
              >
                <Plus />
                Add line
              </Button>
            </div>

            <div className="w-32 space-y-1.5">
              <Label htmlFor="due">Due in (days)</Label>
              <Input id="due" value={dueDays} onChange={(e) => setDueDays(e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy || !ready}>
              Raise invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

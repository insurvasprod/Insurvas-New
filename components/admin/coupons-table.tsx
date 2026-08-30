"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCentsAsCurrency, BILLING_CYCLE_LABELS } from "@/lib/money";
import { COUPON_DURATION_LABELS, type CouponRow } from "@/lib/coupons/constants";
import { couponRejectionReason } from "@/lib/coupons/discount";
import { tableHeaderRow, tableHeadCell, tableShell } from "./table-styles";

function describeValue(coupon: CouponRow): string {
  return coupon.discount_type === "percent"
    ? `${coupon.percent_off}% off`
    : `${formatCentsAsCurrency(coupon.amount_off_cents ?? 0)} off`;
}

function describeDuration(coupon: CouponRow): string {
  if (coupon.duration === "n_periods") {
    const cycle = coupon.billing_cycle ? BILLING_CYCLE_LABELS[coupon.billing_cycle as "monthly"] : "period";
    return `${coupon.duration_periods} × ${cycle.toLowerCase()}`;
  }
  return COUPON_DURATION_LABELS[coupon.duration];
}

export function CouponsTable({ initialCoupons }: { initialCoupons: CouponRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    code: "",
    discount_type: "percent" as "percent" | "fixed",
    percent_off: "50",
    amount_off: "",
    duration: "n_periods" as "once" | "n_periods" | "forever",
    duration_periods: "3",
    billing_cycle: "monthly" as "monthly" | "quarterly" | "yearly",
    max_redemptions: "",
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function create() {
    setBusy(true);
    const res = await fetch("/api/admin/coupons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.code.trim().toUpperCase(),
        discount_type: form.discount_type,
        percent_off: form.discount_type === "percent" ? Number(form.percent_off) : null,
        amount_off: form.discount_type === "fixed" ? form.amount_off.trim() : null,
        duration: form.duration,
        duration_periods: form.duration === "n_periods" ? Number(form.duration_periods) : null,
        billing_cycle: form.billing_cycle,
        max_redemptions: form.max_redemptions ? Number(form.max_redemptions) : null,
      }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);

    if (!res.ok) {
      toast.error(body?.error ?? "Could not create the coupon");
      return;
    }

    toast.success(`${form.code.toUpperCase()} created`);
    setOpen(false);
    setForm((f) => ({ ...f, code: "" }));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {initialCoupons.length} coupon{initialCoupons.length === 1 ? "" : "s"}
        </span>
        <Button size="sm" onClick={() => setOpen(true)}>
          New coupon
        </Button>
      </div>

      <div className={tableShell}>
        <Table>
          <TableHeader>
            <TableRow className={tableHeaderRow}>
              <TableHead className={tableHeadCell}>Code</TableHead>
              <TableHead className={tableHeadCell}>Discount</TableHead>
              <TableHead className={tableHeadCell}>Duration</TableHead>
              <TableHead className={tableHeadCell}>Redeemed</TableHead>
              <TableHead className={tableHeadCell}>Expires</TableHead>
              <TableHead className={tableHeadCell}>State</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialCoupons.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  No coupons yet.
                </TableCell>
              </TableRow>
            ) : (
              initialCoupons.map((coupon) => {
                const rejection = couponRejectionReason({
                  isActive: coupon.is_active,
                  expiresAt: coupon.expires_at,
                  maxRedemptions: coupon.max_redemptions,
                  redeemedCount: coupon.redeemed_count,
                });

                return (
                  <TableRow key={coupon.id}>
                    <TableCell className="font-mono font-medium">{coupon.code}</TableCell>
                    <TableCell>{describeValue(coupon)}</TableCell>
                    <TableCell className="text-sm">{describeDuration(coupon)}</TableCell>
                    <TableCell className="text-sm">
                      {coupon.redeemed_count}
                      {coupon.max_redemptions !== null && ` / ${coupon.max_redemptions}`}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {coupon.expires_at ? new Date(coupon.expires_at).toLocaleDateString() : "Never"}
                    </TableCell>
                    <TableCell>
                      {rejection ? (
                        <Badge
                          variant="outline"
                          className="border-transparent bg-muted text-[10px] text-muted-foreground"
                          title={rejection}
                        >
                          Unusable
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-transparent bg-[var(--color-success)]/10 text-[10px] text-[var(--color-success)]"
                        >
                          Usable
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New coupon</DialogTitle>
            <DialogDescription>
              Creates a promo code at the payment provider, which is what actually reduces the charge.
              The code is what a customer enters at checkout.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="code">Code</Label>
              <Input
                id="code"
                value={form.code}
                onChange={(e) => set("code", e.target.value)}
                placeholder="WELCOME50"
                className="font-mono uppercase"
              />
            </div>

            <div className="flex gap-3">
              <div className="flex-1 space-y-1.5">
                <Label>Type</Label>
                <Select value={form.discount_type} onValueChange={(v) => set("discount_type", v as "percent")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percentage</SelectItem>
                    <SelectItem value="fixed">Fixed amount</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 space-y-1.5">
                <Label htmlFor="value">{form.discount_type === "percent" ? "Percent off" : "Amount off"}</Label>
                {form.discount_type === "percent" ? (
                  <Input id="value" value={form.percent_off} onChange={(e) => set("percent_off", e.target.value)} />
                ) : (
                  <Input
                    id="value"
                    value={form.amount_off}
                    onChange={(e) => set("amount_off", e.target.value)}
                    placeholder="25.00"
                  />
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1 space-y-1.5">
                <Label>Duration</Label>
                <Select value={form.duration} onValueChange={(v) => set("duration", v as "once")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="once">One billing period</SelectItem>
                    <SelectItem value="n_periods">A number of periods</SelectItem>
                    <SelectItem value="forever">Forever</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {form.duration === "n_periods" && (
                <div className="w-28 space-y-1.5">
                  <Label htmlFor="periods">Periods</Label>
                  <Input
                    id="periods"
                    value={form.duration_periods}
                    onChange={(e) => set("duration_periods", e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <div className="flex-1 space-y-1.5">
                <Label>Billing cycle</Label>
                <Select value={form.billing_cycle} onValueChange={(v) => set("billing_cycle", v as "monthly")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Periods are converted to months for the provider, so 3 periods means 3 invoices on
                  whichever cycle this is for.
                </p>
              </div>

              <div className="w-32 space-y-1.5">
                <Label htmlFor="max">Max uses</Label>
                <Input
                  id="max"
                  value={form.max_redemptions}
                  onChange={(e) => set("max_redemptions", e.target.value)}
                  placeholder="∞"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={create} disabled={busy || form.code.trim().length < 3}>
              Create coupon
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

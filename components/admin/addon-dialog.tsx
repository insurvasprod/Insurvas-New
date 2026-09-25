"use client";

import { useState, type FormEvent } from "react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BILLING_CYCLE_LABELS, BILLING_CYCLES, formatCentsAsCurrency, type BillingCycle } from "@/lib/money";
import { ADDON_CODE_RULE, type AddonRow } from "@/lib/addons/constants";
import type { PlanListRow } from "@/lib/plans/constants";
import { Callout } from "@/components/app/settings/primitives";

export type AddonFeatureOption = { key: string; label: string; module: string };
export type AddonMeterOption = { key: string; label: string; unit: string };

export function AddonDialog({
  mode,
  open,
  addon,
  features,
  meters,
  plans,
  billedCount = null,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  open: boolean;
  addon?: AddonRow | null;
  features: AddonFeatureOption[];
  meters: AddonMeterOption[];
  plans: PlanListRow[];
  /**
   * Live attachments the billing run still invoices; above zero, price and cycle are locked. Null
   * when the count could not be read — the server still refuses a change, so the fields stay open
   * and the dialog says why it cannot tell.
   */
  billedCount?: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const edit = mode === "edit";
  const priceLocked = edit && billedCount !== null && billedCount > 0;
  const [code, setCode] = useState(addon?.code ?? "");
  const [name, setName] = useState(addon?.name ?? "");
  const [description, setDescription] = useState(addon?.description ?? "");
  const [price, setPrice] = useState(addon ? String(addon.price_cents / 100) : "");
  const [cycle, setCycle] = useState<BillingCycle>(addon?.billing_cycle ?? "monthly");
  const [sortOrder, setSortOrder] = useState(String(addon?.sort_order ?? 0));
  const [active, setActive] = useState(addon?.is_active ?? true);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>(addon?.feature_keys ?? []);
  const [selectedPlans, setSelectedPlans] = useState<string[]>(addon?.plan_ids ?? []);
  const [meterQuantities, setMeterQuantities] = useState<Record<string, string>>(
    Object.fromEntries((addon?.meters ?? []).map((meter) => [meter.meter_key, String(meter.included_qty)])),
  );
  const [loading, setLoading] = useState(false);

  function toggle(list: string[], value: string, setter: (next: string[]) => void) {
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalizedPrice = price.trim().replace(/[$,\s]/g, "");
    const priceCents = Math.round(Number(normalizedPrice) * 100);
    if (!/^\d+(?:\.\d{0,2})?$/.test(normalizedPrice) || !Number.isSafeInteger(priceCents) || priceCents < 0) {
      notify.block("Enter a valid non-negative price with no more than two decimals.");
      return;
    }
    if (edit && active !== addon?.is_active && !window.confirm(`${active ? "Restore" : "Archive"} ${name}? This changes whether it can be attached to subscriptions.`)) return;
    setLoading(true);
    const payload = {
      ...(edit ? {} : { code }),
      name,
      description,
      price_cents: priceCents,
      billing_cycle: cycle,
      is_active: active,
      sort_order: Number(sortOrder) || 0,
      feature_keys: selectedFeatures,
      meters: Object.entries(meterQuantities)
        .filter(([, quantity]) => quantity.trim() !== "")
        .map(([meter_key, quantity]) => ({ meter_key, included_qty: Number(quantity) })),
      plan_ids: selectedPlans,
    };
    const response = await fetch(edit ? `/api/admin/addons/${addon!.id}` : "/api/admin/addons", {
      method: edit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);
    setLoading(false);
    if (!response.ok) {
      notify.block(body?.error ?? "Could not save the add-on");
      return;
    }
    notify.done(edit ? `${name} updated` : `${name} added`);
    onSaved();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{edit ? `Edit ${addon?.name}` : "New add-on"}</DialogTitle>
            <DialogDescription>
              Add-ons feed the same entitlement engine as plans. Existing live attachments protect feature and meter grants from being changed in place.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-4">
            {priceLocked && (
              <Callout tone="warning" title={`Attached to ${billedCount!.toLocaleString("en-US")} live subscription${billedCount === 1 ? "" : "s"}`}>
                Price and billing cycle are locked while any subscription is still billed for this add-on. To change them, archive this add-on and create a new code.
              </Callout>
            )}
            {edit && billedCount === null && (
              <Callout tone="warning" title="Live attachments could not be checked">
                If any subscription is still billed for this add-on, saving a new price or billing cycle will be refused.
              </Callout>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="addon-code">Code</Label>
                <Input id="addon-code" required disabled={edit} value={code} onChange={(event) => setCode(event.target.value)} placeholder="extra_seats" />
                <p className="text-xs text-muted-foreground">{edit ? "Permanent once created." : ADDON_CODE_RULE + "."}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="addon-name">Name</Label>
                <Input id="addon-name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Extra seats" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="addon-price">Price (USD)</Label>
                <Input id="addon-price" required disabled={priceLocked} inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="15.00" />
                <p className="text-xs text-muted-foreground">
                  {priceLocked
                    ? "Locked while attached to live subscriptions."
                    : `Stored as integer cents. Preview: ${price && Number.isFinite(Number(price)) ? formatCentsAsCurrency(Math.round(Number(price) * 100)) : "—"}.`}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="addon-cycle">Billing cycle</Label>
                <select id="addon-cycle" disabled={priceLocked} value={cycle} onChange={(event) => setCycle(event.target.value as BillingCycle)} className="flex h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60">
                  {BILLING_CYCLES.map((item) => <option key={item} value={item}>{BILLING_CYCLE_LABELS[item]}</option>)}
                </select>
                <p className="text-xs text-muted-foreground">
                  Must match the subscription&apos;s cycle to attach. Attaching or detaching mid-period isn&apos;t prorated: the period invoice charges the full price of every add-on attached when it runs.
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="addon-description">Description</Label>
              <Input id="addon-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional explanation for admins" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="addon-sort">Sort order</Label>
                <Input id="addon-sort" type="number" min={0} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} />
              </div>
              <label className="flex items-center gap-2 pt-7 text-sm">
                <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} className="size-4 accent-primary" />
                Available for new attachments
              </label>
            </div>

            <fieldset className="space-y-2 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">Feature grants</legend>
              <p className="text-xs text-muted-foreground">Archived features are intentionally unavailable for new add-ons.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {features.map((feature) => (
                  <label key={feature.key} className="flex items-start gap-2 rounded-md p-1.5 text-sm hover:bg-muted/50">
                    <input type="checkbox" checked={selectedFeatures.includes(feature.key)} onChange={() => toggle(selectedFeatures, feature.key, setSelectedFeatures)} className="mt-0.5 size-4 accent-primary" />
                    <span><span className="block">{feature.label}</span><code className="text-xs text-muted-foreground">{feature.key}</code></span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">Meter credits</legend>
              {meters.length === 0 ? <p className="text-sm text-muted-foreground">No meters are configured.</p> : <div className="grid gap-3 sm:grid-cols-2">
                {meters.map((meter) => (
                  <div key={meter.key} className="space-y-1">
                    <Label htmlFor={`addon-meter-${meter.key}`}>{meter.label} ({meter.unit}s)</Label>
                    <Input id={`addon-meter-${meter.key}`} type="number" min={1} step={1} value={meterQuantities[meter.key] ?? ""} onChange={(event) => setMeterQuantities((current) => ({ ...current, [meter.key]: event.target.value }))} placeholder="Not included" />
                  </div>
                ))}
              </div>}
            </fieldset>

            <fieldset className="space-y-2 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">Available on plans</legend>
              <p className="text-xs text-muted-foreground">This controls the normal attach picker; a separately audited override can still attach an off-plan add-on. Each plan is listed at its latest version; older versions keep the availability they already have.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {plans.map((plan) => (
                  <label key={plan.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={selectedPlans.includes(plan.id)} onChange={() => toggle(selectedPlans, plan.id, setSelectedPlans)} className="size-4 accent-primary" />
                    {plan.name} <span className="text-xs text-muted-foreground">({plan.code})</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <DialogFooter><Button type="submit" disabled={loading}>{loading ? "Saving…" : edit ? "Save add-on" : "Create add-on"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

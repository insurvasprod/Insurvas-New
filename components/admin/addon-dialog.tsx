"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { notify } from "@/lib/notify";

import { AuditHistory, shortDay } from "@/components/admin/catalog/plan-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/page-states";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { UnderlineTabs } from "@/components/ui/view-tabs";
import { BILLING_CYCLE_LABELS, BILLING_CYCLES, formatCentsAsCurrency, type BillingCycle } from "@/lib/money";
import { ADDON_CODE_RULE, type AddonRow } from "@/lib/addons/constants";
import { CYCLE_SUFFIX } from "@/lib/addons/catalogView";
import type { AddonSheetData } from "@/lib/addons/sheet";
import type { PlanListRow } from "@/lib/plans/constants";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { inputControl } from "@/components/ui/field";
import { cn } from "@/lib/utils";

import { CheckBox } from "@/components/ui/check-box";
export type AddonFeatureOption = { key: string; label: string; module: string };
export type AddonMeterOption = { key: string; label: string; unit: string };

type Part = "details" | "holders" | "history";

const ROW = "flex min-h-11 min-w-0 items-center gap-3 border-b border-border px-4 py-2 text-sm last:border-b-0";
const SUB_TONE: Record<string, StatusTone> = { active: "good", trialing: "info", past_due: "warning", cancelling: "warning", paused: "neutral", suspended: "danger" };
const FORM_ID = "addon-form";

/**
 * An add-on as a right sheet (admin round 1, catalog.html screen 3; it was a dialog). New add-on opens the same
 * form on its own. An existing one has Details (the editor: code, name, price and cycle — locked while anyone is
 * billed — description, sort, availability, feature grants, meter credits and plans), Who has it (each live
 * attachment, opening its subscription) and History (the audit log). Saving and the archive/restore confirm go
 * through the same routes as before.
 */
export function AddonDialog({
  mode,
  addon,
  features,
  meters,
  plans,
  billedCount = null,
  sheet = null,
  sheetLoading = false,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  addon?: AddonRow | null;
  features: AddonFeatureOption[];
  meters: AddonMeterOption[];
  plans: PlanListRow[];
  /**
   * Live attachments the billing run still invoices; above zero, price and cycle are locked. Null
   * when the count could not be read — the server still refuses a change, so the fields stay open
   * and the sheet says why it cannot tell.
   */
  billedCount?: number | null;
  /** Who has it and its history, read on the server when the address names this add-on. */
  sheet?: AddonSheetData | null;
  sheetLoading?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const edit = mode === "edit";
  const priceLocked = edit && billedCount !== null && billedCount > 0;
  const [part, setPart] = useState<Part>("details");
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
    if (edit && active !== addon?.is_active && !(await confirmAction({ title: `${active ? "Restore" : "Archive"} ${name}?`, description: "This changes whether it can be attached to subscriptions.", confirmLabel: active ? "Restore add-on" : "Archive add-on", cancelLabel: "Keep as it is", destructive: !active }))) return;
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

  const lockLine = priceLocked
    ? { tone: "bg-[var(--warning)]", text: `Attached to ${billedCount!.toLocaleString("en-US")} live subscription${billedCount === 1 ? "" : "s"}: price and billing cycle are locked while any subscription is still billed for it. To change them, archive this add-on and create a new code.` }
    : edit && billedCount === null
      ? { tone: "bg-[var(--warning)]", text: "Live attachments could not be checked. If any subscription is still billed for this add-on, saving a new price or billing cycle will be refused." }
      : null;

  const form = (
    <form id={FORM_ID} onSubmit={submit} className="flex flex-col gap-5 p-4">
      {lockLine && (
        <p className="m-0 flex items-start gap-2 text-xs leading-[1.5] text-muted-foreground" role="status">
          <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", lockLine.tone)} aria-hidden="true" />
          {lockLine.text}
        </p>
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
          <select id="addon-cycle" disabled={priceLocked} value={cycle} onChange={(event) => setCycle(event.target.value as BillingCycle)} className={inputControl}>
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
          <CheckBox checked={active} onChange={(event) => setActive(event.target.checked)} />
          Available for new attachments
        </label>
      </div>

      <fieldset className="space-y-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Feature grants</legend>
        <p className="text-xs text-muted-foreground">Archived features are intentionally unavailable for new add-ons.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {features.map((feature) => (
            <label key={feature.key} className="flex items-start gap-2 rounded-md p-1.5 text-sm hover:bg-muted/50">
              <CheckBox checked={selectedFeatures.includes(feature.key)} onChange={() => toggle(selectedFeatures, feature.key, setSelectedFeatures)} className="mt-0.5" />
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
              <CheckBox checked={selectedPlans.includes(plan.id)} onChange={() => toggle(selectedPlans, plan.id, setSelectedPlans)} />
              {plan.name} <span className="text-xs text-muted-foreground">({plan.code})</span>
            </label>
          ))}
        </div>
      </fieldset>
    </form>
  );

  const holders = sheet?.holders;
  const sections = edit ? (
    <UnderlineTabs
      label={`${addon?.name ?? "Add-on"} sections`}
      value={part}
      onChange={setPart}
      tabs={[
        { key: "details", label: "Details" },
        { key: "holders", label: "Who has it", count: holders ? holders.length : billedCount },
        { key: "history", label: "History", count: sheet?.history?.length ?? null },
      ]}
    />
  ) : null;

  const loadingBody = (
    <div role="status" aria-live="polite" className="flex flex-col gap-3 p-4">
      <span className="sr-only">Loading</span>
      {Array.from({ length: 5 }, (_, i) => <span key={i} aria-hidden="true" className="m-skel h-6 w-full rounded-md" />)}
    </div>
  );

  return (
    <Sheet
      title={edit ? addon?.name ?? "Add-on" : "New add-on"}
      subtitle={edit && addon ? `${addon.code} · ${formatCentsAsCurrency(addon.price_cents)} ${CYCLE_SUFFIX[addon.billing_cycle]}` : "Add-ons feed the same entitlement engine as plans."}
      status={edit && addon ? <StatusChip tone={addon.is_active ? "good" : "neutral"} dot>{addon.is_active ? "Active" : "Retired"}</StatusChip> : undefined}
      className="lg:w-[min(720px,calc(100vw-80px))]"
      onClose={onClose}
      closeLabel={edit ? "Close the add-on" : "Close without saving"}
      bodyClassName="flex flex-col"
      footer={
        <>
          <span className="flex-1" />
          <Button type="button" variant="ghost" onClick={onClose}>{part === "details" ? "Cancel" : "Close"}</Button>
          {part === "details" && <Button type="submit" form={FORM_ID} disabled={loading}>{loading ? "Saving…" : edit ? "Save add-on" : "Create add-on"}</Button>}
        </>
      }
    >
      {sections && <div className="sticky top-0 z-10 bg-card px-4">{sections}</div>}
      {part === "details" && form}
      {part === "holders" && (
        sheetLoading || sheet === null ? loadingBody
          : holders === null || holders === undefined ? <EmptyState title="Who has it could not be read" hint="Reload the page; if it keeps failing, the error is in the server log." />
            : holders.length === 0 ? <EmptyState title="Nobody has it" hint="Live attachments on subscriptions that are not cancelled are listed here." />
              : (
                <ul className="m-0 list-none p-0" aria-label={`Who has ${addon?.name ?? "this add-on"}`}>
                  {holders.map((holder) => (
                    <li key={holder.subscriptionId}>
                      <Link href={`/admin/subscriptions?open=${holder.subscriptionId}`} className={cn(ROW, "text-foreground no-underline hover:bg-[var(--hover-wash)]")}>
                        <span className="min-w-0 flex-1 truncate font-medium">{holder.tenantName}{holder.overridden && <span className="font-normal text-muted-foreground"> · off-plan override</span>}</span>
                        <span className="hidden w-36 shrink-0 truncate text-muted-foreground sm:block">{holder.plan ?? "—"}</span>
                        <span className="w-28 shrink-0 whitespace-nowrap tabular-nums text-muted-foreground" title="Attached since">{shortDay(holder.attachedAt)}</span>
                        <StatusChip tone={SUB_TONE[holder.status] ?? "neutral"}>{holder.status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</StatusChip>
                      </Link>
                    </li>
                  ))}
                </ul>
              )
      )}
      {part === "history" && (sheetLoading || sheet === null ? loadingBody : <AuditHistory items={sheet.history} empty="Creating, editing and archiving this add-on is recorded here." />)}
    </Sheet>
  );
}

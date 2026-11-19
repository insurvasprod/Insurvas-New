"use client";

import { useState, type FormEvent } from "react";

import { Field, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CREDIT_METER_KEYS, CREDIT_METER_LABELS, type CreditMeterKey, type CreditPack, type CreditTenant } from "@/lib/creditsLimits/constants";
import { formatCentsAsCurrency } from "@/lib/money";
import { notify } from "@/lib/notify";

const count = (value: number) => value.toLocaleString("en-US");
const ERROR = "m-0 text-sm leading-[1.5] text-[var(--error-ink)]";

function newRequestId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : undefined;
}

type PackForm = { name: string; meter_key: CreditMeterKey; quantity: string; price_cents: string };
const emptyPack: PackForm = { name: "", meter_key: "tcpa_checks", quantity: "5000", price_cents: "4500" };

/** Add or edit a credit pack (Credits & limits, kept from the old panel). Render it only while it is open. */
export function PackDialog({ pack, onClose, onSaved }: { pack: CreditPack | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<PackForm>(() => (pack ? { name: pack.name, meter_key: pack.meter_key, quantity: String(pack.quantity), price_cents: String(pack.price_cents) } : emptyPack));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const body = { ...form, quantity: Number(form.quantity), price_cents: Number(form.price_cents) };
    const response = await fetch(pack ? `/api/admin/credits-limits/packs/${pack.id}` : "/api/admin/credits-limits", {
      method: pack ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const result = response ? await response.json().catch(() => null) : null;
    setBusy(false);
    if (!response || !response.ok) {
      setError(result?.error ?? "Could not save credit pack");
      return;
    }
    notify.done(pack ? "Credit pack updated" : "Credit pack created");
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{pack ? `Edit ${pack.name}` : "Add a credit pack"}</DialogTitle>
            <DialogDescription>A reusable pack. Adding it to a tenant&apos;s invoice bills them and grants its credits at once.</DialogDescription>
          </DialogHeader>
          <Field label="Name" htmlFor="pack-name" required>
            <input id="pack-name" required maxLength={160} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="5,000 TCPA checks" className={control} />
          </Field>
          <Field label="Meter" htmlFor="pack-meter">
            <select id="pack-meter" value={form.meter_key} onChange={(event) => setForm({ ...form, meter_key: event.target.value as CreditMeterKey })} className={control}>
              {CREDIT_METER_KEYS.map((key) => <option key={key} value={key}>{CREDIT_METER_LABELS[key]}</option>)}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quantity" htmlFor="pack-quantity" required>
              <input id="pack-quantity" required type="number" min="1" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} className={control} />
            </Field>
            <Field label="Price (cents)" htmlFor="pack-price" required hint={Number.isFinite(Number(form.price_cents)) ? formatCentsAsCurrency(Number(form.price_cents)) : undefined}>
              <input id="pack-price" required type="number" min="0" value={form.price_cents} onChange={(event) => setForm({ ...form, price_cents: event.target.value })} className={control} />
            </Field>
          </div>
          {error && <p role="alert" className={ERROR}>{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : pack ? "Save pack" : "Create pack"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type GrantForm = { tenant_id: string; meter_key: CreditMeterKey; quantity: string; reason: string };

/**
 * Grant credits (kept). The request id is the grant's idempotency key: kept across retries of one grant, so a retry
 * after a failure can never grant twice (the route answers with the committed grant). Render it only while open.
 */
export function GrantDialog({ tenants, prefill, onClose, onGranted }: {
  tenants: CreditTenant[];
  prefill: { tenantId?: string; meter?: CreditMeterKey } | null;
  onClose: () => void;
  onGranted: () => void;
}) {
  const [grant, setGrant] = useState<GrantForm>({ tenant_id: prefill?.tenantId ?? tenants[0]?.id ?? "", meter_key: prefill?.meter ?? "tcpa_checks", quantity: "1000", reason: "" });
  const [requestId, setRequestId] = useState<string | undefined>(() => newRequestId());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function edit(patch: Partial<GrantForm>) {
    // Changing what is granted makes it a different request; retrying the same one keeps its id.
    setGrant((current) => ({ ...current, ...patch }));
    setRequestId(newRequestId());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch("/api/admin/credits-limits/grants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...grant, quantity: Number(grant.quantity), request_id: requestId }),
    }).catch(() => null);
    const result = response ? await response.json().catch(() => null) : null;
    setBusy(false);
    if (!response || !response.ok) {
      // The request id is kept, so pressing Grant again retries THIS grant and cannot make a second.
      setError(result?.error ?? "Could not grant credits");
      if (result?.granted) onGranted();
      return;
    }
    notify.done(result?.replayed ? "These credits were already granted" : "Credits granted");
    if (result?.warning) notify.warn(result.warning);
    onGranted();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Grant credits</DialogTitle>
            <DialogDescription>
              Credits add to this tenant&apos;s allowance immediately and count for the current billing period only: they end when the period rolls over. A reason is required and recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <Field label="Tenant" htmlFor="grant-tenant" required>
            <select id="grant-tenant" required value={grant.tenant_id} onChange={(event) => edit({ tenant_id: event.target.value })} className={control}>
              {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Meter" htmlFor="grant-meter">
              <select id="grant-meter" value={grant.meter_key} onChange={(event) => edit({ meter_key: event.target.value as CreditMeterKey })} className={control}>
                {CREDIT_METER_KEYS.map((key) => <option key={key} value={key}>{CREDIT_METER_LABELS[key]}</option>)}
              </select>
            </Field>
            <Field label="Quantity" htmlFor="grant-quantity" required>
              <input id="grant-quantity" required type="number" min="1" value={grant.quantity} onChange={(event) => edit({ quantity: event.target.value })} className={control} />
            </Field>
          </div>
          <Field label="Reason" htmlFor="grant-reason" required>
            <input id="grant-reason" required minLength={5} maxLength={500} value={grant.reason} onChange={(event) => setGrant({ ...grant, reason: event.target.value })} placeholder="Goodwill for an outage" className={control} />
          </Field>
          {error && <p role="alert" className={ERROR}>{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Granting…" : "Grant credits"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Add a pack to an invoice (kept): creates an invoice through the custom-invoice path and grants the pack's credits
 * in the same step. Render it only while open.
 */
export function PurchaseDialog({ pack, packs, tenants, tenantId, onClose, onDone }: {
  /** The pack to add; null lets the person pick one (from a usage row's sheet). */
  pack: CreditPack | null;
  /** The packs to pick from when `pack` is null. */
  packs: CreditPack[];
  tenants: CreditTenant[];
  tenantId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const sellable = packs.filter((p) => p.is_active && p.price_cents > 0);
  const [packId, setPackId] = useState(pack?.id ?? sellable[0]?.id ?? "");
  const chosen = pack ?? sellable.find((p) => p.id === packId) ?? null;
  const [purchase, setPurchase] = useState({ tenant_id: tenantId ?? tenants[0]?.id ?? "", quantity: "1", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!chosen) return;
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/admin/credits-limits/packs/${chosen.id}/purchase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...purchase, quantity: Number(purchase.quantity) }),
    }).catch(() => null);
    const result = response ? await response.json().catch(() => null) : null;
    setBusy(false);
    if (!response || !response.ok) {
      if (result?.purchased) {
        // Committed: close the dialog so it cannot be submitted a second time, and say so loudly.
        notify.fail(result.error);
        onDone();
        onClose();
        return;
      }
      setError(result?.error ?? "Could not add pack to invoice");
      return;
    }
    notify.done(`Added ${chosen.name} to invoice ${result.number}; the credits are granted`);
    onDone();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add {pack?.name ?? "a credit pack"} to an invoice</DialogTitle>
            <DialogDescription>
              Creates an invoice for the selected tenant through the custom-invoice path and grants the pack&apos;s credits in the same step, before the invoice is paid. Like any grant, the credits count for the current billing period only.
            </DialogDescription>
          </DialogHeader>
          {!pack && (
            <Field label="Pack" htmlFor="purchase-pack" required>
              {sellable.length === 0 ? (
                <p className="m-0 mt-1.5 text-sm text-muted-foreground">No pack is on sale with a price. Add one under Credit packs first.</p>
              ) : (
                <select id="purchase-pack" required value={packId} onChange={(event) => setPackId(event.target.value)} className={control}>
                  {sellable.map((p) => <option key={p.id} value={p.id}>{p.name} · {formatCentsAsCurrency(p.price_cents)}</option>)}
                </select>
              )}
            </Field>
          )}
          <Field label="Tenant" htmlFor="purchase-tenant" required>
            <select id="purchase-tenant" required value={purchase.tenant_id} onChange={(event) => setPurchase({ ...purchase, tenant_id: event.target.value })} className={control}>
              {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
            </select>
          </Field>
          <Field
            label="Number of packs"
            htmlFor="purchase-quantity"
            required
            hint={chosen ? `${count(chosen.quantity * (Number(purchase.quantity) || 0))} ${CREDIT_METER_LABELS[chosen.meter_key] ?? chosen.meter_key} · ${formatCentsAsCurrency(chosen.price_cents * (Number(purchase.quantity) || 0))}` : undefined}
          >
            <input id="purchase-quantity" required type="number" min="1" max="1000" value={purchase.quantity} onChange={(event) => setPurchase({ ...purchase, quantity: event.target.value })} className={control} />
          </Field>
          <Field label="Reason" htmlFor="purchase-reason" required>
            <input id="purchase-reason" required minLength={5} maxLength={500} value={purchase.reason} onChange={(event) => setPurchase({ ...purchase, reason: event.target.value })} placeholder="Customer requested a top-up" className={control} />
          </Field>
          {error && <p role="alert" className={ERROR}>{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !chosen}>{busy ? "Adding…" : "Add to invoice"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

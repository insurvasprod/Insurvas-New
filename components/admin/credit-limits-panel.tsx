"use client";

import { useCallback, useState, type FormEvent } from "react";
import { MoreHorizontal, Plus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CREDIT_METER_KEYS, CREDIT_METER_LABELS, type CreditMeterKey, type CreditPack, type CreditTenant, type MeterPricing, type UsageMonitorRow } from "@/lib/creditsLimits/constants";
import { tableHeaderRow, tableHeadCell, tableShell } from "./table-styles";

type Props = { initialPacks: CreditPack[]; initialPricing: MeterPricing[]; initialMonitor: UsageMonitorRow[]; initialTenants: CreditTenant[] };
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const quantity = (value: number | null) => value === null ? "Unlimited" : value.toLocaleString("en-US");

type PackForm = { name: string; meter_key: CreditMeterKey; quantity: string; price_cents: string; is_active: boolean };
const emptyPack: PackForm = { name: "", meter_key: "tcpa_checks", quantity: "5000", price_cents: "4500", is_active: true };

export function CreditLimitsPanel({ initialPacks, initialPricing, initialMonitor, initialTenants }: Props) {
  const [packs, setPacks] = useState(initialPacks);
  const [pricing, setPricing] = useState(initialPricing);
  const [monitor, setMonitor] = useState(initialMonitor);
  const [tenants] = useState(initialTenants);
  const [over80, setOver80] = useState(false);
  const [packForm, setPackForm] = useState<PackForm>(emptyPack);
  const [editingPack, setEditingPack] = useState<CreditPack | null>(null);
  const [grantOpen, setGrantOpen] = useState(false);
  const [purchasePack, setPurchasePack] = useState<CreditPack | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [grant, setGrant] = useState({ tenant_id: initialTenants[0]?.id ?? "", meter_key: "tcpa_checks" as CreditMeterKey, quantity: "1000", reason: "" });
  const [purchase, setPurchase] = useState({ tenant_id: initialTenants[0]?.id ?? "", quantity: "1", reason: "" });

  const refresh = useCallback(async (filter = over80) => {
    const response = await fetch(`/api/admin/credits-limits${filter ? "?over80=true" : ""}`);
    if (!response.ok) { toast.error("Could not refresh credits and limits"); return; }
    const next = await response.json();
    setPacks(next.packs); setPricing(next.pricing); setMonitor(next.monitor);
  }, [over80]);

  async function submitPack(event: FormEvent) {
    event.preventDefault(); setBusy("pack");
    const body = { ...packForm, quantity: Number(packForm.quantity), price_cents: Number(packForm.price_cents) };
    const response = await fetch(editingPack ? `/api/admin/credits-limits/packs/${editingPack.id}` : "/api/admin/credits-limits", { method: editingPack ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => null); setBusy(null);
    if (!response.ok) { toast.error(result?.error ?? "Could not save credit pack"); return; }
    toast.success(editingPack ? "Credit pack updated" : "Credit pack created"); setEditingPack(null); setPackForm(emptyPack); refresh(false);
  }

  async function archivePack(pack: CreditPack) {
    setBusy(pack.id);
    const response = await fetch(`/api/admin/credits-limits/packs/${pack.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: false }) });
    const result = await response.json().catch(() => null); setBusy(null);
    if (!response.ok) { toast.error(result?.error ?? "Could not archive pack"); return; }
    toast.success(`${pack.name} archived`); refresh(false);
  }

  async function savePricing(event: FormEvent, row: MeterPricing) {
    event.preventDefault(); setBusy(`pricing-${row.meter_key}`);
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const defaultRaw = String(form.get("default_included") ?? "").trim();
    const response = await fetch("/api/admin/credits-limits/pricing", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ meter_key: row.meter_key, sell_cents: Number(form.get("sell_cents")), default_included: defaultRaw === "" ? null : Number(defaultRaw) }) });
    const result = await response.json().catch(() => null); setBusy(null);
    if (!response.ok) { toast.error(result?.error ?? "Could not save pricing"); return; }
    toast.success(`${row.meter_key} pricing saved`); refresh(false);
  }

  async function submitGrant(event: FormEvent) {
    event.preventDefault(); setBusy("grant");
    const response = await fetch("/api/admin/credits-limits/grants", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...grant, quantity: Number(grant.quantity) }) });
    const result = await response.json().catch(() => null); setBusy(null);
    if (!response.ok) { toast.error(result?.error ?? "Could not grant credits"); return; }
    toast.success("Credits granted and usage monitor refreshed"); setGrantOpen(false); setGrant((current) => ({ ...current, reason: "" })); refresh(over80);
  }

  async function submitPurchase(event: FormEvent) {
    event.preventDefault(); if (!purchasePack) return; setBusy("purchase");
    const response = await fetch(`/api/admin/credits-limits/packs/${purchasePack.id}/purchase`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...purchase, quantity: Number(purchase.quantity) }) });
    const result = await response.json().catch(() => null); setBusy(null);
    if (!response.ok) { toast.error(result?.error ?? "Could not add pack to invoice"); return; }
    toast.success(`Added ${purchasePack.name} to invoice ${result.number}`); setPurchasePack(null); setPurchase((current) => ({ ...current, reason: "" }));
  }

  const warningCount = monitor.filter((row) => row.alert_level === "warning").length;
  const exhaustedCount = monitor.filter((row) => row.alert_level === "exhausted").length;

  return <div className="space-y-6">
    {(warningCount > 0 || exhaustedCount > 0) && <div role="alert" className={`flex items-start gap-3 rounded-lg border-2 p-4 text-sm ${exhaustedCount ? "border-[var(--color-danger)]/50 bg-[var(--color-danger)]/5 text-[var(--color-danger)]" : "border-amber-500/50 bg-amber-500/5 text-amber-700"}`}><ShieldAlert className="mt-0.5 size-5 shrink-0" /><div><p className="font-bold">Usage alerts: {exhaustedCount} exhausted · {warningCount} above 80%</p><p className="mt-1">Rows at 80% are warnings; rows at 100% have reached their included allowance.</p></div></div>}

    <Card><CardHeader className="flex flex-row items-center justify-between gap-3"><div><CardTitle>Meter pricing & defaults</CardTitle><p className="mt-1 text-sm text-muted-foreground">Defaults apply only when a plan has no allowance for that meter. Existing plan allowances win.</p></div></CardHeader><CardContent><div className={tableShell}><Table><TableHeader><TableRow className={tableHeaderRow}><TableHead className={tableHeadCell}>Meter</TableHead><TableHead className={tableHeadCell}>Vendor cost</TableHead><TableHead className={tableHeadCell}>Sell price</TableHead><TableHead className={tableHeadCell}>Default included</TableHead><TableHead className={`${tableHeadCell} w-24`} /></TableRow></TableHeader><TableBody>{pricing.map((row) => <TableRow key={row.meter_key}><TableCell className="font-medium">{CREDIT_METER_LABELS[row.meter_key]}</TableCell><TableCell>{money(row.cost_cents)} <span className="block text-xs text-muted-foreground">{row.cost_source === "compliance_vendor" ? "SA-4.8 vendor" : "Configured"}</span></TableCell><TableCell><form id={`pricing-${row.meter_key}`} onSubmit={(event) => savePricing(event, row)}><Input name="sell_cents" type="number" min="0" defaultValue={row.sell_cents} aria-label={`${row.meter_key} sell price in cents`} className={row.sell_cents <= row.cost_cents ? "border-[var(--color-danger)]" : undefined} /></form>{row.sell_cents <= row.cost_cents && <span className="text-xs font-semibold text-[var(--color-danger)]">Below cost</span>}</TableCell><TableCell><Input form={`pricing-${row.meter_key}`} name="default_included" type="number" min="0" defaultValue={row.default_included ?? ""} placeholder="Unlimited" aria-label={`${row.meter_key} default included`} /></TableCell><TableCell><Button size="sm" type="submit" form={`pricing-${row.meter_key}`} disabled={busy === `pricing-${row.meter_key}`}>{busy === `pricing-${row.meter_key}` ? "Saving…" : "Save"}</Button></TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>

    <Card><CardHeader className="flex flex-row items-center justify-between gap-3"><div><CardTitle>Credit packs</CardTitle><p className="mt-1 text-sm text-muted-foreground">Create reusable packs, then add one to a tenant invoice when support or billing needs it.</p></div><Button size="sm" onClick={() => { setEditingPack(null); setPackForm(emptyPack); }}>{/* keeps the action visible to keyboard users */}<Plus className="mr-1 size-4" />New pack</Button></CardHeader><CardContent><form onSubmit={submitPack} className="mb-5 grid gap-3 rounded-lg border bg-muted/20 p-4 md:grid-cols-[1.4fr_1fr_0.7fr_0.7fr_auto] md:items-end"><label className="space-y-1 text-sm"><span className="font-medium">Name</span><Input required value={packForm.name} onChange={(event) => setPackForm({ ...packForm, name: event.target.value })} placeholder="5,000 TCPA checks" /></label><label className="space-y-1 text-sm"><span className="font-medium">Meter</span><select className="flex h-9 w-full rounded-md border bg-background px-3 text-sm" value={packForm.meter_key} onChange={(event) => setPackForm({ ...packForm, meter_key: event.target.value as CreditMeterKey })}>{CREDIT_METER_KEYS.map((key) => <option key={key} value={key}>{CREDIT_METER_LABELS[key]}</option>)}</select></label><label className="space-y-1 text-sm"><span className="font-medium">Quantity</span><Input required type="number" min="1" value={packForm.quantity} onChange={(event) => setPackForm({ ...packForm, quantity: event.target.value })} /></label><label className="space-y-1 text-sm"><span className="font-medium">Price (cents)</span><Input required type="number" min="0" value={packForm.price_cents} onChange={(event) => setPackForm({ ...packForm, price_cents: event.target.value })} /></label><Button type="submit" disabled={busy === "pack"}>{busy === "pack" ? "Saving…" : editingPack ? "Update pack" : "Create pack"}</Button></form><div className={tableShell}><Table><TableHeader><TableRow className={tableHeaderRow}><TableHead className={tableHeadCell}>Pack</TableHead><TableHead className={tableHeadCell}>Quantity</TableHead><TableHead className={tableHeadCell}>Price</TableHead><TableHead className={tableHeadCell}>Status</TableHead><TableHead className={`${tableHeadCell} w-20`} /></TableRow></TableHeader><TableBody>{packs.map((pack) => <TableRow key={pack.id} className={!pack.is_active ? "opacity-60" : undefined}><TableCell className="font-medium">{pack.name}<span className="block text-xs text-muted-foreground">{CREDIT_METER_LABELS[pack.meter_key]}</span></TableCell><TableCell>{pack.quantity.toLocaleString("en-US")}</TableCell><TableCell>{money(pack.price_cents)}</TableCell><TableCell><Badge variant="outline">{pack.is_active ? "Active" : "Archived"}</Badge></TableCell><TableCell>{pack.is_active && <div className="flex items-center"><Button variant="ghost" size="icon-sm" onClick={() => { setEditingPack(pack); setPackForm({ name: pack.name, meter_key: pack.meter_key, quantity: String(pack.quantity), price_cents: String(pack.price_cents), is_active: pack.is_active }); }} title={`Edit ${pack.name}`}><MoreHorizontal /><span className="sr-only">Edit {pack.name}</span></Button><Button size="sm" variant="outline" onClick={() => setPurchasePack(pack)}>Invoice</Button><Button size="sm" variant="ghost" onClick={() => archivePack(pack)} disabled={busy === pack.id}>Archive</Button></div>}</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>

    <Card><CardHeader className="flex flex-row items-center justify-between gap-3"><div><CardTitle>Cross-tenant usage</CardTitle><p className="mt-1 text-sm text-muted-foreground">One server-side query returns tenant × meter, ordered by consumption.</p></div><div className="flex items-center gap-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={over80} onChange={(event) => { setOver80(event.target.checked); refresh(event.target.checked); }} /> Over 80%</label><Button size="sm" variant="outline" onClick={() => setGrantOpen(true)}>Grant credits</Button></div></CardHeader><CardContent><div className={tableShell}><Table><TableHeader><TableRow className={tableHeaderRow}><TableHead className={tableHeadCell}>Tenant</TableHead><TableHead className={tableHeadCell}>Meter</TableHead><TableHead className={tableHeadCell}>Used</TableHead><TableHead className={tableHeadCell}>Included</TableHead><TableHead className={tableHeadCell}>Consumed</TableHead><TableHead className={tableHeadCell}>State</TableHead></TableRow></TableHeader><TableBody>{monitor.length === 0 && <TableRow><TableCell colSpan={6} className="h-20 text-center text-sm text-muted-foreground">No usage rows match this filter.</TableCell></TableRow>}{monitor.map((row) => <TableRow key={`${row.tenant_id}-${row.meter_key}`}><TableCell className="font-medium">{row.tenant_name}<span className="block text-xs text-muted-foreground">{row.tenant_status}</span></TableCell><TableCell>{row.meter_label}</TableCell><TableCell>{row.used_qty.toLocaleString("en-US")}</TableCell><TableCell>{quantity(row.included_qty)}{row.grant_qty > 0 && <span className="block text-xs text-[var(--color-success)]">+{row.grant_qty.toLocaleString("en-US")} granted</span>}</TableCell><TableCell>{row.percent_used === null ? "—" : `${row.percent_used}%`}</TableCell><TableCell><Badge variant="outline" className={row.alert_level === "exhausted" ? "border-[var(--color-danger)] text-[var(--color-danger)]" : row.alert_level === "warning" ? "border-amber-500 text-amber-700" : ""}>{row.alert_level}</Badge></TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>

    <Dialog open={grantOpen} onOpenChange={setGrantOpen}><DialogContent><DialogHeader><DialogTitle>Grant credits</DialogTitle><DialogDescription>Credits add to this tenant&apos;s current-period allowance immediately. A reason is required and recorded in the audit log.</DialogDescription></DialogHeader><form onSubmit={submitGrant} className="space-y-4"><label className="space-y-1 text-sm"><span className="font-medium">Tenant</span><select required className="flex h-9 w-full rounded-md border bg-background px-3 text-sm" value={grant.tenant_id} onChange={(event) => setGrant({ ...grant, tenant_id: event.target.value })}>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label><div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1 text-sm"><span className="font-medium">Meter</span><select className="flex h-9 w-full rounded-md border bg-background px-3 text-sm" value={grant.meter_key} onChange={(event) => setGrant({ ...grant, meter_key: event.target.value as CreditMeterKey })}>{CREDIT_METER_KEYS.map((key) => <option key={key} value={key}>{CREDIT_METER_LABELS[key]}</option>)}</select></label><label className="space-y-1 text-sm"><span className="font-medium">Quantity</span><Input required type="number" min="1" value={grant.quantity} onChange={(event) => setGrant({ ...grant, quantity: event.target.value })} /></label></div><label className="space-y-1 text-sm"><span className="font-medium">Reason</span><Input required minLength={5} maxLength={500} value={grant.reason} onChange={(event) => setGrant({ ...grant, reason: event.target.value })} placeholder="Goodwill for an outage" /></label><DialogFooter><Button type="button" variant="outline" onClick={() => setGrantOpen(false)}>Cancel</Button><Button type="submit" disabled={busy === "grant"}>{busy === "grant" ? "Granting…" : "Grant credits"}</Button></DialogFooter></form></DialogContent></Dialog>

    <Dialog open={purchasePack !== null} onOpenChange={(open) => { if (!open) setPurchasePack(null); }}><DialogContent><DialogHeader><DialogTitle>Add {purchasePack?.name ?? "credit pack"} to invoice</DialogTitle><DialogDescription>This uses the existing custom-invoice path. It creates an invoice line for the selected tenant; credits should be granted separately after payment is confirmed.</DialogDescription></DialogHeader><form onSubmit={submitPurchase} className="space-y-4"><label className="space-y-1 text-sm"><span className="font-medium">Tenant</span><select required className="flex h-9 w-full rounded-md border bg-background px-3 text-sm" value={purchase.tenant_id} onChange={(event) => setPurchase({ ...purchase, tenant_id: event.target.value })}>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label><label className="space-y-1 text-sm"><span className="font-medium">Pack quantity</span><Input required type="number" min="1" max="1000" value={purchase.quantity} onChange={(event) => setPurchase({ ...purchase, quantity: event.target.value })} /></label><label className="space-y-1 text-sm"><span className="font-medium">Reason</span><Input required minLength={5} maxLength={500} value={purchase.reason} onChange={(event) => setPurchase({ ...purchase, reason: event.target.value })} placeholder="Customer requested a top-up" /></label><DialogFooter><Button type="button" variant="outline" onClick={() => setPurchasePack(null)}>Cancel</Button><Button type="submit" disabled={busy === "purchase"}>{busy === "purchase" ? "Adding…" : "Add to invoice"}</Button></DialogFooter></form></DialogContent></Dialog>
  </div>;
}

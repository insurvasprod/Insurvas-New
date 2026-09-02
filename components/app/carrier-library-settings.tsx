"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CarrierRow } from "@/lib/carriers/constants";
import type { AdvanceRuleRow, CommissionScheduleRow, TenantCarrierRow } from "@/lib/carriers/service";
import type { ProductRow } from "@/lib/products/constants";

type Snapshot = { carriers: CarrierRow[]; products: ProductRow[]; tenantCarriers: TenantCarrierRow[]; commissionSchedules: CommissionScheduleRow[]; advanceRules: AdvanceRuleRow[] };
const today = new Date().toISOString().slice(0, 10);
const percent = (bp: number) => `${(bp / 100).toFixed(2)}%`;

export function CarrierLibrarySettings() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selectedCarrierId, setSelectedCarrierId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [contractLevel, setContractLevel] = useState("");
  const [writingNumber, setWritingNumber] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [productCode, setProductCode] = useState("");
  const [policyYear, setPolicyYear] = useState("1");
  const [rate, setRate] = useState("");
  const [advanceMonths, setAdvanceMonths] = useState("");
  const [advanceRate, setAdvanceRate] = useState("");
  const [clawbackMonths, setClawbackMonths] = useState("");
  const [clawbackType, setClawbackType] = useState<"full" | "prorated">("full");

  const load = useCallback(async () => {
    setLoading(true); const response = await fetch("/api/app/carrier-library", { cache: "no-store" }); const body = await response.json().catch(() => null); setLoading(false);
    if (!response.ok) { toast.error(body?.error ?? "Could not load your carriers"); return; }
    setSnapshot(body); setSelectedCarrierId((current) => current || body.carriers[0]?.id || "");
    setProductCode((current) => current || body.products[0]?.code || "");
  }, []);
  // Initial data comes from the tenant-scoped API; this effect is the component's external-data
  // subscription and the refresh action reuses the same loader after writes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const selectedCarrier = snapshot?.carriers.find((row) => row.id === selectedCarrierId);
  const selectedContracts = useMemo(() => snapshot?.tenantCarriers.filter((row) => row.carrier_id === selectedCarrierId) ?? [], [snapshot, selectedCarrierId]);
  const selectedSchedules = useMemo(() => snapshot?.commissionSchedules.filter((row) => row.carrier_id === selectedCarrierId) ?? [], [snapshot, selectedCarrierId]);
  const selectedRules = useMemo(() => snapshot?.advanceRules.filter((row) => row.carrier_id === selectedCarrierId) ?? [], [snapshot, selectedCarrierId]);
  const currentLevel = selectedContracts.find((row) => row.is_active)?.contract_level_bp ?? Number(contractLevel);

  async function save(path: string, key: string, body: Record<string, unknown>, success: string) {
    setSaving(key); const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const result = await response.json().catch(() => null); setSaving(null);
    if (!response.ok) { toast.error(result?.error ?? "Could not save changes"); return; }
    toast.success(success); await load();
  }
  function saveContract(event: FormEvent) { event.preventDefault(); return save("/api/app/carrier-library/tenant-carriers", "contract", { carrier_id: selectedCarrierId, contract_level_bp: contractLevel, writing_number: writingNumber, effective_from: effectiveFrom }, "Carrier contract saved"); }
  function saveSchedule(event: FormEvent) { event.preventDefault(); return save("/api/app/carrier-library/commission-schedules", "schedule", { carrier_id: selectedCarrierId, product_code: productCode, contract_level_bp: currentLevel, policy_year: policyYear, rate_bp: rate, effective_from: effectiveFrom }, "Commission schedule saved"); }
  function saveRule(event: FormEvent) { event.preventDefault(); return save("/api/app/carrier-library/advance-rules", "rule", { carrier_id: selectedCarrierId, product_code: productCode, advance_months: advanceMonths, advance_pct_bp: advanceRate, clawback_months: clawbackMonths, clawback_type: clawbackType, effective_from: effectiveFrom }, "Advance rule saved"); }

  if (loading) return <Card><CardContent className="py-8 text-sm text-muted-foreground">Loading carrier library…</CardContent></Card>;
  if (!snapshot || snapshot.carriers.length === 0) return <Card><CardHeader><CardTitle>Carrier library</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">The platform has not added any carriers yet. Ask support to add one before configuring appointments.</CardContent></Card>;

  return <div className="space-y-6"><Card><CardHeader><CardTitle>Carriers & contract levels</CardTitle><p className="text-sm text-muted-foreground">Choose a carrier, then record the level and writing number. A new effective date preserves the older contract history.</p></CardHeader><CardContent className="space-y-4"><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{snapshot.carriers.map((carrier) => { const configured = snapshot.tenantCarriers.some((row) => row.carrier_id === carrier.id); return <button key={carrier.id} type="button" onClick={() => setSelectedCarrierId(carrier.id)} className={`rounded-lg border p-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-500)] ${selectedCarrierId === carrier.id ? "border-[var(--brand-500)] bg-[var(--color-blue-faint)]" : "hover:bg-muted/50"}`}><span className="font-medium">{carrier.name}</span><span className="mt-1 block text-xs text-muted-foreground">{configured ? "Contract configured" : "Not configured"}</span></button>; })}</div>{selectedCarrier && <form onSubmit={saveContract} className="grid gap-4 border-t pt-4 md:grid-cols-4"><div className="space-y-1.5"><Label htmlFor="contract-level">Contract level (basis points)</Label><Input id="contract-level" inputMode="numeric" value={contractLevel} onChange={(e) => setContractLevel(e.target.value)} required /><p className="text-xs text-muted-foreground">11,000 = 110.00%</p></div><div className="space-y-1.5"><Label htmlFor="writing-number">Writing / agent number</Label><Input id="writing-number" value={writingNumber} onChange={(e) => setWritingNumber(e.target.value)} required /></div><div className="space-y-1.5"><Label htmlFor="contract-effective">Effective from</Label><Input id="contract-effective" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required /></div><div className="flex items-end"><Button type="submit" disabled={saving === "contract"}>{saving === "contract" ? "Saving…" : `Save ${selectedCarrier?.name ?? "carrier"}`}</Button></div></form>}{selectedContracts.length > 0 && <div className="space-y-2"><p className="text-sm font-medium">Contract history for {selectedCarrier?.name ?? "carrier"}</p>{selectedContracts.map((row) => <div key={row.id} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm"><Badge variant={row.is_active ? "default" : "outline"}>{row.is_active ? "Current" : "History"}</Badge><span>{percent(row.contract_level_bp)} · {row.writing_number}</span><span className="text-muted-foreground">effective {row.effective_from}</span></div>)}</div>}</CardContent></Card>
    <div className="grid gap-6 xl:grid-cols-2"><Card><CardHeader><CardTitle>Commission schedule</CardTitle><p className="text-sm text-muted-foreground">Rates are basis points and effective-dated by product, contract level and policy year.</p></CardHeader><CardContent><form onSubmit={saveSchedule} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5 sm:col-span-2"><Label htmlFor="schedule-product">Product</Label><select id="schedule-product" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={productCode} onChange={(e) => setProductCode(e.target.value)} required>{snapshot.products.map((product) => <option key={product.code} value={product.code}>{product.name}</option>)}</select></div><div className="space-y-1.5"><Label htmlFor="schedule-year">Policy year</Label><Input id="schedule-year" type="number" min={1} max={100} value={policyYear} onChange={(e) => setPolicyYear(e.target.value)} required /></div><div className="space-y-1.5"><Label htmlFor="schedule-rate">Rate (basis points)</Label><Input id="schedule-rate" inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value)} required /><p className="text-xs text-muted-foreground">11,000 = 110.00%</p></div></div><Button type="submit" disabled={saving === "schedule" || selectedContracts.length === 0}>{selectedContracts.length === 0 ? "Save a contract first" : saving === "schedule" ? "Saving…" : "Save commission rate"}</Button></form>{selectedSchedules.length > 0 && <div className="mt-5 space-y-2">{selectedSchedules.slice(0, 8).map((row) => <div key={row.id} className="flex flex-wrap gap-2 text-sm"><span className="font-medium">{row.product_code}</span><span>year {row.policy_year}</span><span>{percent(row.rate_bp)}</span><span className="text-muted-foreground">from {row.effective_from}</span></div>)}</div>}</CardContent></Card>
      <Card><CardHeader><CardTitle>Advance rule</CardTitle><p className="text-sm text-muted-foreground">Record the carrier&apos;s year-one advance and clawback terms for the selected product.</p></CardHeader><CardContent><form onSubmit={saveRule} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5 sm:col-span-2"><Label htmlFor="advance-product">Product</Label><select id="advance-product" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={productCode} onChange={(e) => setProductCode(e.target.value)} required>{snapshot.products.map((product) => <option key={product.code} value={product.code}>{product.name}</option>)}</select></div><div className="space-y-1.5"><Label htmlFor="advance-months">Advance months</Label><Input id="advance-months" type="number" min={0} max={120} value={advanceMonths} onChange={(e) => setAdvanceMonths(e.target.value)} required /></div><div className="space-y-1.5"><Label htmlFor="advance-rate">Advance percent (basis points)</Label><Input id="advance-rate" inputMode="numeric" value={advanceRate} onChange={(e) => setAdvanceRate(e.target.value)} required /></div><div className="space-y-1.5"><Label htmlFor="clawback-months">Clawback months</Label><Input id="clawback-months" type="number" min={0} max={240} value={clawbackMonths} onChange={(e) => setClawbackMonths(e.target.value)} required /></div><div className="space-y-1.5"><Label htmlFor="clawback-type">Clawback type</Label><select id="clawback-type" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={clawbackType} onChange={(e) => setClawbackType(e.target.value as "full" | "prorated")}><option value="full">Full</option><option value="prorated">Prorated</option></select></div></div><Button type="submit" disabled={saving === "rule" || selectedContracts.length === 0}>{selectedContracts.length === 0 ? "Save a contract first" : saving === "rule" ? "Saving…" : "Save advance rule"}</Button></form>{selectedRules.length > 0 && <div className="mt-5 space-y-2">{selectedRules.slice(0, 8).map((row) => <div key={row.id} className="flex flex-wrap gap-2 text-sm"><span className="font-medium">{row.product_code}</span><span>{row.advance_months} months at {percent(row.advance_pct_bp)}</span><span>{row.clawback_type} clawback</span><span className="text-muted-foreground">from {row.effective_from}</span></div>)}</div>}</CardContent></Card></div>
  </div>;
}

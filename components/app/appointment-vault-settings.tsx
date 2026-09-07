"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CarrierRow } from "@/lib/carriers/constants";
import { US_STATES } from "@/lib/appointments/constants";
import { dueExpiryWarnings } from "@/lib/appointments/warnings";
import type { AppointmentRow, CeRecordRow, EoPolicyRow, LicenseRow } from "@/lib/appointments/service-types";

type TenantCarrier = { id: string; carrier_id: string; contract_level_bp: number; writing_number: string; effective_from: string; is_active: boolean };
type Vault = { carriers: CarrierRow[]; tenantCarriers: TenantCarrier[]; appointments: AppointmentRow[]; licenses: LicenseRow[]; eoPolicies: EoPolicyRow[]; ceRecords: CeRecordRow[] };
const today = new Date().toISOString().slice(0, 10);
const keyFor = (carrierId: string, state: string) => `${carrierId}:${state}`;

export function AppointmentVaultSettings() {
  const [vault, setVault] = useState<Vault | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [stateFilter, setStateFilter] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [license, setLicense] = useState({ state: "AZ", license_number: "", expires_at: "" });
  const [eo, setEo] = useState({ carrier: "", policy_number: "", expires_at: "", coverage_amount_cents: "" });
  const [ce, setCe] = useState({ state: "AZ", credits_required: "", credits_completed: "", deadline: "" });

  const load = useCallback(async () => {
    const response = await fetch("/api/app/appointment-vault", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) { toast.error(body?.error ?? "Could not load the appointment vault"); return; }
    const next = body as Vault;
    setVault(next);
    const latest = new Map<string, AppointmentRow>();
    for (const row of next.appointments) { const key = keyFor(row.carrier_id, row.state); if (!latest.has(key)) latest.set(key, row); }
    setSelected(new Set([...latest.values()].filter((row) => row.status === "active").map((row) => keyFor(row.carrier_id, row.state))));
  }, []);

  // The vault is external tenant data; the initial subscription and post-write refresh share this loader.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const configuredCarriers = useMemo(() => {
    if (!vault) return [];
    const ids = new Set(vault.tenantCarriers.map((row) => row.carrier_id));
    return vault.carriers.filter((row) => ids.has(row.id));
  }, [vault]);
  const states = useMemo(() => US_STATES.filter(([, name]) => !stateFilter.trim() || name.toLowerCase().includes(stateFilter.trim().toLowerCase()) || name.startsWith(stateFilter.trim().toUpperCase())), [stateFilter]);
  const warnings = vault ? dueExpiryWarnings(vault, today) : [];

  async function save(path: string, payload: unknown, success: string, key: string) {
    setSaving(key);
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => null);
    setSaving(null);
    if (!response.ok) { toast.error(body?.error ?? "Could not save changes"); return null; }
    toast.success(success); await load(); return body;
  }
  async function saveGrid() {
    if (!vault || selected.size === 0) { toast.error("Select at least one carrier and state"); return; }
    const rows = [...selected].map((value) => { const [carrier_id, state] = value.split(":"); return { carrier_id, state, status: "active", effective_from: effectiveFrom, terminated_at: null }; });
    await save("/api/app/appointment-vault/appointments", { appointments: rows }, `${rows.length} appointment${rows.length === 1 ? "" : "s"} saved`, "appointments");
  }
  async function saveLicenseForm(event: React.FormEvent) { event.preventDefault(); await save("/api/app/appointment-vault/licenses", license, "Licence saved", "license"); }
  async function saveEoForm(event: React.FormEvent) { event.preventDefault(); const body = await save("/api/app/appointment-vault/eo-policies", eo, "E&O policy saved", "eo"); if (body) setEo({ carrier: "", policy_number: "", expires_at: "", coverage_amount_cents: "" }); }
  async function saveCeForm(event: React.FormEvent) { event.preventDefault(); await save("/api/app/appointment-vault/ce-records", ce, "CE record saved", "ce"); }

  if (!vault) return <Card><CardContent className="py-8 text-sm text-muted-foreground">Loading appointment vault…</CardContent></Card>;
  if (configuredCarriers.length === 0) return <Card><CardHeader><CardTitle>Appointments & licences</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Choose a carrier in the carrier contract section above before recording appointments.</CardContent></Card>;

  const updateDate = (setter: (value: string) => void) => (event: React.FormEvent<HTMLInputElement>) => setter(event.currentTarget.value);

  return <div className="min-w-0 space-y-6 overflow-x-hidden">
    {warnings.length > 0 && <Card className="border-amber-500/50"><CardHeader><CardTitle>Expiry warnings</CardTitle><p className="text-sm text-muted-foreground">Renew these records before they affect your ability to write business.</p></CardHeader><CardContent className="space-y-2">{warnings.map((warning) => <div key={`${warning.source}-${warning.sourceId}-${warning.days}`} className="flex flex-wrap items-center gap-2 text-sm"><Badge variant="outline">{warning.days} days</Badge><span className="font-medium">{warning.label}</span><span className="text-muted-foreground">expires {warning.expiresAt}</span></div>)}</CardContent></Card>}
    <Card><CardHeader><CardTitle>Appointments</CardTitle><p className="text-sm text-muted-foreground">Tick every state each selected carrier has appointed you in. Save the whole grid in one step.</p></CardHeader><CardContent className="space-y-4"><div className="flex flex-wrap items-end gap-3"><div className="min-w-56 flex-1 space-y-1.5"><Label htmlFor="state-filter">Find a state</Label><Input id="state-filter" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} placeholder="Arizona or AZ" /></div><div className="space-y-1.5"><Label htmlFor="appointment-effective">Effective from</Label><Input id="appointment-effective" type="date" value={effectiveFrom} onChange={updateDate(setEffectiveFrom)} onInput={updateDate(setEffectiveFrom)} required /></div><Button type="button" onClick={() => setSelected(new Set(configuredCarriers.flatMap((carrier) => states.map(([state]) => keyFor(carrier.id, state)))))}>Select visible states</Button><Button type="button" variant="outline" onClick={() => setSelected(new Set())}>Clear</Button></div><div className="max-w-full overflow-x-auto rounded-md border"><table className="min-w-[980px] text-sm"><thead><tr className="border-b bg-muted/40"><th className="min-w-48 bg-muted/40 px-3 py-2 text-left font-medium">Carrier</th>{states.map(([code, name]) => <th key={code} className="min-w-16 px-2 py-2 text-center font-medium" title={name}>{code}</th>)}</tr></thead><tbody>{configuredCarriers.map((carrier) => <tr key={carrier.id} className="border-b last:border-0"><th className="bg-background px-3 py-2 text-left font-medium">{carrier.name}</th>{states.map(([code, name]) => { const key = keyFor(carrier.id, code); return <td key={code} className="px-2 py-2 text-center"><label className="inline-flex cursor-pointer items-center justify-center gap-1"><span className="sr-only">{carrier.name} in {name}</span><input type="checkbox" checked={selected.has(key)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(key); else next.delete(key); return next; })} className="size-4 accent-[var(--brand-500)]" /></label></td>; })}</tr>)}</tbody></table></div><div className="flex flex-wrap items-center gap-3"><p className="text-sm text-muted-foreground">{selected.size} appointment{selected.size === 1 ? "" : "s"} selected</p><Button type="button" onClick={() => void saveGrid()} disabled={saving === "appointments"}>{saving === "appointments" ? "Saving…" : "Save appointments"}</Button></div></CardContent></Card>
    <div className="grid gap-6 xl:grid-cols-2"><Card><CardHeader><CardTitle>State licences</CardTitle><p className="text-sm text-muted-foreground">An expired licence blocks writing in that state until renewed.</p></CardHeader><CardContent><form onSubmit={saveLicenseForm} className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="license-state">State</Label><select id="license-state" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={license.state} onChange={(event) => setLicense((current) => ({ ...current, state: event.target.value }))}>{US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></div><div className="space-y-1.5"><Label htmlFor="license-number">Licence number</Label><Input id="license-number" value={license.license_number} onChange={(event) => setLicense((current) => ({ ...current, license_number: event.target.value }))} maxLength={120} required /></div><div className="space-y-1.5"><Label htmlFor="license-expires">Expires at</Label><Input id="license-expires" type="date" value={license.expires_at} onChange={updateDate((value) => setLicense((current) => ({ ...current, expires_at: value })))} onInput={updateDate((value) => setLicense((current) => ({ ...current, expires_at: value })))} required /></div><div className="flex items-end"><Button type="submit" disabled={saving === "license"}>{saving === "license" ? "Saving…" : "Save licence"}</Button></div></form>{vault.licenses.length > 0 && <div className="mt-5 space-y-2">{vault.licenses.map((row) => <div key={row.id} className="flex flex-wrap gap-2 text-sm"><Badge variant="outline">{row.state}</Badge><span>{row.license_number}</span><span className="text-muted-foreground">expires {row.expires_at}</span></div>)}</div>}</CardContent></Card>
      <Card><CardHeader><CardTitle>E&O insurance</CardTitle><p className="text-sm text-muted-foreground">Keep one current errors-and-omissions policy on file for appointment eligibility.</p></CardHeader><CardContent><form onSubmit={saveEoForm} className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="eo-carrier">E&O carrier</Label><Input id="eo-carrier" value={eo.carrier} onChange={(event) => setEo((current) => ({ ...current, carrier: event.target.value }))} maxLength={160} required /></div><div className="space-y-1.5"><Label htmlFor="eo-policy-number">Policy number</Label><Input id="eo-policy-number" value={eo.policy_number} onChange={(event) => setEo((current) => ({ ...current, policy_number: event.target.value }))} maxLength={120} required /></div><div className="space-y-1.5"><Label htmlFor="eo-expires">Expires at</Label><Input id="eo-expires" type="date" value={eo.expires_at} onChange={updateDate((value) => setEo((current) => ({ ...current, expires_at: value })))} onInput={updateDate((value) => setEo((current) => ({ ...current, expires_at: value })))} required /></div><div className="space-y-1.5"><Label htmlFor="eo-coverage">Coverage amount (cents)</Label><Input id="eo-coverage" inputMode="numeric" value={eo.coverage_amount_cents} onChange={(event) => setEo((current) => ({ ...current, coverage_amount_cents: event.target.value }))} required /></div><div className="sm:col-span-2"><Button type="submit" disabled={saving === "eo"}>{saving === "eo" ? "Saving…" : "Save E&O policy"}</Button></div></form>{vault.eoPolicies.length > 0 && <div className="mt-5 space-y-2">{vault.eoPolicies.map((row) => <div key={row.id} className="flex flex-wrap gap-2 text-sm"><Badge variant="outline">{row.carrier}</Badge><span>{row.policy_number}</span><span className="text-muted-foreground">expires {row.expires_at}</span></div>)}</div>}</CardContent></Card></div>
    <Card><CardHeader><CardTitle>Continuing education</CardTitle><p className="text-sm text-muted-foreground">Track required and completed credits by state, with the state deadline.</p></CardHeader><CardContent><form onSubmit={saveCeForm} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><div className="space-y-1.5"><Label htmlFor="ce-state">State</Label><select id="ce-state" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={ce.state} onChange={(event) => setCe((current) => ({ ...current, state: event.target.value }))}>{US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></div><div className="space-y-1.5"><Label htmlFor="ce-required">Credits required</Label><Input id="ce-required" type="number" min={0} max={10000} value={ce.credits_required} onChange={(event) => setCe((current) => ({ ...current, credits_required: event.target.value }))} required /></div><div className="space-y-1.5"><Label htmlFor="ce-completed">Credits completed</Label><Input id="ce-completed" type="number" min={0} max={10000} value={ce.credits_completed} onChange={(event) => setCe((current) => ({ ...current, credits_completed: event.target.value }))} required /></div><div className="space-y-1.5"><Label htmlFor="ce-deadline">Deadline</Label><Input id="ce-deadline" type="date" value={ce.deadline} onChange={updateDate((value) => setCe((current) => ({ ...current, deadline: value })))} onInput={updateDate((value) => setCe((current) => ({ ...current, deadline: value })))} required /></div><div className="lg:col-span-4"><Button type="submit" disabled={saving === "ce"}>{saving === "ce" ? "Saving…" : "Save CE record"}</Button></div></form>{vault.ceRecords.length > 0 && <div className="mt-5 space-y-2">{vault.ceRecords.map((row) => <div key={row.id} className="flex flex-wrap gap-2 text-sm"><Badge variant="outline">{row.state}</Badge><span>{row.credits_completed}/{row.credits_required} credits</span><span className="text-muted-foreground">deadline {row.deadline}</span></div>)}</div>}</CardContent></Card>
  </div>;
}

"use client";

import { useCallback, useState } from "react";
import { MoreHorizontal, Plug, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { COMPLIANCE_VENDOR_TYPES, COMPLIANCE_VENDOR_TYPE_LABELS, DNC_BLOCK_MESSAGE, type ComplianceVendor, type ComplianceVendorType } from "@/lib/compliance/constants";
import { tableHeaderRow, tableHeadCell, tableShell } from "./table-styles";

type FormState = {
  name: string; vendor_type: ComplianceVendorType; endpoint: string; credentials: string;
  is_enabled: boolean; priority: string; cost_per_lookup_cents: string;
};

const emptyForm: FormState = { name: "", vendor_type: "dnc_scrub", endpoint: "", credentials: "", is_enabled: false, priority: "0", cost_per_lookup_cents: "0" };
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const when = (value: string | null) => value ? new Date(value).toLocaleString() : "Never";

export function ComplianceVendorsTable({ initialVendors }: { initialVendors: ComplianceVendor[] }) {
  const [vendors, setVendors] = useState(initialVendors);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editing, setEditing] = useState<ComplianceVendor | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin/compliance-vendors");
    if (response.ok) setVendors((await response.json()).vendors);
  }, []);

  function startCreate() { setEditing(null); setForm(emptyForm); setOpen(true); }
  function startEdit(vendor: ComplianceVendor) {
    setEditing(vendor);
    setForm({ name: vendor.name, vendor_type: vendor.vendor_type, endpoint: vendor.endpoint, credentials: "", is_enabled: vendor.is_enabled, priority: String(vendor.priority), cost_per_lookup_cents: String(vendor.cost_per_lookup_cents) });
    setOpen(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    const body: Record<string, unknown> = { ...form, priority: Number(form.priority), cost_per_lookup_cents: Number(form.cost_per_lookup_cents) };
    if (editing && !form.credentials) delete body.credentials;
    const response = await fetch(editing ? `/api/admin/compliance-vendors/${editing.id}` : "/api/admin/compliance-vendors", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => null); setBusy(false);
    if (!response.ok) { toast.error(result?.error ?? "Could not save vendor"); return; }
    toast.success(editing ? "Compliance vendor updated" : "Compliance vendor created"); setOpen(false); refresh();
  }

  async function toggle(vendor: ComplianceVendor) {
    const next = !vendor.is_enabled;
    let confirmed = false;
    if (!next && vendor.vendor_type === "dnc_scrub" && vendors.filter((item) => item.vendor_type === "dnc_scrub" && item.is_enabled).length === 1) {
      confirmed = window.confirm(`${DNC_BLOCK_MESSAGE}\n\nDisable ${vendor.name}?`);
      if (!confirmed) return;
    }
    const response = await fetch(`/api/admin/compliance-vendors/${vendor.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_enabled: next, ...(confirmed ? { confirm_dnc_block: true } : {}) }) });
    const result = await response.json().catch(() => null);
    if (!response.ok) { toast.error(result?.error ?? "Could not change vendor availability"); return; }
    toast.success(`${vendor.name} ${next ? "enabled" : "disabled"}`); refresh();
  }

  async function test(vendor: ComplianceVendor) {
    setTesting(vendor.id);
    const response = await fetch(`/api/admin/compliance-vendors/${vendor.id}/test-connection`, { method: "POST" });
    const result = await response.json().catch(() => null); setTesting(null);
    if (result?.ok) toast.success(`${vendor.name}: ${result.message}`); else toast.error(`${vendor.name}: ${result?.message ?? "Connection test failed"}`);
    refresh();
  }

  const activeDnc = vendors.filter((vendor) => vendor.vendor_type === "dnc_scrub" && vendor.is_enabled).length;
  return <div className="space-y-5">
    {activeDnc === 0 && <div role="alert" className="flex items-start gap-3 rounded-lg border-2 border-[var(--color-danger)]/50 bg-[var(--color-danger)]/5 p-4 text-sm text-[var(--color-danger)]"><ShieldAlert className="mt-0.5 size-5 shrink-0" /><div><p className="font-bold">Dialing is blocked</p><p className="mt-1">{DNC_BLOCK_MESSAGE}</p></div></div>}
    <div className="flex flex-wrap items-center gap-3"><p className="text-sm text-muted-foreground">{vendors.filter((v) => v.is_enabled).length} enabled · {vendors.length} registered</p><div className="ml-auto"><Button size="sm" onClick={startCreate}>New vendor</Button></div></div>
    <div className={tableShell}><Table><TableHeader><TableRow className={tableHeaderRow}><TableHead className={tableHeadCell}>Vendor</TableHead><TableHead className={tableHeadCell}>Type</TableHead><TableHead className={tableHeadCell}>Endpoint</TableHead><TableHead className={tableHeadCell}>Health (24h)</TableHead><TableHead className={tableHeadCell}>Cost</TableHead><TableHead className={`${tableHeadCell} w-10`} /></TableRow></TableHeader><TableBody>
      {vendors.length === 0 && <TableRow><TableCell colSpan={6} className="h-20 text-center text-sm text-muted-foreground">No compliance vendors registered.</TableCell></TableRow>}
      {vendors.map((vendor) => <TableRow key={vendor.id} className={!vendor.is_enabled ? "opacity-60" : undefined}><TableCell><div className="flex items-center gap-2 font-medium">{vendor.name}<Badge variant="outline" className={vendor.is_enabled ? "border-[var(--color-success)]/40 text-[var(--color-success)]" : "text-muted-foreground"}>{vendor.is_enabled ? "Enabled" : "Disabled"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{vendor.credentials_present ? "Credentials stored" : "Credentials not set"} · Last success: {when(vendor.last_success_at)}</p></TableCell><TableCell>{COMPLIANCE_VENDOR_TYPE_LABELS[vendor.vendor_type]}</TableCell><TableCell className="max-w-[230px] truncate font-mono text-xs">{vendor.endpoint}</TableCell><TableCell><span className={vendor.failures_24h ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}>{vendor.failure_rate_24h}% failed</span><p className="text-xs text-muted-foreground">{vendor.failures_24h}/{vendor.calls_24h} calls</p></TableCell><TableCell>{money(vendor.cost_per_lookup_cents)}</TableCell><TableCell><div className="flex items-center gap-1"><Button variant="ghost" size="icon-sm" title="Test connection" onClick={() => test(vendor)} disabled={testing === vendor.id}><Plug /></Button><Button variant="ghost" size="icon-sm" title="More actions" onClick={() => startEdit(vendor)}><MoreHorizontal /><span className="sr-only">Edit {vendor.name}</span></Button></div></TableCell></TableRow>)}
    </TableBody></Table></div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>{editing ? `Edit ${editing.name}` : "Register compliance vendor"}</DialogTitle><DialogDescription>Credentials are encrypted before storage and never returned. Use a vendor endpoint that supports HTTPS.</DialogDescription></DialogHeader><form onSubmit={save} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1 text-sm"><span className="font-medium">Vendor name</span><Input required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label className="space-y-1 text-sm"><span className="font-medium">Vendor type</span><select className="flex h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.vendor_type} onChange={(e) => setForm({ ...form, vendor_type: e.target.value as ComplianceVendorType })}>{COMPLIANCE_VENDOR_TYPES.map((type) => <option key={type} value={type}>{COMPLIANCE_VENDOR_TYPE_LABELS[type]}</option>)}</select></label></div><label className="space-y-1 text-sm"><span className="font-medium">API endpoint</span><Input required type="url" placeholder="https://vendor.example.com/health" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} /></label><label className="space-y-1 text-sm"><span className="font-medium">Credential token {editing && <span className="font-normal text-muted-foreground">(leave blank to keep current)</span>}</span><Input type="password" autoComplete="new-password" value={form.credentials} onChange={(e) => setForm({ ...form, credentials: e.target.value })} /></label><div className="grid gap-4 sm:grid-cols-3"><label className="space-y-1 text-sm"><span className="font-medium">Priority</span><Input required type="number" min="0" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} /></label><label className="space-y-1 text-sm"><span className="font-medium">Cost (cents)</span><Input required type="number" min="0" value={form.cost_per_lookup_cents} onChange={(e) => setForm({ ...form, cost_per_lookup_cents: e.target.value })} /></label><label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={form.is_enabled} onChange={(e) => setForm({ ...form, is_enabled: e.target.checked })} /> Enabled</label></div><DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save vendor"}</Button></DialogFooter></form></DialogContent></Dialog>
    <div className="flex flex-wrap gap-2 text-sm">{vendors.map((vendor) => <Button key={vendor.id} variant="outline" size="sm" onClick={() => toggle(vendor)}>{vendor.is_enabled ? `Disable ${vendor.name}` : `Enable ${vendor.name}`}</Button>)}</div>
  </div>;
}

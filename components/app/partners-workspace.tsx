"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Archive, Check, Edit3, Pause, Play, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AffiliateLinksPanel } from "@/components/app/affiliate-links-panel";
import { PARTNER_PAYOUT_MODEL_LABELS, PARTNER_PAYOUT_MODELS, PARTNER_STATUS_LABELS, PARTNER_TYPE_LABELS, PARTNER_TYPES, type PartnerPayoutModel, type PartnerStatus, type PartnerType } from "@/lib/partners/constants";
import { capacityLabel, PARTNER_LIMIT_KEYS } from "@/lib/partners/limits";

type Term = { id: string; partner_id: string; payout_model: PartnerPayoutModel; rate_cents: number | null; rate_pct_bp: number | null; effective_from: string; created_at: string };
type Partner = { id: string; name: string; partner_type: PartnerType; status: PartnerStatus; country: string; contact_name: string | null; contact_email: string | null; timezone: string; notes: string | null; terms: Term[]; active_term: Term | null; lead_volume_this_month: number; last_submission: string | null; active_user_count: number };
type CapacityLimits = { max_publishers: number | null; max_marketing_partners: number | null; max_affiliates: number | null; max_buffer_seats: number | null; max_partner_users: number | null };
type CapacityUsage = { publishers: number; marketing: number; affiliates: number; partnerUsers: number };
type Product = { code: string; name: string; category: string; is_enabled: boolean; sort_order: number };
type PartnerProduct = Product & { approved: boolean };
type PartnerDraft = { name: string; partner_type: PartnerType; country: string; contact_name: string; contact_email: string; timezone: string; notes: string };

const emptyDraft: PartnerDraft = { name: "", partner_type: "publisher", country: "US", contact_name: "", contact_email: "", timezone: "UTC", notes: "" };
const today = new Date().toISOString().slice(0, 10);
const dateLabel = (value: string | null) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value)) : "Never";
const money = (cents: number | null) => cents == null ? "—" : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);

export function PartnersWorkspace({ readOnly, canManageProductConfig = false }: { readOnly: boolean; canManageProductConfig?: boolean }) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [draft, setDraft] = useState<PartnerDraft>(emptyDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [termFor, setTermFor] = useState<string | null>(null);
  const [termModel, setTermModel] = useState<PartnerPayoutModel>("per_transfer");
  const [termRate, setTermRate] = useState("");
  const [termDate, setTermDate] = useState(today);
  const [products, setProducts] = useState<Product[]>([]);
  const [partnerProducts, setPartnerProducts] = useState<Record<string, PartnerProduct[]>>({});
  const [limits, setLimits] = useState<CapacityLimits>({ max_publishers: null, max_marketing_partners: null, max_affiliates: null, max_buffer_seats: null, max_partner_users: null });
  const [usage, setUsage] = useState<CapacityUsage>({ publishers: 0, marketing: 0, affiliates: 0, partnerUsers: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    const [response, productResponse] = await Promise.all([
      fetch("/api/app/partners", { cache: "no-store" }),
      canManageProductConfig ? fetch("/api/app/products", { cache: "no-store" }) : Promise.resolve(null),
    ]);
    const body = await response.json().catch(() => null);
    setLoading(false);
    if (!response.ok) { toast.error(body?.error ?? "Could not load partners"); return; }
    const loadedPartners = body.partners ?? [];
    setPartners(loadedPartners);
    setLimits({ max_publishers: body.limits?.max_publishers ?? null, max_marketing_partners: body.limits?.max_marketing_partners ?? null, max_affiliates: body.limits?.max_affiliates ?? null, max_buffer_seats: body.limits?.max_buffer_seats ?? null, max_partner_users: body.limits?.max_partner_users ?? null });
    setUsage(body.usage ?? { publishers: 0, marketing: 0, affiliates: 0, partnerUsers: 0 });
    if (canManageProductConfig && productResponse) {
      const productBody = await productResponse.json().catch(() => null);
      if (productResponse.ok) setProducts(productBody.products ?? []);
      const configs = await Promise.all(loadedPartners.map(async (partner: Partner) => {
        const result = await fetch(`/api/app/partners/${partner.id}/products`, { cache: "no-store" });
        const resultBody = await result.json().catch(() => null);
        return [partner.id, result.ok ? resultBody.products ?? [] : []] as const;
      }));
      setPartnerProducts(Object.fromEntries(configs));
    }
  }, [canManageProductConfig]);

  // The API is the source of truth; refresh after every write so status and effective terms are
  // visible immediately without requiring a re-login or a full page refresh.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function send(path: string, method: "POST" | "PATCH" | "PUT", body: Record<string, unknown>, success: string) {
    setBusy(path); const response = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => null); setBusy(null);
    if (!response.ok) { toast.error(result?.error ?? "Could not save changes"); return false; }
    toast.success(success); await load(); return true;
  }

  async function toggleTenantProduct(product: Product) {
    await send(`/api/app/products/${encodeURIComponent(product.code)}`, "PATCH", { is_enabled: !product.is_enabled }, `${product.name} ${product.is_enabled ? "disabled" : "enabled"}`);
  }

  async function togglePartnerProduct(partnerId: string, product: PartnerProduct) {
    await send(`/api/app/partners/${partnerId}/products`, "PUT", { product_code: product.code, approved: !product.approved }, `${product.name} ${product.approved ? "approval removed" : "approved"}`);
  }

  async function savePartner(event: FormEvent) {
    event.preventDefault();
    const path = editing ? `/api/app/partners/${editing}` : "/api/app/partners";
    const ok = await send(path, editing ? "PATCH" : "POST", editing ? { action: "update", ...draft } : draft, editing ? "Partner updated" : "Partner created");
    if (ok) { setDraft(emptyDraft); setEditing(null); }
  }

  async function changeStatus(partner: Partner, nextStatus: PartnerStatus) {
    let confirmation: string | undefined;
    if (nextStatus === "offboarded") {
      confirmation = window.prompt(`This permanently revokes ${partner.name}'s partner portal users. Type OFFBOARD to continue.`) ?? undefined;
      if (confirmation !== "OFFBOARD") { toast.error("Offboarding cancelled. Type OFFBOARD exactly to confirm."); return; }
    }
    await send(`/api/app/partners/${partner.id}`, "PATCH", { action: "transition", next_status: nextStatus, reason: nextStatus === "paused" ? "Partner paused from partner records" : nextStatus === "offboarded" ? "Partner offboarded from partner records" : "Partner returned to active status", confirmation }, `Partner ${PARTNER_STATUS_LABELS[nextStatus].toLowerCase()}`);
  }

  async function saveTerm(event: FormEvent, partnerId: string) {
    event.preventDefault();
    const numericRate = Number(termRate);
    if (!Number.isFinite(numericRate) || numericRate < 0) { toast.error("Enter a valid non-negative rate"); return; }
    const body = termModel === "revenue_share" ? { action: "add_term", payout_model: termModel, rate_cents: null, rate_pct_bp: Math.round(numericRate * 100), effective_from: termDate } : { action: "add_term", payout_model: termModel, rate_cents: Math.round(numericRate * 100), rate_pct_bp: null, effective_from: termDate };
    if (await send(`/api/app/partners/${partnerId}`, "PATCH", body, "Partner terms added")) { setTermFor(null); setTermRate(""); }
  }

  if (loading) return <Card><CardContent className="py-8 text-sm text-muted-foreground">Loading partner records…</CardContent></Card>;

  const selectedLimitKey = PARTNER_LIMIT_KEYS[draft.partner_type];
  const selectedUsage = usage[draft.partner_type === "publisher" ? "publishers" : draft.partner_type === "marketing" ? "marketing" : "affiliates"];
  const selectedLimit = limits[selectedLimitKey];
  const createAtLimit = !editing && selectedLimit != null && selectedUsage >= selectedLimit;

  return <div className="mx-auto max-w-7xl space-y-6">
    {readOnly && <div className="rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-4 py-3 text-sm text-foreground">Your account is read-only. You can review partner records, but changes are unavailable until billing is restored.</div>}
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Partners</p><h1 className="text-2xl font-extrabold tracking-tight">Partner records</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">One record for every publisher, marketing company and affiliate. Pause intake without losing the history behind it.</p></div>
      <span className="text-sm text-muted-foreground">{partners.length} record{partners.length === 1 ? "" : "s"}</span>
    </div>

    <Card><CardHeader><CardTitle>Plan capacity</CardTitle><p className="text-sm text-muted-foreground">Only active records consume a slot. Pausing a partner frees it immediately.</p></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><p className="rounded-md border p-3 text-sm">{capacityLabel(usage.publishers, limits.max_publishers, "publishers")}</p><p className="rounded-md border p-3 text-sm">{capacityLabel(usage.marketing, limits.max_marketing_partners, "marketing partners")}</p><p className="rounded-md border p-3 text-sm">{capacityLabel(usage.affiliates, limits.max_affiliates, "affiliates")}</p><p className="rounded-md border p-3 text-sm">{capacityLabel(usage.partnerUsers, limits.max_partner_users, "partner users")}</p></CardContent></Card>

    {canManageProductConfig && <Card><CardHeader><CardTitle>Products Ray sells</CardTitle><p className="text-sm text-muted-foreground">Enable products here first, then approve the subset each partner may submit. Changes take effect on the next product-picker request.</p></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{products.map((product) => <label key={product.code} className="flex items-start gap-3 rounded-lg border p-3"><input type="checkbox" className="mt-1 size-4" checked={product.is_enabled} disabled={readOnly || busy !== null} onChange={() => void toggleTenantProduct(product)} /><span><span className="block text-sm font-medium">{product.name}</span><span className="block text-xs text-muted-foreground">{product.category} · {product.code}</span></span></label>)}</CardContent></Card>}

    {!readOnly && <Card><CardHeader><CardTitle className="flex items-center gap-2"><Plus className="size-4" aria-hidden="true" />{editing ? "Edit partner" : "Add a partner"}</CardTitle></CardHeader><CardContent><form onSubmit={savePartner} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <div className="space-y-1.5 xl:col-span-2"><Label htmlFor="partner-name">Partner name</Label><Input id="partner-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Apex Call Center" required maxLength={200} /></div>
      <div className="space-y-1.5"><Label htmlFor="partner-type">Type</Label><select id="partner-type" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={draft.partner_type} onChange={(event) => setDraft({ ...draft, partner_type: event.target.value as PartnerType })}>{PARTNER_TYPES.map((type) => <option key={type} value={type}>{PARTNER_TYPE_LABELS[type]}</option>)}</select></div>
      <div className="space-y-1.5"><Label htmlFor="partner-country">Country</Label><Input id="partner-country" value={draft.country} onChange={(event) => setDraft({ ...draft, country: event.target.value })} placeholder="US" required maxLength={2} /></div>
      <div className="space-y-1.5"><Label htmlFor="partner-contact">Contact name</Label><Input id="partner-contact" value={draft.contact_name} onChange={(event) => setDraft({ ...draft, contact_name: event.target.value })} maxLength={200} /></div>
      <div className="space-y-1.5"><Label htmlFor="partner-email">Contact email</Label><Input id="partner-email" type="email" value={draft.contact_email} onChange={(event) => setDraft({ ...draft, contact_email: event.target.value })} placeholder="ops@example.com" /></div>
      <div className="space-y-1.5"><Label htmlFor="partner-timezone">Timezone</Label><Input id="partner-timezone" value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })} placeholder="America/Phoenix" required maxLength={100} /></div>
      <div className="space-y-1.5 md:col-span-2 xl:col-span-4"><Label htmlFor="partner-notes">Notes</Label><textarea id="partner-notes" className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} maxLength={5000} /></div>
      {createAtLimit && <p className="text-sm text-destructive md:col-span-2 xl:col-span-4" role="alert">Your plan has reached <code>{selectedLimitKey}</code> ({selectedUsage} of {selectedLimit}). Upgrade to add another partner.</p>}<div className="flex gap-2 md:col-span-2 xl:col-span-4"><Button type="submit" disabled={busy !== null || createAtLimit}>{busy ? "Saving…" : editing ? "Save partner" : "Create partner"}</Button>{editing && <Button type="button" variant="outline" onClick={() => { setEditing(null); setDraft(emptyDraft); }}>Cancel</Button>}</div>
    </form></CardContent></Card>}

    {partners.length === 0 ? <Card><CardContent className="py-10 text-center"><p className="font-medium">No partner records yet</p><p className="mt-1 text-sm text-muted-foreground">Add the publishers, marketing companies and affiliates that supply your leads.</p></CardContent></Card> : <div className="grid gap-4 xl:grid-cols-2">{partners.map((partner) => <Card key={partner.id} className={partner.status === "offboarded" ? "opacity-75" : undefined}><CardHeader className="flex flex-row items-start justify-between gap-3"><div><CardTitle className="text-lg">{partner.name}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{PARTNER_TYPE_LABELS[partner.partner_type]} · {partner.country} · {partner.timezone}</p></div><Badge variant={partner.status === "active" ? "default" : partner.status === "offboarded" ? "outline" : "secondary"}>{PARTNER_STATUS_LABELS[partner.status]}</Badge></CardHeader><CardContent className="space-y-4">
      <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-4"><div><p className="text-xs text-muted-foreground">Leads this month</p><p className="mt-1 font-semibold">{partner.lead_volume_this_month}</p></div><div><p className="text-xs text-muted-foreground">Last submission</p><p className="mt-1 font-semibold">{dateLabel(partner.last_submission)}</p></div><div><p className="text-xs text-muted-foreground">Portal users</p><p className="mt-1 font-semibold">{partner.active_user_count}</p></div><div><p className="text-xs text-muted-foreground">Current terms</p><p className="mt-1 font-semibold">{partner.active_term ? PARTNER_PAYOUT_MODEL_LABELS[partner.active_term.payout_model] : "Not set"}</p></div></div>
      {(partner.contact_name || partner.contact_email || partner.notes) && <div className="space-y-1 text-sm"><p>{partner.contact_name || "No contact name"}{partner.contact_email ? ` · ${partner.contact_email}` : ""}</p>{partner.notes && <p className="whitespace-pre-wrap text-muted-foreground">{partner.notes}</p>}</div>}
      {canManageProductConfig && partner.status !== "offboarded" && <div className="space-y-2 border-t pt-3"><div><p className="text-sm font-medium">Approved products</p><p className="text-xs text-muted-foreground">Only enabled products can be approved for this partner.</p></div><div className="grid gap-2 sm:grid-cols-2">{(partnerProducts[partner.id] ?? []).map((product) => <label key={product.code} className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${!product.is_enabled ? "opacity-50" : ""}`}><input type="checkbox" className="size-4" checked={product.approved} disabled={readOnly || !product.is_enabled || busy !== null} onChange={() => void togglePartnerProduct(partner.id, product)} /><span>{product.name}</span>{!product.is_enabled && <span className="ml-auto text-xs text-muted-foreground">Business disabled</span>}</label>)}</div></div>}
      {partner.terms.length > 0 && <div className="space-y-2 border-t pt-3"><p className="text-sm font-medium">Commercial terms history</p>{partner.terms.map((term) => <div key={term.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"><span>{PARTNER_PAYOUT_MODEL_LABELS[term.payout_model]}</span><span className="font-medium">{term.payout_model === "revenue_share" ? `${((term.rate_pct_bp ?? 0) / 100).toFixed(2)}%` : money(term.rate_cents)}</span><span className="text-muted-foreground">effective {dateLabel(term.effective_from)}</span></div>)}</div>}
      {partner.partner_type === "affiliate" && <AffiliateLinksPanel partnerId={partner.id} readOnly={readOnly} />}
      {!readOnly && partner.status !== "offboarded" && <div className="flex flex-wrap gap-2 border-t pt-3"><Button type="button" variant="outline" size="sm" onClick={() => { setEditing(partner.id); setDraft({ name: partner.name, partner_type: partner.partner_type, country: partner.country, contact_name: partner.contact_name ?? "", contact_email: partner.contact_email ?? "", timezone: partner.timezone, notes: partner.notes ?? "" }); }}><Edit3 className="mr-1.5 size-3.5" aria-hidden="true" />Edit</Button>{partner.status === "draft" && <Button type="button" size="sm" onClick={() => void changeStatus(partner, "active")}><Check className="mr-1.5 size-3.5" aria-hidden="true" />Activate</Button>}{partner.status === "active" && <Button type="button" variant="outline" size="sm" onClick={() => void changeStatus(partner, "paused")}><Pause className="mr-1.5 size-3.5" aria-hidden="true" />Pause</Button>}{partner.status === "paused" && <Button type="button" size="sm" onClick={() => void changeStatus(partner, "active")}><Play className="mr-1.5 size-3.5" aria-hidden="true" />Resume</Button>}{partner.status !== "draft" && <Button type="button" variant="outline" size="sm" onClick={() => void changeStatus(partner, "offboarded")}><Archive className="mr-1.5 size-3.5" aria-hidden="true" />Offboard</Button>}<Button type="button" variant="outline" size="sm" onClick={() => setTermFor(termFor === partner.id ? null : partner.id)} disabled={busy !== null}>Add terms</Button></div>}
      {termFor === partner.id && !readOnly && partner.status !== "offboarded" && <form onSubmit={(event) => void saveTerm(event, partner.id)} className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-3"><div className="space-y-1.5"><Label htmlFor={`term-model-${partner.id}`}>Payout model</Label><select id={`term-model-${partner.id}`} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={termModel} onChange={(event) => setTermModel(event.target.value as PartnerPayoutModel)}>{PARTNER_PAYOUT_MODELS.map((model) => <option key={model} value={model}>{PARTNER_PAYOUT_MODEL_LABELS[model]}</option>)}</select></div><div className="space-y-1.5"><Label htmlFor={`term-rate-${partner.id}`}>{termModel === "revenue_share" ? "Share (%)" : "Rate ($)"}</Label><Input id={`term-rate-${partner.id}`} type="number" min="0" step="0.01" value={termRate} onChange={(event) => setTermRate(event.target.value)} required /></div><div className="space-y-1.5"><Label htmlFor={`term-date-${partner.id}`}>Effective from</Label><Input id={`term-date-${partner.id}`} type="date" value={termDate} onChange={(event) => setTermDate(event.target.value)} required /></div><div className="flex gap-2 sm:col-span-3"><Button type="submit" size="sm" disabled={busy !== null}>Save terms</Button><Button type="button" variant="ghost" size="sm" onClick={() => setTermFor(null)}>Cancel</Button></div></form>}
    </CardContent></Card>)}</div>}
  </div>;
}

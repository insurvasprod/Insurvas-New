"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { notify } from "@/lib/notify";
import {
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_STATUS_ORDER,
  SCRUB_LABEL as SCRUB_STATUS_LABEL,
  campaignServes,
  hasNoWorkableLeads,
  minutesSince,
  scrubGateReason,
  scrubRunIsStale,
  workedPercent,
  type CampaignProgress,
  type ScrubRun,
} from "@/lib/campaigns/constants";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { sectionForPath } from "@/lib/menu/definition";
import { NewVendorPanel, VendorRoster } from "@/components/app/vendor-roster";
import { Callout } from "@/components/app/settings/primitives";
import { vendorCampaignWarning, vendorTakesCampaigns } from "@/lib/vendors/types";

type Campaign = {
  campaign_id: string; vendor_id: string; name: string; lead_type: string; product_code: string | null;
  status: string; scrub_status: string | null; mixing_weight: number;
  total_spend_cents: number; records_purchased: number; credits_received_cents: number;
  records_rejected: number | null; records_usable: number | null;
  cost_per_record_cents: number | null; effective_cost_per_record_cents: number | null;
  cost_per_usable_record_cents: number | null; rejected_spend_cents: number | null;
};
type Vendor = { id: string; name: string; lead_type: string; return_window_days: number; status: string; terms: string | null; notes: string | null };
type Rollup = {
  vendor_id: string; vendor_name: string; lead_type: string; status: string; return_window_days: number;
  campaign_count: number; active_campaign_count: number; total_spend_cents: number;
  records_purchased: number; credits_received_cents: number; records_rejected: number | null; records_usable: number | null;
  cost_per_record_cents: number | null; effective_cost_per_record_cents: number | null; cost_per_usable_record_cents: number | null;
};
/** LA-2.5 criterion 4. Per vendor, over that vendor's own leads — never an average of medians. */
type Speed = { vendor_id: string; posted_leads: number; dialled_leads: number; median_seconds: number | null; dialled_within_60s: number; dialled_within_60s_pct: number | null };
/** LA-2.6 criterion 3. Counted over leads attributed to the vendor, not over the certificates. */
type Pending = { missing: string[]; detail: string };
/** The shape `outboundLimitSnapshot` returns, already carried by the campaigns payload. */
type OutboundLimit = { key: string; label: string; usage: number; limit: number | null };
type Consent = { vendor_id: string; leads: number; claimed_certificates: number; any_certificate: number; claimed_coverage_pct: number | null; any_coverage_pct: number | null };

/** Cents to dollars. Costs per record are fractional cents, so they keep three decimal places. */
function money(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "—";
  return `$${(Number(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function perRecord(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "—";
  return `$${(Number(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
}

/** A count the database has not computed yet is "—", never 0. Zero is a measurement. */
function count(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : Number(value).toLocaleString();
}

/** "$4.12" — a per-record figure at the board's two decimals, for the table and the headline. */
function money2(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "—";
  return "$" + (Number(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Exhausted is a status like the others (lib/campaigns/constants.ts): labelled, sorted last, and
// filterable. The scrub labels are the four values the database holds — the old map read `pending`
// and `running`, which it never does, so a campaign mid-scrub showed the raw word.
const STATUS_LABEL = CAMPAIGN_STATUS_LABEL;
const STATUS_ORDER = CAMPAIGN_STATUS_ORDER;
const PAGE_SIZE = 25;
const SCRUB_LABEL = SCRUB_STATUS_LABEL;

/** Issued policies and cost per issued policy, from True CPA's report (null without True CPA). */
type Outcome = { applications: number; issued: number; costPerIssuedCents: number | null };

/** "14 Sep 2026" — an import date, in the viewer's own zone. */
function day(iso: string | null | undefined) {
  if (!iso) return "—";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "—" : at.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

/** The driving window's id for a campaign's scrub, kept for the tab so a reload can carry on. */
function scrubToken(campaignId: string, fresh = false) {
  const key = `campaign-scrub-token:${campaignId}`;
  try {
    const stored = fresh ? null : window.sessionStorage.getItem(key);
    if (stored) return stored;
    const created = crypto.randomUUID();
    window.sessionStorage.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}
function heldScrubToken(campaignId: string) {
  try { return window.sessionStorage.getItem(`campaign-scrub-token:${campaignId}`); } catch { return null; }
}
function dropScrubToken(campaignId: string) {
  try { window.sessionStorage.removeItem(`campaign-scrub-token:${campaignId}`); } catch { /* per-tab convenience only */ }
}

export function CampaignWorkspace() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [rollup, setRollup] = useState<Rollup[]>([]);
  const [speed, setSpeed] = useState<Speed[]>([]);
  const [consent, setConsent] = useState<Consent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [limits, setLimits] = useState<OutboundLimit[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { total_spend_cents: string; records_purchased: string; mixing_weight: string }>>({});
  // Module 2 §5: VENDOR → CAMPAIGN → LIST → LEADS. Both ends of that chain had an API and no form,
  // so a tenant could not create the vendor they buy from or the campaign that carries its cost —
  // and without a campaign every imported lead is free, which makes the whole cost analysis empty.
  const [newVendor, setNewVendor] = useState<{ name: string; lead_type: string; return_window_days: string; terms: string } | null>(null);
  const [newCampaign, setNewCampaign] = useState<{ vendor_id: string; name: string; lead_type: string; product_code: string; total_spend: string; records_purchased: string; mixing_weight: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [vendorFilter, setVendorFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  // Campaigns concept audit (LA-2 §5). Each is null when its migration is not applied, and the line
  // that shows it is then left out rather than drawn as a zero.
  const [progress, setProgress] = useState<Record<string, CampaignProgress> | null>(null);
  const [scrubRuns, setScrubRuns] = useState<Record<string, ScrubRun> | null>(null);
  const [testBatches, setTestBatches] = useState<Record<string, boolean> | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome> | null>(null);
  const [canScrub, setCanScrub] = useState(false);
  const [faults, setFaults] = useState<string[]>([]);
  /** The campaign whose scrub this window is driving, one batch per request. */
  const [driving, setDriving] = useState<string | null>(null);
  const [scrubError, setScrubError] = useState<{ campaignId: string; message: string } | null>(null);
  const stopRequested = useRef(false);

  const load = useCallback(() => Promise.all([
    fetch("/api/app/campaigns", { cache: "no-store" }),
    fetch("/api/app/vendors", { cache: "no-store" }),
  ]).then(async ([campaignResponse, vendorResponse]) => {
    const campaignBody = await campaignResponse.json().catch(() => null);
    const vendorBody = await vendorResponse.json().catch(() => null);
    // Reported, never swallowed into an empty list. A vendor page that renders "no campaigns"
    // because `tenant_campaign_costs` is not deployed yet looks exactly like a tenant who has not
    // bought any leads, and those need different answers.
    if (!campaignResponse.ok) throw new Error(campaignBody?.error ?? "Could not load campaigns");
    if (!vendorResponse.ok) throw new Error(vendorBody?.error ?? "Could not load vendors");
    setCampaigns(campaignBody.campaigns ?? []);
    setProgress(campaignBody.progress ?? null);
    setScrubRuns(campaignBody.scrubRuns ?? null);
    setTestBatches(campaignBody.testBatches ?? null);
    setOutcomes(campaignBody.outcomes ?? null);
    setCanScrub(Boolean(campaignBody.canScrub));
    setFaults(Array.isArray(campaignBody.faults) ? campaignBody.faults : []);
    // LA-2.22 criterion 4: "every limited screen shows usage against the cap". The route has always
    // returned this; nothing rendered it, so `max_active_campaigns` usage was visible only on the
    // Team & access tab — a screen where no campaign is ever created. Ray met the limit as a 403 on
    // the one page that could have warned him, which is the failure the task's own rule describes:
    // "the UI exists so the product does not feel broken."
    setLimits(campaignBody.limits ?? []);
    setVendors(vendorBody.vendors ?? []);
    setRollup(vendorBody.rollup ?? []);
    setSpeed(vendorBody.speed ?? []);
    setConsent(vendorBody.consent ?? []);
    // What the database cannot answer yet, kept apart from what it answered wrongly. These arrive
    // with a 200 and real rows beside them: the screen is useful, just not complete.
    setPending([
      ...(Array.isArray(vendorBody.pending) ? vendorBody.pending : []),
      ...(campaignBody.pending ? [campaignBody.pending] : []),
    ]);
  }).then(() => setLoadError(null)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Could not load this page";
    notify.fail(message);
    // A toast disappears; the body does not. Holding the failure in state is what stops the sections
    // below from going on to assert "No vendors yet" — which is the same sentence a tenant who has
    // genuinely bought nothing sees, and the two need different answers.
    setLoadError(message);
  }).finally(() => setLoading(false)), []);

  useEffect(() => { void load(); }, [load]);

  const vendorName = useMemo(() => new Map(vendors.map((vendor) => [vendor.id, vendor.name])), [vendors]);

  async function patchCampaign(id: string, body: Record<string, unknown>, successMessage: string | ((result: { serving?: boolean }) => string)) {
    setBusy(id);
    try {
      const response = await fetch(`/api/app/campaigns/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => null);
      if (!response.ok) { notify.block(result?.error ?? "Could not update this campaign"); return; }
      notify.done(typeof successMessage === "function" ? successMessage(result ?? {}) : successMessage);
      await load();
      setEdits((current) => { const next = { ...current }; delete next[id]; return next; });
    } finally {
      setBusy(null);
    }
  }

  /**
   * "Run the scrub": open (or resume) the run, then screen one batch per request until it ends. The
   * progress is the database's, so closing the tab loses nothing — this window, or any owner after
   * 15 minutes without progress, carries on from where it stopped. Never a plain "mark scrubbed".
   */
  async function runScrub(campaign: Campaign) {
    if (driving) return;
    const run = scrubRuns?.[campaign.campaign_id];
    const resuming = run && run.status !== "scrubbed";
    if (!resuming) {
      const leads = progress?.[campaign.campaign_id]?.leads_received;
      const ok = window.confirm(
        `Re-screen ${leads === undefined ? "every lead" : `all ${leads.toLocaleString()} leads`} in ${campaign.name}? Each number is checked against the litigator and do-not-call lists, and the lookups count against your plan's screening allowance. The campaign serves no leads until the scrub finishes. Numbers that fail are suppressed and recorded against the campaign.`,
      );
      if (!ok) return;
    }
    stopRequested.current = false;
    setScrubError(null);
    setDriving(campaign.campaign_id);
    const post = async (payload: Record<string, unknown>) => {
      const response = await fetch(`/api/app/campaigns/${campaign.campaign_id}/scrub`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => null);
      if (body?.run) setScrubRuns((current) => ({ ...(current ?? {}), [campaign.campaign_id]: body.run as ScrubRun }));
      if (!response.ok) throw new Error(body?.error ?? "The scrub could not continue");
      return body.run as ScrubRun;
    };
    try {
      // A stale run held by another window is taken over with this window's own token.
      const token = scrubToken(campaign.campaign_id, Boolean(run && scrubRunIsStale(run) && !heldScrubToken(campaign.campaign_id)));
      let current = await post({ action: "start", token });
      while (current.status === "running" && !stopRequested.current) current = await post({ action: "step", token, runId: current.id });
      if (current.status === "scrubbed") {
        dropScrubToken(campaign.campaign_id);
        notify.done(`${campaign.name} is scrubbed — ${current.processed_leads.toLocaleString()} leads screened, ${current.rejected_leads.toLocaleString()} failed.`);
      } else if (current.status === "failed") {
        setScrubError({ campaignId: campaign.campaign_id, message: current.error ?? "The scrub could not be completed." });
      } else {
        notify.done(`Scrub paused at ${current.processed_leads.toLocaleString()} of ${current.total_leads.toLocaleString()} leads. ${campaign.name} serves no leads until it finishes.`);
      }
    } catch (error) {
      setScrubError({ campaignId: campaign.campaign_id, message: error instanceof Error ? error.message : "The scrub could not continue" });
    } finally {
      setDriving(null);
      await load();
    }
  }

  async function createCampaign() {
    if (!newCampaign || creating) return;
    setCreating(true);
    try {
      const created = await fetch("/api/app/campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor_id: newCampaign.vendor_id,
          name: newCampaign.name.trim(),
          lead_type: newCampaign.lead_type,
          product_code: newCampaign.product_code.trim() || null,
          // Created as a draft. A campaign only serves leads once it is active AND scrubbed, so
          // starting it active would put an unscrubbed, empty campaign in the serving view.
          status: "draft",
        }),
      });
      const body = await created.json().catch(() => null);
      if (!created.ok) { notify.block(body?.error ?? "Could not create this campaign"); return; }

      // The money is a second call, because `POST /campaigns` deliberately does not take it — the
      // cost fields belong to the same PATCH that the cost editor uses, so there is one place where
      // spend changes and one place that re-derives cost per record.
      const spend = Math.round(Number(newCampaign.total_spend) * 100);
      const purchased = Number(newCampaign.records_purchased);
      const weight = Number(newCampaign.mixing_weight) || 1;
      if (Number.isFinite(spend) && spend >= 0 && Number.isInteger(purchased) && purchased >= 0) {
        await fetch(`/api/app/campaigns/${body.campaign.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ total_spend_cents: spend, records_purchased: purchased, mixing_weight: weight }),
        });
      }
      notify.done(`${body.campaign.name} created as a draft. Activate it when the list is scrubbed.`);
      setNewCampaign(null);
      await load();
    } finally { setCreating(false); }
  }

  function editValue(campaign: Campaign, key: "total_spend_cents" | "records_purchased" | "mixing_weight") {
    const row = edits[campaign.campaign_id];
    if (row && row[key] !== undefined) return row[key];
    if (key === "total_spend_cents") return (campaign.total_spend_cents / 100).toFixed(2);
    return String(campaign[key]);
  }

  function setEdit(campaign: Campaign, key: "total_spend_cents" | "records_purchased" | "mixing_weight", value: string) {
    setEdits((current) => ({
      ...current,
      [campaign.campaign_id]: {
        total_spend_cents: current[campaign.campaign_id]?.total_spend_cents ?? (campaign.total_spend_cents / 100).toFixed(2),
        records_purchased: current[campaign.campaign_id]?.records_purchased ?? String(campaign.records_purchased),
        mixing_weight: current[campaign.campaign_id]?.mixing_weight ?? String(campaign.mixing_weight),
        [key]: value,
      },
    }));
  }

  const activeWeights = campaigns.filter((campaign) => campaign.status === "active");
  const weightTotal = activeWeights.reduce((sum, campaign) => sum + campaign.mixing_weight, 0);
  const draftCampaigns = campaigns.filter((campaign) => campaign.status === "draft").length;
  const spendCents = campaigns.reduce((sum, campaign) => sum + campaign.total_spend_cents, 0);
  const spendingVendors = new Set(campaigns.filter((campaign) => campaign.total_spend_cents > 0).map((campaign) => campaign.vendor_id)).size;
  const buyingVendors = rollup.filter((row) => row.active_campaign_count > 0).length;
  // Cost per dialable lead, headline: spend over usable records across the campaigns that have been
  // scrubbed — a sum over sums, never an average of each campaign's own rate, so a ten-record batch
  // cannot drag it. The per-row figures come from the database as they are.
  const usableBasis = campaigns.filter((campaign) => (campaign.records_usable ?? 0) > 0);
  const usableRecords = usableBasis.reduce((sum, campaign) => sum + (campaign.records_usable ?? 0), 0);
  const effectiveCostCents = usableRecords > 0 ? usableBasis.reduce((sum, campaign) => sum + campaign.total_spend_cents, 0) / usableRecords : null;

  // The control bar: one vendor, a search, and the filters behind one button with a count.
  const needle = search.trim().toLowerCase();
  const filtered = campaigns
    .filter((campaign) => vendorFilter === "all" || campaign.vendor_id === vendorFilter)
    .filter((campaign) => statusFilter.size === 0 || statusFilter.has(campaign.status))
    .filter((campaign) => typeFilter === "all" || campaign.lead_type === typeFilter)
    .filter((campaign) => !needle || `${campaign.name} ${vendorName.get(campaign.vendor_id) ?? ""} ${campaign.product_code ?? ""}`.toLowerCase().includes(needle))
    // Drafts first: a draft is the campaign that still needs something done before it can serve.
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.name.localeCompare(b.name));
  // Active campaigns the scrub gate is holding back — what the board's gate banner names.
  const gated = campaigns.filter((campaign) => campaign.status === "active" && !campaignServes(campaign.status, campaign.scrub_status));
  const filterCount = statusFilter.size + (typeFilter === "all" ? 0 : 1);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const shown = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);
  const sumRecords = filtered.reduce((sum, campaign) => sum + campaign.records_purchased, 0);
  const sumSpend = filtered.reduce((sum, campaign) => sum + campaign.total_spend_cents, 0);
  const sumUsable = filtered.reduce((sum, campaign) => sum + (campaign.records_usable ?? 0), 0);
  const sumUsableSpend = filtered.filter((campaign) => (campaign.records_usable ?? 0) > 0).reduce((sum, campaign) => sum + campaign.total_spend_cents, 0);

  function toggleStatus(status: string) {
    setStatusFilter((current) => { const next = new Set(current); if (next.has(status)) next.delete(status); else next.add(status); return next; });
    setPage(0);
  }

  return <div className="m-stagger portal-campaigns-view">
    <PageHeader
      eyebrow={sectionForPath("/app/campaigns") ?? undefined}
      title="Vendors & campaigns"
      description="Who you buy from, what each batch cost, and what a dialable lead really costs."
      actions={<>
        <Button type="button" variant="outline" onClick={() => { setNewCampaign(null); setNewVendor({ name: "", lead_type: "list", return_window_days: "30", terms: "" }); }}>New vendor</Button>
        <Button type="button" disabled={vendors.length === 0} title={vendors.length === 0 ? "Add a vendor first — a campaign belongs to one" : undefined} onClick={() => { setNewVendor(null); setNewCampaign({ vendor_id: vendors.find((vendor) => vendorTakesCampaigns(vendor.status))?.id ?? "", name: "", lead_type: "list", product_code: "", total_spend: "", records_purchased: "", mixing_weight: "1" }); }}>New campaign</Button>
      </>}
    />
    <div className="portal-campaigns-tiles">
      <StatTile label="Vendors" value={loading ? "—" : vendors.length} footnote={`${buyingVendors} buying now`} />
      <StatTile label="Active campaigns" value={loading ? "—" : activeWeights.length} footnote={`${draftCampaigns} draft`} />
      <StatTile label="Spend this period" value={loading ? "—" : money(spendCents)} footnote={`across ${spendingVendors} vendor${spendingVendors === 1 ? "" : "s"}`} />
      <StatTile label="Effective cost per dialable lead" value={loading ? "—" : money2(effectiveCostCents)} valueTone={effectiveCostCents === null ? undefined : "primary"} footnote="after suppression" />
    </div>
    {/* Usage against the cap, on the screen where the cap bites. Paused campaigns do not count. */}
    {limits.filter((item) => item.key === "max_active_campaigns" && item.limit !== null).map((item) => {
      const atLimit = item.usage >= (item.limit ?? 0);
      return <p key={item.key} className={`portal-campaigns-usage${atLimit ? " is-limit" : ""}`} role={atLimit ? "alert" : "status"}>
        {item.label}: <strong>{item.usage} of {item.limit}</strong> active
        {atLimit ? " — pause a finished campaign to free a slot, or upgrade your plan." : ". Paused campaigns do not use a slot."}
      </p>;
    })}
    {/* Said once, at the top, rather than as a "—" in eleven cells that each look like a bug. */}
    {pending.length > 0 && <section className="portal-campaigns-callout is-warning">
      <strong>Some measurements are not available yet</strong>
      <ul>{pending.map((item) => <li key={item.missing.join(",")}>{item.detail}</li>)}</ul>
    </section>}
    {faults.length > 0 && <Callout tone="error" title="Part of this page could not be loaded">
      <ul className="list-disc pl-5">{faults.map((fault) => <li key={fault}>{fault}</li>)}</ul>
    </Callout>}

    {/* Vendors region (vendor-roster.tsx): the form gained category, status, renewal and contact. */}
    {newVendor && <NewVendorPanel onClose={() => setNewVendor(null)} onCreated={load} />}

    {newCampaign && <section className="portal-campaigns-panel is-padded" aria-labelledby="new-campaign-heading">
      <div className="portal-campaigns-form-head"><h2 id="new-campaign-heading">New campaign</h2><Button type="button" variant="ghost" size="sm" onClick={() => setNewCampaign(null)}><X className="size-4" aria-hidden="true" />Cancel</Button></div>
      <p className="portal-campaigns-form-note">One batch with one purpose, belonging to one vendor. It carries the money, and every lead imported into it inherits its cost — so create it before the import, not after.</p>
      <div className="portal-campaigns-form-grid">
        {/* Active and under-review vendors take new campaigns (user decision); under review warns below. */}
        <label className="portal-campaigns-field" htmlFor="campaign-vendor"><span>Vendor</span><select id="campaign-vendor" value={newCampaign.vendor_id} onChange={(event) => setNewCampaign({ ...newCampaign, vendor_id: event.target.value })}>{vendors.filter((vendor) => vendorTakesCampaigns(vendor.status)).map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label>
        <label className="portal-campaigns-field"><span>Name</span><input value={newCampaign.name} onChange={(event) => setNewCampaign({ ...newCampaign, name: event.target.value })} placeholder="Apex Term Life · September" /></label>
        <label className="portal-campaigns-field"><span>Lead type</span><select value={newCampaign.lead_type} onChange={(event) => setNewCampaign({ ...newCampaign, lead_type: event.target.value })}><option value="list">List</option><option value="realtime">Real-time</option><option value="aged">Aged</option></select></label>
        <label className="portal-campaigns-field"><span>Product code</span><input value={newCampaign.product_code} onChange={(event) => setNewCampaign({ ...newCampaign, product_code: event.target.value })} placeholder="Optional" /></label>
        <label className="portal-campaigns-field"><span>Total spend ($)</span><input inputMode="decimal" value={newCampaign.total_spend} onChange={(event) => setNewCampaign({ ...newCampaign, total_spend: event.target.value })} placeholder="1750.00" /></label>
        <label className="portal-campaigns-field"><span>Records purchased</span><input inputMode="numeric" value={newCampaign.records_purchased} onChange={(event) => setNewCampaign({ ...newCampaign, records_purchased: event.target.value })} placeholder="5000" /></label>
        <label className="portal-campaigns-field"><span>Mixing weight</span><input inputMode="numeric" value={newCampaign.mixing_weight} onChange={(event) => setNewCampaign({ ...newCampaign, mixing_weight: event.target.value })} /></label>
      </div>
      {(() => {
        const picked = vendors.find((vendor) => vendor.id === newCampaign.vendor_id);
        const warning = picked ? vendorCampaignWarning(picked.status, picked.name) : null;
        return warning ? <Callout tone="warning" title={warning} /> : null;
      })()}
      <p className="portal-campaigns-form-note">Created as a draft. A campaign serves leads only once it is active <em>and</em> scrubbed, so activating an empty campaign would put it in the serving view with nothing in it.</p>
      <div className="portal-campaigns-form-actions"><Button type="button" disabled={!newCampaign.vendor_id || !newCampaign.name.trim() || creating} onClick={() => void createCampaign()}>{creating ? "Creating…" : "Create campaign"}</Button></div>
    </section>}

    <div className="portal-campaigns-bar">
      <select aria-label="Vendor" value={vendorFilter} onChange={(event) => { setVendorFilter(event.target.value); setPage(0); }}>
        <option value="all">All vendors</option>
        {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
      </select>
      <label className="portal-campaigns-search"><Search className="size-4" aria-hidden="true" /><input type="search" aria-label="Search campaigns" placeholder="Search campaigns" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} /></label>
      <div className="portal-campaigns-filters">
        <button type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}><SlidersHorizontal className="size-4" aria-hidden="true" />Filters{filterCount > 0 && <span className="portal-campaigns-count">{filterCount}</span>}</button>
        {filtersOpen && <div className="portal-campaigns-filter-panel" role="group" aria-label="Filter campaigns">
          <span>Status</span>
          {CAMPAIGN_STATUSES.map((status) => <label key={status} className="portal-remember-me"><input type="checkbox" checked={statusFilter.has(status)} onChange={() => toggleStatus(status)} />{STATUS_LABEL[status]}</label>)}
          <span>Lead type</span>
          <select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(0); }}><option value="all">Any</option><option value="list">List</option><option value="realtime">Real-time</option><option value="aged">Aged</option></select>
          {filterCount > 0 && <button type="button" className="portal-campaigns-clear" onClick={() => { setStatusFilter(new Set()); setTypeFilter("all"); setPage(0); }}>Clear filters</button>}
        </div>}
      </div>
    </div>

    <section className="portal-campaigns-panel" aria-label="Campaigns">
      {loading ? <p className="portal-campaigns-empty" role="status">Loading campaigns…</p>
        : loadError ? <p className="portal-campaigns-empty is-error" role="alert">Campaigns could not be loaded, so this is not a statement that you have none. {loadError}</p>
        : campaigns.length === 0 ? <p className="portal-campaigns-empty">{vendors.length === 0 ? "Start with a vendor — a campaign belongs to one, and a lead without a campaign carries no cost." : "No campaigns yet. A campaign is what carries the money — create one before importing a list, or the leads arrive with no cost attached."}</p>
        : filtered.length === 0 ? <p className="portal-campaigns-empty">No campaigns match these filters.</p>
        : <>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Campaign</TableHead>
              <TableHead className="w-[160px]">Vendor</TableHead>
              <TableHead className="w-[110px]">Status</TableHead>
              <TableHead className="w-[90px] text-right">Records</TableHead>
              <TableHead className="w-[110px] text-right">Spend</TableHead>
              <TableHead className="w-[110px] text-right">Cost/record</TableHead>
              <TableHead className="w-[110px] text-right">Effective</TableHead>
              <TableHead className="w-[80px] text-right">Weight</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {shown.map((campaign) => {
                const open = openId === campaign.campaign_id;
                const dirty = Boolean(edits[campaign.campaign_id]);
                const servingShare = campaign.status === "active" && weightTotal > 0 ? Math.round((campaign.mixing_weight / weightTotal) * 100) : null;
                const lead = progress?.[campaign.campaign_id] ?? null;
                const worked = workedPercent(lead);
                const outcome = outcomes?.[campaign.campaign_id] ?? null;
                const run = scrubRuns?.[campaign.campaign_id] ?? null;
                const isTest = testBatches?.[campaign.campaign_id] ?? false;
                return <Fragment key={campaign.campaign_id}>
                  <TableRow className={`portal-campaigns-row${open ? " is-open" : ""}`} onClick={() => setOpenId(open ? null : campaign.campaign_id)}>
                    <TableCell><button type="button" className="portal-campaigns-name" aria-expanded={open} onClick={(event) => { event.stopPropagation(); setOpenId(open ? null : campaign.campaign_id); }}>{campaign.name}</button></TableCell>
                    <TableCell>{vendorName.get(campaign.vendor_id) ?? "Unknown vendor"}</TableCell>
                    <TableCell>
                      <span className="flex flex-col items-start gap-1">
                        <span className={`portal-status-chip ${campaign.status === "active" ? "is-success" : campaign.status === "draft" ? "is-warning" : "is-neutral"}`}><span aria-hidden="true" />{STATUS_LABEL[campaign.status] ?? campaign.status}</span>
                        {/* The scrub gate as a state, not a badge: an unscrubbed campaign's leads are not servable. */}
                        {(campaign.status === "active" || campaign.status === "draft") && campaign.scrub_status !== "scrubbed" && <span className={`portal-status-chip ${campaign.scrub_status === "failed" ? "is-error" : campaign.scrub_status === "scrubbing" ? "is-info" : "is-warning"}`}><span aria-hidden="true" />{SCRUB_LABEL[campaign.scrub_status ?? "unscrubbed"] ?? campaign.scrub_status}</span>}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {campaign.records_purchased > 0 ? campaign.records_purchased.toLocaleString() : "—"}
                      {worked !== null && <span className="block text-[12px] leading-[1.4] font-normal text-[var(--muted)]">{worked}% worked</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(campaign.total_spend_cents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money2(campaign.cost_per_record_cents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money2(campaign.cost_per_usable_record_cents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{campaign.mixing_weight}</TableCell>
                  </TableRow>
                  {open && <TableRow className="portal-campaigns-detail-row"><TableCell colSpan={8}>
                    <div className="portal-campaigns-detail">
                      <dl>
                        <div><dt>Lead type</dt><dd>{campaign.lead_type}{campaign.product_code ? ` · ${campaign.product_code}` : ""}</dd></div>
                        {/* LA-2.3's gate, surfaced: only a scrubbed campaign serves leads. */}
                        <div><dt>Scrub</dt><dd>{SCRUB_LABEL[campaign.scrub_status ?? "unscrubbed"] ?? campaign.scrub_status}</dd></div>
                        <div><dt>Rejected at scrub</dt><dd className={(campaign.records_rejected ?? 0) > 0 ? "is-bad" : ""}>{count(campaign.records_rejected)}</dd></div>
                        <div><dt>Usable</dt><dd>{count(campaign.records_usable)}</dd></div>
                        <div><dt>Effective after credits</dt><dd>{perRecord(campaign.effective_cost_per_record_cents)}</dd></div>
                        {servingShare !== null && <div><dt>Share of serving</dt><dd>{servingShare}%</dd></div>}
                        {lead && <div><dt>Imported</dt><dd>{lead.first_import_at ? (day(lead.first_import_at) === day(lead.last_import_at) ? day(lead.first_import_at) : `${day(lead.first_import_at)} – ${day(lead.last_import_at)}`) : "Nothing imported yet"}</dd></div>}
                        {lead && <div><dt>Worked</dt><dd>{worked === null ? "—" : `${worked}% · ${lead.leads_dialed.toLocaleString()} of ${lead.leads_received.toLocaleString()} dialled`}</dd></div>}
                        {lead && <div><dt>Workable</dt><dd>{lead.leads_workable.toLocaleString()}</dd></div>}
                        {outcome && <div><dt>Issued</dt><dd>{outcome.issued.toLocaleString()}</dd></div>}
                        {outcome && <div><dt>Cost / issued</dt><dd>{money2(outcome.costPerIssuedCents)}</dd></div>}
                        {lead && <div><dt>Cadence</dt><dd>{lead.own_cadence_rules > 0 ? `Its own · ${lead.own_cadence_rules} ${lead.own_cadence_rules === 1 ? "rule" : "rules"}` : "The agency default"}</dd></div>}
                      </dl>
                      <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
                        <Link className="font-semibold text-[var(--accent-ink)] hover:underline" href={`/app/lead-lists/${campaign.campaign_id}`}>Open the list</Link>
                        <Link className="font-semibold text-[var(--accent-ink)] hover:underline" href={`/app/settings?cadenceCampaign=${campaign.campaign_id}#cadence`}>{lead && lead.own_cadence_rules > 0 ? "Edit its cadence" : "Give it its own cadence"}</Link>
                      </p>
                      <ScrubLine campaign={campaign} run={run} canScrub={canScrub && scrubRuns !== null} driving={driving} leads={lead?.leads_received ?? null} error={scrubError?.campaignId === campaign.campaign_id ? scrubError.message : null} onRun={() => void runScrub(campaign)} onStop={() => { stopRequested.current = true; }} />
                      {hasNoWorkableLeads(lead) && campaign.status !== "exhausted" && <p className="portal-campaigns-claim">No workable leads left — every lead in {campaign.name} is exhausted, closed or resting in nurture. Nothing changes on its own: mark it exhausted when you are done with it.</p>}
                      {(campaign.records_rejected ?? 0) > 0 && <p className="portal-campaigns-claim">{count(campaign.records_rejected)} purchased row{campaign.records_rejected === 1 ? "" : "s"} could never be dialed — about {money(campaign.rejected_spend_cents)} at the purchased rate. That gap is what a vendor return claim is for.</p>}
                      <div className="portal-campaigns-edit">
                        <label className="portal-campaigns-field"><span>Total spend ($)</span><input inputMode="decimal" value={editValue(campaign, "total_spend_cents")} onChange={(event) => setEdit(campaign, "total_spend_cents", event.target.value)} /></label>
                        <label className="portal-campaigns-field"><span>Records purchased</span><input inputMode="numeric" value={editValue(campaign, "records_purchased")} onChange={(event) => setEdit(campaign, "records_purchased", event.target.value)} /></label>
                        <label className="portal-campaigns-field"><span>Mixing weight</span><input inputMode="numeric" value={editValue(campaign, "mixing_weight")} onChange={(event) => setEdit(campaign, "mixing_weight", event.target.value)} /></label>
                        <Button type="button" disabled={!dirty || busy === campaign.campaign_id} onClick={() => {
                          const row = edits[campaign.campaign_id];
                          const spend = Math.round(Number(row.total_spend_cents) * 100);
                          const purchased = Number(row.records_purchased);
                          const weight = Number(row.mixing_weight);
                          if (!Number.isFinite(spend) || spend < 0) { notify.block("Enter a valid spend"); return; }
                          if (!Number.isInteger(purchased) || purchased < 0) { notify.block("Enter a whole number of records"); return; }
                          if (!Number.isInteger(weight) || weight < 1) { notify.block("Mixing weight must be 1 or more"); return; }
                          void patchCampaign(campaign.campaign_id, { total_spend_cents: spend, records_purchased: purchased, mixing_weight: weight }, "Campaign cost updated");
                        }}>Save cost</Button>
                        {campaign.status === "active"
                          ? <Button type="button" variant="outline" disabled={busy === campaign.campaign_id} onClick={() => void patchCampaign(campaign.campaign_id, { status: "paused" }, `${campaign.name} paused — its leads stopped being served`)}>Pause</Button>
                          : <Button type="button" variant="outline" disabled={busy === campaign.campaign_id} onClick={() => void patchCampaign(campaign.campaign_id, { status: "active" }, (result) => result.serving === false || !campaignServes("active", campaign.scrub_status) ? `${campaign.name} is active, but it will not serve leads until it is scrubbed.` : `${campaign.name} is serving again`)}>Activate</Button>}
                        {campaign.status !== "exhausted" && <Button type="button" variant="outline" disabled={busy === campaign.campaign_id} onClick={() => void patchCampaign(campaign.campaign_id, { status: "exhausted" }, `${campaign.name} marked exhausted — its leads are no longer served.`)}>Mark exhausted</Button>}
                        {testBatches !== null && <label className="flex items-center gap-2 text-[14px] text-[var(--body)]"><input type="checkbox" checked={isTest} disabled={busy === campaign.campaign_id} onChange={(event) => void patchCampaign(campaign.campaign_id, { is_test_batch: event.target.checked }, event.target.checked ? `${campaign.name} marked as a test batch.` : `${campaign.name} is no longer a test batch.`)} />Test batch</label>}
                      </div>
                      <p className="portal-campaigns-form-note">Pausing a campaign stops its leads being served immediately. Nothing is deleted.{weightTotal > 0 && activeWeights.length > 1 ? ` Active mixing weights total ${weightTotal}, so a campaign weighted 4 is served twice as often as one weighted 2.` : ""}</p>
                    </div>
                  </TableCell></TableRow>}
                </Fragment>;
              })}
            </TableBody>
            <tfoot className="portal-campaigns-foot">
              <tr>
                <td>{filtered.length} campaign{filtered.length === 1 ? "" : "s"}</td>
                <td /><td />
                <td className="text-right tabular-nums">{sumRecords.toLocaleString()}</td>
                <td className="text-right tabular-nums">{money(sumSpend)}</td>
                <td className="text-right tabular-nums">{money2(sumRecords > 0 ? sumSpend / sumRecords : null)}</td>
                <td className="text-right tabular-nums">{money2(sumUsable > 0 ? sumUsableSpend / sumUsable : null)}</td>
                <td />
              </tr>
            </tfoot>
          </Table>
          <div className="portal-campaigns-pager">
            <span>Showing {currentPage * PAGE_SIZE + 1}&ndash;{currentPage * PAGE_SIZE + shown.length} of {filtered.length} campaign{filtered.length === 1 ? "" : "s"} &middot; draft campaigns first</span>
            <span>
              <Button type="button" variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
              <Button type="button" variant="outline" size="sm" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</Button>
            </span>
          </div>
        </>}
      {/* The gate, stated as a rule rather than a warning: an active campaign that is not scrubbed
          hands out no leads. The queue enforces it (campaigns_servable); this only says so. */}
      {!loading && !loadError && gated.length > 0 && <div className="border-t border-[var(--border)] p-4">
        <Callout tone="warning" title={gated.length === 1 ? `${gated[0].name} ${scrubGateReason(gated[0].scrub_status)}` : `${gated.length} active campaigns serve no leads until they are scrubbed`}>
          {gated.length > 1 && <ul className="mb-2 list-disc pl-5">{gated.map((campaign) => <li key={campaign.campaign_id}>{campaign.name} {scrubGateReason(campaign.scrub_status)}</li>)}</ul>}
          Not a warning — the queue will not hand them out. If a scrub vendor is down, the scrub stops and dialing waits.
          {canScrub && scrubRuns !== null && gated.length === 1 && <> <button type="button" className="font-semibold text-[var(--accent-ink)] hover:underline disabled:opacity-60" disabled={driving !== null} onClick={() => void runScrub(gated[0])}>{scrubRuns[gated[0].campaign_id] && scrubRuns[gated[0].campaign_id].status !== "scrubbed" ? "Resume the scrub" : "Run the scrub"}</button></>}
          {gated.length > 1 && canScrub && scrubRuns !== null && " Open a campaign to run its scrub."}
        </Callout>
      </div>}
    </section>

    <div className="portal-campaigns-callout is-warning">
      <strong>A draft campaign is not dialable</strong>
      <p>A new campaign is created as a draft and activated only when the list is scrubbed. <strong>Effective cost</strong> is cost per <em>dialable</em> lead after suppression &mdash; the gap between the two money columns is the whole value of this screen, and neither is ever computed in the browser.</p>
    </div>

    {/* Not on the board, and kept: speed to lead and consent evidence per vendor are LA-2.5/2.6's
        acceptance figures and appear nowhere else. A cheap list nobody dials fast is not cheap.
        Vendors region (vendor-roster.tsx): the concept board's cost per policy, claimable returns,
        trial and drop facts are added to this table; the layout is the same table. */}
    {/* The failure is checked before the empty case: "no vendor rows" and "could not look" are
        different facts. The campaigns panel above already says why the load failed. */}
    {loadError ? <p className="portal-campaigns-empty is-error" role="alert">Vendor figures could not be loaded either, so no vendor is shown.</p>
      : rollup.length === 0 ? (vendors.length === 0 && !loading && !loadError ? <p className="portal-campaigns-empty">No vendors yet. Add the one you buy from with New vendor, and its costs, speed and returns collect here.</p> : null)
      : !loading && <VendorRoster
      vendors={vendors}
      rollup={rollup}
      speed={speed}
      consent={consent}
      onChanged={load}
      onNewCampaign={(vendorId, leadType) => {
        // "Order another": the New campaign form with this vendor chosen. Nothing is bought.
        setNewVendor(null);
        setNewCampaign({ vendor_id: vendorId, name: "", lead_type: leadType, product_code: "", total_spend: "", records_purchased: "", mixing_weight: "1" });
        requestAnimationFrame(() => document.getElementById("new-campaign-heading")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      }}
      onShowCampaigns={(vendorId) => {
        setVendorFilter(vendorId);
        setPage(0);
        requestAnimationFrame(() => document.querySelector(".portal-campaigns-bar")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      }}
    />}
  </div>;
}

/**
 * The scrub line in a campaign's detail: what the latest run did, and the owner's action. Producers
 * see the progress; only an owner runs a scrub (it bills screening lookups).
 */
function ScrubLine({ campaign, run, canScrub, driving, leads, error, onRun, onStop }: {
  campaign: Campaign;
  run: ScrubRun | null;
  canScrub: boolean;
  driving: string | null;
  leads: number | null;
  error: string | null;
  onRun: () => void;
  onStop: () => void;
}) {
  const here = driving === campaign.campaign_id;
  const open = run && run.status !== "scrubbed";
  const stale = run ? scrubRunIsStale(run) : false;
  const quiet = run ? minutesSince(run.last_progress_at) : null;
  const elsewhere = run?.status === "running" && !here && !stale && !heldScrubToken(campaign.campaign_id);
  const counts = run ? `${run.processed_leads.toLocaleString()} of ${run.total_leads.toLocaleString()} leads screened · ${run.rejected_leads.toLocaleString()} failed` : null;

  let status: string | null = null;
  if (here && run) status = `Scrubbing — ${counts}. Keep this page open; the campaign serves no leads until it finishes.`;
  else if (run?.status === "running" && stale) status = `A scrub stopped making progress ${quiet} minutes ago at ${counts}. It can be resumed from where it stopped.`;
  else if (run?.status === "running") status = `A scrub is running — ${counts}. Last progress ${quiet === 0 ? "under a minute" : `${quiet} minute${quiet === 1 ? "" : "s"}`} ago.`;
  else if (run?.status === "failed") status = `The last scrub failed at ${counts}: ${run.error ?? "it could not be completed"}`;
  else if (run?.status === "scrubbed") status = `Last scrubbed ${new Date(run.finished_at ?? run.last_progress_at).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} — ${counts}.`;

  const label = open ? "Resume the scrub" : campaign.scrub_status === "scrubbed" ? "Scrub again" : "Run the scrub";
  const cannot = !canScrub ? "Only an owner can run a scrub — it bills screening lookups." : leads === 0 ? "Nothing has been imported into this campaign yet." : elsewhere ? "Another window is running this scrub." : null;

  if (!status && !canScrub && !error) return null;
  return <div className="flex flex-col gap-2 text-[14px] leading-[1.5] text-[var(--body)]">
    {status && <p className="m-0" role={here ? "status" : undefined}>{status}</p>}
    {error && <p className="m-0 text-[var(--error-ink)]" role="alert">{error}</p>}
    {canScrub && <div className="flex flex-wrap items-center gap-2">
      {here
        ? <Button type="button" variant="outline" size="sm" onClick={onStop}>Pause the scrub</Button>
        : <Button type="button" variant="outline" size="sm" disabled={Boolean(cannot) || driving !== null} title={cannot ?? (driving !== null ? "Another campaign is being scrubbed from this page." : undefined)} onClick={onRun}>{label}</Button>}
      {!here && cannot && <span className="text-[12px] text-[var(--muted)]">{cannot}</span>}
    </div>}
  </div>;
}

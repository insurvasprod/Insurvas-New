"use client";

import { useEffect, useCallback, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity, AlertTriangle, Archive, ArrowRight, BadgeCheck, BadgeDollarSign, CalendarDays, CheckCircle2, Coins, Hourglass, Layers, LifeBuoy, ListChecks, Loader2,
  ArrowLeft, ChevronDown, Package, Pause, Pencil, Settings as SettingsIcon, Phone, PhoneCall, PieChart, Play, Plus, Receipt, RefreshCw, Repeat, ShieldAlert, ShieldCheck, Store, Trash2, Upload, WifiOff, XCircle,
} from "lucide-react";
import { notify } from "@/lib/notify";
import { useSoldProducts } from "@/components/app/products/use-sold-products";
import {
  CAMPAIGN_STATUS_ORDER,
  SCRUB_LABEL as SCRUB_STATUS_LABEL,
  campaignServes,
  hasNoWorkableLeads,
  minutesSince,
  scrubGateReason,
  scrubRunIsStale,
  scrubStoppedByOutage,
  workedPercent,
  type CampaignProgress,
  type ScrubRun,
} from "@/lib/campaigns/constants";

import { Button } from "@/components/ui/button";
import { ToolbarSearch } from "@/components/ui/data-toolbar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RowActions } from "@/components/app/campaigns/row-actions";
import { DetailPanel } from "@/components/ui/detail-panel";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cardSurface } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { control, Field, ToggleRow } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, ErrorState, NoMatches } from "@/components/ui/page-states";
import { Meter, StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Pager, paginate } from "@/components/ui/pager";
import { LEAD_TYPE, LeadTypeChoice, NewVendorPanel, VendorRoster, VendorSettings, VendorSheet, useVendorCards, type RosterRollup } from "@/components/app/vendor-roster";
import { VendorScorecard } from "@/components/app/campaigns/vendor-scorecard";
import { Figure } from "@/components/app/campaigns/figure";
import { LifecycleTrack, NEW_CAMPAIGN_STEPS, type LifecycleOff, type StepTone } from "@/components/app/campaigns/lifecycle";
import { NumberStepper } from "@/components/app/campaigns/number-stepper";
import { campaignDeleteBlocked, deleteCampaign } from "@/components/app/campaigns/delete-campaign";
import { useVendorDelete, type DeletableVendor } from "@/components/app/campaigns/delete-vendor";
import { type FigureTone } from "@/components/app/campaigns/tones";
import { LeadsInSlot, useInLeadsFrame } from "@/components/app/lead-sources/leads-in-slot";
import { useFittingPageSize } from "@/components/app/lead-ops-view-tabs";
import { NextUp, type NextUpTone } from "@/components/app/lead-sources/next-up";
import { Callout } from "@/components/app/settings/primitives";
import { STATE_NAMES } from "@/lib/callbacks/windowFacts";
import { VENDOR_STATUS_LABEL, vendorTakesCampaigns } from "@/lib/vendors/types";
import { isOwnBookVendor } from "@/lib/campaigns/ownBook";
import { cn } from "@/lib/utils";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { StatusChip } from "@/components/ui/status-chip";
import { UnderlineTabs } from "@/components/ui/view-tabs";

/**
 * Lead sources › 1 · Source (owner pick "A · Vendor first", canvas M2 · Vendors & campaigns,
 * 2026-10-28; /ui-taste critique 2026-10-29). The vendors down the left; the picked vendor's
 * scorecard and campaigns on the right. Each campaign shows its way to serving leads — list in,
 * scrubbed, live — and the one action its stage needs; it opens in the side panel with its figures,
 * cost and weight, target states and status, and one Save. "Compare vendors" keeps the side-by-side
 * vendor table. The whole step is one screen tall and its lists scroll inside themselves.
 */
type View = "campaigns" | "vendors";
type CardTab = "needs" | "live" | "drafts" | "all";
type VendorTab = "campaigns" | "scorecard" | "settings";
const CARD_TAB_LABEL: Record<CardTab, string> = { needs: "Needs you", live: "Live", drafts: "Drafts", all: "All" };

type Campaign = {
  campaign_id: string; vendor_id: string; name: string; lead_type: string; product_code: string | null;
  status: string; scrub_status: string | null; mixing_weight: number;
  total_spend_cents: number; records_purchased: number; credits_received_cents: number;
  records_rejected: number | null; records_usable: number | null;
  cost_per_record_cents: number | null; effective_cost_per_record_cents: number | null;
  cost_per_usable_record_cents: number | null; rejected_spend_cents: number | null;
};
type Vendor = { id: string; name: string; lead_type: string; return_window_days: number; status: string; terms: string | null; notes: string | null; category?: string | null; renews_on?: string | null; contact?: Record<string, unknown> | null };
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
/** tenant_campaign_funnel (20260925709800): all-time leads, dialable, dialled and contacted per campaign. */
type Funnel = { leads_received: number; dialable_leads: number; dialed_leads: number; contacted_leads: number; quoted_leads: number };
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
// filterable. The scrub labels are the four values the database holds.
const STATUS_ORDER = CAMPAIGN_STATUS_ORDER;
const SCRUB_LABEL = SCRUB_STATUS_LABEL;
/** Rows per page; the list scrolls inside its card, so this is a page of reading, not of screen. */
/** A list card that reaches the foot of the step; its rows scroll inside and the pager stays at the foot. */
const FILL_CARD = "flex min-w-0 flex-col lg:min-h-0 lg:flex-1 [&>.overflow-x-auto]:flex-1 lg:[&>.overflow-x-auto]:min-h-0 lg:[&>.overflow-x-auto]:overflow-y-auto [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-[1]";
/** A choice of this many products or fewer is chips; more is a dropdown. */
const PRODUCT_CHIPS_MAX = 4;

/** Issued policies and cost per issued policy, from True CPA's report (null without True CPA). */
type Outcome = { applications: number; issued: number; costPerIssuedCents: number | null };

/** "14 Sep 2026" — an import date, in the viewer's own zone. */
function day(iso: string | null | undefined) {
  if (!iso) return "—";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "—" : at.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

/** Where "Import its list" goes: the importer with this campaign (and its product) chosen. */
function importHref(campaignId: string, productCode: string | null | undefined) {
  return `/app/import?campaign=${encodeURIComponent(campaignId)}${productCode ? `&product=${encodeURIComponent(productCode)}` : ""}`;
}

/** "$1,750.00" or "1750" typed → cents; null when blank, NaN when not an amount. */
function typedCents(text: string) {
  const clean = text.replace(/[$,\s]/g, "");
  if (!clean) return null;
  return /^\d+(\.\d{1,2})?$/.test(clean) ? Math.round(Number(clean) * 100) : Number.NaN;
}
function typedCount(text: string) {
  const clean = text.replace(/[,\s]/g, "");
  if (!clean) return null;
  return /^\d+$/.test(clean) ? Number(clean) : Number.NaN;
}
/** Spend over records as you type, at three decimals; "—" until both make sense. */
function liveCostPerRecord(spendText: string, recordsText: string) {
  const spend = typedCents(spendText);
  const records = typedCount(recordsText);
  return spend !== null && records !== null && Number.isFinite(spend) && Number.isFinite(records) && records > 0 ? perRecord(spend / records) : "—";
}
/** A weight's share of serving, against the other active campaigns' weights. */
function shareOf(weightText: string, others: number) {
  const weight = Number(weightText);
  if (!Number.isInteger(weight) || weight < 1) return null;
  return Math.round((100 * weight) / (others + weight));
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

/** How far a scrub run got, as a whole percent. */
function runPercent(run: ScrubRun | null | undefined) {
  return run && run.total_leads > 0 ? Math.round((100 * run.processed_leads) / run.total_leads) : null;
}

/**
 * The scrub as a state (owner 2026-10-28: no banners — the row carries it). A scrubbed campaign is a
 * green shield; an outage is red, "Service down — paused at 62%"; never scrubbed amber.
 */
function ScrubState({ campaign, run, compact = false }: { campaign: Campaign; run: ScrubRun | null; compact?: boolean }) {
  const pct = runPercent(run);
  const icon = "size-3";
  // `compact`: the table row, where the column is narrow; the full words are the title and the panel.
  if (scrubStoppedByOutage(run)) return <StatusChip tone="danger" dot={false} title={`Screening service is down${pct !== null ? ` — paused at ${pct}%` : ""}. Nothing unchecked is dialled. Open it to check again.`}><WifiOff className={icon} aria-hidden="true" />Service down{pct !== null && !compact ? ` — paused at ${pct}%` : ""}</StatusChip>;
  if (run?.status === "running" && scrubRunIsStale(run)) return <StatusChip tone="warning" dot={false} title="This scrub stopped making progress. It can be resumed from where it stopped."><Hourglass className={icon} aria-hidden="true" />Stalled{pct !== null ? ` at ${pct}%` : ""}</StatusChip>;
  if (run?.status === "running" || campaign.scrub_status === "scrubbing") return <StatusChip tone="info" dot={false}><Loader2 className={cn(icon, "motion-safe:animate-spin")} aria-hidden="true" />Scrubbing{pct !== null ? ` ${pct}%` : ""}</StatusChip>;
  if (campaign.scrub_status === "failed" || run?.status === "failed") return <StatusChip tone="danger" dot={false} title={run?.error ?? undefined}><XCircle className={icon} aria-hidden="true" />{SCRUB_LABEL.failed}{pct !== null ? ` at ${pct}%` : ""}</StatusChip>;
  if (campaign.scrub_status === "scrubbed") return <span className="inline-flex text-[var(--success-ink)]" title={SCRUB_LABEL.scrubbed}><ShieldCheck className="size-4" aria-hidden="true" /><span className="sr-only">{SCRUB_LABEL.scrubbed}</span></span>;
  return <StatusChip tone={campaign.status === "active" || campaign.status === "draft" ? "warning" : "neutral"} dot={false}><ShieldAlert className={icon} aria-hidden="true" />{SCRUB_LABEL.unscrubbed}</StatusChip>;
}

/** Where a campaign is on its way to serving leads, and how that step is going. */
type Stage = { current: number; tone: StepTone; off: LifecycleOff; label: ReactNode | null; leadsIn: number | null };
type FocusTab = "lists" | "report" | "settings";

/** `embedded`: drawn as step 1 of Lead sources, whose frame is the page's. */
export function CampaignWorkspace({ embedded = false, readOnly = false, focusId = null, owedCents = null, assign = null, initialTab = "lists", vendorId = null, initialVendorTab = "campaigns", vendorsPage = false, report = null, children = null }: {
  embedded?: boolean;
  /** The plan is read-only (paused, suspended, cancelled): everything shows, nothing changes. */
  readOnly?: boolean;
  /**
   * Source › a campaign (/app/campaigns/<id>, board LirF1): the campaign takes the page — its name,
   * its figures in one line, Edit and "+ Import a list" — and `children` (its lists and the list
   * sections) below. Every action of the grid (the edit panel, scrub, activate, delete) stays.
   */
  focusId?: string | null;
  /** What the vendor owes back on this campaign, for the figures line (lead list detail's claims). */
  owedCents?: number | null;
  /** The campaign's unowned leads and its assign drawer (server-rendered), for the next-up line; null when this person cannot assign. */
  assign?: { count: number; node: ReactNode } | null;
  /** The campaign page's view (owner pick C, 2026-10-30): its lists, its report, or its Settings (`?tab=`). */
  initialTab?: FocusTab;
  /**
   * The campaign's report (removed at import, not being served, column map, health, consent): a view
   * of its own beside Lists, not a collapsible under them (owner 2026-10-30).
   */
  report?: ReactNode;
  /**
   * Source › a vendor (/app/campaigns/vendors/<id>, owner pick C, 2026-10-30, board LirE6): its
   * campaigns, its scorecard and its Settings, as tabs. The grid filtered to the vendor is the first.
   */
  vendorId?: string | null;
  initialVendorTab?: VendorTab;
  /** Source › Vendors (/app/campaigns/vendors, owner 2026-10-30): every vendor, to add, edit and delete. */
  vendorsPage?: boolean;
  children?: ReactNode;
} = {}) {
  const router = useRouter();
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
  // Module 2 §5: VENDOR → CAMPAIGN → LIST → LEADS. Without a campaign every imported lead is free,
  // which makes the whole cost analysis empty — so both ends have a form here.
  const [newVendor, setNewVendor] = useState(false);
  const soldProducts = useSoldProducts();
  const [newCampaign, setNewCampaign] = useState<{ vendor_id: string; name: string; lead_type: string; product_code: string; total_spend: string; records_purchased: string; mixing_weight: string } | null>(null);
  const [creating, setCreating] = useState(false);
  /** The vendor picked on the left, or "all". */
  const [vendorFilter, setVendorFilter] = useState(vendorId ?? "all");
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState("all");
  /** "Screening down": just the campaigns the outage stopped. */
  const [onlyIds, setOnlyIds] = useState<Set<string> | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  /** The campaign open in the side panel. */
  const [openId, setOpenId] = useState<string | null>(null);
  /** Which section of it to show: a row opens its Numbers, the row's pen its Cost & weight. */
  const [panelTab, setPanelTab] = useState<{ tab: PanelTab; at: number }>({ tab: "numbers", at: 0 });
  const openPanel = (id: string, tab: PanelTab) => { setPanelTab((current) => ({ tab, at: current.at + 1 })); setOpenId(id); };
  const [view, setView] = useState<View>(vendorsPage ? "vendors" : "campaigns");
  const [vendorsTab, setVendorsTab] = useState<"manage" | "compare">("manage");
  const [vendorListPage, setVendorListPage] = useState(1);
  /** The grid's tabs (board LirN1): what needs you first, then live, drafts, everything. */
  const [show, setShow] = useState<CardTab>("all");
  const [focusTab, setFocusTab] = useState<FocusTab>(initialTab);
  const [vendorTab, setVendorTab] = useState<VendorTab>(initialVendorTab);
  const pickVendorTab = (tab: VendorTab) => {
    setVendorTab(tab);
    try { window.history.replaceState(null, "", tab === "campaigns" ? window.location.pathname : `?tab=${tab}`); } catch { /* the tab still changes */ }
  };
  /** Lists | Report | Settings on a campaign, kept in the address so a reload or a shared link opens the same view. */
  const pickFocusTab = (tab: FocusTab) => {
    setFocusTab(tab);
    try { window.history.replaceState(null, "", tab === "lists" ? window.location.pathname : `?tab=${tab}`); } catch { /* the view still changes */ }
  };
  /** Lists (committed imports) per campaign; null before the campaigns read answers it. */
  const [listCounts, setListCounts] = useState<Record<string, number> | null>(null);
  /** The vendor whose edit form is open from its scorecard. */
  const [editVendorId, setEditVendorId] = useState<string | null>(null);
  const inFrame = useInLeadsFrame();
  // As many campaigns as fit the window (the pager takes the rest), like every other list table.
  const gridPageSize = useFittingPageSize(360, 57);
  // Campaigns concept audit (LA-2 §5). Each is null when its migration is not applied, and the line
  // that shows it is then left out rather than drawn as a zero.
  const [progress, setProgress] = useState<Record<string, CampaignProgress> | null>(null);
  const [scrubRuns, setScrubRuns] = useState<Record<string, ScrubRun> | null>(null);
  const [testBatches, setTestBatches] = useState<Record<string, boolean> | null>(null);
  const [targetStates, setTargetStates] = useState<Record<string, string[]> | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome> | null>(null);
  // LA-2.1-3: leads, dialable and contacts per campaign. Null until its migration is applied.
  const [funnel, setFunnel] = useState<Record<string, Funnel> | null>(null);
  const [canScrub, setCanScrub] = useState(false);
  const [faults, setFaults] = useState<string[]>([]);
  /** The campaign whose scrub this window is driving, one batch per request. */
  const [driving, setDriving] = useState<string | null>(null);
  const [scrubError, setScrubError] = useState<{ campaignId: string; message: string } | null>(null);
  const stopRequested = useRef(false);
  /** "Pause the scrub": the loop in runScrub stops after the batch in flight. */
  const stopScrub = useCallback(() => { stopRequested.current = true; }, []);
  const { facts, factsError } = useVendorCards(rollup);

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
    setTargetStates(campaignBody.targetStates ?? null);
    setOutcomes(campaignBody.outcomes ?? null);
    setFunnel(campaignBody.funnel ?? null);
    setListCounts(campaignBody.listCounts ?? null);
    setCanScrub(Boolean(campaignBody.canScrub));
    setFaults(Array.isArray(campaignBody.faults) ? campaignBody.faults : []);
    // LA-2.22 criterion 4: "every limited screen shows usage against the cap" — the Active
    // campaigns tile carries it, with the way to more.
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
      ...(campaignBody.funnelPending ? [campaignBody.funnelPending] : []),
    ]);
  }).then(() => setLoadError(null)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Could not load this page";
    notify.fail(message);
    // A toast disappears; the body does not. Holding the failure in state is what stops the sections
    // below from going on to assert "No vendors yet".
    setLoadError(message);
  }).finally(() => setLoading(false)), []);

  useEffect(() => { void load(); }, [load]);

  // Delete vendor (owner 2026-10-29): one confirm, or two when it has campaigns. The page lets go of
  // the vendor it was showing, then reloads (also after a partial delete, when some campaigns went).
  const vendorDelete = useVendorDelete(async (deletedId) => {
    if (deletedId) {
      setVendorFilter((current) => (current === deletedId ? "all" : current));
      setEditVendorId((current) => (current === deletedId ? null : current));
      // Deleted from its own page: back to the campaigns.
      if (vendorId === deletedId) { router.push("/app/campaigns"); return; }
    }
    await load();
  });

  // Board LirN1 has no Refresh button: "Try again" on a failed read reloads, and every action reloads after it.
  async function refresh() { await load(); }

  const vendorName = useMemo(() => new Map(vendors.map((vendor) => [vendor.id, vendor.name])), [vendors]);

  /** Another campaign of this vendor with the same name (the database allows it; the importer could not tell them apart). */
  function duplicateName(vendorId: string, name: string) {
    const wanted = name.trim().toLocaleLowerCase();
    return wanted !== "" && campaigns.some((campaign) => campaign.vendor_id === vendorId && campaign.name.trim().toLocaleLowerCase() === wanted);
  }

  /** One PATCH to a campaign; true when it saved. */
  async function patchCampaign(id: string, body: Record<string, unknown>, successMessage: string | ((result: { serving?: boolean }) => string)): Promise<boolean> {
    setBusy(id);
    try {
      const response = await fetch(`/api/app/campaigns/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => null);
      if (!response.ok) { notify.block(result?.error ?? "Could not update this campaign"); return false; }
      notify.done(typeof successMessage === "function" ? successMessage(result ?? {}) : successMessage);
      await load();
      return true;
    } finally {
      setBusy(null);
    }
  }
  const activate = (campaign: Campaign) => void patchCampaign(campaign.campaign_id, { status: "active" }, (result) => result.serving === false || !campaignServes("active", campaign.scrub_status) ? `${campaign.name} is active, but it will not serve leads until it is scrubbed.` : `${campaign.name} is serving again`);
  const pause = (campaign: Campaign) => void patchCampaign(campaign.campaign_id, { status: "paused" }, `${campaign.name} paused — its leads stopped being served`);
  async function exhaust(campaign: Campaign) {
    const ok = await confirmAction({
      title: `Mark ${campaign.name} exhausted?`,
      description: "Its leads stop being served. Order another campaign from the same vendor when you buy more.",
      confirmLabel: "Mark exhausted",
    });
    if (ok) await patchCampaign(campaign.campaign_id, { status: "exhausted" }, `${campaign.name} marked exhausted — its leads are no longer served.`);
  }

  /** Delete an empty campaign for good (2026-10-29). The server refuses one with any history, and says why. */
  async function removeCampaign(campaign: Campaign) {
    const ok = await confirmAction({
      title: "Are you sure you want to delete this?",
      description: `The campaign ${campaign.name} from ${vendorName.get(campaign.vendor_id) ?? "its vendor"} is deleted for good, with its own cadence and scripts. Nothing has been imported into it.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusy(campaign.campaign_id);
    try {
      if (!(await deleteCampaign(campaign.campaign_id, campaign.name))) return;
      setOpenId(null);
      // Deleted from its own page: back to the campaigns, not a "not found" for the one just removed.
      if (focusId === campaign.campaign_id) { router.push("/app/campaigns"); return; }
      await load();
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
      const ok = await confirmAction({
        title: `Re-screen ${campaign.name}?`,
        confirmLabel: "Re-screen leads",
        destructive: false,
        description: `Re-screen ${leads === undefined ? "every lead" : `all ${leads.toLocaleString()} leads`} in ${campaign.name}? Each number is checked against the litigator and do-not-call lists, and the lookups count against your plan's screening allowance. The campaign serves no leads until the scrub finishes. Numbers that fail are suppressed and recorded against the campaign.`,
      });
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
    // Checked before anything is created: "abc" in Total spend used to save the campaign at $0.00
    // without a word, and the cost of a lead is the number this product is for (QA 2026-10-22).
    const spendText = newCampaign.total_spend.replace(/[$,\s]/g, "");
    const purchasedText = newCampaign.records_purchased.replace(/[,\s]/g, "");
    if (spendText && !/^\d+(\.\d{1,2})?$/.test(spendText)) { notify.block("Total spend must be an amount in dollars, like 1750.00."); return; }
    if (purchasedText && !/^\d+$/.test(purchasedText)) { notify.block("Records purchased must be a whole number."); return; }
    if (duplicateName(newCampaign.vendor_id, newCampaign.name)) return;
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
      // cost fields belong to the same PATCH that the panel uses, so there is one place where
      // spend changes and one place that re-derives cost per record.
      const spend = Math.round(Number(spendText || 0) * 100);
      const purchased = Number(purchasedText || 0);
      const weight = Math.min(100, Math.max(1, Math.floor(Number(newCampaign.mixing_weight)) || 1));
      if (Number.isFinite(spend) && spend >= 0 && Number.isInteger(purchased) && purchased >= 0) {
        // The campaign exists by now; a refused cost is said, never left as a silent $0.00.
        const costed = await fetch(`/api/app/campaigns/${body.campaign.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ total_spend_cents: spend, records_purchased: purchased, mixing_weight: weight }),
        }).catch(() => null);
        if (!costed?.ok) {
          const refusal = await costed?.json().catch(() => null);
          notify.block(`${body.campaign.name} was created, but its cost was not saved`, { detail: `${refusal?.error ?? "The connection dropped."} Enter it under Cost & weight.` });
        }
      }
      const newId: string = body.campaign.id;
      const product = newCampaign.product_code.trim() || null;
      // The next step is the list: offered on the toast, and the new campaign opens beside its vendor.
      notify.done(`${body.campaign.name} created as a draft`, { action: { label: "Import its list", onClick: () => router.push(importHref(newId, product)) }, durationMs: 8000 });
      setVendorFilter(newCampaign.vendor_id);
      setView("campaigns");
      setOnlyIds(null);
      setPage(0);
      setNewCampaign(null);
      await load();
      openPanel(newId, "numbers");
    } finally { setCreating(false); }
  }

  const activeWeights = campaigns.filter((campaign) => campaign.status === "active");
  const weightTotal = activeWeights.reduce((sum, campaign) => sum + campaign.mixing_weight, 0);
  // Cost per dialable lead, headline: spend over usable records across the campaigns that have been
  // scrubbed — a sum over sums, never an average of each campaign's own rate, so a ten-record batch
  // cannot drag it. The per-row figures come from the database as they are.
  const usableBasis = campaigns.filter((campaign) => (campaign.records_usable ?? 0) > 0);
  const usableRecords = usableBasis.reduce((sum, campaign) => sum + (campaign.records_usable ?? 0), 0);
  const effectiveCostCents = usableRecords > 0 ? usableBasis.reduce((sum, campaign) => sum + campaign.total_spend_cents, 0) / usableRecords : null;
  const leadsInOf = (campaign: Campaign) => funnel?.[campaign.campaign_id]?.leads_received ?? progress?.[campaign.campaign_id]?.leads_received ?? null;

  // The control bar: a search and the filters behind one button with a count; the vendor is the list on the left.
  const needle = search.trim().toLowerCase();
  const vendorCampaigns = campaigns.filter((campaign) => vendorFilter === "all" || campaign.vendor_id === vendorFilter);
  const filtered = vendorCampaigns
    .filter((campaign) => !onlyIds || onlyIds.has(campaign.campaign_id))
    .filter((campaign) => statusFilter.size === 0 || statusFilter.has(campaign.status))
    .filter((campaign) => typeFilter === "all" || campaign.lead_type === typeFilter)
    .filter((campaign) => !needle || `${campaign.name} ${vendorName.get(campaign.vendor_id) ?? ""} ${campaign.product_code ?? ""}`.toLowerCase().includes(needle))
    // Drafts first: a draft is the campaign that still needs something done before it can serve.
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.name.localeCompare(b.name));
  // The grid's tabs (LirN1). "Needs you" is every campaign whose stage asks for a step (no list yet,
  // the scrub, going live) or that is in trouble; a used-up campaign has "Order another" and is not.
  /** Nobody can dial it: an active campaign the scrub holds back, or a scrub that failed or stopped. */
  const blockedNow = (campaign: Campaign) => {
    if (campaign.status === "exhausted") return false;
    const stage = stageOf(campaign);
    return stage.current === 1 && (stage.tone === "danger" || campaign.status === "active");
  };
  const needsYou = (campaign: Campaign) => {
    if (campaign.status === "exhausted") return false;
    const stage = stageOf(campaign);
    return stage.current < 3 || stage.tone === "danger" || stage.tone === "warning" || hasNoWorkableLeads(progress?.[campaign.campaign_id] ?? null);
  };
  const inTab = (campaign: Campaign, tab: CardTab) => tab === "all" ? true
    : tab === "needs" ? needsYou(campaign)
    // "Active" counts what the menu counts (status active), so the two numbers agree.
    : tab === "live" ? campaign.status === "active"
    : campaign.status === "draft";
  const tabCount = (tab: CardTab) => filtered.filter((campaign) => inTab(campaign, tab)).length;
  // Nothing needs you: the grid opens on everything rather than on an empty tab.
  const tabShown: CardTab = show === "needs" && tabCount("needs") === 0 && filtered.length > 0 ? "all" : show;
  // Most urgent first (critique 2026-10-30): what nobody can dial, then what waits on a step, then the rest.
  const urgency = (campaign: Campaign) => (blockedNow(campaign) ? 0 : needsYou(campaign) ? 1 : campaign.status === "active" ? 2 : 3);
  const tabbed = filtered.filter((campaign) => inTab(campaign, tabShown)).sort((a, b) => urgency(a) - urgency(b));
  const pageCount = Math.max(1, Math.ceil(tabbed.length / gridPageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const shown = tabbed.slice(currentPage * gridPageSize, currentPage * gridPageSize + gridPageSize);
  const vendorRows = paginate(vendors, vendorListPage, gridPageSize);

  if (loading) return <PageLoading />;

  // Usage against the cap, on the screen where the cap bites. Paused campaigns do not count.
  const activeUsage = limits.find((item) => item.key === "max_active_campaigns") ?? null;
  const activeLimit = activeUsage && activeUsage.limit !== null ? activeUsage : null;
  const atActiveLimit = activeLimit !== null && activeLimit.usage >= (activeLimit.limit ?? 0);
  const clearFilters = () => { setSearch(""); setStatusFilter(new Set()); setTypeFilter("all"); setOnlyIds(null); setPage(0); };
  const pickedVendor = vendorFilter === "all" ? null : vendors.find((vendor) => vendor.id === vendorFilter) ?? null;
  const takes = (vendorId: string | undefined) => Boolean(vendorId && vendorTakesCampaigns(vendors.find((vendor) => vendor.id === vendorId)?.status ?? ""));
  // New campaign starts on the picked vendor (A · Vendor first); otherwise the first that takes campaigns.
  const openNewCampaign = (vendorId?: string, leadType?: string) => {
    setNewVendor(false);
    const chosen = takes(vendorId) ? vendorId! : vendors.find((vendor) => vendorTakesCampaigns(vendor.status))?.id ?? "";
    setNewCampaign({ vendor_id: chosen, name: "", lead_type: leadType ?? vendors.find((vendor) => vendor.id === chosen)?.lead_type ?? "list", product_code: "", total_spend: "", records_purchased: "", mixing_weight: "1" });
  };
  const openNewVendor = () => { setNewCampaign(null); setNewVendor(true); };
  const pickVendor = (vendorId: string) => { setVendorFilter(vendorId); setOpenId(null); setOnlyIds(null); setPage(0); setView("campaigns"); };
  // LA-2.3: a screening outage is said once, as a red badge in the top row; each stopped row says it too.
  const stopped = loadError ? [] : campaigns.filter((campaign) => scrubStoppedByOutage(scrubRuns?.[campaign.campaign_id]));
  const rollupFor = (vendor: Vendor): RosterRollup => rollup.find((row) => row.vendor_id === vendor.id) ?? {
    vendor_id: vendor.id, vendor_name: vendor.name, lead_type: vendor.lead_type, status: vendor.status, return_window_days: vendor.return_window_days,
    campaign_count: 0, active_campaign_count: 0, total_spend_cents: 0, records_purchased: 0, records_rejected: null, cost_per_record_cents: null, cost_per_usable_record_cents: null,
  };
  const editVendor = editVendorId ? vendors.find((vendor) => vendor.id === editVendorId) ?? null : null;
  const deletable = (vendorId: string): DeletableVendor | null => {
    const vendor = vendors.find((item) => item.id === vendorId);
    if (!vendor) return null;
    const figures = rollupFor(vendor);
    // The page's own count, so a campaign the rollup has not seen yet still asks the second question.
    const own = campaigns.filter((campaign) => campaign.vendor_id === vendorId);
    return {
      id: vendor.id, name: vendor.name,
      campaign_count: Math.max(figures.campaign_count, own.length),
      active_campaign_count: figures.active_campaign_count,
      total_spend_cents: figures.total_spend_cents,
      records_purchased: figures.records_purchased,
    };
  };
  const deleteVendor = (vendorId: string) => { const vendor = deletable(vendorId); if (vendor) void vendorDelete.requestDelete(vendor); };

  // Why nothing can be added or changed, when the plan is read-only; said on every button it stops.
  const locked = readOnly ? "Your plan is read-only — nothing can be added or changed until it is active again." : null;
  // A campaign needs a vendor that takes campaigns (active or under review): a retired one never does.
  const noVendorForCampaign = locked ?? (vendors.length === 0 ? "Add a vendor first — a campaign belongs to one"
    : !vendors.some((vendor) => vendorTakesCampaigns(vendor.status)) ? "Set a vendor to active first — a retired vendor takes no new campaigns" : null);
  const newCampaignFor = (vendor: Vendor | null, outline = false) => {
    const no = noVendorForCampaign ?? (vendor && !takes(vendor.id) ? `Set ${vendor.name} to active first to add a campaign from it` : null);
    return <Button type="button" variant={outline ? "outline" : "default"} disabled={no !== null} title={no ?? (vendor ? `A new campaign from ${vendor.name}` : undefined)} onClick={() => openNewCampaign(vendor?.id)}><Plus aria-hidden="true" />New Campaign</Button>;
  };
  // At the plan's cap, Activate is held here rather than refused by the server after the click.
  const activateBlocked = locked ?? (atActiveLimit && activeLimit ? `Your plan allows ${activeLimit.limit} active campaign${activeLimit.limit === 1 ? "" : "s"}. Pause one, or see plans.` : null);

  // The two create actions, just before Refresh in whichever table is showing (owner 2026-10-28). New campaign is the one primary.
  const createActions = <>
    <Button type="button" variant="outline" disabled={locked !== null} title={locked ?? undefined} onClick={openNewVendor}><Store aria-hidden="true" />New Vendor</Button>
    {newCampaignFor(pickedVendor)}
  </>;

  /** Where a campaign is: list in → scrubbed → live, with a dimmed paused or exhausted after. */
  function stageOf(campaign: Campaign): Stage {
    const id = campaign.campaign_id;
    const lead = progress?.[id] ?? null;
    const leadsIn = leadsInOf(campaign);
    const run = scrubRuns?.[id] ?? null;
    const off: LifecycleOff = campaign.status === "paused" ? "paused" : campaign.status === "exhausted" ? "exhausted" : null;
    // The caption under the track is only for what the track and the button cannot say (owner
    // 2026-10-29: "Waiting for its list" went — the track and "Import its list" say it). A scrub in
    // trouble, an active campaign the scrub holds back, and a live list with nothing left keep theirs.
    const exhausted = campaign.status === "exhausted";
    // Nothing imported: whatever its status says, it is waiting for its list. Nothing to scrub yet.
    if (leadsIn === 0) return { current: 0, tone: null, off, label: null, leadsIn };
    if (campaign.scrub_status !== "scrubbed") {
      const problem: StepTone = scrubStoppedByOutage(run) || campaign.scrub_status === "failed" || run?.status === "failed" ? "danger"
        : run?.status === "running" && scrubRunIsStale(run) ? "warning"
          : run?.status === "running" || campaign.scrub_status === "scrubbing" ? "busy" : null;
      // An active campaign the scrub gate holds back is amber: it serves no leads.
      const gated = campaign.status === "active";
      return {
        current: 1, tone: problem ?? (gated ? "warning" : null), off, leadsIn,
        label: exhausted ? null : problem ? <ScrubState campaign={campaign} run={run} compact /> : gated ? <span title={`${campaign.name} ${scrubGateReason(campaign.scrub_status)}`}>Not serving until scrubbed</span> : null,
      };
    }
    if (campaign.status !== "active") return { current: 2, tone: null, off, leadsIn, label: null };
    return { current: 3, tone: null, off, leadsIn, label: hasNoWorkableLeads(lead) ? "No leads left" : null };
  }

  /** The one action a campaign's stage needs; a live, healthy campaign has none, only its list. */
  function stageAction(campaign: Campaign, stage: Stage, primary = false, short = false): ReactNode {
    // The Source table's short words (board LirS1: "Import", "Open"); the full words everywhere else.
    const say = (full: string, brief: string) => (short ? brief : full);
    // The next-up line shows a campaign's step as the page's one primary; on a card it is outline.
    const look = primary ? {} : { variant: "outline" as const, size: "sm" as const };
    const id = campaign.campaign_id;
    const lead = progress?.[id] ?? null;
    const run = scrubRuns?.[id] ?? null;
    const disabled = busy === id;
    const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
    if (campaign.status === "exhausted") {
      const no = locked ?? (takes(campaign.vendor_id) ? null : "Set this vendor to active to order more.");
      return <Button type="button" {...look} disabled={no !== null} title={no ?? "A new campaign from the same vendor — nothing is bought"} onClick={(event) => { stop(event); openNewCampaign(campaign.vendor_id, campaign.lead_type); }}><Plus aria-hidden="true" />{say("Order another", "Reorder")}</Button>;
    }
    if (stage.current === 0) return locked
      ? <Button type="button" {...look} disabled title={locked}><Upload aria-hidden="true" />{say("Import its list", "Import")}</Button>
      : <Button asChild {...look}><Link href={importHref(id, campaign.product_code)} onClick={stop}><Upload aria-hidden="true" />{say("Import its list", "Import")}</Link></Button>;
    if (stage.current === 1) {
      if (driving === id) return <Button type="button" {...look} onClick={(event) => { stop(event); stopScrub(); }}><Pause aria-hidden="true" />Pause the scrub</Button>;
      const resume = Boolean(run && run.status !== "scrubbed");
      const elsewhere = run?.status === "running" && !scrubRunIsStale(run) && !heldScrubToken(id);
      const cannot = locked ?? (!canScrub || scrubRuns === null ? "Ask an owner to run the scrub — it bills screening lookups." : elsewhere ? "Another window is running this scrub." : driving !== null ? "Another campaign is being scrubbed from this page." : null);
      return <Button type="button" {...look} disabled={cannot !== null} title={cannot ?? undefined} onClick={(event) => { stop(event); void runScrub(campaign); }}>{resume ? <Play aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}{resume ? "Resume" : say("Run the scrub", "Scrub")}</Button>;
    }
    if (stage.current === 2) return <Button type="button" {...look} disabled={disabled || activateBlocked !== null} title={activateBlocked ?? undefined} onClick={(event) => { stop(event); activate(campaign); }}><Play aria-hidden="true" />Activate</Button>;
    if (hasNoWorkableLeads(lead)) return <Button type="button" {...look} disabled={disabled || locked !== null} title={locked ?? "No workable leads left"} onClick={(event) => { stop(event); void exhaust(campaign); }}><Archive aria-hidden="true" />{say("Mark exhausted", "Used up")}</Button>;
    return <Button asChild {...look}><Link href={`/app/campaigns/${id}`} onClick={stop}>Open</Link></Button>;
  }

  /**
   * What a campaign needs next, in one plain sentence (critique 2026-10-30: say why, not just a chip).
   * Null for a live campaign with leads to call: nothing to do.
   */
  function nextStepText(campaign: Campaign, stage: Stage): string | null {
    const run = scrubRuns?.[campaign.campaign_id] ?? null;
    const lead = progress?.[campaign.campaign_id] ?? null;
    if (campaign.status === "exhausted") return "Used up. Order another to keep calling this vendor.";
    if (stage.current === 0) return "No list yet. Import its list to start.";
    if (stage.current === 1) {
      if (scrubStoppedByOutage(run)) return "The Do Not Call check is down. Resume the scrub once it is back — nothing unchecked gets through.";
      if (campaign.scrub_status === "failed" || run?.status === "failed") return "The scrub failed. Run it again so it can be dialed.";
      if (run?.status === "running" || campaign.scrub_status === "scrubbing") return "Being scrubbed against Do Not Call lists.";
      return "Not scrubbed yet. Run the scrub — nobody can dial it until then.";
    }
    if (stage.current === 2) return campaign.status === "paused" ? "Paused. Activate it to dial again." : "Scrubbed and ready. Activate it to start dialing.";
    if (hasNoWorkableLeads(lead)) return "Every lead has been worked. Mark it exhausted, or recycle its leads.";
    if (campaign.status === "paused") return "Paused. Activate it to dial again.";
    return null;
  }

  /** The one word for where a campaign is, as its card's chip (board LirN1). */
  function campaignChip(campaign: Campaign, stage: Stage): ReactNode {
    const lead = progress?.[campaign.campaign_id] ?? null;
    if (campaign.status === "exhausted") return <StatusChip tone="neutral">Used up</StatusChip>;
    if (campaign.status === "paused") return <StatusChip tone="neutral">Paused</StatusChip>;
    if (stage.current === 0) return <StatusChip tone="neutral">{campaign.status === "draft" ? "Draft" : "No list yet"}</StatusChip>;
    if (stage.current === 1) {
      if (stage.tone === "busy") return <StatusChip tone="info">Scrubbing</StatusChip>;
      // Not scrubbed and active, or the scrub failed: nobody can dial it (scrubGateReason).
      if (stage.tone === "danger" || campaign.status === "active") return <StatusChip tone="danger" title={`${campaign.name} ${scrubGateReason(campaign.scrub_status) ?? ""}`.trim()}>Can&apos;t be dialed</StatusChip>;
      return <StatusChip tone="warning">Not scrubbed</StatusChip>;
    }
    if (stage.current === 2) return <StatusChip tone="neutral">Draft</StatusChip>;
    if (hasNoWorkableLeads(lead)) return <StatusChip tone="warning">No leads left</StatusChip>;
    return <StatusChip tone="good">Live</StatusChip>;
  }

  /**
   * The campaign page's mark beside its name (owner 2026-10-30): an X where the grid says "Can't be
   * dialed", the reason in its tooltip; every other state keeps its chip.
   */
  function focusMark(campaign: Campaign, stage: Stage): ReactNode {
    const blocked = stage.current === 1 && stage.tone !== "busy" && (stage.tone === "danger" || campaign.status === "active");
    if (!blocked) return campaignChip(campaign, stage);
    const reason = `Can't be dialed. ${scrubGateReason(campaign.scrub_status) ?? ""}`.trim();
    return <span role="img" aria-label={reason} title={reason} className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--error-surface)] text-[var(--error-ink)]"><XCircle className="size-4" aria-hidden="true" /></span>;
  }

  /** "Screening down": the stopped campaigns alone, the first one open. */
  function showStopped() {
    if (stopped.length === 0) return;
    setView("campaigns");
    setVendorFilter("all");
    setOnlyIds(new Set(stopped.map((campaign) => campaign.campaign_id)));
    setPage(0);
    openPanel(stopped[0].campaign_id, "numbers");
  }

  const outage = stopped.length > 0 ? <button type="button" className="rounded-badge outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={showStopped} title={`${stopped.length === 1 ? stopped[0].name : `${stopped.length} campaigns`} stopped scrubbing because the Do Not Call check did not answer. Unchecked numbers are never let through, so nothing is lost — resume the scrub once the service is back. Show ${stopped.length === 1 ? "it" : "them"}.`}>
    <StatusChip tone="danger" dot={false}>Screening down · {stopped.length}</StatusChip>
  </button> : null;
  const openCampaign = openId ? campaigns.find((campaign) => campaign.campaign_id === openId) ?? null : null;
  const pickedForNew = newCampaign ? vendors.find((vendor) => vendor.id === newCampaign.vendor_id) : undefined;
  const newShare = newCampaign ? shareOf(newCampaign.mixing_weight, weightTotal) : null;
  const nameTaken = newCampaign ? duplicateName(newCampaign.vendor_id, newCampaign.name) : false;

  // "Your own book" (Import, 2026-10-29) is the stand-in vendor for lists with no vendor: said so.
  const ownBook = (vendorId: string) => isOwnBookVendor(vendorName.get(vendorId));
  const vendorLine = (vendorId: string) => (ownBook(vendorId) ? "No vendor · your own book" : vendorName.get(vendorId) ?? "Unknown vendor");
  const focused = focusId ? campaigns.find((campaign) => campaign.campaign_id === focusId) ?? null : null;

  // Vendors live in the filter (board LirV1): pick one to see its campaigns, its cost beside it; adding
  // one, or the full vendor view (scorecards, compare, edit, delete), one click from the same menu.
  const vendorPicker = <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="outline" aria-label="Filter by vendor">
        {pickedVendor ? (isOwnBookVendor(pickedVendor.name) ? "No vendor" : pickedVendor.name) : "Vendor"}<ChevronDown aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="max-h-[70vh] w-80 overflow-y-auto">
      <DropdownMenuItem onSelect={() => pickVendor("all")} className={cn("flex h-auto items-center justify-between gap-3 py-2", vendorFilter === "all" && "bg-[var(--primary-soft)]")}>
        <span className="font-semibold text-[var(--ink)]">All vendors</span>
        <span className="shrink-0 text-xs text-[var(--ink)] tabular-nums">{campaigns.length} campaign{campaigns.length === 1 ? "" : "s"}</span>
      </DropdownMenuItem>
      {vendors.map((vendor) => {
        const figures = rollupFor(vendor);
        const own = isOwnBookVendor(vendor.name);
        return <DropdownMenuItem key={vendor.id} onSelect={() => pickVendor(vendor.id)} className={cn("flex h-auto items-center justify-between gap-3 py-2", vendorFilter === vendor.id && "bg-[var(--primary-soft)]")}>
          <span className="min-w-0 truncate font-semibold text-[var(--ink)]">{own ? "No vendor · your own book" : vendor.name}</span>
          <span className="shrink-0 text-xs text-[var(--ink)] tabular-nums">{figures.campaign_count} campaign{figures.campaign_count === 1 ? "" : "s"}</span>
        </DropdownMenuItem>;
      })}
      <DropdownMenuSeparator />
      <div className="flex items-center justify-between gap-2">
        <DropdownMenuItem disabled={locked !== null} onSelect={openNewVendor} className="font-semibold text-[var(--accent-ink)]"><Plus aria-hidden="true" />Add a vendor</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push("/app/campaigns/vendors")} className="font-semibold text-[var(--accent-ink)]">Manage vendors<ArrowRight aria-hidden="true" /></DropdownMenuItem>
      </div>
    </DropdownMenuContent>
  </DropdownMenu>;

  const tabChips = (["all", "live", "needs", "drafts"] as const).map((tab) => (
    <ToggleChip key={tab} role="radio" selected={tabShown === tab} onClick={() => { setShow(tab); setPage(0); }} count={tabCount(tab)}>
      {CARD_TAB_LABEL[tab]}
    </ToggleChip>
  ));
  // The top row: the campaign open (LirF1), the vendor view, or the grid's search, vendor, tabs (LirN1).
  // Board LirS1's figures, from what the campaigns read already returns.
  const liveCount = campaigns.filter((campaign) => campaign.status === "active").length;
  const spendAll = campaigns.reduce((sum, campaign) => sum + campaign.total_spend_cents, 0);
  const issuedBasis = campaigns.filter((campaign) => (outcomes?.[campaign.campaign_id]?.issued ?? 0) > 0);
  const issuedAll = issuedBasis.reduce((sum, campaign) => sum + (outcomes?.[campaign.campaign_id]?.issued ?? 0), 0);
  const perIssued = issuedAll > 0 ? issuedBasis.reduce((sum, campaign) => sum + campaign.total_spend_cents, 0) / issuedAll : null;
  const owedOf = (campaign: Campaign) => Math.max(0, (campaign.rejected_spend_cents ?? 0) - (campaign.credits_received_cents ?? 0));
  const owedBack = campaigns.reduce((sum, campaign) => sum + owedOf(campaign), 0);
  const owedCampaigns = campaigns.filter((campaign) => owedOf(campaign) > 0).length;
  const vendorPage = vendorId ? vendors.find((vendor) => vendor.id === vendorId) ?? null : null;
  const topRow = vendorId
    ? <>
      <Link href="/app/campaigns" className="text-sm font-semibold text-[var(--accent-ink)] hover:underline">‹ All campaigns</Link>
      {vendorPage && <span data-leads-crumb={isOwnBookVendor(vendorPage.name) ? "No vendor" : vendorPage.name} className="min-w-0 truncate text-xl font-semibold tracking-[-0.02em] text-[var(--ink)]">{isOwnBookVendor(vendorPage.name) ? "No vendor · your own book" : vendorPage.name}</span>}
      {vendorPage && <StatusChip tone={vendorPage.status === "active" ? "good" : vendorPage.status === "under_review" ? "warning" : "neutral"}>{VENDOR_STATUS_LABEL[vendorPage.status as keyof typeof VENDOR_STATUS_LABEL] ?? vendorPage.status}</StatusChip>}
      {vendorPage && <div className="ml-3 flex items-center gap-1.5" role="group" aria-label="Vendor sections">
        {(["campaigns", "scorecard", "settings"] as const).map((tab) => <ToggleChip key={tab} selected={vendorTab === tab} onClick={() => pickVendorTab(tab)}>{tab === "campaigns" ? "Campaigns" : tab === "scorecard" ? "Scorecard" : "Settings"}</ToggleChip>)}
      </div>}
      {outage}
    </>
    : focusId
    ? <>
      {/* Owner 2026-10-30: a real button back, the name, and an X where "Can't be dialed" was. */}
      <Button asChild variant="outline"><Link href="/app/campaigns"><ArrowLeft aria-hidden="true" />All campaigns</Link></Button>
      {focused && <span data-leads-crumb={focused.name} className="min-w-0 truncate text-xl font-semibold tracking-[-0.02em] text-[var(--ink)]">{focused.name}</span>}
      {focused && focusMark(focused, stageOf(focused))}
    </>
    : view === "vendors"
      ? <>
        <Link href="/app/campaigns" className="text-sm font-semibold text-[var(--accent-ink)] hover:underline">‹ All campaigns</Link>
        <span data-leads-crumb="Vendors" className="text-xl font-semibold tracking-[-0.02em] text-[var(--ink)]">Vendors</span>
      </>
      : <>
        {/* Board LirS1: search, the tabs, the vendor filter, Vendors (add, edit, delete). */}
        <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(0); }} placeholder="Search campaigns" className="sm:w-64" />
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Show">{tabChips}</div>
        {vendorPicker}
      </>;
  const gridRow = !focusId && !vendorId && view === "campaigns";
  const focusStage = focused ? stageOf(focused) : null;
  // A campaign's next-up line: its stage's step first, then its unowned leads, else all clear.
  const focusNext: { tone: NextUpTone; text: ReactNode; action: ReactNode } | null = focused && focusStage ? (() => {
    const text = nextStepText(focused, focusStage);
    if (text) return { tone: blockedNow(focused) ? "danger" as const : "warning" as const, text, action: stageAction(focused, focusStage, true) };
    if (assign && assign.count > 0) return { tone: "action" as const, text: <><strong>{count(assign.count)}</strong> {assign.count === 1 ? "lead has" : "leads have"} no owner yet. Assign them so they reach the dialer.</>, action: assign.node };
    return { tone: "done" as const, text: <>Live, with <strong>{count(progress?.[focused.campaign_id]?.leads_workable ?? null)}</strong> leads left to call.</>, action: null };
  })() : null;
  // The corner: the one primary. New campaign on the grid; on a campaign, Edit beside "+ Import a list".
  // On the Settings tab the form puts its own Save there.
  const corner = vendorId
    ? vendorTab === "campaigns" && vendorPage ? newCampaignFor(vendorPage) : null
    : focusId
    ? focused && focusStage && <>
      {focusTab !== "settings" && <Button type="button" variant="outline" onClick={() => pickFocusTab("settings")}><Pencil aria-hidden="true" />Edit</Button>}
      {/* Settings beside Edit, the same button with a gear (owner 2026-10-30); pressed while open. */}
      <Button type="button" variant="outline" aria-pressed={focusTab === "settings"} onClick={() => pickFocusTab(focusTab === "settings" ? "lists" : "settings")} className={cn(focusTab === "settings" && "border-transparent bg-[var(--primary-soft)] text-[var(--accent-ink)] hover:bg-[var(--primary-soft)] dark:border-transparent dark:bg-[var(--primary-soft)] dark:text-[var(--accent-ink)] dark:hover:bg-[var(--primary-soft)]")}><SettingsIcon aria-hidden="true" />Settings</Button>
      {/* The stage's own step is the next-up line's button (the page's one primary); this stays outline. */}
      {focusTab !== "settings" && (locked
        ? <Button type="button" variant="outline" disabled title={locked}><Plus aria-hidden="true" />Import a list</Button>
        : <Button asChild variant="outline"><Link href={importHref(focused.campaign_id, focused.product_code)}><Plus aria-hidden="true" />Import a list</Link></Button>)}
      {/* The settings form's Discard and Save land here (LeadsInSlot "continue"). */}
      <span id="leads-in-continue" className="contents" />
    </>
    // The Vendors page's one primary is adding one.
    : view === "vendors" ? <Button type="button" disabled={locked !== null} title={locked ?? undefined} onClick={openNewVendor}><Plus aria-hidden="true" />Add a vendor</Button>
    // Board LirS1: "Vendors" (add, edit, delete them) beside "+ New campaign", the one primary.
    : <><Button asChild variant="outline"><Link href="/app/campaigns/vendors" title="Add, edit and delete vendors"><Store aria-hidden="true" />Vendors</Link></Button>{newCampaignFor(pickedVendor)}</>;

  return <div className="m-stagger flex w-full min-w-0 flex-col gap-4 text-[var(--ink)] lg:min-h-0 lg:flex-1">
    {!embedded && <PageHeader title="Vendors & campaigns" />}
    {/* A campaign's own row sits in the step's column, level with the rail's top (owner 2026-10-30). */}
    {inFrame && !focusId
      ? <>{!gridRow && <LeadsInSlot slot="lead">{topRow}</LeadsInSlot>}{!gridRow && <LeadsInSlot slot="continue">{corner}</LeadsInSlot>}</>
      : <div className="flex min-w-0 flex-wrap items-center gap-3">{topRow}<span className="ml-auto flex flex-wrap items-center gap-2">{corner}</span></div>}
    {/* LA-2.22: usage against the cap, said where it bites — once the plan's limit is reached. */}
    {!focusId && atActiveLimit && activeLimit && <Callout tone="warning" title={`${activeLimit.usage} of ${activeLimit.limit} active campaigns — your plan's limit.`}>Pause one to activate another, or <Link href="/app/settings#billing" className="font-semibold text-[var(--accent-ink)] hover:underline">see plans</Link>.</Callout>}
    {locked && <Callout tone="warning" title="Your plan is read-only. You can look at everything here; adding, importing and scrubbing are paused until it is active again." />}
    {/* Said once, at the top, rather than as a "—" in eleven cells that each look like a bug. */}
    {pending.length > 0 && <Callout tone="warning" title="Some measurements are not available yet">{pending.map((item) => item.detail).join(" ")}</Callout>}
    {faults.length > 0 && <Callout tone="error" title="Part of this page could not be loaded">
      <ul className="list-disc pl-5">{faults.map((fault) => <li key={fault}>{fault}</li>)}</ul>
    </Callout>}

    {/* Source › a campaign (LirF1): its figures in one line, then its lists and the list's sections. */}
    {focusId && (loadError
      ? <ErrorState title="This campaign did not load" detail={loadError} action={<Button variant="outline" onClick={() => void refresh()}>Try again</Button>} />
      : !focused
        ? <EmptyState title="Campaign not found" hint="It may have been deleted." action={<Button asChild variant="outline"><Link href="/app/campaigns">All campaigns</Link></Button>} />
        : focusTab === "settings" ? <CampaignSettings
          campaign={focused}
          vendors={vendors}
          products={soldProducts ?? null}
          isTest={testBatches === null ? null : testBatches[focused.campaign_id] ?? false}
          savedStates={targetStates === null ? null : targetStates[focused.campaign_id] ?? []}
          otherActiveWeight={weightTotal - (focused.status === "active" ? focused.mixing_weight : 0)}
          busy={busy === focused.campaign_id}
          locked={locked}
          scrub={focusStage && focusStage.leadsIn !== 0 ? <ScrubLine campaign={focused} run={scrubRuns?.[focused.campaign_id] ?? null} canScrub={canScrub && scrubRuns !== null} driving={driving} leads={progress?.[focused.campaign_id]?.leads_received ?? null} error={scrubError?.campaignId === focused.campaign_id ? scrubError.message : null} onRun={() => void runScrub(focused)} onStop={stopScrub} /> : null}
          statusChip={focusStage ? campaignChip(focused, focusStage) : null}
          onSave={(body) => patchCampaign(focused.campaign_id, body, `${body.name ?? focused.name} saved`)}
          onActivate={() => activate(focused)}
          onPause={() => pause(focused)}
          onExhaust={() => void exhaust(focused)}
          deleteBlocked={focusStage ? campaignDeleteBlocked(focusStage.leadsIn) : null}
          onDelete={() => void removeCampaign(focused)}
        />
        : <>
          {focusNext && <NextUp tone={focusNext.tone} action={focusNext.action}>{focusNext.text}</NextUp>}
          {/* The campaign's facts, labelled (owner 2026-10-30: "shown a bit better"). */}
          <StatStrip label="Campaign facts">
            <StatTile label="Vendor" valueSize="text" value={<Link href={`/app/campaigns/vendors/${focused.vendor_id}`} className="hover:underline">{vendorLine(focused.vendor_id)}</Link>} />
            {/* Names, not codes ("Term Life", not "term_life"). */}
            <StatTile label="Lead type" valueSize="text" value={LEAD_TYPE[focused.lead_type] ?? focused.lead_type} footnote={focused.product_code ? soldProducts?.find((product) => product.code === focused.product_code)?.name ?? focused.product_code : undefined} />
            <StatTile label="Spent" value={money(focused.total_spend_cents)} footnote={focused.cost_per_usable_record_cents !== null ? `${money2(focused.cost_per_usable_record_cents)} per usable lead` : undefined} />
            <StatTile label="Left to call" value={count(progress?.[focused.campaign_id]?.leads_workable ?? null)} footnote={outcomes?.[focused.campaign_id]?.costPerIssuedCents != null ? `${money2(outcomes[focused.campaign_id].costPerIssuedCents)} per issued policy` : undefined} />
            {owedCents !== null && owedCents > 0 && <StatTile label="Owed back" value={money2(owedCents)} valueTone="warning" footnote="by the vendor" />}
          </StatStrip>
          {report && <div className="flex items-center gap-2" role="radiogroup" aria-label="Campaign view">
            <ToggleChip role="radio" selected={focusTab === "lists"} onClick={() => pickFocusTab("lists")} count={listCounts?.[focused.campaign_id]}>Lists</ToggleChip>
            <ToggleChip role="radio" selected={focusTab === "report"} onClick={() => pickFocusTab("report")}>Report</ToggleChip>
          </div>}
          {focusTab === "report" && report ? report : children}
        </>)}

    {/* A new vendor is picked on the left, so its empty campaign table offers the next step: its first campaign. */}
    {newVendor && <NewVendorPanel onClose={() => setNewVendor(false)} onCreated={async (created) => { await load(); if (created) { if (vendorsPage) router.push(`/app/campaigns/vendors/${created.id}`); else pickVendor(created.id); } }} />}

    <Dialog open={newCampaign !== null} onOpenChange={(open) => { if (!open) setNewCampaign(null); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>New Campaign</DialogTitle>
        </DialogHeader>
        {newCampaign && <>
          {/* Where it goes from here, as icons: created as a draft, then its list, the scrub, live. */}
          <LifecycleTrack steps={NEW_CAMPAIGN_STEPS} current={0} labels />
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Active and under-review vendors take new campaigns (user decision); under review warns below. */}
            <Field label="Vendor" htmlFor="campaign-vendor"><select id="campaign-vendor" className={control} value={newCampaign.vendor_id} onChange={(event) => setNewCampaign({ ...newCampaign, vendor_id: event.target.value, lead_type: vendors.find((vendor) => vendor.id === event.target.value)?.lead_type ?? newCampaign.lead_type })}>{vendors.filter((vendor) => vendorTakesCampaigns(vendor.status)).map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></Field>
            <Field label="Name" htmlFor="campaign-name" error={nameTaken ? `${pickedForNew?.name ?? "This vendor"} already has a campaign with this name.` : undefined}><input id="campaign-name" className={control} maxLength={160} value={newCampaign.name} onChange={(event) => setNewCampaign({ ...newCampaign, name: event.target.value })} placeholder="Apex Term Life · September" aria-invalid={nameTaken || undefined} /></Field>
          </div>
          <div className="grid gap-1.5">
            <span id="campaign-type-label" className="text-label text-[var(--body)]">Lead type</span>
            <LeadTypeChoice value={newCampaign.lead_type} onChange={(next) => setNewCampaign({ ...newCampaign, lead_type: next })} labelledBy="campaign-type-label" />
          </div>
          {/* Settings › Products (2026-10-27): a product the agency sells, not a typed code. */}
          {(soldProducts?.length ?? 0) <= PRODUCT_CHIPS_MAX
            ? <div className="grid gap-1.5">
              <span id="campaign-product-label" className="text-label text-[var(--body)]">Product</span>
              <div role="radiogroup" aria-labelledby="campaign-product-label" className="flex flex-wrap gap-1.5">
                <ToggleChip role="radio" selected={newCampaign.product_code === ""} onClick={() => setNewCampaign({ ...newCampaign, product_code: "" })}>Any product</ToggleChip>
                {(soldProducts ?? []).map((product) => <ToggleChip key={product.code} role="radio" selected={newCampaign.product_code === product.code} onClick={() => setNewCampaign({ ...newCampaign, product_code: product.code })}>{product.name}</ToggleChip>)}
              </div>
            </div>
            : <Field label="Product" htmlFor="campaign-product"><select id="campaign-product" className={control} value={newCampaign.product_code} onChange={(event) => setNewCampaign({ ...newCampaign, product_code: event.target.value })}><option value="">Any product</option>{(soldProducts ?? []).map((product) => <option key={product.code} value={product.code}>{product.name}</option>)}</select></Field>}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Total spend ($)" htmlFor="campaign-spend"><input id="campaign-spend" className={control} inputMode="decimal" value={newCampaign.total_spend} onChange={(event) => setNewCampaign({ ...newCampaign, total_spend: event.target.value })} placeholder="1750.00" /></Field>
            <Field label="Records purchased" htmlFor="campaign-records"><input id="campaign-records" className={control} inputMode="numeric" value={newCampaign.records_purchased} onChange={(event) => setNewCampaign({ ...newCampaign, records_purchased: event.target.value })} placeholder="5000" /></Field>
            <div className="min-w-0">
              <span className="text-label text-[var(--body)]">Cost per record</span>
              <p className="m-0 mt-1.5 flex h-9 items-center text-sm font-semibold tabular-nums text-[var(--ink)]" aria-live="polite">{liveCostPerRecord(newCampaign.total_spend, newCampaign.records_purchased)}</p>
            </div>
          </div>
          <Field label="Mixing weight" htmlFor="campaign-weight">
            <NumberStepper id="campaign-weight" value={newCampaign.mixing_weight} onChange={(next) => setNewCampaign({ ...newCampaign, mixing_weight: next })} min={1} max={100} label="mixing weight" after={newShare === null ? null : `${newShare}% of serving once live`} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNewCampaign(null)}>Cancel</Button>
            <Button type="button" disabled={!newCampaign.vendor_id || !newCampaign.name.trim() || nameTaken || creating} onClick={() => void createCampaign()}><Plus aria-hidden="true" />{creating ? "Creating…" : "Create campaign"}</Button>
          </DialogFooter>
        </>}
      </DialogContent>
    </Dialog>

    {/* Source (board LirN1): one card per campaign, what needs you first; a card opens its campaign. */}
    {/* A vendor's Scorecard and Settings tabs (LirE6); its Campaigns tab is the grid below, filtered to it. */}
    {vendorId && !vendorPage && !loading && !loadError && <EmptyState title="Vendor not found" hint="It may have been deleted." action={<Button asChild variant="outline"><Link href="/app/campaigns">All campaigns</Link></Button>} />}
    {vendorPage && vendorTab === "scorecard" && <VendorScorecard
      key={vendorPage.id}
      vendor={vendorPage}
      rollup={rollup.find((row) => row.vendor_id === vendorPage.id)}
      fact={facts?.cards.find((card) => card.vendor_id === vendorPage.id)}
      facts={facts}
      speed={speed.find((row) => row.vendor_id === vendorPage.id)}
      consent={consent.find((row) => row.vendor_id === vendorPage.id)}
      usableReference={effectiveCostCents}
      onEdit={() => pickVendorTab("settings")}
      onDelete={() => deleteVendor(vendorPage.id)}
      deleting={vendorDelete.busy}
      onOrderAnother={() => openNewCampaign(vendorPage.id, vendorPage.lead_type)}
    />}
    {vendorPage && vendorTab === "settings" && <VendorSettings
      key={vendorPage.id}
      row={vendorPage}
      locked={locked}
      onSaved={load}
      onDelete={() => deleteVendor(vendorPage.id)}
      deleting={vendorDelete.busy}
    />}
    {!focusId && view === "campaigns" && (!vendorId || (vendorPage && vendorTab === "campaigns")) && <div role="region" aria-label="Campaigns" className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:flex-1">
      {/* Search, tabs, the vendor filter, then Vendors and "+ New campaign" on the same line. */}
      {gridRow && inFrame && <div className="flex min-w-0 flex-none flex-wrap items-center gap-2">{topRow}<span className="ml-auto flex items-center gap-2">{corner}</span></div>}
      {/* Board LirS1's four figures. */}
      {!vendorId && campaigns.length > 0 && <StatStrip label="Campaign totals" className="flex-none">
        <StatTile label="Live campaigns" value={liveCount} labelTitle={activeLimit ? `${activeLimit.usage} of ${activeLimit.limit} active campaigns allowed on your plan.` : "Campaigns set to active."} valueTone={atActiveLimit ? "danger" : undefined} />
        <StatTile label="Spend" value={money(spendAll)} labelTitle="What every campaign cost, as entered on each." />
        <StatTile label="Cost per issued" value={money2(perIssued)} labelTitle={issuedAll > 0 ? `Spend over ${issuedAll.toLocaleString()} issued ${issuedAll === 1 ? "policy" : "policies"}, across the campaigns that issued any.` : "No policy issued from a campaign yet."} />
        <StatTile label="Owed back" value={money2(owedBack)} valueTone={owedBack > 0 ? "warning" : undefined} labelTitle={owedCampaigns > 0 ? `Rows rejected at the scrub and not credited yet, on ${owedCampaigns} ${owedCampaigns === 1 ? "campaign" : "campaigns"}.` : "Nothing waiting to be claimed."} />
      </StatStrip>}
      {/* A vendor picked in the filter: one line to its own page (scorecard, settings, delete). */}
      {pickedVendor && !vendorId && <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--ink)]">
        <span>Showing <strong className="font-semibold">{isOwnBookVendor(pickedVendor.name) ? "No vendor" : pickedVendor.name}</strong>&apos;s campaigns</span>
        <Link href={`/app/campaigns/vendors/${pickedVendor.id}`} className="font-semibold text-[var(--accent-ink)] hover:underline">Open the vendor →</Link>
      </div>}
      {loadError ? <ErrorState title="Campaigns did not load" detail={loadError} action={<Button variant="outline" onClick={() => void refresh()}>Try again</Button>} />
        : campaigns.length === 0 ? (vendors.length === 0
          ? <EmptyState title="No campaigns yet" hint="Add the vendor you buy from first." action={<Button type="button" variant="outline" disabled={locked !== null} title={locked ?? undefined} onClick={openNewVendor}><Store aria-hidden="true" />New Vendor</Button>} />
          : <EmptyState title="No campaigns yet" hint="Add one before importing a list, so leads carry a cost." action={newCampaignFor(pickedVendor)} />)
        : pickedVendor && vendorCampaigns.length === 0 ? <EmptyState title={`No campaigns from ${pickedVendor.name} yet`} hint="Add one before importing its list, so its leads carry a cost." action={newCampaignFor(pickedVendor)} />
        : tabbed.length === 0 ? <NoMatches noun="campaigns" onClear={() => { clearFilters(); setShow("all"); }} />
        : <TableCard
          className={FILL_CARD}
          footer={<Pager page={currentPage + 1} total={tabbed.length} noun="campaigns" pageSize={gridPageSize} onPage={(next) => setPage(next - 1)} />}
        >
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-[30%]">Campaign</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Left to call</TableHead>
              <TableHead className="text-right">Per usable</TableHead>
              <TableHead className="w-px"><span className="sr-only">Next step</span></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {shown.map((campaign) => {
                const id = campaign.campaign_id;
                const stage = stageOf(campaign);
                const lists = listCounts?.[id];
                const next = nextStepText(campaign, stage);
                const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
                return <TableRow key={id} className="cursor-pointer" onClick={() => router.push(`/app/campaigns/${id}`)}>
                  <TableCell className="!whitespace-normal">
                    <Link href={`/app/campaigns/${id}`} onClick={stop} className="block font-semibold text-[var(--ink)] hover:underline">{campaign.name}</Link>
                    <span className="text-xs text-[var(--ink)]">{stage.leadsIn === 0 || lists === 0 ? "No list yet" : lists === undefined ? "" : `${lists} list${lists === 1 ? "" : "s"}`}</span>
                  </TableCell>
                  <TableCell className="max-w-[180px]"><Link href={`/app/campaigns/vendors/${campaign.vendor_id}`} onClick={stop} title={vendorLine(campaign.vendor_id)} className="block truncate text-[var(--ink)] hover:underline">{vendorLine(campaign.vendor_id)}</Link></TableCell>
                  <TableCell><span title={next ?? undefined}>{campaignChip(campaign, stage)}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{stage.leadsIn === 0 ? "—" : count(progress?.[id]?.leads_workable ?? null)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money2(campaign.cost_per_usable_record_cents)}</TableCell>
                  {/* One step per row; a campaign nobody can dial gets the green one (board: "Fix"). */}
                  <TableCell className="w-px whitespace-nowrap text-right" title={next ?? undefined} onClick={stop}>{stageAction(campaign, stage, blockedNow(campaign), true)}</TableCell>
                </TableRow>;
              })}
            </TableBody>
          </Table>
        </TableCard>}
    </div>}

    {openCampaign && campaignPanel(openCampaign)}

    {editVendor && <VendorSheet
      key={editVendor.id}
      vendor={rollupFor(editVendor)}
      row={editVendor}
      onClose={() => setEditVendorId(null)}
      onChanged={load}
      onDelete={() => deleteVendor(editVendor.id)}
      deleting={vendorDelete.busy}
    />}
    {vendorDelete.dialog}

    {/* Compare vendors: speed to lead and consent evidence per vendor are LA-2.5/2.6's acceptance
        figures and appear nowhere else. The failure is checked before the empty case: "no vendor
        rows" and "could not look" are different facts. */}
    {/* Source › Vendors: the vendors to manage (add, edit, delete), and their comparison a tab away. */}
    {vendorsPage && view === "vendors" && <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Vendor views">
      <ToggleChip role="radio" selected={vendorsTab === "manage"} onClick={() => setVendorsTab("manage")} count={vendors.length}>Vendors</ToggleChip>
      <ToggleChip role="radio" selected={vendorsTab === "compare"} onClick={() => setVendorsTab("compare")}>Compare</ToggleChip>
    </div>}
    {vendorsPage && view === "vendors" && vendorsTab === "manage" && <TableCard
      className={FILL_CARD}
      footer={!loadError && vendors.length ? <Pager page={vendorRows.current} total={vendors.length} noun="vendors" pageSize={gridPageSize} onPage={setVendorListPage} /> : undefined}
    >
      {loadError ? <ErrorState title="Vendors did not load" detail={loadError} action={<Button variant="outline" onClick={() => void refresh()}>Try again</Button>} />
        : vendors.length === 0 ? <EmptyState title="No vendors yet" hint="Add the vendor you buy leads from." />
        : <Table>
          <TableHeader><TableRow>
            <TableHead className="w-[34%]">Vendor</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Spend</TableHead>
            <TableHead className="text-right">Per usable</TableHead>
            <TableHead className="text-right">Return window</TableHead>
            <TableHead className="w-px"><span className="sr-only">Edit or delete</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {vendorRows.rows.map((vendor) => {
              const figures = rollupFor(vendor);
              const own = isOwnBookVendor(vendor.name);
              return <TableRow key={vendor.id} className="cursor-pointer" onClick={() => router.push(`/app/campaigns/vendors/${vendor.id}`)}>
                <TableCell className="!whitespace-normal">
                  <Link href={`/app/campaigns/vendors/${vendor.id}`} onClick={(event) => event.stopPropagation()} className="block font-semibold text-[var(--ink)] hover:underline">{own ? "No vendor · your own book" : vendor.name}</Link>
                  <span className="text-xs text-[var(--ink)]">{figures.campaign_count} campaign{figures.campaign_count === 1 ? "" : "s"} · {figures.active_campaign_count} active</span>
                </TableCell>
                <TableCell><StatusChip tone={vendor.status === "active" ? "good" : vendor.status === "under_review" ? "warning" : "neutral"}>{VENDOR_STATUS_LABEL[vendor.status as keyof typeof VENDOR_STATUS_LABEL] ?? vendor.status}</StatusChip></TableCell>
                <TableCell className="text-right tabular-nums">{money(figures.total_spend_cents)}</TableCell>
                <TableCell className="text-right tabular-nums">{money2(figures.cost_per_usable_record_cents)}</TableCell>
                <TableCell className="text-right tabular-nums">{own ? "—" : `${vendor.return_window_days} days`}</TableCell>
                <TableCell className="w-px whitespace-nowrap">
                  <RowActions what="vendor" name={own ? "No vendor" : vendor.name} onEdit={() => router.push(`/app/campaigns/vendors/${vendor.id}?tab=settings`)} onDelete={() => deleteVendor(vendor.id)} deleteBlocked={locked} deleteDisabled={vendorDelete.busy} />
                </TableCell>
              </TableRow>;
            })}
          </TableBody>
        </Table>}
    </TableCard>}
    {view === "vendors" && (!vendorsPage || vendorsTab === "compare") && <div role="region" aria-label="Vendors" id="campaigns-view-vendors" className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1">{loadError ? <TableCard><ErrorState title="Vendors did not load" detail={loadError} action={<Button variant="outline" onClick={() => void refresh()}>Try again</Button>} /></TableCard>
      : rollup.length === 0 ? (vendors.length === 0 && !loading && !loadError ? <TableCard><EmptyState title="No vendors yet" hint="Add the vendor you buy leads from." action={<Button type="button" disabled={locked !== null} title={locked ?? undefined} onClick={openNewVendor}><Store aria-hidden="true" />New Vendor</Button>} /></TableCard> : <TableCard><EmptyState title="No vendor figures yet" hint="Figures appear once a vendor has a campaign." action={newCampaignFor(null)} /></TableCard>)
      : <VendorRoster
      vendors={vendors}
      rollup={rollup}
      speed={speed}
      consent={consent}
      facts={facts}
      factsError={factsError}
      usableReference={effectiveCostCents}
      actions={vendorsPage ? undefined : createActions}
      onChanged={load}
      onShowCampaigns={(id: string) => router.push(`/app/campaigns/vendors/${id}`)}
      onEdit={(id: string) => router.push(`/app/campaigns/vendors/${id}?tab=settings`)}
      onDelete={(row) => deleteVendor(row.vendor_id)}
      deleting={vendorDelete.busy}
    />}</div>}
  </div>;

  /** The open campaign's side panel: its stage and action, its scrub, and the edits and status. */
  function campaignPanel(openCampaign: Campaign) {
    const stage = stageOf(openCampaign);
    const id = openCampaign.campaign_id;
    return <CampaignPanel
      key={id}
      tabRequest={panelTab}
      campaign={openCampaign}
      vendor={vendorName.get(openCampaign.vendor_id) ?? "Unknown vendor"}
      lead={progress?.[id] ?? null}
      reach={funnel?.[id] ?? null}
      outcome={outcomes?.[id] ?? null}
      isTest={testBatches === null ? null : testBatches[id] ?? false}
      savedStates={targetStates === null ? null : targetStates[id] ?? []}
      otherActiveWeight={weightTotal - (openCampaign.status === "active" ? openCampaign.mixing_weight : 0)}
      busy={busy === id}
      stage={<>
        <LifecycleTrack current={stage.current} tone={stage.tone} off={stage.off} labels />
        {/* The scrub's own line carries its button, so the header does not repeat it. */}
        {stage.current === 0 || stage.current === 2 || openCampaign.status === "exhausted" || (stage.current === 3 && hasNoWorkableLeads(progress?.[id] ?? null)) ? stageAction(openCampaign, stage) : null}
      </>}
      scrub={stage.leadsIn === 0 ? null : <ScrubLine campaign={openCampaign} run={scrubRuns?.[id] ?? null} canScrub={canScrub && scrubRuns !== null} driving={driving} leads={progress?.[id]?.leads_received ?? null} error={scrubError?.campaignId === id ? scrubError.message : null} onRun={() => void runScrub(openCampaign)} onStop={stopScrub} />}
      onSave={(body) => patchCampaign(id, body, `${openCampaign.name} saved`)}
      onActivate={() => activate(openCampaign)}
      onPause={() => pause(openCampaign)}
      onExhaust={() => void exhaust(openCampaign)}
      deleteBlocked={campaignDeleteBlocked(stage.leadsIn)}
      onDelete={() => void removeCampaign(openCampaign)}
      onTestBatch={(next) => void patchCampaign(id, { is_test_batch: next }, next ? `${openCampaign.name} marked as a test batch.` : `${openCampaign.name} is no longer a test batch.`)}
      onClose={() => setOpenId(null)}
    />;
  }
}

type PanelFigure = { key: string; icon: ReactNode; label: string; value: string | null; tone?: FigureTone; meaning: string };
type PanelTab = "numbers" | "cost" | "targeting";

/**
 * A campaign in the side panel (/ui-taste critique 2026-10-29, in place of the row that opened under
 * itself): its stage and the action it needs; the scrub; then Numbers (only the figures with data),
 * Cost & weight, and Targeting, edited together and saved with one Save; its status actions; and
 * its list and cadence.
 */
function CampaignPanel({ tabRequest, campaign, vendor, lead, reach, outcome, isTest, savedStates, otherActiveWeight, busy, stage, scrub, onSave, onActivate, onPause, onExhaust, deleteBlocked, onDelete, onTestBatch, onClose }: {
  /** The section to show; a new `at` moves to it again (the row's pen on a panel already open). */
  tabRequest: { tab: PanelTab; at: number };
  campaign: Campaign;
  vendor: string;
  lead: CampaignProgress | null;
  reach: Funnel | null;
  outcome: Outcome | null;
  /** Null when the test-batch column is not deployed. */
  isTest: boolean | null;
  /** Null when target states are not deployed. */
  savedStates: string[] | null;
  /** The mixing weights of the other active campaigns. */
  otherActiveWeight: number;
  busy: boolean;
  stage: ReactNode;
  scrub: ReactNode;
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
  onActivate: () => void;
  onPause: () => void;
  onExhaust: () => void;
  /** Why it cannot be deleted, when the screen already knows (it has leads); null lets the server decide. */
  deleteBlocked: string | null;
  onDelete: () => void;
  onTestBatch: (next: boolean) => void;
  onClose: () => void;
}) {
  const startSpend = (campaign.total_spend_cents / 100).toFixed(2);
  const [spend, setSpend] = useState(startSpend);
  const [records, setRecords] = useState(String(campaign.records_purchased));
  const [weight, setWeight] = useState(String(campaign.mixing_weight));
  const [states, setStates] = useState<string[]>(savedStates ?? []);
  const [stateText, setStateText] = useState("");
  const [stateError, setStateError] = useState<string | null>(null);
  const [tab, setTab] = useState<PanelTab>(tabRequest.tab);
  const [seenRequest, setSeenRequest] = useState(tabRequest.at);
  if (tabRequest.at !== seenRequest) { setSeenRequest(tabRequest.at); setTab(tabRequest.tab); }
  const scope = useRef<HTMLDivElement>(null);
  const uid = useId();
  const field = (name: string) => `${uid}-${name}`;

  const costDirty = spend !== startSpend || records !== String(campaign.records_purchased) || weight !== String(campaign.mixing_weight);
  const statesDirty = savedStates !== null && [...states].sort().join(",") !== [...savedStates].sort().join(",");
  const dirty = costDirty || statesDirty;
  const discard = () => { setSpend(startSpend); setRecords(String(campaign.records_purchased)); setWeight(String(campaign.mixing_weight)); setStates(savedStates ?? []); setStateText(""); setStateError(null); };

  /** The one Save: whatever changed in cost, weight and states, in one PATCH. */
  async function save(): Promise<boolean> {
    const body: Record<string, unknown> = {};
    if (costDirty) {
      const spendCents = Math.round(Number(spend.replace(/[$,\s]/g, "")) * 100);
      const purchased = Number(records.replace(/[,\s]/g, ""));
      const mixing = Number(weight);
      if (!Number.isFinite(spendCents) || spendCents < 0) { notify.block("Enter a valid spend"); setTab("cost"); return false; }
      if (!Number.isInteger(purchased) || purchased < 0) { notify.block("Enter a whole number of records"); setTab("cost"); return false; }
      if (!Number.isInteger(mixing) || mixing < 1 || mixing > 100) { notify.block("Mixing weight must be between 1 and 100"); setTab("cost"); return false; }
      Object.assign(body, { total_spend_cents: spendCents, records_purchased: purchased, mixing_weight: mixing });
    }
    if (statesDirty) body.target_states = [...states].sort();
    return onSave(body);
  }

  async function close() {
    if (dirty && !(await confirmAction({ title: "Discard your changes?", description: `You changed ${campaign.name} and have not saved it yet.`, confirmLabel: "Discard changes" }))) return;
    onClose();
  }

  function addStates(event: { preventDefault: () => void }) {
    event.preventDefault();
    const codes = [...new Set(stateText.toUpperCase().split(/[\s,;]+/).filter(Boolean))];
    const bad = codes.filter((code) => !STATE_NAMES[code]);
    if (bad.length) { setStateError(`Not a state: ${bad.join(", ")}`); return; }
    setStateError(null);
    setStates((current) => [...new Set([...current, ...codes])].sort());
    setStateText("");
  }

  const worked = workedPercent(lead);
  const servingShare = campaign.status === "active" ? shareOf(String(campaign.mixing_weight), otherActiveWeight) : null;
  const draftShare = shareOf(weight, otherActiveWeight);
  const figures: PanelFigure[] = [
    { key: "type", icon: <Layers />, label: "Type", value: `${campaign.lead_type}${campaign.product_code ? ` · ${campaign.product_code}` : ""}`, meaning: "Lead type and product" },
    { key: "records", icon: <Package />, label: "Records", value: campaign.records_purchased > 0 ? campaign.records_purchased.toLocaleString() : null, meaning: "Rows bought" },
    { key: "rejected", icon: <XCircle />, label: "Rejected", value: campaign.records_rejected === null ? null : count(campaign.records_rejected), tone: (campaign.records_rejected ?? 0) > 0 ? "danger" : null, meaning: "Rows rejected at the scrub" },
    { key: "usable", icon: <CheckCircle2 />, label: "Usable", value: campaign.records_usable === null ? null : count(campaign.records_usable), meaning: "Rows that can be dialled" },
    { key: "contacts", icon: <Phone />, label: "Contacts", value: reach && reach.dialed_leads > 0 ? count(reach.contacted_leads) : null, meaning: "Leads reached" },
    { key: "rate", icon: <PhoneCall />, label: "Contact rate", value: reach && reach.dialed_leads > 0 ? `${Math.round((100 * reach.contacted_leads) / reach.dialed_leads)}%` : null, meaning: reach && reach.dialed_leads > 0 ? `${reach.contacted_leads.toLocaleString()} of ${reach.dialed_leads.toLocaleString()} dialled` : "Contacts over leads dialled" },
    { key: "worked", icon: <Activity />, label: "Worked", value: worked === null ? null : `${worked}%`, meaning: lead ? `${lead.leads_dialed.toLocaleString()} of ${lead.leads_received.toLocaleString()} dialled` : "Leads dialled at least once" },
    { key: "workable", icon: <Hourglass />, label: "Workable", value: lead && lead.leads_received > 0 ? lead.leads_workable.toLocaleString() : null, meaning: "Leads fresh, in cadence or waiting on a retry" },
    { key: "cost", icon: <Receipt />, label: "Cost / record", value: campaign.cost_per_record_cents === null ? null : money2(campaign.cost_per_record_cents), meaning: "Spend over rows bought" },
    { key: "credits", icon: <Coins />, label: "After credits", value: campaign.effective_cost_per_record_cents === null ? null : perRecord(campaign.effective_cost_per_record_cents), meaning: "Cost per record after vendor credits" },
    { key: "issued", icon: <BadgeCheck />, label: "Issued", value: outcome ? outcome.issued.toLocaleString() : null, meaning: "Policies issued from this campaign" },
    { key: "per-issued", icon: <BadgeDollarSign />, label: "Cost / issued", value: outcome && outcome.costPerIssuedCents !== null ? money2(outcome.costPerIssuedCents) : null, meaning: "Spend over issued policies" },
    { key: "share", icon: <PieChart />, label: "Share of serving", value: servingShare === null ? null : `${servingShare}%`, meaning: `Mixing weight ${campaign.mixing_weight}, against the other active campaigns` },
    { key: "imported", icon: <CalendarDays />, label: "Imported", value: lead?.first_import_at ? (day(lead.first_import_at) === day(lead.last_import_at) ? day(lead.first_import_at) : `${day(lead.first_import_at)} – ${day(lead.last_import_at)}`) : null, meaning: "When its lists were imported" },
    { key: "cadence", icon: <Repeat />, label: "Cadence", value: lead ? (lead.own_cadence_rules > 0 ? `Own · ${lead.own_cadence_rules}` : "Agency default") : null, meaning: lead && lead.own_cadence_rules > 0 ? `Its own cadence, ${lead.own_cadence_rules} ${lead.own_cadence_rules === 1 ? "rule" : "rules"}` : "The agency's default cadence" },
  ];
  const withData = figures.filter((figure) => figure.value !== null);
  const tabs: { key: PanelTab; label: string }[] = [
    { key: "numbers", label: "Numbers" },
    { key: "cost", label: "Cost & weight" },
    ...(savedStates !== null ? [{ key: "targeting" as const, label: "Targeting" }] : []),
  ];

  const hasCadence = Boolean(lead && lead.own_cadence_rules > 0);

  // Owner 2026-10-29: a full-height sheet, wider, portalled to the body (the page's entrance
  // animation leaves a transform that would trap a fixed panel). The bin sits in the header behind
  // the kit's confirm; the list and cadence are buttons; the footer is Save alone.
  const panel = <DetailPanel mode="overlay" className="top-0 lg:w-[600px]" title={campaign.name} subtitle={`${vendor} · ${campaign.lead_type}${campaign.product_code ? ` · ${campaign.product_code}` : ""}`} status={stage} onClose={() => void close()}
    actions={<span className="inline-flex" title={deleteBlocked ?? "Delete campaign"}>
      <Button type="button" variant="ghost" size="icon" className="text-[var(--error-ink)] hover:bg-[var(--error-surface)] hover:text-[var(--error-ink)]" aria-label={deleteBlocked ? `Delete campaign — ${deleteBlocked}` : "Delete campaign"} disabled={busy || deleteBlocked !== null} onClick={onDelete}><Trash2 aria-hidden="true" /></Button>
    </span>}
    footer={<Button type="button" className="ml-auto" disabled={!dirty || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button>}>
    <div ref={scope} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2" aria-label="Shortcuts" role="group">
        <Button asChild variant="outline" size="sm"><Link href={`/app/lead-lists/${campaign.campaign_id}`}><ListChecks aria-hidden="true" />Open the list</Link></Button>
        <Button asChild variant="outline" size="sm"><Link href={`/app/settings?cadenceCampaign=${campaign.campaign_id}#cadence`}><Repeat aria-hidden="true" />{hasCadence ? "Edit its cadence" : "Give it its own cadence"}</Link></Button>
      </div>
      {scrub}
      <UnderlineTabs label={`${campaign.name} sections`} tabs={tabs} value={tab} onChange={setTab} idPrefix={field("tab")} controls={(key) => field(`panel-${key}`)} />
      {tab === "numbers" && <div role="tabpanel" id={field("panel-numbers")} aria-labelledby={field("tab-numbers")} className="flex flex-col gap-3">
        {/* Only the figures with data (owner 2026-10-29: no "not enough data" line). */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          {withData.map((figure) => <Figure key={figure.key} icon={figure.icon} label={figure.label} value={figure.value} tone={figure.tone ?? null} meaning={figure.meaning} />)}
        </div>
        {hasNoWorkableLeads(lead) && campaign.status !== "exhausted" && <p className="portal-campaigns-claim">No workable leads left. Mark it exhausted when you are done.</p>}
        {(campaign.records_rejected ?? 0) > 0 && <p className="portal-campaigns-claim">{count(campaign.records_rejected)} purchased row{campaign.records_rejected === 1 ? "" : "s"} could never be dialed — about {money(campaign.rejected_spend_cents)} to claim back from the vendor.</p>}
      </div>}
      {tab === "cost" && <div role="tabpanel" id={field("panel-cost")} aria-labelledby={field("tab-cost")} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Total spend ($)" htmlFor={field("spend")}><input id={field("spend")} className={control} inputMode="decimal" value={spend} onChange={(event) => setSpend(event.target.value)} /></Field>
          <Field label="Records purchased" htmlFor={field("records")}><input id={field("records")} className={control} inputMode="numeric" value={records} onChange={(event) => setRecords(event.target.value)} /></Field>
        </div>
        <p className="m-0 flex items-center gap-2 text-sm text-[var(--body)]"><Receipt className="size-4 text-[var(--muted)]" aria-hidden="true" />Cost per record <strong className="tabular-nums text-[var(--ink)]" aria-live="polite">{liveCostPerRecord(spend, records)}</strong></p>
        <Field label="Mixing weight" htmlFor={field("weight")}>
          <NumberStepper id={field("weight")} value={weight} onChange={setWeight} min={1} max={100} label="mixing weight" after={draftShare === null ? null : `${draftShare}% of serving${campaign.status === "active" ? "" : " once live"}`} />
        </Field>
      </div>}
      {tab === "targeting" && savedStates !== null && <div role="tabpanel" id={field("panel-targeting")} aria-labelledby={field("tab-targeting")} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Target states">
          {states.length === 0 ? <span className="text-sm text-[var(--muted)]">Any state</span>
            : states.map((code) => <span key={code} title={STATE_NAMES[code] ?? code}><ToggleChip onRemove={() => setStates((current) => current.filter((item) => item !== code))}>{code}</ToggleChip></span>)}
        </div>
        <form className="flex items-end gap-2" onSubmit={addStates}>
          <Field label="Add states" htmlFor={field("state")} className="flex-1" error={stateError}><input id={field("state")} className={control} value={stateText} onChange={(event) => { setStateText(event.target.value); setStateError(null); }} placeholder="TX, OK, LA" maxLength={240} /></Field>
          <Button type="submit" variant="outline" disabled={!stateText.trim()} className={stateError ? "mb-6" : undefined}><Plus aria-hidden="true" />Add</Button>
        </form>
      </div>}
      <section aria-label="Status" className="flex flex-col gap-3 border-t border-border pt-4">
        {isTest !== null && <ToggleRow id={field("test")} title="Test batch" checked={isTest} disabled={busy} onChange={onTestBatch} />}
        <div className="flex flex-wrap items-center gap-2">
          {campaign.status === "active"
            ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onPause}><Pause aria-hidden="true" />Pause</Button>
            : <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onActivate}><Play aria-hidden="true" />Activate</Button>}
          {campaign.status !== "exhausted" && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onExhaust}><Archive aria-hidden="true" />Mark exhausted</Button>}
        </div>
      </section>
    </div>
    {/* An unsaved cost, weight or state list asks before a click away drops it (foundation v3). */}
    <LeaveGuard dirty={dirty} scope={scope} onSave={save} onDiscard={discard} what={`${campaign.name}'s cost and targeting`} />
  </DetailPanel>;
  return createPortal(panel, document.body);
}

/**
 * A campaign's Settings tab (owner pick C, 2026-10-30, board LirE5): every field it has, grouped —
 * Details, Cost, Serving, Status — saved together by the one Save in the frame's corner. The same
 * PATCH the side panel uses, plus its name, vendor and lead type. An unsaved change asks before a
 * click away drops it.
 */
function CampaignSettings({ campaign, vendors, products, isTest, savedStates, otherActiveWeight, busy, locked, scrub, statusChip, onSave, onActivate, onPause, onExhaust, deleteBlocked, onDelete }: {
  campaign: Campaign;
  vendors: Vendor[];
  products: Array<{ code: string; name: string }> | null;
  isTest: boolean | null;
  savedStates: string[] | null;
  otherActiveWeight: number;
  busy: boolean;
  locked: string | null;
  scrub: ReactNode;
  statusChip: ReactNode;
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
  onActivate: () => void;
  onPause: () => void;
  onExhaust: () => void;
  deleteBlocked: string | null;
  onDelete: () => void;
}) {
  const start = {
    name: campaign.name,
    vendor_id: campaign.vendor_id,
    lead_type: campaign.lead_type,
    product_code: campaign.product_code ?? "",
    spend: (campaign.total_spend_cents / 100).toFixed(2),
    records: String(campaign.records_purchased),
    weight: String(campaign.mixing_weight),
    test: isTest ?? false,
    states: [...(savedStates ?? [])].sort(),
  };
  const [draft, setDraft] = useState(start);
  const [stateText, setStateText] = useState("");
  const [stateError, setStateError] = useState<string | null>(null);
  const scope = useRef<HTMLDivElement>(null);
  const uid = useId();
  const field = (name: string) => `${uid}-${name}`;
  const set = <K extends keyof typeof start>(key: K, value: (typeof start)[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const changed = (Object.keys(start) as Array<keyof typeof start>).filter((key) => JSON.stringify(draft[key]) !== JSON.stringify(start[key]));
  const dirty = changed.length > 0;
  const disabled = busy || locked !== null;
  const discard = () => { setDraft(start); setStateText(""); setStateError(null); };

  async function save(): Promise<boolean> {
    const body: Record<string, unknown> = {};
    if (changed.includes("name")) {
      if (!draft.name.trim()) { notify.block("Give the campaign a name"); return false; }
      body.name = draft.name.trim();
    }
    if (changed.includes("vendor_id")) body.vendor_id = draft.vendor_id;
    if (changed.includes("lead_type")) body.lead_type = draft.lead_type;
    if (changed.includes("product_code")) body.product_code = draft.product_code || null;
    if (changed.includes("spend")) {
      const cents = Math.round(Number(draft.spend.replace(/[$,\s]/g, "")) * 100);
      if (!Number.isFinite(cents) || cents < 0) { notify.block("Enter a valid spend"); return false; }
      body.total_spend_cents = cents;
    }
    if (changed.includes("records")) {
      const purchased = Number(draft.records.replace(/[,\s]/g, ""));
      if (!Number.isInteger(purchased) || purchased < 0) { notify.block("Enter a whole number of records"); return false; }
      body.records_purchased = purchased;
    }
    if (changed.includes("weight")) {
      const mixing = Number(draft.weight);
      if (!Number.isInteger(mixing) || mixing < 1 || mixing > 100) { notify.block("Mixing weight must be between 1 and 100"); return false; }
      body.mixing_weight = mixing;
    }
    if (changed.includes("test")) body.is_test_batch = draft.test;
    if (changed.includes("states")) body.target_states = draft.states;
    return onSave(body);
  }

  function addStates(event: { preventDefault: () => void }) {
    event.preventDefault();
    const codes = [...new Set(stateText.toUpperCase().split(/[\s,;]+/).filter(Boolean))];
    const bad = codes.filter((code) => !STATE_NAMES[code]);
    if (bad.length) { setStateError(`Not a state: ${bad.join(", ")}`); return; }
    setStateError(null);
    set("states", [...new Set([...draft.states, ...codes])].sort());
    setStateText("");
  }

  const share = shareOf(draft.weight, otherActiveWeight);
  const takes = vendors.filter((vendor) => vendorTakesCampaigns(vendor.status) || vendor.id === campaign.vendor_id);
  const label = (text: string) => <span className="text-xs font-semibold tracking-[0.06em] text-[var(--ink)] uppercase">{text}</span>;
  const card = (children: ReactNode) => <div className={cn(cardSurface, "flex min-w-0 flex-col gap-6 p-5")}>{children}</div>;

  return <div ref={scope} className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
    <LeadsInSlot slot="continue">
      {dirty && <Button type="button" variant="outline" disabled={busy} onClick={discard}>Discard</Button>}
      <Button type="button" disabled={!dirty || disabled} title={locked ?? undefined} onClick={() => void save()}>{busy ? "Saving…" : dirty ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}` : "Save changes"}</Button>
    </LeadsInSlot>
    {card(<>
      <section aria-label="Details" className="flex flex-col gap-3">
        {label("Details")}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor={field("name")}><input id={field("name")} className={control} maxLength={160} value={draft.name} disabled={disabled} onChange={(event) => set("name", event.target.value)} /></Field>
          <Field label="Vendor" htmlFor={field("vendor")} hint="Or “Your own book” for a list with no vendor">
            <select id={field("vendor")} className={control} value={draft.vendor_id} disabled={disabled} onChange={(event) => set("vendor_id", event.target.value)}>
              {takes.map((vendor) => <option key={vendor.id} value={vendor.id}>{isOwnBookVendor(vendor.name) ? "No vendor · your own book" : vendor.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5"><span id={field("type")} className="text-label text-[var(--ink)]">Lead type</span><LeadTypeChoice value={draft.lead_type} onChange={(next) => set("lead_type", next)} labelledBy={field("type")} /></div>
          <Field label="Product" htmlFor={field("product")}>
            <select id={field("product")} className={control} value={draft.product_code} disabled={disabled} onChange={(event) => set("product_code", event.target.value)}>
              <option value="">Any product</option>
              {(products ?? []).map((product) => <option key={product.code} value={product.code}>{product.name}</option>)}
              {draft.product_code && !(products ?? []).some((product) => product.code === draft.product_code) && <option value={draft.product_code}>{draft.product_code}</option>}
            </select>
          </Field>
        </div>
      </section>
      <section aria-label="Cost" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">{label("Cost")}<span className="text-xs text-[var(--ink)]">Credits come from vendor claims, not typed here</span></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Total spend ($)" htmlFor={field("spend")}><input id={field("spend")} className={control} inputMode="decimal" value={draft.spend} disabled={disabled} onChange={(event) => set("spend", event.target.value)} /></Field>
          <Field label="Records bought" htmlFor={field("records")}><input id={field("records")} className={control} inputMode="numeric" value={draft.records} disabled={disabled} onChange={(event) => set("records", event.target.value)} /></Field>
          <div className="grid gap-1.5"><span className="text-label text-[var(--ink)]">Per record</span><span className="flex h-9 items-center text-sm font-semibold tabular-nums text-[var(--ink)]" aria-live="polite">{liveCostPerRecord(draft.spend, draft.records)}</span></div>
        </div>
      </section>
    </>)}
    {card(<>
      <section aria-label="Serving" className="flex flex-col gap-3">
        {label("Serving")}
        <Field label="Mixing weight" htmlFor={field("weight")}>
          <NumberStepper id={field("weight")} value={draft.weight} onChange={(next) => set("weight", next)} min={1} max={100} label="mixing weight" after={share === null ? null : `${share}% of serving${campaign.status === "active" ? "" : " once live"}`} />
        </Field>
        {isTest !== null && <ToggleRow id={field("test")} title="Test batch" checked={draft.test} disabled={disabled} onChange={(next) => set("test", next)} />}
        {savedStates !== null && <div className="flex flex-col gap-2">
          <span className="text-label text-[var(--ink)]">Target states</span>
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Target states">
            {draft.states.length === 0 ? <span className="text-sm text-[var(--ink)]">Any state</span>
              : draft.states.map((code) => <span key={code} title={STATE_NAMES[code] ?? code}><ToggleChip disabled={disabled} onRemove={() => set("states", draft.states.filter((item) => item !== code))}>{code}</ToggleChip></span>)}
          </div>
          <form className="flex items-end gap-2" onSubmit={addStates}>
            <Field label="Add states" htmlFor={field("state")} className="flex-1" error={stateError}><input id={field("state")} className={control} value={stateText} disabled={disabled} onChange={(event) => { setStateText(event.target.value); setStateError(null); }} placeholder="TX, OK, LA" maxLength={240} /></Field>
            <Button type="submit" variant="outline" disabled={!stateText.trim() || disabled} className={stateError ? "mb-6" : undefined}><Plus aria-hidden="true" />Add</Button>
          </form>
        </div>}
        <Link href={`/app/settings?cadenceCampaign=${campaign.campaign_id}#cadence`} className="w-fit text-sm font-semibold text-[var(--accent-ink)] hover:underline">Its calling cadence →</Link>
      </section>
      <section aria-label="Status" className="flex flex-col gap-3">
        {label("Status")}
        {scrub}
        <div className="flex flex-wrap items-center gap-2">
          {statusChip}
          {campaign.status === "active"
            ? <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onPause}><Pause aria-hidden="true" />Pause</Button>
            : campaign.status !== "exhausted" && <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onActivate}><Play aria-hidden="true" />Activate</Button>}
          {campaign.status !== "exhausted" && <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onExhaust}><Archive aria-hidden="true" />Mark exhausted</Button>}
          <span className="ml-auto inline-flex" title={deleteBlocked ?? "Delete campaign"}>
            <Button type="button" variant="outline" size="sm" disabled={disabled || deleteBlocked !== null} onClick={onDelete}><Trash2 aria-hidden="true" />Delete</Button>
          </span>
        </div>
      </section>
    </>)}
    <LeaveGuard dirty={dirty} scope={scope} onSave={save} onDiscard={discard} what={`${campaign.name}'s settings`} />
  </div>;
}

/**
 * The scrub in a campaign's panel: what the latest run did, its progress, and the owner's action.
 * Producers see the progress; only an owner runs a scrub (it bills screening lookups). A run an
 * outage stopped is the ScreeningDown block instead.
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
  const counts = run ? `${run.processed_leads.toLocaleString()} of ${run.total_leads.toLocaleString()} screened · ${run.rejected_leads.toLocaleString()} failed` : null;
  const outage = scrubStoppedByOutage(run);

  if (outage && run) return <ScreeningDown campaignId={campaign.campaign_id} run={run} canScrub={canScrub} driving={driving} error={error} onResume={onRun} />;

  let status: string | null = null;
  if (here && run) status = `${counts}. Keep this page open; it serves no leads until the scrub finishes.`;
  else if (run?.status === "running" && stale) status = `Stopped ${quiet} min ago at ${counts}. Resume from where it stopped.`;
  else if (run?.status === "running") status = `${counts} · last progress ${quiet === 0 ? "under a minute" : `${quiet} min`} ago.`;
  else if (run?.status === "failed") status = `Failed at ${counts}: ${run.error ?? "it could not be completed"}`;
  else if (run?.status === "scrubbed") status = `Scrubbed ${new Date(run.finished_at ?? run.last_progress_at).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · ${counts}.`;

  const label = open ? "Resume the scrub" : campaign.scrub_status === "scrubbed" ? "Scrub again" : "Run the scrub";
  const cannot = !canScrub ? "Ask an owner to run the scrub — it bills screening lookups." : leads === 0 ? "Import a list into this campaign first." : elsewhere ? "Another window is running this scrub." : null;
  const pct = runPercent(run);

  return <div className="flex flex-col gap-2 text-sm leading-normal text-[var(--body)]">
    <div className="flex flex-wrap items-center gap-2">
      <ScrubState campaign={campaign} run={run} />
      {status && <span className="min-w-0 flex-1" role={here ? "status" : undefined}>{status}</span>}
      {canScrub && (here
        ? <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={onStop}><Pause aria-hidden="true" />Pause the scrub</Button>
        : <Button type="button" variant="outline" size="sm" className="ml-auto" disabled={Boolean(cannot) || driving !== null} title={cannot ?? (driving !== null ? "Another campaign is being scrubbed from this page." : undefined)} onClick={onRun}>{open ? <Play aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}{label}</Button>)}
    </div>
    {open && pct !== null && <Meter value={pct} tone={run?.status === "failed" ? "danger" : "info"} label={`Scrub ${pct}% done`} />}
    {error && <p className="m-0 flex items-center gap-1.5 text-[var(--error-ink)]" role="alert"><AlertTriangle className="size-4 shrink-0" aria-hidden="true" />{error}</p>}
    {!canScrub && campaign.scrub_status !== "scrubbed" && <span className="text-xs text-[var(--muted)]">Ask an owner to run the scrub — it bills screening lookups.</span>}
  </div>;
}

/** What GET /api/app/campaigns/[id]/scrub answers (lib/compliance/service.ts getScreeningServiceStatus). */
type ScreeningStatus = { answering: boolean; demo: boolean; providers: Array<{ name: string }>; checkedAt: string };

/** "2:41 PM" */
function clock(iso: string) {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "—" : at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * A scrub the screening outage stopped (owner 2026-10-29): a status block that helps fix it.
 * "Check again" asks the server whether the screening service answers now — a read of the latest
 * real lookups, which calls no vendor and bills nothing — and, when it does, resumes the scrub from
 * where it stopped (a resume that meets the outage again stops safely, as before). Owners only: the
 * probe and the resume are the owner's, like the scrub itself.
 */
function ScreeningDown({ campaignId, run, canScrub, driving, error, onResume }: {
  campaignId: string;
  run: ScrubRun;
  canScrub: boolean;
  driving: string | null;
  error: string | null;
  onResume: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<ScreeningStatus | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const here = driving === campaignId;
  const back = Boolean(status?.answering) && (here || checking);
  const pct = runPercent(run) ?? 0;
  const providers = status ? (status.demo ? ["Demo screening"] : [...new Set(status.providers.map((provider) => provider.name))]) : [];

  async function probe(): Promise<ScreeningStatus | null> {
    const response = await fetch(`/api/app/campaigns/${campaignId}/scrub`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.screening) { setCheckError(body?.error ?? "Could not reach the screening check"); return null; }
    setCheckError(null);
    setStatus(body.screening as ScreeningStatus);
    return body.screening as ScreeningStatus;
  }

  // Who provides it and when it last answered, read once when the block opens. Never resumes.
  useEffect(() => {
    if (!canScrub) return;
    let live = true;
    void fetch(`/api/app/campaigns/${campaignId}/scrub`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => { if (live && body?.screening) setStatus(body.screening as ScreeningStatus); })
      .catch(() => { /* the block still says what it knows */ });
    return () => { live = false; };
  }, [campaignId, canScrub]);

  async function checkAgain() {
    setChecking(true);
    try {
      const now = await probe();
      if (now?.answering) onResume();
    } finally {
      setChecking(false);
    }
  }

  // The read-only check found it answering, but the scrub has not resumed yet: say so in the title and
  // colour, not only in a line under a red "down" heading.
  const answering = !back && status?.answering === true;
  const ok = back || answering;
  const tone = ok ? "border-[var(--success-ink)] bg-[var(--success-surface)]" : "border-[var(--error-ink)] bg-[var(--error-surface)]";
  return <section aria-label="Screening service" className={cn("flex flex-col gap-2 rounded-lg border p-3", tone)}>
    <div className="flex flex-wrap items-center gap-2">
      {ok ? <CheckCircle2 className="size-4 shrink-0 text-[var(--success-ink)]" aria-hidden="true" /> : <WifiOff className="size-4 shrink-0 text-[var(--error-ink)]" aria-hidden="true" />}
      <h3 className="m-0 text-sm font-semibold text-[var(--ink)]" role="status">{back ? "Screening service is back — resuming" : answering ? "Screening service answers again" : "Screening service is down"}</h3>
      {status && <span className="ml-auto text-xs text-[var(--body)]">Last checked {clock(status.checkedAt)}</span>}
    </div>
    <Meter value={pct} tone={ok ? "good" : "danger"} label={`Scrub ${pct}% done`} />
    <p className="m-0 text-xs tabular-nums text-[var(--body)]">{run.processed_leads.toLocaleString()} of {run.total_leads.toLocaleString()} screened · {run.rejected_leads.toLocaleString()} failed</p>
    <p className="m-0 text-sm text-[var(--ink)]">Nothing unchecked is dialled.</p>
    {status && !back && !checking && (status.answering
      ? <p className="m-0 text-xs font-semibold text-[var(--success-ink)]">Resume the scrub to finish it.</p>
      : <p className="m-0 text-xs text-[var(--error-ink)]">Still not answering.</p>)}
    {(checkError || error) && <p className="m-0 flex items-center gap-1.5 text-xs text-[var(--error-ink)]" role="alert"><AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />{checkError ?? error}</p>}
    <div className="flex flex-wrap items-center gap-2">
      {canScrub
        ? <>
          <Button type="button" size="sm" disabled={checking || driving !== null} title={driving !== null && !here ? "Another campaign is being scrubbed from this page." : undefined} onClick={() => void checkAgain()}>
            {checking || here ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}{checking ? "Checking…" : here ? "Resuming…" : "Check again"}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={driving !== null} title="Resume without checking first — it stops again safely if the service is still down" onClick={onResume}><Play aria-hidden="true" />Resume the scrub</Button>
        </>
        : <span className="text-xs text-[var(--body)]">Ask an owner to resume it once the service is back.</span>}
      <span className="ml-auto flex flex-wrap items-center gap-2">
        {providers.length > 0 && <span className="text-xs text-[var(--body)]">Provider: <strong className="font-semibold text-[var(--ink)]">{providers.join(", ")}</strong></span>}
        <Button asChild variant="ghost" size="sm"><a href={`mailto:support@insurvas.com?subject=${encodeURIComponent("Screening service down")}`}><LifeBuoy aria-hidden="true" />Contact support</a></Button>
      </span>
    </div>
  </section>;
}

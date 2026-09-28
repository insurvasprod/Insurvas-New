"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import { notify } from "@/lib/notify";
import { dayMonthYear, viewerTimeZone } from "@/lib/format/dates";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import type { VendorReturnClaim } from "@/lib/vendorScorecard/types";
import {
  REASON_LABEL,
  claimAmountCents,
  closesLabel,
  costPerIssuedAfterCredit,
  costPerIssuedBeforeCredit,
  reasonEvidence,
  reasonTotals,
  type CampaignCandidateSummary,
  type CampaignCostPerPolicy,
  type ClaimReason,
  type ReturnCandidateRow,
  type VendorReturnsPageData,
} from "@/lib/vendorScorecard/returnModel";

const PAGE_SIZE = 25;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dollars(cents: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(cents / 100); }
/** A cost per record, which is often a fraction of a cent over a whole dollar amount. */
function perRecord(cents: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(cents / 100); }
function count(value: number) { return value.toLocaleString("en-US"); }
/** "Sep 1–15", "Aug 28 – Sep 4" — when the claimed leads arrived. */
function period(from: string | null | undefined, to: string | null | undefined) {
  if (!from || !to) return "—";
  const a = new Date(from); const b = new Date(to);
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return a.getDate() === b.getDate() ? `${MONTHS[a.getMonth()]} ${a.getDate()}` : `${MONTHS[a.getMonth()]} ${a.getDate()}–${b.getDate()}`;
  return `${MONTHS[a.getMonth()]} ${a.getDate()} – ${MONTHS[b.getMonth()]} ${b.getDate()}`;
}
const STATUS: Record<VendorReturnClaim["status"], { label: string; tone: StatusTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Awaiting vendor", tone: "info" },
  partial: { label: "Part credited", tone: "warning" },
  accepted: { label: "Reconciled", tone: "good" },
  rejected: { label: "Rejected", tone: "danger" },
};
const unreconciled = (claim: VendorReturnClaim) => claim.status === "draft" || claim.status === "submitted";
// Calendar days in the tenant's zone, counted by the service (LA-2.19-2): 1 is "Closes tomorrow".
const daysText = (days: number | null) => closesLabel(days);

const field = "h-9 w-full rounded-lg border border-[var(--border-strong)] bg-card px-2.5 text-sm text-foreground";
const panel = "absolute top-[calc(100%+6px)] z-20 grid gap-2 rounded-xl border border-border bg-card p-3.5 shadow-[0_12px_32px_rgba(0,0,0,.16)]";
const panelLabel = "text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground";
const th = "bg-[var(--surface-alt)] px-3 py-2 text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground";
const td = "border-t border-border px-3 py-2 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]";
const label = "text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground";
const tfootTd = "border-t border-border bg-[var(--surface-alt)] px-3 py-2.5 text-sm font-semibold tabular-nums text-foreground";

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) close(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open, close]);
  return ref;
}

/** A campaign's cost per issued policy: undefined while not asked, "loading", null when the scorecard cannot answer. */
type CostState = CampaignCostPerPolicy | null | "loading";

/**
 * What a credit does to the campaign's cost per issued policy — the scorecard's own number, before
 * and after. `landed` is a credit already recorded (it is in the scorecard's figure already).
 */
function CostPerPolicyLine({ cost, creditCents, landed }: { cost: CostState | undefined; creditCents: number; landed?: boolean }) {
  if (cost === undefined || cost === null) return null;
  if (cost === "loading") return <div role="status"><span className="sr-only">Loading</span><span aria-hidden="true" className="block h-3 w-80 max-w-full m-skel rounded-full" /></div>;
  if (!cost.issued_policies || cost.cost_per_issued_cents == null) {
    return <p className="text-sm leading-normal text-[var(--body)]">No policy from this campaign has issued yet, so {landed ? "the credit lowered" : "a credit lowers"} its spend but there is no cost per issued policy to move.</p>;
  }
  if (landed) {
    const before = costPerIssuedBeforeCredit(cost, creditCents);
    return <p className="text-sm leading-normal text-[var(--body)]">This credit moved the campaign&rsquo;s cost per issued policy from <strong className="tabular-nums text-foreground">{before == null ? "—" : dollars(Math.round(before))}</strong> to <strong className="tabular-nums text-foreground">{dollars(Math.round(cost.cost_per_issued_cents))}</strong> ({count(cost.issued_policies)} issued).</p>;
  }
  const after = costPerIssuedAfterCredit(cost, creditCents);
  return <p className="text-sm leading-normal text-[var(--body)]">If the vendor credits it in full, the campaign&rsquo;s cost per issued policy moves from <strong className="tabular-nums text-foreground">{dollars(Math.round(cost.cost_per_issued_cents))}</strong> to <strong className="tabular-nums text-foreground">{after == null ? "—" : dollars(Math.round(after))}</strong> ({count(cost.issued_policies)} issued). Until it is credited, the scorecard shows the higher number.</p>;
}

/** Recording what the vendor did with a submitted claim. The claimed amount is never touched. */
function ClaimOutcome({ claim, onSaved }: { claim: VendorReturnClaim; onSaved: () => void }) {
  const [status, setStatus] = useState<"accepted" | "partial" | "rejected">("accepted");
  const [amount, setAmount] = useState((claim.amount_claimed_cents / 100).toFixed(2));
  const [replacements, setReplacements] = useState("0");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    const cents = status === "rejected" ? 0 : Math.round(Number(amount) * 100);
    if (status !== "rejected" && (!Number.isFinite(cents) || cents < 0 || cents > claim.amount_claimed_cents)) { setError(`The credit is a dollar amount from $0.00 to ${dollars(claim.amount_claimed_cents)}.`); return; }
    if (status === "rejected" && !reason.trim()) { setError("Say why the vendor rejected it — the reason is what the next claim argues against."); return; }
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/app/vendor-returns/claims/${claim.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resolve", status, amount_credited_cents: cents, replacement_leads_count: Math.max(0, Math.round(Number(replacements) || 0)), rejection_reason: reason, notes }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not record the outcome");
      notify.done("Outcome recorded. Accepted and partial credits now reduce the campaign's spend.");
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not record the outcome"); }
    finally { setBusy(false); }
  }
  return <div className="grid gap-3">
    <p className="text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">What did the vendor do?</p>
    <div className="grid gap-3 sm:grid-cols-4">
      <label className="grid gap-1.5"><span className={label}>Outcome</span><select className={field} value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="accepted">Credited in full</option><option value="partial">Credited in part</option><option value="rejected">Rejected</option></select></label>
      <label className="grid gap-1.5"><span className={label}>Credited ($)</span><input className={`${field} text-right tabular-nums`} inputMode="decimal" value={status === "rejected" ? "0.00" : amount} disabled={status === "rejected"} onChange={(event) => setAmount(event.target.value)} /></label>
      <label className="grid gap-1.5"><span className={label}>Replacement leads</span><input className={`${field} text-right tabular-nums`} inputMode="numeric" value={replacements} onChange={(event) => setReplacements(event.target.value)} /></label>
      <label className="grid gap-1.5"><span className={label}>Vendor reference</span><input className={field} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ticket, email or memo" /></label>
    </div>
    {status === "rejected" && <label className="grid gap-1.5"><span className={label}>Why they rejected it</span><input className={field} value={reason} onChange={(event) => setReason(event.target.value)} /></label>}
    {error && <p role="alert" className="text-sm text-[var(--error-ink)]">{error}</p>}
    <div><Button type="button" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Record outcome"}</Button></div>
  </div>;
}

/**
 * The preview before a draft: per reason, the rows, what they are worth at the purchased rate and
 * the evidence each carries, with a toggle per reason. The total is rows x rate rounded once — the
 * same arithmetic create_combined_vendor_return_claim uses, so the draft asks for what this says.
 */
function ClaimPreview({ entry, cost, busy, fallback, onCreate, onCancel }: {
  entry: CampaignCandidateSummary;
  cost: CostState | undefined;
  busy: boolean;
  fallback: boolean;
  onCreate: (reasons: ClaimReason[] | null) => void;
  onCancel: () => void;
}) {
  const totals = useMemo(() => reasonTotals(entry.reasons).filter((row) => row.rows > 0), [entry]);
  const [off, setOff] = useState<ReadonlySet<ClaimReason>>(new Set());
  const chosen = totals.filter((row) => !off.has(row.reason));
  const rows = chosen.reduce((sum, row) => sum + row.rows, 0);
  const amount = claimAmountCents(rows, entry.unit_cost_cents);
  const toggle = (reason: ClaimReason) => setOff((current) => { const next = new Set(current); if (next.has(reason)) next.delete(reason); else next.add(reason); return next; });
  return <div className="grid gap-3 border-t border-border bg-[var(--canvas)] px-4 py-4">
    <p className="max-w-[80ch] text-sm leading-normal text-[var(--body)]">
      {entry.unit_cost_cents == null
        ? "This campaign has no cost per record yet. Enter its spend and records purchased on Vendors & campaigns first."
        : <>Each row is priced at <strong className="tabular-nums text-foreground">{perRecord(entry.unit_cost_cents)}</strong>.</>}
    </p>
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[620px] border-collapse text-left">
        <thead><tr>
          <th scope="col" className={`${th} w-[64px]`}>Include</th>
          <th scope="col" className={th}>Reason</th>
          <th scope="col" className={th}>Evidence per row</th>
          <th scope="col" className={`${th} w-[90px] text-right`}>Rows</th>
          <th scope="col" className={`${th} w-[110px] text-right`}>Value</th>
        </tr></thead>
        <tbody>{totals.map((row) => {
          const id = `claim-${entry.campaign_id}-${row.reason}`;
          const on = !off.has(row.reason);
          return <tr key={row.reason} className="m-row">
            <td className={td}><input id={id} type="checkbox" className="size-4" checked={on} disabled={fallback || busy} onChange={() => toggle(row.reason)} /></td>
            <td className={td}><label htmlFor={id} className="font-semibold text-foreground">{REASON_LABEL[row.reason]}</label></td>
            <td className={td}>{reasonEvidence(row.reason, row.sources)}</td>
            <td className={`${td} text-right tabular-nums`}>{count(row.rows)}</td>
            <td className={`${td} text-right tabular-nums`}>{entry.unit_cost_cents == null ? "—" : dollars(row.cents)}</td>
          </tr>;
        })}</tbody>
        <tfoot><tr>
          <td className={tfootTd} colSpan={3}>Total claimed</td>
          <td className={`${tfootTd} text-right`}>{count(rows)}</td>
          <td className={`${tfootTd} text-right`}>{amount == null ? "—" : dollars(amount)}</td>
        </tr></tfoot>
      </table>
    </div>
    {fallback && <p className="text-sm leading-normal text-[var(--warning-ink)]">Until a pending database update is applied, this draft takes every row shown.</p>}
    {amount != null && amount > 0 && <CostPerPolicyLine cost={cost} creditCents={amount} />}
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" disabled={busy || rows === 0 || amount == null} onClick={() => onCreate(off.size === 0 ? null : chosen.map((row) => row.reason))}>
        {busy ? "Drafting…" : `Create draft claim · ${count(rows)} row${rows === 1 ? "" : "s"}${amount == null ? "" : ` · ${dollars(amount)}`}`}
      </Button>
      <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
      {rows === 0 && <span className="text-sm text-muted-foreground">Turn on at least one reason.</span>}
    </div>
  </div>;
}

/** The rows behind one campaign's line, soonest window first. */
function CandidateRows({ state }: { state: { rows: ReturnCandidateRow[]; limit: number } | "loading" | { error: string } | undefined }) {
  if (state === undefined || state === "loading") return <div className="border-t border-border"><SectionLoading rows={3} columns={4} /></div>;
  if ("error" in state) return <p role="alert" className="border-t border-border px-4 py-3 text-sm text-[var(--error-ink)]">{state.error}</p>;
  if (!state.rows.length) return <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">No row is waiting on this campaign any more.</p>;
  return <div className="overflow-x-auto border-t border-border">
    <table className="w-full min-w-[620px] border-collapse text-left">
      <thead><tr><th scope="col" className={th}>Row</th><th scope="col" className={th}>Reason</th><th scope="col" className={th}>Evidence</th><th scope="col" className={th}>Window</th></tr></thead>
      <tbody>{state.rows.map((item) => {
        const evidence = item.evidence ?? {};
        const line = typeof evidence.source_row === "string" ? evidence.source_row.replace(/^csv:/, "") : null;
        const phone = typeof evidence.phone === "string" ? evidence.phone.replace(/\D/g, "").slice(-4) : "";
        const attempt = evidence.attempt_number == null ? null : Number(evidence.attempt_number);
        return <tr key={item.lead_id ?? item.scrub_rejection_id ?? `${item.reason}-${item.claimable_until}`} className="m-row">
          <td className={td}>{item.lead_id
            ? <a className="font-semibold text-[var(--accent-ink)] hover:underline" href={`/app/leads/${item.lead_id}`}>&hellip;{item.lead_id.slice(-8)}</a>
            : <span className="font-semibold text-foreground">{line ? `File line ${line}` : "Removed at import"}{phone ? <span className="font-normal text-muted-foreground"> &middot; &hellip;{phone}</span> : null}</span>}</td>
          <td className={td}>{REASON_LABEL[item.reason]}</td>
          <td className={td}>{item.source === "import" ? "Removed at import" : evidence.source === "disposition" ? `Call disposition${attempt ? ` · attempt ${attempt}` : ""}` : "Scrub result"}</td>
          <td className={td}>{item.claimable ? <StatusChip tone={item.days_remaining <= 3 ? "danger" : "neutral"}>{closesLabel(item.days_remaining)}</StatusChip> : <StatusChip tone="neutral" dot={false}>Expired</StatusChip>}</td>
        </tr>;
      })}</tbody>
    </table>
    {state.rows.length >= state.limit && <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">Showing the first {count(state.limit)} rows, soonest window first.</p>}
  </div>;
}

/**
 * Vendor returns (p-app-vendor-returns): evidence-backed return claims, and what the vendor
 * actually credited — claimed, credited and the variance side by side, so nobody has to subtract.
 *
 * "New claim" opens a preview of one campaign's claimable rows (scrub hits and wrong-number or
 * disconnected dispositions on its leads, and the rows the scrub removed at import, still inside the
 * return window): per reason the rows, the dollars and the evidence, with a toggle each. The draft
 * is one claim per campaign. Candidates stay listed below the claims, per campaign, with their value,
 * what already lapsed and the window counting down. Nothing is sent to a vendor from here: a claim
 * is exported as evidence, marked submitted, then reconciled by hand. `?vendor=<id>` opens the page
 * filtered to one vendor (Vendors links its claimable line here).
 *
 * Laid out to the UI consistency standard (docs/design/UI-CONSISTENCY.md): header with New claim, one
 * strip of figures, the claims table with its search and filters in its own toolbar, then the
 * claimable rows and the undialable share as further tables.
 */
export function VendorReturnsWorkspace({ initialVendorId }: { initialVendorId?: string }) {
  const [report, setReport] = useState<VendorReturnsPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [vendorId, setVendorId] = useState(initialVendorId ?? "");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "open" | "resolved">("");
  const [page, setPage] = useState(0);
  const [openClaim, setOpenClaim] = useState<string | null>(null);
  const [openCampaign, setOpenCampaign] = useState<string | null>(null);
  const [previewCampaign, setPreviewCampaign] = useState<string | null>(null);
  const [candidateRows, setCandidateRows] = useState<Record<string, { rows: ReturnCandidateRow[]; limit: number } | "loading" | { error: string }>>({});
  const [costs, setCosts] = useState<Record<string, CostState>>({});
  const [newOpen, setNewOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const newRef = useDismiss(newOpen, useCallback(() => setNewOpen(false), []));

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/app/vendor-returns", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load vendor returns");
      setReport(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load vendor returns"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void (async () => { await Promise.resolve(); await load(); })(); }, [load]);

  async function refresh() {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }

  /** The vendor filter lives in the URL too, so the view can be linked and survives a reload. */
  function chooseVendor(next: string) {
    setVendorId(next); setPage(0);
    try {
      const url = new URL(window.location.href);
      if (next) url.searchParams.set("vendor", next); else url.searchParams.delete("vendor");
      window.history.replaceState(null, "", url);
    } catch { /* the filter still applies without the URL */ }
  }

  async function ensureCost(campaignId: string) {
    if (costs[campaignId] !== undefined) return;
    setCosts((current) => ({ ...current, [campaignId]: "loading" }));
    try {
      const response = await fetch(`/api/app/vendor-returns/cost-per-policy?campaign_id=${campaignId}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      setCosts((current) => ({ ...current, [campaignId]: response.ok ? (body?.cost ?? null) : null }));
    } catch { setCosts((current) => ({ ...current, [campaignId]: null })); }
  }

  async function loadRows(campaignId: string) {
    setCandidateRows((current) => ({ ...current, [campaignId]: "loading" }));
    try {
      const response = await fetch(`/api/app/vendor-returns/candidates?campaign_id=${campaignId}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load the rows");
      setCandidateRows((current) => ({ ...current, [campaignId]: { rows: body?.rows ?? [], limit: Number(body?.limit ?? 500) } }));
    } catch (cause) { setCandidateRows((current) => ({ ...current, [campaignId]: { error: cause instanceof Error ? cause.message : "Could not load the rows" } })); }
  }

  function toggleRows(campaignId: string) {
    const opening = openCampaign !== campaignId;
    setOpenCampaign(opening ? campaignId : null);
    if (opening) void loadRows(campaignId);
  }

  function openPreview(campaignId: string) {
    setNewOpen(false);
    setPreviewCampaign(campaignId);
    void ensureCost(campaignId);
    window.setTimeout(() => document.getElementById(`returns-campaign-${campaignId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  }

  function toggleClaim(claim: VendorReturnClaim) {
    const opening = openClaim !== claim.id;
    setOpenClaim(opening ? claim.id : null);
    if (opening && claim.status !== "rejected") void ensureCost(claim.campaign_id);
  }

  async function createClaim(campaignId: string, reasons: ClaimReason[] | null) {
    setBusy(`create:${campaignId}`);
    try {
      const response = await fetch("/api/app/vendor-returns/claims", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaign_id: campaignId, reasons }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not create the claim");
      notify.done(body?.rows != null && body?.amount_claimed_cents != null
        ? `Draft claim created: ${count(Number(body.rows))} row${Number(body.rows) === 1 ? "" : "s"}, ${dollars(Number(body.amount_claimed_cents))}.`
        : "Draft claim created from every claimable row still inside its window.");
      setPreviewCampaign(null);
      setCandidateRows((current) => { const next = { ...current }; delete next[campaignId]; return next; });
      if (openCampaign === campaignId) setOpenCampaign(null);
      setCosts((current) => { const next = { ...current }; delete next[campaignId]; return next; });
      await load();
    } catch (cause) { notify.block(cause instanceof Error ? cause.message : "Could not create the claim"); }
    finally { setBusy(null); }
  }
  async function submitClaim(claimId: string) {
    setBusy(`submit:${claimId}`);
    try {
      const response = await fetch(`/api/app/vendor-returns/claims/${claimId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "submit" }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not mark the claim submitted");
      notify.done("Marked submitted. Record the vendor's answer here when it comes.");
      await load();
    } catch (cause) { notify.block(cause instanceof Error ? cause.message : "Could not mark the claim submitted"); }
    finally { setBusy(null); }
  }

  const claims = useMemo(() => report?.claims ?? [], [report]);
  // What is claimable, per campaign (vendor_returns_candidates_summary), narrowed by the vendor filter.
  const campaigns = useMemo(() => (report?.summary ?? []).filter((entry) => !vendorId || entry.vendor_id === vendorId), [report, vendorId]);
  const draftable = campaigns.filter((entry) => entry.claimable_rows > 0);
  const claimableCents = campaigns.reduce((sum, entry) => sum + entry.claimable_cents, 0);
  const expiredCents = campaigns.reduce((sum, entry) => sum + entry.expired_cents, 0);
  const undialable = useMemo(() => report?.undialable == null ? null : report.undialable.filter((row) => !vendorId || row.vendor_id === vendorId), [report, vendorId]);

  const vendors = useMemo(() => {
    const names = new Map<string, string>();
    for (const claim of claims) names.set(claim.vendor_id, claim.vendor_name ?? "Unnamed vendor");
    for (const entry of report?.summary ?? []) names.set(entry.vendor_id, entry.vendor_name);
    for (const row of report?.undialable ?? []) if (!names.has(row.vendor_id)) names.set(row.vendor_id, row.vendor_name);
    if (vendorId && !names.has(vendorId)) names.set(vendorId, "This vendor");
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [claims, report, vendorId]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return claims
      .filter((claim) => !vendorId || claim.vendor_id === vendorId)
      .filter((claim) => !statusFilter || (statusFilter === "open" ? unreconciled(claim) : !unreconciled(claim)))
      .filter((claim) => !needle || `${claim.vendor_name ?? ""} ${claim.campaign_name ?? ""} ${claim.reason} ${STATUS[claim.status].label}`.toLowerCase().includes(needle))
      // Oldest unreconciled first: the claim that has waited longest is the one to chase.
      .sort((a, b) => (unreconciled(a) === unreconciled(b) ? (unreconciled(a) ? a.created_at.localeCompare(b.created_at) : (b.resolved_at ?? b.created_at).localeCompare(a.resolved_at ?? a.created_at)) : unreconciled(a) ? -1 : 1));
  }, [claims, vendorId, statusFilter, search]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const shown = rows.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);
  const sum = (list: VendorReturnClaim[], pick: (claim: VendorReturnClaim) => number) => list.reduce((total, claim) => total + pick(claim), 0);

  // The four figures, over every claim — the filters narrow the table, not the ledger.
  const draftCount = claims.filter((claim) => claim.status === "draft").length;
  const openClaims = claims.filter(unreconciled).length;
  const claimedCents = sum(claims, (claim) => claim.amount_claimed_cents);
  const creditedCents = sum(claims, (claim) => claim.amount_credited_cents);
  const outstandingCents = sum(claims.filter((claim) => claim.status !== "rejected"), (claim) => claim.amount_claimed_cents - claim.amount_credited_cents);

  if (loading && !report) return <PageLoading />;

  const clearFilters = () => { setSearch(""); setStatusFilter(""); chooseVendor(""); };

  return <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
    <PageHeader
      title="Vendor returns"
      description="Evidence-backed return claims, and what the vendor actually credited."
      actions={<div className="relative" ref={newRef}>
        <Button aria-expanded={newOpen} disabled={!report || Boolean(busy)} onClick={() => setNewOpen((open) => !open)}>New claim<ChevronDown aria-hidden="true" /></Button>
        {newOpen && <div className={`${panel} right-0 w-[340px]`} role="menu" aria-label="Draft a claim for">
          <span className={panelLabel}>Review a claim for</span>
          {draftable.length === 0 ? <p className="text-sm leading-normal text-muted-foreground">Nothing is claimable right now{vendorId ? " for this vendor" : ""}.</p>
            : draftable.map((entry) => <button key={entry.campaign_id} type="button" role="menuitem" className="flex items-baseline justify-between gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--surface-alt)]" onClick={() => openPreview(entry.campaign_id)}>
              <span className="min-w-0"><span className="block truncate text-sm font-semibold text-foreground">{entry.vendor_name} &middot; {entry.campaign_name}</span><span className="block text-xs text-muted-foreground">{count(entry.claimable_rows)} claimable row{entry.claimable_rows === 1 ? "" : "s"}{entry.unit_cost_cents == null ? "" : ` · ${dollars(entry.claimable_cents)}`}</span></span>
              <span className={`shrink-0 text-xs font-semibold tabular-nums ${entry.days_left !== null && entry.days_left <= 3 ? "text-[var(--error-ink)]" : "text-muted-foreground"}`}>{entry.days_left === 0 ? "closes today" : entry.days_left === 1 ? "closes tomorrow" : `${entry.days_left}d left`}</span>
            </button>)}
        </div>}
      </div>}
    />

    <StatStrip label="Vendor return totals">
      <StatTile label="Open claims" value={openClaims} footnote={`${draftCount} draft`} />
      <StatTile label="Claimed" value={dollars(claimedCents)} footnote={`${claims.length} claim${claims.length === 1 ? "" : "s"}`} />
      <StatTile label="Credited" value={dollars(creditedCents)} valueTone={creditedCents > 0 ? "good" : undefined} footnote={claimedCents > 0 ? `${((creditedCents / claimedCents) * 100).toFixed(1)}% of claimed` : undefined} reserveFootnote />
      <StatTile label="Outstanding" value={dollars(outstandingCents)} valueTone={outstandingCents > 0 ? "warning" : undefined} footnote="unreconciled" />
    </StatStrip>

    <TableCard
      toolbar={
        <DataToolbar actions={<RefreshButton onClick={() => void refresh()} refreshing={refreshing} />}>
          <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(0); }} placeholder="Search claims" />
          <select aria-label="Vendor" className={toolbarControl} value={vendorId} onChange={(event) => chooseVendor(event.target.value)}>
            <option value="">All vendors</option>
            {vendors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select aria-label="Status" className={toolbarControl} value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as typeof statusFilter); setPage(0); }}>
            <option value="">Any status</option>
            <option value="open">Unreconciled (draft or awaiting)</option>
            <option value="resolved">Resolved</option>
          </select>
        </DataToolbar>
      }
      footer={<>
        <span>{rows.length ? `Showing ${currentPage * PAGE_SIZE + 1}–${currentPage * PAGE_SIZE + shown.length} of ${rows.length} claim${rows.length === 1 ? "" : "s"} · oldest unreconciled first` : "Nothing to show"}</span>
        <span className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
          <Button type="button" variant="outline" size="sm" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</Button>
        </span>
      </>}
    >
      {error && !report ? <ErrorState title="Vendor returns did not load" detail={error} action={<Button variant="outline" onClick={() => void refresh()}>Try again</Button>} />
        : rows.length === 0 ? (claims.length
          ? <NoMatches noun="claims" onClear={clearFilters} />
          : <EmptyState title="No claims yet" hint={draftable.length ? "Review one from the claimable rows below, or with New claim." : "A row becomes claimable when a scrub flags it or a call is dispositioned wrong number or disconnected."} />)
        : <table className="w-full min-w-[860px] table-fixed border-collapse text-left">
          <thead><tr>
            <th scope="col" className={th}>Vendor</th>
            <th scope="col" className={`${th} w-[130px]`}>Period</th>
            <th scope="col" className={`${th} w-[120px] text-right`}>Claimed</th>
            <th scope="col" className={`${th} w-[120px] text-right`}>Credited</th>
            <th scope="col" className={`${th} w-[120px] text-right`}>Variance</th>
            <th scope="col" className={`${th} w-[150px]`}>Status</th>
            <th scope="col" className={`${th} w-[170px] text-right`}><span className="sr-only">Evidence</span></th>
          </tr></thead>
          <tbody>
            {shown.map((claim) => {
              const open = openClaim === claim.id;
              const status = STATUS[claim.status];
              return <Fragment key={claim.id}>
                <tr className={`m-row cursor-pointer ${open ? "bg-[var(--soft-orange-surface)]" : ""}`} onClick={() => toggleClaim(claim)}>
                  <td className={td}>
                    <button type="button" aria-expanded={open} className="text-left hover:underline" onClick={(event) => { event.stopPropagation(); toggleClaim(claim); }}>
                      <span className="block font-semibold text-foreground">{claim.vendor_name ?? "Unnamed vendor"}</span>
                      <span className="block text-xs text-muted-foreground">{claim.campaign_name ?? "Campaign"} &middot; {claim.lead_count} row{claim.lead_count === 1 ? "" : "s"} &middot; {claim.reason.replaceAll("_", " ")}</span>
                    </button>
                  </td>
                  <td className={`${td} tabular-nums`}>{period(claim.period_from, claim.period_to)}</td>
                  <td className={`${td} text-right tabular-nums`}>{dollars(claim.amount_claimed_cents)}</td>
                  <td className={`${td} text-right tabular-nums`}>{claim.status === "draft" || claim.status === "submitted" ? "—" : dollars(claim.amount_credited_cents)}</td>
                  <td className={`${td} text-right font-semibold tabular-nums text-foreground`}>{dollars(claim.amount_claimed_cents - claim.amount_credited_cents)}</td>
                  <td className={td}><StatusChip tone={status.tone}>{status.label}</StatusChip></td>
                  <td className={`${td} text-right`} onClick={(event) => event.stopPropagation()}><Button asChild variant="outline" size="sm"><a href={`/api/app/vendor-returns/claims/${claim.id}?format=csv`}><Download aria-hidden="true" />Evidence CSV</a></Button></td>
                </tr>
                {open && <tr><td colSpan={7} className="border-t border-border bg-[var(--canvas)] px-4 py-4">
                  <div className="grid gap-3">
                    {claim.status === "draft" && <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm leading-normal text-[var(--body)]">Send the evidence CSV to the vendor, then mark the claim submitted.</p>
                      <Button type="button" disabled={busy === `submit:${claim.id}`} onClick={() => void submitClaim(claim.id)}>{busy === `submit:${claim.id}` ? "Saving…" : "Mark submitted"}</Button>
                    </div>}
                    {claim.status === "submitted" && <ClaimOutcome claim={claim} onSaved={() => { setOpenClaim(null); setCosts((current) => { const next = { ...current }; delete next[claim.campaign_id]; return next; }); void load(); }} />}
                    {(claim.status === "accepted" || claim.status === "partial" || claim.status === "rejected") && <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-4">
                      <div><dt className={label}>Resolved</dt><dd className="mt-1 text-sm font-semibold tabular-nums text-foreground">{claim.resolved_at ? dayMonthYear(claim.resolved_at, viewerTimeZone()) : "—"}</dd></div>
                      <div><dt className={label}>Replacement leads</dt><dd className="mt-1 text-sm font-semibold tabular-nums text-foreground">{claim.replacement_leads_count}</dd></div>
                      <div className="sm:col-span-2"><dt className={label}>{claim.status === "rejected" ? "Why it was rejected" : "Vendor reference"}</dt><dd className="mt-1 text-sm text-foreground">{(claim.status === "rejected" ? claim.rejection_reason : claim.notes) || "—"}</dd></div>
                    </dl>}
                    {unreconciled(claim) && claim.amount_claimed_cents > 0 && <CostPerPolicyLine cost={costs[claim.campaign_id]} creditCents={claim.amount_claimed_cents} />}
                    {(claim.status === "accepted" || claim.status === "partial") && <CostPerPolicyLine cost={costs[claim.campaign_id]} creditCents={claim.amount_credited_cents} landed />}
                  </div>
                </td></tr>}
              </Fragment>;
            })}
          </tbody>
          <tfoot><tr>
            <td className="border-t border-border bg-[var(--surface-alt)] px-3 py-2.5 text-sm font-semibold text-foreground">{rows.length} claim{rows.length === 1 ? "" : "s"}</td>
            <td className="border-t border-border bg-[var(--surface-alt)]" />
            <td className="border-t border-border bg-[var(--surface-alt)] px-3 py-2.5 text-right text-sm font-semibold tabular-nums text-foreground">{dollars(sum(rows, (claim) => claim.amount_claimed_cents))}</td>
            <td className="border-t border-border bg-[var(--surface-alt)] px-3 py-2.5 text-right text-sm font-semibold tabular-nums text-foreground">{dollars(sum(rows, (claim) => claim.amount_credited_cents))}</td>
            <td className="border-t border-border bg-[var(--surface-alt)] px-3 py-2.5 text-right text-sm font-semibold tabular-nums text-foreground">{dollars(sum(rows, (claim) => claim.amount_claimed_cents - claim.amount_credited_cents))}</td>
            <td className="border-t border-border bg-[var(--surface-alt)]" colSpan={2} />
          </tr></tfoot>
        </table>}
    </TableCard>

    {report && campaigns.length > 0 && <TableCard
      title="Claimable rows, by campaign"
      action={<span className="text-sm tabular-nums text-[var(--body)]">
        <strong className="font-semibold text-foreground">{dollars(claimableCents)}</strong> claimable now
        {expiredCents > 0 && <> &middot; <span className="text-[var(--warning-ink)]">{dollars(expiredCents)} lapsed unclaimed</span></>}
      </span>}
    >
      {report.summaryFallback && <p className="border-t border-border px-4 py-2.5 text-xs leading-normal text-muted-foreground">Rows removed at import are not listed until a pending database update is applied; claim them from the lead list.</p>}
      {campaigns.map((entry) => {
        const open = openCampaign === entry.campaign_id;
        const previewing = previewCampaign === entry.campaign_id;
        const reasons = reasonTotals(entry.reasons);
        const waiting = reasons.filter((row) => row.rows > 0).map((row) => `${count(row.rows)} ${REASON_LABEL[row.reason]}`).join(" · ");
        const facts = [
          entry.first_import_at ? `Imported ${dayMonthYear(entry.first_import_at, viewerTimeZone())}` : null,
          `${entry.return_window_days}-day window`,
          entry.unit_cost_cents == null ? "no cost per record entered" : `${perRecord(entry.unit_cost_cents)} a record`,
        ].filter(Boolean).join(" · ");
        return <div key={entry.campaign_id} id={`returns-campaign-${entry.campaign_id}`} className="border-t border-border">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <button type="button" aria-expanded={open} className="min-w-0 flex-grow text-left" onClick={() => toggleRows(entry.campaign_id)}>
              <span className="block text-sm font-semibold text-foreground">{entry.vendor_name} &middot; {entry.campaign_name}</span>
              <span className="block text-xs text-muted-foreground">{waiting || "Nothing claimable left"}</span>
              <span className="block text-xs text-muted-foreground">{facts}</span>
              {entry.expired_rows > 0 && <span className="block text-xs text-[var(--warning-ink)]">{dollars(entry.expired_cents)} lapsed unclaimed &middot; {count(entry.expired_rows)} row{entry.expired_rows === 1 ? "" : "s"} past the window</span>}
            </button>
            {entry.claimable_rows > 0 && entry.unit_cost_cents != null && <span className="text-sm font-semibold tabular-nums text-foreground">{dollars(entry.claimable_cents)}</span>}
            <span className={`text-sm font-semibold tabular-nums ${entry.days_left === null ? "text-muted-foreground" : entry.days_left <= 3 ? "text-[var(--error-ink)]" : entry.days_left <= 14 ? "text-[var(--warning-ink)]" : "text-[var(--success-ink)]"}`}>
              {daysText(entry.days_left)}
            </span>
            {entry.claimable_rows > 0 && <Button type="button" variant="outline" size="sm" aria-expanded={previewing} disabled={busy === `create:${entry.campaign_id}`} onClick={() => (previewing ? setPreviewCampaign(null) : openPreview(entry.campaign_id))}>{previewing ? "Close preview" : `Review claim (${count(entry.claimable_rows)})`}</Button>}
          </div>
          {previewing && <ClaimPreview key={`${entry.campaign_id}-${entry.claimable_rows}`} entry={entry} cost={costs[entry.campaign_id]} busy={busy === `create:${entry.campaign_id}`} fallback={report.summaryFallback} onCreate={(chosen) => void createClaim(entry.campaign_id, chosen)} onCancel={() => setPreviewCampaign(null)} />}
          {open && <CandidateRows state={candidateRows[entry.campaign_id]} />}
        </div>;
      })}
    </TableCard>}

    {report && (undialable === null
      ? <p className="text-xs leading-normal text-muted-foreground">The undialable share per vendor appears here once a pending database update is applied.</p>
      : undialable.length > 0 && <TableCard title="Undialable, by vendor" description="Share of every record bought that could never be dialed.">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead><tr>
            <th scope="col" className={th}>Vendor</th>
            <th scope="col" className={`${th} text-right`}>Records bought</th>
            <th scope="col" className={`${th} text-right`}>Removed at import</th>
            <th scope="col" className={`${th} text-right`}>Found later</th>
            <th scope="col" className={`${th} text-right`}>Undialable</th>
            <th scope="col" className={`${th} text-right`}>Undialable spend</th>
          </tr></thead>
          <tbody>{undialable.map((row) => <tr key={row.vendor_id} className="m-row">
            <td className={`${td} font-semibold text-foreground`}>{row.vendor_name}</td>
            <td className={`${td} text-right tabular-nums`}>{count(row.records_purchased)}</td>
            <td className={`${td} text-right tabular-nums`}>{count(row.removed_at_import)}</td>
            <td className={`${td} text-right tabular-nums`}>{count(row.undialable_leads)}</td>
            <td className={`${td} text-right tabular-nums`}><span className="font-semibold text-foreground">{row.undialable_percent == null ? "—" : `${row.undialable_percent.toFixed(1)}%`}</span><span className="block text-xs text-muted-foreground">{count(row.undialable_rows)} of {count(row.records_purchased)}</span></td>
            <td className={`${td} text-right tabular-nums`}>{dollars(row.undialable_cents)}</td>
          </tr>)}</tbody>
        </table>
      </TableCard>)}
  </div>;
}

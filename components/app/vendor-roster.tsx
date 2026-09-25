"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, Clock, X } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  VENDOR_STATUS_LABEL,
  vendorCampaignWarning,
  vendorTakesCampaigns,
  type VendorCardFacts,
  type VendorCardsResponse,
  type VendorContact,
  type VendorStatus,
} from "@/lib/vendors/types";

/**
 * The vendor roster on /app/campaigns (Vendors concept board, LA-2 §5), and the New vendor form.
 *
 * The p-app-campaigns layout is kept: this is the "Vendor rollup" table it already had, with the
 * concept board's facts added as a column, chips and detail lines rather than a relayout into
 * cards. Every figure is read, never computed here:
 *   spend, records, rejected, per usable, unit price   tenant_vendor_rollup   (GET /api/app/vendors)
 *   speed to lead, consent claimed                     the LA-2.5/2.6 views   (GET /api/app/vendors)
 *   cost per issued policy, claimable returns,
 *   undialable share, trialling, drop facts            GET /api/app/vendors/cards
 * The cards route is slower (it runs the scorecard over the vendor's whole history), so the table
 * renders from the first route and the facts fill in when they arrive.
 */

type Vendor = {
  id: string; name: string; lead_type: string; return_window_days: number; status: string;
  terms: string | null; notes: string | null;
  contact?: VendorContact | Record<string, unknown> | null; category?: string | null; renews_on?: string | null;
};
type Rollup = {
  vendor_id: string; vendor_name: string; lead_type: string; status: string; return_window_days: number;
  campaign_count: number; active_campaign_count: number; total_spend_cents: number; records_purchased: number;
  records_rejected: number | null; cost_per_record_cents: number | null; cost_per_usable_record_cents: number | null;
};
type Speed = { vendor_id: string; posted_leads: number; median_seconds: number | null; dialled_within_60s_pct: number | null };
type Consent = { vendor_id: string; claimed_coverage_pct: number | null };

function money(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "—";
  return "$" + (Number(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const money2 = money;
function duration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "—";
  const value = Number(seconds);
  if (value < 60) return `${Math.round(value)}s`;
  if (value < 3600) return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
  return `${Math.floor(value / 3600)}h ${Math.round((value % 3600) / 60)}m`;
}
function percent(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toFixed(1)}%`;
}
/** A count the database has not computed yet is "—", never 0. Zero is a measurement. */
function count(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : Number(value).toLocaleString();
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-14" → "14 Oct 2026", read as a calendar date (no timezone shift). */
function calendarDate(value: string | null | undefined) {
  if (!value) return null;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : null;
}
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const LEAD_TYPE: Record<string, string> = { list: "List", realtime: "Real-time", aged: "Aged" };

function contactOf(vendor: Vendor): VendorContact {
  const raw = (vendor.contact ?? {}) as Record<string, unknown>;
  const pick = (key: string) => (typeof raw[key] === "string" && raw[key] ? String(raw[key]) : undefined);
  return { name: pick("name"), email: pick("email"), phone: pick("phone") };
}

/** 12px chips (the shared StatusChip is 11px, under this page's floor). */
function Chip({ tone, children }: { tone: "warning" | "info" | "neutral"; children: ReactNode }) {
  const tones = {
    warning: "bg-[var(--warning-surface)] text-[var(--warning-ink)]",
    info: "bg-[var(--info-surface)] text-[var(--info-ink)]",
    neutral: "bg-[var(--surface-alt)] text-[var(--body)]",
  } as const;
  return <span className={`ml-2 inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 align-middle text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

/** A full-width line under a vendor row. Danger for money about to lapse and drop facts; info for a trial. */
function FactLine({ tone, icon, children }: { tone: "danger" | "info"; icon: ReactNode; children: ReactNode }) {
  const tones = {
    danger: "bg-[var(--error-surface)] text-[var(--body)] [&_strong]:text-[var(--error-ink)]",
    info: "border border-dashed border-[var(--border-strong)] bg-[var(--surface-alt)] text-[var(--body)]",
  } as const;
  return <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm leading-normal ${tones[tone]}`}>{icon}<div className="min-w-0 flex-1">{children}</div></div>;
}

type Draft = {
  name: string; category: string; lead_type: string; status: VendorStatus; return_window_days: string; renews_on: string;
  contact_name: string; contact_email: string; contact_phone: string; terms: string;
};
const EMPTY_DRAFT: Draft = { name: "", category: "", lead_type: "list", status: "active", return_window_days: "30", renews_on: "", contact_name: "", contact_email: "", contact_phone: "", terms: "" };

function draftOf(vendor: Vendor): Draft {
  const contact = contactOf(vendor);
  return {
    name: vendor.name, category: vendor.category ?? "", lead_type: vendor.lead_type,
    status: (["active", "under_review", "inactive"].includes(vendor.status) ? vendor.status : "active") as VendorStatus,
    return_window_days: String(vendor.return_window_days ?? 0), renews_on: vendor.renews_on ?? "",
    contact_name: contact.name ?? "", contact_email: contact.email ?? "", contact_phone: contact.phone ?? "", terms: vendor.terms ?? "",
  };
}
function payloadOf(draft: Draft) {
  return {
    name: draft.name.trim(),
    lead_type: draft.lead_type,
    status: draft.status,
    return_window_days: Math.max(0, Math.floor(Number(draft.return_window_days) || 0)),
    category: draft.category.trim() || null,
    renews_on: draft.renews_on || null,
    contact: { name: draft.contact_name.trim(), email: draft.contact_email.trim(), phone: draft.contact_phone.trim() },
    terms: draft.terms.trim() || null,
  };
}

/** The fields shared by New vendor and a row's Edit. `idPrefix` keeps label/for pairs unique. */
function VendorFields({ draft, onChange, idPrefix, allowInactive }: { draft: Draft; onChange: (next: Draft) => void; idPrefix: string; allowInactive: boolean }) {
  const set = (key: keyof Draft) => (event: { target: { value: string } }) => onChange({ ...draft, [key]: event.target.value });
  const id = (key: string) => `${idPrefix}-${key}`;
  return <div className="portal-campaigns-form-grid">
    <label className="portal-campaigns-field" htmlFor={id("name")}><span>Name</span><input id={id("name")} value={draft.name} onChange={set("name")} placeholder="Apex Data" /></label>
    <label className="portal-campaigns-field" htmlFor={id("category")}><span>Category</span><input id={id("category")} value={draft.category} onChange={set("category")} maxLength={80} placeholder="Aged & ping-post" /></label>
    <label className="portal-campaigns-field" htmlFor={id("type")}><span>Lead type</span><select id={id("type")} value={draft.lead_type} onChange={set("lead_type")}><option value="list">List — a spreadsheet</option><option value="realtime">Real-time — posted by API</option><option value="aged">Aged — old and cheap</option></select></label>
    <label className="portal-campaigns-field" htmlFor={id("status")}><span>Status</span><select id={id("status")} value={draft.status} onChange={set("status")}>
      <option value="active">{VENDOR_STATUS_LABEL.active}</option>
      <option value="under_review">{VENDOR_STATUS_LABEL.under_review}</option>
      {allowInactive && <option value="inactive">{VENDOR_STATUS_LABEL.inactive}</option>}
    </select></label>
    <label className="portal-campaigns-field" htmlFor={id("window")}><span>Return window (days)</span><input id={id("window")} inputMode="numeric" value={draft.return_window_days} onChange={set("return_window_days")} /></label>
    <label className="portal-campaigns-field" htmlFor={id("renews")}><span>Renews on</span><input id={id("renews")} type="date" value={draft.renews_on} onChange={set("renews_on")} /></label>
    <label className="portal-campaigns-field" htmlFor={id("contact")}><span>Contact name</span><input id={id("contact")} value={draft.contact_name} onChange={set("contact_name")} maxLength={120} placeholder="Tom Reilly" /></label>
    <label className="portal-campaigns-field" htmlFor={id("email")}><span>Contact email</span><input id={id("email")} type="email" value={draft.contact_email} onChange={set("contact_email")} maxLength={200} placeholder="accounts@apexdata.io" /></label>
    <label className="portal-campaigns-field" htmlFor={id("phone")}><span>Contact phone</span><input id={id("phone")} type="tel" value={draft.contact_phone} onChange={set("contact_phone")} maxLength={40} /></label>
    <label className="portal-campaigns-field is-wide" htmlFor={id("terms")}><span>Terms</span><input id={id("terms")} value={draft.terms} onChange={set("terms")} placeholder="Net 15, credits disconnects and DNC within the window" /></label>
  </div>;
}

/** The New vendor panel. Opened by the page header's "New vendor". */
export function NewVendorPanel({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<unknown> | void }) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createVendor() {
    if (saving) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/app/vendors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payloadOf(draft)) });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        // A 503 is "the database is behind", said where the form is rather than as a fading toast.
        if (response.status === 503) setError(body?.error ?? "This setting needs a database update that has not been applied yet.");
        else notify.block(body?.error ?? "Could not create this vendor");
        return;
      }
      notify.done(`${body.vendor.name} added`);
      onClose();
      await onCreated();
    } finally { setSaving(false); }
  }

  return <section className="portal-campaigns-panel is-padded" aria-labelledby="new-vendor-heading">
    <div className="portal-campaigns-form-head"><h2 id="new-vendor-heading">New vendor</h2><Button type="button" variant="ghost" size="sm" onClick={onClose}><X className="size-4" aria-hidden="true" />Cancel</Button></div>
    <p className="portal-campaigns-form-note">Who sells you the list. The return window is the clock on a vendor credit claim, so it is worth getting from the contract rather than guessing.</p>
    <VendorFields draft={draft} onChange={setDraft} idPrefix="new-vendor" allowInactive={false} />
    {error && <p className="text-sm text-[var(--error-ink)]" role="alert">{error}</p>}
    <div className="portal-campaigns-form-actions"><Button type="button" disabled={!draft.name.trim() || saving} onClick={() => void createVendor()}>{saving ? "Saving…" : "Add vendor"}</Button></div>
  </section>;
}

/** "3 days left", "closes today". */
function daysLeft(days: number) {
  return days <= 0 ? "closes today" : `${plural(days, "day")} left`;
}

function TrialLine({ facts, onShowCampaigns, onOrderAnother, orderDisabledReason }: { facts: VendorCardFacts; onShowCampaigns: () => void; onOrderAnother: () => void; orderDisabledReason: string | null }) {
  const campaigns = facts.campaign_count ?? 0;
  const leads = facts.lead_count ?? 0;
  const threshold = facts.trial_lead_threshold;
  const needs = [campaigns <= 1 ? "a second campaign" : null, leads < threshold ? `${(threshold - leads).toLocaleString()} more leads` : null].filter(Boolean).join(" and ");
  const policies = facts.issued_policies;
  const sensitivity = facts.one_more_sale_moves_cents === null ? null
    : policies === 0 ? ` The first sale would put its cost per policy at ${money(facts.one_more_sale_moves_cents)}.`
    : ` One more sale would move its cost per policy by ${money(facts.one_more_sale_moves_cents)}.`;
  return <FactLine tone="info" icon={<AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--info-ink)]" aria-hidden="true" />}>
    <p className="m-0"><strong className="font-semibold text-[var(--info-ink)]">Trialling.</strong> {plural(campaigns, "campaign")}, {plural(leads, "lead")}{policies !== null ? `, ${plural(policies, "policy", "policies")} so far` : ""}. Not ranked or flagged until it has {needs}.{sensitivity}</p>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={onShowCampaigns}>See its campaigns</Button>
      <Button type="button" variant="outline" size="sm" disabled={orderDisabledReason !== null} title={orderDisabledReason ?? undefined} onClick={onOrderAnother}>Order another</Button>
      {orderDisabledReason && <span className="text-xs text-muted-foreground">{orderDisabledReason}</span>}
    </div>
  </FactLine>;
}

export function VendorRoster({ vendors, rollup, speed, consent, onChanged, onNewCampaign, onShowCampaigns }: {
  vendors: Vendor[];
  rollup: Rollup[];
  speed: Speed[];
  consent: Consent[];
  /** Reload the page's vendors and campaigns after an edit. */
  onChanged: () => Promise<unknown> | void;
  /** "Order another": open the page's New campaign form with this vendor chosen. No purchase. */
  onNewCampaign: (vendorId: string, leadType: string) => void;
  /** "See its campaigns": filter the campaign table to this vendor. */
  onShowCampaigns: (vendorId: string) => void;
}) {
  const [facts, setFacts] = useState<VendorCardsResponse | null>(null);
  const [factsError, setFactsError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Refetched whenever the page reloads its rollup: a spend edit or a new campaign changes cost
  // per policy and trialling, and a stale fact line is worse than a late one.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/app/vendors/cards", { cache: "no-store" });
        const body = await response.json().catch(() => null);
        if (!active) return;
        if (!response.ok) throw new Error(body?.error ?? "Could not load vendor figures");
        setFacts(body as VendorCardsResponse); setFactsError(null);
      } catch (cause) {
        if (active) setFactsError(cause instanceof Error ? cause.message : "Could not load vendor figures");
      }
    })();
    return () => { active = false; };
  }, [rollup]);

  const vendorById = useMemo(() => new Map(vendors.map((vendor) => [vendor.id, vendor])), [vendors]);
  const speedByVendor = useMemo(() => new Map(speed.map((row) => [row.vendor_id, row])), [speed]);
  const consentByVendor = useMemo(() => new Map(consent.map((row) => [row.vendor_id, row])), [consent]);
  const factsByVendor = useMemo(() => new Map((facts?.cards ?? []).map((row) => [row.vendor_id, row])), [facts]);

  function toggle(vendorId: string) {
    if (openId === vendorId) { setOpenId(null); setDraft(null); return; }
    const vendor = vendorById.get(vendorId);
    setOpenId(vendorId); setSaveError(null);
    setDraft(vendor ? draftOf(vendor) : null);
  }

  async function saveVendor(vendorId: string) {
    if (!draft || saving) return;
    setSaving(true); setSaveError(null);
    try {
      const response = await fetch("/api/app/vendors", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: vendorId, ...payloadOf(draft) }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 503) setSaveError(body?.error ?? "This setting needs a database update that has not been applied yet.");
        else notify.block(body?.error ?? "Could not save this vendor");
        return;
      }
      notify.done(`${body.vendor.name} saved`);
      setOpenId(null); setDraft(null);
      await onChanged();
    } finally { setSaving(false); }
  }

  const best = facts?.best ?? null;

  return <section className="portal-campaigns-panel" aria-labelledby="vendor-rollup-heading">
    <div className="portal-campaigns-panel-bar"><h2 id="vendor-rollup-heading">Vendor rollup</h2><span>Cost, speed and consent evidence, each over the vendor&rsquo;s own leads{facts?.true_cpa ? " · cost per issued policy over the vendor’s whole history" : ""}</span></div>
    <Table>
      <TableHeader><TableRow>
        <TableHead scope="col">Vendor</TableHead>
        <TableHead scope="col" className="text-right">Spend</TableHead>
        <TableHead scope="col" className="text-right">Purchased</TableHead>
        <TableHead scope="col" className="text-right">Rejected</TableHead>
        <TableHead scope="col" className="text-right">Per usable</TableHead>
        <TableHead scope="col" className="text-right">Cost / issued</TableHead>
        <TableHead scope="col" className="text-right">Median to dial</TableHead>
        <TableHead scope="col" className="text-right">Under 60s</TableHead>
        <TableHead scope="col" className="text-right">Consent claimed</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {rollup.map((vendor) => {
          const fast = speedByVendor.get(vendor.vendor_id);
          const certificates = consentByVendor.get(vendor.vendor_id);
          const row = vendorById.get(vendor.vendor_id);
          const fact = factsByVendor.get(vendor.vendor_id);
          const status = row?.status ?? vendor.status;
          const category = row?.category ?? fact?.category ?? null;
          const open = openId === vendor.vendor_id;
          const orderDisabledReason = vendorTakesCampaigns(status) ? null : "Inactive vendors take no new campaigns. Set it back to active first.";
          const costFlagged = fact?.drop?.reasons.some((reason) => reason.key === "cost") ?? false;
          const lines: ReactNode[] = [];
          if (fact?.claimable) lines.push(<FactLine key="claim" tone="danger" icon={<Clock className="mt-0.5 size-4 shrink-0 text-[var(--error-ink)]" aria-hidden="true" />}>
            <p className="m-0 tabular-nums"><strong className="font-semibold">{money(fact.claimable.cents)} claimable, {daysLeft(fact.claimable.days_left)}.</strong> {plural(fact.claimable.rows, "row")} at the campaign&rsquo;s purchased rate. <a className="font-semibold text-[var(--accent-ink)] hover:underline" href={`/app/vendor-returns?vendor=${vendor.vendor_id}`}>Claim it now</a></p>
          </FactLine>);
          if (fact?.drop) {
            const text = fact.drop.reasons.map((reason) => reason.text).join("; ");
            const renews = calendarDate(fact.drop.renews_on);
            lines.push(<FactLine key="drop" tone="danger" icon={<AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--error-ink)]" aria-hidden="true" />}>
              <p className="m-0 tabular-nums">{text.charAt(0).toUpperCase() + text.slice(1)}. {renews ? <>Renewal is on <strong className="font-semibold">{renews}</strong>.</> : "No renewal date recorded."} <span className="text-muted-foreground">Facts to weigh — nothing is paused automatically.</span></p>
            </FactLine>);
          }
          if (fact?.trialling) lines.push(<TrialLine key="trial" facts={fact} onShowCampaigns={() => onShowCampaigns(vendor.vendor_id)} onOrderAnother={() => onNewCampaign(vendor.vendor_id, vendor.lead_type)} orderDisabledReason={orderDisabledReason} />);
          const contact = row ? contactOf(row) : {};
          // Said beside the edit, from the draft: choosing "Under review" is when the reader needs it.
          const warning = open && draft ? vendorCampaignWarning(draft.status, row?.name ?? vendor.vendor_name) : null;
          return <Fragment key={vendor.vendor_id}>
            <TableRow className={`portal-campaigns-row${open ? " is-open" : ""}`} onClick={() => toggle(vendor.vendor_id)}>
              <TableCell>
                <button type="button" className="portal-campaigns-name" aria-expanded={open} onClick={(event) => { event.stopPropagation(); toggle(vendor.vendor_id); }}>{vendor.vendor_name}</button>
                {status === "under_review" && <Chip tone="warning">{VENDOR_STATUS_LABEL.under_review}</Chip>}
                {status === "inactive" && <Chip tone="neutral">{VENDOR_STATUS_LABEL.inactive}</Chip>}
                {fact?.trialling && status !== "inactive" && <Chip tone="info">Trialling</Chip>}
                <small className="portal-campaigns-sub">{category ? `${category} · ` : ""}{vendor.lead_type} · {vendor.active_campaign_count} of {vendor.campaign_count} active</small>
              </TableCell>
              <TableCell className="text-right tabular-nums">{money(vendor.total_spend_cents)}</TableCell>
              <TableCell className="text-right tabular-nums">{vendor.records_purchased.toLocaleString()}</TableCell>
              <TableCell className={`text-right tabular-nums${(vendor.records_rejected ?? 0) > 0 ? " is-bad" : ""}`}>{count(vendor.records_rejected)}</TableCell>
              <TableCell className="text-right tabular-nums"><strong>{money2(vendor.cost_per_usable_record_cents)}</strong></TableCell>
              <TableCell className={`text-right tabular-nums${costFlagged ? " is-bad" : ""}`} title={fact?.trialling ? "Not ranked: still trialling" : best && best.vendor_id === vendor.vendor_id ? "Lowest cost per issued policy of the ranked vendors" : undefined}>
                {fact ? <strong className={best && best.vendor_id === vendor.vendor_id ? "text-[var(--success-ink)]" : undefined}>{money2(fact.cost_per_policy_cents)}</strong> : "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">{fast?.posted_leads ? duration(fast.median_seconds) : "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{fast?.posted_leads ? percent(fast.dialled_within_60s_pct) : "—"}</TableCell>
              <TableCell className={`text-right tabular-nums${certificates && Number(certificates.claimed_coverage_pct ?? 0) < 50 ? " is-bad" : ""}`}>{certificates ? percent(certificates.claimed_coverage_pct) : "—"}</TableCell>
            </TableRow>
            {lines.length > 0 && <TableRow className="portal-campaigns-detail-row"><TableCell colSpan={9}><div className="flex flex-col gap-2 px-4 pb-3">{lines}</div></TableCell></TableRow>}
            {open && <TableRow className="portal-campaigns-detail-row"><TableCell colSpan={9}>
              <div className="portal-campaigns-detail">
                <dl>
                  <div><dt>Contact</dt><dd>{contact.name || contact.email || contact.phone
                    ? <>{[contact.name, contact.phone].filter(Boolean).join(" · ")}{contact.email ? <>{contact.name || contact.phone ? " · " : ""}<a className="text-[var(--accent-ink)] hover:underline" href={`mailto:${contact.email}`}>{contact.email}</a></> : null}</>
                    : "—"}</dd></div>
                  <div><dt>Unit price</dt><dd>{money2(vendor.cost_per_record_cents)} per record</dd></div>
                  <div><dt>Return window</dt><dd>{vendor.return_window_days > 0 ? plural(vendor.return_window_days, "day") : "No returns agreed"}{fact?.claimable ? ` · soonest claimable ${daysLeft(fact.claimable.days_left)}` : ""}</dd></div>
                  <div><dt>Undialable</dt><dd>{percent(fact?.undialable_percent)}</dd></div>
                  <div><dt>Renews on</dt><dd>{calendarDate(row?.renews_on ?? fact?.renews_on) ?? "—"}</dd></div>
                  <div><dt>Lead type</dt><dd>{LEAD_TYPE[vendor.lead_type] ?? vendor.lead_type}</dd></div>
                </dl>
                {row?.terms && <p className="m-0 text-sm text-[var(--body)]"><span className="font-semibold text-foreground">Terms:</span> {row.terms}</p>}
                {draft && <>
                  <VendorFields draft={draft} onChange={setDraft} idPrefix={`vendor-${vendor.vendor_id}`} allowInactive />
                  {warning && <p className="m-0 text-sm text-[var(--warning-ink)]">{warning}</p>}
                  {saveError && <p className="m-0 text-sm text-[var(--error-ink)]" role="alert">{saveError}</p>}
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button type="button" variant="outline" disabled={orderDisabledReason !== null} title={orderDisabledReason ?? undefined} onClick={() => onNewCampaign(vendor.vendor_id, vendor.lead_type)}>New campaign for this vendor</Button>
                    <Button type="button" disabled={!draft.name.trim() || saving} onClick={() => void saveVendor(vendor.vendor_id)}>{saving ? "Saving…" : "Save vendor"}</Button>
                  </div>
                  {orderDisabledReason && <p className="m-0 text-right text-xs text-muted-foreground">{orderDisabledReason}</p>}
                </>}
              </div>
            </TableCell></TableRow>}
          </Fragment>;
        })}
      </TableBody>
    </Table>
    {(factsError || (facts?.pending.length ?? 0) > 0) && <div className="border-t border-border px-4 py-3 text-xs leading-normal text-muted-foreground" role="status">
      {factsError ? <p className="m-0">Cost per policy, claimable returns and trial status could not be loaded, so their absence here is not a statement about any vendor. {factsError}</p>
        : <ul className="m-0 list-disc pl-4">{facts?.pending.map((item) => <li key={item.missing.join(",")}>{item.detail}</li>)}</ul>}
    </div>}
  </section>;
}

"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, AlertTriangle, Ban, ChevronDown, Clock, Eye, FlaskConical, Trash2 } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { DetailPanel } from "@/components/ui/detail-panel";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InfoTip } from "@/components/ui/info-tip";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { CampaignSpeedToLead } from "@/components/app/campaign-speed-to-lead";
import { RowActions } from "@/components/app/campaigns/row-actions";
import { NumberStepper } from "@/components/app/campaigns/number-stepper";
import { Field, control } from "@/components/app/settings/primitives";
import { costTone, highIsGood, rejectedTone, speedTone, toneText, TONE_KEY } from "@/components/app/campaigns/tones";
import { cn } from "@/lib/utils";
import {
  VENDOR_STATUS_LABEL,
  vendorCampaignWarning,
  type VendorCardFacts,
  type VendorCardsResponse,
  type VendorContact,
  type VendorStatus,
} from "@/lib/vendors/types";
import { StatusChip } from "@/components/ui/status-chip";

/**
 * The vendors on Lead sources › Source (Vendors concept board, LA-2 §5; owner pick A · Vendor first,
 * 2026-10-28; /ui-taste critique 2026-10-29): the "Compare vendors" table, a vendor's read-only facts
 * (the scorecard's Details), its edit form in an overlay panel, the New vendor form, and the signals
 * and figures the vendor list and scorecard share. Every figure is read, never computed here:
 *   spend, records, rejected, per usable, unit price   tenant_vendor_rollup   (GET /api/app/vendors)
 *   speed to lead, consent claimed                     the LA-2.5/2.6 views   (GET /api/app/vendors)
 *   cost per issued policy, claimable returns,
 *   undialable share, trialling, drop facts            GET /api/app/vendors/cards
 * The cards route is slower (it runs the scorecard over the vendor's whole history), so the page
 * renders from the first route and the facts fill in when they arrive.
 */

export type RosterVendor = {
  id: string; name: string; lead_type: string; return_window_days: number; status: string;
  terms: string | null; notes: string | null;
  contact?: VendorContact | Record<string, unknown> | null; category?: string | null; renews_on?: string | null;
};
export type RosterRollup = {
  vendor_id: string; vendor_name: string; lead_type: string; status: string; return_window_days: number;
  campaign_count: number; active_campaign_count: number; total_spend_cents: number; records_purchased: number;
  records_rejected: number | null; cost_per_record_cents: number | null; cost_per_usable_record_cents: number | null;
};
export type RosterSpeed = { vendor_id: string; posted_leads: number; median_seconds: number | null; dialled_within_60s_pct: number | null };
/** `leads`: how many of the vendor's leads the coverage is counted over (absent on older payloads). */
export type RosterConsent = { vendor_id: string; claimed_coverage_pct: number | null; leads?: number };

export function money(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "—";
  return "$" + (Number(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const money2 = money;
export function duration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "—";
  const value = Number(seconds);
  if (value < 60) return `${Math.round(value)}s`;
  if (value < 3600) return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
  return `${Math.floor(value / 3600)}h ${Math.round((value % 3600) / 60)}m`;
}
export function percent(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toFixed(1)}%`;
}
/** A count the database has not computed yet is "—", never 0. Zero is a measurement. */
function count(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : Number(value).toLocaleString();
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-14" → "14 Oct 2026", read as a calendar date (no timezone shift). */
export function calendarDate(value: string | null | undefined) {
  if (!value) return null;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : null;
}
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
export const LEAD_TYPE: Record<string, string> = { list: "List", realtime: "Real-time", aged: "Aged" };

/**
 * List / Real-time / Aged as chips that pick one (a choice of three is never a dropdown). `any` adds
 * an "Any" chip first, for a filter.
 */
export function LeadTypeChoice({ value, onChange, label, any = false, labelledBy }: { value: string; onChange: (next: string) => void; label?: string; any?: boolean; labelledBy?: string }) {
  const choices = [...(any ? [["all", "Any"]] : []), ...Object.entries(LEAD_TYPE)];
  return <div role="radiogroup" aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy} className="flex flex-wrap gap-1.5">
    {choices.map(([key, name]) => <ToggleChip key={key} role="radio" selected={value === key} onClick={() => onChange(key)}>{name}</ToggleChip>)}
  </div>;
}

function contactOf(vendor: RosterVendor): VendorContact {
  const raw = (vendor.contact ?? {}) as Record<string, unknown>;
  const pick = (key: string) => (typeof raw[key] === "string" && raw[key] ? String(raw[key]) : undefined);
  return { name: pick("name"), email: pick("email"), phone: pick("phone") };
}

/** A full-width line in a vendor's details: money about to lapse, and the drop facts. */
function FactLine({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <div className="flex items-start gap-2 rounded-lg bg-[var(--error-surface)] px-3 py-2 text-sm leading-normal text-[var(--body)] [&_strong]:text-[var(--error-ink)]">{icon}<div className="min-w-0 flex-1">{children}</div></div>;
}

type Draft = {
  name: string; category: string; lead_type: string; status: VendorStatus; return_window_days: string; renews_on: string;
  contact_name: string; contact_email: string; contact_phone: string; terms: string; notes: string;
};
const EMPTY_DRAFT: Draft = { name: "", category: "", lead_type: "list", status: "active", return_window_days: "30", renews_on: "", contact_name: "", contact_email: "", contact_phone: "", terms: "", notes: "" };

function draftOf(vendor: RosterVendor): Draft {
  const contact = contactOf(vendor);
  return {
    name: vendor.name, category: vendor.category ?? "", lead_type: vendor.lead_type,
    status: (["active", "under_review", "inactive"].includes(vendor.status) ? vendor.status : "active") as VendorStatus,
    return_window_days: String(vendor.return_window_days ?? 0), renews_on: vendor.renews_on ?? "",
    contact_name: contact.name ?? "", contact_email: contact.email ?? "", contact_phone: contact.phone ?? "", terms: vendor.terms ?? "",
    notes: vendor.notes ?? "",
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
    notes: draft.notes.trim() || null,
  };
}

/**
 * The fields shared by New vendor and a vendor's Edit. `create` shows the essentials (name, lead
 * type, return window) and folds the rest under "More details"; a new vendor is always active, so
 * its status is not asked. `edit` shows every field, status included.
 * Renews on stays the browser's date box: the kit's DateTimePicker picks a date AND a time, and a
 * renewal is a calendar date.
 */
function VendorFields({ draft, onChange, idPrefix, mode }: { draft: Draft; onChange: (next: Draft) => void; idPrefix: string; mode: "create" | "edit" }) {
  const [more, setMore] = useState(mode === "edit");
  const set = (key: keyof Draft) => (event: { target: { value: string } }) => onChange({ ...draft, [key]: event.target.value });
  const id = (key: string) => `${idPrefix}-${key}`;
  return <div className="flex flex-col gap-4">
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
      <Field label="Name" htmlFor={id("name")}><input id={id("name")} className={control} value={draft.name} onChange={set("name")} maxLength={160} placeholder="Apex Data" /></Field>
      <Field label="Return window" htmlFor={id("window")}>
        <NumberStepper id={id("window")} value={draft.return_window_days} onChange={(next) => onChange({ ...draft, return_window_days: next })} min={0} max={365} label="days in the return window"
          after={<span className="inline-flex items-center gap-1">days<InfoTip label="About the return window">From the contract: the clock on a credit claim.</InfoTip></span>} />
      </Field>
    </div>
    <div className="grid gap-1.5">
      <span id={id("type-label")} className="text-label text-[var(--body)]">Lead type</span>
      <LeadTypeChoice value={draft.lead_type} onChange={(next) => onChange({ ...draft, lead_type: next })} labelledBy={id("type-label")} />
    </div>
    {mode === "create" && <Button type="button" variant="ghost" size="sm" className="self-start" aria-expanded={more} aria-controls={id("more")} onClick={() => setMore((value) => !value)}>
      <ChevronDown className={cn("transition-transform", more && "rotate-180")} aria-hidden="true" />More details
    </Button>}
    {more && <div id={id("more")} className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
      <Field label="Category" htmlFor={id("category")}><input id={id("category")} className={control} value={draft.category} onChange={set("category")} maxLength={80} placeholder="Aged & ping-post" /></Field>
      {mode === "edit" && <Field label="Status" htmlFor={id("status")}><select id={id("status")} className={control} value={draft.status} onChange={set("status")}>
        <option value="active">{VENDOR_STATUS_LABEL.active}</option>
        <option value="under_review">{VENDOR_STATUS_LABEL.under_review}</option>
        <option value="inactive">{VENDOR_STATUS_LABEL.inactive}</option>
      </select></Field>}
      <Field label="Renews on" htmlFor={id("renews")}><input id={id("renews")} className={control} type="date" value={draft.renews_on} onChange={set("renews_on")} /></Field>
      <Field label="Contact name" htmlFor={id("contact")}><input id={id("contact")} className={control} value={draft.contact_name} onChange={set("contact_name")} maxLength={120} placeholder="Tom Reilly" /></Field>
      <Field label="Contact email" htmlFor={id("email")}><input id={id("email")} className={control} type="email" value={draft.contact_email} onChange={set("contact_email")} maxLength={200} placeholder="accounts@apexdata.io" /></Field>
      <Field label="Contact phone" htmlFor={id("phone")}><input id={id("phone")} className={control} type="tel" value={draft.contact_phone} onChange={set("contact_phone")} maxLength={40} placeholder="(555) 010-2030" /></Field>
      <Field label="Terms" htmlFor={id("terms")} className="col-span-full"><input id={id("terms")} className={control} value={draft.terms} onChange={set("terms")} maxLength={2000} placeholder="Net 15, credits disconnects and DNC within the window" /></Field>
      <Field label="Notes" htmlFor={id("notes")} className="col-span-full"><textarea id={id("notes")} className={`${control} min-h-16 py-2`} value={draft.notes} onChange={set("notes")} maxLength={2000} placeholder="Anything your team should know about this vendor" /></Field>
    </div>}
  </div>;
}

/** Asks before a close drops what was typed. */
async function closeUnlessKept(dirty: boolean, what: string, close: () => void) {
  if (dirty && !(await confirmAction({ title: "Discard your changes?", description: `You changed ${what} and have not saved it yet.`, confirmLabel: "Discard changes" }))) return;
  close();
}

/** The New vendor form, in a dialog. Opened by the toolbar's "New vendor". */
export function NewVendorPanel({ onClose, onCreated }: { onClose: () => void; onCreated: (vendor: { id: string; name: string } | null) => Promise<unknown> | void }) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(EMPTY_DRAFT);

  async function createVendor() {
    if (saving) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/app/vendors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payloadOf(draft)) });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        // Said where the form is, not as a fading toast: a taken name (409) is fixed in the Name field,
        // and a 503 is "the database is behind".
        setError(body?.error ?? (response.status === 503 ? "This setting needs a database update that has not been applied yet." : "Could not create this vendor"));
        return;
      }
      notify.done(`${body.vendor.name} added`);
      onClose();
      await onCreated(body?.vendor?.id ? { id: String(body.vendor.id), name: String(body.vendor.name) } : null);
    } catch {
      setError("The connection dropped. Nothing was saved — try again.");
    } finally { setSaving(false); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open) void closeUnlessKept(dirty, "the new vendor", onClose); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>New Vendor</DialogTitle></DialogHeader>
      <VendorFields draft={draft} onChange={setDraft} idPrefix="new-vendor" mode="create" />
      {error && <p className="m-0 text-sm text-[var(--error-ink)]" role="alert">{error}</p>}
      <LeaveGuard dirty={dirty} onDiscard={() => setDraft(EMPTY_DRAFT)} what="the new vendor" />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => void closeUnlessKept(dirty, "the new vendor", onClose)}>Cancel</Button>
        <Button type="button" disabled={!draft.name.trim() || saving} onClick={() => void createVendor()}>{saving ? "Saving…" : "Add vendor"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

/** "3 days left", "closes today". */
export function daysLeft(days: number) {
  return days <= 0 ? "closes today" : days === 1 ? "closes tomorrow" : `${plural(days, "day")} left`;
}

/** The trial sentence: what the vendor has, and what it needs before it is ranked. */
export function trialText(facts: VendorCardFacts) {
  const campaigns = facts.campaign_count ?? 0;
  const leads = facts.lead_count ?? 0;
  const threshold = facts.trial_lead_threshold;
  const needs = [campaigns <= 1 ? "a second campaign" : null, leads < threshold ? `${(threshold - leads).toLocaleString()} more leads` : null].filter(Boolean).join(" and ");
  const policies = facts.issued_policies;
  const sensitivity = facts.one_more_sale_moves_cents === null ? ""
    : policies === 0 ? ` The first sale would put its cost per policy at ${money(facts.one_more_sale_moves_cents)}.`
    : ` One more sale would move its cost per policy by ${money(facts.one_more_sale_moves_cents)}.`;
  return `${plural(campaigns, "campaign")}, ${plural(leads, "lead")}${policies !== null ? `, ${plural(policies, "policy", "policies")} so far` : ""}. Not ranked or flagged until it has ${needs}.${sensitivity}`;
}

/** The drop facts as one sentence, with the renewal date. Facts only — nothing is paused. */
export function dropText(facts: VendorCardFacts) {
  if (!facts.drop) return "";
  const text = facts.drop.reasons.map((reason) => reason.text).join("; ");
  const renews = calendarDate(facts.drop.renews_on);
  return `${text.charAt(0).toUpperCase() + text.slice(1)}. ${renews ? `Renewal is on ${renews}.` : "No renewal date recorded."}`;
}

/** GET /api/app/vendors/cards, refetched whenever the page reloads its rollup (a spend edit changes cost per policy and trialling). */
export function useVendorCards(rollup: unknown) {
  const [facts, setFacts] = useState<VendorCardsResponse | null>(null);
  const [factsError, setFactsError] = useState<string | null>(null);
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
  return { facts, factsError };
}

/**
 * A vendor's signals as coloured chips with icons (owner 2026-10-28: icons, not sentences): under
 * review, inactive, trialling, credit claimable with its days left, facts to weigh before renewal.
 * `compact` keeps only the icon and the figure, for the vendor list; the meaning is in the title.
 */
export function VendorSignals({ vendorId, status, fact, compact = false }: { vendorId: string; status: string; fact: VendorCardFacts | undefined; compact?: boolean }) {
  const icon = "size-3";
  return <span className="flex flex-wrap items-center gap-1">
    {status === "under_review" && <StatusChip tone="warning" dot={false} title={VENDOR_STATUS_LABEL.under_review}><Eye className={icon} aria-hidden="true" />{compact ? <span className="sr-only">{VENDOR_STATUS_LABEL.under_review}</span> : VENDOR_STATUS_LABEL.under_review}</StatusChip>}
    {status === "inactive" && <StatusChip tone="neutral" dot={false} title={VENDOR_STATUS_LABEL.inactive}><Ban className={icon} aria-hidden="true" />{compact ? <span className="sr-only">{VENDOR_STATUS_LABEL.inactive}</span> : VENDOR_STATUS_LABEL.inactive}</StatusChip>}
    {fact?.trialling && status !== "inactive" && <StatusChip tone="info" dot={false} title={`Trialling: ${trialText(fact)}`}><FlaskConical className={icon} aria-hidden="true" />{compact ? <span className="sr-only">Trialling</span> : "Trialling"}</StatusChip>}
    {/* Compact sits inside the vendor list's button, so it is the chip alone; the link is on the scorecard. */}
    {fact?.claimable && (compact
      ? <StatusChip tone="danger" dot={false} className="tabular-nums" title={`${money(fact.claimable.cents)} claimable, ${daysLeft(fact.claimable.days_left)}`}><Clock className={icon} aria-hidden="true" />{Math.max(0, fact.claimable.days_left)}d</StatusChip>
      : <a className="rounded-badge outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring" href={`/app/vendor-returns?vendor=${vendorId}`} onClick={(event) => event.stopPropagation()} title={`${plural(fact.claimable.rows, "row")} at the campaign's purchased rate — claim it now`}>
        <StatusChip tone="danger" dot={false} className="tabular-nums"><Clock className={icon} aria-hidden="true" />{money(fact.claimable.cents)} claimable, {daysLeft(fact.claimable.days_left)}</StatusChip>
      </a>)}
    {fact?.drop && <StatusChip tone="danger" dot={false} title={`Facts to weigh: ${dropText(fact)}`}><AlertTriangle className={icon} aria-hidden="true" />{compact ? <span className="sr-only">Facts to weigh</span> : "Facts to weigh"}</StatusChip>}
  </span>;
}

/**
 * A vendor's read-only facts, behind the scorecard's Details: money to claim back, the drop facts,
 * contact, unit price, return window, renewal, speed to lead by campaign, terms and notes.
 */
export function VendorFacts({ vendor, row, fact }: { vendor: RosterRollup | undefined; row: RosterVendor; fact: VendorCardFacts | undefined }) {
  const contact = contactOf(row);
  const returnDays = vendor?.return_window_days ?? row.return_window_days;
  return <div className="flex flex-col gap-3">
    {fact?.claimable && <FactLine icon={<Clock className="mt-0.5 size-4 shrink-0 text-[var(--error-ink)]" aria-hidden="true" />}>
      <p className="m-0 tabular-nums"><strong className="font-semibold">{money(fact.claimable.cents)} claimable, {daysLeft(fact.claimable.days_left)}.</strong> {plural(fact.claimable.rows, "row")} at the campaign&rsquo;s purchased rate. <a className="font-semibold text-[var(--accent-ink)] hover:underline" href={`/app/vendor-returns?vendor=${row.id}`}>Claim it now</a></p>
    </FactLine>}
    {fact?.drop && <FactLine icon={<AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--error-ink)]" aria-hidden="true" />}>
      <p className="m-0 tabular-nums">{dropText(fact)} <span className="text-[var(--muted)]">Facts to weigh — nothing is paused automatically.</span></p>
    </FactLine>}
    <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
      <div className="col-span-2"><dt className="text-xs text-[var(--muted)]">Contact</dt><dd className="m-0 mt-0.5 break-words text-[var(--ink)]">{contact.name || contact.email || contact.phone
        ? <>{[contact.name, contact.phone].filter(Boolean).join(" · ")}{contact.email ? <>{contact.name || contact.phone ? " · " : ""}<a className="text-[var(--accent-ink)] hover:underline" href={`mailto:${contact.email}`}>{contact.email}</a></> : null}</>
        : "—"}</dd></div>
      <div><dt className="text-xs text-[var(--muted)]">Unit price</dt><dd className="m-0 mt-0.5 tabular-nums text-[var(--ink)]">{vendor?.cost_per_record_cents != null ? `${money2(vendor.cost_per_record_cents)} per record` : "—"}</dd></div>
      <div><dt className="text-xs text-[var(--muted)]">Return window</dt><dd className="m-0 mt-0.5 text-[var(--ink)]">{returnDays > 0 ? plural(returnDays, "day") : "No returns agreed"}{fact?.claimable ? ` · soonest claimable ${daysLeft(fact.claimable.days_left)}` : ""}</dd></div>
      <div><dt className="text-xs text-[var(--muted)]">Renews on</dt><dd className="m-0 mt-0.5 text-[var(--ink)]">{calendarDate(row.renews_on ?? fact?.renews_on) ?? "—"}</dd></div>
      {row.terms && <div className="col-span-2 sm:col-span-3"><dt className="text-xs text-[var(--muted)]">Terms</dt><dd className="m-0 mt-0.5 text-[var(--body)]">{row.terms}</dd></div>}
      {row.notes && <div className="col-span-full"><dt className="text-xs text-[var(--muted)]">Notes</dt><dd className="m-0 mt-0.5 text-[var(--body)]">{row.notes}</dd></div>}
    </dl>
    <CampaignSpeedToLead vendorId={row.id} />
  </div>;
}

/** The "Compare vendors" view: every vendor side by side, figures coloured good / worth a look / bad. */
export function VendorRoster({ vendors, rollup, speed, consent, facts, factsError, usableReference, actions, onChanged, onShowCampaigns, onEdit, onDelete, deleting = false }: {
  /** The agency's cost per dialable lead, the reference a vendor's per-usable figure is coloured against. */
  usableReference: number | null;
  vendors: RosterVendor[];
  rollup: RosterRollup[];
  speed: RosterSpeed[];
  consent: RosterConsent[];
  facts: VendorCardsResponse | null;
  factsError: string | null;
  /** New vendor / New campaign, drawn just before Refresh. */
  actions?: ReactNode;
  /** Reload the page's vendors and campaigns. */
  onChanged: () => Promise<unknown> | void;
  /** A row opens that vendor's scorecard (its details, Edit and Order another) and its campaigns. */
  onShowCampaigns: (vendorId: string) => void;
  /** The row's pen: that vendor's edit form. */
  onEdit: (vendorId: string) => void;
  /** The row's bin: the shared delete confirm (campaigns/delete-vendor.tsx). */
  onDelete: (vendor: RosterRollup) => void;
  deleting?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try { await onChanged(); } finally { setRefreshing(false); }
  }

  const vendorById = useMemo(() => new Map(vendors.map((vendor) => [vendor.id, vendor])), [vendors]);
  const speedByVendor = useMemo(() => new Map(speed.map((row) => [row.vendor_id, row])), [speed]);
  const consentByVendor = useMemo(() => new Map(consent.map((row) => [row.vendor_id, row])), [consent]);
  const factsByVendor = useMemo(() => new Map((facts?.cards ?? []).map((row) => [row.vendor_id, row])), [facts]);

  const best = facts?.best ?? null;
  const query = search.trim().toLowerCase();
  const matching = query ? rollup.filter((vendor) => vendor.vendor_name.toLowerCase().includes(query)) : rollup;
  const { current, rows: shown } = paginate(matching, page, 25);

  return <TableCard
    className="flex min-h-0 flex-1 flex-col [&>div.overflow-x-auto]:min-h-0 [&>div.overflow-x-auto]:flex-1 [&>div.overflow-x-auto]:overflow-y-auto"
    toolbar={<DataToolbar actions={<>{query && <ClearFiltersButton onClick={() => { setSearch(""); setPage(1); }} />}{actions}<RefreshButton onClick={() => void refresh()} refreshing={refreshing} /></>}>
      <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search vendors" className="sm:w-56" />
      <InfoTip label="What the colours mean">{TONE_KEY}</InfoTip>
    </DataToolbar>}
    footer={<>
      {matching.length > 0 ? <Pager page={current} total={matching.length} noun={matching.length === 1 ? "vendor" : "vendors"} onPage={setPage} pageSize={25} /> : <span />}
      {(factsError || (facts?.pending.length ?? 0) > 0) && <span role="status" title={factsError ?? undefined}>{factsError ? "Refresh to load cost per policy and returns." : facts?.pending.map((item) => item.detail).join(" ")}</span>}
    </>}
  >
    {matching.length === 0 ? <NoMatches noun="vendors" onClear={() => { setSearch(""); setPage(1); }} /> : <Table className="[&_td]:text-[var(--body)]">
      <TableHeader><TableRow>
        <TableHead scope="col">Vendor</TableHead>
        <TableHead scope="col">Type</TableHead>
        <TableHead scope="col" className="text-center">Campaigns</TableHead>
        <TableHead scope="col" className="text-center">Spend</TableHead>
        <TableHead scope="col" className="text-center">Purchased</TableHead>
        <TableHead scope="col" className="text-center">Rejected</TableHead>
        <TableHead scope="col" className="text-center">Per usable</TableHead>
        <TableHead scope="col" className="text-center">Cost / issued</TableHead>
        <TableHead scope="col" className="text-center">Median to dial</TableHead>
        <TableHead scope="col" className="text-center">Under 60s</TableHead>
        <TableHead scope="col" className="text-center">Consent claimed</TableHead>
        <TableHead scope="col">Signals</TableHead>
        <TableHead scope="col"><span className="sr-only">Actions</span></TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {shown.map((vendor) => {
          const fast = speedByVendor.get(vendor.vendor_id);
          const certificates = consentByVendor.get(vendor.vendor_id);
          const row = vendorById.get(vendor.vendor_id);
          const fact = factsByVendor.get(vendor.vendor_id);
          const status = row?.status ?? vendor.status;
          const category = row?.category ?? fact?.category ?? null;
          const isBest = Boolean(best && best.vendor_id === vendor.vendor_id);
          const costFlagged = fact?.drop?.reasons.some((reason) => reason.key === "cost") ?? false;
          // A trialling vendor is not ranked, so its cost per policy is never coloured.
          const policyTone = !fact || fact.trialling ? null : isBest ? "good" : costFlagged ? "danger" : costTone(fact.cost_per_policy_cents, best?.cost_per_policy_cents);
          // Consent is judged only where the leads should carry a certificate: real-time posts.
          const consentTone = certificates && vendor.lead_type === "realtime" ? highIsGood(certificates.claimed_coverage_pct, 90, 50) : null;
          const type = `${category ? `${category} · ` : ""}${LEAD_TYPE[vendor.lead_type] ?? vendor.lead_type}`;
          return <TableRow key={vendor.vendor_id} className="portal-campaigns-row" onClick={() => onShowCampaigns(vendor.vendor_id)}>
            <TableCell className="max-w-[240px]">
              <button type="button" className="portal-campaigns-name block max-w-full truncate" title={`${vendor.vendor_name} — its scorecard and campaigns`} onClick={(event) => { event.stopPropagation(); onShowCampaigns(vendor.vendor_id); }}>{vendor.vendor_name}</button>
            </TableCell>
            <TableCell className="max-w-[180px] truncate" title={type}>{type}</TableCell>
            <TableCell className="text-center tabular-nums">{vendor.active_campaign_count} of {vendor.campaign_count} active</TableCell>
            <TableCell className="text-center tabular-nums">{money(vendor.total_spend_cents)}</TableCell>
            <TableCell className="text-center tabular-nums">{vendor.records_purchased.toLocaleString()}</TableCell>
            <TableCell className={cn("text-center tabular-nums", toneText(rejectedTone(vendor.records_rejected, vendor.records_purchased)))}>{count(vendor.records_rejected)}</TableCell>
            <TableCell className={cn("text-center tabular-nums", toneText(costTone(vendor.cost_per_usable_record_cents, usableReference)))}>{money2(vendor.cost_per_usable_record_cents)}</TableCell>
            <TableCell className={cn("text-center tabular-nums", toneText(policyTone))} title={fact?.trialling ? "Not ranked: still trialling" : isBest ? "Lowest cost per issued policy of the ranked vendors" : undefined}>
              {fact ? money2(fact.cost_per_policy_cents) : "—"}
            </TableCell>
            <TableCell className={cn("text-center tabular-nums", fast?.posted_leads ? toneText(speedTone(fast.median_seconds)) : undefined)}>{fast?.posted_leads ? duration(fast.median_seconds) : "—"}</TableCell>
            <TableCell className={cn("text-center tabular-nums", fast?.posted_leads ? toneText(highIsGood(fast.dialled_within_60s_pct, 80, 50)) : undefined)}>{fast?.posted_leads ? percent(fast.dialled_within_60s_pct) : "—"}</TableCell>
            <TableCell className={cn("text-center tabular-nums", toneText(consentTone))}>{certificates ? percent(certificates.claimed_coverage_pct) : "—"}</TableCell>
            <TableCell className="whitespace-nowrap"><VendorSignals vendorId={vendor.vendor_id} status={status} fact={fact} /></TableCell>
            <TableCell className="whitespace-nowrap text-center"><RowActions what="vendor" name={vendor.vendor_name} onEdit={() => onEdit(vendor.vendor_id)} onDelete={() => onDelete(vendor)} deleteDisabled={deleting} /></TableCell>
          </TableRow>;
        })}
      </TableBody>
    </Table>}
  </TableCard>;
}

/**
 * A vendor's edit form, alone, in the overlay panel (the scorecard's Edit). The read-only facts live
 * in the scorecard's Details; Order another is on the scorecard, once.
 */
export function VendorSheet({ vendor, row, onClose, onChanged, onDelete, deleting = false }: {
  vendor: RosterRollup;
  row: RosterVendor | undefined;
  onClose: () => void;
  onChanged: () => Promise<unknown> | void;
  /** "Delete vendor": the page's shared confirm (campaigns/delete-vendor.tsx), which closes this on success. */
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const [initial] = useState<Draft | null>(() => (row ? draftOf(row) : null));
  const [draft, setDraft] = useState<Draft | null>(initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const formId = useId();
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  async function saveVendor(): Promise<boolean> {
    if (!draft || saving) return false;
    setSaving(true); setSaveError(null);
    try {
      const response = await fetch("/api/app/vendors", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: vendor.vendor_id, ...payloadOf(draft) }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 503) setSaveError(body?.error ?? "This setting needs a database update that has not been applied yet.");
        else notify.block(body?.error ?? "Could not save this vendor");
        return false;
      }
      notify.done(`${body.vendor.name} saved`);
      onClose();
      await onChanged();
      return true;
    } finally { setSaving(false); }
  }

  const name = row?.name ?? vendor.vendor_name;
  // Said beside the edit, from the draft: choosing "Under review" is when the reader needs it.
  const warning = draft ? vendorCampaignWarning(draft.status, name) : null;
  const close = () => void closeUnlessKept(dirty, name, onClose);
  return <DetailPanel mode="overlay" title={`Edit ${name}`} onClose={close}
    footer={draft ? <div className="flex w-full flex-wrap items-center justify-end gap-2">
      {onDelete && <Button type="button" variant="ghost" className="mr-auto text-[var(--error-ink)] hover:bg-[var(--error-surface)] hover:text-[var(--error-ink)]" disabled={saving || deleting} onClick={onDelete}><Trash2 aria-hidden="true" />Delete vendor</Button>}
      <Button type="button" variant="outline" onClick={close}>Cancel</Button>
      <Button type="submit" form={formId} disabled={!draft.name.trim() || saving || !dirty}>{saving ? "Saving…" : "Save vendor"}</Button>
    </div> : undefined}>
    {draft ? <form id={formId} className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void saveVendor(); }}>
      <VendorFields draft={draft} onChange={setDraft} idPrefix={`vendor-${vendor.vendor_id}`} mode="edit" />
      {warning && <p className="m-0 text-sm text-[var(--warning-ink)]">{warning}</p>}
      {saveError && <p className="m-0 text-sm text-[var(--error-ink)]" role="alert">{saveError}</p>}
    </form> : <p className="m-0 text-sm text-[var(--body)]">This vendor could not be found. Refresh the page.</p>}
    <LeaveGuard dirty={dirty} onSave={saveVendor} onDiscard={() => setDraft(initial)} what={name} />
  </DetailPanel>;
}

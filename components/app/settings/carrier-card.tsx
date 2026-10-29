"use client";

/**
 * Settings › Carriers › one carrier (owner, 2026-10-27: "one carrier, one place"). Carrier details is
 * folded in here, so everything about a carrier sits on its card:
 *
 * - To finish: the three things a carrier needs before it can be sold (contract + writing number,
 *   at least one product, at least one appointed state), plus the optional portal login. Shown until
 *   all three are done; the list on the left shows the same progress.
 * - Contract: level, start date and writing number (tenant_carriers). The writing number moved here
 *   from the Rate card; a contract row cannot be saved without one, so the first save starts it.
 * - Your portal login (LA-3.22): username, MFA, when it was last checked, a note. Never a password.
 * - Carrier facts, set by Insurvas: portal address, policy number format, bank statement text,
 *   payment methods, field set and extension map — read-only. "Something wrong? Tell us" saves a
 *   report to Insurvas's queue (admin console › Fact reports, 20261027200000). A value the agency set for itself
 *   before 2026-10-27 shows as "Your value" next to Insurvas's until Insurvas confirms it. A missing
 *   fact never blocks: the format check is skipped and the welcome pack shows a dash.
 * - Products: tick the ones you sell. Products the agency made itself stay, under Your products.
 *   The per-product price band is edited in Quote & QA rules.
 */

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { control } from "@/components/app/settings/primitives";
import { copyUsername, openPortal } from "@/components/app/settings/sales/carriers-portal";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusChip } from "@/components/ui/status-chip";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { PAYMENT_METHOD_LABEL } from "@/lib/applications/constants";
import { PORTAL_MFA_LABEL, PORTAL_MFA_TYPES } from "@/lib/salesSettings/portalSchemas";
import type { TenantCarrierRow } from "@/lib/carriers/service";
import { bpToLevel, todayIso } from "@/lib/appointments/tickModel";
import type { CarrierFacts, CarrierProductView, FieldMapChip, PortalAccountView, ProductLine, SalesCarrierView } from "@/lib/salesSettings/views";
import { FACT_REPORT_LABEL, type FactReportKey, type FactReportView } from "@/lib/carriers/factReportConstants";

const KICKER = "flex items-center gap-1 text-xs leading-[1.33] font-semibold tracking-[0.04em] uppercase text-[var(--muted)]";
const FIELD = "flex flex-col gap-1.5 text-xs font-semibold text-[var(--muted)]";
const SUPPORT = "support@insurvas.com";
const MAP_LABEL: Record<FieldMapChip["status"], string> = {
  published: "Fills the application", draft: "Map in draft", needs_review: "Map needs review", none: "No map yet · fill by hand",
};

async function send(url: string, method: string, body?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  return response.ok ? { ok: true, data } : { ok: false, error: (data as { error?: string } | null)?.error ?? "That could not be saved" };
}

/** The whole product as the products route takes it; only `is_active` or the band ever changes from here. */
export function productBody(p: CarrierProductView, patch: { isActive?: boolean; bandMin?: string | null; bandMax?: string | null } = {}) {
  return {
    product_code: p.productCode, name: p.name, tiers: p.tiers, issue_age_min: p.issueAgeMin, issue_age_max: p.issueAgeMax,
    face_min_cents: p.faceMinCents, face_max_cents: p.faceMaxCents,
    band_min: patch.bandMin === undefined ? p.bandMin : patch.bandMin, band_max: patch.bandMax === undefined ? p.bandMax : patch.bandMax,
    accepted_payment_methods: p.acceptedPaymentMethods, is_active: patch.isActive ?? p.isActive, term_lengths: p.termLengths, health_classes: p.healthClasses,
    exam_required_above_face_cents: p.examAboveFaceCents, convertible: p.convertible, conversion_deadline_rule: p.conversionDeadlineRule, renewal_type: p.renewalType,
  };
}

/**
 * Save a change to a product. An Insurvas product is read-only, so the agency's own copy carries the
 * change (it replaces the Insurvas row for this agency only).
 */
export async function saveProduct(product: CarrierProductView, patch: Parameters<typeof productBody>[1]): Promise<boolean> {
  let target = product;
  if (!product.tenantOwned) {
    const copy = await send(`/api/app/settings/sales/products/${product.id}/copy`, "POST");
    if (!copy.ok) { notify.block(copy.error); return false; }
    target = (copy.data as { product: CarrierProductView }).product;
  }
  const result = await send(`/api/app/settings/sales/products/${target.id}`, "PATCH", productBody(target, patch));
  if (!result.ok) { notify.block(result.error); return false; }
  return true;
}

/* ── what is left to set up ─────────────────────────────────────────────────────────────────── */

export type CarrierProgress = { contract: boolean; products: boolean | null; states: boolean; done: number; total: number; ready: boolean };

/**
 * The checks behind To finish and the list's "2 of 3 done". Products count only where Applications is
 * on and Insurvas has products for the carrier: a carrier with none yet is Insurvas's gap, and must not
 * keep the agency from selling it.
 */
export function carrierProgress(contract: TenantCarrierRow | null, sales: SalesCarrierView | null, salesAvailable: boolean, states: string[]): CarrierProgress {
  const products = salesAvailable && sales && sales.products.length > 0 ? sales.products.some((p) => p.isActive) : null;
  const checks = [Boolean(contract), products, states.length > 0].filter((value): value is boolean => value !== null);
  const done = checks.filter(Boolean).length;
  return { contract: Boolean(contract), products, states: states.length > 0, done, total: checks.length, ready: done === checks.length };
}

export function ProgressLine({ progress, switchedOff }: { progress: CarrierProgress; switchedOff: boolean }) {
  if (switchedOff) return <span className="block truncate text-xs text-[var(--muted)]">Switched off</span>;
  if (progress.ready) return <span className="block text-xs font-semibold text-[var(--accent-ink)]">✓ Ready to sell</span>;
  return (
    <span className="flex items-center gap-2 text-xs font-semibold text-[var(--warning-ink)]">
      <span className="flex gap-0.5" aria-hidden="true">
        {Array.from({ length: progress.total }, (_, i) => <span key={i} className={cn("h-1 w-4 rounded-full", i < progress.done ? "bg-[var(--primary)]" : "bg-[var(--border-strong)]")} />)}
      </span>
      {progress.done} of {progress.total} done
    </span>
  );
}

function jumpTo(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  const focusable = element.matches("input, select, button") ? element : element.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), button:not([disabled])");
  (focusable as HTMLElement | null)?.focus({ preventScroll: true });
}

function ToFinish({ name, progress, hasLogin, ids }: { name: string; progress: CarrierProgress; hasLogin: boolean; ids: { contract: string; products: string; states: string; login: string } }) {
  const items: { key: string; title: string; why: string; done: boolean; optional?: boolean; target: string }[] = [
    { key: "contract", title: "Contract level and writing number", why: "Every commission figure is worked out from these.", done: progress.contract, target: ids.contract },
    ...(progress.products === null ? [] : [{ key: "products", title: "Products you sell", why: "Tick at least one. Only ticked products show when you quote.", done: progress.products, target: ids.products }]),
    { key: "states", title: "States you’re appointed in", why: "An application in a state you didn’t tick gets a warning.", done: progress.states, target: ids.states },
    { key: "login", title: "Your portal login · optional", why: "Open portal works without it; with it, the username is copied for you.", done: hasLogin, optional: true, target: ids.login },
  ];
  const next = items.find((item) => !item.done && !item.optional)?.key;
  let n = 0;
  return (
    <section aria-label={`To finish ${name}`} className="flex flex-col gap-1 rounded-[12px] border border-[color-mix(in_srgb,var(--primary)_30%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_4%,transparent)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-1.5">
        <h4 className="m-0 text-sm font-semibold text-[var(--ink)]">To finish {name}</h4>
        <ProgressLine progress={progress} switchedOff={false} />
      </div>
      {items.map((item) => {
        if (!item.optional) n += 1;
        const now = item.key === next;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => jumpTo(item.target)}
            className={cn("flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left hover:bg-[var(--surface-alt)]", now && "bg-[var(--primary-soft)] hover:bg-[var(--primary-soft)]")}
          >
            <span
              aria-hidden="true"
              className={cn(
                "grid size-[22px] shrink-0 place-items-center rounded-full text-xs font-bold",
                item.done ? "bg-[var(--primary)] text-[var(--on-primary)]"
                  : item.optional ? "border-[1.5px] border-dashed border-[var(--border-strong)]"
                    : now ? "border-2 border-[var(--primary)] text-[var(--accent-ink)]" : "border-[1.5px] border-[var(--border-strong)] text-[var(--body)]",
              )}
            >
              {item.done ? "✓" : item.optional ? "" : n}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block text-sm font-semibold text-[var(--ink)]", item.done && "text-[var(--muted)] line-through")}>{item.title}</span>
              <span className="block text-xs text-[var(--muted)]">{item.done ? (item.optional ? "Saved." : "Done.") : item.why}</span>
            </span>
            {!item.done && <span className={cn("shrink-0 text-xs font-semibold", now ? "text-[var(--accent-ink)]" : "text-[var(--body)]")}>{now ? "Fill in ↓" : "Go to it ↓"}</span>}
          </button>
        );
      })}
    </section>
  );
}

/* ── the card ───────────────────────────────────────────────────────────────────────────────── */

export function CarrierCard({ carrier, dot, contract, switchedOff, states, sales, salesAvailable, productLines, canEdit, reports, reportsAvailable, onSetStates, onSaved, className }: {
  carrier: { id: string; name: string };
  dot: string;
  contract: TenantCarrierRow | null;
  switchedOff: boolean;
  states: string[];
  sales: SalesCarrierView | null;
  salesAvailable: boolean;
  productLines: ProductLine[];
  canEdit: boolean;
  /** This carrier's reports to Insurvas, newest first (20261027200000). */
  reports: FactReportView[];
  /** False until the reports migration is applied: Tell us then writes an email instead. */
  reportsAvailable: boolean;
  onSetStates: () => void;
  onSaved: () => Promise<void>;
  className?: string;
}) {
  const ids = { contract: `carrier-${carrier.id}-level`, products: `carrier-${carrier.id}-products`, states: `carrier-${carrier.id}-states`, login: `carrier-${carrier.id}-login` };
  const progress = carrierProgress(contract, sales, salesAvailable, states);

  async function setSwitch(next: boolean) {
    const result = await send("/api/app/carrier-library/tenant-carriers", "PATCH", { carrier_id: carrier.id, contracted: next });
    if (!result.ok) { notify.block(result.error); return; }
    notify.done(next ? `${carrier.name} is switched back on` : `${carrier.name} is switched off: no new quotes, applications or leads for it`);
    await onSaved();
  }

  return (
    // The card scrolls inside the pane; its parts keep their height instead of shrinking to fit it.
    <div className={cn("flex min-h-0 flex-col gap-4 border-[color-mix(in_srgb,var(--primary)_30%,var(--border))] p-5 [&>*]:shrink-0", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="flex items-center gap-2.5"><span className={cn("size-3 rounded-full", dot)} aria-hidden="true" /><h3 className="m-0 text-title-sm font-semibold tracking-[-0.015em] text-[var(--ink)]">{carrier.name}</h3></span>
          <p className={cn("m-0 mt-1 text-xs", states.length ? "text-[var(--muted)]" : "text-[var(--warning-ink)]")}>
            {switchedOff ? "Switched off: no new quotes, applications or leads" : states.length ? `Appointed in ${states.length} state${states.length === 1 ? "" : "s"} · ${states.slice(0, 6).join(", ")}${states.length > 6 ? "…" : ""}` : "Not appointed in any state yet"}
          </p>
        </div>
        {!switchedOff && <StatusChip tone={progress.ready ? "good" : "warning"}>{progress.ready ? "Ready to sell" : "Not ready to sell"}</StatusChip>}
      </div>

      {!progress.ready && !switchedOff && <ToFinish name={carrier.name} progress={progress} hasLogin={Boolean(sales?.portal)} ids={ids} />}

      <section id={ids.contract} aria-label="Contract" className="flex flex-col gap-1.5">
        <span className={KICKER}>Contract</span>
        {contract ? (
          <p className="m-0 text-sm text-[var(--body)]">{bpToLevel(contract.contract_level_bp)}% level · contracted from {contract.effective_from} · writing number {contract.writing_number}</p>
        ) : (
          <p className="m-0 text-sm text-[var(--muted)]">Add your contract level, start date and writing number in the carrier list. These details stay optional until you have them.</p>
        )}
      </section>

      {salesAvailable && sales && (<>
        <div className="h-px bg-[var(--border)]" />
        <PortalSection key={sales.portal?.id ?? "none"} carrier={sales} writingNumber={contract?.writing_number ?? null} canEdit={canEdit} anchor={ids.login} onSaved={onSaved} />
        <div className="h-px bg-[var(--border)]" />
        <FactsAndProducts carrier={sales} productLines={productLines} canEdit={canEdit} anchor={ids.products} reports={reports} reportsAvailable={reportsAvailable} onSaved={onSaved} />
      </>)}
      {salesAvailable && !sales && <p className="m-0 text-sm text-[var(--muted)]">This carrier’s products and facts appear here once its contract is saved.</p>}

      <div id={ids.states} className="flex flex-wrap items-center gap-1.5">
        <span className={cn(KICKER, "mr-1")}>Appointed states</span>
        {states.length === 0 && <span className="mr-1 text-sm text-[var(--muted)]">None yet</span>}
        {states.map((code) => <span key={code} className="inline-flex h-7 items-center rounded-full bg-[var(--primary-soft)] px-2.5 text-xs font-semibold text-[var(--accent-ink)]">{code}</span>)}
        <button type="button" onClick={onSetStates} className="inline-flex h-8 items-center rounded-full border border-[var(--border-strong)] px-3 text-xs font-semibold text-[var(--body)] hover:border-[var(--accent-ink)]">Set states →</button>
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
        <span className="text-xs text-[var(--muted)]">Saved as you change it</span>
        {canEdit && (
          <Button type="button" variant="ghost" size="sm" onClick={() => void setSwitch(switchedOff)} className={switchedOff ? undefined : "text-[var(--error-ink)]"}>
            {switchedOff ? "Sell this carrier again" : "Stop selling this carrier"}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ── portal login ───────────────────────────────────────────────────────────────────────────── */

const httpsUrl = (value: string) => {
  const text = value.trim();
  if (!text) return null;
  return /^https:\/\//i.test(text) ? text : `https://${text.replace(/^http:\/\//i, "")}`;
};

function PortalSection({ carrier, writingNumber, canEdit, anchor, onSaved }: { carrier: SalesCarrierView; writingNumber: string | null; canEdit: boolean; anchor: string; onSaved: () => Promise<void> }) {
  const account = carrier.portal;
  const fallback = carrier.effective.portalOrigin;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => ({
    portalUrl: account?.portalUrl ?? fallback ?? "",
    username: account?.username ?? "",
    mfaType: account?.mfaType ?? ("app" as PortalAccountView["mfaType"]),
    lastVerifiedOn: account?.lastVerifiedAt ? account.lastVerifiedAt.slice(0, 10) : "",
    notes: account?.notes ?? "",
  }));
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const openUrl = httpsUrl(account?.portalUrl ?? fallback ?? "");

  async function save() {
    const url = httpsUrl(draft.portalUrl);
    if (!url) { notify.block("Add the portal’s address first."); return; }
    setBusy(true);
    const result = await send("/api/app/settings/sales/portals", "PUT", {
      carrier_id: carrier.id, portal_url: url, username: draft.username.trim() || null, writing_number: writingNumber,
      mfa_type: draft.mfaType, notes: draft.notes.trim() || null, last_verified_on: draft.lastVerifiedOn || null,
    });
    setBusy(false);
    if (!result.ok) { notify.block(result.error); return; }
    notify.done(`${carrier.name} login saved`);
    setEditing(false);
    await onSaved();
  }

  async function remove() {
    if (!account) return;
    setBusy(true);
    const result = await send(`/api/app/settings/sales/portals?id=${encodeURIComponent(account.id)}`, "DELETE");
    setBusy(false);
    setConfirmRemove(false);
    if (!result.ok) { notify.block(result.error); return; }
    notify.done(`${carrier.name} login removed`, { detail: "Open portal goes to the carrier’s sign-in page instead." });
    setEditing(false);
    await onSaved();
  }

  const openButtons = (
    <span className="flex shrink-0 flex-wrap gap-2">
      {openUrl && <Button type="button" variant="outline" size="sm" onClick={() => void openPortal(openUrl, account?.username ?? null)}>Open portal</Button>}
      {account?.username && <Button type="button" variant="outline" size="sm" onClick={() => void copyUsername(account.username!)}>Copy username</Button>}
    </span>
  );

  return (
    <section id={anchor} aria-label="Your portal login" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className={KICKER}>Your portal login</span>
        {account && !editing && canEdit && <button type="button" onClick={() => setEditing(true)} className="text-sm font-semibold text-[var(--accent-ink)] hover:underline">Edit</button>}
      </div>
      {!editing && account && (<>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-[var(--surface-alt)] px-3.5 py-3">
          <dl className="m-0 grid min-w-0 flex-1 grid-cols-3 gap-3">
            <Fact label="Username" value={account.username ?? "Not saved"} />
            <Fact label="Sign-in check" value={PORTAL_MFA_LABEL[account.mfaType]} />
            <Fact label="Last checked" value={account.lastVerifiedAt ? new Date(account.lastVerifiedAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "Not yet"} warn={account.needsCheck} />
          </dl>
          {openButtons}
        </div>
        <p className="m-0 text-xs text-[var(--muted)]">Open portal copies the username and opens the sign-in page. The password stays in your password manager.{account.notes ? ` Note: ${account.notes}` : ""}</p>
      </>)}
      {!editing && !account && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-dashed border-[var(--border-strong)] px-3.5 py-3">
          <span className="text-sm text-[var(--muted)]">{openUrl ? `No login saved. Open portal still takes you to ${carrier.name}’s sign-in page.` : "No login saved."}</span>
          <span className="flex flex-wrap gap-2">
            {openUrl && <Button type="button" variant="outline" size="sm" onClick={() => void openPortal(openUrl, null)}>Open portal</Button>}
            {canEdit && <Button type="button" size="sm" onClick={() => setEditing(true)}>Add your login</Button>}
          </span>
        </div>
      )}
      {editing && (<>
        <div className="grid gap-3.5 sm:grid-cols-2">
          {!fallback && (
            <label className={cn(FIELD, "sm:col-span-2")}>
              Portal address
              <input className={cn(control, "mt-0")} value={draft.portalUrl} spellCheck={false} placeholder="agents.carrier.com" onChange={(event) => setDraft({ ...draft, portalUrl: event.target.value })} />
            </label>
          )}
          <label className={FIELD}>
            Username
            <input className={cn(control, "mt-0")} value={draft.username} autoComplete="off" spellCheck={false} onChange={(event) => setDraft({ ...draft, username: event.target.value })} autoFocus />
          </label>
          <label className={FIELD}>
            Sign-in check (MFA)
            <select className={cn(control, "mt-0")} value={draft.mfaType} onChange={(event) => setDraft({ ...draft, mfaType: event.target.value as PortalAccountView["mfaType"] })}>
              {PORTAL_MFA_TYPES.map((type) => <option key={type} value={type}>{PORTAL_MFA_LABEL[type]}</option>)}
            </select>
          </label>
          <label className={FIELD}>
            Last checked it works
            <span className="flex gap-2">
              <input className={cn(control, "mt-0 flex-1")} type="date" max={todayIso()} value={draft.lastVerifiedOn} onChange={(event) => setDraft({ ...draft, lastVerifiedOn: event.target.value })} />
              <Button type="button" variant="outline" onClick={() => setDraft({ ...draft, lastVerifiedOn: todayIso() })}>Today</Button>
            </span>
          </label>
          <label className={FIELD}>
            Notes for your team
            <input className={cn(control, "mt-0")} value={draft.notes} maxLength={500} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
          </label>
        </div>
        <p className="m-0 text-xs text-[var(--muted)]">SMS codes land on one person’s phone and stall an agent at 9pm. An authenticator app the team can reach works better. There is no password field.</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {account ? <Button type="button" variant="ghost" size="sm" className="text-[var(--error-ink)]" onClick={() => setConfirmRemove(true)}>Remove this login</Button> : <span />}
          <span className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
            <Button type="button" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save login"}</Button>
          </span>
        </div>
      </>)}
      {confirmRemove && (
        <Dialog open onOpenChange={(open) => { if (!open) setConfirmRemove(false); }}>
          <DialogContent className="border-[var(--border)] bg-[var(--surface)] sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-[var(--ink)]">Remove the {carrier.name} login?</DialogTitle>
              <DialogDescription>The username, MFA method and note are removed. The change is kept in the audit log. Open portal falls back to the carrier’s portal address.</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmRemove(false)}>Keep it</Button>
              <Button type="button" variant="destructive" disabled={busy} onClick={() => void remove()}>Remove login</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

function Fact({ label, value, warn, extra }: { label: string; value: ReactNode; warn?: boolean; extra?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-[var(--muted)]">{label}</dt>
      <dd className={cn("m-0 mt-0.5 text-sm break-words text-[var(--ink)]", warn && "text-[var(--warning-ink)]")}>{value}</dd>
      {extra}
    </div>
  );
}

/* ── carrier facts and products ─────────────────────────────────────────────────────────────── */

type FactKey = keyof CarrierFacts;
const FACT_LABEL: Record<FactKey, string> = { portalOrigin: "Portal address", referencePattern: "Policy number looks like", billingDescriptor: "Client’s bank statement shows" };
const host = (origin: string) => origin.replace(/^https?:\/\//i, "").replace(/\/$/, "");
const shownFact = (key: FactKey, value: string) => (key === "portalOrigin" ? host(value) : value);

const money = (cents: number | null) => (cents === null ? null : cents >= 100_000_00 ? `$${(cents / 100_000_00).toFixed(cents % 100_000_00 ? 1 : 0)}M` : cents >= 1000_00 ? `$${Math.round(cents / 1000_00)}k` : `$${Math.round(cents / 100)}`);
const range = (a: string | null, b: string | null, empty = "—") => (a && b ? `${a}–${b}` : a ? `${a} and up` : b ? `up to ${b}` : empty);

function FactsAndProducts({ carrier, productLines, canEdit, anchor, reports, reportsAvailable, onSaved }: { carrier: SalesCarrierView; productLines: ProductLine[]; canEdit: boolean; anchor: string; reports: FactReportView[]; reportsAvailable: boolean; onSaved: () => Promise<void> }) {
  const [telling, setTelling] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const lineName = (code: string) => productLines.find((line) => line.code === code)?.name ?? code.replace(/_/g, " ");
  const library = carrier.products.filter((p) => !(p.tenantOwned && !p.copiedFromId));
  const own = carrier.products.filter((p) => p.tenantOwned && !p.copiedFromId);
  const sold = carrier.products.filter((p) => p.isActive).length;
  const methods = [...new Set(carrier.products.flatMap((p) => p.acceptedPaymentMethods))];
  const missingAny = !carrier.effective.referencePattern || !carrier.effective.billingDescriptor;

  function factValue(key: FactKey) {
    const platform = carrier.platform[key];
    const mine = carrier.override?.[key] ?? null;
    if (mine && mine !== platform) {
      return {
        value: <span className="flex flex-wrap items-center gap-1.5"><span className={key === "referencePattern" ? "font-mono text-xs" : undefined}>{shownFact(key, mine)}</span><StatusChip tone="info" dot={false}>Your value</StatusChip></span>,
        extra: <span className="mt-0.5 block text-xs text-[var(--muted)]">Insurvas: {platform ? shownFact(key, platform) : "not set yet"}. Yours is used until Insurvas confirms it.</span>,
      };
    }
    if (!platform) return { value: <span className="text-[var(--muted)]">Insurvas is adding this</span>, extra: null };
    return { value: <span className={key === "referencePattern" ? "font-mono text-xs" : undefined}>{shownFact(key, platform)}</span>, extra: null };
  }

  async function toggle(product: CarrierProductView) {
    setBusy(product.id);
    const ok = await saveProduct(product, { isActive: !product.isActive });
    setBusy(null);
    if (ok) await onSaved();
  }

  const row = (product: CarrierProductView) => {
    const expanded = open === product.id;
    const term = product.productCode === "term_life";
    const ages = range(product.issueAgeMin === null ? null : String(product.issueAgeMin), product.issueAgeMax === null ? null : String(product.issueAgeMax));
    const face = range(money(product.faceMinCents), money(product.faceMaxCents));
    return (
      <li key={product.id} className="border-t border-[var(--border)]">
        <div className="grid grid-cols-[28px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_28px] items-center gap-2.5 px-3.5 py-2.5">
          <button
            type="button"
            role="checkbox"
            aria-checked={product.isActive}
            aria-label={`Sell ${product.name}`}
            disabled={!canEdit || busy !== null}
            onClick={() => void toggle(product)}
            className={cn("grid size-5 place-items-center rounded-[6px] border-[1.5px] text-xs font-bold disabled:cursor-not-allowed disabled:opacity-60", product.isActive ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]" : "border-[var(--border-strong)] text-transparent")}
          >
            ✓
          </button>
          <span className="min-w-0"><span className="block truncate text-sm font-semibold text-[var(--ink)]">{product.name}</span><span className="block truncate text-xs text-[var(--muted)]">{lineName(product.productCode)}</span></span>
          <span className="text-sm text-[var(--body)]">{ages === "—" ? "—" : `Ages ${ages}`}</span>
          <span className="text-sm text-[var(--body)]">{face}</span>
          <span className="text-sm text-[var(--body)]">{busy === product.id ? "Saving…" : product.isActive ? "Sold by you" : "Not sold"}</span>
          <button type="button" aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} ${product.name} details`} onClick={() => setOpen(expanded ? null : product.id)} className="grid size-7 place-items-center rounded-[8px] text-[var(--muted)] hover:bg-[var(--surface-alt)]">
            <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", expanded && "rotate-180")} />
          </button>
        </div>
        {expanded && (
          <dl className="m-0 grid grid-cols-2 gap-3 px-3.5 pb-3.5 pl-[52px] sm:grid-cols-3">
            <Fact label="Product line" value={lineName(product.productCode)} />
            <Fact label="Issue ages" value={ages} />
            <Fact label="Face amount" value={face} />
            {term ? (<>
              <Fact label="Health classes" value={product.healthClasses?.join(", ") || "—"} />
              <Fact label="Term lengths" value={product.termLengths?.length ? `${product.termLengths.join(", ")} years` : "—"} />
              <Fact label="Exam needed" value={product.examAboveFaceCents === null ? "—" : `Above ${money(product.examAboveFaceCents)}`} />
              <Fact label="Renewal" value={product.renewalType === "annual_renewable" ? "Annual renewable" : product.renewalType === "level" ? "Level" : "—"} />
              <Fact label="Conversion" value={product.convertible === false ? "Not convertible" : product.conversionDeadlineRule || (product.convertible ? "Convertible" : "—")} />
            </>) : (
              <Fact label="Tiers" value={product.tiers.length ? product.tiers.join(", ") : "—"} />
            )}
            <Fact label="Pays by" value={product.acceptedPaymentMethods.length ? product.acceptedPaymentMethods.map((m) => PAYMENT_METHOD_LABEL[m]).join(" · ") : "—"} />
            <Fact
              label="Quote check band"
              value={product.bandMin && product.bandMax ? `$${product.bandMin}–$${product.bandMax} per $1,000` : "Uses the all-products band"}
              extra={<Link href="/app/settings#sales-preferences" className="mt-0.5 block text-xs font-semibold text-[var(--accent-ink)] hover:underline">Change in Quote & QA rules</Link>}
            />
          </dl>
        )}
      </li>
    );
  };

  return (
    <section aria-label="Carrier facts and products" className="overflow-hidden rounded-[12px] border border-[var(--border)]">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[var(--surface-alt)] px-3.5 py-3">
        <span className="flex items-center gap-2.5"><h4 className="m-0 text-sm font-semibold text-[var(--ink)]">Carrier facts</h4><StatusChip tone="neutral" dot={false}>Set by Insurvas</StatusChip></span>
        <button type="button" onClick={() => setTelling(true)} className="text-sm font-semibold text-[var(--accent-ink)] hover:underline">Something wrong? Tell us</button>
      </div>
      <div className="flex flex-col gap-3 px-3.5 py-3.5">
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          {(["portalOrigin", "referencePattern", "billingDescriptor"] as const).map((key) => { const fact = factValue(key); return <Fact key={key} label={FACT_LABEL[key]} value={fact.value} extra={fact.extra} />; })}
          <Fact label="Pays by" value={methods.length ? methods.map((m) => PAYMENT_METHOD_LABEL[m]).join(" · ") : <span className="text-[var(--muted)]">Insurvas is adding this</span>} />
          <Fact label="Application fields" value={carrier.fieldSet === "platform" ? `${carrier.name} field set` : carrier.fieldSet === "tenant" ? "Your agency’s field set" : "Your agency’s draft field set"} />
          <Fact label="Browser extension" value={`${MAP_LABEL[carrier.fieldMap.status]}${carrier.fieldMap.version ? ` · map v${carrier.fieldMap.version}` : ""}`} extra={<Link href="/app/settings#carriers/carriers-maps" className="mt-0.5 block text-xs font-semibold text-[var(--accent-ink)] hover:underline">Field maps</Link>} />
        </dl>
        <ReportsLine reports={reports} />
        {missingAny && (
          <p className="m-0 rounded-[10px] bg-[var(--surface-alt)] px-3 py-2.5 text-sm text-[var(--body)]">
            <strong className="font-semibold text-[var(--ink)]">Nothing waits on these.</strong> Until Insurvas adds them, policy numbers save without a format check and the welcome pack shows a dash for the bank statement line.
          </p>
        )}
      </div>
      <div id={anchor} tabIndex={-1} className="flex items-center justify-between border-t border-[var(--border)] px-3.5 py-2.5">
        <span className="text-xs font-semibold text-[var(--muted)]">Products · tick the ones you sell</span>
        <span className="text-xs text-[var(--muted)]">{carrier.products.length ? (sold ? `${sold} of ${carrier.products.length} sold` : "None ticked yet") : ""}</span>
      </div>
      {library.length === 0 && own.length === 0 && <p className="m-0 border-t border-[var(--border)] px-3.5 py-3 text-sm text-[var(--muted)]">Insurvas has no products for this carrier yet. Tell us which ones you sell and we’ll add them.</p>}
      <ul className="m-0 list-none p-0">{library.map(row)}</ul>
      {own.length > 0 && (<>
        <div className="flex items-center justify-between border-t border-[var(--border)] px-3.5 py-2.5">
          <span className="text-xs font-semibold text-[var(--muted)]">Your products</span>
          <span className="text-xs text-[var(--muted)]">Made by your agency</span>
        </div>
        <ul className="m-0 list-none p-0">{own.map(row)}</ul>
      </>)}
      {telling && <TellUs carrier={carrier} reportsAvailable={reportsAvailable} openKeys={new Set(reports.filter((r) => r.status === "open").map((r) => r.factKey))} onClose={() => setTelling(false)} onReported={onSaved} />}
    </section>
  );
}

/* ── tell us ────────────────────────────────────────────────────────────────────────────────── */

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short" });

/** What the agency reported for this carrier: open ones are being checked; closed ones from the last 30 days say how they ended. */
function ReportsLine({ reports }: { reports: FactReportView[] }) {
  const [now] = useState(() => Date.now());
  const shown = reports.filter((r) => r.status === "open" || (r.resolvedAt && now - new Date(r.resolvedAt).getTime() < 30 * 86_400_000)).slice(0, 4);
  if (!shown.length) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {shown.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm text-[var(--body)]">
          <StatusChip tone={r.status === "open" ? "info" : r.status === "fixed" ? "good" : "neutral"}>{r.status === "open" ? "Insurvas is checking" : r.status === "fixed" ? "Fixed" : "Not changed"}</StatusChip>
          <span className="min-w-0">
            <strong className="font-semibold text-[var(--ink)]">{FACT_REPORT_LABEL[r.factKey]}</strong>: you said “{r.suggestedValue}” on {day(r.createdAt)}
            {r.status !== "open" && r.resolutionNote ? ` · ${r.resolutionNote}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

const CARD_TO_REPORT: Record<string, FactReportKey> = { portalOrigin: "portal_origin", referencePattern: "reference_pattern", billingDescriptor: "billing_descriptor", paysBy: "payment_methods", products: "products" };

/**
 * Saves the report to Insurvas's queue (admin console › Fact reports). Before migration 20261027200000
 * is applied there is nowhere to save it, so it writes the email to support instead.
 */
function TellUs({ carrier, reportsAvailable, openKeys, onClose, onReported }: { carrier: SalesCarrierView; reportsAvailable: boolean; openKeys: Set<FactReportKey>; onClose: () => void; onReported: () => Promise<void> }) {
  const facts: { key: string; label: string; now: string }[] = [
    ...(["portalOrigin", "referencePattern", "billingDescriptor"] as const).map((key) => ({ key, label: FACT_LABEL[key], now: carrier.effective[key] ? shownFact(key, carrier.effective[key]!) : "Not set" })),
    { key: "paysBy", label: "Pays by", now: [...new Set(carrier.products.flatMap((p) => p.acceptedPaymentMethods))].map((m) => PAYMENT_METHOD_LABEL[m]).join(", ") || "Not set" },
    { key: "products", label: "A product is missing or wrong", now: carrier.products.map((p) => p.name).join(", ") || "None" },
  ];
  const [which, setWhich] = useState(facts[0].key);
  const [should, setShould] = useState("");
  const [how, setHow] = useState("");
  const [busy, setBusy] = useState(false);
  const picked = facts.find((fact) => fact.key === which) ?? facts[0];
  const already = openKeys.has(CARD_TO_REPORT[picked.key]);
  const subject = `Carrier fact: ${carrier.name} — ${picked.label}`;
  const body = [`Carrier: ${carrier.name}`, `Fact: ${picked.label}`, `What it shows now: ${picked.now}`, `What it should be: ${should.trim()}`, how.trim() ? `How we know: ${how.trim()}` : null].filter(Boolean).join("\n");
  const href = `mailto:${SUPPORT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  async function send() {
    setBusy(true);
    const response = await fetch("/api/app/carrier-fact-reports", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ carrier_id: carrier.id, fact_key: CARD_TO_REPORT[picked.key], shown_value: picked.now, suggested_value: should.trim(), evidence: how.trim() || null }),
    });
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    if (!response.ok) { notify.block(data?.error ?? "That did not send. Try again."); return; }
    notify.done("Sent to Insurvas", { detail: `${picked.label} for ${carrier.name}. You’ll see here when it’s fixed.` });
    onClose();
    await onReported();
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="border-[var(--border)] bg-[var(--surface)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[var(--ink)]">Tell us what’s wrong</DialogTitle>
          <DialogDescription>{carrier.name} · carrier facts</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3.5">
          <label className={FIELD}>
            Which fact
            <select className={cn(control, "mt-0")} value={which} onChange={(event) => setWhich(event.target.value)}>
              {facts.map((fact) => <option key={fact.key} value={fact.key}>{fact.label}</option>)}
            </select>
          </label>
          <div className={FIELD}>What it shows now<span className="text-sm font-normal text-[var(--ink)]">{picked.now}</span></div>
          <label className={FIELD}>
            What it should be
            <input className={cn(control, "mt-0")} value={should} maxLength={500} onChange={(event) => setShould(event.target.value)} autoFocus />
          </label>
          <label className={FIELD}>
            How you know (optional)
            <input className={cn(control, "mt-0")} value={how} maxLength={500} placeholder="e.g. a client’s bank statement, 14 Oct" onChange={(event) => setHow(event.target.value)} />
          </label>
          {already
            ? <p className="m-0 text-xs text-[var(--warning-ink)]">You already reported this fact. Insurvas is checking it.</p>
            : <p className="m-0 text-xs text-[var(--muted)]">{reportsAvailable ? "Insurvas checks it and fixes it once, for every agency. You’ll see here when it’s done." : `This opens an email to ${SUPPORT} with the details filled in. Insurvas fixes the fact once, for every agency.`}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          {reportsAvailable ? (
            <Button type="button" disabled={!should.trim() || busy || already} title={!should.trim() ? "Say what it should be first." : undefined} onClick={() => void send()}>{busy ? "Sending…" : "Send to Insurvas"}</Button>
          ) : should.trim() ? (
            <Button asChild><a href={href} onClick={() => window.setTimeout(onClose, 0)}>Email Insurvas</a></Button>
          ) : (
            <Button type="button" disabled title="Say what it should be first.">Email Insurvas</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

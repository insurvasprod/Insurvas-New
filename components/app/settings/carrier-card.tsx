"use client";

/**
 * Settings › Carriers › one carrier (owner, 2026-10-27: "one carrier, one place"). Carrier details is
 * folded in here, so everything about a carrier sits on its card:
 *
 * - To finish: what a carrier needs before it can be sold (at least one product, at least one
 *   appointed state), plus the optional contract + writing number. Shown until the required ones are
 *   done; the list on the left shows the same progress.
 * - Contract: level, start date and writing number (tenant_carriers). The writing number moved here
 *   from the Rate card; a contract row cannot be saved without one, so the first save starts it.
 * - Products: tick the ones you sell. Products the agency made itself stay, under Your products.
 *   The per-product price band is edited in Quote & QA rules.
 */

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { Callout, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { StatusChip } from "@/components/ui/status-chip";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { PAYMENT_METHOD_LABEL } from "@/lib/applications/constants";
import type { TenantCarrierRow } from "@/lib/carriers/service";
import { bpToLevel, levelToBp, todayIso } from "@/lib/appointments/tickModel";
import type { CarrierProductView, PortalAccountView, ProductLine, SalesCarrierView } from "@/lib/salesSettings/views";

const KICKER = "flex items-center gap-1 text-xs leading-[1.33] font-semibold tracking-[0.04em] uppercase text-[var(--muted)]";
const FIELD = "flex flex-col gap-1.5 text-xs font-semibold text-[var(--muted)]";

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

/** `states`: appointed (active) somewhere. `pending`: only applied for, in states it is not yet appointed in. */
export type CarrierProgress = { contract: boolean; products: boolean | null; states: boolean; pending: boolean; done: number; total: number; ready: boolean };

/**
 * The checks behind To finish and the list's "1 of 2 done". Products count only where Applications is
 * on and Insurvas has products for the carrier: a carrier with none yet is Insurvas's gap, and must not
 * keep the agency from selling it. The contract (level + writing number) is optional (owner,
 * 2026-10-28: "ready to sell even without filling up these"); it only feeds the commission figures.
 */
export function carrierProgress(contract: TenantCarrierRow | null, sales: SalesCarrierView | null, salesAvailable: boolean, states: string[], pendingStates: string[] = []): CarrierProgress {
  const products = salesAvailable && sales && sales.products.length > 0 ? sales.products.some((p) => p.isActive) : null;
  const checks = [products, states.length > 0].filter((value): value is boolean => value !== null);
  const done = checks.filter(Boolean).length;
  return { contract: Boolean(contract), products, states: states.length > 0, pending: pendingStates.length > 0, done, total: checks.length, ready: done === checks.length };
}

/**
 * What a carrier still needs before it can be sold, said once in plain words (owner, 2026-10-28: the
 * card said "not ready" five ways): "Needs your states", "Needs products", or both.
 */
export function carrierNeeds(progress: CarrierProgress): string | null {
  if (progress.ready) return null;
  // Waiting on the carrier is not something to do here: say so instead of "Needs your states".
  const waiting = !progress.states && progress.pending;
  const missing = [progress.products === false ? "products" : null, progress.states || waiting ? null : "your states"].filter(Boolean);
  return [missing.length ? `Needs ${missing.join(" and ")}` : null, waiting ? "Appointment pending" : null].filter(Boolean).join(" · ");
}

export function ProgressLine({ progress, switchedOff }: { progress: CarrierProgress; switchedOff: boolean }) {
  if (switchedOff) return <span className="block truncate text-xs text-[var(--muted)]">Switched off</span>;
  if (progress.ready) return <span className="block text-xs font-semibold text-[var(--accent-ink)]">✓ Ready to sell</span>;
  return <span className="block truncate text-xs font-semibold text-[var(--warning-ink)]">{carrierNeeds(progress)}</span>;
}

function jumpTo(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  const focusable = element.matches("input, select, button") ? element : element.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), button:not([disabled])");
  (focusable as HTMLElement | null)?.focus({ preventScroll: true });
}

function ToFinish({ name, progress, ids }: { name: string; progress: CarrierProgress; ids: { contract: string; products: string; states: string } }) {
  const items: { key: string; title: string; why: string; done: boolean; optional?: boolean; target: string }[] = [
    ...(progress.products === null ? [] : [{ key: "products", title: "Products you sell", why: "Tick at least one. Only ticked products show when you quote.", done: progress.products, target: ids.products }]),
    { key: "states", title: "States you’re appointed in", why: "An application in a state you didn’t tick gets a warning.", done: progress.states, target: ids.states },
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
            {!item.done && <span className={cn("shrink-0 text-xs font-semibold", now ? "text-[var(--accent-ink)]" : "text-[var(--body)]")}>{now ? "Fill in ↓" : item.optional ? "Add ↓" : "Go to it ↓"}</span>}
          </button>
        );
      })}
    </section>
  );
}

/* ── the card ───────────────────────────────────────────────────────────────────────────────── */

export function CarrierCard({ carrier, dot, contract, switchedOff, states, pendingStates = [], sales, salesAvailable, productLines, canEdit, onSetStates, onSaved, className }: {
  carrier: { id: string; name: string };
  dot: string;
  contract: TenantCarrierRow | null;
  switchedOff: boolean;
  /** Appointed (active) states: the ones it can sell in. */
  states: string[];
  /** Applied for, not granted yet: shown, never counted as appointed. */
  pendingStates?: string[];
  sales: SalesCarrierView | null;
  salesAvailable: boolean;
  productLines: ProductLine[];
  canEdit: boolean;
  onSetStates: () => void;
  onSaved: () => Promise<void>;
  className?: string;
}) {
  const ids = { contract: `carrier-${carrier.id}-level`, products: `carrier-${carrier.id}-products`, states: `carrier-${carrier.id}-states` };
  const progress = carrierProgress(contract, sales, salesAvailable, states, pendingStates);
  const list = (codes: string[]) => `${codes.slice(0, 6).join(", ")}${codes.length > 6 ? "…" : ""}`;
  const where = [
    states.length ? `Appointed in ${states.length} state${states.length === 1 ? "" : "s"} · ${list(states)}` : null,
    pendingStates.length ? `pending in ${list(pendingStates)}` : null,
  ].filter(Boolean).join(" · ");

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
          {/* Said once (owner, 2026-10-28): what is missing is the badge's job, so this line only says
              where it is appointed, or that it is switched off. */}
          {(switchedOff || where) && (
            <p className="m-0 mt-1 text-xs text-[var(--muted)]">
              {switchedOff ? "Switched off: no new quotes, applications or leads" : where.charAt(0).toUpperCase() + where.slice(1)}
            </p>
          )}
        </div>
        {!switchedOff && <StatusChip tone={progress.ready ? "good" : "warning"}>{progress.ready ? "Ready to sell" : carrierNeeds(progress)}</StatusChip>}
      </div>

      {/* A checklist only earns its place with two things left; one is the badge plus its own button below. */}
      {!switchedOff && progress.total - progress.done > 1 && <ToFinish name={carrier.name} progress={progress} ids={ids} />}

      <ContractSection key={`${contract?.id ?? "none"}-${contract?.contract_level_bp ?? ""}-${contract?.writing_number ?? ""}`} carrierId={carrier.id} carrierName={carrier.name} contract={contract} canEdit={canEdit} levelId={ids.contract} portal={sales?.portal ?? null} onSaved={onSaved} />

      {salesAvailable && sales && (<>
        <div className="h-px bg-[var(--border)]" />
        <ProductsSection carrier={sales} productLines={productLines} canEdit={canEdit} anchor={ids.products} onSaved={onSaved} />
      </>)}
      {salesAvailable && !sales && <p className="m-0 text-sm text-[var(--muted)]">Products appear here once its contract is saved.</p>}

      <div id={ids.states} className="flex flex-wrap items-center gap-1.5">
        <span className={cn(KICKER, "mr-1")}>Appointed states</span>
        {states.length === 0 && pendingStates.length === 0 && <span className="mr-1 text-sm text-[var(--muted)]">None yet</span>}
        {/* Twelve at most: a carrier in every state would otherwise fill the dialog with chips. */}
        {states.slice(0, 12).map((code) => <span key={code} className="inline-flex h-7 items-center rounded-full bg-[var(--primary-soft)] px-2.5 text-xs font-semibold text-[var(--accent-ink)]">{code}</span>)}
        {states.length > 12 && <span className="inline-flex h-7 items-center px-1 text-xs font-semibold text-[var(--muted)]" title={states.slice(12).join(", ")}>+{states.length - 12} more</span>}
        {/* Pending: outlined, with the word, so it never reads as appointed. */}
        {pendingStates.map((code) => <span key={code} className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-[var(--border-strong)] px-2.5 text-xs font-semibold text-[var(--muted)]">{code}<span className="font-normal">pending</span></span>)}
        {states.length === 0 && pendingStates.length === 0 && !switchedOff
          ? <Button type="button" size="sm" onClick={onSetStates}>Set your states →</Button>
          : <button type="button" onClick={onSetStates} className="inline-flex h-8 items-center rounded-full border border-[var(--border-strong)] px-3 text-xs font-semibold text-[var(--body)] hover:border-[var(--accent-ink)]">Change states →</button>}
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

/* ── contract ───────────────────────────────────────────────────────────────────────────────── */

function ContractSection({ carrierId, carrierName, contract, canEdit, levelId, portal, onSaved }: {
  carrierId: string; carrierName: string; contract: TenantCarrierRow | null; canEdit: boolean; levelId: string; portal: PortalAccountView | null; onSaved: () => Promise<void>;
}) {
  const [level, setLevel] = useState(bpToLevel(contract?.contract_level_bp));
  const [from, setFrom] = useState(contract?.effective_from ?? todayIso());
  const [writing, setWriting] = useState(contract?.writing_number ?? portal?.writingNumber ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  // Folded until wanted (owner, 2026-10-28): it is optional, and it was the biggest thing on the card.
  const [open, setOpen] = useState(Boolean(contract));
  const levelBad = level.trim() !== "" && levelToBp(level) === null;

  async function save() {
    const bp = levelToBp(level);
    if (bp === null || !from || !writing.trim()) return;
    if (contract && bp === contract.contract_level_bp && from === contract.effective_from && writing.trim() === contract.writing_number) return;
    setState("saving");
    setError(null);
    const result = await send("/api/app/carrier-library/tenant-carriers", "POST", { carrier_id: carrierId, contract_level_bp: bp, writing_number: writing.trim(), effective_from: from });
    if (!result.ok) { setState("idle"); setError(result.error); return; }
    setState("saved");
    await onSaved();
  }

  const missing = !contract && (level.trim() === "" || writing.trim() === "");
  if (!open) {
    return (
      <section aria-label="Contract" className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-dashed border-[var(--border-strong)] px-3.5 py-2.5">
        <span className="text-sm text-[var(--body)]">Contract level and writing number <span className="text-[var(--muted)]">· optional, for commission figures</span></span>
        {canEdit && <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>Add contract details</Button>}
      </section>
    );
  }
  return (
    <section aria-label="Contract" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className={cn(KICKER, "flex items-center gap-1")}>Contract{!contract && <span className="font-medium normal-case tracking-normal">· optional</span>}<InfoTip label="About the contract level">The level every commission figure is worked out from. A new level from a later date keeps the earlier one for older policies.</InfoTip></span>
        {state === "saving" ? <span className="text-xs text-[var(--muted)]">Saving…</span> : state === "saved" ? <StatusChip tone="good">Saved</StatusChip> : null}
      </div>
      {/* The three fields share the card's width (one row when it fits, the level narrower) and stack
          when it is narrow; fixed widths overflowed the card and made it scroll sideways (owner, 2026-10-28). */}
      <div className="@container">
      <div className="grid grid-cols-1 gap-3.5 @xs:grid-cols-2 @md:grid-cols-[minmax(0,0.75fr)_minmax(0,1.1fr)_minmax(0,1.1fr)] [&>label:last-child]:@xs:col-span-2 [&>label:last-child]:@md:col-span-1">
        <label className={FIELD}>
          Contract level
          <span className="relative">
            <input id={levelId} className={cn(control, "mt-0 pr-7")} inputMode="decimal" disabled={!canEdit} aria-invalid={levelBad || undefined} value={level} onChange={(event) => setLevel(event.target.value)} onBlur={() => void save()} placeholder="110" />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-[var(--muted)]">%</span>
          </span>
        </label>
        <label className={FIELD}>
          Contracted from
          <input className={cn(control, "mt-0")} type="date" disabled={!canEdit} value={from} onChange={(event) => setFrom(event.target.value)} onBlur={() => void save()} />
        </label>
        <label className={FIELD}>
          Writing number
          <input className={cn(control, "mt-0")} disabled={!canEdit} value={writing} autoComplete="off" spellCheck={false} placeholder="e.g. TA-20914" onChange={(event) => setWriting(event.target.value)} onBlur={() => void save()} />
        </label>
      </div>
      </div>
      {levelBad && <p className="m-0 text-xs text-[var(--error-ink)]">Write the level as a number, like 110.</p>}
      {error && <Callout tone="error" title={error} />}
      {missing && (
        <p className="m-0 text-xs text-[var(--muted)]">
          {`${carrierName} sells without these. They save once all three are filled in.`}
        </p>
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

const money = (cents: number | null) => (cents === null ? null : cents >= 100_000_00 ? `$${(cents / 100_000_00).toFixed(cents % 100_000_00 ? 1 : 0)}M` : cents >= 1000_00 ? `$${Math.round(cents / 1000_00)}k` : `$${Math.round(cents / 100)}`);
const range = (a: string | null, b: string | null, empty = "—") => (a && b ? `${a}–${b}` : a ? `${a} and up` : b ? `up to ${b}` : empty);

/* ── products ────────────────────────────────────────────────────────────────────────────────── */

function ProductsSection({ carrier, productLines, canEdit, anchor, onSaved }: { carrier: SalesCarrierView; productLines: ProductLine[]; canEdit: boolean; anchor: string; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const lineName = (code: string) => productLines.find((line) => line.code === code)?.name ?? code.replace(/_/g, " ");
  // Settings › Products (2026-10-27): only lines the agency sells are offered; a product already ticked stays.
  const sells = (code: string) => productLines.find((line) => line.code === code)?.sold !== false;
  const library = carrier.products.filter((p) => !(p.tenantOwned && !p.copiedFromId) && (p.isActive || sells(p.productCode)));
  const own = carrier.products.filter((p) => p.tenantOwned && !p.copiedFromId);
  const sold = carrier.products.filter((p) => p.isActive).length;

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
          <button type="button" role="checkbox" aria-checked={product.isActive} aria-label={`Sell ${product.name}`} disabled={!canEdit || busy !== null} onClick={() => void toggle(product)} className={cn("grid size-5 place-items-center rounded-[6px] border-[1.5px] text-xs font-bold disabled:cursor-not-allowed disabled:opacity-60", product.isActive ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]" : "border-[var(--border-strong)] text-transparent")}>✓</button>
          <span className="min-w-0"><span className="block truncate text-sm font-semibold text-[var(--ink)]">{product.name}</span><span className="block truncate text-xs text-[var(--muted)]">{lineName(product.productCode)}</span></span>
          <span className="text-sm text-[var(--body)]">{ages === "—" ? "—" : `Ages ${ages}`}</span>
          <span className="text-sm text-[var(--body)]">{face}</span>
          <span className="text-sm text-[var(--body)]">{busy === product.id ? "Saving…" : product.isActive ? "Sold by you" : "Not sold"}</span>
          <button type="button" aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} ${product.name} details`} onClick={() => setOpen(expanded ? null : product.id)} className="grid size-7 place-items-center rounded-[8px] text-[var(--muted)] hover:bg-[var(--surface-alt)]"><ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", expanded && "rotate-180")} /></button>
        </div>
        {expanded && (
          <dl className="m-0 grid grid-cols-2 gap-3 px-3.5 pb-3.5 pl-[52px] sm:grid-cols-3">
            <Fact label="Product line" value={lineName(product.productCode)} />
            <Fact label="Issue ages" value={ages} />
            <Fact label="Face amount" value={face} />
            {term ? <>
              <Fact label="Health classes" value={product.healthClasses?.join(", ") || "—"} />
              <Fact label="Term lengths" value={product.termLengths?.length ? `${product.termLengths.join(", ")} years` : "—"} />
              <Fact label="Exam needed" value={product.examAboveFaceCents === null ? "—" : `Above ${money(product.examAboveFaceCents)}`} />
              <Fact label="Renewal" value={product.renewalType === "annual_renewable" ? "Annual renewable" : product.renewalType === "level" ? "Level" : "—"} />
              <Fact label="Conversion" value={product.convertible === false ? "Not convertible" : product.conversionDeadlineRule || (product.convertible ? "Convertible" : "—")} />
            </> : <Fact label="Tiers" value={product.tiers.length ? product.tiers.join(", ") : "—"} />}
            <Fact label="Pays by" value={product.acceptedPaymentMethods.length ? product.acceptedPaymentMethods.map((m) => PAYMENT_METHOD_LABEL[m]).join(" · ") : "—"} />
            <Fact label="Quote check band" value={product.bandMin && product.bandMax ? `$${product.bandMin}–$${product.bandMax} per $1,000` : "Uses the all-products band"} extra={<Link href="/app/settings#sales-preferences" className="mt-0.5 block text-xs font-semibold text-[var(--accent-ink)] hover:underline">Change in Quote & QA rules</Link>} />
          </dl>
        )}
      </li>
    );
  };

  return (
    <section aria-label="Products" className="overflow-hidden rounded-[12px] border border-[var(--border)]">
      <div id={anchor} tabIndex={-1} className="flex items-center justify-between gap-3 bg-[var(--surface-alt)] px-3.5 py-3">
        <h4 className="m-0 text-sm font-semibold text-[var(--ink)]">Products</h4>
        <span className="text-xs text-[var(--muted)]">{carrier.products.length ? (sold ? `${sold} of ${carrier.products.length} sold` : "None ticked yet") : ""}</span>
      </div>
      {library.length === 0 && own.length === 0 && <p className="m-0 border-t border-[var(--border)] px-3.5 py-3 text-sm text-[var(--muted)]">No products in the library yet.</p>}
      <ul className="m-0 list-none p-0">{library.map(row)}</ul>
      {own.length > 0 && <><div className="flex items-center justify-between border-t border-[var(--border)] px-3.5 py-2.5"><span className="text-xs font-semibold text-[var(--muted)]">Your products</span><span className="text-xs text-[var(--muted)]">Made by your agency</span></div><ul className="m-0 list-none p-0">{own.map(row)}</ul></>}
    </section>
  );
}

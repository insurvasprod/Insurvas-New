"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { CheckBox } from "@/components/ui/check-box";
import { cardSurface } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, control } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { ENTITY_TYPES, EXEMPT_LABELS, EXEMPT_REASONS, maskTaxId, TAX_CATEGORIES, TAX_CATEGORY_LABELS, TAX_NOTICE, type ExemptReason, type TaxCategory } from "@/lib/accounting/taxCore";
import { nextStepWords, payeeHref, standing, TAX_WHO_LABELS, whoRows, type CategoryByQuarter, type TaxQuarter, type TaxWho } from "@/lib/accounting/taxLinks";
import { formatCentsAsCurrency } from "@/lib/money";
import { notify } from "@/lib/notify";

/**
 * LA-7.8 · January, without a spreadsheet: what each contractor was paid in the year (by payment
 * date), who needs a 1099, who is missing a W-9 or a tax ID — and the year by category for the
 * accountant. Figures only; the notice says so and cannot be closed.
 *
 * Round 7 (owner 2026-11-10, mockups-r7/accounting.html §6 · A, "Tidy tabs, a payee page"): Contractors · By category ·
 * Buckets are the step's tabs on the title line (`?view=`). On Contractors each strip tile opens its own chip
 * (`?who=`), "Next step" is words and a row opens the payee; By category is the year by quarter; a bucket row opens
 * its dialog. A payee is their own page (/app/tax/payee/[type]/[id]) with Details · Payments · W-9 tabs. The notice is
 * the spec's legal wording, so it stays on screen in full on every view — as plain text in the table's foot, never a
 * tinted card.
 */
export type TaxRow = {
  payeeType: "partner" | "producer" | "vendor"; payeeId: string; displayName: string; nameOnForm: string; paidCents: number; profileId: string | null; address: string | null;
  addressParts: { line1: string; line2: string; city: string; state: string; postal: string } | null; entityType: string | null; exempt: ExemptReason | null; requires: boolean; missing: string[];
  profile: { legalName: string | null; taxIdType: string; taxIdLast4: string | null; w9OnFile: boolean; exemptReason: ExemptReason | null } | null;
};
export type TaxData = {
  year: number; basis: "cash" | "accrual"; canReveal: boolean;
  contractors: { rows: TaxRow[]; under: TaxRow[]; requiringCount: number; missingCount: number; thresholdCents: number };
  categories: { quarters: TaxQuarter[]; rows: CategoryByQuarter<TaxCategory>[] };
  map: { sourceType: string; sourceValue: string; defaultCategory: TaxCategory; category: TaxCategory; overridden: boolean }[];
};
export type TaxView = "contractors" | "categories" | "buckets";
type MapRow = TaxData["map"][number];

const money = (c: number) => formatCentsAsCurrency(c);
const SOURCE_LABEL: Record<string, string> = { cost_entry_type: "Cost", expense_category: "Expense category", commission_entry_type: "Commission" };
const PAYEE_TYPE_LABEL = { partner: "Partner", producer: "Producer", vendor: "Vendor" } as const;
const READ_ONLY_REASON = "Your plan is read-only here, so this can't be changed.";

async function post(body: unknown) {
  const res = await fetch("/api/app/accounting/tax", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? "That didn't save");
  return json;
}

/** The notice, on every tax screen: no close button, no setting to hide it; plain text, not a card. */
export function TaxNotice() {
  return <p role="note" className="text-xs leading-[1.5] text-muted-foreground">{TAX_NOTICE}</p>;
}

/**
 * The 1099 state of a contractor, as the list and their page show it. One short chip (owner 2026-11-11): what is
 * missing is counted, and the list of it is the chip's tooltip.
 */
export function TaxState({ row }: { row: TaxRow }) {
  const n = row.missing.length;
  return row.exempt ? <StatusChip tone="neutral">Exempt: {EXEMPT_LABELS[row.exempt]}</StatusChip>
    : n ? <StatusChip tone="warning" title={`Missing ${row.missing.join(", ")}`}>{n === 1 ? `${row.missing[0].replace(/^./, (ch) => ch.toUpperCase())} missing` : `${n} details missing`}</StatusChip>
    : <StatusChip tone="good">{row.profile?.w9OnFile ? "W-9 on file" : "Ready"}</StatusChip>;
}

/** A disabled control says why on hover (round 7: read-only states); a disabled button fires no hover, so its wrapper carries it. */
function Why({ reason, block, children }: { reason: string | null; block?: boolean; children: ReactNode }) {
  return reason ? <span title={reason} className={block ? "flex" : "inline-flex"}>{children}</span> : <>{children}</>;
}

/** A payee's title line: Reveal the tax ID — asked first, audited, for the roles the agency allows. */
export function RevealTaxId({ profileId, name }: { profileId: string; name: string }) {
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (value) return <span className="inline-flex h-9 items-center rounded-[8px] border border-border px-3 font-mono text-sm">{value}</span>;
  return (
    <Button variant="outline" disabled={busy} onClick={async () => {
      const ok = await confirmAction({ title: `Reveal ${name}'s tax ID?`, description: "Every reveal is recorded with who and when. It hides again when you leave the page.", confirmLabel: "Reveal", destructive: false });
      if (!ok) return;
      setBusy(true);
      try {
        setValue((await post({ op: "reveal", profile_id: profileId })).value);
      } catch (err) {
        notify.fail("Not allowed", { detail: err instanceof Error ? err.message : "Only the roles your agency allows can see tax IDs (Settings › Accounting)." });
      } finally {
        setBusy(false);
      }
    }}>Reveal tax ID</Button>
  );
}

/**
 * A payee's W-9 tab: the drop zone, and the file once attached. The file hangs off the saved details, so before the
 * first save the zone itself says so (its disabled state, not a notice).
 */
export function W9Drop({ profileId, name, file, readOnly }: { profileId: string | null; name: string; file: { name: string; uploadedAt: string } | null; readOnly: boolean }) {
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const off = !profileId || readOnly || busy;
  const upload = async (picked: File | undefined) => {
    if (!picked || !profileId || readOnly) return;
    setBusy(true);
    const form = new FormData();
    form.set("profile", profileId);
    form.set("file", picked);
    try {
      const res = await fetch("/api/app/accounting/tax/w9", { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "The file didn't upload");
      notify.done("W-9 attached");
      router.refresh();
    } catch (err) {
      notify.fail("The file didn't upload", { detail: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };
  const zone = "grid gap-1 rounded-lg border border-dashed px-4 py-8 text-center text-sm transition-colors";
  return (
    <div className={`${cardSurface} flex flex-col gap-3 p-5`}>
      {file && profileId ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <span className="min-w-0"><span className="block truncate font-medium text-foreground">{file.name}</span><span className="text-xs text-muted-foreground">{file.uploadedAt ? `Attached ${readableDate(file.uploadedAt)}` : "Attached"}</span></span>
          <Button variant="outline" size="sm" asChild><a href={`/api/app/accounting/tax/w9?profile=${profileId}`} target="_blank" rel="noreferrer">Open the W-9</a></Button>
        </div>
      ) : null}
      {!profileId ? (
        <div aria-disabled="true" className={`${zone} cursor-not-allowed border-border bg-[var(--surface-alt)] text-muted-foreground`}>
          <span className="font-medium">Save the details first</span>
          <span className="text-xs">The W-9 is kept with {name}&apos;s tax details. Save them on Details, then drop the file here.</span>
        </div>
      ) : (
        <Why block reason={readOnly ? READ_ONLY_REASON : null}>
          <label htmlFor="tax-w9-file" aria-disabled={off || undefined}
            className={`${zone} w-full bg-[var(--surface-alt)] text-[var(--body)] ${off ? "cursor-not-allowed border-border opacity-60" : "cursor-pointer border-border hover:border-[var(--primary)]"} ${over ? "border-[var(--primary)]" : ""}`}
            onDragOver={(e) => { e.preventDefault(); if (!off) setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); if (!off) void upload(e.dataTransfer.files?.[0]); }}>
            <span className="font-semibold text-foreground">{busy ? "Uploading…" : file ? `Drop a newer W-9 to replace ${file.name}` : `Drop ${name}'s signed W-9`}</span>
            <span className="text-xs text-muted-foreground">PDF, PNG or JPG · or <span className="text-[var(--accent-ink)]">choose a file</span></span>
            <input id="tax-w9-file" type="file" className="sr-only" disabled={off} accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => { const picked = e.target.files?.[0]; e.target.value = ""; void upload(picked); }} />
          </label>
        </Why>
      )}
      <p className="text-xs text-muted-foreground">Attaching it ticks &quot;I have their signed W-9&quot; on Details.</p>
    </div>
  );
}

function readableDate(iso: string) {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// The details form and its Save on the title line are in two places of the page; they share whether it can save.
const PROFILE_FORM = "tax-profile-form";
let formState = { busy: false, dirty: false };
const formListeners = new Set<() => void>();
const SERVER_FORM_STATE = { busy: false, dirty: false };
function setFormState(next: { busy: boolean; dirty: boolean }) {
  if (next.busy === formState.busy && next.dirty === formState.dirty) return;
  formState = next;
  formListeners.forEach((l) => l());
}

/** The payee page's primary button, on the title line of the Details tab: it submits the form below. */
export function SaveTaxDetails({ readOnly }: { readOnly: boolean }) {
  const state = useSyncExternalStore((l) => { formListeners.add(l); return () => { formListeners.delete(l); }; }, () => formState, () => SERVER_FORM_STATE);
  const reason = readOnly ? READ_ONLY_REASON : !state.dirty && !state.busy ? "Nothing has changed yet." : null;
  return <Why reason={reason}><Button type="submit" form={PROFILE_FORM} disabled={readOnly || state.busy || !state.dirty}>{state.busy ? "Saving…" : "Save tax details"}</Button></Why>;
}

/** A contractor's tax details (LA-7.8): legal name, tax ID (encrypted, shown masked), entity, address, W-9, exemption. */
export function ProfileForm({ row, readOnly, nextMissingHref }: { row: TaxRow; readOnly: boolean; nextMissingHref: string | null }) {
  const router = useRouter();
  const p = row.profile;
  const a = row.addressParts;
  const initial = { legal: p?.legalName ?? "", type: p?.taxIdType ?? "none", taxId: "", entity: row.entityType ?? "", line1: a?.line1 ?? "", line2: a?.line2 ?? "", city: a?.city ?? "", state: a?.state ?? "", postal: a?.postal ?? "", w9: p?.w9OnFile ?? false, exempt: (p?.exemptReason ?? "") as ExemptReason | "" };
  // What is on file: the form compares with it, and a save moves it (the page stays; round 7).
  const [base, setBase] = useState(initial);
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = useRef<HTMLFormElement>(null);
  const dirty = JSON.stringify(f) !== JSON.stringify(base);
  const zipError = f.postal && !/^\d{5}(-\d{4})?$/.test(f.postal.trim()) ? "Five digits." : null;
  useEffect(() => { setFormState({ busy, dirty }); }, [busy, dirty]);
  useEffect(() => () => setFormState({ busy: false, dirty: false }), []);
  const save = async (): Promise<boolean> => {
    if (zipError) { setError(null); return false; }
    setBusy(true);
    setError(null);
    try {
      await post({ op: "save_profile", payee_type: row.payeeType, payee_id: row.payeeId, legal_name: f.legal || null, tax_id_type: f.type, tax_id: f.taxId || null, entity_type: f.entity || null,
        address_line1: f.line1 || null, address_line2: f.line2 || null, city: f.city || null, state: f.state || null, postal_code: f.postal || null, country: "US", w9_on_file: f.w9, exempt_reason: f.exempt || null });
      const saved = { ...f, taxId: "" };
      setBase(saved);
      setF(saved);
      notify.done("Tax details saved", nextMissingHref ? { action: { label: "Next missing ›", onClick: () => router.push(nextMissingHref) } } : undefined);
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void save(); };
  // In the order the 1099 asks for it, each part a plain question (/ui-taste pass, owner 2026-11-09).
  const section = "flex flex-col gap-3 border-t border-border pt-5 first:border-t-0 first:pt-0";
  const heading = "m-0 text-sm font-semibold text-[var(--ink)]";
  const entityLabel = (t: string) => (t === "llc" ? "LLC" : t.replace("_", " ").replace(/^./, (c) => c.toUpperCase()));
  return (
    <form id={PROFILE_FORM} ref={scope} onSubmit={submit} className={`${cardSurface} flex flex-col gap-5 p-5`} title={readOnly ? READ_ONLY_REASON : undefined}>
      <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
        <section className={section}>
          <h2 className={heading}>1 · Whose name goes on the 1099?</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="Legal name" htmlFor="tax-legal" hint="As on their W-9. It is often not the name you know them by." className="sm:col-span-2"><input id="tax-legal" className={control} maxLength={200} value={f.legal} onChange={(e) => setF({ ...f, legal: e.target.value })} placeholder="e.g. Apex Communications LLC" /></Field>
            <Field label="Business type" htmlFor="tax-entity"><select id="tax-entity" className={control} value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })}><option value="">Not known</option>{ENTITY_TYPES.map((t) => <option key={t} value={t}>{entityLabel(t)}</option>)}</select></Field>
          </div>
        </section>
        <section className={section}>
          <h2 className={heading}>2 · Their tax ID</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="Kind" htmlFor="tax-type"><select id="tax-type" className={control} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="ein">EIN (business)</option><option value="ssn">SSN (person)</option><option value="foreign">Foreign</option><option value="none">Not on file yet</option></select></Field>
            <Field label={p?.taxIdLast4 ? `New number (now ${maskTaxId(p.taxIdType, p.taxIdLast4)})` : "Number"} htmlFor="tax-id" hint="Stored encrypted. Only the last 4 digits are shown."><input id="tax-id" className={control} autoComplete="off" disabled={f.type === "none"} value={f.taxId} onChange={(e) => setF({ ...f, taxId: e.target.value })} placeholder={p?.taxIdLast4 ? "Leave blank to keep it" : ""} /></Field>
            <Field label="Do they need a 1099?" htmlFor="tax-exempt"><select id="tax-exempt" className={control} value={f.exempt} onChange={(e) => setF({ ...f, exempt: e.target.value as ExemptReason | "" })}><option value="">Yes, if paid over the limit</option>{EXEMPT_REASONS.map((r) => <option key={r} value={r}>No: {EXEMPT_LABELS[r]}</option>)}</select></Field>
          </div>
          <label className="flex items-center gap-3 text-sm"><CheckBox checked={f.w9} onChange={(e) => setF({ ...f, w9: e.target.checked })} /><span><span className="font-medium">I have their signed W-9</span><span className="block text-xs text-muted-foreground">Attach the file on the W-9 tab.</span></span></label>
        </section>
        <section className={section}>
          <h2 className={heading}>3 · Where to mail it</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="Street" htmlFor="tax-line1" className="sm:col-span-2"><input id="tax-line1" className={control} maxLength={200} value={f.line1} onChange={(e) => setF({ ...f, line1: e.target.value })} placeholder="Street and number" /></Field>
            <Field label="City" htmlFor="tax-city"><input id="tax-city" className={control} maxLength={100} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="State" htmlFor="tax-state"><input id="tax-state" className={control} maxLength={2} placeholder="TX" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value.toUpperCase() })} /></Field>
              <Field label="ZIP" htmlFor="tax-zip" error={zipError}><input id="tax-zip" className={control} maxLength={10} inputMode="numeric" aria-invalid={zipError ? true : undefined} value={f.postal} onChange={(e) => setF({ ...f, postal: e.target.value })} /></Field>
            </div>
          </div>
        </section>
      </fieldset>
      {error ? <p role="alert" className="text-sm text-[var(--error-ink)]">{error}</p> : null}
      <div className="border-t border-border pt-4">
        <TaxNotice />
      </div>
      <LeaveGuard dirty={dirty && !busy} scope={scope} onSave={save} onDiscard={() => setF(base)} what={`the tax details of ${row.nameOnForm}`} />
    </form>
  );
}

/** A bucket (round 7, 6·3): the row opens this short edit; Save writes the one mapping and its audit row. */
function BucketDialog({ row, readOnly, onClose, onSaved }: { row: MapRow | null; readOnly: boolean; onClose: () => void; onSaved: () => void }) {
  const [choice, setChoice] = useState<TaxCategory>(row?.category ?? "other");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<MapRow | null>(row);
  // Keep the content while the dialog animates out; a new row starts from its own category.
  if (row && row !== shown) { setShown(row); setChoice(row.category); setError(null); }
  const m = row ?? shown;
  if (!m) return null;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await post({ op: "set_category", source_type: m.sourceType, source_value: m.sourceValue, tax_category: choice });
      notify.done("Saved — it changes this view, not published payout runs");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={row !== null} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{SOURCE_LABEL[m.sourceType]}: {m.sourceValue.replace(/_/g, " ")}</DialogTitle>
          <DialogDescription>{m.overridden ? `yours · Insurvas's is ${TAX_CATEGORY_LABELS[m.defaultCategory]}` : "Insurvas's"}</DialogDescription>
        </DialogHeader>
        <Field label="Tax category" htmlFor="tax-bucket" hint="It changes this view and the export, not published payout runs." error={error}>
          <select id="tax-bucket" className={control} disabled={readOnly || busy} value={choice} onChange={(e) => setChoice(e.target.value as TaxCategory)}>{TAX_CATEGORIES.map((k) => <option key={k} value={k}>{TAX_CATEGORY_LABELS[k]}</option>)}</select>
        </Field>
        <DialogFooter className="sm:justify-between">
          <Why reason={readOnly ? READ_ONLY_REASON : choice === m.defaultCategory ? "It is already Insurvas's." : null}><Button type="button" variant="ghost" disabled={readOnly || busy || choice === m.defaultCategory} onClick={() => setChoice(m.defaultCategory)}>Back to Insurvas&apos;s</Button></Why>
          <span className="flex gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
            <Why reason={readOnly ? READ_ONLY_REASON : choice === m.category ? "Nothing has changed yet." : null}><Button type="button" disabled={readOnly || busy || choice === m.category} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button></Why>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TaxBoard({ data, view, who: initialWho, readOnly }: { data: TaxData; view: TaxView; who: TaxWho; readOnly: boolean }) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  // Each strip tile is its own chip (round 7): the chip rides in the address, so a tile, the bell or Back lands on it.
  const [who, setWhoState] = useState<TaxWho>(initialWho);
  const setWho = (k: TaxWho) => { setWhoState(k); setPage(1); setParamsInPlace({ who: k === "all" ? null : k }); };
  const [editing, setEditing] = useState<MapRow | null>(null);
  const pageSize = useFittingPageSize(520, 52);
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());
  const years = Array.from({ length: 4 }, (_, i) => new Date().getUTCFullYear() - i);
  const c = data.contractors;
  const needle = q.trim().toLowerCase();
  const people = whoRows(c, who).filter((r) => !needle || r.nameOnForm.toLowerCase().includes(needle) || r.displayName.toLowerCase().includes(needle));
  const shown = paginate(people, page, pageSize);
  const under = who === "under";
  const missingRows = whoRows(c, "missing");
  const yearHref = (year: string) => `/app/tax?year=${year}${view === "contractors" ? "" : `&view=${view}`}`;
  const whoHref = (k: TaxWho) => `/app/tax?year=${data.year}${k === "all" ? "" : `&who=${k}`}`;
  const count = view === "contractors" ? `${people.length} ${people.length === 1 ? "contractor" : "contractors"}` : view === "categories" ? `${data.categories.rows.length} ${data.categories.rows.length === 1 ? "category" : "categories"}` : `${data.map.length} kinds of money`;
  const foot = <div className="flex w-full flex-wrap items-center justify-between gap-3"><TaxNotice /><span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums">{count}{view === "contractors" && people.length > pageSize ? <Pager page={shown.current} total={people.length} noun="contractors" pageSize={pageSize} onPage={setPage} /> : null}</span></div>;
  const cell = (cents: number | null) => (cents === null ? <span className="text-muted-foreground">—</span> : money(cents));
  return (
    <>
      {/* The 1099 figures belong to Contractors; the other views fit the screen without them (owner 2026-11-03). */}
      {view === "contractors" ? (
        <StatStrip label="Tax figures">
          <StatTile label={`Requiring a 1099 (${data.year})`} value={String(c.requiringCount)} footnote={`paid ${money(c.thresholdCents)} or more`} href={whoHref("all")} />
          <StatTile label="Missing details" value={String(c.missingCount)} footnote={c.missingCount ? <StatusChip tone="warning">W-9, tax ID or legal name</StatusChip> : "W-9, tax ID or legal name"} href={whoHref("missing")} />
          <StatTile label="Under the threshold" value={String(c.under.length)} footnote="excluded" href={whoHref("under")} />
        </StatStrip>
      ) : null}
      <TableCard toolbar={
        <DataToolbar actions={<>
          <select aria-label="Year" className={toolbarControl} value={data.year} onChange={(e) => router.push(yearHref(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
          <RefreshButton onClick={refresh} refreshing={refreshing} />
        </>}>
          {view === "contractors" ? <>
            <ToolbarSearch value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search name" />
            <Segmented label="Who" value={who} onChange={setWho} options={[
              { key: "all", label: TAX_WHO_LABELS.all, count: c.rows.length },
              { key: "missing", label: TAX_WHO_LABELS.missing, count: missingRows.length || null, tone: "danger" },
              { key: "ready", label: TAX_WHO_LABELS.ready, count: whoRows(c, "ready").length || null },
              { key: "under", label: TAX_WHO_LABELS.under, count: c.under.length || null },
            ]} />
          </> : null}
        </DataToolbar>
      } footer={foot}>
        {view === "contractors" ? (
          whoRows(c, who).length === 0 ? (under
            ? <EmptyState title={`Nobody under ${money(c.thresholdCents)} in ${data.year}`} hint="Payees paid less than the threshold in the year are listed here; they need no 1099." />
            : <EmptyState title={`Nobody over ${money(c.thresholdCents)} in ${data.year}`} hint="Payments to partners, producers and lead vendors are counted here as they are marked paid." />)
            : people.length === 0 ? <NoMatches noun="contractors" onClear={() => { setQ(""); setWho("all"); }} /> : (
            <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
              <thead><tr><th className="w-[30%]">Name on the form</th><th className="w-[12%]">Type</th><th className="w-[14%]">Tax ID</th><th className="w-[14%] text-right">Paid</th><th className="w-[18%]">1099</th><th>Next step</th></tr></thead>
              <tbody>
                {shown.rows.map((r) => {
                  const href = payeeHref(r, data.year, { from: who });
                  // One line (owner 2026-11-11): the name you know them by is the name's tooltip, the kind of payee
                  // its own short column; the next step is a short verb with the sentence as its tooltip.
                  const step = standing(r) === "missing" && !under ? "Add details" : "Open";
                  return (
                    <tr key={`${r.payeeType}-${r.payeeId}`} className="cursor-pointer" onClick={() => router.push(href)}>
                      <td className="whitespace-nowrap"><Link className="font-medium text-foreground hover:underline" href={href} title={r.displayName !== r.nameOnForm ? `Known as ${r.displayName}` : undefined} onClick={(e) => e.stopPropagation()}>{r.nameOnForm}</Link></td>
                      <td className="whitespace-nowrap">{PAYEE_TYPE_LABEL[r.payeeType]}</td>
                      <td className="whitespace-nowrap font-mono tabular-nums">{maskTaxId(r.profile?.taxIdType ?? "none", r.profile?.taxIdLast4 ?? null)}</td>
                      <td className="whitespace-nowrap text-right tabular-nums"><Link className="text-foreground hover:underline" href={payeeHref(r, data.year, { from: who, tab: "payments" })} onClick={(e) => e.stopPropagation()}>{money(r.paidCents)}</Link></td>
                      <td>{under ? <StatusChip tone="neutral">Under the threshold</StatusChip> : <TaxState row={r} />}</td>
                      <td className="whitespace-nowrap" title={nextStepWords(r, under)}>{step} ›</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : view === "categories" ? (
          data.categories.rows.length === 0 ? <EmptyState title={`Nothing recorded in ${data.year}`} hint="The year's commission and costs are summed here by tax category." /> : (
            <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
              <thead><tr><th>Category</th>{data.categories.quarters.map((qt) => <th key={qt.n} className="text-right">{qt.label}</th>)}<th className="text-right">{data.year}, {data.basis}</th></tr></thead>
              <tbody>{data.categories.rows.map((row) => (
                <tr key={row.category}>
                  <td className="whitespace-nowrap font-medium">{TAX_CATEGORY_LABELS[row.category]}</td>
                  {row.quarters.map((cents, i) => <td key={i} className="whitespace-nowrap text-right tabular-nums">{cell(cents)}</td>)}
                  <td className="whitespace-nowrap text-right tabular-nums">{money(row.yearCents)}</td>
                </tr>
              ))}</tbody>
            </table>
          )
        ) : (
          <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
            <thead><tr><th>Kind of money</th><th>Tax category</th><th>Whose</th><th className="w-20"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {data.map.map((m) => (
                <tr key={`${m.sourceType}-${m.sourceValue}`} className="cursor-pointer" onClick={() => setEditing(m)}>
                  <td className="whitespace-nowrap font-medium">{SOURCE_LABEL[m.sourceType]}: {m.sourceValue.replace(/_/g, " ")}</td>
                  <td className="whitespace-nowrap">{TAX_CATEGORY_LABELS[m.category]}</td>
                  <td className="whitespace-nowrap" title={m.overridden ? `Insurvas's is ${TAX_CATEGORY_LABELS[m.defaultCategory]}` : undefined}>{m.overridden ? "Yours" : "Insurvas's"}</td>
                  <td className="whitespace-nowrap text-right"><button type="button" className="text-sm text-foreground hover:underline" onClick={(e) => { e.stopPropagation(); setEditing(m); }}>{readOnly ? "View" : "Edit"} ›</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
      <BucketDialog row={editing} readOnly={readOnly} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />
    </>
  );
}

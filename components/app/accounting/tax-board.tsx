"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { Callout } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { CheckBox } from "@/components/ui/check-box";
import { cardSurface } from "@/components/ui/card";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Field, control } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { ENTITY_TYPES, EXEMPT_LABELS, EXEMPT_REASONS, maskTaxId, TAX_CATEGORIES, TAX_CATEGORY_LABELS, TAX_NOTICE, type ExemptReason, type TaxCategory } from "@/lib/accounting/taxCore";
import { formatCentsAsCurrency } from "@/lib/money";
import { notify } from "@/lib/notify";

/**
 * LA-7.8 · January, without a spreadsheet: what each contractor was paid in the year (by payment
 * date), who needs a 1099, who is missing a W-9 or a tax ID — and the year by category for the
 * accountant. Figures only; the notice says so and cannot be closed.
 *
 * Foundation pass (2026-11-03): Contractors · By category · Buckets are the step's tabs on the title line
 * (`?view=`); the export is the header's Download and More; a contractor's tax details are their own page
 * (/app/tax/payee/[type]/[id]). The notice is the spec's legal wording, so it stays on screen in full on
 * every view — as plain text in the table's foot, never a tinted card.
 */
export type TaxRow = { payeeType: "partner" | "producer" | "vendor"; payeeId: string; displayName: string; nameOnForm: string; paidCents: number; profileId: string | null; address: string | null; entityType: string | null; exempt: ExemptReason | null; requires: boolean; missing: string[]; profile: { legalName: string | null; taxIdType: string; taxIdLast4: string | null; w9OnFile: boolean; exemptReason: ExemptReason | null } | null };
export type TaxData = {
  year: number; basis: "cash" | "accrual"; canReveal: boolean;
  contractors: { rows: TaxRow[]; under: TaxRow[]; requiringCount: number; missingCount: number; thresholdCents: number };
  totals: { taxCategory: TaxCategory; sourceType: string; sourceValue: string; amountCents: number; entries: number }[];
  map: { sourceType: string; sourceValue: string; defaultCategory: TaxCategory; category: TaxCategory; overridden: boolean }[];
};
export type TaxView = "contractors" | "categories" | "buckets";

const money = (c: number) => formatCentsAsCurrency(c);
const SOURCE_LABEL: Record<string, string> = { cost_entry_type: "Cost", expense_category: "Expense category", commission_entry_type: "Commission" };

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

/** The 1099 state of a contractor, as the list and their page show it. */
export function TaxState({ row }: { row: TaxRow }) {
  return row.exempt ? <StatusChip tone="neutral">Exempt: {EXEMPT_LABELS[row.exempt]}</StatusChip>
    : row.missing.length ? <StatusChip tone="warning">Missing {row.missing.join(", ")}</StatusChip>
    : <StatusChip tone="good">{row.profile?.w9OnFile ? "W-9 on file" : "Ready"}</StatusChip>;
}

const payeeHref = (r: TaxRow, year: number) => `/app/tax/payee/${r.payeeType}/${r.payeeId}?year=${year}`;

/** A contractor's page header: Reveal the tax ID (audited, for the roles allowed to). */
export function RevealTaxId({ profileId }: { profileId: string }) {
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (value) return <span className="inline-flex h-9 items-center rounded-[8px] border border-border px-3 font-mono text-sm">{value}</span>;
  return (
    <Button variant="outline" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        setValue((await post({ op: "reveal", profile_id: profileId })).value);
      } catch (err) {
        notify.fail(err instanceof Error ? err.message : "Not allowed");
      } finally {
        setBusy(false);
      }
    }}>Reveal tax ID</Button>
  );
}

/** A contractor's W-9 (LA-7.8): attach or replace it (an upload), and open the newest one. In the header's More. */
export function W9Actions({ profileId, hasFile, readOnly }: { profileId: string; hasFile: boolean; readOnly: boolean }) {
  const router = useRouter();
  const picker = useRef<HTMLInputElement>(null);
  const upload = async (file: File) => {
    const form = new FormData();
    form.set("profile", profileId);
    form.set("file", file);
    try {
      const res = await fetch("/api/app/accounting/tax/w9", { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "The file didn't upload");
      notify.done("W-9 attached");
      router.refresh();
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "The file didn't upload");
    }
  };
  return (
    <>
      <MoreMenu items={[
        hasFile && { label: "Open the W-9", href: `/api/app/accounting/tax/w9?profile=${profileId}` },
        !readOnly && { label: hasFile ? "Replace the W-9" : "Attach the W-9", onSelect: () => picker.current?.click() },
      ]} />
      <input ref={picker} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ""; }} />
    </>
  );
}

/** A contractor's tax details (LA-7.8): legal name, tax ID (encrypted, shown masked), entity, address, W-9, exemption. */
export function ProfileForm({ row, year, readOnly }: { row: TaxRow; year: number; readOnly: boolean }) {
  const router = useRouter();
  const p = row.profile;
  const blank = { legal: p?.legalName ?? "", type: p?.taxIdType ?? "none", taxId: "", entity: row.entityType ?? "", line1: "", line2: "", city: "", state: "", postal: "", w9: p?.w9OnFile ?? false, exempt: (p?.exemptReason ?? "") as ExemptReason | "" };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = useRef<HTMLFormElement>(null);
  const dirty = JSON.stringify(f) !== JSON.stringify(blank);
  const save = async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await post({ op: "save_profile", payee_type: row.payeeType, payee_id: row.payeeId, legal_name: f.legal || null, tax_id_type: f.type, tax_id: f.taxId || null, entity_type: f.entity || null,
        address_line1: f.line1 || null, address_line2: f.line2 || null, city: f.city || null, state: f.state || null, postal_code: f.postal || null, country: "US", w9_on_file: f.w9, exempt_reason: f.exempt || null });
      notify.done("Tax details saved");
      router.push(`/app/tax?year=${year}`);
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
    <form ref={scope} onSubmit={submit} className={`${cardSurface} flex flex-col gap-5 p-5`}>
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
          <label className="flex items-center gap-3 text-sm"><CheckBox checked={f.w9} onChange={(e) => setF({ ...f, w9: e.target.checked })} /><span><span className="font-medium">I have their signed W-9</span><span className="block text-xs text-muted-foreground">Attach the file from More › Attach the W-9.</span></span></label>
        </section>
        <section className={section}>
          <h2 className={heading}>3 · Where to mail it</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="Street" htmlFor="tax-line1" className="sm:col-span-2"><input id="tax-line1" className={control} maxLength={200} value={f.line1} onChange={(e) => setF({ ...f, line1: e.target.value })} placeholder={row.address ?? "Street and number"} /></Field>
            <Field label="City" htmlFor="tax-city"><input id="tax-city" className={control} maxLength={100} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="State" htmlFor="tax-state"><input id="tax-state" className={control} maxLength={2} placeholder="TX" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value.toUpperCase() })} /></Field>
              <Field label="ZIP" htmlFor="tax-zip"><input id="tax-zip" className={control} maxLength={10} value={f.postal} onChange={(e) => setF({ ...f, postal: e.target.value })} /></Field>
            </div>
          </div>
        </section>
      </fieldset>
      {error ? <Callout tone="error" title={error} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <TaxNotice />
        {!readOnly ? <span className="flex shrink-0 gap-2"><Button type="button" variant="ghost" disabled={!dirty || busy} onClick={() => setF(blank)}>Discard</Button><Button type="submit" disabled={busy || !dirty}>{busy ? "Saving…" : "Save tax details"}</Button></span> : null}
      </div>
      <LeaveGuard dirty={dirty && !busy} scope={scope} onSave={save} onDiscard={() => setF(blank)} what={`the tax details of ${row.nameOnForm}`} />
    </form>
  );
}

export function TaxBoard({ data, view, readOnly }: { data: TaxData; view: TaxView; readOnly: boolean }) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  // Like Bank deposits (/ui-taste pass, owner 2026-11-09): chips by where each person stands for January.
  const [who, setWho] = useState<"all" | "missing" | "ready">("all");
  const pageSize = useFittingPageSize(520, 52);
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());
  const years = Array.from({ length: 4 }, (_, i) => new Date().getUTCFullYear() - i);
  const byCategory = new Map<TaxCategory, number>();
  for (const t of data.totals) byCategory.set(t.taxCategory, (byCategory.get(t.taxCategory) ?? 0) + t.amountCents);
  const c = data.contractors;
  const needle = q.trim().toLowerCase();
  const standing = (r: TaxRow) => (r.missing.length && !r.exempt ? "missing" : "ready");
  const people = c.rows.filter((r) => (who === "all" || standing(r) === who) && (!needle || r.nameOnForm.toLowerCase().includes(needle) || r.displayName.toLowerCase().includes(needle)));
  const shown = paginate(people, page, pageSize);
  const yearHref = (year: string) => `/app/tax?year=${year}${view === "contractors" ? "" : `&view=${view}`}`;
  const foot = <div className="flex w-full flex-wrap items-center justify-between gap-3"><TaxNotice />{view === "contractors" && people.length > pageSize ? <Pager page={shown.current} total={people.length} noun="contractors" pageSize={pageSize} onPage={setPage} /> : null}</div>;
  return (
    <>
      {/* The 1099 figures belong to Contractors; the other views fit the screen without them (owner 2026-11-03). */}
      {view === "contractors" ? (
        <>
          <StatStrip label="Tax figures">
            <StatTile label={`Requiring a 1099 (${data.year})`} value={String(c.requiringCount)} footnote={`paid ${money(c.thresholdCents)} or more`} href={`/app/tax?year=${data.year}`} />
            <StatTile label="Missing details" value={String(c.missingCount)} valueTone={c.missingCount ? "warning" : undefined} footnote="W-9, tax ID or legal name" href={`/app/tax?year=${data.year}`} />
            <StatTile label="Under the threshold" value={String(c.under.length)} footnote="excluded" />
          </StatStrip>
        </>
      ) : null}
      <TableCard toolbar={
        <DataToolbar actions={<>
          <select aria-label="Year" className={toolbarControl} value={data.year} onChange={(e) => router.push(yearHref(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
          <RefreshButton onClick={refresh} refreshing={refreshing} />
        </>}>
          {view === "contractors" ? <>
            <ToolbarSearch value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search name" />
            <Segmented label="Who" value={who} onChange={(k) => { setWho(k); setPage(1); }} options={[
              { key: "all", label: "All", count: c.rows.length },
              { key: "missing", label: "Missing details", count: c.rows.filter((r) => standing(r) === "missing").length || null, tone: "danger" },
              { key: "ready", label: "Ready", count: c.rows.filter((r) => standing(r) === "ready").length || null },
            ]} />
          </> : null}
        </DataToolbar>
      } footer={foot}>
        {view === "contractors" ? (
          c.rows.length === 0 ? <EmptyState title={`Nobody over ${money(c.thresholdCents)} in ${data.year}`} hint="Payments to partners, producers and lead vendors are counted here as they are marked paid." />
            : people.length === 0 ? <NoMatches noun="contractors" onClear={() => setQ("")} /> : (
            <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
              <thead><tr><th className="w-[30%]">Name on the form</th><th className="w-[16%]">Tax ID</th><th className="w-[14%] text-right">Paid</th><th className="w-[20%]">1099</th><th>Next step</th></tr></thead>
              <tbody>
                {shown.rows.map((r) => (
                  <tr key={`${r.payeeType}-${r.payeeId}`} className="cursor-pointer" onClick={() => router.push(payeeHref(r, data.year))}>
                    <td><Link className="font-medium hover:underline" href={payeeHref(r, data.year)} onClick={(e) => e.stopPropagation()}>{r.nameOnForm}</Link><div className="text-xs text-muted-foreground">{r.displayName} · {r.payeeType}</div></td>
                    <td className="tabular-nums">{maskTaxId(r.profile?.taxIdType ?? "none", r.profile?.taxIdLast4 ?? null)}</td>
                    <td className="text-right tabular-nums">{money(r.paidCents)}</td>
                    <td><TaxState row={r} /></td>
                    <td>{!readOnly && standing(r) === "missing" ? <Button size="sm" variant="outline" asChild><Link href={payeeHref(r, data.year)} onClick={(e) => e.stopPropagation()}>Add {r.missing[0]}</Link></Button> : <span className="text-sm text-muted-foreground">Ready for January</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : view === "categories" ? (
          byCategory.size === 0 ? <EmptyState title={`Nothing recorded in ${data.year}`} hint="The year's commission and costs are summed here by tax category." /> : (
            <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
              <thead><tr><th>Category</th><th className="text-right">{data.year}, {data.basis} basis</th></tr></thead>
              <tbody>{TAX_CATEGORIES.filter((k) => byCategory.has(k)).map((k) => <tr key={k}><td>{TAX_CATEGORY_LABELS[k]}</td><td className="text-right tabular-nums">{money(byCategory.get(k) ?? 0)}</td></tr>)}</tbody>
            </table>
          )
        ) : (
          <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
            <thead><tr><th>Kind of money</th><th className="w-[260px]">Tax category</th></tr></thead>
            <tbody>
              {data.map.map((m) => (
                <tr key={`${m.sourceType}-${m.sourceValue}`}>
                  <td>{SOURCE_LABEL[m.sourceType]}: {m.sourceValue.replace(/_/g, " ")}{m.overridden ? <span className="text-xs text-muted-foreground"> · yours (default: {TAX_CATEGORY_LABELS[m.defaultCategory]})</span> : null}</td>
                  <td><select aria-label="Category" className={toolbarControl} disabled={readOnly} value={m.category} onChange={(e) => void post({ op: "set_category", source_type: m.sourceType, source_value: m.sourceValue, tax_category: e.target.value }).then(() => { notify.done("Saved — it changes this view, not published payout runs"); refresh(); }).catch((err) => notify.fail(err.message))}>{TAX_CATEGORIES.map((k) => <option key={k} value={k}>{TAX_CATEGORY_LABELS[k]}</option>)}</select></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { DataToolbar, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { ViewTabs } from "@/components/ui/view-tabs";
import { ENTITY_TYPES, EXEMPT_LABELS, EXEMPT_REASONS, maskTaxId, TAX_CATEGORIES, TAX_CATEGORY_LABELS, TAX_NOTICE, type ExemptReason, type TaxCategory } from "@/lib/accounting/taxCore";
import { formatCentsAsCurrency } from "@/lib/money";
import { notify } from "@/lib/notify";
import { fieldLabel } from "@/components/ui/field";

/**
 * LA-7.8 · January, without a spreadsheet: what each contractor was paid in the year (by payment
 * date), who needs a 1099, who is missing a W-9 or a tax ID — and the year by category for the
 * accountant. Figures only; the notice says so and cannot be closed.
 */
type Row = { payeeType: "partner" | "producer" | "vendor"; payeeId: string; displayName: string; nameOnForm: string; paidCents: number; profileId: string | null; address: string | null; entityType: string | null; exempt: ExemptReason | null; requires: boolean; missing: string[]; profile: { legalName: string | null; taxIdType: string; taxIdLast4: string | null; w9OnFile: boolean; exemptReason: ExemptReason | null } | null };
export type TaxData = {
  year: number; basis: "cash" | "accrual"; canReveal: boolean;
  contractors: { rows: Row[]; under: Row[]; requiringCount: number; missingCount: number; thresholdCents: number };
  totals: { taxCategory: TaxCategory; sourceType: string; sourceValue: string; amountCents: number; entries: number }[];
  map: { sourceType: string; sourceValue: string; defaultCategory: TaxCategory; category: TaxCategory; overridden: boolean }[];
};

const money = (c: number) => formatCentsAsCurrency(c);
const SOURCE_LABEL: Record<string, string> = { cost_entry_type: "Cost", expense_category: "Expense category", commission_entry_type: "Commission" };

async function post(body: unknown) {
  const res = await fetch("/api/app/accounting/tax", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? "That didn't save");
  return json;
}

/** The notice, on every tax screen: no close button, no setting to hide it. */
export function TaxNotice() {
  return <p role="note" className="rounded-lg border border-[var(--warning)] bg-[var(--warning-surface)] px-3 py-2 text-sm text-[var(--warning-ink)]">{TAX_NOTICE}</p>;
}

function ProfileDialog({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void }) {
  const p = row.profile;
  const [f, setF] = useState({ legal: p?.legalName ?? "", type: p?.taxIdType ?? "none", taxId: "", entity: row.entityType ?? "", line1: "", line2: "", city: "", state: "", postal: "", w9: p?.w9OnFile ?? false, exempt: (p?.exemptReason ?? "") as ExemptReason | "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post({ op: "save_profile", payee_type: row.payeeType, payee_id: row.payeeId, legal_name: f.legal || null, tax_id_type: f.type, tax_id: f.taxId || null, entity_type: f.entity || null,
        address_line1: f.line1 || null, address_line2: f.line2 || null, city: f.city || null, state: f.state || null, postal_code: f.postal || null, country: "US", w9_on_file: f.w9, exempt_reason: f.exempt || null });
      notify.done("Tax details saved");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  // The shared stacked label (foundation v3: 13/500 over the control).
  const field = fieldLabel;
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[620px]">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader><DialogTitle>Tax details — {row.displayName}</DialogTitle><DialogDescription>The legal name goes on the form; it is often not the name you know them by. The tax ID is encrypted and shown masked.</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={`${field} sm:col-span-2`}>Legal name<input className={toolbarControl} maxLength={200} value={f.legal} onChange={(e) => setF({ ...f, legal: e.target.value })} placeholder="e.g. Apex Communications LLC" /></label>
            <label className={field}>Tax ID type<select className={toolbarControl} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="ein">EIN</option><option value="ssn">SSN</option><option value="foreign">Foreign</option><option value="none">None on file</option></select></label>
            <label className={field}>{p?.taxIdLast4 ? `Replace ${maskTaxId(p.taxIdType, p.taxIdLast4)}` : "Tax ID"}<input className={toolbarControl} autoComplete="off" disabled={f.type === "none"} value={f.taxId} onChange={(e) => setF({ ...f, taxId: e.target.value })} placeholder={p?.taxIdLast4 ? "Leave blank to keep" : ""} /></label>
            <label className={field}>Entity<select className={toolbarControl} value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })}><option value="">Not known</option>{ENTITY_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</select></label>
            <label className={field}>Exempt from a 1099<select className={toolbarControl} value={f.exempt} onChange={(e) => setF({ ...f, exempt: e.target.value as ExemptReason | "" })}><option value="">Not exempt</option>{EXEMPT_REASONS.map((r) => <option key={r} value={r}>{EXEMPT_LABELS[r]}</option>)}</select></label>
            <label className={`${field} sm:col-span-2`}>Address<input className={toolbarControl} maxLength={200} value={f.line1} onChange={(e) => setF({ ...f, line1: e.target.value })} placeholder={row.address ?? "Street"} /></label>
            <label className={field}>City<input className={toolbarControl} maxLength={100} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></label>
            <div className="grid grid-cols-2 gap-2"><label className={field}>State<input className={toolbarControl} maxLength={2} value={f.state} onChange={(e) => setF({ ...f, state: e.target.value.toUpperCase() })} /></label><label className={field}>ZIP<input className={toolbarControl} maxLength={10} value={f.postal} onChange={(e) => setF({ ...f, postal: e.target.value })} /></label></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.w9} onChange={(e) => setF({ ...f, w9: e.target.checked })} />W-9 on file</label>
          </div>
          {error ? <p role="alert" className="text-sm text-[var(--error-ink)]">{error}</p> : null}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TaxBoard({ data, readOnly }: { data: TaxData; readOnly: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<"contractors" | "categories" | "export">("contractors");
  const [editing, setEditing] = useState<Row | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(520, 45);
  const [, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());
  const years = Array.from({ length: 4 }, (_, i) => new Date().getUTCFullYear() - i);
  const reveal = async (profileId: string) => {
    try {
      const json = await post({ op: "reveal", profile_id: profileId });
      setRevealed((r) => ({ ...r, [profileId]: json.value }));
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "Not allowed");
    }
  };
  const byCategory = new Map<TaxCategory, number>();
  for (const t of data.totals) byCategory.set(t.taxCategory, (byCategory.get(t.taxCategory) ?? 0) + t.amountCents);
  const c = data.contractors;
  const shown = paginate(c.rows, page, pageSize);
  return (
    <>
      <TaxNotice />
      <StatStrip label="Tax figures">
        <StatTile label={`Requiring a 1099 (${data.year})`} value={String(c.requiringCount)} footnote={`paid ${money(c.thresholdCents)} or more`} />
        <StatTile label="Missing details" value={String(c.missingCount)} valueTone={c.missingCount ? "warning" : undefined} footnote="W-9, tax ID or legal name — easier to chase now" />
        <StatTile label="Under the threshold" value={String(c.under.length)} footnote="excluded" />
      </StatStrip>
      <ViewTabs label="Tax views" value={tab} onChange={setTab} tabs={[{ key: "contractors", label: "Contractors", count: c.rows.length }, { key: "categories", label: "By category" }, { key: "export", label: "Export" }]} />
      <TableCard toolbar={
        <DataToolbar>
          <select aria-label="Year" className={toolbarControl} value={data.year} onChange={(e) => router.push(`/app/tax?year=${e.target.value}`)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
          <span className="text-sm text-muted-foreground">{tab === "contractors" ? "Paid in the calendar year, by the date money moved." : `${data.basis === "cash" ? "Cash" : "Accrual"} basis, as your P&L.`}</span>
        </DataToolbar>
      } footer={tab === "contractors" && c.rows.length ? <Pager page={shown.current} total={c.rows.length} noun="contractors" pageSize={pageSize} onPage={setPage} /> : undefined}>
        {tab === "contractors" ? (
          c.rows.length === 0 ? <EmptyState title={`Nobody over ${money(c.thresholdCents)} in ${data.year}`} hint="Payments to partners, producers and lead vendors are counted here as they are marked paid." /> : (
            <table className="portal-lead-table w-full min-w-[900px] text-left text-sm">
              <thead><tr><th>Name on the form</th><th className="w-[170px]">Tax ID</th><th className="w-[130px] text-right">Paid</th><th className="w-[230px]">1099</th><th className="w-[100px] text-right" /></tr></thead>
              <tbody>
                {shown.rows.map((r) => (
                  <tr key={`${r.payeeType}-${r.payeeId}`}>
                    <td><div className="font-medium">{r.nameOnForm}</div><div className="text-xs text-muted-foreground">{r.displayName} · {r.payeeType}</div></td>
                    <td>{r.profileId && revealed[r.profileId] ? <span className="font-mono">{revealed[r.profileId]}</span> : maskTaxId(r.profile?.taxIdType ?? "none", r.profile?.taxIdLast4 ?? null)}{r.profileId && r.profile?.taxIdLast4 && data.canReveal && !revealed[r.profileId] ? <Button size="sm" variant="ghost" onClick={() => void reveal(r.profileId!)}>Reveal</Button> : null}</td>
                    <td className="text-right tabular-nums">{money(r.paidCents)}</td>
                    <td>{r.exempt ? <StatusChip tone="neutral">Exempt: {EXEMPT_LABELS[r.exempt]}</StatusChip> : r.missing.length ? <StatusChip tone="warning">Missing {r.missing.join(", ")}</StatusChip> : <StatusChip tone="good">{r.profile?.w9OnFile ? "W-9 on file" : "Ready"}</StatusChip>}</td>
                    <td className="text-right">{!readOnly ? <Button size="sm" variant="outline" onClick={() => setEditing(r)}>Details</Button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : tab === "categories" ? (
          <table className="portal-lead-table w-full min-w-[800px] text-left text-sm">
            <thead><tr><th>Category</th><th className="w-[160px] text-right">{data.year}</th></tr></thead>
            <tbody>{TAX_CATEGORIES.filter((k) => byCategory.has(k)).map((k) => <tr key={k}><td>{TAX_CATEGORY_LABELS[k]}</td><td className="text-right tabular-nums">{money(byCategory.get(k) ?? 0)}</td></tr>)}</tbody>
            <tbody>
              <tr><td colSpan={2} className="pt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Which bucket each kind of money goes into — a suggestion you can change</td></tr>
              {data.map.map((m) => (
                <tr key={`${m.sourceType}-${m.sourceValue}`}>
                  <td>{SOURCE_LABEL[m.sourceType]}: {m.sourceValue.replace(/_/g, " ")}{m.overridden ? <span className="text-xs text-muted-foreground"> · yours (default: {TAX_CATEGORY_LABELS[m.defaultCategory]})</span> : null}</td>
                  <td className="text-right"><select aria-label="Category" className={toolbarControl} disabled={readOnly} value={m.category} onChange={(e) => void post({ op: "set_category", source_type: m.sourceType, source_value: m.sourceValue, tax_category: e.target.value }).then(() => { notify.done("Saved — it changes this view, not published payout runs"); refresh(); }).catch((err) => notify.fail(err.message))}>{TAX_CATEGORIES.map((k) => <option key={k} value={k}>{TAX_CATEGORY_LABELS[k]}</option>)}</select></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="flex flex-col gap-3 p-4 text-sm">
            <p>The year as a spreadsheet your accountant can work from: totals per category, every transaction with its category, and contractor payments. A summary of recorded transactions — not a tax return, and nothing is filed.</p>
            <div className="flex flex-wrap gap-2">
              <a className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-primary-foreground" href={`/api/app/accounting/tax/export?year=${data.year}&format=xlsx`}>Download {data.year} (XLSX)</a>
              {(["totals", "transactions", "contractors"] as const).map((s) => <a key={s} className="inline-flex h-9 items-center rounded-md border border-input px-3" href={`/api/app/accounting/tax/export?year=${data.year}&format=csv&sheet=${s}`}>{s[0].toUpperCase() + s.slice(1)} (CSV)</a>)}
            </div>
          </div>
        )}
      </TableCard>
      {editing ? <ProfileDialog row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} /> : null}
    </>
  );
}

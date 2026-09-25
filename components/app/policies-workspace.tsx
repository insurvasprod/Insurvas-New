"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Search, SlidersHorizontal, Upload } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState, LoadingRows } from "@/components/ui/page-states";
import { StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { RecordLapseSignal } from "@/components/app/record-lapse-signal";
import { parsePolicyCsv, policyCsvTemplate, type PolicyImportRow } from "@/lib/policies/csv";

type Policy = PolicyImportRow & { id: string; source: "manual" | "csv"; created_at: string; updated_at: string };
type Metrics = { active: number; annualPremiumCents: number; carriers: number; renewalsDue: number };
type FormState = Omit<PolicyImportRow, "annual_premium_cents"> & { annual_premium: string };
const blankForm: FormState = { policy_number: "", insured_name: "", carrier: "", product: "", effective_date: "", annual_premium: "", status: "active", renewal_date: "" };
const PAGE_SIZE = 25;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function money(cents: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(cents / 100); }
/** "$2.41M" for the tile once the book is big enough that cents are noise. */
function compactMoney(cents: number) { return cents >= 100_000_000 ? `$${(cents / 100_000_000).toFixed(2)}M` : cents >= 10_000_000 ? `$${Math.round(cents / 100_000)}K` : money(cents); }
/** "22 Sep 2026", as the board dates a policy. */
function date(value: string) { const [y, m, d] = value.split("-").map(Number); return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : value; }
const STATUS: Record<Policy["status"], { label: string; tone: StatusTone }> = {
  active: { label: "Active", tone: "good" },
  pending: { label: "Pending", tone: "warning" },
  lapsed: { label: "Lapsed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const control = "box-border inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-card px-3.5 text-sm font-semibold leading-[1.43] tracking-[-0.01em] text-foreground";
const field = "h-10 w-full rounded-lg border border-[var(--border-strong)] bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";
const th = "bg-[var(--surface-alt)] px-3 py-2 text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground";
const td = "border-t border-border px-3 py-2 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]";
const label = "text-sm font-semibold text-[var(--body)]";

/**
 * Policies (p-app-policies): the book of business — four figures, one control bar, one table.
 *
 * The board's header offers the CSV template and Import policies; Add policy stays beside them,
 * because entering one policy by hand is a thing people do and the board has nowhere else for it.
 * Every policy row keeps its "Record a lapse signal" action (record-lapse-signal.tsx), which is how
 * a policy reaches /app/lapse-risk. There is no delete: a policy is a record.
 */
export function PoliciesWorkspace({ readOnly, eyebrow }: { readOnly: boolean; eyebrow?: string }) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [metrics, setMetrics] = useState<Metrics>({ active: 0, annualPremiumCents: 0, carriers: 0, renewalsDue: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [carrier, setCarrier] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<"manual" | "import" | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [file, setFile] = useState<{ name: string; rows: PolicyImportRow[]; errors: Array<{ row: number; message: string }> } | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/app/policies", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load policies");
      setPolicies(body.policies ?? []); setMetrics(body.metrics ?? { active: 0, annualPremiumCents: 0, carriers: 0, renewalsDue: 0 });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load policies"); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!filtersOpen) return;
    const onPointer = (event: MouseEvent) => { if (filtersRef.current && !filtersRef.current.contains(event.target as Node)) setFiltersOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setFiltersOpen(false); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [filtersOpen]);

  const carriers = useMemo(() => [...new Set(policies.map((policy) => policy.carrier))].sort((a, b) => a.localeCompare(b)), [policies]);
  // Newest first: the API orders by effective date, most recent first.
  const filtered = useMemo(() => policies.filter((policy) => {
    const haystack = `${policy.policy_number} ${policy.insured_name} ${policy.carrier} ${policy.product}`.toLowerCase();
    return (!query || haystack.includes(query.toLowerCase())) && (!carrier || policy.carrier === carrier) && (status === "all" || policy.status === status);
  }), [policies, query, carrier, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const shown = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  function openManual() { setForm(blankForm); setMode("manual"); }
  function openImport() { setFile(null); setMode("import"); }
  function downloadTemplate() {
    const blob = new Blob([policyCsvTemplate()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "insurvas-policy-template.csv"; anchor.click(); URL.revokeObjectURL(url);
  }
  async function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0]; if (!chosen) return;
    const parsed = parsePolicyCsv(await chosen.text());
    setFile({ name: chosen.name, rows: parsed.rows, errors: parsed.errors });
  }
  async function saveManual(event: React.FormEvent) {
    event.preventDefault();
    const cents = Math.round(Number(form.annual_premium.replace(/[$,\s]/g, "")) * 100);
    if (!Number.isFinite(cents) || cents < 0) { notify.block("Annual premium is a dollar amount, like 1,200.00."); return; }
    setSaving(true);
    const payload = { policy_number: form.policy_number, insured_name: form.insured_name, carrier: form.carrier, product: form.product, effective_date: form.effective_date, annual_premium_cents: cents, status: form.status, renewal_date: form.renewal_date || null };
    try {
      const response = await fetch("/api/app/policies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error ?? "Could not add policy");
      notify.win("Policy added to your book of business"); setMode(null); await load();
    } catch (cause) { notify.fail(cause instanceof Error ? cause.message : "Could not add policy"); }
    finally { setSaving(false); }
  }
  async function importPolicies(event: React.FormEvent) {
    event.preventDefault(); if (!file || file.errors.length || !file.rows.length) return;
    setSaving(true);
    try {
      const response = await fetch("/api/app/policies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ policies: file.rows }) });
      const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error ?? "Could not import policies");
      notify.done(`${file.rows.length.toLocaleString()} polic${file.rows.length === 1 ? "y" : "ies"} imported`); setMode(null); await load();
    } catch (cause) { notify.fail(cause instanceof Error ? cause.message : "Could not import policies"); }
    finally { setSaving(false); }
  }

  const filterCount = status !== "all" ? 1 : 0;

  return <div className="m-stagger flex flex-col gap-6">
    <PageHeader
      eyebrow={eyebrow}
      title="Policies"
      description="The book of business."
      actions={<>
        {readOnly && <StatusChip tone="warning">Read-only</StatusChip>}
        <Button type="button" variant="outline" className="h-11 border-[var(--border-strong)] px-4" onClick={downloadTemplate}>Download CSV template</Button>
        <Button type="button" variant="outline" className="h-11 border-[var(--border-strong)] px-4" disabled={readOnly} onClick={openManual}>Add policy</Button>
        <Button type="button" className="h-11 px-4" disabled={readOnly} onClick={openImport}>Import policies</Button>
      </>}
    />

    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Book of business summary">
      <StatTile label="Active policies" value={loading ? "…" : metrics.active.toLocaleString()} footnote={`across ${metrics.carriers} ${metrics.carriers === 1 ? "carrier" : "carriers"}`} />
      <StatTile label="Annual premium" value={loading ? "…" : compactMoney(metrics.annualPremiumCents)} footnote="in force" />
      <StatTile label="Carriers" value={loading ? "…" : metrics.carriers} footnote="with an active policy" />
      <StatTile label="Renewals due" value={loading ? "…" : metrics.renewalsDue} valueTone={metrics.renewalsDue ? "warning" : undefined} footnote="next 30 days" />
    </section>

    <div className="relative z-30 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
      <select aria-label="Carrier" className={`${control} pr-8`} value={carrier} onChange={(event) => { setCarrier(event.target.value); setPage(0); }}>
        <option value="">All carriers</option>
        {carriers.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      <span className="box-border flex h-10 w-full items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-card px-3 text-muted-foreground sm:w-[248px]">
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <input type="search" aria-label="Search customer, policy" placeholder="Search customer, policy" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} className="min-w-0 flex-grow border-0 bg-transparent text-sm tracking-[-0.02em] text-foreground outline-none" />
      </span>
      <div className="relative" ref={filtersRef}>
        <button type="button" className={control} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>
          <SlidersHorizontal className="size-4" aria-hidden="true" />Filters
          {filterCount > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--surface-alt)] px-1.5 text-xs font-semibold tabular-nums text-foreground">{filterCount}</span>}
        </button>
        {filtersOpen && <div className="absolute left-0 top-[calc(100%+6px)] z-20 grid w-[220px] gap-2 rounded-xl border border-border bg-card p-3.5 shadow-[0_12px_32px_rgba(0,0,0,.16)]" role="group" aria-label="Filter policies">
          <label htmlFor="policies-status" className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">Status</label>
          <select id="policies-status" aria-label="Filter policies by status" className={`${field} h-9`} value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}>
            <option value="all">All statuses</option><option value="active">Active</option><option value="pending">Pending</option><option value="lapsed">Lapsed</option><option value="cancelled">Cancelled</option>
          </select>
        </div>}
      </div>
    </div>

    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Policies">
      {loading ? <LoadingRows rows={4} columns={6} />
        : error ? <ErrorState title="Policies could not be loaded" detail={error} action={<Button type="button" variant="outline" onClick={() => void load()}>Try again</Button>} />
        : policies.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-12 text-center sm:py-16">
            <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-foreground">No policies yet</h2>
            <p className="mt-2 max-w-xl text-sm leading-normal text-muted-foreground">Your book of business appears here once policies are imported or added. Download the CSV template, import a carrier file, or add a policy by hand.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button type="button" variant="outline" className="border-[var(--border-strong)]" onClick={downloadTemplate}>Download CSV template</Button>
              <Button type="button" variant="outline" className="border-[var(--border-strong)]" disabled={readOnly} onClick={openManual}>Add a policy</Button>
              <Button type="button" disabled={readOnly} onClick={openImport}>Import policies</Button>
            </div>
            {readOnly && <p className="mt-4 text-xs font-semibold text-[var(--warning-ink)]">Viewing historical data remains available, but adding policies is disabled while the account is suspended.</p>}
          </div>
        ) : <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] table-fixed border-collapse text-left">
              <thead><tr>
                <th className={th}>Customer</th>
                <th className={`${th} w-[160px]`}>Carrier</th>
                <th className={`${th} w-[140px]`}>Product</th>
                <th className={`${th} w-[150px]`}>Policy</th>
                <th className={`${th} w-[120px]`}>Effective</th>
                <th className={`${th} w-[140px] text-right`}>Annual premium</th>
                <th className={`${th} w-[190px]`}>Status</th>
              </tr></thead>
              <tbody>
                {shown.map((policy) => <tr key={policy.id} className="m-row">
                  <td className={`${td} font-semibold text-foreground`}>{policy.insured_name}</td>
                  <td className={td}>{policy.carrier}</td>
                  <td className={td}>{policy.product}</td>
                  <td className={td}><span className="block tabular-nums">{policy.policy_number}</span><span className="block text-xs text-muted-foreground">{policy.source === "csv" ? "Imported" : "Manual entry"}</span></td>
                  <td className={`${td} tabular-nums`}>{date(policy.effective_date)}</td>
                  <td className={`${td} text-right tabular-nums`}>{money(policy.annual_premium_cents)}</td>
                  <td className={td}><span className="flex flex-wrap items-center gap-2"><StatusChip tone={STATUS[policy.status].tone}>{STATUS[policy.status].label}</StatusChip><RecordLapseSignal policy={policy} /></span></td>
                </tr>)}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && <p className="border-t border-border px-4 py-8 text-center text-sm text-muted-foreground">No policies match these filters.</p>}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border bg-[var(--canvas)] px-4 py-3 text-xs leading-normal text-muted-foreground">
            <span>{filtered.length ? `Showing ${currentPage * PAGE_SIZE + 1}–${currentPage * PAGE_SIZE + shown.length} of ${filtered.length.toLocaleString()} ${filtered.length === 1 ? "policy" : "policies"} · newest first` : "Nothing to show"}</span>
            <span className="flex gap-2">
              <Button type="button" variant="outline" className="h-8 border-[var(--border-strong)] px-4" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
              <Button type="button" variant="outline" className="h-8 border-[var(--border-strong)] px-4" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</Button>
            </span>
          </div>
        </>}
    </section>

    <div className="rounded-xl border border-border border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] px-4 py-3.5">
      <p className="text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--info-ink)]">A policy is a record, so there is no delete</p>
      <p className="mt-1.5 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">Policies are kept with their history, and the lapse signals recorded against them point at them. Import policies is the one way in for a carrier file — the three buttons that used to open it under three different names are one now.</p>
    </div>

    <Dialog open={mode === "import"} onOpenChange={(open) => { if (!open) setMode(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import policies</DialogTitle>
          <DialogDescription>Every row is checked before anything is written to your book.</DialogDescription>
        </DialogHeader>
        <form onSubmit={importPolicies} className="grid gap-4">
          <label className="grid justify-items-center gap-2 rounded-xl border border-dashed border-[var(--border-strong)] px-4 py-6 text-center">
            <Upload className="size-5 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm font-semibold text-foreground">{file ? file.name : "Choose a policy CSV"}</span>
            <span className="text-xs text-muted-foreground">Required: policy number, insured, carrier, product, effective date, annual premium.</span>
            <input type="file" accept=".csv,text/csv" onChange={(event) => void chooseFile(event)} className="text-sm" />
          </label>
          {file && <div className="flex flex-wrap gap-3 text-sm" role="status">
            <span className="inline-flex items-center gap-1.5 text-[var(--success-ink)]"><Check className="size-4" aria-hidden="true" />{file.rows.length} valid row{file.rows.length === 1 ? "" : "s"}</span>
            {file.errors.length > 0 && <span className="inline-flex items-center gap-1.5 text-[var(--error-ink)]"><AlertTriangle className="size-4" aria-hidden="true" />{file.errors.length} error{file.errors.length === 1 ? "" : "s"}</span>}
          </div>}
          {file?.errors.length ? <ul className="grid gap-1 rounded-lg bg-[var(--error-surface)] px-4 py-3 text-sm text-[var(--error-ink)]">{file.errors.slice(0, 8).map((item) => <li key={`${item.row}-${item.message}`}>Row {item.row}: {item.message}</li>)}{file.errors.length > 8 && <li>…and {file.errors.length - 8} more</li>}</ul> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMode(null)}>Cancel</Button>
            <Button type="submit" disabled={!file || !file.rows.length || Boolean(file.errors.length) || saving}>{saving ? "Importing…" : "Import policies"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog open={mode === "manual"} onOpenChange={(open) => { if (!open) setMode(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a policy</DialogTitle>
          <DialogDescription>The same fields the CSV import reads.</DialogDescription>
        </DialogHeader>
        <form onSubmit={saveManual} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5"><span className={label}>Policy number</span><input required className={field} value={form.policy_number} onChange={(event) => setForm({ ...form, policy_number: event.target.value })} /></label>
            <label className="grid gap-1.5"><span className={label}>Insured name</span><input required className={field} value={form.insured_name} onChange={(event) => setForm({ ...form, insured_name: event.target.value })} /></label>
            <label className="grid gap-1.5"><span className={label}>Carrier</span><input required className={field} value={form.carrier} onChange={(event) => setForm({ ...form, carrier: event.target.value })} /></label>
            <label className="grid gap-1.5"><span className={label}>Product</span><input required placeholder="Term life" className={field} value={form.product} onChange={(event) => setForm({ ...form, product: event.target.value })} /></label>
            <label className="grid gap-1.5"><span className={label}>Effective date</span><input type="date" required className={field} value={form.effective_date} onChange={(event) => setForm({ ...form, effective_date: event.target.value })} /></label>
            <label className="grid gap-1.5"><span className={label}>Annual premium</span><input inputMode="decimal" required placeholder="1,200.00" className={`${field} tabular-nums`} value={form.annual_premium} onChange={(event) => setForm({ ...form, annual_premium: event.target.value })} /></label>
            <label className="grid gap-1.5"><span className={label}>Renewal date <span className="font-normal text-muted-foreground">optional</span></span><input type="date" className={field} value={form.renewal_date ?? ""} onChange={(event) => setForm({ ...form, renewal_date: event.target.value })} /></label>
            <label className="grid gap-1.5"><span className={label}>Status</span><select className={field} value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as FormState["status"] })}><option value="active">Active</option><option value="pending">Pending</option><option value="lapsed">Lapsed</option><option value="cancelled">Cancelled</option></select></label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMode(null)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Add policy"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}

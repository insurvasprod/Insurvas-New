"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Download, Plus, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { parsePolicyCsv, policyCsvTemplate, type PolicyImportRow } from "@/lib/policies/csv";
import { notify } from "@/lib/notify";

type FormState = Omit<PolicyImportRow, "annual_premium_cents"> & { annual_premium: string };
const blankForm: FormState = { policy_number: "", insured_name: "", carrier: "", product: "", effective_date: "", annual_premium: "", status: "active", renewal_date: "" };

const field = "h-9 w-full rounded-lg border border-[var(--border-strong)] bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";
const label = "text-sm font-semibold text-[var(--body)]";

/**
 * Policies › entering policies by hand (LA-0.7): the CSV template, Add policy and Import policies,
 * for a carrier that sends no file. They were the header of the "Entered by hand" tab; since the
 * 2026-10-08 overlap merge there is one Policies list, and what is entered here joins it with the
 * source "Entered by hand". Owner and producer, as the API (POST /api/app/policies) admits.
 */
export function PolicyEntryActions({ canAdd, blockedReason }: { canAdd: boolean; blockedReason?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"manual" | "import" | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [file, setFile] = useState<{ name: string; rows: PolicyImportRow[]; errors: Array<{ row: number; message: string }> } | null>(null);
  const [saving, setSaving] = useState(false);

  function downloadTemplate() {
    const blob = new Blob([policyCsvTemplate()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "insurvas-policy-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  async function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    const parsed = parsePolicyCsv(await chosen.text());
    setFile({ name: chosen.name, rows: parsed.rows, errors: parsed.errors });
  }
  async function send(body: unknown, done: string, fallback: string) {
    setSaving(true);
    try {
      const response = await fetch("/api/app/policies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? fallback);
      notify.done(done);
      setMode(null);
      router.refresh();
    } catch (cause) {
      notify.fail(cause instanceof Error ? cause.message : fallback);
    } finally {
      setSaving(false);
    }
  }
  function saveManual(event: React.FormEvent) {
    event.preventDefault();
    const cents = Math.round(Number(form.annual_premium.replace(/[$,\s]/g, "")) * 100);
    if (!Number.isFinite(cents) || cents < 0) { notify.block("Annual premium is a dollar amount, like 1,200.00."); return; }
    void send({ policy_number: form.policy_number, insured_name: form.insured_name, carrier: form.carrier, product: form.product, effective_date: form.effective_date, annual_premium_cents: cents, status: form.status, renewal_date: form.renewal_date || null }, "Policy added to your book of business", "Could not add policy");
  }
  function importPolicies(event: React.FormEvent) {
    event.preventDefault();
    if (!file || file.errors.length || !file.rows.length) return;
    void send({ policies: file.rows }, `${file.rows.length.toLocaleString()} polic${file.rows.length === 1 ? "y" : "ies"} imported`, "Could not import policies");
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={downloadTemplate}><Download aria-hidden="true" />Download CSV template</Button>
      <Button type="button" variant="outline" disabled={!canAdd} title={canAdd ? undefined : blockedReason} onClick={() => { setForm(blankForm); setMode("manual"); }}><Plus aria-hidden="true" />Add policy</Button>
      <Button type="button" disabled={!canAdd} title={canAdd ? undefined : blockedReason} onClick={() => { setFile(null); setMode("import"); }}><Upload aria-hidden="true" />Import policies</Button>

      <Dialog open={mode === "import"} onOpenChange={(open) => { if (!open) setMode(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import policies</DialogTitle>
            <DialogDescription>For a carrier that sends no file. Every row is checked before anything is written to your book.</DialogDescription>
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
            <DialogDescription>For a carrier that sends no file. The same fields the CSV import reads.</DialogDescription>
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
    </>
  );
}

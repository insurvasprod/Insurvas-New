"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";

import { Callout } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Field, control } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Segmented } from "@/components/ui/view-tabs";
import {
  CHARGEBACK_POLICIES, CHARGEBACK_POLICY_LABELS, LEDGER_SOURCE_LABELS, PARTNER_PAYMENT_METHODS, PARTNER_PAYMENT_METHOD_LABELS, PAYOUT_CADENCES,
  PAYOUT_CADENCE_LABELS, PAYOUT_CADENCE_SHORT, RULEBOOK_MODEL_COPY, RULEBOOK_MODELS, entryMath, parsePctToBp, pctLabel, rulebookRateLabel,
  type ChargebackPolicy, type PartnerPaymentMethod, type PayoutCadence, type RulebookModel,
} from "@/lib/accounting/partnerPayoutCore";
import type { InvoicePreview, LedgerRow, RulebookRow, RulebookView } from "@/lib/accounting/payoutStore";
import { formatCentsAsCurrency, parseDollarsToCents } from "@/lib/money";
import { notify } from "@/lib/notify";

/**
 * Partner payouts rework (owner, 2026-11-06) · the three new parts of Accounting › Partner payouts:
 *
 *   RunPayouts       the invoice machine's button: previews every partner whose pay schedule has ended,
 *                    then creates a draft invoice for each, its items locked so they are never paid twice.
 *   LedgerBoard      the ledger: every entry each partner earned, its client, how it was worked out, when
 *                    it is expected and where it stands (unpaid, on an invoice, PAID).
 *   RulebooksBoard   every partner's rulebook in one list; a row opens the rulebook form.
 *   RulebookForm     the rulebook as a form page: how they win, how much, when, who gets the money.
 * Nothing here moves money: the agency pays as it does today and records it.
 */
const money = (c: number) => formatCentsAsCurrency(c);
const dateLabel = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const today = () => new Date().toISOString().slice(0, 10);

async function send(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "That didn't save");
  return body;
}

// ─── Run payouts ──────────────────────────────────────────────────────────────────────────────
export function RunPayouts({ readOnly }: { readOnly: boolean }) {
  const router = useRouter();
  const [preview, setPreview] = useState<InvoicePreview[] | null>(null);
  const [busy, setBusy] = useState(false);
  if (readOnly) return null;
  const run = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const body = await send("/api/app/accounting/payouts/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dry_run: dryRun }) });
      const partners = body.partners as InvoicePreview[];
      if (dryRun) {
        if (!partners.length) notify.done("No partner is due: every finished pay period already has an invoice, or nothing is owed.");
        else setPreview(partners);
        return;
      }
      const built = partners.filter((p) => p.runId);
      const problems = partners.filter((p) => p.problem);
      setPreview(null);
      if (built.length) notify.done(`${built.length} draft invoice${built.length === 1 ? "" : "s"} created. Review, then publish each one.`);
      for (const p of problems) notify.fail(`${p.partnerName}: ${p.problem}`);
      if (built.length === 1) router.push(`/app/payouts/${built[0].runId}`);
      else router.refresh();
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button disabled={busy} onClick={() => void run(true)}>Run payouts</Button>
      {preview ? (
        <ConfirmDialog
          open onOpenChange={(next) => { if (!next) setPreview(null); }} busy={busy} destructive={false}
          title={`Create invoices for ${preview.length} partner${preview.length === 1 ? "" : "s"}?`}
          description="Each partner whose pay schedule has ended gets a draft invoice with every unpaid item. The items are locked to it, so they are never paid twice. Only you see a draft; nothing is paid from here."
          confirmLabel={`Create ${preview.length} invoice${preview.length === 1 ? "" : "s"}`} cancelLabel="Not now"
          onConfirm={() => void run(false)}
          fields={(
            <TableCard>
              <table className="portal-lead-table w-full text-left text-sm">
                <thead><tr><th>Partner</th><th>Pay period</th><th className="text-right">Items</th><th className="text-right">Net</th></tr></thead>
                <tbody>
                  {preview.map((p) => (
                    <tr key={p.partnerId}>
                      <td className="font-medium">{p.partnerName}</td>
                      <td className="tabular-nums">{dateLabel(p.periodStart)} – {dateLabel(p.periodEnd)}<span className="text-xs text-muted-foreground"> · {PAYOUT_CADENCE_SHORT[p.cadence] ?? p.cadence}</span></td>
                      <td className="text-right tabular-nums">{p.items}</td>
                      <td className={`text-right tabular-nums ${p.netCents < 0 ? "text-[var(--error-ink)]" : ""}`}>{money(p.netCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>
          )}
        />
      ) : null}
    </>
  );
}

// ─── the ledger ───────────────────────────────────────────────────────────────────────────────
type LedgerFilter = "" | "unpaid" | "invoiced" | "paid";
const STATE_TONE: Record<Exclude<LedgerFilter, "">, StatusTone> = { unpaid: "warning", invoiced: "info", paid: "good" };
const STATE_WORD: Record<Exclude<LedgerFilter, "">, string> = { unpaid: "Unpaid", invoiced: "On invoice", paid: "PAID" };

export function LedgerBoard({ rows, partners, initialState, initialPartner }: { rows: LedgerRow[]; partners: { id: string; name: string }[]; initialState?: string; initialPartner?: string }) {
  const router = useRouter();
  const [state, setState] = useState<LedgerFilter>(initialState === "unpaid" || initialState === "invoiced" || initialState === "paid" ? initialState : "");
  const [partner, setPartner] = useState(initialPartner && partners.some((p) => p.id === initialPartner) ? initialPartner : "");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refreshing, startRefresh] = useTransition();
  const term = search.trim().toLowerCase();
  const visible = useMemo(() => rows.filter((r) => (!state || r.state === state) && (!partner || r.partnerId === partner)
    && (!term || [r.partnerName, r.clientName ?? "", r.policyNumber ?? "", r.invoiceNumber ?? "", LEDGER_SOURCE_LABELS[r.sourceType] ?? ""].some((v) => v.toLowerCase().includes(term)))), [rows, state, partner, term]);
  const pageSize = useFittingPageSize(500, 45);
  const shown = paginate(visible, page, pageSize);
  const month = today().slice(0, 7);
  const unpaid = rows.filter((r) => r.state === "unpaid");
  const invoiced = rows.filter((r) => r.state === "invoiced");
  const paidThisMonth = rows.filter((r) => r.state === "paid" && (r.paidAt ?? "").startsWith(month));
  const clawbacks = unpaid.filter((r) => r.sourceType === "chargeback_clawback");
  const sum = (list: LedgerRow[]) => list.reduce((s, r) => s + r.amountCents, 0);
  const pick = (next: LedgerFilter) => { setState(next); setPage(1); };
  return (
    <>
      <StatStrip label="Ledger totals">
        <StatTile label="Unpaid, not invoiced" value={money(sum(unpaid))} footnote={`${unpaid.length} item${unpaid.length === 1 ? "" : "s"} waiting`} href="/app/payouts?view=ledger&state=unpaid" />
        <StatTile label="On invoices, unpaid" value={money(sum(invoiced))} footnote="locked: never invoiced twice" href="/app/payouts?view=ledger&state=invoiced" />
        <StatTile label="Paid this month" value={money(sum(paidThisMonth))} footnote="stamped PAID" href="/app/payouts?view=ledger&state=paid" />
        <StatTile label="Chargebacks to take back" value={money(sum(clawbacks))} valueTone={clawbacks.length ? "warning" : undefined} footnote={`${clawbacks.length} on the next invoices`} href="/app/payouts?view=ledger&state=unpaid" />
      </StatStrip>
      <TableCard
        toolbar={rows.length === 0 ? undefined : (
          <DataToolbar actions={<>
            <select aria-label="Partner" className={toolbarControl} value={partner} onChange={(e) => { setPartner(e.target.value); setPage(1); }}><option value="">All partners</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>}>
            <ToolbarSearch value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search client, policy or invoice" />
            <Segmented label="Ledger status" value={state || "all"} onChange={(k) => pick(k === "all" ? "" : k)} options={[
              { key: "all", label: "All", count: rows.length },
              { key: "unpaid", label: "Unpaid", count: unpaid.length || null },
              { key: "invoiced", label: "On an invoice", count: invoiced.length || null },
              { key: "paid", label: "PAID", count: rows.filter((r) => r.state === "paid").length || null },
            ]} />
          </DataToolbar>
        )}
        footer={visible.length > pageSize ? <Pager page={shown.current} pageSize={pageSize} total={visible.length} noun="entries" onPage={setPage} /> : undefined}
      >
        {rows.length === 0 ? (
          <EmptyState title="Nothing in the ledger yet" hint="Each submitted application (Model A) or commission received on an issued policy (Model B) from a partner with a rulebook lands here." action={<Button variant="outline" asChild><Link href="/app/payouts?view=rulebooks">Set up rulebooks</Link></Button>} />
        ) : visible.length === 0 ? (
          <NoMatches noun="entries" onClear={() => { setState(""); setPartner(""); setSearch(""); }} />
        ) : (
          <table className="portal-lead-table w-full min-w-[900px] text-left text-sm">
            <thead><tr><th>Earned</th><th>Partner</th><th>Client · policy</th><th>What</th><th className="text-right">Amount</th><th>Expected</th><th>Status</th></tr></thead>
            <tbody>
              {shown.rows.map((r) => {
                const math = entryMath(r, money);
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap tabular-nums">{dateLabel(r.earnedOn)}</td>
                    <td className="font-medium">{r.partnerName}</td>
                    <td>{r.clientName ?? <span className="text-muted-foreground">—</span>}{r.policyNumber ? <span className="block text-xs text-muted-foreground">{r.carrier ? `${r.carrier} · ` : ""}{r.policyNumber}</span> : null}</td>
                    <td>{LEDGER_SOURCE_LABELS[r.sourceType] ?? r.sourceType}{math ? <span className="block text-xs text-muted-foreground">{math}</span> : r.note ? <span className="block text-xs text-muted-foreground">{r.note}</span> : null}</td>
                    <td className={`text-right tabular-nums ${r.amountCents < 0 ? "text-[var(--error-ink)]" : ""}`}>{money(r.amountCents)}</td>
                    <td className="whitespace-nowrap tabular-nums text-muted-foreground">{r.paidAt ? `Paid ${dateLabel(r.paidAt.slice(0, 10))}` : r.expectedOn ? dateLabel(r.expectedOn) : "With its invoice"}</td>
                    <td>{r.state === "invoiced" && r.runId ? <Link href={`/app/payouts/${r.runId}`} className="underline-offset-4 hover:underline"><StatusChip tone={STATE_TONE.invoiced}>{r.invoiceNumber ?? STATE_WORD.invoiced}</StatusChip></Link> : <StatusChip tone={STATE_TONE[r.state]}>{STATE_WORD[r.state]}</StatusChip>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}

// ─── every partner's rulebook ─────────────────────────────────────────────────────────────────
export function RulebooksBoard({ rows, readOnly }: { rows: RulebookRow[]; readOnly: boolean }) {
  return (
    <TableCard footer={<p className="text-xs text-muted-foreground">Older prices (per transfer, per lead, per sale, per issued policy) keep paying until a rulebook replaces them.</p>}>
      {rows.length === 0 ? <EmptyState title="No partners yet" hint="Add a partner under Partners, then set its payout rulebook here." /> : (
        <table className="portal-lead-table w-full min-w-[880px] text-left text-sm">
          <thead><tr><th>Partner</th><th>How they win</th><th>How much</th><th>Paid</th><th>Chargebacks</th><th>Who gets the money</th><th className="text-right"><span className="sr-only">Open</span></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.partnerId}>
                <td className="font-medium">{r.partnerName}{r.status !== "active" ? <span className="text-xs text-muted-foreground"> · {r.status}</span> : null}</td>
                <td>{r.model === "per_submitted_application" ? "Model A · quick win" : r.model === "revenue_share" ? "Model B · long game" : r.model ? <span className="text-muted-foreground">Older terms</span> : <span className="text-[var(--warning-ink)]">Not set</span>}</td>
                <td className="tabular-nums">{rulebookRateLabel(r.model, r.rateCents, r.ratePctBp, money) ?? "—"}</td>
                <td>{PAYOUT_CADENCE_SHORT[r.cadence]}{r.cadenceOwn ? "" : <span className="text-xs text-muted-foreground"> · agency default</span>}</td>
                <td>{r.chargebackPolicy === "partner_shares" ? "Partner shares" : "Agency absorbs"}</td>
                <td>{r.payee ?? <span className="text-muted-foreground">—</span>}{r.paymentMethod ? <span className="block text-xs text-muted-foreground">{r.paymentMethod}</span> : null}</td>
                <td className="text-right"><Button size="sm" variant="outline" asChild><Link href={`/app/payouts/rulebook/${r.partnerId}`}>{readOnly ? "Open" : r.model ? "Edit" : "Set up"}</Link></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

// ─── the rulebook form ────────────────────────────────────────────────────────────────────────
/** Cents as the dollars a person types ("10.00"), by string handling. */
const centsText = (c: number | null) => { if (c == null) return ""; const d = String(Math.abs(c)).padStart(3, "0"); return `${c < 0 ? "-" : ""}${d.slice(0, -2)}.${d.slice(-2)}`; };

/** One numbered block of the rulebook. */
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-border pt-5 first:border-t-0 first:pt-0 sm:grid-cols-[28px_1fr]" aria-labelledby={`rulebook-step-${n}`}>
      <span className="flex size-7 items-center justify-center rounded-full bg-[var(--surface-alt)] text-sm font-semibold tabular-nums" aria-hidden="true">{n}</span>
      <div className="min-w-0 space-y-3">
        <h2 id={`rulebook-step-${n}`} className="m-0 text-sm font-semibold">{title}</h2>
        {children}
      </div>
    </section>
  );
}

export function RulebookForm({ rulebook, readOnly }: { rulebook: RulebookView; readOnly: boolean }) {
  const router = useRouter();
  const startModel: RulebookModel = rulebook.model === "revenue_share" ? "revenue_share" : "per_submitted_application";
  const initial = {
    model: startModel,
    flat: rulebook.model === "per_submitted_application" ? centsText(rulebook.rateCents) : "",
    pct: rulebook.model === "revenue_share" && rulebook.ratePctBp != null ? pctLabel(rulebook.ratePctBp).replace("%", "") : "",
    startsOn: today(),
    cadence: rulebook.cadence,
    chargebacks: rulebook.chargebackPolicy,
    payeeName: rulebook.payeeName ?? "",
    payeeEmail: rulebook.payeeEmail ?? "",
    method: (rulebook.paymentMethod ?? "") as PartnerPaymentMethod | "",
    note: rulebook.paymentNote ?? "",
  };
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = useRef<HTMLFormElement>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const priceChanged = f.model !== rulebook.model || (f.model === "revenue_share" ? parsePctToBp(f.pct) !== rulebook.ratePctBp : parseDollarsToCents(f.flat) !== rulebook.rateCents);

  const save = async (): Promise<boolean> => {
    const rateCents = f.model === "per_submitted_application" ? parseDollarsToCents(f.flat) : null;
    const ratePctBp = f.model === "revenue_share" ? parsePctToBp(f.pct) : null;
    if (f.model === "per_submitted_application" && (rateCents === null || rateCents < 0)) { setError("Enter the flat rate in dollars and cents."); return false; }
    if (f.model === "revenue_share" && ratePctBp === null) { setError("Enter their share as a percentage, for example 50 or 12.5."); return false; }
    setBusy(true);
    setError(null);
    try {
      const body = await send(`/api/app/partners/${rulebook.partnerId}/rulebook`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: f.model, rate_cents: rateCents, rate_pct_bp: ratePctBp, starts_on: f.startsOn, cadence: f.cadence, chargeback_policy: f.chargebacks,
          payee_name: f.payeeName || null, payee_email: f.payeeEmail || null, payment_method: f.method || null, payment_note: f.note || null,
        }),
      });
      notify.done(body.termAdded ? `Rulebook saved. The new price applies from ${dateLabel(f.startsOn)}.` : "Rulebook saved");
      router.push("/app/payouts?view=rulebooks");
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
  const disabled = readOnly || rulebook.partnerStatus === "offboarded";

  return (
    <form ref={scope} onSubmit={submit} className={`${cardSurface} flex flex-col gap-5 p-5`}>
      {rulebook.legacy ? <p className="m-0 text-sm text-muted-foreground">Today this partner is paid {rulebookRateLabel(rulebook.model, rulebook.rateCents, rulebook.ratePctBp, money) ?? "on older terms"}. That keeps paying until you save a rulebook.</p> : null}
      <Step n={1} title="How do they win?">
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Payment trigger">
          {RULEBOOK_MODELS.map((m) => (
            <label key={m} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${f.model === m ? "border-[var(--accent)] bg-[var(--primary-soft)]" : "border-border"}`}>
              <input type="radio" name="rulebook-model" className="mt-1" checked={f.model === m} disabled={disabled} onChange={() => set("model", m)} />
              <span className="min-w-0"><span className="block font-medium">{RULEBOOK_MODEL_COPY[m].title}</span><span className="block text-xs text-muted-foreground">{RULEBOOK_MODEL_COPY[m].trigger}</span></span>
            </label>
          ))}
        </div>
      </Step>
      <Step n={2} title="How much do they win?">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {f.model === "per_submitted_application"
            ? <Field label="Flat rate per submitted application ($)" htmlFor="rb-flat" required hint="e.g. 10.00 for every successful transfer whose application is submitted."><input id="rb-flat" className={control} inputMode="decimal" required disabled={disabled} value={f.flat} onChange={(e) => set("flat", e.target.value)} /></Field>
            : <Field label="Share of the commission we receive (%)" htmlFor="rb-pct" required hint="e.g. 50 means half of every commission paid on their issued policies."><input id="rb-pct" className={control} inputMode="decimal" required disabled={disabled} value={f.pct} onChange={(e) => set("pct", e.target.value)} /></Field>}
          <Field label="New price starts on" htmlFor="rb-from" hint={priceChanged ? "Items before this day keep the old price." : "Only used when the price changes."}><input id="rb-from" type="date" className={control} disabled={disabled || !priceChanged} value={f.startsOn} onChange={(e) => set("startsOn", e.target.value)} /></Field>
        </div>
      </Step>
      <Step n={3} title="When do they get paid?">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="Pay schedule" htmlFor="rb-cadence" hint={`The agency's default is ${PAYOUT_CADENCE_SHORT[rulebook.agencyCadence]}. An invoice is drafted ${rulebook.draftDays} day${rulebook.draftDays === 1 ? "" : "s"} after each period ends.`}>
            <select id="rb-cadence" className={control} disabled={disabled} value={f.cadence} onChange={(e) => set("cadence", e.target.value as PayoutCadence)}>{PAYOUT_CADENCES.map((c) => <option key={c} value={c}>{PAYOUT_CADENCE_LABELS[c]}</option>)}</select>
          </Field>
          <Field label="Chargebacks" htmlFor="rb-chargebacks" className="xl:col-span-2" hint={f.model === "revenue_share" ? "Shared: a chargeback on their policy takes their share back. Absorbed: their share is never reduced." : "Shared: if the policy charges back, the flat fee is taken back on the next invoice."}>
            <select id="rb-chargebacks" className={control} disabled={disabled} value={f.chargebacks} onChange={(e) => set("chargebacks", e.target.value as ChargebackPolicy)}>{CHARGEBACK_POLICIES.map((c) => <option key={c} value={c}>{CHARGEBACK_POLICY_LABELS[c]}</option>)}</select>
          </Field>
        </div>
      </Step>
      <Step n={4} title="Who gets the money?">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="Name" htmlFor="rb-payee"><input id="rb-payee" className={control} maxLength={200} disabled={disabled} value={f.payeeName} onChange={(e) => set("payeeName", e.target.value)} /></Field>
          <Field label="Email" htmlFor="rb-email"><input id="rb-email" type="email" className={control} maxLength={320} disabled={disabled} value={f.payeeEmail} onChange={(e) => set("payeeEmail", e.target.value)} /></Field>
          <Field label="Payment method" htmlFor="rb-method">
            <select id="rb-method" className={control} disabled={disabled} value={f.method} onChange={(e) => set("method", e.target.value as PartnerPaymentMethod | "")}><option value="">Not set</option>{PARTNER_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PARTNER_PAYMENT_METHOD_LABELS[m]}</option>)}</select>
          </Field>
          <Field label="Note for whoever pays (optional)" htmlFor="rb-note" className="sm:col-span-2 xl:col-span-3" hint="No account or routing numbers here: keep those with your bank or payment app."><input id="rb-note" className={control} maxLength={500} disabled={disabled} value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
        </div>
      </Step>
      {error ? <Callout tone="error" title={error} /> : null}
      {disabled ? null : (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" asChild><Link href="/app/payouts?view=rulebooks">Discard</Link></Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save rulebook"}</Button>
        </div>
      )}
      <LeaveGuard dirty={dirty && !busy} scope={scope} onSave={save} onDiscard={() => setF(initial)} what="this rulebook" />
    </form>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, control } from "@/components/ui/field";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { PAID_METHOD_LABELS, PAID_METHODS } from "@/lib/accounting/invoicesCore";
import { formatCentsAsCurrency } from "@/lib/money";
import { usDate } from "@/components/app/commissions/team-payouts/shared";

/**
 * A partner invoice's client parts (round 7, owner pick 9·1–9·2, 2026-11-10; docs/la4/mockups-r7/commissions.html):
 *
 *   InvoiceActions   the primary by state — Draft: Publish & share; Published, net above 0: Mark paid; Paid, Void: none —
 *                    and ⋯ (the PDF, the CSV, Void the invoice). Missing business details make Publish open a dialog
 *                    that asks for them, never a notice among the buttons.
 *   InvoiceItems     a row opens the item's dialog, where "Dispute this item" lives (drafts only).
 *   InvoiceDisputes  a row opens its Resolve dialog (published or paid invoices); otherwise the dispute, read only.
 * Nothing here moves money.
 */
const money = (c: number) => formatCentsAsCurrency(c);
const today = () => new Date().toISOString().slice(0, 10);

async function post(id: string, payload: Record<string, unknown>) {
  const res = await fetch(`/api/app/accounting/payouts/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "That didn't save");
  return body;
}
const needsIdentity = (message: string) => /trading name|business address/i.test(message);

type Paying = { on: string; method: string; reference: string };

export function InvoiceActions({ run, readOnly }: { run: { id: string; status: string; netCents: number; partnerName: string; periodLabel: string }; readOnly: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState<Paying | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [identity, setIdentity] = useState(false);
  const act = async (payload: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      await post(run.id, payload);
      notify.done(done);
      setPaying(null);
      setVoiding(null);
      router.refresh();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "That didn't save";
      if (payload.action === "publish" && needsIdentity(message)) setIdentity(true);
      else notify.fail(message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const publish = () => act({ action: "publish" }, "Published. The partner can see the invoice and its PDF; the cost is booked.");
  const downloads = [
    { label: "Download the invoice (PDF)", href: `/api/app/accounting/payouts/${run.id}/invoice` },
    { label: "Download the statement (CSV)", href: `/api/app/accounting/payouts/${run.id}/statement` },
  ];
  if (readOnly) return <MoreMenu label="More for this invoice" items={downloads} />;
  return (
    <>
      {run.status === "draft" ? <Button disabled={busy} onClick={() => void publish()}>Publish &amp; share</Button> : null}
      {run.status === "published" && run.netCents > 0 ? <Button disabled={busy} onClick={() => setPaying({ on: today(), method: "ach", reference: "" })}>Mark paid</Button> : null}
      <MoreMenu label="More for this invoice" items={[...downloads, run.status !== "void" && run.status !== "paid" && { label: "Void the invoice", onSelect: () => setVoiding("") }]} />
      {paying ? (
        <ConfirmDialog
          open onOpenChange={(next) => { if (!next) setPaying(null); }} busy={busy} destructive={false}
          title={`Mark ${money(run.netCents)} to ${run.partnerName} paid?`}
          description="Records when the money moved and stamps every item on it paid, so none is paid again. Nothing is paid from here."
          confirmLabel="Record payment" cancelLabel="Keep it" confirmDisabled={!paying.on}
          onConfirm={() => void act({ action: "paid", paid_on: paying.on, method: paying.method, reference: paying.reference.trim() || null }, "Marked paid.")}
          fields={<>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Paid on" htmlFor="invoice-paid-on"><input id="invoice-paid-on" type="date" className={control} value={paying.on} onChange={(e) => setPaying({ ...paying, on: e.target.value })} /></Field>
              <Field label="Method" htmlFor="invoice-method"><select id="invoice-method" className={control} value={paying.method} onChange={(e) => setPaying({ ...paying, method: e.target.value })}>{PAID_METHODS.map((m) => <option key={m} value={m}>{PAID_METHOD_LABELS[m]}</option>)}</select></Field>
            </div>
            <Field label="Reference" htmlFor="invoice-ref"><input id="invoice-ref" className={control} placeholder="Optional" value={paying.reference} onChange={(e) => setPaying({ ...paying, reference: e.target.value })} /></Field>
          </>}
        />
      ) : null}
      <ConfirmDialog
        open={voiding !== null} onOpenChange={(next) => { if (!next) setVoiding(null); }} busy={busy}
        title={`Void ${run.partnerName}'s ${run.periodLabel} invoice?`}
        description="Its cost is reversed, its open disputes are closed and its items go back to waiting for the next invoice; the invoice stays on record."
        confirmLabel="Void the invoice" cancelLabel="Keep it" confirmDisabled={!voiding?.trim()}
        onConfirm={() => void act({ action: "void", reason: voiding?.trim() ?? "" }, "The invoice is void. Its items wait for the next invoice.")}
        fields={<Field label="Why is it void?" htmlFor="invoice-void" required><input id="invoice-void" className={control} autoFocus value={voiding ?? ""} onChange={(e) => setVoiding(e.target.value)} /></Field>}
      />
      {identity ? <BusinessDetails onClose={() => setIdentity(false)} onSaved={async () => { if (await publish()) setIdentity(false); }} /> : null}
    </>
  );
}

type Profile = Record<string, unknown> & { legalName?: string; dba?: string | null; addressLine1?: string | null; city?: string | null; state?: string | null; postalCode?: string | null };

/** Publish & share with the business details missing: ask for them here, then publish. Business identity is the owner's. */
function BusinessDetails({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [f, setF] = useState({ legalName: "", dba: "", addressLine1: "", city: "", state: "", postalCode: "" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/app/agency-profile").then(async (res) => {
      if (!res.ok) { setBlocked(true); return; }
      const body = await res.json();
      const p = (body?.profile ?? {}) as Profile;
      setProfile(p);
      setF({ legalName: p.legalName ?? "", dba: p.dba ?? "", addressLine1: p.addressLine1 ?? "", city: p.city ?? "", state: p.state ?? "", postalCode: p.postalCode ?? "" });
    }).catch(() => setBlocked(true));
  }, []);
  const set = (k: keyof typeof f, v: string) => setF((cur) => ({ ...cur, [k]: v }));
  const missingAddress = !f.addressLine1.trim() || !f.city.trim() || !f.state.trim() || !f.postalCode.trim();
  const save = async () => {
    if (!profile) return;
    setBusy(true);
    setProblem(null);
    const keep = ["npn", "entityType", "taxIdType", "addressLine2", "phone", "email", "website", "timezone"] as const;
    const body: Record<string, unknown> = Object.fromEntries(keep.map((k) => [k, profile[k] ?? null]));
    Object.assign(body, { legalName: f.legalName.trim(), dba: f.dba.trim() || null, addressLine1: f.addressLine1.trim() || null, city: f.city.trim() || null, state: f.state.trim().toUpperCase() || null, postalCode: f.postalCode.trim() || null });
    const res = await fetch("/api/app/agency-profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) { setProblem(json?.error ?? "That didn't save"); return; }
    await onSaved();
  };
  return (
    <Dialog open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Add your business details first</DialogTitle>
          <DialogDescription>The partner statement shows who sent it.</DialogDescription>
        </DialogHeader>
        {blocked ? (
          <p className="m-0 text-sm">Only the owner can add them, in <Link className="font-medium text-[var(--accent-ink)] hover:underline" href="/app/settings#business-identity/identity-trading-name">Settings › Business identity</Link>.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {!profile?.legalName ? <Field label="Legal name" htmlFor="bi-legal" required><input id="bi-legal" className={control} value={f.legalName} onChange={(e) => set("legalName", e.target.value)} /></Field> : null}
            <Field label="Trading name" htmlFor="bi-dba" error={!f.dba.trim() ? "Add the trading name." : undefined}><input id="bi-dba" className={control} value={f.dba} onChange={(e) => set("dba", e.target.value)} /></Field>
            <Field label="Business address" htmlFor="bi-line1" error={missingAddress ? "Add the business address." : undefined}><input id="bi-line1" className={control} placeholder="Street" value={f.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} /></Field>
            <div className="grid grid-cols-[1fr_80px_110px] gap-3">
              <Field label="City" htmlFor="bi-city"><input id="bi-city" className={control} value={f.city} onChange={(e) => set("city", e.target.value)} /></Field>
              <Field label="State" htmlFor="bi-state"><input id="bi-state" className={control} maxLength={2} value={f.state} onChange={(e) => set("state", e.target.value)} /></Field>
              <Field label="ZIP" htmlFor="bi-zip"><input id="bi-zip" className={control} inputMode="numeric" value={f.postalCode} onChange={(e) => set("postalCode", e.target.value)} /></Field>
            </div>
            {problem ? <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{problem}</p> : null}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{blocked ? "Close" : "Cancel"}</Button>
          {blocked ? null : <Button onClick={() => void save()} disabled={busy || !profile || !f.legalName.trim() || !f.dba.trim() || missingAddress}>{busy ? "Saving…" : "Save and publish"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type InvoiceItem = { id: string; label: string; occurredOn: string; clientName: string | null; policyNumber: string | null; carrier: string | null; how: string | null; amountCents: number; note: string | null; disputed: boolean; billable: boolean };

export function InvoiceItems({ runId, items, canDispute }: { runId: string; items: InvoiceItem[]; canDispute: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<InvoiceItem | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const disputable = (i: InvoiceItem) => canDispute && i.billable && !i.disputed;
  const dispute = async () => {
    if (!open || !reason.trim()) return;
    setBusy(true);
    try {
      await post(runId, { action: "dispute", item_id: open.id, reason: reason.trim() });
      notify.done("Disputed: withheld from this invoice.");
      setOpen(null);
      router.refresh();
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PagedTableCard total={items.length} noun="items">
        {items.length === 0 ? <EmptyState title="No items" hint="Nothing the partner delivered in this period was priced." /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="w-[20%]">Client</TableHead><TableHead className="w-[22%]">Policy</TableHead><TableHead className="w-[13%]">Date</TableHead><TableHead className="w-[12%] text-right">Amount</TableHead><TableHead className="w-[12%]">Status</TableHead></TableRow></TableHeader>
            <PagedBody>
              {/* One line per item; how it was worked out and its note are in the item's dialog. */}
              {items.map((i) => (
                <TableRow key={i.id} className="cursor-pointer" onClick={() => { setReason(""); setOpen(i); }}>
                  <TableCell className="whitespace-nowrap font-medium">{i.label}</TableCell>
                  <TableCell className="whitespace-nowrap">{i.clientName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="whitespace-nowrap">{i.policyNumber ? `${i.carrier ? `${i.carrier} · ` : ""}${i.policyNumber}` : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{usDate(i.occurredOn)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{money(i.amountCents)}</TableCell>
                  <TableCell>{i.disputed ? <StatusChip tone="warning">Disputed</StatusChip> : null}</TableCell>
                </TableRow>
              ))}
            </PagedBody>
          </Table>
        )}
      </PagedTableCard>
      {open ? (
        <Dialog open onOpenChange={(next) => { if (!next && !busy) setOpen(null); }}>
          <DialogContent size="md">
            <DialogHeader>
              <DialogTitle>{open.label} · {usDate(open.occurredOn)}</DialogTitle>
              <DialogDescription>{[open.clientName, [open.carrier, open.policyNumber].filter(Boolean).join(" "), money(open.amountCents)].filter(Boolean).join(" · ")}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 text-sm">
              {open.how ? <p className="m-0 text-muted-foreground">Worked out as {open.how}.</p> : null}
              {open.note ? <p className="m-0">{open.note}</p> : null}
              {open.disputed ? <p className="m-0">Disputed: it is withheld from this invoice.</p> : null}
              {disputable(open) ? <>
                <Field label="Reason to dispute it" htmlFor="item-why"><input id="item-why" className={control} autoFocus placeholder="e.g. wrong number" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                <p className="m-0 text-xs text-muted-foreground">It is withheld from this invoice, and the partner sees why once it is published.</p>
              </> : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(null)} disabled={busy}>Close</Button>
              {disputable(open) ? <Button onClick={() => void dispute()} disabled={busy || !reason.trim()}>{busy ? "Saving…" : "Dispute this item"}</Button> : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

export type InvoiceDispute = { id: string; side: string; reason: string; claimCents: number; status: string; resolutionNote: string | null; carried: boolean };
const OUTCOME: Record<string, string> = { open: "Open", accepted: "Accepted, paid on the next invoice", upheld: "Upheld, stays deducted", void: "Void, its invoice was voided" };
const OUTCOME_TONE: Record<string, StatusTone> = { open: "warning", accepted: "good", upheld: "neutral", void: "neutral" };

export function InvoiceDisputes({ runId, disputes, canResolve, draft }: { runId: string; disputes: InvoiceDispute[]; canResolve: boolean; draft: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<InvoiceDispute | null>(null);
  const [outcome, setOutcome] = useState<{ status: "accepted" | "upheld"; note: string }>({ status: "accepted", note: "" });
  const [busy, setBusy] = useState(false);
  const resolve = async () => {
    if (!open) return;
    setBusy(true);
    try {
      await post(runId, { action: "resolve", dispute_id: open.id, status: outcome.status, note: outcome.note.trim() });
      notify.done("Dispute resolved.");
      setOpen(null);
      router.refresh();
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  const resolvable = (d: InvoiceDispute) => canResolve && d.status === "open";
  return (
    <>
      <TableCard>
        {disputes.length === 0 ? <EmptyState title="No disputes" hint="Dispute an item from the Items tab while the invoice is a draft; the partner can raise one once it is published." /> : (
          <Table>
            <TableHeader><TableRow><TableHead className="w-[16%]">Raised by</TableHead><TableHead>Reason</TableHead><TableHead className="w-[14%] text-right">Claim</TableHead><TableHead className="w-[30%]">Outcome</TableHead></TableRow></TableHeader>
            <TableBody>
              {disputes.map((d) => (
                <TableRow key={d.id} className="cursor-pointer" onClick={() => { setOutcome({ status: "accepted", note: "" }); setOpen(d); }}>
                  <TableCell className="whitespace-nowrap font-medium">{d.side === "partner" ? "The partner" : "You"}</TableCell>
                  <TableCell>{d.reason}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{money(d.claimCents)}</TableCell>
                  {/* The outcome is the row's one chip; the resolution note and "carried" are in the dispute's dialog. */}
                  <TableCell><StatusChip tone={OUTCOME_TONE[d.status] ?? "neutral"}>{d.status === "open" && draft ? "Open · resolved once published" : OUTCOME[d.status] ?? d.status}</StatusChip></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableCard>
      {open && resolvable(open) ? (
        <ConfirmDialog
          open onOpenChange={(next) => { if (!next) setOpen(null); }} busy={busy} destructive={false}
          title={`Resolve the ${money(open.claimCents)} dispute?`} description={open.reason}
          confirmLabel="Save" cancelLabel="Not now" confirmDisabled={!outcome.note.trim()} onConfirm={() => void resolve()}
          fields={<>
            <Field label="Outcome" htmlFor="dispute-outcome"><select id="dispute-outcome" className={control} value={outcome.status} onChange={(e) => setOutcome({ ...outcome, status: e.target.value as "accepted" | "upheld" })}><option value="accepted">Accept: paid on the next invoice</option><option value="upheld">Uphold: stays deducted</option></select></Field>
            <Field label="Why" htmlFor="dispute-note"><input id="dispute-note" className={control} value={outcome.note} onChange={(e) => setOutcome({ ...outcome, note: e.target.value })} /></Field>
          </>}
        />
      ) : open ? (
        <Dialog open onOpenChange={(next) => { if (!next) setOpen(null); }}>
          <DialogContent size="md">
            <DialogHeader>
              <DialogTitle>{money(open.claimCents)} dispute</DialogTitle>
              <DialogDescription>{open.reason}</DialogDescription>
            </DialogHeader>
            <p className="m-0 text-sm">{open.status === "open" && draft ? "Open. It is resolved once the invoice is published." : OUTCOME[open.status] ?? open.status}{open.resolutionNote ? ` · ${open.resolutionNote}` : ""}{open.carried ? " · carried" : ""}</p>
            <DialogFooter><Button variant="outline" onClick={() => setOpen(null)}>Close</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";

import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataToolbar, ToolbarSearch } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, ToggleRow, control } from "@/components/ui/field";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { SelectMenu } from "@/components/ui/select-menu";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Segmented } from "@/components/ui/view-tabs";
import { StepSlot } from "@/components/app/step-frame/step-slot";
import { PRODUCER_PAYOUTS_SLOT } from "@/components/app/agency/slots";
import { sendJson } from "@/components/app/agency/use-agency-data";
import { dollars } from "@/lib/agency/constants";
import { defaultChoice, draftPay, PAY_METHODS, PAY_MODEL_LABELS, parsePctToBp, pctOf, previousMonth, type BalanceChoice, type PayModel, type RunMode } from "@/lib/agency/payPlanCore";
import { CHOICE_LABEL, owes, payable, type PreviewPerson } from "./draft";
import { longMonth, monthName, payMethodLabel, periodWords, usDate, WIDE_DIALOG } from "./shared";

/**
 * Commissions › Team payouts (round 7, owner pick 6·A, 2026-11-10; docs/la4/mockups-r7/commissions.html 6·A–6·2).
 *
 *   PayMonthBoard   "Pay {Month}": the draft as a plain table you read. A row opens that person's draft dialog
 *                   (pay them this month or not; what happens to what they owe: Take it all back · Take a share ·
 *                   Let it go; ⋯ Write off). "Confirm and mark paid" on the title line opens one dialog: how you
 *                   paid, the day, a reference, for everyone, changed per person only where it differs. Nothing is
 *                   saved until then; nothing here moves money.
 *   RunsBoard       every person's run per month; chips by where it stands; a row opens the private statement
 *                   (Void lives there, in ⋯).
 * No radios, inputs or menus in a row, and no stepper (owner 2026-11-10).
 */

type Run = { id: string; producerUserId: string; periodStart: string; periodEnd: string; status: string; netCents: number; balanceAfterCents: number; decisionMode: string | null; paidOn: string | null; paidMethod: string | null; paymentReference: string | null };
type Rules = { negativePolicy: string; recoveryPctBp: number };
type Choice = { include: boolean; mode: BalanceChoice; pct: string };
type How = { method: string; reference: string; paidOn: string };

const today = () => new Date().toISOString().slice(0, 10);
const first = (name: string) => name.split(/\s+/)[0] || name;
const modelOf = (p: Pick<PreviewPerson, "planModel">) => (p.planModel ? PAY_MODEL_LABELS[p.planModel as PayModel] ?? p.planModel : "Contract level");
const owedBefore = (p: PreviewPerson) => (p.balanceBeforeCents < 0 ? -p.balanceBeforeCents : 0);

/** The month select on the title line, in the address (`?period=YYYY-MM`): this month and the twelve before it. */
function MonthSelect({ value, allLabel }: { value: string; allLabel?: string }) {
  const router = useRouter();
  const path = usePathname();
  const months = useMemo(() => {
    const out: string[] = [];
    let m = today().slice(0, 7);
    for (let i = 0; i < 13; i++) { out.push(m); m = previousMonth(`${m}-01`); }
    return out;
  }, []);
  const options = [...(allLabel ? [{ value: "all", label: allLabel }] : []), ...months.map((m) => ({ value: m, label: longMonth(m) }))];
  return (
    <SelectMenu
      label="Month"
      value={value}
      icon={<CalendarDays className="size-4" aria-hidden="true" />}
      options={options}
      onChange={(next) => {
        const q = new URLSearchParams(window.location.search);
        if (next === "all") q.delete("month"); else if (allLabel) q.set("month", next); else q.set("period", next);
        router.push(`${path}?${q}`);
      }}
      className="w-44"
    />
  );
}

/** "$2,400 base · $385.88 commission · $250 bonuses · −$612.40 chargebacks": what the month's figure is made of. */
function breakdown(p: PreviewPerson): string {
  return [
    p.salaryCents ? `${dollars(p.salaryCents)} base` : null,
    p.earnedCents ? `${dollars(p.earnedCents)} commission` : null,
    p.bonusCents ? `${dollars(p.bonusCents)} bonuses` : null,
    p.saveFeeCents ? `${dollars(p.saveFeeCents)} saved deals` : null,
    p.chargebackCents ? `${dollars(p.chargebackCents)} chargebacks` : null,
  ].filter(Boolean).join(" · ");
}

export function PayMonthBoard({ month, preview, runs, rules, records, canCommit, moneyActions }: {
  month: string;
  preview: PreviewPerson[];
  /** This month's runs: an already-paid row opens its statement. */
  runs: Run[];
  rules: Rules;
  /** Producer record id by user id: the ledger link in the dialog. */
  records: Record<string, string>;
  canCommit: boolean;
  moneyActions: boolean;
}) {
  const router = useRouter();
  const label = longMonth(month);
  const name = monthName(month);
  const fallbackPct = pctOf(rules.recoveryPctBp).replace(/%$/, "");
  const [choices, setChoices] = useState<Record<string, Choice>>(() => Object.fromEntries(preview.map((p) => [p.producerUserId, { include: payable(p), mode: defaultChoice(rules.negativePolicy), pct: fallbackPct }])));
  const [search, setSearch] = useState("");
  const [only, setOnly] = useState<"" | "owes" | "left">("");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(300, 52);
  const [open, setOpen] = useState<PreviewPerson | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [writingOff, setWritingOff] = useState<PreviewPerson | null>(null);

  const pctBp = (c: Choice) => parsePctToBp(c.pct) ?? rules.recoveryPctBp;
  const modeOf = (p: PreviewPerson, c: Choice): RunMode => (owes(p) ? c.mode : "pay_full");
  const payOf = (p: PreviewPerson, c: Choice = choices[p.producerUserId]) => draftPay({ beforeCents: p.balanceBeforeCents, periodCents: p.periodCents }, modeOf(p, c), pctBp(c));
  const chosen = preview.filter((p) => payable(p) && choices[p.producerUserId]?.include);
  const paying = chosen.reduce((sum, p) => sum + payOf(p).payCents, 0);
  const takenBack = chosen.reduce((sum, p) => sum + payOf(p).takenCents, 0);
  const owing = preview.filter((p) => payable(p) && owes(p));
  const leftOut = preview.filter((p) => payable(p) && !choices[p.producerUserId]?.include);
  const runOf = new Map(runs.filter((r) => r.status !== "void").map((r) => [r.producerUserId, r]));

  const needle = search.trim().toLowerCase();
  const visible = preview
    .filter((p) => !needle || p.displayName.toLowerCase().includes(needle))
    .filter((p) => (only === "owes" ? owing.includes(p) : only === "left" ? leftOut.includes(p) : true));
  const shown = paginate(visible, page, pageSize);

  /**
   * What happens to what they owe (6·A's fifth column), as the row's one chip (owner 2026-11-11: one line, colour
   * only in a chip). What is left owing after this month is in the person's dialog.
   */
  const happens = (p: PreviewPerson) => {
    if (p.alreadyRun) return <StatusChip tone="good">Already paid</StatusChip>;
    if (p.planModel === "solo_owner") return <StatusChip tone="neutral">Not on payroll</StatusChip>;
    if (!payable(p)) return <StatusChip tone="neutral">Nothing to pay</StatusChip>;
    const c = choices[p.producerUserId];
    if (!c.include) return <StatusChip tone="warning">Left out this month</StatusChip>;
    if (!owes(p)) return <StatusChip tone="neutral">{p.status !== "active" ? p.status : "Owes nothing"}</StatusChip>;
    return <StatusChip tone="danger">{c.mode === "recover" ? `${CHOICE_LABEL.recover}: ${pctOf(pctBp(c))}` : CHOICE_LABEL[c.mode]}</StatusChip>;
  };

  const openRow = (p: PreviewPerson) => {
    const run = runOf.get(p.producerUserId);
    if (p.alreadyRun && run) router.push(`/app/producer-statements/${run.id}`);
    else setOpen(p);
  };

  return (
    <>
      <StepSlot id={PRODUCER_PAYOUTS_SLOT}>
        <MonthSelect value={month} />
        <Button onClick={() => setConfirming(true)} disabled={!canCommit || chosen.length === 0} title={canCommit ? undefined : "Paused while the account is read-only."}>Confirm and mark paid</Button>
      </StepSlot>
      <TableCard
        toolbar={preview.length === 0 ? undefined : (
          <DataToolbar actions={
            <span className="text-sm">
              <span className="font-semibold tabular-nums">{chosen.length}</span> of {preview.filter(payable).length} chosen
              {" · "}<span className="font-semibold tabular-nums">{dollars(paying)}</span> to pay
              {takenBack ? <>{" · "}<span className="font-semibold tabular-nums">{dollars(takenBack)}</span> taken back</> : null}
            </span>
          }>
            <ToolbarSearch value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search team member" />
            <ToggleChip selected={only === "owes"} onClick={() => { setOnly(only === "owes" ? "" : "owes"); setPage(1); }} count={owing.length} countTone={owing.length ? "danger" : undefined}>Owes from before</ToggleChip>
            <ToggleChip selected={only === "left"} onClick={() => { setOnly(only === "left" ? "" : "left"); setPage(1); }} count={leftOut.length}>Left out</ToggleChip>
          </DataToolbar>
        )}
        footer={preview.length === 0 ? undefined : (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Nothing is saved until you confirm · nothing here moves money</p>
            {visible.length > pageSize ? <Pager page={shown.current} total={visible.length} noun="team members" pageSize={pageSize} onPage={setPage} /> : <p className="text-xs text-muted-foreground">{preview.length} team {preview.length === 1 ? "member" : "members"}</p>}
          </div>
        )}
      >
        {preview.length === 0 ? <EmptyState title="No one to pay" hint="Team members appear here once they have joined the agency." />
          : visible.length === 0 ? <NoMatches noun="team members" onClear={() => { setSearch(""); setOnly(""); }} /> : (
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-[20%]">Team member</TableHead><TableHead className="w-[16%]">Pay plan</TableHead><TableHead className="w-[22%] text-right">Earned in {name}</TableHead>
              <TableHead className="w-[12%] text-right">Owes from before</TableHead><TableHead>What happens to it</TableHead><TableHead className="w-[12%] text-right">Pay</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {shown.rows.map((p) => {
                const c = choices[p.producerUserId];
                const parts = breakdown(p);
                const pay = payable(p) && c?.include ? payOf(p).payCents : null;
                return (
                  <TableRow key={p.producerUserId} className="cursor-pointer" onClick={() => openRow(p)}>
                    <TableCell>
                      <button type="button" className="whitespace-nowrap text-left font-medium hover:underline" onClick={(e) => { e.stopPropagation(); openRow(p); }}>{p.displayName}</button>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{p.planModel === "solo_owner" ? "Owner" : modelOf(p)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums" title={parts || undefined}>{p.periodCents === 0 && !parts ? <span className="text-muted-foreground">—</span> : dollars(p.periodCents)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{owedBefore(p) ? dollars(owedBefore(p)) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>{happens(p)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{pay === null ? <span className="text-muted-foreground">—</span> : dollars(pay)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableCard>

      {open ? (
        <PersonDialog
          person={open}
          month={label}
          choice={choices[open.producerUserId]}
          defaultPct={pctOf(rules.recoveryPctBp)}
          fallbackBp={rules.recoveryPctBp}
          ledgerHref={records[open.producerUserId] ? `/app/producers/${records[open.producerUserId]}?tab=money` : null}
          canEdit={canCommit}
          canWriteOff={moneyActions && owes(open)}
          onWriteOff={() => { setWritingOff(open); setOpen(null); }}
          onClose={() => setOpen(null)}
          onSave={(next) => { setChoices((all) => ({ ...all, [open.producerUserId]: next })); setOpen(null); }}
        />
      ) : null}
      {confirming ? (
        <ConfirmPay
          month={month}
          people={chosen.map((p) => ({ person: p, payCents: payOf(p).payCents, choice: choices[p.producerUserId], mode: modeOf(p, choices[p.producerUserId]) }))}
          pctBp={pctBp}
          onClose={() => setConfirming(false)}
          onDone={() => { setConfirming(false); router.push(`/app/producer-payouts?tab=runs&period=${month}`); router.refresh(); }}
        />
      ) : null}
      <WriteOff person={writingOff} onClose={() => setWritingOff(null)} onDone={() => { setWritingOff(null); router.refresh(); }} />
    </>
  );
}

/** 6·2 · a person's draft (md): pay them this month or not, and what happens to what they owe. */
function PersonDialog({ person: p, month, choice, defaultPct, fallbackBp, ledgerHref, canEdit, canWriteOff, onWriteOff, onClose, onSave }: {
  person: PreviewPerson; month: string; choice: Choice; defaultPct: string; fallbackBp: number; ledgerHref: string | null;
  canEdit: boolean; canWriteOff: boolean; onWriteOff: () => void; onClose: () => void; onSave: (next: Choice) => void;
}) {
  const [draft, setDraft] = useState<Choice>(choice);
  const who = first(p.displayName);
  const pct = parsePctToBp(draft.pct);
  const badPct = draft.mode === "recover" && pct === null;
  const result = draftPay({ beforeCents: p.balanceBeforeCents, periodCents: p.periodCents }, owes(p) ? draft.mode : "pay_full", pct ?? fallbackBp);
  const canPay = payable(p);
  const editable = canEdit && canPay;
  const facts = [`Earned ${dollars(p.periodCents)}`, owedBefore(p) ? `owes ${dollars(owedBefore(p))} from before` : "owes nothing from before", modelOf(p).toLowerCase()].join(" · ");
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{p.displayName} · {month}</DialogTitle>
          <DialogDescription>{facts}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {!canPay ? (
            <p className="m-0 text-sm text-muted-foreground">{p.alreadyRun ? `${month} is already paid for ${who}.` : p.planModel === "solo_owner" ? "The owner is not on payroll." : "Nothing to pay or close this month."}</p>
          ) : editable ? (
            <ToggleRow id="draft-pay" title={`Pay ${who} this month`} help={draft.include ? undefined : "Left out: the month stays open for them."} checked={draft.include} onChange={(include) => setDraft({ ...draft, include })} />
          ) : (
            <p className="m-0 text-sm">{draft.include ? `${who} is paid this month.` : `${who} is left out this month.`}</p>
          )}
          {canPay && owes(p) && draft.include ? (
            <div className="flex flex-col gap-3">
              <p className="m-0 text-sm font-medium">What happens to what {who} owes</p>
              {editable ? (
                <Segmented label={`What happens to what ${who} owes`} value={draft.mode} onChange={(mode) => setDraft({ ...draft, mode })} options={[
                  { key: "withhold", label: CHOICE_LABEL.withhold }, { key: "recover", label: CHOICE_LABEL.recover }, { key: "forgive", label: CHOICE_LABEL.forgive },
                ]} />
              ) : <p className="m-0 text-sm">{CHOICE_LABEL[draft.mode]}{draft.mode === "recover" ? `: ${draft.pct}%` : ""}</p>}
              {draft.mode === "recover" && editable ? (
                <Field label="Share to take back (%)" htmlFor="draft-pct" error={badPct ? "Enter the share as a percent, like 70 or 12.5." : undefined}
                  hint={badPct ? undefined : `Your default is ${defaultPct}. ${dollars(result.takenCents)} taken back.${result.afterCents < 0 ? ` Still owes ${dollars(-result.afterCents)} after this.` : ""}`}>
                  <input id="draft-pct" className={control} inputMode="decimal" value={draft.pct} onChange={(e) => setDraft({ ...draft, pct: e.target.value })} />
                </Field>
              ) : (
                <p className="m-0 text-xs text-muted-foreground">{result.takenCents ? `${dollars(result.takenCents)} taken back. ` : ""}{result.afterCents < 0 ? `Still owes ${dollars(-result.afterCents)} after this.` : result.forgivenCents ? `${dollars(result.forgivenCents)} let go.` : "Owes nothing after this."}</p>
              )}
            </div>
          ) : null}
          {canPay && draft.include ? <p className="m-0 text-sm">Pay this month: <span className="font-semibold tabular-nums">{dollars(result.payCents)}</span></p> : null}
        </div>
        <DialogFooter className="sm:justify-between">
          <span className="flex items-center gap-2">
            {ledgerHref ? <Link className="text-sm font-medium text-[var(--accent-ink)] hover:underline" href={ledgerHref}>{who}&apos;s ledger ›</Link> : null}
            {canWriteOff ? <MoreMenu label={`More for ${p.displayName}`} items={[{ label: "Write off everything they owe", onSelect: onWriteOff }]} /> : null}
          </span>
          <span className="flex gap-2">
            {editable ? <><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => onSave(draft)} disabled={badPct}>Save to the draft</Button></> : <Button variant="outline" onClick={onClose}>Close</Button>}
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 6·2 · Confirm and mark paid (lg): how everyone was paid, once; a person changed only where it differs. */
function ConfirmPay({ month, people, pctBp, onClose, onDone }: {
  month: string;
  people: Array<{ person: PreviewPerson; payCents: number; choice: Choice; mode: RunMode }>;
  pctBp: (c: Choice) => number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [all, setAll] = useState<How>({ method: "Bank transfer", reference: "", paidOn: today() });
  const [own, setOwn] = useState<Record<string, How>>({});
  const [changing, setChanging] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const label = longMonth(month);
  const total = people.reduce((sum, x) => sum + x.payCents, 0);
  const paid = people.filter((x) => x.payCents > 0);
  const howOf = (id: string) => own[id] ?? all;

  async function confirm() {
    setBusy(true);
    setProblem(null);
    const [y, m] = month.split("-").map(Number);
    const to = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
    const { error } = await sendJson("/api/app/agency/payouts", "POST", {
      from: `${month}-01`, to, paidOn: all.paidOn, method: all.method, reference: all.reference.trim() || null,
      decisions: people.map(({ person, choice, mode }) => {
        const how = howOf(person.producerUserId);
        return {
          producerUserId: person.producerUserId, mode, pctBp: mode === "recover" ? pctBp(choice) : null,
          reason: mode === "withhold" ? "Took it all back: owed from before comes off first" : mode === "recover" ? `Took a share: ${pctOf(pctBp(choice))} of what was owed` : mode === "forgive" ? "Let it go" : null,
          method: how.method, reference: how.reference.trim() || null, paidOn: how.paidOn,
        };
      }),
    });
    setBusy(false);
    if (error) { setProblem(`That didn't save. ${label} is not marked paid; try again. (${error})`); return; }
    notify.done(`${label} is paid: ${people.length} ${people.length === 1 ? "person" : "people"}, ${dollars(total)}. Each has a private statement.`);
    onDone();
  }

  const howFields = (value: How, set: (next: How) => void, key: string) => (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="How did you pay them?" htmlFor={`${key}-method`}><select id={`${key}-method`} className={control} value={value.method} onChange={(e) => set({ ...value, method: e.target.value })}>{PAY_METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
      <Field label="Paid on" htmlFor={`${key}-on`}><input id={`${key}-on`} type="date" className={control} value={value.paidOn} onChange={(e) => set({ ...value, paidOn: e.target.value })} /></Field>
      <Field label="Reference" htmlFor={`${key}-ref`}><input id={`${key}-ref`} className={control} placeholder={value.method === "Check" ? "Check number" : "Optional"} maxLength={120} value={value.reference} onChange={(e) => set({ ...value, reference: e.target.value })} /></Field>
    </div>
  );

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent size={WIDE_DIALOG}>
        <DialogHeader>
          <DialogTitle>Mark {label} paid?</DialogTitle>
          <DialogDescription>{people.length} {people.length === 1 ? "person" : "people"}, {dollars(total)}. Each gets a private statement; the month is stamped paid. Nothing here moves money.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {howFields(all, setAll, "all")}
          <ul className="m-0 flex max-h-64 list-none flex-col divide-y divide-border overflow-y-auto rounded-md border border-border p-0 text-sm">
            {people.map(({ person, payCents }) => {
              const id = person.producerUserId;
              const mine = own[id];
              return (
                <li key={id} className="flex flex-col gap-2 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{person.displayName}</span>
                    <span className="flex items-center gap-3">
                      <span className="tabular-nums">{dollars(payCents)}</span>
                      <span className="text-xs text-muted-foreground">{payCents === 0 ? "Nothing to pay this month. The month still closes for them." : mine ? [mine.method, mine.reference, usDate(mine.paidOn)].filter(Boolean).join(" · ") : "same as above"}</span>
                    </span>
                  </div>
                  {changing === id && payCents > 0 ? (
                    <div className="flex flex-col gap-2">
                      {howFields(mine ?? all, (next) => setOwn((cur) => ({ ...cur, [id]: next })), `own-${id}`)}
                      <div className="flex justify-end gap-2">
                        {mine ? <Button size="sm" variant="ghost" onClick={() => { setOwn((cur) => { const rest = { ...cur }; delete rest[id]; return rest; }); setChanging(""); }}>Same as above</Button> : null}
                        <Button size="sm" variant="outline" onClick={() => setChanging("")}>Done</Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {paid.length > 1 ? (
            <Field label="Change for one person" htmlFor="own-pick">
              <select id="own-pick" className={control} value={changing} onChange={(e) => setChanging(e.target.value)}>
                <option value="">Choose a person</option>
                {paid.map(({ person }) => <option key={person.producerUserId} value={person.producerUserId}>{person.displayName}</option>)}
              </select>
            </Field>
          ) : null}
          {problem ? <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{problem}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Back</Button>
          <Button onClick={() => void confirm()} disabled={busy || !all.paidOn}>{busy ? "Saving…" : "Confirm and mark paid"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** ⋯ Write off (the draft dialog's, a producer's): the existing confirm, with its reason. */
function WriteOff({ person, onClose, onDone }: { person: PreviewPerson | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const balance = person ? Math.min(person.balanceCents, person.balanceBeforeCents) : 0;
  async function go() {
    if (!person || !reason.trim()) return;
    setBusy(true);
    setProblem(null);
    const { error } = await sendJson("/api/app/accounting/producers", "POST", { op: "write_off", producer_user_id: person.producerUserId, reason: reason.trim() });
    setBusy(false);
    if (error) { setProblem(error); return; }
    notify.done(`${person.displayName}'s negative balance is written off. The agency carries it.`);
    setReason("");
    onDone();
  }
  return (
    <ConfirmDialog
      open={person !== null}
      onOpenChange={(next) => { if (!next) { setReason(""); setProblem(null); onClose(); } }}
      title={person ? `Write off ${person.displayName}'s balance of ${dollars(-balance)}?` : ""}
      description="Use this when you will never get the money back. Their balance goes to zero and the agency carries the loss. It cannot be undone."
      confirmLabel={busy ? "Saving…" : "Write it off"}
      cancelLabel="Keep it"
      busy={busy}
      confirmDisabled={!reason.trim()}
      onConfirm={() => void go()}
      fields={<>
        <Field label="Why? (kept on the record)" htmlFor="write-off-why"><input id="write-off-why" className={control} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Left the agency, not recoverable" /></Field>
        {problem ? <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{problem}</p> : null}
      </>}
    />
  );
}

type RunFilter = "all" | "paid" | "owes" | "nothing" | "void";
const voided = (r: Run) => r.status === "void" || r.status === "voided";
const runState = (r: Run): Exclude<RunFilter, "all"> => (voided(r) ? "void" : r.balanceAfterCents < 0 ? "owes" : r.paidOn ? "paid" : "nothing");

/** 6·1 · Runs: one row per person per month; a row opens the private statement. */
export function RunsBoard({ runs, names, payMonth, month, canCommit }: { runs: Run[]; names: Record<string, string>; payMonth: string; /** `?month=YYYY-MM`, or "all". */ month: string; canCommit: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState<RunFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(300, 52);
  const inMonth = runs.filter((r) => month === "all" || r.periodStart.slice(0, 7) === month);
  const needle = search.trim().toLowerCase();
  const visible = inMonth
    .filter((r) => filter === "all" || runState(r) === filter)
    .filter((r) => !needle || (names[r.producerUserId] ?? "").toLowerCase().includes(needle));
  const shown = paginate(visible, page, pageSize);
  const count = (f: Exclude<RunFilter, "all">) => inMonth.filter((r) => runState(r) === f).length;
  const pick = (f: RunFilter) => { setFilter(f); setPage(1); };
  const how = (r: Run) => [payMethodLabel(r.paidMethod), r.paymentReference].filter(Boolean).join(" · ");
  const open = (r: Run) => `/app/producer-statements/${r.id}`;

  return (
    <>
      <StepSlot id={PRODUCER_PAYOUTS_SLOT}>
        <MonthSelect value={month} allLabel="All months" />
        {canCommit ? <Button asChild><Link href={`/app/producer-payouts?period=${payMonth}`}>Pay {monthName(payMonth)}</Link></Button> : null}
      </StepSlot>
      <TableCard
        toolbar={runs.length === 0 ? undefined : (
          <DataToolbar>
            <ToolbarSearch value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search team member" />
            <Segmented label="Run status" value={filter} onChange={pick} options={[
              { key: "all", label: "All", count: inMonth.length },
              { key: "paid", label: "Paid", count: count("paid") || null },
              { key: "owes", label: "Still owes", count: count("owes") || null, tone: "danger" },
              { key: "nothing", label: "Nothing to pay", count: count("nothing") || null },
              { key: "void", label: "Void", count: count("void") || null },
            ]} />
          </DataToolbar>
        )}
        footer={runs.length === 0 ? undefined : (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Newest month first</p>
            {visible.length > pageSize ? <Pager page={shown.current} total={visible.length} noun="runs" pageSize={pageSize} onPage={setPage} /> : null}
          </div>
        )}
      >
        {runs.length === 0 ? <EmptyState title="No payroll run yet" hint="Each month you confirm appears here, one row per person, with their private statement." action={canCommit ? <Button asChild><Link href="/app/producer-payouts">Pay {monthName(payMonth)}</Link></Button> : undefined} />
          : visible.length === 0 ? <NoMatches noun="runs" onClear={() => { setSearch(""); pick("all"); }} /> : (
          <Table>
            <TableHeader><TableRow><TableHead className="w-[24%]">Team member</TableHead><TableHead className="w-[16%]">Month</TableHead><TableHead className="w-[12%] text-right">Paid</TableHead><TableHead className="w-[18%]">How</TableHead><TableHead className="w-[14%]">Paid on</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {shown.rows.map((r) => {
                const state = runState(r);
                const paidOut = Boolean(r.paidOn) && !voided(r);
                return (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(open(r))}>
                    <TableCell>
                      <Link className="whitespace-nowrap font-medium hover:underline" href={open(r)} onClick={(e) => e.stopPropagation()}>{names[r.producerUserId] ?? "Team member"}</Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{periodWords(r.periodStart, r.periodEnd)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{dollars(r.netCents)}</TableCell>
                    <TableCell className="whitespace-nowrap">{paidOut ? how(r) || "Paid" : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{paidOut ? usDate(r.paidOn) : "—"}</TableCell>
                    <TableCell>{state === "void" ? <StatusChip tone="neutral">Void</StatusChip> : state === "owes" ? <StatusChip tone="danger">Still owes {dollars(-r.balanceAfterCents)}</StatusChip> : state === "paid" ? <StatusChip tone="good">Paid</StatusChip> : <StatusChip tone="neutral">Nothing to pay</StatusChip>}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableCard>
    </>
  );
}

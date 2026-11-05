"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { cardSurface } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, control, textareaControl } from "@/components/ui/field";
import { MoreMenu } from "@/components/ui/more-menu";
import { personName } from "@/lib/format/personName";
import { cn } from "@/lib/utils";
import { CASE_STATUS_LABELS, FORWARD, canMove, type CaseStatus } from "@/lib/retention/reinstatement";
import type { CaseRow } from "@/lib/retention/reinstatementStore";
import { notify } from "@/lib/notify";

/**
 * Retention › Reinstatement › a case (LA-5.6, direction RiA 2026-11-05; was the 600px CaseDialog). The page
 * (app/app/(shell)/reinstatement/[id]/page.tsx) draws the title line; these are its parts: the next step and
 * More (declines through a confirm that asks why), the reinstate-or-sell-new comparison with the steps, the
 * form of what the carrier needs, and the note. Every save posts to /api/app/retention/reinstatement.
 */

const money = (cents: number | null) => (cents === null ? null : `$${Math.round(cents / 100).toLocaleString("en-US")}`);
const NEXT_LABEL: Partial<Record<CaseStatus, string>> = { contacted: "Called them", client_agreed: "Client agreed", submitted: "Sent to the carrier" };
type Decline = "declined_by_client" | "declined_by_carrier";

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/app/retention/reinstatement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "That could not be saved.");
}
const errorText = (e: unknown) => (e instanceof Error ? e.message : "That could not be saved.");

/** The title line's actions on an open case: the next forward step, and More. */
export function CaseActions({ row }: { row: CaseRow }) {
  const router = useRouter();
  const next = FORWARD.find((s) => canMove(row.status, s));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState<Decline | null>(null);
  const [reason, setReason] = useState("");
  const ready = reason.trim().length >= 3;

  async function move(status: CaseStatus, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      await post({ id: row.id, status, ...extra });
      notify.done(status === "submitted" ? "Sent. The case closes as reinstated when a carrier file shows the policy back in force." : "Saved.");
      setDeclining(null);
      setReason("");
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && !declining && <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>}
      {next && NEXT_LABEL[next] && <Button type="button" disabled={busy} onClick={() => void move(next)}>{busy && !declining ? "Saving…" : NEXT_LABEL[next]}</Button>}
      <MoreMenu items={[
        { label: "Declined by the client", onSelect: () => { setError(null); setReason(""); setDeclining("declined_by_client"); } },
        { label: "Declined by the carrier", onSelect: () => { setError(null); setReason(""); setDeclining("declined_by_carrier"); } },
        { label: "Open the policy", href: `/app/policies/carrier/${row.carrierId}/${encodeURIComponent(row.policyNumber)}` },
      ]} />
      <ConfirmDialog
        open={declining !== null}
        onOpenChange={(open) => { if (!open) { setDeclining(null); setError(null); } }}
        busy={busy}
        title={declining === "declined_by_carrier" ? "The carrier said no?" : "The client said no?"}
        description={`The case closes as "${declining ? CASE_STATUS_LABELS[declining].toLowerCase() : ""}" and leaves the open list. ${row.clientName ? personName(row.clientName) : row.policyNumber} goes to win-back once the window has passed.`}
        cancelLabel="Keep it open"
        confirmLabel="Mark declined"
        confirmDisabled={!ready}
        onConfirm={() => { if (declining && ready) void move(declining, { decline_reason: reason.trim() }); }}
        fields={
          <Field label="Why" htmlFor="case-decline-reason" required error={error ?? undefined} hint="A few words, for the record.">
            <input id="case-decline-reason" autoComplete="off" maxLength={500} className={control} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        }
      />
    </>
  );
}

/** "Reinstate or sell new": the two columns as the dialog had them, and the steps with the current one marked. */
export function CaseComparison({ row }: { row: CaseRow }) {
  const c = row.comparison;
  const steps: Array<{ key: CaseStatus; label: string }> = [
    { key: "identified", label: CASE_STATUS_LABELS.identified },
    { key: "contacted", label: "Called them" },
    { key: "client_agreed", label: "Client agreed" },
    { key: "submitted", label: "Sent to the carrier" },
    { key: "reinstated", label: "Back in force (from the file)" },
  ];
  return (
    <section className={`${cardSurface} flex flex-col gap-4 p-5`} aria-label="Reinstate or sell new">
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <span className="block font-semibold text-foreground">Reinstate</span>
          <ul className="m-0 mt-1 grid list-none gap-0.5 p-0 text-muted-foreground">
            <li>{c.reinstate.owedCents === null ? "Back premium: ask the carrier" : `Pays ${c.reinstate.owedIsEstimate ? "about " : ""}${money(c.reinstate.owedCents)} back premium${c.reinstate.owedIsEstimate ? " (estimate)" : ""}`}</li>
            <li>Coverage resumes as it was</li>
            <li>{c.reinstate.advanceRevivesCents !== null ? `Your advance revives: ${money(c.reinstate.advanceRevivesCents)}` : "The original advance revives"}</li>
            <li>No new chargeback window</li>
            {c.reinstate.needsHealthQuestions && <li>A short health questionnaire</li>}
          </ul>
        </div>
        <div>
          <span className="block font-semibold text-foreground">Sell a new policy</span>
          <ul className="m-0 mt-1 grid list-none gap-0.5 p-0 text-muted-foreground">
            <li>{c.sellNew.ageNow !== null ? `Priced at age ${c.sellNew.ageNow}${c.sellNew.olderNow ? `, not ${c.sellNew.ageThen}` : ""}: quote it` : "Priced at today's age: quote it"}</li>
            <li>A new application, two to three weeks</li>
            <li>A new advance, and a new twelve-month risk</li>
            <li>The lead cost is spent either way</li>
          </ul>
        </div>
      </div>
      <ol className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0 text-xs" aria-label="Steps">
        {steps.map((s, i) => {
          const current = s.key === row.status;
          return (
            <li key={s.key} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden="true" className="text-muted-foreground">›</span>}
              <span aria-current={current ? "step" : undefined} className={cn("inline-flex h-7 items-center rounded-full border px-2.5 font-medium", current ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "border-border text-muted-foreground")}>{s.label}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const yesNoOf = (v: boolean | null) => (v === null ? "" : v ? "yes" : "no");
const yesNo = (v: string) => (v === "" ? null : v === "yes");

/** "What the carrier needs": the quote, the months, the paperwork, one Save (no change of step). */
export function CaseNeedsForm({ row, readOnly }: { row: CaseRow; readOnly: boolean }) {
  const router = useRouter();
  const c = row.comparison.reinstate;
  // Empty when nothing was quoted yet: a "0" here saved $0 owed on the first save (QA 2026-11-05).
  const initial = {
    owed: row.comparison.reinstate.owedIsEstimate || row.comparison.reinstate.owedCents === null ? "" : String(row.comparison.reinstate.owedCents / 100),
    months: c.owedIsEstimate || c.months === null ? "" : String(c.months),
    health: yesNoOf(row.requiresHealthQuestions),
    form: yesNoOf(row.requiresSignedForm),
    reference: row.carrierReference ?? "",
    requirements: row.requirementsNote ?? "",
  };
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof initial) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: key === "months" ? e.target.value.replace(/\D/g, "") : e.target.value }));
  const dirty = (Object.keys(initial) as Array<keyof typeof initial>).some((k) => values[k] !== initial[k]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const owedCents = values.owed.trim() === "" ? null : Math.round(Number(values.owed.replace(/[$,]/g, "")) * 100);
      if (owedCents !== null && !Number.isFinite(owedCents)) throw new Error("Enter the amount the carrier quoted, in dollars.");
      await post({
        id: row.id,
        amount_owed_cents: owedCents, months_owed: values.months.trim() === "" ? null : Number(values.months),
        requires_health_questions: yesNo(values.health), requires_signed_form: yesNo(values.form),
        requirements_note: values.requirements.trim() || null, carrier_reference: values.reference.trim() || null,
      });
      notify.done("Saved.");
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`${cardSurface} flex flex-col gap-4 p-5`} onSubmit={(e) => void save(e)} aria-label="What the carrier needs">
      <LeaveGuard dirty={dirty && !busy && !readOnly} onDiscard={() => setValues(initial)} what="what the carrier needs" />
      <fieldset disabled={readOnly || busy} className="m-0 grid min-w-0 gap-4 border-0 p-0 sm:grid-cols-2">
        <Field label="Back premium quoted ($)" htmlFor="case-owed">
          <input id="case-owed" inputMode="decimal" autoComplete="off" className={control} value={values.owed} onChange={set("owed")} placeholder={c.owedIsEstimate && c.owedCents !== null ? `about ${money(c.owedCents)}` : ""} />
        </Field>
        <Field label="Months owed" htmlFor="case-months">
          <input id="case-months" inputMode="numeric" autoComplete="off" className={control} value={values.months} onChange={set("months")} />
        </Field>
        <Field label="Health questions" htmlFor="case-health">
          <select id="case-health" className={control} value={values.health} onChange={set("health")}><option value="">Not known</option><option value="yes">Yes</option><option value="no">No</option></select>
        </Field>
        <Field label="Signed form" htmlFor="case-form">
          <select id="case-form" className={control} value={values.form} onChange={set("form")}><option value="">Not known</option><option value="yes">Yes</option><option value="no">No</option></select>
        </Field>
        <Field label="Carrier reference" htmlFor="case-ref">
          <input id="case-ref" autoComplete="off" maxLength={120} className={control} value={values.reference} onChange={set("reference")} />
        </Field>
        <Field label="What else they need" htmlFor="case-req">
          <input id="case-req" autoComplete="off" maxLength={1000} className={control} value={values.requirements} onChange={set("requirements")} />
        </Field>
      </fieldset>
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {error && <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>}
          <Button type="button" variant="outline" disabled={busy || !dirty} onClick={() => { setValues(initial); setError(null); }}>Discard</Button>
          <Button type="submit" disabled={busy || !dirty}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      )}
    </form>
  );
}

/** "Notes": the case's note. */
export function CaseNoteForm({ row, readOnly }: { row: CaseRow; readOnly: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState(row.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = note !== (row.note ?? "");

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post({ id: row.id, note: note.trim() || null });
      notify.done("Saved.");
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`${cardSurface} flex flex-col gap-4 p-5`} onSubmit={(e) => void save(e)} aria-label="Notes">
      <LeaveGuard dirty={dirty && !busy && !readOnly} onDiscard={() => setNote(row.note ?? "")} what="the note" />
      <Field label="Note" htmlFor="case-note">
        <textarea id="case-note" className={textareaControl} maxLength={2000} disabled={readOnly || busy} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {error && <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>}
          <Button type="submit" disabled={busy || !dirty}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      )}
    </form>
  );
}

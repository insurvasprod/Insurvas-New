"use client";

/**
 * The draft-date optimiser's screen parts (LA-3.9; boards l3-ws-payment "Draft date" and
 * l3-draft-dates). The Payment step and the standalone /app/draft-dates calculator share the state
 * hook and every part below, so the sentence the agent reads aloud is the same everywhere — it comes
 * from `recommendDraftDay`, never from the screen. Picking a day that is not the recommendation needs
 * a recorded reason (the server refuses it without one and logs it): drafts that land before the
 * deposit are the biggest cause of early lapse.
 */

import { useMemo, useState, type ReactNode } from "react";
import { CalendarCheck, CalendarDays, Check, MessageSquareQuote, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PagedBody } from "@/components/ui/paged";
import { StatusChip } from "@/components/ui/status-chip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Callout, Field, control } from "@/components/app/settings/primitives";
import { INCOME_TYPES, type IncomeType } from "@/lib/applications/constants";
import { MAX_DRAFT_DAY, isSafeDraftDay, recommendDraftDay, type DraftDateInput, type DraftOption, type DraftRecommendation, type PayFrequency } from "@/lib/draftDates/optimiser";
import { cn } from "@/lib/utils";

import { ordinal, shortDate } from "@/components/app/applications/parts";
import { StepCard } from "@/components/app/applications/workspace/step-card";

export const PAY_FREQUENCY_LABEL: Record<PayFrequency, string> = { weekly: "Every week", biweekly: "Every two weeks", semimonthly: "Twice a month (1st and 15th)", monthly: "Once a month" };
const WEEK_WORD: Record<number, string> = { 2: "Second", 3: "Third", 4: "Fourth" };
/** The income tiles: a short name, and when that money usually lands. */
const INCOME_TILE: Record<IncomeType, string> = { ssa: "Social Security", ssi: "SSI", ssa_ssi: "Social Security + SSI", pension: "Pension", payroll: "Paycheck", va: "VA benefits", none: "Not known" };
const INCOME_LANDS: Record<IncomeType, string> = { ssa: "Incl. SSDI · a Wednesday", ssi: "Lands on the 1st", ssa_ssi: "Lands on the 3rd", pension: "A set day each month", payroll: "On their paydays", va: "Lands on the 1st", none: "We take a mid-month day" };

export type DraftDateInitial = {
  incomeType?: IncomeType | null;
  birthDay?: number | null;
  before1997?: boolean;
  pensionDay?: number | null;
  payFrequency?: PayFrequency | null;
  payAnchor?: string | null;
  draftDay?: number | null;
  overrideReason?: string | null;
};

/** What the Payment step stores on `payment` (PaymentView's draft fields). */
export type DraftDateCommit = {
  incomeType: IncomeType | null;
  incomeInputs: Record<string, unknown>;
  draftDay: number | null;
  draftDayRecommended: number | null;
  draftOverrideReason: string | null;
};

type State = {
  incomeType: IncomeType | null;
  /** null = follow the day of the DOB. */
  birthDayText: string | null;
  before1997: boolean;
  pensionDayText: string;
  payFrequency: PayFrequency | null;
  payAnchor: string;
  draftDay: number | null;
  overrideReason: string | null;
  /**
   * The agent chose this day themselves (an alternate, or Override…). Until they do, the day follows
   * the recommendation wherever the inputs take it — including after a step with no recommendation
   * (a pension with no pay day yet), which used to leave the last income type's day behind and then
   * read it out as "the day you asked for".
   */
  picked: boolean;
};

export const dobDay = (dob: string | null | undefined) => {
  const m = /^\d{4}-\d{2}-(\d{2})$/.exec(dob ?? "");
  return m ? Number(m[1]) : null;
};
const dayNumber = (text: string | null) => {
  if (text === null || !/^\d{1,2}$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= 1 && n <= 31 ? n : null;
};

function toInput(s: State, dob: string | null, buffer: number, from: Date | undefined): DraftDateInput | null {
  if (!s.incomeType) return null;
  return {
    incomeType: s.incomeType,
    birthDay: s.birthDayText === null ? dobDay(dob) : dayNumber(s.birthDayText),
    before1997: s.before1997,
    pensionDay: dayNumber(s.pensionDayText),
    payFrequency: s.payFrequency,
    payAnchor: s.payAnchor || null,
    buffer,
    from,
  };
}

const recDay = (r: DraftRecommendation | null) => (r && r.kind !== "not_applicable" ? r.recommended.day : null);

/** The draft input a stored payment describes (for inferring the buffer it was recommended with). */
export function inputFromInitial(initial: DraftDateInitial, dob: string | null): DraftDateInput | null {
  if (!initial.incomeType) return null;
  return { incomeType: initial.incomeType, birthDay: initial.birthDay ?? dobDay(dob), before1997: initial.before1997 ?? false, pensionDay: initial.pensionDay ?? null, payFrequency: initial.payFrequency ?? null, payAnchor: initial.payAnchor ?? null };
}

/** "Third Wednesday", "The 1st", … — the schedule in two or three words. */
export function scheduleShort(input: DraftDateInput | null) {
  if (!input) return null;
  switch (input.incomeType) {
    case "ssa": {
      if (input.before1997) return "The 3rd";
      const b = input.birthDay ?? 1;
      return `${WEEK_WORD[b <= 10 ? 2 : b <= 20 ? 3 : 4]} Wednesday`;
    }
    case "ssa_ssi": return "The 3rd";
    case "ssi": case "va": return "The 1st";
    case "pension": return input.pensionDay ? `Pension on the ${ordinal(input.pensionDay)}` : "Pension";
    case "payroll": return input.payFrequency ? PAY_FREQUENCY_LABEL[input.payFrequency] : "Paydays";
    default: return "Income timing unknown";
  }
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "21 Oct" (chip) or "Wed 21 Oct" (row) for a deposit's calendar day. */
export function depositDate(iso: string, style: "chip" | "row") {
  const day = shortDate(iso, { year: false });
  return style === "chip" ? day : `${WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]} ${day}`;
}

const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * The optimiser's state: the income inputs, the recommendation they give, the chosen day and its
 * recorded reason. `onCommit` hears every change (the Payment step decides when to send it).
 */
export function useDraftDate({ initial, dob, buffer, from, onCommit }: {
  initial: DraftDateInitial;
  dob: string | null;
  buffer: number;
  /** The month before the first drafted month; defaults to today (drafts start next month). */
  from?: Date;
  onCommit?: (c: DraftDateCommit) => void;
}) {
  const [state, setState] = useState<State>(() => ({
    incomeType: initial.incomeType ?? null,
    birthDayText: initial.birthDay != null && initial.birthDay !== dobDay(dob) ? String(initial.birthDay) : null,
    before1997: initial.before1997 ?? false,
    pensionDayText: initial.pensionDay ? String(initial.pensionDay) : "",
    payFrequency: initial.payFrequency ?? null,
    payAnchor: initial.payAnchor ?? "",
    draftDay: initial.draftDay ?? null,
    overrideReason: initial.overrideReason ?? null,
    // A stored day off the recommendation always carries its reason (the server refuses it without).
    picked: Boolean(initial.overrideReason),
  }));

  const input = useMemo(() => toInput(state, dob, buffer, from), [state, dob, buffer, from]);
  const rec = useMemo(() => (input ? recommendDraftDay(input) : null), [input]);

  function apply(patch: Partial<State>) {
    const prevInput = toInput(state, dob, buffer, from);
    const prevRec = recDay(prevInput ? recommendDraftDay(prevInput) : null);
    let next: State = { ...state, ...patch };
    const nextInput = toInput(next, dob, buffer, from);
    const nextRecommendation = nextInput ? recommendDraftDay(nextInput) : null;
    const nextRec = recDay(nextRecommendation);
    if (!("draftDay" in patch) && nextRec !== null && !next.overrideReason) {
      // No day yet: take the recommendation. Following the tool: when the inputs move it, the day moves
      // with it — unless the agent picked the day themselves.
      if (next.draftDay === null || next.draftDay === prevRec || !next.picked) next = { ...next, draftDay: nextRec };
    }
    // A reason explains one day; picking another day asks again. Taking the recommendation is not a pick.
    if ("draftDay" in patch && patch.draftDay !== state.draftDay) next = { ...next, overrideReason: patch.overrideReason ?? null };
    if ("draftDay" in patch) next = { ...next, picked: patch.draftDay !== null && patch.draftDay !== nextRec };
    setState(next);
    if (!onCommit) return;
    onCommit({
      incomeType: next.incomeType,
      incomeInputs: nextInput ? { birthDay: nextInput.birthDay ?? null, before1997: next.before1997, pensionDay: nextInput.pensionDay ?? null, payFrequency: next.payFrequency, payAnchor: nextInput.payAnchor ?? null } : {},
      draftDay: next.draftDay,
      // Only a real schedule recommends; the "income unknown" middle-of-month guess is not one.
      draftDayRecommended: nextRecommendation?.kind === "recommended" ? nextRec : null,
      draftOverrideReason: nextRecommendation?.kind === "recommended" && next.draftDay !== null && next.draftDay !== nextRec ? next.overrideReason : null,
    });
  }

  const recommended = recDay(rec);
  const options: DraftOption[] = rec && rec.kind !== "not_applicable" ? [rec.recommended, ...rec.alternates] : [];
  const shown = state.draftDay ?? recommended;
  const offRecommendation = rec?.kind === "recommended" && state.draftDay !== null && state.draftDay !== recommended;
  const safe = offRecommendation && input && state.draftDay !== null ? isSafeDraftDay(input, state.draftDay) : true;
  // "Arrives around": the latest deposit day that still lands before the recommended draft.
  const arrivalDays = rec?.kind === "recommended" ? rec.arrivals.map((a) => Number(a.date.slice(8, 10))) : [];
  const beforeRec = arrivalDays.filter((d) => recommended !== null && d <= recommended);
  const latestArrival = beforeRec.length ? Math.max(...beforeRec) : arrivalDays[0] ?? null;

  return { state, apply, input, rec, recommended, options, shown, offRecommendation, safe, latestArrival, buffer };
}

export type DraftDateModel = ReturnType<typeof useDraftDate>;

/** What to read aloud for a day: the optimiser's sentence for an option, a plain one for an override. */
export function readAloudFor(m: DraftDateModel, day: number | null) {
  if (!m.rec || m.rec.kind === "not_applicable" || day === null) return null;
  const option = m.options.find((o) => o.day === day);
  if (option) return option.reason;
  return `${m.rec.schedule}. We will draft on the ${ordinal(day)}, the day you asked for.`;
}

/** "Why the 23rd" — from the twelve arrivals the recommendation was made against. */
export function whyText(m: DraftDateModel, pronoun: string) {
  if (m.rec?.kind !== "recommended" || m.recommended === null) return null;
  const gap = m.rec.recommended.minGapDays;
  const latest = m.latestArrival;
  return `Why the ${ordinal(m.recommended)}: it is ${gap} day${gap === 1 ? "" : "s"} after the latest the money lands in any of the next twelve months${latest ? ` (the ${ordinal(latest)})` : ""}, so the same day works every month and ${pronoun} only has to remember one.`;
}

/** The income inputs: type, then whatever that type's schedule needs. */
export function IncomeFields({ m, dob, readOnly, idPrefix, incomeHint, className }: {
  m: DraftDateModel;
  dob: string | null;
  readOnly: boolean;
  idPrefix: string;
  incomeHint?: string | null;
  className?: string;
}) {
  const { state, apply } = m;
  const id = (k: string) => `${idPrefix}.${k}`;
  const birthDayShown = state.birthDayText ?? (dobDay(dob) ? String(dobDay(dob)) : "");
  const small = cn(control, "mt-0 h-8 w-16 px-2 text-center tabular-nums");
  // Owner 2026-10-28: one click for where the money comes from (tiles like the payment methods, each
  // saying when that money lands), what the client said in the interview right under the question, and
  // the one detail the choice needs as a short sentence below.
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-col gap-2">
        {incomeHint && (
          <p className="m-0 inline-flex items-center gap-2 self-start rounded-[8px] border border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[var(--primary-soft)] px-2.5 py-1.5 text-sm text-[var(--ink)]">
            <MessageSquareQuote className="size-4 shrink-0 text-[var(--accent-ink)]" aria-hidden="true" />
            {incomeHint}
          </p>
        )}
        <span id={id("income_type")} role="radiogroup" aria-label="Where their money comes from" className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 outline-none">
          {INCOME_TYPES.map((t) => {
            const on = state.incomeType === t;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={readOnly}
                onClick={() => apply({ incomeType: t })}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-[10px] border-[1.5px] px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                  on ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border)] hover:border-[var(--border-strong)]",
                )}
              >
                <strong className={cn("text-sm font-semibold", on ? "text-[var(--ink)]" : "text-[var(--body)]")}>{INCOME_TILE[t]}</strong>
                <span className="text-xs text-[var(--muted)]">{INCOME_LANDS[t]}</span>
              </button>
            );
          })}
        </span>
      </div>

      {state.incomeType === "ssa" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-[var(--body)]">
          <label htmlFor={id("birth_day")} className="inline-flex items-center gap-2">
            Born on the
            <input id={id("birth_day")} inputMode="numeric" autoComplete="off" aria-label="Day of the month they were born" className={small} value={birthDayShown} disabled={readOnly || state.before1997} onChange={(e) => apply({ birthDayText: e.target.value })} />
            <span className="text-xs text-[var(--muted)]">{state.birthDayText === null && dobDay(dob) ? "(from the date of birth)" : "(sets which Wednesday it lands)"}</span>
          </label>
          <ToggleChip selected={state.before1997} disabled={readOnly} onClick={() => apply({ before1997: !state.before1997 })}>On it since before May 1997</ToggleChip>
        </div>
      )}

      {state.incomeType === "pension" && (
        <label htmlFor={id("pension_day")} className="inline-flex items-center gap-2 text-sm text-[var(--body)]">
          Paid on the
          <input id={id("pension_day")} inputMode="numeric" autoComplete="off" placeholder="1" className={small} value={state.pensionDayText} disabled={readOnly} onChange={(e) => apply({ pensionDayText: e.target.value })} />
          of the month
        </label>
      )}

      {state.incomeType === "payroll" && (
        <div className="flex flex-col gap-2">
          <span id={id("pay_frequency")} role="radiogroup" aria-label="How often they are paid" className="flex flex-wrap gap-1.5">
            {(Object.keys(PAY_FREQUENCY_LABEL) as PayFrequency[]).map((f) => <ToggleChip key={f} role="radio" selected={state.payFrequency === f} disabled={readOnly} onClick={() => apply({ payFrequency: f })}>{PAY_FREQUENCY_LABEL[f]}</ToggleChip>)}
          </span>
          {state.payFrequency && state.payFrequency !== "semimonthly" && (
            <label htmlFor={id("pay_anchor")} className="inline-flex items-center gap-2 text-sm text-[var(--body)]">
              A recent payday
              <input id={id("pay_anchor")} type="date" className={cn(control, "mt-0 h-8 w-auto")} value={state.payAnchor} disabled={readOnly} onChange={(e) => apply({ payAnchor: e.target.value })} />
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/** The read-aloud script: the one sentence the client hears, word for word. */
export function ReadAloud({ title, text }: { title: string; text: string }) {
  return (
    <Callout tone="info" title={title}>
      <p>“{text}”</p>
    </Callout>
  );
}

/** The next twelve deposits as small date chips (Payment step). */
export function ArrivalChips({ m }: { m: DraftDateModel }) {
  if (m.rec?.kind !== "recommended" || !m.rec.arrivals.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold uppercase tracking-[0.02em] text-[var(--muted)]">The next twelve arrivals</div>
      <ol aria-label="The next twelve deposits" className="flex flex-wrap gap-1.5">
        {m.rec.arrivals.map((a) => (
          <li key={a.month} title={monthName(a.month)} className="inline-flex h-7 w-[52px] items-center justify-center rounded-[6px] border border-[var(--border)] bg-[var(--surface)] text-xs tabular-nums text-[var(--body)]">
            {depositDate(a.date, "chip")}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The twelve months as a table: when the money arrives and how far after it the chosen day falls (standalone page). */
export function ArrivalTable({ m, day }: { m: DraftDateModel; day: number | null }) {
  if (m.rec?.kind !== "recommended") return null;
  return (
    <table className="portal-lead-table w-full text-left text-sm">
      <thead>
        <tr>
          <th scope="col" className="w-[132px]">Month</th>
          <th scope="col">Arrives</th>
          <th scope="col" className="w-[168px]">Recommended draft</th>
        </tr>
      </thead>
      <PagedBody className="m-seq">
        {m.rec.arrivals.map((a) => {
          const gap = day === null ? null : Math.round((Date.UTC(Number(a.month.slice(0, 4)), Number(a.month.slice(5, 7)) - 1, day) - Date.parse(`${a.date}T00:00:00Z`)) / 86_400_000);
          return (
            <tr key={a.month} className="m-row">
              <td>{monthName(a.month)}</td>
              <td className="tabular-nums">{depositDate(a.date, "row")}</td>
              <td className="tabular-nums">
                {day === null ? "—" : ordinal(day)}
                {gap !== null && <span className={cn("ml-1.5 text-xs", gap < 2 ? "text-[var(--warning-ink)]" : "text-[var(--muted)]")}>· {gap < 0 ? "before it" : `${gap} day${gap === 1 ? "" : "s"} after`}</span>}
              </td>
            </tr>
          );
        })}
      </PagedBody>
    </table>
  );
}

/**
 * A day off the recommendation: the loud warning when it can land before the money (with "Use the
 * {n}" and "Override — I confirmed with the client"), a quieter ask when it is safe but not the one
 * recommended. Either way the reason is recorded — the server refuses the day without it and logs it.
 */
export function OverridePrompt({ m, readOnly, idPrefix }: { m: DraftDateModel; readOnly: boolean; idPrefix: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { state, recommended, latestArrival, safe } = m;
  if (!m.offRecommendation || state.draftDay === null || recommended === null) return null;
  const day = state.draftDay;
  const reasonId = `${idPrefix}.override_reason`;

  if (state.overrideReason && !open) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--warning-ink)]">
        <span>Override recorded for the {ordinal(day)}: “{state.overrideReason}”</span>
        {!readOnly && <Button type="button" variant="ghost" onClick={() => { setText(state.overrideReason ?? ""); setOpen(true); }}>Change</Button>}
      </p>
    );
  }

  const record = () => {
    const reason = text.trim();
    if (!reason) { setError("Say what the client confirmed."); return; }
    setOpen(false);
    setError(null);
    m.apply({ overrideReason: reason });
  };

  const title = safe
    ? `The ${ordinal(day)} is not the recommended day. Record why the client wants it instead of the ${ordinal(recommended)}.`
    : `You picked the ${ordinal(day)}. Their money arrives around the ${ordinal(latestArrival ?? recommended)}. Drafts before the deposit lapse at several times the rate.`;

  return (
    <Callout tone="warning" title={title}>
      {!readOnly && (open ? (
        <div className="flex flex-col gap-2">
          <Field label="What did the client confirm?" htmlFor={reasonId} required error={error} hint="Recorded with your name, next to the day the calculator gave.">
            <input id={reasonId} className={control} autoComplete="off" value={text} onChange={(e) => { setText(e.target.value); if (error) setError(null); }} placeholder="Paid on the 20th by their employer" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => { setOpen(false); setError(null); }}>Cancel</Button>
            <Button type="button" onClick={record}>Record override</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => m.apply({ draftDay: recommended })}>Use the {ordinal(recommended)}</Button>
          <Button type="button" variant="outline" onClick={() => { setText(""); setOpen(true); }}>Override — I confirmed with the client</Button>
        </div>
      ))}
    </Callout>
  );
}

/** The header chip: which kind of day is set. */
function DayChip({ m }: { m: DraftDateModel }) {
  if (!m.rec || m.rec.kind === "not_applicable" || m.state.draftDay === null) return <StatusChip tone="neutral">Not set</StatusChip>;
  if (m.rec.kind === "neutral") return <StatusChip tone="neutral">Best guess</StatusChip>;
  if (!m.offRecommendation) return <StatusChip tone="good">Recommended</StatusChip>;
  return m.state.overrideReason ? <StatusChip tone="warning">Override</StatusChip> : <StatusChip tone="warning">Needs a reason</StatusChip>;
}

/**
 * The Payment step's draft-date card (board l3-ws-payment, right): the income inputs, the day in
 * large type, what to say, the alternates, the next twelve arrivals, and the one-line rule.
 */
export function DraftDatePanel({ initial, dob, buffer, onCommit, readOnly = false, incomeHint, idPrefix = "dd", draftDayId = "dd.draft_day", status, className, bare = false }: {
  initial: DraftDateInitial;
  /** Insured's DOB; its day is the Social Security birth day unless the agent types another. */
  dob: string | null;
  buffer: number;
  onCommit?: (c: DraftDateCommit) => void;
  readOnly?: boolean;
  /** What the client said in the interview about when their money arrives. */
  incomeHint?: string | null;
  idPrefix?: string;
  draftDayId?: string;
  /** The save state, shown beside the chip. */
  status?: ReactNode;
  className?: string;
  /** Inside a section that already names it (the Payment step): no card of its own, the chips on top. */
  bare?: boolean;
}) {
  const m = useDraftDate({ initial, dob, buffer, onCommit });
  const [choosing, setChoosing] = useState(false);
  const { rec, state, recommended, options, shown } = m;
  // The recommended day and its alternates in day order, plus a day typed in by hand.
  const dayChips = [...new Set([...options.map((o) => o.day), ...(state.draftDay === null ? [] : [state.draftDay])])].sort((a, b) => a - b);

  const schedule = rec && rec.kind !== "not_applicable" ? scheduleShort(m.input) : null;

  // Owner 2026-10-28: two numbered questions side by side — where the money comes from, then the day it
  // gives — with big tiles, and the two rules that matter as a line of their own instead of fine print.
  return (
    <Frame bare={bare} status={bare ? status : <>{status}<DayChip m={m} /></>} className={className}>
      <div className={cn("grid gap-6", bare && "lg:grid-cols-2")}>
        <Part n={1} title="Where does their money come from?">
          <IncomeFields m={m} dob={dob} readOnly={readOnly} idPrefix={idPrefix} incomeHint={incomeHint} />
        </Part>

        <Part n={2} title="The draft day" aside={schedule ? <span className="text-xs text-[var(--muted)]">Money lands: <strong className="font-semibold text-[var(--ink)]">{schedule}</strong></span> : null}>
      {!rec || rec.kind === "not_applicable" ? (
        <div id={draftDayId} tabIndex={-1} className="flex min-h-[112px] flex-col items-center justify-center gap-1.5 rounded-[12px] border-[1.5px] border-dashed border-[var(--border)] px-4 py-5 text-center outline-none">
          <CalendarDays className="size-5 text-[var(--muted)]" aria-hidden="true" />
          <strong className="text-sm font-semibold text-[var(--ink)]">{rec ? "No draft day to work out" : "Waiting on step 1"}</strong>
          <span className="text-sm text-[var(--muted)]">{rec ? rec.why : "Pick where their money comes from and the safest day shows here."}</span>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {/* The day buttons are the answer (owner 2026-10-28): the set day lit, the recommended one marked. */}
            <div id={choosing ? undefined : draftDayId} tabIndex={-1} role="radiogroup" aria-label="Draft day" className="flex flex-wrap gap-2 outline-none">
              {dayChips.map((day) => {
                const on = (state.draftDay ?? shown) === day;
                return (
                  <button
                    key={day}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={readOnly}
                    onClick={() => { setChoosing(false); m.apply({ draftDay: day }); }}
                    className={cn(
                      "inline-flex h-9 items-center gap-2 rounded-[10px] border-[1.5px] px-4 text-sm font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                      on ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--ink)]" : "border-[var(--border)] text-[var(--body)] hover:border-[var(--border-strong)]",
                    )}
                  >
                    {on && <Check className="size-4 text-[var(--accent-ink)]" aria-hidden="true" />}
                    The {ordinal(day)}
                    {day === recommended && <span className="rounded-[6px] bg-[var(--primary)] px-1.5 py-px text-xs font-semibold text-primary-foreground">Suggested</span>}
                  </button>
                );
              })}
              {!readOnly && <button type="button" onClick={() => setChoosing((v) => !v)} aria-expanded={choosing} aria-controls={draftDayId} className="inline-flex h-9 items-center rounded-[10px] border-[1.5px] border-dashed border-[var(--border)] px-4 text-sm text-[var(--muted)] outline-none hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-ring">Another day…</button>}
            </div>
            {choosing && (
              <Field label="Another day" htmlFor={draftDayId} className="w-[180px]">
                <select id={draftDayId} className={cn(control, "tabular-nums")} value={state.draftDay ?? ""} onChange={(e) => m.apply({ draftDay: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Choose</option>
                  {Array.from({ length: MAX_DRAFT_DAY }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{ordinal(d)}{d === recommended ? " (recommended)" : ""}</option>)}
                </select>
              </Field>
            )}
          </div>

          <OverridePrompt m={m} readOnly={readOnly} idPrefix={idPrefix} />
          {/* The twelve deposits behind the suggestion, when someone asks how it was worked out. */}
          {m.rec?.kind === "recommended" && m.rec.arrivals.length > 0 && (
            <details className="group text-sm">
              <summary className="cursor-pointer list-none text-xs font-semibold text-[var(--accent-ink)] hover:underline">See the next 12 deposits</summary>
              <div className="mt-2"><ArrivalChips m={m} /></div>
            </details>
          )}
        </>
      )}
        </Part>
      </div>

      {/* The two rules, said plainly where the agent will see them. */}
      <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 border-t border-[var(--border)] p-0 pt-3 text-sm text-[var(--body)]">
        <li className="inline-flex items-center gap-2"><CalendarCheck className="size-4 shrink-0 text-[var(--accent-ink)]" aria-hidden="true" /><span><strong className="font-semibold text-[var(--ink)]">Never later than the {ordinal(MAX_DRAFT_DAY)}</strong> of the month</span></li>
        <li className="inline-flex items-center gap-2"><ShieldCheck className="size-4 shrink-0 text-[var(--accent-ink)]" aria-hidden="true" /><span><strong className="font-semibold text-[var(--ink)]">Another day needs a reason</strong> · it is logged with your name</span></li>
      </ul>
    </Frame>
  );
}

/** A numbered question in the panel (like the quote form's parts). */
function Part({ n, title, aside, children }: { n: number; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={title}>
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span aria-hidden="true" className="inline-grid size-6 shrink-0 place-items-center rounded-full bg-[var(--primary-soft)] text-xs font-bold text-[var(--accent-ink)]">{n}</span>
        <h4 className="m-0 text-card-title text-[var(--ink)]">{title}</h4>
        {aside && <span className="ml-auto">{aside}</span>}
      </header>
      {children}
    </section>
  );
}

function Frame({ bare, status, className, children }: { bare: boolean; status: ReactNode; className?: string; children: ReactNode }) {
  if (!bare) return <StepCard title="Draft date" chips={status} className={className}>{children}</StepCard>;
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {status && <span className="flex flex-wrap items-center justify-end gap-2.5">{status}</span>}
      {children}
    </div>
  );
}

import { fileDay } from "@/lib/ingestion/constants";
import { LADDER_STEPS, REASON_LABELS, STEP_LABELS, stepNumber, type Reason, type Step } from "@/lib/retention/cases/ladder";

/**
 * Where a policy is on the Retention ladder, at a glance (owner 2026-11-05: "the agent must know which policy is
 * at what risk point"): four small bars with the policy's step filled up to it, and the step's name. Paperwork is
 * not on the ladder, so it is a plain chip. Shared by the list and the case page; no client code.
 */
export const STEP_INK: Record<Step, string> = {
  payment_problem: "var(--warning-ink)",
  pending_lapse: "var(--error-ink)",
  lapsed_reinstatable: "var(--error-ink)",
  lost: "var(--muted-foreground)",
  paperwork: "var(--info-ink)",
};

export function LadderMark({ step }: { step: Step }) {
  const at = stepNumber(step);
  if (at === null) return <span className="inline-flex items-center rounded-badge bg-[var(--info-surface)] px-2 py-0.5 text-xs font-semibold text-[var(--info-ink)]">{STEP_LABELS.paperwork}</span>;
  return (
    <span className="inline-flex items-center gap-1" aria-label={`Step ${at} of 4: ${STEP_LABELS[step]}`}>
      {LADDER_STEPS.map((s, i) => <i key={s} aria-hidden="true" className="block h-1.5 w-4 rounded-full" style={{ background: i < at ? STEP_INK[step] : "var(--border-strong)" }} />)}
      <span className="ml-1.5 text-xs font-semibold" style={{ color: STEP_INK[step] }}>{STEP_LABELS[step]}</span>
    </span>
  );
}

/**
 * What the carrier's status means, in words: the agent reads this, not the carrier's code ("IssNotPaid",
 * "Active (Inforce)"); the raw word stays on the case's "From the files" (critique B5).
 */
export const STATUS_MEANING: Record<string, string> = {
  active: "the carrier still lists it active",
  at_risk: "the carrier lists it at risk",
  approved_unpaid: "issued, never paid",
  lapsed: "the carrier lists it lapsed",
  cancelled: "the carrier lists it cancelled",
  terminated: "the carrier lists it ended",
  not_taken: "the client never took it",
  paid_up: "paid up",
};

const money = (cents: number) => `$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;

/** The reason in words, with the one fact that makes it concrete ("Payment missed · 50 days unpaid"). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function whyLine(reason: Reason, evidence: Record<string, any>): string {
  // The step's tag already says "Lapsed, can reinstate"; repeating it as the reason only pushed the fact out of
  // view. A chargeback says it in its own fact.
  const label = reason === "lapsed_reinstatable" || reason === "chargeback" ? null : REASON_LABELS[reason] ?? reason;
  const days = typeof evidence.days_past_due === "number" ? evidence.days_past_due : 0;
  const fact =
    evidence.chargeback?.statement_date ? `charged back ${money(Number(evidence.chargeback.amount_cents ?? 0))} on ${fileDay(String(evidence.chargeback.statement_date).slice(0, 10))}`
      : days > 0 ? `${days} days unpaid`
        : evidence.lapsed_on && reason === "lapsed_reinstatable" ? `lapsed on ${fileDay(String(evidence.lapsed_on).slice(0, 10))}`
          : evidence.status && STATUS_MEANING[String(evidence.status)] ? STATUS_MEANING[String(evidence.status)]
            : evidence.paid_to ? `paid to ${fileDay(String(evidence.paid_to).slice(0, 10))}`
              : null;
  if (!label) return fact ? fact.charAt(0).toUpperCase() + fact.slice(1) : REASON_LABELS[reason];
  return fact ? `${label} · ${fact}` : label;
}

/**
 * The deadline as a countdown: red inside 3 days, amber inside 7, and a passed one in days over (never "Today"
 * for a day already gone); "No carrier window" when the files give none.
 */
export function Countdown({ days, deadline }: { days: number | null; deadline: string | null }) {
  if (days === null || !deadline) return <span className="text-xs text-muted-foreground">No carrier window</span>;
  const tone = days <= 3 ? "text-[var(--error-ink)]" : days <= 7 ? "text-[var(--warning-ink)]" : "text-foreground";
  const big = days < 0 ? `${-days}` : days === 0 ? "Today" : `${days}`;
  const small = days < 0 ? `${-days === 1 ? "day" : "days"} over · ${fileDay(deadline)}` : days === 0 ? fileDay(deadline) : `${days === 1 ? "day" : "days"} · ${fileDay(deadline)}`;
  return (
    <span className="inline-flex flex-col items-end">
      <span className={`text-base font-semibold tabular-nums ${tone}`}>{big}</span>
      <span className="text-xs text-muted-foreground">{small}</span>
    </span>
  );
}

/** The deadline in one phrase, for a tile or a chip: "9 days left · Nov 14", "Today", "12 days over · Oct 24". */
export function deadlineText(days: number | null, deadline: string | null): string | null {
  if (days === null || !deadline) return null;
  if (days < 0) return `${-days} ${-days === 1 ? "day" : "days"} over · ${fileDay(deadline)}`;
  if (days === 0) return `Due today · ${fileDay(deadline)}`;
  return `${days} ${days === 1 ? "day" : "days"} left · ${fileDay(deadline)}`;
}

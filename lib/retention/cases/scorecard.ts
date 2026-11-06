/**
 * Reports › Retention scorecard, on the ladder (owner 2026-11-05; docs/retention/SPEC.md): per person and per
 * step, what was worked and how it ended — saved (a carrier file proved it), lost, closed without a save — with
 * the save rate (saved ÷ saved + lost) only over 10 decided cases (counts under that), and the premium kept.
 * "Closed without a save" stays out of the rate, as unreachable stays out of a save rate. Pure.
 */
import { LADDER_STEPS, type Step } from "./ladder.ts";

export const MIN_DECIDED = 10;

export type ScoreCase = { ownerId: string | null; step: Step; status: string; unreachable: boolean; monthlyCents: number };
export type ScoreLine = { key: string; open: number; saved: number; lost: number; closedNoSave: number; unreachable: number; keptCents: number; rate: number | null };

const line = (key: string): ScoreLine => ({ key, open: 0, saved: 0, lost: 0, closedNoSave: 0, unreachable: 0, keptCents: 0, rate: null });
const OPEN = new Set(["open", "working", "waiting_on_carrier"]);

function add(l: ScoreLine, c: ScoreCase) {
  if (OPEN.has(c.status)) { l.open++; if (c.unreachable) l.unreachable++; }
  else if (c.status === "saved") { l.saved++; l.keptCents += c.monthlyCents; }
  else if (c.status === "lost") l.lost++;
  else if (c.status === "closed_no_save") l.closedNoSave++;
}
const finish = (l: ScoreLine): ScoreLine => ({ ...l, rate: l.saved + l.lost >= MIN_DECIDED ? l.saved / (l.saved + l.lost) : null });

/** One line per person (null owner: "Nobody"), one per step (the four ladder steps, then paperwork), and the total. */
export function caseScorecard(cases: ScoreCase[]): { people: ScoreLine[]; steps: ScoreLine[]; total: ScoreLine } {
  const people = new Map<string, ScoreLine>();
  const steps = new Map<Step, ScoreLine>([...LADDER_STEPS, "paperwork" as Step].map((s) => [s, line(s)]));
  const total = line("all");
  for (const c of cases) {
    const who = c.ownerId ?? "nobody";
    if (!people.has(who)) people.set(who, line(who));
    add(people.get(who)!, c);
    add(steps.get(c.step)!, c);
    add(total, c);
  }
  return { people: [...people.values()].map(finish).sort((a, b) => b.saved - a.saved || b.open - a.open), steps: [...steps.values()].map(finish), total: finish(total) };
}

/** The rate as words: a percentage over 10 decided cases, else "3 of 5 saved"; "—" with none decided. */
export const rateText = (l: ScoreLine): string => (l.saved + l.lost === 0 ? "—" : l.rate === null ? `${l.saved} of ${l.saved + l.lost} saved` : `${Math.round(l.rate * 100)}%`);

import type { SetupAnswer, SetupStep } from "./types";

/**
 * Board B9's own rules (Get set up on the owner's phone), kept beside the screen so the shared home logic stays
 * untouched. The board counts what it draws: every step that makes you ready, plus this phone's alerts and the
 * agency's licences ("5 of 9 done"). Optional steps are not drawn (the board has no "Fine-tune later" group).
 */

/** GET /api/app/setup?phone=1 adds these (app/api/app/setup/route.ts), owner only. */
export type PhoneSetupFacts = { seatsLeft: number | null; licences: { count: number } | null };
export type PhoneSetupAnswer = SetupAnswer & { phone?: PhoneSetupFacts };

export type SetupRow =
  | { kind: "step"; step: SetupStep; here: boolean }
  | { kind: "alerts" }
  | { kind: "licences" };

/** The steps a phone does well open here; every other one carries the laptop mark. */
const PHONE_DONE_HERE = new Set(["team"]);

export function setupRows(steps: readonly SetupStep[], alertsOn: boolean | null, phone: PhoneSetupFacts | undefined) {
  const required = steps.filter((s) => !s.optional);
  const licences = phone?.licences ?? null;
  const done: { key: string; label: string }[] = required.filter((s) => s.complete).map((s) => ({ key: s.key, label: s.label }));
  // As drawn: "Turn on alerts" sits among the done steps just before the disclosures (after the pipelines).
  if (alertsOn === true) {
    const at = done.findIndex((d) => d.key === "disclosures");
    done.splice(at < 0 ? done.length : at, 0, { key: "alerts", label: "Turn on alerts" });
  }
  if (licences && licences.count > 0) done.push({ key: "licences", label: "Add your licences" });

  const open = required.filter((s) => !s.complete);
  // The phone's own steps in the board note's order (invite people, turn on alerts, add your licence), then the
  // laptop ones.
  const next: SetupRow[] = [
    ...open.filter((s) => PHONE_DONE_HERE.has(s.key)).map((step) => ({ kind: "step" as const, step, here: true })),
    ...(alertsOn === false ? [{ kind: "alerts" as const }] : []),
    ...(licences && licences.count === 0 ? [{ kind: "licences" as const }] : []),
    ...open.filter((s) => !PHONE_DONE_HERE.has(s.key)).map((step) => ({ kind: "step" as const, step, here: false })),
  ];
  const total = done.length + next.length;
  return { done, next, total, doneCount: done.length, label: `${done.length} of ${total} done`, share: total ? (done.length / total) * 100 : 0 };
}

/** "Invite your team"'s line: the plan's room ("3 people · takes a minute"); no limit or unknown, just the time. */
export function inviteMeta(seatsLeft: number | null | undefined): string {
  if (seatsLeft === null || seatsLeft === undefined) return "Takes a minute";
  if (seatsLeft === 0) return "No seats left on your plan";
  return `${seatsLeft} ${seatsLeft === 1 ? "person" : "people"} · takes a minute`;
}

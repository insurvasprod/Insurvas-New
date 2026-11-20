// A height as people say it — feet and inches — stored as total inches. Pure and client-safe.
//
// The Application step's build cell asks feet + inches (owner 2026-10-29) and stores
// `insured.height_in` as total inches; the interview's height question (`height_in` and its
// synonyms, lib/applications/prefill.ts) carries the same total-inches number into it. Walk
// 2026-11-20: the interview asked one inches box while the application asked feet + inches.

import { feedOfQuestionKey } from "./prefill.ts";

/** Whether an interview question is the height that fills `insured.height_in`. */
export function isHeightQuestion(key: string, type: string): boolean {
  return type === "number" && feedOfQuestionKey(key)?.field === "insured.height_in";
}

/** 70 → { feet: "5", inches: "10" }; nothing stored → two blanks. */
export function feetAndInches(totalInches: unknown): { feet: string; inches: string } {
  if (typeof totalInches !== "number" || !Number.isFinite(totalInches) || totalInches <= 0) return { feet: "", inches: "" };
  const whole = Math.round(totalInches);
  return { feet: String(Math.floor(whole / 12)), inches: String(whole % 12) };
}

/**
 * The total inches two boxes say: feet × 12 + inches, a blank inches box read as 0. No feet, or a
 * box that is not a number, is no height (null), as on the Application step.
 */
export function totalInches(feet: string, inches: string): number | null {
  if (feet.trim() === "") return null;
  const f = Number(feet);
  const i = inches.trim() === "" ? 0 : Number(inches);
  if (!Number.isFinite(f) || !Number.isFinite(i)) return null;
  return f * 12 + i;
}

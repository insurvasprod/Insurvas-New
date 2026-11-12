// Settings r8, Application forms A4: a question's rules checked against one answer, in the words a
// person filling the form reads. The builder's "Try a value" and the preview use it. Client-safe.
//
// The partner form (components/partner/partner-portal-workspace.tsx) and server intake
// (lib/agentTemplates/service.ts) still run their own copies of the format and range checks; the two
// format-2 rules here (`no_future`, `message`) reach them once they call checkFieldValue too.

import { ageFromDob, bankFormatError } from "./formats.ts";
import type { TemplateField, TemplateValidation } from "./constants.ts";

export type FieldCheck = { ok: true; note?: string } | { ok: false; message: string; short: string };

const money = (n: number) => "$" + n.toLocaleString("en-US");

/** A typed try-out value as the form would store it: dates as YYYY-MM-DD, numbers as numbers. */
export function storedAnswer(field: Pick<TemplateField, "type">, typed: string): unknown {
  const text = typed.trim();
  if (!text) return "";
  if (field.type === "number" || field.type === "currency") {
    const n = Number(text.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : text;
  }
  if (field.type === "date") {
    const us = text.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/);
    if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
    return text;
  }
  if (field.type === "boolean") return /^(y|yes|true)$/i.test(text) ? "true" : /^(n|no|false)$/i.test(text) ? "false" : text;
  if (field.type === "multi_select") return text.split(",").map((item) => item.trim()).filter(Boolean);
  return text;
}

function fail(field: Pick<TemplateField, "label" | "validation">, short: string, fallback: string, age?: number | null): FieldCheck {
  const custom = field.validation?.message?.trim();
  const message = custom ? custom.replaceAll("{age}", age === null || age === undefined ? "?" : String(age)) : fallback;
  return { ok: false, message, short };
}

/** One answer against the question's type and rules. An empty answer passes (required is the form's job). */
export function checkFieldValue(field: Pick<TemplateField, "label" | "type" | "options" | "validation">, value: unknown, today = new Date()): FieldCheck {
  const v: TemplateValidation = field.validation ?? {};
  const label = field.label || "This question";
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) return { ok: true, note: "Empty answers pass here; “Must be answered” decides if one is allowed." };
  if (field.type === "number" || field.type === "currency") {
    if (typeof value !== "number" || !Number.isFinite(value)) return fail(field, "Not a number", `${label} must be a number.`);
    if (field.type === "currency" && !Number.isInteger(value)) return fail(field, "Whole dollars only", `${label} must be whole dollars.`);
    const show = field.type === "currency" ? money : (n: number) => n.toLocaleString("en-US");
    if (v.min !== undefined && value < v.min) return fail(field, `Below ${show(v.min)}`, `${label} must be at least ${show(v.min)}.`);
    if (v.max !== undefined && value > v.max) return fail(field, `Above ${show(v.max)}`, `${label} must be at most ${show(v.max)}.`);
    return { ok: true };
  }
  if (field.type === "date") {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) return fail(field, "Not a date", `${label} must be a date, like 03/14/1958.`);
    if (v.no_future && value > today.toISOString().slice(0, 10)) return fail(field, "In the future", `${label} cannot be in the future.`);
    if (v.age_min !== undefined || v.age_max !== undefined) {
      const age = ageFromDob(value, today);
      if (age === null) return fail(field, "Not a birth date", `${label} must be a real birth date.`, age);
      if (v.age_min !== undefined && age < v.age_min) return fail(field, `Fails · age ${age}`, `This form covers ages ${v.age_min}${v.age_max !== undefined ? ` to ${v.age_max}` : " and over"}. This person is ${age}.`, age);
      if (v.age_max !== undefined && age > v.age_max) return fail(field, `Fails · age ${age}`, `This form covers ages ${v.age_min !== undefined ? `${v.age_min} to ` : "up to "}${v.age_max}. This person is ${age}.`, age);
      return { ok: true, note: `Passes · age ${age}` };
    }
    return { ok: true };
  }
  if (field.type === "boolean") return value === "true" || value === "false" || typeof value === "boolean" ? { ok: true } : fail(field, "Not yes or no", `${label} must be Yes or No.`);
  if (field.type === "single_select") return typeof value === "string" && field.options.includes(value) ? { ok: true } : fail(field, "Not one of the choices", `${label} must be one of its choices.`);
  if (field.type === "multi_select") return Array.isArray(value) && value.every((item) => typeof item === "string" && field.options.includes(item)) ? { ok: true } : fail(field, "Not one of the choices", `${label} must use its choices.`);
  if (typeof value !== "string") return fail(field, "Not text", `${label} must be text.`);
  if (field.type === "email" && !/^\S+@\S+\.\S+$/.test(value)) return fail(field, "Not an email", `${label} must be an email address.`);
  if (field.type === "phone" && value.replace(/\D/g, "").length < 10) return fail(field, "Too few digits", `${label} must have 10 digits.`);
  if (field.type === "ssn" && !/^\d{3}-?\d{2}-?\d{4}$/.test(value)) return fail(field, "Not an SSN", `${label} must be 9 digits.`);
  if (field.type === "bank_routing" || field.type === "bank_account") {
    const bank = bankFormatError({ type: field.type, label }, value);
    return bank ? fail(field, "Fails the bank check", bank) : { ok: true };
  }
  if (v.min_length !== undefined && value.length < v.min_length) return fail(field, "Too short", `${label} must be at least ${v.min_length} characters.`);
  if (v.max_length !== undefined && value.length > v.max_length) return fail(field, "Too long", `${label} must be at most ${v.max_length} characters.`);
  if (v.pattern) {
    let pattern: RegExp | null = null;
    try { pattern = new RegExp(v.pattern); } catch { pattern = null; }
    if (pattern && !pattern.test(value)) return fail(field, "Wrong characters", `${label} has characters it does not allow.`);
  }
  return { ok: true };
}

/** How many rules a question carries, for the Validation tab's count. */
export function ruleCount(field: Pick<TemplateField, "type" | "validation">): number {
  const v = field.validation ?? {};
  let n = 0;
  if (v.min !== undefined || v.max !== undefined) n += 1;
  if (v.min_length !== undefined || v.max_length !== undefined) n += 1;
  if (v.pattern) n += 1;
  if (v.age_min !== undefined || v.age_max !== undefined) n += 1;
  if (v.no_future) n += 1;
  if (v.format_mask) n += 1;
  if (v.message?.trim()) n += 1;
  return n;
}

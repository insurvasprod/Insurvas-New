// Client-safe helpers the Settings › Sales panels and their services share (LA-3.10, 3.17, 3.20):
// what changed in the settings document, the welcome-pack tokens, and disclosure rule clauses read
// and written the way a person types them. No `server-only`, no `@/` imports, so the node tests
// read the same code the panels and the API run.

import { WELCOME_PACK_LOCKED_TOKENS, type SalesSettings } from "./schema.ts";

// ── the settings document ──────────────────────────────────────────────────

/** Top-level keys whose value differs, in the document's own order. */
export function changedSettingKeys(before: SalesSettings, after: SalesSettings): (keyof SalesSettings)[] {
  return (Object.keys(after) as (keyof SalesSettings)[]).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

/** The audit row's metadata: which keys changed, with their old and new values. */
export function settingsAuditDiff(before: SalesSettings, after: SalesSettings) {
  const changed = changedSettingKeys(before, after);
  return {
    changed,
    before: Object.fromEntries(changed.map((key) => [key, before[key]])),
    after: Object.fromEntries(changed.map((key) => [key, after[key]])),
  };
}

// ── welcome pack (LA-3.20) ─────────────────────────────────────────────────

export type WelcomeToken = { token: string; label: string; locked: boolean };

/** Every token the welcome pack understands. The four locked ones cannot leave the body. */
export const WELCOME_PACK_TOKENS: readonly WelcomeToken[] = [
  { token: "{statement_descriptor}", label: "What will appear on the bank statement", locked: true },
  { token: "{monthly_amount}", label: "The amount", locked: true },
  { token: "{draft_day}", label: "The draft day", locked: true },
  { token: "{agent_phone}", label: "The agent's phone number", locked: true },
  { token: "{client_first_name}", label: "Client first name", locked: false },
  { token: "{carrier_name}", label: "Carrier", locked: false },
  { token: "{coverage_amount}", label: "Coverage amount", locked: false },
  { token: "{product_name}", label: "Product", locked: false },
  { token: "{beneficiaries}", label: "Beneficiaries", locked: false },
  { token: "{reference}", label: "Application number", locked: false },
  { token: "{agent_name}", label: "Agent name", locked: false },
  { token: "{agent_email}", label: "Agent email", locked: false },
];

export function missingLockedTokens(body: string): string[] {
  return WELCOME_PACK_LOCKED_TOKENS.filter((token) => !body.includes(token));
}

/** Tokens in the text that the welcome pack does not know (a typo would reach the client as-is). */
export function unknownTokens(text: string): string[] {
  const known = new Set(WELCOME_PACK_TOKENS.map((t) => t.token));
  return [...new Set(text.match(/\{[a-z_]+\}/g) ?? [])].filter((token) => !known.has(token));
}

/** Splits text into literal and token parts, so a preview can style what a token became. */
export function tokenParts(text: string): { text: string; token: string | null }[] {
  return text.split(/(\{[a-z_]+\})/g).filter((part) => part !== "").map((part) => (/^\{[a-z_]+\}$/.test(part) ? { text: part, token: part } : { text: part, token: null }));
}

export function fillTokens(text: string, values: Record<string, string>) {
  return text.replace(/\{[a-z_]+\}/g, (token) => values[token] ?? token);
}

// ── disclosure rule clauses (LA-3.10) ──────────────────────────────────────

export const CLAUSE_OPS = ["eq", "neq", "in", "not_in", "gt", "lt"] as const;
export type ClauseOp = (typeof CLAUSE_OPS)[number];
export type Clause = { field: string; op: ClauseOp; value: unknown };

export const CLAUSE_OP_LABEL: Record<ClauseOp, string> = { eq: "is", neq: "is not", in: "is one of", not_in: "is not one of", gt: "is more than", lt: "is less than" };
const OP_SYMBOL: Record<ClauseOp, string> = { eq: "=", neq: "is not", in: "is one of", not_in: "is not one of", gt: ">", lt: "<" };

/** `health.<question_key>` or a canonical `group.key`. */
export const CLAUSE_FIELD = /^(health\.[a-z][a-z0-9_]{0,63}|[a-z]+\.[a-z0-9_]+)$/;

/**
 * What a person typed → the stored value. Lists split on commas; "yes"/"no" become booleans for
 * interview answers (the interview stores them as true / false); gt / lt need a number.
 */
export function parseClauseValue(op: ClauseOp, raw: string, opts: { boolean?: boolean; money?: boolean } = {}): { value: unknown } | { error: string } {
  const text = raw.trim();
  if (!text) return { error: "Give the condition a value." };
  if (op === "in" || op === "not_in") {
    const list = [...new Set(text.split(",").map((part) => part.trim()).filter(Boolean))];
    return list.length ? { value: list } : { error: "List at least one value, separated by commas." };
  }
  if (op === "gt" || op === "lt") {
    const cleaned = text.replace(/[$,\s]/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return { error: "Use a number for more than or less than." };
    // Money is compared in cents, the way it is stored.
    return { value: opts.money ? Math.round(Number(cleaned) * 100) : Number(cleaned) };
  }
  if (opts.boolean) {
    const lower = text.toLowerCase();
    if (["yes", "true", "y"].includes(lower)) return { value: true };
    if (["no", "false", "n"].includes(lower)) return { value: false };
    return { error: "Use yes or no for this question." };
  }
  return { value: text };
}

/** The stored value → what the input shows. */
export function clauseValueText(clause: Clause, opts: { money?: boolean } = {}): string {
  const v = clause.value;
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (v === true) return "yes";
  if (v === false) return "no";
  if (typeof v === "number" && opts.money && (clause.op === "gt" || clause.op === "lt")) return (v / 100).toFixed(2);
  return v === null || v === undefined ? "" : String(v);
}

/** "existing coverage = yes", as the board reads a rule. */
export function describeClause(clause: Clause, label: string, opts: { money?: boolean } = {}): string {
  const value = clauseValueText(clause, opts);
  return `${label} ${OP_SYMBOL[clause.op]} ${opts.money && (clause.op === "gt" || clause.op === "lt") ? `$${value}` : value}`;
}

/** "TX, ok nm" → ["TX", "OK", "NM"]; anything that is not a two-letter code is returned apart. */
export function parseStates(text: string, known: readonly string[]): { states: string[]; unknown: string[] } {
  const parts = [...new Set(text.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))];
  return { states: parts.filter((s) => known.includes(s)), unknown: parts.filter((s) => !known.includes(s)) };
}

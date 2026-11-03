/**
 * LA-4.19 (Notion sprint) · the agent framework, as plain functions: the six agents, the contract
 * every finding keeps, what may never reach a prompt, how calls are batched and paced, and how each
 * agent's accuracy is measured against people's corrections.
 *
 * The rules (LA-3.13's): agents propose, people approve, execution is deterministic — no model runs
 * during a normal parse. No agent writes Layer 1 or the ledger (the database's insurvas_agent role
 * cannot). Every decision keeps its inputs, confidence, reasoning, model id and prompt version.
 * Blocking findings stop their stage; anything else is a note and the run continues.
 *
 * No AI provider is configured yet: `providerStatus` says so, and every model-backed step waits
 * behind it. The deterministic agents (the file monitor, the parser guardian's checks) already run.
 *
 * Pure.
 */

export const AGENTS = ["file_monitor", "parser_guardian", "pdf_extractor", "matching_agent", "commission_reconciler", "insights_analyst"] as const;
export type AgentName = (typeof AGENTS)[number];

export const AGENT_INFO: Record<AgentName, { label: string; stage: string; watches: string; raises: string; needsModel: boolean }> = {
  file_monitor: { label: "File monitor", stage: "Collect", watches: "When each carrier's files arrive", raises: "A missing or late file, a duplicate", needsModel: false },
  parser_guardian: { label: "Parser guardian", stage: "Parse", watches: "Every parse", raises: "An unknown column, a row-count swing, an unmapped status, totals that don't balance", needsModel: false },
  pdf_extractor: { label: "PDF extractor", stage: "Parse", watches: "PDF statements", raises: "The extraction itself, a balance failure", needsModel: true },
  matching_agent: { label: "Matching agent", stage: "Match", watches: "New policy rows", raises: "Each match decision, with its confidence and reasoning", needsModel: true },
  commission_reconciler: { label: "Commission reconciler", stage: "Reconcile", watches: "The ledger against what was expected", raises: "Why a figure differs, in plain words", needsModel: true },
  insights_analyst: { label: "Insights analyst", stage: "Analyse", watches: "The finished day", raises: "The daily summary", needsModel: true },
};

export const SEVERITIES = ["info", "warning", "blocking"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** A blocking finding stops its stage; warnings and notes never do. */
export const stopsStage = (findings: Array<{ severity: Severity }>) => findings.some((f) => f.severity === "blocking");

// ─── the provider ─────────────────────────────────────────────────────────────────────────────

export type AgentProvider = {
  modelId: string;
  promptVersion: string;
  /** One call for a whole batch. */
  complete(batch: unknown[]): Promise<unknown[]>;
};

/** Whether an AI provider is configured. None is (owner decision 2026-10-07: choose it later). */
export function providerStatus(provider: AgentProvider | null): { configured: boolean; message: string } {
  return provider ? { configured: true, message: `${provider.modelId} · prompt ${provider.promptVersion}` } : { configured: false, message: "AI isn't configured yet, so these steps wait for a person." };
}

// ─── what may never reach a prompt ────────────────────────────────────────────────────────────

/** Keys whose value is never sent, whatever it looks like. */
const FORBIDDEN_KEY = /(ssn|social.?security|tax.?id|\btin\b|routing|\baba\b|bank|account.?(number|no)|acct|iban|swift|card.?(number|no)|\bpan\b|cvv|cvc)/i;
/** Written as an SSN, anywhere; or nine bare digits that could be one, outside a policy number, phone or date. */
const SSN_DASHED = /\b\d{3}-\d{2}-\d{4}\b/;
const SSN_BARE = /\b(?!000|666|9\d\d)\d{3}(?!00)\d{2}(?!0000)\d{4}\b/;

const digitsOnly = (s: string) => s.replace(/\D/g, "");

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

function abaRouting(digits: string): boolean {
  if (digits.length !== 9) return false;
  const d = digits.split("").map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
}

/** A card number: 13 to 19 digits (spaces or dashes allowed) passing the Luhn check. */
function hasCard(text: string): boolean {
  for (const match of text.matchAll(/\b(?:\d[ -]?){12,18}\d\b/g)) if (luhn(digitsOnly(match[0]))) return true;
  return false;
}

/**
 * What in a payload must not be sent: an SSN, a bank account or routing number, a card number —
 * by key, and by value wherever it sits. The matching exception (name, date of birth, phone) and
 * the PDF exception (statement pages) are allowed; these four never are.
 */
export function promptProblems(payload: unknown, path = "payload"): string[] {
  const problems: string[] = [];
  const visit = (value: unknown, at: string, key: string) => {
    if (key && FORBIDDEN_KEY.test(key) && value !== null && value !== undefined && value !== "") problems.push(`${at}: a ${key} is never sent`);
    if (typeof value === "string" || typeof value === "number") {
      const text = String(value);
      const exempt = /(phone|mobile|tel|dob|birth|date|policy)/i.test(key);
      if (SSN_DASHED.test(text) || (!exempt && SSN_BARE.test(text))) problems.push(`${at}: looks like a social security number`);
      if (hasCard(text)) problems.push(`${at}: looks like a card number`);
      if (!exempt) for (const nine of text.match(/\b\d{9}\b/g) ?? []) if (abaRouting(nine)) { problems.push(`${at}: looks like a routing number`); break; }
      return;
    }
    if (Array.isArray(value)) value.forEach((item, i) => visit(item, `${at}[${i}]`, key));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) visit(v, `${at}.${k}`, k);
  };
  visit(payload, path, "");
  return [...new Set(problems)];
}

export class UnsafePromptError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`This would have sent private data to the model, so nothing was sent: ${problems.slice(0, 3).join("; ")}.`);
    this.name = "UnsafePromptError";
    this.problems = problems;
  }
}

/** Every outbound payload passes through here; a problem stops the call before anything leaves. */
export function assertPromptSafe(payload: unknown): void {
  const problems = promptProblems(payload);
  if (problems.length) throw new UnsafePromptError(problems);
}

// ─── batching and pacing ──────────────────────────────────────────────────────────────────────

export const batches = <T>(items: T[], size: number): T[][] => {
  if (!Number.isInteger(size) || size < 1) throw new Error("A batch holds at least one item.");
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size));
  return out;
};

/**
 * Runs a model over items in batches, at most `perMinute` calls a minute, never one call per row
 * fired at once. Each batch is checked by assertPromptSafe before it is sent.
 */
export async function runBatched<T, R>(provider: AgentProvider, items: T[], options: { batchSize: number; perMinute: number; sleep: (ms: number) => Promise<void>; now: () => number }): Promise<{ results: R[]; calls: number }> {
  const spacing = Math.ceil(60_000 / Math.max(1, options.perMinute));
  const results: R[] = [];
  let calls = 0;
  let last = -Infinity;
  for (const batch of batches(items, options.batchSize)) {
    assertPromptSafe(batch);
    const wait = last + spacing - options.now();
    if (calls > 0 && wait > 0) await options.sleep(wait);
    last = options.now();
    results.push(...((await provider.complete(batch)) as R[]));
    calls++;
  }
  return { results, calls };
}

// ─── the contract every finding keeps ─────────────────────────────────────────────────────────

export type FindingDraft = {
  agent: AgentName;
  findingType: string;
  severity: Severity;
  payload: Record<string, unknown>;
  reasoning: string;
  confidence?: number | null;
  proposedAction?: Record<string, unknown> | null;
  dedupeKey: string;
  fileId?: string | null;
  runId?: string | null;
};

/**
 * A finding as stored. A model-backed finding must name its model and prompt version (so every
 * decision a bad prompt made can be found again); a deterministic one names neither.
 */
export function findingRow(tenantId: string, draft: FindingDraft, provider: AgentProvider | null) {
  if (!draft.reasoning.trim() || draft.reasoning.length > 4000) throw new Error("A finding says why, in under 4,000 characters.");
  if (draft.confidence !== undefined && draft.confidence !== null && (draft.confidence < 0 || draft.confidence > 1)) throw new Error("Confidence is between 0 and 1.");
  if (AGENT_INFO[draft.agent].needsModel && !provider) throw new Error(`${AGENT_INFO[draft.agent].label} needs a model, and none is configured.`);
  if (provider) assertPromptSafe(draft.payload);
  return {
    tenant_id: tenantId,
    agent_name: draft.agent,
    run_id: draft.runId ?? null,
    file_id: draft.fileId ?? null,
    finding_type: draft.findingType,
    severity: draft.severity,
    payload: draft.payload,
    confidence: draft.confidence ?? null,
    reasoning: draft.reasoning,
    proposed_action: draft.proposedAction ?? null,
    model_id: provider?.modelId ?? null,
    prompt_version: provider?.promptVersion ?? null,
    dedupe_key: draft.dedupeKey,
  };
}

// ─── accuracy against people's corrections ────────────────────────────────────────────────────

export type ReviewedFinding = { agent: string; status: string; reviewedAt: string | null };

const weekOf = (iso: string) => {
  const day = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
};

/** Per agent, per week (Monday): approved ÷ (approved + rejected). Unreviewed findings don't count. */
export function weeklyAccuracy(findings: ReviewedFinding[]) {
  const out = new Map<string, { agent: string; week: string; approved: number; rejected: number }>();
  for (const f of findings) {
    if (!f.reviewedAt || (f.status !== "approved" && f.status !== "rejected")) continue;
    const week = weekOf(f.reviewedAt);
    const key = `${f.agent}|${week}`;
    const row = out.get(key) ?? { agent: f.agent, week, approved: 0, rejected: 0 };
    if (f.status === "approved") row.approved++;
    else row.rejected++;
    out.set(key, row);
  }
  return [...out.values()]
    .map((row) => ({ ...row, accuracyPct: Math.floor((200 * row.approved + (row.approved + row.rejected)) / (2 * (row.approved + row.rejected))) }))
    .sort((a, b) => b.week.localeCompare(a.week) || a.agent.localeCompare(b.agent));
}

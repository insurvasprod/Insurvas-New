import { enqueue as put, flushOutbox, readOutbox, type OutboxItem } from "@/lib/outbox";
import { readSecret, writeSecret } from "@/lib/secure";

import type { AnswerValue } from "./types";

/**
 * Board E2 / L4 / rules "Works with a weak signal": an interview answer given with no signal waits on the
 * phone and is sent when the next save gets through — from this screen, or from the app's own outbox the
 * moment any request gets an answer again (lib/outbox.ts, flushed by lib/session.tsx), even when the
 * application is closed. Health answers are sensitive, so they wait in the Keychain / Keystore like every
 * other queued write, and are deleted as each one is sent. Only answers queue; finishing the interview,
 * quoting and submitting always need the server.
 */
export type QueuedAnswer = { key: string; value: AnswerValue; hidden: string[] };

/** The request an answer is (use-case.ts saveAnswers): one question, with the follow-ups it hides. */
export function answerPath(caseId: string): string {
  return `/api/app/applications/cases/${caseId}/interview`;
}
const GROUP = (caseId: string) => `answers:${caseId}`;
/** Before 2026-11-27 each case kept its own entry; read once and moved into the outbox. */
const LEGACY = (caseId: string) => `insurvas.answers.${caseId.replace(/[^A-Za-z0-9_-]/g, "")}`;
/**
 * The cases this phone has kept answers for, so Sign out can delete their old per-case entries too (the
 * Keychain / Keystore cannot list its keys). Case ids only; never an answer.
 */
const LEGACY_INDEX = "insurvas.answers.cases";

async function readLegacyIndex(): Promise<string[]> {
  const raw = await readSecret(LEGACY_INDEX).catch(() => null);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function noteCase(caseId: string): Promise<void> {
  const seen = await readLegacyIndex();
  if (seen.includes(caseId)) return;
  await writeSecret(LEGACY_INDEX, JSON.stringify([...seen, caseId].slice(-200))).catch(() => undefined);
}

/**
 * Sign out: deletes every per-case entry left from before the outbox (and the index itself). The outbox's own
 * items are emptied by the session (lib/outbox.ts clearOutbox).
 */
export async function clearLegacyAnswers(): Promise<void> {
  const seen = await readLegacyIndex();
  await Promise.all(seen.map((id) => writeSecret(LEGACY(id), null).catch(() => undefined)));
  await writeSecret(LEGACY_INDEX, null).catch(() => undefined);
}

type Body = { insured_role: "primary"; answers: { key: string; value: AnswerValue }[]; hidden: string[] };

function toAnswer(item: OutboxItem): QueuedAnswer | null {
  const body = item.body as Body | null;
  const first = body?.answers?.[0];
  return first && typeof first.key === "string" ? { key: first.key, value: first.value, hidden: Array.isArray(body?.hidden) ? body.hidden : [] } : null;
}

async function migrate(caseId: string): Promise<void> {
  await noteCase(caseId);
  const raw = await readSecret(LEGACY(caseId));
  if (!raw) return;
  let old: QueuedAnswer[] = [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    old = Array.isArray(parsed) ? parsed.filter((x): x is QueuedAnswer => Boolean(x) && typeof (x as QueuedAnswer).key === "string") : [];
  } catch { /* unreadable: nothing to move */ }
  await writeSecret(LEGACY(caseId), null).catch(() => undefined);
  for (const item of old) await enqueue(caseId, item);
}

export async function readQueue(caseId: string): Promise<QueuedAnswer[]> {
  await migrate(caseId);
  const items = await readOutbox(GROUP(caseId));
  return items.map(toAnswer).filter((x): x is QueuedAnswer => Boolean(x));
}

/** Keeps the newest answer for a question: a later answer replaces the one still waiting. */
export async function enqueue(caseId: string, item: QueuedAnswer): Promise<void> {
  const body: Body = { insured_role: "primary", answers: [{ key: item.key, value: item.value }], hidden: item.hidden };
  await put({ kind: "answer", method: "PUT", path: answerPath(caseId), body, group: GROUP(caseId), key: item.key }, item.hidden);
}

/**
 * Sends what is waiting for this case, oldest first, stopping at the first one that fails (it stays queued
 * with everything after it). Answers how many are still on the phone.
 */
export async function flushQueue(caseId: string, send: (item: QueuedAnswer) => Promise<unknown>): Promise<number> {
  await migrate(caseId);
  const result = await flushOutbox(async (item) => {
    const answer = toAnswer(item);
    if (answer) await send(answer);
  }, GROUP(caseId));
  return result.left;
}

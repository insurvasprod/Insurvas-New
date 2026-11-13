/**
 * Settings › Integrations, round 8 option A ("Integrations hub", owner pick 2026-11-12,
 * docs/design/settings-r8/api-webhooks.html): the rules the hub's tables, sheets and status line
 * share — a key's or a webhook's state in one chip, what a key can do in plain words, a delivery's
 * answer in plain words, and the copy-ready samples.
 *
 * Plain module, no `server-only`, no path aliases: the screen, the routes and `node --test` read it.
 */
import { API_SCOPES, IDLE_DAYS, apiKeyStatus, isIdleKey, webhookEventLabel, type ApiKeyView, type ApiScope, type WebhookView } from "./constants.ts";

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * The delivery job's ladder, for the screen (lib/webhooks/rules.ts holds the real one and imports
 * node:crypto, so the screen cannot): wait these minutes after each failed try, six tries in all; a
 * webhook is turned off after OFF_AFTER failures in a row. hub.test.mjs keeps the two equal.
 */
export const RETRY_LADDER_MINUTES = [1, 5, 30, 120, 360] as const;
export const MAX_TRIES = RETRY_LADDER_MINUTES.length + 1;
export const OFF_AFTER = 3 * MAX_TRIES;

/** A key that stops within this many days says so on its row, the tab and the status line. */
export const ENDS_SOON_DAYS = 14;

export type ChipTone = "neutral" | "good" | "info" | "warning" | "danger";

export type KeyKind = "working" | "ends_soon" | "rotating_out" | "idle" | "ended" | "revoked";

export type KeyState = { kind: KeyKind; label: string; tone: ChipTone; live: boolean; idleDays: number | null; endsInDays: number | null };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Whole days since a moment (never negative). */
export function daysSince(value: string | null | undefined, now: number): number | null {
  if (!value) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / DAY)) : null;
}

/** "Ends today", "Ends tomorrow", "Ends in 12 days". */
export function endsInWords(days: number): string {
  return days <= 0 ? "Ends today" : days === 1 ? "Ends tomorrow" : `Ends in ${days} days`;
}

/** "19 h left", "2 days left", "under an hour left". */
export function timeLeftWords(ms: number): string {
  if (ms < HOUR) return "under an hour left";
  if (ms < 48 * HOUR) return `${Math.floor(ms / HOUR)} h left`;
  return `${Math.floor(ms / DAY)} days left`;
}

/**
 * One chip for a key: Working · Ends in N days · Rotating out, N h left · Idle N days · Ended ·
 * Revoked. `replaced` is true when a rotation made a successor for it.
 */
export function keyState(key: ApiKeyView, replaced: boolean, now: number): KeyState {
  const status = apiKeyStatus(key, replaced, now);
  const endsAt = key.expiresAt ? Date.parse(key.expiresAt) : null;
  const endsInDays = endsAt !== null && endsAt > now ? Math.floor((endsAt - now) / DAY) : null;
  if (status === "revoked") return { kind: "revoked", label: "Revoked", tone: "neutral", live: false, idleDays: null, endsInDays: null };
  if (status === "expired") return { kind: "ended", label: "Ended", tone: "neutral", live: false, idleDays: null, endsInDays: null };
  if (status === "rotating_out") {
    return { kind: "rotating_out", label: `Rotating out · ${endsAt === null ? "ends soon" : timeLeftWords(endsAt - now)}`, tone: "info", live: true, idleDays: null, endsInDays };
  }
  if (isIdleKey(key, now)) {
    const idleDays = daysSince(key.lastUsedAt ?? key.createdAt, now) ?? IDLE_DAYS;
    return { kind: "idle", label: key.lastUsedAt ? `Idle ${idleDays} days` : `Never used · ${idleDays} days`, tone: "warning", live: true, idleDays, endsInDays };
  }
  if (endsInDays !== null && endsInDays < ENDS_SOON_DAYS) return { kind: "ends_soon", label: endsInWords(endsInDays), tone: "warning", live: true, idleDays: null, endsInDays };
  return { kind: "working", label: "Working", tone: "good", live: true, idleDays: null, endsInDays };
}

/** The keys a rotation replaced: they read "rotating out" until the overlap ends. */
export function replacedKeyIds(keys: readonly Pick<ApiKeyView, "rotatedFrom">[]): Set<string> {
  return new Set(keys.map((key) => key.rotatedFrom).filter((id): id is string => Boolean(id)));
}

const NOUN: Partial<Record<ApiScope, string>> = { "policies:read": "policies", "leads:read": "leads", "commissions:read": "commissions" };

/**
 * What a key can do, the way the owner would say it: "Read policies, commissions", "Read leads ·
 * Create leads". Read scopes share one verb; the others keep their own label.
 */
export function canDoWords(scopes: readonly ApiScope[]): string {
  const ordered = API_SCOPES.filter((scope) => scopes.includes(scope.key));
  const reads = ordered.filter((scope) => scope.group === "read").map((scope) => NOUN[scope.key] ?? scope.label);
  const changes = ordered.filter((scope) => scope.group === "change").map((scope) => scope.label);
  const parts = [reads.length ? `Read ${reads.join(", ")}` : "", ...changes].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nothing";
}

/** "Gets policy issued, lapsed" — what a webhook listens for, for the Overview's "What it does". */
export function getsWords(events: readonly string[]): string {
  if (!events.length) return "Nothing yet";
  const words = events.map((event) => webhookEventLabel(event));
  const policy = words.filter((word) => word.startsWith("Policy ")).map((word) => word.slice(7).toLowerCase());
  const rest = words.filter((word) => !word.startsWith("Policy ")).map((word) => word.charAt(0).toLowerCase() + word.slice(1));
  const parts = [policy.length ? `policy ${policy.join(", ")}` : "", ...rest].filter(Boolean);
  return `Gets ${parts.join(", ")}`;
}

/** The address as its site name: "hooks.slack.com". */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** "https://hooks.slack.com/services/••••••": the path hidden, it can carry a token. */
export function maskedUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const first = parsed.pathname.split("/").filter(Boolean)[0];
    return `${parsed.protocol}//${parsed.host}${first ? `/${first}/••••••` : ""}`;
  } catch {
    return "••••••";
  }
}

export type HookKind = "working" | "retrying" | "failing" | "off" | "paused" | "new";
export type HookState = { kind: HookKind; label: string; tone: ChipTone; needsYou: boolean };

/** One chip for a webhook: Working · Retrying · Failing, N tries · Turned off · Paused · Not used yet. */
export function hookState(hook: Pick<WebhookView, "status" | "consecutiveFailures" | "lastSuccessAt" | "lastFailureAt">): HookState {
  if (hook.status === "disabled") return { kind: "off", label: "Turned off", tone: "neutral", needsYou: true };
  if (hook.status === "paused") return { kind: "paused", label: "Paused", tone: "neutral", needsYou: false };
  const tries = plural(hook.consecutiveFailures, "try", "tries");
  if (hook.status === "failing") return { kind: "failing", label: `Failing · ${tries}`, tone: "danger", needsYou: true };
  if (hook.consecutiveFailures > 0) return { kind: "retrying", label: `Retrying · ${tries}`, tone: "warning", needsYou: false };
  if (!hook.lastSuccessAt && !hook.lastFailureAt) return { kind: "new", label: "Not used yet", tone: "info", needsYou: false };
  return { kind: "working", label: "Working", tone: "good", needsYou: false };
}

/** How their server answered, in plain words, and the chip for it. */
export function answerWords(attempt: { ok: boolean; statusCode: number | null; error: string | null; durationMs?: number | null }): { chip: string; tone: ChipTone; said: string } {
  const code = attempt.statusCode;
  if (attempt.ok) return { chip: "Delivered", tone: "good", said: `"OK" · their server took it${code ? ` (${code})` : ""}` };
  if (code === null) {
    const timedOut = /No answer within/i.test(attempt.error ?? "");
    return timedOut
      ? { chip: "No answer in 10 s", tone: "danger", said: "Nothing came back within 10 seconds" }
      : { chip: "Couldn't reach them", tone: "danger", said: attempt.error ?? "The connection failed" };
  }
  if (code >= 500) return { chip: "Their server errored", tone: "danger", said: `"error" · their server had a problem (${code})` };
  if (code >= 300 && code < 400) return { chip: "Sent elsewhere", tone: "danger", said: `They answered with a redirect (${code}); we don't follow redirects` };
  if (code === 401 || code === 403) return { chip: "They refused it", tone: "danger", said: `"not allowed" · check their signature check and secret (${code})` };
  if (code === 404) return { chip: "Address not found", tone: "danger", said: `"not found" · the address may have changed (${code})` };
  return { chip: "They refused it", tone: "danger", said: `"refused" · their server would not take it (${code})` };
}

/** "1.2 s", "320 ms". */
export function tookWords(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

const dollars = (cents: unknown) => {
  const n = Number(cents);
  return Number.isFinite(n) && cents !== null && cents !== "" ? `$${(n / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null;
};
const MODE: Record<string, string> = { monthly: "a month", annual: "a year", annually: "a year", quarterly: "a quarter", semiannual: "every 6 months", semi_annual: "every 6 months" };

/** The few payload fields the delivery log reads back, never the whole body. */
export type DeliveryFacts = { policyNumber?: string | null; carrier?: string | null; premiumCents?: string | number | null; premiumMode?: string | null; product?: string | null; differenceCents?: string | number | null };

/** "Policy issued · Mutual of Omaha · 0119990312 · $48.20 a month" — what we sent, without the body. */
export function sentWords(eventType: string, facts: DeliveryFacts): string {
  const head = webhookEventLabel(eventType);
  if (eventType === "webhook.test") return "Test delivery · a message that needs no action";
  if (eventType.startsWith("policy.")) {
    const premium = dollars(facts.premiumCents);
    return [head, facts.carrier, facts.policyNumber ? `policy ${facts.policyNumber}` : null, premium ? `${premium}${facts.premiumMode && MODE[facts.premiumMode] ? ` ${MODE[facts.premiumMode]}` : ""}` : null].filter(Boolean).join(" · ");
  }
  if (eventType === "commission.discrepancy_found") {
    const difference = dollars(facts.differenceCents);
    return [head, facts.carrier, facts.policyNumber ? `policy ${facts.policyNumber}` : null, difference ? `${difference} difference` : null].filter(Boolean).join(" · ");
  }
  if (eventType.startsWith("form.")) return [head, facts.product].filter(Boolean).join(" · ");
  return head;
}

/** Per webhook, beside the list (GET /api/app/webhooks `extras`). */
export type HookExtras = {
  /** The earliest waiting delivery's next try. */
  nextTryAt: string | null;
  /** Events that gave up (failed, or cancelled when the webhook was turned off) since it last worked. */
  missed: number;
  /** Their last failed answer, for the status line. */
  lastAnswer: { statusCode: number | null; error: string | null; at: string } | null;
};

/** One line of the webhook sheet's Deliveries (GET /api/app/webhooks/:id?view=deliveries). */
export type DeliveryLogRow = {
  id: string;
  deliveryId: string;
  eventType: string;
  attempt: number;
  attemptedAt: string;
  statusCode: number | null;
  ok: boolean;
  durationMs: number | null;
  responseSnippet: string | null;
  error: string | null;
  /** Where its delivery stands now: pending (with its next try), succeeded, failed, cancelled. */
  deliveryStatus: string | null;
  nextAttemptAt: string | null;
  deliveryAttempts: number | null;
  facts: DeliveryFacts;
};

// ---------------------------------------------------------------- samples

export type SampleLanguage = "curl" | "js";

/** A copy-ready request to read policies with a key; `key` is the full key once, else YOUR_KEY. */
export function requestSample(language: SampleLanguage, origin: string, key = "YOUR_KEY", path = "/api/v1/policies?limit=50"): string {
  const url = `${origin}${path}`;
  if (language === "curl") return `curl "${url}" \\\n  -H "Authorization: Bearer ${key}"`;
  return `const res = await fetch("${url}", {\n  headers: { Authorization: "Bearer ${key}" },\n});\nconst { data, next_cursor } = await res.json();`;
}

/** The path a key's sample reads: the first thing it may read. */
export function samplePath(scopes: readonly ApiScope[]): string {
  if (scopes.includes("policies:read")) return "/api/v1/policies?limit=50";
  if (scopes.includes("commissions:read")) return "/api/v1/commissions?limit=50";
  if (scopes.includes("leads:read")) return "/api/v1/leads?limit=50";
  if (scopes.includes("webhooks:manage")) return "/api/v1/webhooks";
  return "/api/v1/policies?limit=50";
}

/** Checking our signature, as a receiver does: the same steps lib/webhooks/rules.ts verifySignature takes. */
export function verifySample(language: SampleLanguage): string {
  if (language === "curl") {
    return [
      "# The header looks like: Insurvas-Signature: t=1731424860,v1=5f3c…",
      "# Sign the timestamp, a dot, then the raw body, with your signing secret:",
      "printf '%s.%s' \"$T\" \"$RAW_BODY\" \\",
      "  | openssl dgst -sha256 -hmac \"$SIGNING_SECRET\" -hex",
      "# Compare the result with v1, and refuse a timestamp older than 5 minutes.",
    ].join("\n");
  }
  return [
    'import crypto from "node:crypto";',
    "",
    "export function isFromInsurvas(rawBody, header, secret) {",
    '  const { t, v1 } = Object.fromEntries(header.split(",").map((p) => p.split("=")));',
    "  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // older than 5 min",
    '  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");',
    "  if (!v1 || v1.length !== expected.length) return false;",
    "  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));",
    "}",
  ].join("\n");
}

/** The `data` of each event, as its trigger builds it: names of fields and figures, never a body from a real agency. */
export const EVENT_SAMPLES: Record<string, string> = {
  "policy.issued": `{ "policy_number": "MO-4471209", "carrier": { "name": "Mutual of Omaha" },\n  "status": "active", "previous_status": "submitted", "effective_on": "2026-11-12",\n  "premium_cents": 4820, "premium_mode": "monthly", "product_code": "living_promise" }`,
  "policy.lapsed": `{ "policy_number": "MO-4471209", "carrier": { "name": "Mutual of Omaha" },\n  "status": "lapsed", "previous_status": "active", "effective_on": "2026-11-12",\n  "premium_cents": 4820, "premium_mode": "monthly", "product_code": "living_promise" }`,
  "commission.discrepancy_found": `{ "type": "short_paid", "severity": "warning", "policy_number": "MO-4471209", "policy_year": 1,\n  "carrier": { "name": "Mutual of Omaha" },\n  "expected_cents": 52000, "reported_cents": 39000, "difference_cents": 13000 }`,
  "form.submitted": `{ "product": "final_expense", "version": 8, "source": "agent", "test": false,\n  "answers": { "first_name": "Ruth", "state": "TX", "coverage_amount": 15000 } }`,
  "form.test": `{ "product": "final_expense", "version": 8, "source": "agent", "test": true,\n  "answers": { "first_name": "Test", "state": "TX" } }`,
};

/**
 * What a delivery looks like: the real shape the policy trigger sends (migration 20261015340000):
 * identifiers and figures only — no client name, never an SSN, bank details or health answers.
 */
export const SAMPLE_DELIVERY = `{
  "id": "6f1c2b9e-0d4a-4c51-9a77-2b8f3e1d5c40",
  "type": "policy.issued",
  "created_at": "2026-11-12T15:41:00Z",
  "data": {
    "policy_number": "MO-4471209",
    "carrier": { "id": "…", "name": "Mutual of Omaha" },
    "status": "active",
    "previous_status": "submitted",
    "effective_on": "2026-11-12",
    "premium_cents": 4820,
    "premium_mode": "monthly",
    "product_code": "living_promise"
  }
}`;

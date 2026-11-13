/**
 * LA-8.7 (Notion sprint, Module 8 — Settings) · Integrations: what the settings screen and the API
 * share. No `server-only` here: the screen draws these lists and the rules below are pure.
 *
 * Scopes are explicit and narrow. There is deliberately no "full access" scope — it would be the one
 * everybody picks — and the table's check constraint refuses anything not in this list.
 */

/**
 * In the agency's words (Settings › Integrations, round 8): what each scope lets an app do, and what
 * it shows. `group` sorts them under "Read" and "Change" on the key's sheet and in the new-key steps.
 */
export const API_SCOPES = [
  { key: "policies:read", group: "read", label: "Read policies", description: "Policy number, carrier, product, status and premium." },
  { key: "leads:read", group: "read", label: "Read leads", description: "Name, phone, email, state and stage." },
  { key: "commissions:read", group: "read", label: "Read commissions", description: "Commission lines from carrier statements, with amounts." },
  { key: "leads:write", group: "change", label: "Create leads", description: "Add a lead to a campaign. Lead vendors should use Lead posting instead." },
  { key: "webhooks:manage", group: "change", label: "Manage webhooks", description: "Let the app add and remove its own webhooks." },
] as const;

export type ApiScope = (typeof API_SCOPES)[number]["key"];
export const API_SCOPE_KEYS: readonly ApiScope[] = API_SCOPES.map((scope) => scope.key);

/**
 * The events a webhook can listen for. The form events are queued by the Application forms builder
 * (migration 20261112200000): a webhook here hears every form's submissions; a form's own webhook,
 * set on the form, hears only that form.
 */
export const WEBHOOK_EVENTS = [
  { key: "policy.issued", group: "policy", label: "Policy issued", description: "A policy went active. Carries the policy number, carrier, product and premium." },
  { key: "policy.lapsed", group: "policy", label: "Policy lapsed", description: "A carrier file reported a policy as lapsed." },
  { key: "commission.discrepancy_found", group: "commission", label: "Commission doesn't match", description: "Statement checking found a new discrepancy." },
  { key: "form.submitted", group: "form", label: "Application form sent", description: "Someone sent one of your application forms. Carries the answers, never an SSN or bank details." },
  { key: "form.test", group: "form", label: "Application form test", description: "A test run of one of your application forms." },
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number]["key"];
export const WEBHOOK_EVENT_KEYS: readonly WebhookEventType[] = WEBHOOK_EVENTS.map((event) => event.key);

/** Any event's plain name, including the test delivery that "Send test" queues. */
export function webhookEventLabel(event: string): string {
  if (event === "webhook.test") return "Test delivery";
  return WEBHOOK_EVENTS.find((item) => item.key === event)?.label ?? event;
}

/**
 * Rotation keeps the old key working this long, so nothing breaks mid-deploy. 0 is "stops now", for
 * a key that may have leaked.
 */
export const ROTATION_OVERLAP_HOURS = [0, 1, 24, 72] as const;
export const DEFAULT_ROTATION_OVERLAP_HOURS = 24;

/**
 * "Start from": the apps an agency usually connects, and what each usually needs. Picking one names
 * the key after it and ticks these on the next step; the person can change both.
 */
export const KEY_PRESETS = [
  { key: "zapier", label: "Zapier", scopes: ["policies:read"] },
  { key: "make", label: "Make", scopes: ["policies:read"] },
  { key: "sheets", label: "Google Sheets", scopes: ["policies:read"] },
  { key: "warehouse", label: "Data warehouse", scopes: ["policies:read", "commissions:read"] },
  { key: "other", label: "Other", scopes: [] },
] as const satisfies ReadonlyArray<{ key: string; label: string; scopes: readonly ApiScope[] }>;

/** Optional expiry, encouraged for anything temporary. */
export const KEY_EXPIRY_DAYS = [30, 90, 365] as const;

/** A key unused this long gets a quiet prompt to revoke it. */
export const IDLE_DAYS = 90;

export type ApiKeyView = {
  id: string;
  label: string;
  keyPrefix: string;
  lastFour: string;
  scopes: ApiScope[];
  createdAt: string;
  createdByName: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  rotatedFrom: string | null;
};

export type ApiKeyStatus = "active" | "rotating_out" | "expired" | "revoked";

/**
 * Where a key stands at `now`. A key that a rotation replaced keeps working until its expiry (the
 * overlap) and reads "rotating out" until then.
 */
export function apiKeyStatus(key: Pick<ApiKeyView, "expiresAt" | "revokedAt">, replaced: boolean, now: number): ApiKeyStatus {
  if (key.revokedAt) return "revoked";
  if (key.expiresAt && Date.parse(key.expiresAt) <= now) return "expired";
  return replaced ? "rotating_out" : "active";
}

/**
 * The quiet prompt: a live key nobody has used in IDLE_DAYS (or, never used, created that long ago).
 * Unused credentials are the ones nobody notices being abused.
 */
export function isIdleKey(key: Pick<ApiKeyView, "lastUsedAt" | "createdAt" | "expiresAt" | "revokedAt">, now: number): boolean {
  if (key.revokedAt || (key.expiresAt && Date.parse(key.expiresAt) <= now)) return false;
  const since = Date.parse(key.lastUsedAt ?? key.createdAt);
  return Number.isFinite(since) && now - since >= IDLE_DAYS * 86_400_000;
}

export type WebhookStatus = "active" | "paused" | "failing" | "disabled";

export type WebhookView = {
  id: string;
  label: string;
  targetUrl: string;
  eventTypes: WebhookEventType[];
  status: WebhookStatus;
  createdAt: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  disabledAt: string | null;
  disabledReason: string | null;
  pending: number;
};

export type WebhookAttemptView = {
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
};

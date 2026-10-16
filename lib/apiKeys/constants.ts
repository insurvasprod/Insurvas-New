/**
 * LA-8.7 (Notion sprint, Module 8 — Settings) · Integrations: what the settings screen and the API
 * share. No `server-only` here: the screen draws these lists and the rules below are pure.
 *
 * Scopes are explicit and narrow. There is deliberately no "full access" scope — it would be the one
 * everybody picks — and the table's check constraint refuses anything not in this list.
 */

export const API_SCOPES = [
  { key: "leads:write", label: "Post leads", description: "Post a lead in, through a vendor's lead posting." },
  { key: "leads:read", label: "Read leads", description: "Read lead records: name, phone, email, state and stage." },
  { key: "policies:read", label: "Read policies", description: "Read the book of business: policy number, carrier, status and premium." },
  { key: "commissions:read", label: "Read commissions", description: "Read commission entries from carrier statements." },
  { key: "webhooks:manage", label: "Manage webhooks", description: "Create, list and delete webhook subscriptions." },
] as const;

export type ApiScope = (typeof API_SCOPES)[number]["key"];
export const API_SCOPE_KEYS: readonly ApiScope[] = API_SCOPES.map((scope) => scope.key);

export const WEBHOOK_EVENTS = [
  { key: "policy.issued", label: "Policy issued", description: "A policy went active from submitted or approved." },
  { key: "policy.lapsed", label: "Policy lapsed", description: "A carrier file reported a policy as lapsed." },
  { key: "commission.discrepancy_found", label: "Commission discrepancy found", description: "Statement checking found a new discrepancy." },
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number]["key"];
export const WEBHOOK_EVENT_KEYS: readonly WebhookEventType[] = WEBHOOK_EVENTS.map((event) => event.key);

/** Rotation keeps the old key working this long, so nothing breaks mid-deploy. */
export const ROTATION_OVERLAP_HOURS = [1, 24, 72] as const;
export const DEFAULT_ROTATION_OVERLAP_HOURS = 24;

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

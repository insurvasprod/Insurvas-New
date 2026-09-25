import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "./schemaGap";
import {
  BUSY_HORIZON_DAYS,
  CALENDAR_PROVIDERS,
  PROVIDER_ENV,
  type CalendarConnectionStatus,
  type CalendarConnectionView,
  type CalendarProviderId,
  type CalendarProviderView,
} from "./linkedCalendarsShared";

/**
 * Settings › Calendar & availability · "Honour linked calendars — busy time in Google or Outlook
 * removes the slot" (20260924230200).
 *
 * The rule lives in `book_appointment`: it refuses a start that overlaps busy time from a
 * CONNECTED calendar when the agent's switch is on. This file is everything that fills
 * `tenant_calendar_busy`: the connection (OAuth), the encrypted refresh token, and the sync.
 *
 * THE SEAM is `BusyTimeSource` — authorise, exchange a code, refresh, name the account, read busy
 * intervals. Google and Microsoft are implemented against their documented endpoints. What they
 * cannot do from this repository is run: each needs the platform's own OAuth application, and a
 * key to encrypt tokens at rest.
 *
 *   Google     GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET — a Google Cloud OAuth
 *              client (web application) with the Calendar API enabled and scope
 *              https://www.googleapis.com/auth/calendar.freebusy on the consent screen.
 *   Microsoft  MICROSOFT_CALENDAR_CLIENT_ID, MICROSOFT_CALENDAR_CLIENT_SECRET (optionally
 *              MICROSOFT_CALENDAR_TENANT, default "common") — a Microsoft Entra app registration
 *              with delegated Graph permissions offline_access, User.Read, Calendars.ReadBasic.
 *   Both       CALENDAR_TOKEN_KEY (any long random string) and the redirect URI
 *              <APP_URL>/api/app/calendar-connections/callback registered on each client.
 *
 * Until a provider's variables are set it reports `configured: false`, the screen says what is
 * missing instead of offering a Connect button that cannot work, and nothing here is called.
 */

export type BusyInterval = { startsAt: string; endsAt: string };
type Tokens = { accessToken: string; refreshToken: string | null; scopes: string[] };

export interface BusyTimeSource {
  id: CalendarProviderId;
  authorizeUrl(input: { state: string; redirectUri: string }): string;
  exchangeCode(input: { code: string; redirectUri: string }): Promise<Tokens>;
  refresh(refreshToken: string): Promise<Tokens>;
  accountEmail(accessToken: string): Promise<string | null>;
  fetchBusy(accessToken: string, fromIso: string, toIso: string): Promise<BusyInterval[]>;
}

export class CalendarProviderNotConfiguredError extends Error {
  constructor(public readonly provider: CalendarProviderId, public readonly missing: string[]) {
    super(`Connecting ${provider === "google" ? "Google Calendar" : "Outlook"} is not set up on this deployment yet (missing ${missing.join(", ")}).`);
    this.name = "CalendarProviderNotConfiguredError";
  }
}

const env = (name: string) => (process.env[name] ?? "").trim();

export function missingProviderEnv(id: CalendarProviderId): string[] {
  return PROVIDER_ENV[id].filter((name) => !env(name));
}

export function calendarProviders(): CalendarProviderView[] {
  return CALENDAR_PROVIDERS.map((provider) => ({ id: provider.id, label: provider.label, configured: missingProviderEnv(provider.id).length === 0 }));
}

export function calendarRedirectUri(): string {
  const base = env("APP_URL") || env("NEXT_PUBLIC_APP_URL") || "http://localhost:3000";
  return `${base.replace(/\/+$/, "")}/api/app/calendar-connections/callback`;
}

// ── tokens at rest ────────────────────────────────────────────────────────────────────────────
const VERSION = "v1";
function tokenKey(): Buffer {
  const configured = env("CALENDAR_TOKEN_KEY");
  if (!configured) throw new Error("CALENDAR_TOKEN_KEY is not set");
  return createHash("sha256").update(configured, "utf8").digest();
}
export function encryptToken(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}
export function decryptToken(value: string): string {
  const [version, iv, tag, body] = value.split(".");
  if (version !== VERSION || !iv || !tag || !body) throw new Error("Unsupported calendar token ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

// ── providers ─────────────────────────────────────────────────────────────────────────────────
async function formPost(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Token request refused (${response.status}): ${String(body.error_description ?? body.error ?? "no detail")}`.slice(0, 500));
  return body;
}

function tokensFrom(body: Record<string, unknown>): Tokens {
  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  if (!accessToken) throw new Error("The provider returned no access token");
  return {
    accessToken,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    scopes: typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : [],
  };
}

async function bearerJson(url: string, token: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Calendar request refused (${response.status})`);
  return body;
}

const google: BusyTimeSource = {
  id: "google",
  authorizeUrl({ state, redirectUri }) {
    const query = new URLSearchParams({
      client_id: env("GOOGLE_CALENDAR_CLIENT_ID"),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email https://www.googleapis.com/auth/calendar.freebusy",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`;
  },
  async exchangeCode({ code, redirectUri }) {
    return tokensFrom(await formPost("https://oauth2.googleapis.com/token", {
      code, redirect_uri: redirectUri, grant_type: "authorization_code",
      client_id: env("GOOGLE_CALENDAR_CLIENT_ID"), client_secret: env("GOOGLE_CALENDAR_CLIENT_SECRET"),
    }));
  },
  async refresh(refreshToken) {
    return tokensFrom(await formPost("https://oauth2.googleapis.com/token", {
      refresh_token: refreshToken, grant_type: "refresh_token",
      client_id: env("GOOGLE_CALENDAR_CLIENT_ID"), client_secret: env("GOOGLE_CALENDAR_CLIENT_SECRET"),
    }));
  },
  async accountEmail(accessToken) {
    const body = await bearerJson("https://openidconnect.googleapis.com/v1/userinfo", accessToken);
    return typeof body.email === "string" ? body.email : null;
  },
  async fetchBusy(accessToken, fromIso, toIso) {
    const body = await bearerJson("https://www.googleapis.com/calendar/v3/freeBusy", accessToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeMin: fromIso, timeMax: toIso, items: [{ id: "primary" }] }),
    });
    const calendars = (body.calendars ?? {}) as Record<string, { busy?: Array<{ start?: string; end?: string }> }>;
    return (calendars.primary?.busy ?? [])
      .filter((slot) => slot.start && slot.end)
      .map((slot) => ({ startsAt: new Date(slot.start as string).toISOString(), endsAt: new Date(slot.end as string).toISOString() }));
  },
};

const microsoftTenant = () => env("MICROSOFT_CALENDAR_TENANT") || "common";
const microsoft: BusyTimeSource = {
  id: "microsoft",
  authorizeUrl({ state, redirectUri }) {
    const query = new URLSearchParams({
      client_id: env("MICROSOFT_CALENDAR_CLIENT_ID"),
      redirect_uri: redirectUri,
      response_type: "code",
      response_mode: "query",
      scope: "offline_access User.Read Calendars.ReadBasic",
      state,
    });
    return `https://login.microsoftonline.com/${microsoftTenant()}/oauth2/v2.0/authorize?${query.toString()}`;
  },
  async exchangeCode({ code, redirectUri }) {
    return tokensFrom(await formPost(`https://login.microsoftonline.com/${microsoftTenant()}/oauth2/v2.0/token`, {
      code, redirect_uri: redirectUri, grant_type: "authorization_code",
      client_id: env("MICROSOFT_CALENDAR_CLIENT_ID"), client_secret: env("MICROSOFT_CALENDAR_CLIENT_SECRET"),
      scope: "offline_access User.Read Calendars.ReadBasic",
    }));
  },
  async refresh(refreshToken) {
    return tokensFrom(await formPost(`https://login.microsoftonline.com/${microsoftTenant()}/oauth2/v2.0/token`, {
      refresh_token: refreshToken, grant_type: "refresh_token",
      client_id: env("MICROSOFT_CALENDAR_CLIENT_ID"), client_secret: env("MICROSOFT_CALENDAR_CLIENT_SECRET"),
      scope: "offline_access User.Read Calendars.ReadBasic",
    }));
  },
  async accountEmail(accessToken) {
    const body = await bearerJson("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", accessToken);
    return typeof body.mail === "string" ? body.mail : typeof body.userPrincipalName === "string" ? body.userPrincipalName : null;
  },
  async fetchBusy(accessToken, fromIso, toIso) {
    const busy: BusyInterval[] = [];
    let url: string | null =
      `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${encodeURIComponent(fromIso)}&endDateTime=${encodeURIComponent(toIso)}&$select=start,end,showAs,isCancelled&$top=500`;
    for (let page = 0; url && page < 10; page += 1) {
      const body: Record<string, unknown> = await bearerJson(url, accessToken, { headers: { Prefer: 'outlook.timezone="UTC"' } });
      for (const event of (body.value ?? []) as Array<{ start?: { dateTime?: string }; end?: { dateTime?: string }; showAs?: string; isCancelled?: boolean }>) {
        if (event.isCancelled || event.showAs === "free" || event.showAs === "workingElsewhere") continue;
        if (!event.start?.dateTime || !event.end?.dateTime) continue;
        // Graph returns UTC wall time without an offset when asked for outlook.timezone="UTC".
        const utc = (value: string) => new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`).toISOString();
        busy.push({ startsAt: utc(event.start.dateTime), endsAt: utc(event.end.dateTime) });
      }
      url = typeof body["@odata.nextLink"] === "string" ? (body["@odata.nextLink"] as string) : null;
    }
    return busy;
  },
};

const SOURCES: Record<CalendarProviderId, BusyTimeSource> = { google, microsoft };
export const busyTimeSource = (id: CalendarProviderId): BusyTimeSource => SOURCES[id];

// ── storage ───────────────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
type Result<T> = { data: T; error: { message: string; code?: string } | null };
type Query<T> = PromiseLike<Result<T>> & {
  select(columns: string): Query<T>;
  eq(column: string, value: unknown): Query<T>;
  in(column: string, values: unknown[]): Query<T>;
  gt(column: string, value: unknown): Query<T>;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): Query<T>;
  limit(count: number): Query<T>;
  update(values: Row): Query<T>;
  upsert(values: Row, options?: { onConflict?: string }): Query<T>;
  delete(): Query<T>;
  maybeSingle(): PromiseLike<Result<Row | null>>;
};
type Db = { from(table: string): Query<Row[]>; rpc(name: string, args: Row): PromiseLike<Result<unknown>> };
const db = () => getSupabaseServiceClient() as unknown as Db;
const text = (value: unknown) => (typeof value === "string" ? value : "");

const COLUMNS = "id, tenant_id, user_id, provider, status, account_email, last_synced_at, last_error";

function view(row: Row): CalendarConnectionView {
  return {
    id: text(row.id),
    userId: text(row.user_id),
    provider: text(row.provider) as CalendarProviderId,
    status: (text(row.status) || "pending") as CalendarConnectionStatus,
    accountEmail: text(row.account_email) || null,
    lastSyncedAt: text(row.last_synced_at) || null,
    lastError: text(row.last_error) || null,
  };
}

/** The tenant's connections, or `available: false` before 20260924230200 is applied. */
export async function listCalendarConnections(tenantId: string): Promise<{ available: boolean; connections: CalendarConnectionView[] }> {
  const result = await db().from("tenant_connected_calendars").select(COLUMNS).eq("tenant_id", tenantId);
  if (isSchemaGap(result.error)) return { available: false, connections: [] };
  if (result.error) throw new Error(`Could not load linked calendars: ${result.error.message}`);
  return { available: true, connections: (result.data ?? []).map(view) };
}

/** Begin connecting: records a one-use state nonce and returns the provider's consent URL. */
export async function startCalendarConnection(input: { tenantId: string; userId: string; provider: CalendarProviderId }): Promise<string> {
  const missing = missingProviderEnv(input.provider);
  if (missing.length) throw new CalendarProviderNotConfiguredError(input.provider, missing);
  const state = randomBytes(24).toString("base64url");
  const existing = await db()
    .from("tenant_connected_calendars")
    .select("id, status")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.userId)
    .eq("provider", input.provider)
    .maybeSingle();
  if (existing.error) throw new Error(`Could not start the connection: ${existing.error.message}`);
  const saved = await db().from("tenant_connected_calendars").upsert(
    {
      tenant_id: input.tenantId,
      user_id: input.userId,
      provider: input.provider,
      // A reconnect keeps the working connection in force until the new consent completes.
      status: existing.data && text(existing.data.status) === "connected" ? "connected" : "pending",
      oauth_state: state,
      oauth_state_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,user_id,provider" },
  );
  if (saved.error) throw new Error(`Could not start the connection: ${saved.error.message}`);
  return busyTimeSource(input.provider).authorizeUrl({ state, redirectUri: calendarRedirectUri() });
}

/** The OAuth callback: exchange the code, store the encrypted refresh token, then read busy time. */
export class CalendarWrongWorkspaceError extends Error {
  constructor() {
    super("That calendar link was started in another workspace.");
    this.name = "CalendarWrongWorkspaceError";
  }
}

export async function completeCalendarConnection(input: { state: string; code: string; tenantId: string }): Promise<{ tenantId: string; userId: string }> {
  const found = await db()
    .from("tenant_connected_calendars")
    .select(`${COLUMNS}, oauth_state_expires_at`)
    .eq("oauth_state", input.state)
    .maybeSingle();
  if (found.error) throw new Error(`Could not complete the connection: ${found.error.message}`);
  const row = found.data;
  if (!row || Date.parse(text(row.oauth_state_expires_at)) < Date.now()) throw new Error("That connection link has expired. Start again from Calendar & availability.");
  // Checked before the code is exchanged, so no token is ever stored against another agency.
  if (text(row.tenant_id) !== input.tenantId) throw new CalendarWrongWorkspaceError();
  const provider = text(row.provider) as CalendarProviderId;
  const source = busyTimeSource(provider);
  const tokens = await source.exchangeCode({ code: input.code, redirectUri: calendarRedirectUri() });
  if (!tokens.refreshToken) throw new Error("The provider did not grant offline access, so busy time could not be kept up to date.");
  const email = await source.accountEmail(tokens.accessToken).catch(() => null);
  const updated = await db()
    .from("tenant_connected_calendars")
    .update({
      status: "connected",
      account_email: email,
      refresh_token_ciphertext: encryptToken(tokens.refreshToken),
      scopes: tokens.scopes,
      oauth_state: null,
      oauth_state_expires_at: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", text(row.id));
  if (updated.error) throw new Error(`Could not save the connection: ${updated.error.message}`);
  await syncCalendarBusy(text(row.id)).catch(() => undefined);
  return { tenantId: text(row.tenant_id), userId: text(row.user_id) };
}

export async function disconnectCalendar(tenantId: string, id: string): Promise<{ userId: string } | null> {
  const found = await db().from("tenant_connected_calendars").select("id, user_id").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (found.error) throw new Error(`Could not find that calendar: ${found.error.message}`);
  if (!found.data) return null;
  // Deleting the connection deletes its busy time with it (on delete cascade).
  const removed = await db().from("tenant_connected_calendars").delete().eq("tenant_id", tenantId).eq("id", id);
  if (removed.error) throw new Error(`Could not disconnect that calendar: ${removed.error.message}`);
  return { userId: text(found.data.user_id) };
}

/** Refresh the access token and replace this calendar's busy set for the next 30 days. */
export async function syncCalendarBusy(id: string, now = new Date()): Promise<number> {
  const found = await db()
    .from("tenant_connected_calendars")
    .select("id, provider, status, refresh_token_ciphertext")
    .eq("id", id)
    .maybeSingle();
  if (found.error) throw new Error(`Could not read that calendar: ${found.error.message}`);
  const row = found.data;
  if (!row || !text(row.refresh_token_ciphertext)) throw new Error("That calendar is not connected.");
  const provider = text(row.provider) as CalendarProviderId;
  try {
    const source = busyTimeSource(provider);
    const tokens = await source.refresh(decryptToken(text(row.refresh_token_ciphertext)));
    const busy = await source.fetchBusy(tokens.accessToken, now.toISOString(), new Date(now.getTime() + BUSY_HORIZON_DAYS * 86_400_000).toISOString());
    if (tokens.refreshToken) {
      await db().from("tenant_connected_calendars").update({ refresh_token_ciphertext: encryptToken(tokens.refreshToken) }).eq("id", id);
    }
    const replaced = await db().rpc("replace_calendar_busy", { p_calendar_id: id, p_rows: busy, p_synced_at: now.toISOString() });
    if (replaced.error) throw new Error(replaced.error.message);
    return Number(replaced.data ?? busy.length);
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Could not read busy time").slice(0, 1000);
    // A failed sync leaves the last busy set in place but marks the connection, so the screen can
    // say the calendar needs attention rather than silently honouring stale busy time.
    await db().from("tenant_connected_calendars").update({ status: "error", last_error: message, updated_at: new Date().toISOString() }).eq("id", id);
    throw error;
  }
}

/** The scheduled pass: every connected (or failing) calendar, least recently synced first. */
export async function syncAllCalendars(limit = 50): Promise<{ synced: number; failed: number; available: boolean }> {
  const rows = await db()
    .from("tenant_connected_calendars")
    .select("id")
    .in("status", ["connected", "error"])
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (isSchemaGap(rows.error)) return { synced: 0, failed: 0, available: false };
  if (rows.error) throw new Error(`Could not list linked calendars: ${rows.error.message}`);
  let synced = 0;
  let failed = 0;
  for (const row of rows.data ?? []) {
    try {
      await syncCalendarBusy(text(row.id));
      synced += 1;
    } catch {
      failed += 1;
    }
  }
  return { synced, failed, available: true };
}

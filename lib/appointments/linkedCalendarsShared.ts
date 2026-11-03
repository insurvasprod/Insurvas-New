/**
 * Linked calendars — the vocabulary the screen and the server share (no `server-only`, so the
 * client component can import it). The server half is lib/appointments/linkedCalendars.ts.
 */

export const CALENDAR_PROVIDERS = [
  { id: "google", label: "Google Calendar" },
  { id: "microsoft", label: "Outlook" },
] as const;

export type CalendarProviderId = (typeof CALENDAR_PROVIDERS)[number]["id"];

export const providerLabel = (id: string) => CALENDAR_PROVIDERS.find((provider) => provider.id === id)?.label ?? id;

/**
 * What each provider needs before anyone can connect a calendar. These are the platform's OAuth
 * applications — registered once, in Google Cloud and in Microsoft Entra — not anything an agency
 * types. `CALENDAR_TOKEN_KEY` encrypts the refresh tokens at rest and is shared by both.
 */
export const PROVIDER_ENV: Record<CalendarProviderId, readonly string[]> = {
  google: ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET", "CALENDAR_TOKEN_KEY"],
  microsoft: ["MICROSOFT_CALENDAR_CLIENT_ID", "MICROSOFT_CALENDAR_CLIENT_SECRET", "CALENDAR_TOKEN_KEY"],
};

export type CalendarConnectionStatus = "pending" | "connected" | "error" | "revoked";

export type CalendarConnectionView = {
  id: string;
  userId: string;
  provider: CalendarProviderId;
  status: CalendarConnectionStatus;
  accountEmail: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};

export type CalendarProviderView = {
  id: CalendarProviderId;
  label: string;
  /** True when the platform's OAuth application for this provider is configured on this deployment. */
  configured: boolean;
};

/** How far ahead busy time is read: the booking picker proposes at most a fortnight out. */
export const BUSY_HORIZON_DAYS = 30;

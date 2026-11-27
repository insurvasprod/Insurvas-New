import { Platform } from "react-native";
import Constants from "expo-constants";

/**
 * Every screen talks to the web app's own /api/app routes, with the same rules (roles, plans, money,
 * compliance) — the phone never decides who may call or see cost. The session token rides as a Bearer
 * header; the server accepts it only because it was issued to the app (lib/tenantAuth/appClient.ts).
 */
// A release build always talks to production unless its profile names another server: guessing a
// development address there would leave every screen failing to load.
export const API_URL: string = (process.env.EXPO_PUBLIC_API_URL || (__DEV__ ? devApiUrl() : "https://app.insurvas.com")).replace(/\/+$/, "");

/**
 * Development only (builds set EXPO_PUBLIC_API_URL): the web app runs on port 3000 of the same computer
 * as Metro, so the API host is the host the app's code was loaded from — 192.168.x.x for a phone on the
 * Wi-Fi (Expo Go on an iPhone), 10.0.2.2 for the Android emulator, localhost for the web preview.
 */
function devApiUrl(): string {
  if (Platform.OS === "web") return "http://localhost:3000";
  const host = (Constants.expoConfig?.hostUri ?? "").split(":")[0];
  if (host) return `http://${host}:3000`;
  return Platform.OS === "android" ? "http://10.0.2.2:3000" : "http://localhost:3000";
}

const version = Constants.expoConfig?.version ?? "1.0.0";
/** Signed-in devices names this session "Insurvas app on iPhone" from this mark. */
const USER_AGENT = `InsurvasApp/${version} (${Platform.OS === "ios" ? "iPhone" : Platform.OS === "android" ? "Android" : "Web preview"})`;

/**
 * Board M4: the module a plan refusal names. The server answers `feature_not_entitled` with the feature key
 * (lib/entitlements/requireFeature.ts) and one sentence for every feature; the phone names the module from
 * the key, and says what stays open where the board does ("Your book and policies stay open as before.").
 */
const MODULES: Record<string, { name: string; keeps?: string }> = {
  chargeback_radar: { name: "Retention", keeps: "Your book and policies stay open as before." },
  winback: { name: "Win-back", keeps: "Your book and policies stay open as before." },
  payment_repair: { name: "Payment repair", keeps: "Your book and policies stay open as before." },
  applications: { name: "Applications", keeps: "Your leads and calls stay open as before." },
  quoting: { name: "Quoting", keeps: "Your leads and calls stay open as before." },
  book_of_business: { name: "Book of business" },
  outbound_dialing: { name: "The dialer", keeps: "Your leads stay open as before." },
  inbound_transfers: { name: "Incoming transfers", keeps: "Your leads stay open as before." },
  callback_calendar: { name: "Callbacks" },
  appointment_vault: { name: "Appointments" },
  daily_deal_flow: { name: "Daily deal flow" },
  statement_ingestion: { name: "Carrier statements" },
  commission_ledger: { name: "The commission ledger" },
  producer_payouts: { name: "Producer pay" },
  payout_runs: { name: "Payout runs" },
  profit_and_loss: { name: "Profit and loss" },
  true_cpa: { name: "True cost per sale" },
  tax_summaries: { name: "Tax summaries" },
  discrepancy_report: { name: "Pay issues" },
  team_hierarchy: { name: "Team" },
  producer_scorecards: { name: "Scorecards" },
  sales_report: { name: "Sales reports" },
  agency_dashboard: { name: "The agency dashboard" },
  cohort_persistency: { name: "Persistency reports" },
  tcpa_checker: { name: "Number checks" },
  consent_locker: { name: "The consent locker" },
  litigation_packet: { name: "Litigation packets" },
  publisher_records: { name: "Lead partners" },
  partner_quality: { name: "Partner quality" },
  lead_import: { name: "Lead import" },
  duplicate_detection: { name: "Duplicate checks" },
  ai_assistant: { name: "The assistant" },
};

export function planModule(feature: unknown): { name: string; keeps: string | null } | null {
  const m = typeof feature === "string" ? MODULES[feature] : undefined;
  return m ? { name: m.name, keeps: m.keeps ?? null } : null;
}

function wordsFor(status: number, body: Record<string, unknown>): string {
  // "Retention isn’t in your agency’s plan" rather than the server's one sentence for every feature, so the
  // screen (and any error line) names what is missing (board M4).
  const module = body.code === "feature_not_entitled" ? planModule(body.feature) : null;
  if (module) return `${module.name} isn’t in your agency’s plan`;
  if (typeof body.error === "string") return body.error;
  return status === 0 ? "No connection. Check your signal and try again." : "Something went wrong. Try again.";
}

/** What a refusal was, kept by its words so the shared states (ui.tsx Failed) read the code, not the text. */
export type Refusal = { status: number; code: string | null; feature: string | null };
const refusals = new Map<string, Refusal>();

export class ApiError extends Error {
  status: number;
  code: string | null;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(wordsFor(status, body));
    this.status = status;
    this.code = typeof body.code === "string" ? body.code : null;
    this.body = body;
    refusals.delete(this.message);
    refusals.set(this.message, { status, code: this.code, feature: typeof body.feature === "string" ? body.feature : null });
    if (refusals.size > 60) refusals.delete(refusals.keys().next().value as string);
  }
}

/**
 * The code behind an error message a screen was handed (useLoad keeps only the words for most screens). Null
 * for words no request produced (a screen's own message).
 */
export function refusalFor(message: string | null | undefined): Refusal | null {
  return message ? refusals.get(message) ?? null : null;
}

/**
 * Board M8 · the server refused this version of the app (426, or the code app_update_required). Every request
 * passes rawRequest, the agency's and the partner's alike, so one flag covers both and the root layout shows
 * Update needed over whichever app is open.
 */
let updateRequired = false;
const updateListeners = new Set<() => void>();
export function isUpdateRequired(status: number, code: unknown): boolean {
  return status === 426 || code === "app_update_required";
}
export function noteUpdateRequired(status: number, body: Record<string, unknown>): void {
  if (!isUpdateRequired(status, body.code) || updateRequired) return;
  updateRequired = true;
  updateListeners.forEach((l) => l());
}
export function subscribeUpdateRequired(listener: () => void): () => void {
  updateListeners.add(listener);
  return () => { updateListeners.delete(listener); };
}
export function updateRequiredNow(): boolean {
  return updateRequired;
}
/** Tests only. */
export function resetUpdateRequired(): void {
  updateRequired = false;
}

type Init = { method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown; token?: string | null; headers?: Record<string, string>; signal?: AbortSignal };

/** One request, no session handling. Throws ApiError with the server's own words. */
export async function rawRequest<T>(path: string, init: Init = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json", "x-insurvas-client": "app", ...init.headers };
  if (Platform.OS !== "web") headers["user-agent"] = USER_AGENT;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  let res: Response;
  try {
    res = await fetch(API_URL + path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: init.signal });
  } catch {
    throw new ApiError(0, {});
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    noteUpdateRequired(res.status, json);
    throw new ApiError(res.status, json);
  }
  return json as T;
}

/** The app's identifying headers, for a request that cannot use rawRequest (a multipart upload). */
export function appHeaders(): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json", "x-insurvas-client": "app" };
  if (Platform.OS !== "web") headers["user-agent"] = USER_AGENT;
  return headers;
}

/**
 * One multipart request (a photo, a scanned page, a receipt), no session handling: the same app headers as
 * rawRequest (the `InsurvasApp/` user agent the server's version check reads) and the same M8 check, so an
 * upload the server refuses as too old a version shows Update needed like any other request. The body's
 * content type (with its boundary) is left to fetch.
 */
export async function formRequest<T>(path: string, form: FormData, init: { method?: "POST" | "PATCH" | "PUT"; token?: string | null } = {}): Promise<T> {
  const headers = appHeaders();
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  let res: Response;
  try {
    res = await fetch(API_URL + path, { method: init.method ?? "POST", headers, body: form });
  } catch {
    throw new ApiError(0, {});
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    noteUpdateRequired(res.status, json);
    throw new ApiError(res.status, json);
  }
  return json as T;
}

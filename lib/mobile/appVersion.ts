/**
 * Board M8 · Update needed (mobile app, 2026-11-27). When the API changes in a way an older phone app can't
 * handle, the server answers that app with 426 Upgrade Required and the code `app_update_required`, and the
 * app shows "Update Insurvas to keep going" instead of breaking (mobile/src/components/states/update-needed.tsx).
 *
 * Opt-in: nothing is refused until MOBILE_MIN_APP_VERSION is set (e.g. "1.2.0"). Only requests that say they
 * come from the app are checked — `x-insurvas-client: app` and a user agent `InsurvasApp/<version> (...)`
 * (mobile/src/lib/api.ts). A browser, a request without a readable version (the app's web preview), and every
 * web page are never refused. Applied in proxy.ts to /api/app/** and /api/partner/**, the agency's and the
 * partner's sessions alike.
 */
export const APP_UPDATE_REQUIRED_CODE = "app_update_required";
export const APP_UPDATE_REQUIRED_MESSAGE = "Update Insurvas to keep going. This version can’t talk to the latest Insurvas.";

/** "1.2.3" → [1, 2, 3]; anything else (a pre-release tag, junk) → null. */
export function parseVersion(raw: string | null | undefined): number[] | null {
  const text = (raw ?? "").trim();
  if (!/^\d+(\.\d+){0,3}$/.test(text)) return null;
  return text.split(".").map(Number);
}

/** Negative when a < b, zero when equal, positive when a > b ("1.2" equals "1.2.0"). */
export function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The version in the app's user agent, "InsurvasApp/1.0.3 (Android)" → "1.0.3". */
export function appVersionFrom(userAgent: string | null | undefined): string | null {
  const m = /(?:^|\s)InsurvasApp\/([^\s(]+)/.exec(userAgent ?? "");
  return m ? m[1] : null;
}

/**
 * Whether this request must be told to update the app. False whenever MOBILE_MIN_APP_VERSION is unset or
 * unreadable, the request is not from the app, or its version can't be read.
 */
export function appUpdateRequired(input: { pathname: string; client: string | null; userAgent: string | null; minVersion: string | null | undefined }): boolean {
  const min = parseVersion(input.minVersion);
  if (!min) return false;
  if (!input.pathname.startsWith("/api/app/") && !input.pathname.startsWith("/api/partner/")) return false;
  if ((input.client ?? "").trim().toLowerCase() !== "app") return false;
  const version = parseVersion(appVersionFrom(input.userAgent));
  if (!version) return false;
  return compareVersions(version, min) < 0;
}

/** The 426 answer's body. */
export function appUpdateRequiredBody(minVersion: string): { error: string; code: string; minVersion: string } {
  return { error: APP_UPDATE_REQUIRED_MESSAGE, code: APP_UPDATE_REQUIRED_CODE, minVersion };
}

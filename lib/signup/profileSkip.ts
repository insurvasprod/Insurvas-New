/**
 * "Skip for now" on About you (manager review, 2026-10-28, 14:41–15:18: "he can skip business
 * information … we can get that information later on, when he logs in: first thing, complete your
 * onboarding").
 *
 * Skipping ends sign-up for this visit: a browser-session cookie lets the owner into the app now.
 * The first-login gate (Task 7) asks for the profile while the cookie is absent, and sign-in clears
 * it, so the next login asks. Nothing is written to the database.
 */
export const PROFILE_SKIPPED_COOKIE = "insurvas_profile_skipped";

/** No max-age: it ends with the browser session. HttpOnly: only the server reads it. */
export const profileSkippedCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};

export const PROFILE_SKIP_PATH = "/api/app/onboarding/business-profile/skip";

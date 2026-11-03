// Client-safe numbers the sign-in page says out loud (2026-10-24). lib/tenantAuth/session.ts signs
// the tokens with them; the page only shows them, so they live here, away from the signing key code.

/** How long an emailed sign-in link works. */
export const SIGN_IN_LINK_MINUTES = 15;

/** How long "Trust this device" skips the code on that browser. */
export const TRUSTED_DEVICE_DAYS = 30;

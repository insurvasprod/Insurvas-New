// The Insurvas web app origins this extension accepts a grant from. A grant posted by any other
// page is ignored. When you add an origin here, add it to manifest.json too (host_permissions,
// content_scripts.matches and the connect-src of content_security_policy) — see README.md.
export const APP_ORIGINS = ["http://localhost:3000", "https://app.insurvas.com"];

/** Decision 1: every grant lives exactly 60 minutes. A grant claiming longer is refused. */
export const GRANT_LIFETIME_MS = 60 * 60 * 1000;

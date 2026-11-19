# Insurvas security review and Cloudflare plan: November 2026

**Date:** 2026-11-16
**Code reviewed:** the working tree as it was on disk (branch `redesign/get-set-up-settings-r8-sign-in`, HEAD `7062092c`, plus other sessions' uncommitted changes).
**Scope:** review only. No code was changed, no SQL was applied, and no Cloudflare, Supabase or Vercel setting was touched. This report is the only file written.

## How this was checked

- **Code.** Four parallel read-only reviews covered:
  - authentication and abuse;
  - route and server-action authorization;
  - tenant isolation and sensitive data;
  - input handling and web hardening.

  Each Critical, High and Medium finding was then re-read in the code before being ranked. Some rest on a reviewer's read alone, and those are labelled so.
- **Production, read-only.** DNS lookups and GET requests to public pages and API routes, with no credentials and no sign-in attempts.
- **Database, read-only.** Catalog queries in a `begin read only` transaction over `TENANT_DB_URL`: RLS flags, policies, grants and function bodies. The Supabase MCP `get_advisors` and `execute_sql` calls were refused ("You do not have permission"), so the Supabase advisor report was **not** run.
- **Dependencies.** `npm audit --omit=dev`, then a check of each advisory against how the app uses the package.
- **No sign-in requests were sent.** Localhost sign-ins share one 5-per-15-minutes bucket.

**Labels used below:**
- **Confirmed** means it was reproduced, or read in code or the live catalog.
- **Suspected** means it depends on configuration or platform behaviour that could not be observed.
- **CF** says whether Cloudflare helps.

---

## Findings, ranked

There are no Critical findings. Nothing found gives an unauthenticated attacker another tenant's data, and every non-public route has a server-side session, role or key check (see "What is in place").

### High

#### H-1. Plaintext SSN and bank numbers on leads are returned unmasked by the lead APIs. Confirmed (code).
- **Where:**
  - Lead templates allow `ssn`, `bank_routing` and `bank_account` field types (`lib/agentTemplates/service.ts:2124`), stored as plaintext in `agent_leads.values`.
  - The lead list returns `values: (lead.values ?? {})` (`lib/agentTemplates/service.ts:1315`, `:1413`, `:3091`, `:3103`).
  - The lead workspace returns `lead: { ...lead, values: record(lead.values) }` (`lib/leadWorkspace/service.ts:154`).
  - `scrub_lead_ssn` (`supabase/migrations/20261015570000_la_3_audit_fixes.sql:207`) only clears the SSN after an application holds the encrypted copy. Bank fields on the lead are never scrubbed.
  - `/api/app/inbound/verification/reveal` reads the lead's plaintext copy, so that path writes no `tenant_sensitive_access_log` row.
- **Failure scenario:** any producer or assistant opens the leads board, and the JSON carries every SSN or bank number captured before an application exists. That skips the 2FA step-up, the typed reason and the sensitive-access log that the reveal routes enforce. The values also sit in the browser's router cache for 30 s (`staleTimes.dynamic`).
- **Evidence:** the lines above. How many live rows hold such values was not measured, because that would mean reading PII.
- **Fix:**
  1. Mask `ssn`, `bank_*` and `card_*` keys in `filterAgentLeads`, `getLeadWorkspace` and `getLeadRecord`, using `maskSensitiveValues` / `lib/verification/sensitive.ts`.
  2. Encrypt these fields at intake with `encryptSensitive`, scoped to the lead, and reveal them only through the audited reveal route.
  3. Backfill: encrypt or scrub the existing plaintext values.
- **CF:** no.
- **Status (2026-11-16): step 1 is built, uncommitted.**
  - **The helper:** `lib/leadValues/sensitive.ts`. A field is sensitive by its template type (`ssn`, `bank_routing`, `bank_account`) or by the shared key-name rule.
  - **Masked to "•••• 1234":**
    - the board list, dialer search and evidence search, CSV export, create and update responses (`lib/agentTemplates/service.ts`);
    - the lead page, including verification rows, the correction history and the timeline (`lib/leadWorkspace/service.ts`);
    - the vendor-mapping sample (`lib/leadLists/detail.ts`).
  - **Duplicate review:** sends only the keys it compares (`lib/leadDuplicates/service.ts`).
  - **Search, filter and sort:** SSN and bank fields are no longer filter or sort keys, and free-text search matches only the masked form.
  - **Saving:** a save that sends a mask back keeps the stored value (`restoreMaskedLeadValues`, run before validation).
  - **Tests:** `lib/leadValues/sensitive.test.mjs`, 10 tests.
  - **Live check** (demo tenant, dev server): the lead API, the board list (8 leads with an SSN) and the 16,393-row export return only masked SSNs.
  - **Steps 2–3 built 2026-11-17, uncommitted. Two owner steps remain.**
    - **Storage:** `lib/leadValues/seal.ts` stores SSN and bank values inside `values` as `sealed1:<last four>:<lookup>:<ciphertext>`. The cipher is AES-256-GCM under the per-tenant key from `APPLICATION_DATA_ENCRYPTION_KEY`, bound to tenant and field.
    - **Writers that seal:** hand-added and edited leads, partner and affiliate submissions, CSV and reviewed imports (`commitLeadImport`), vendor posts and the v1 API, verification corrections, and rows held for duplicate review.
    - **Readers that open:** the verification panel (masked on screen, plain only through the audited reveal) and the application prefill.
    - **Screens:** they mask from the stored last four. A sealed string sent in from the browser is treated as a mask.
    - **Duplicate check:** the partner SSN check matches sealed SSNs by a per-tenant HMAC, using migration `20261117100000_seal_lead_sensitive_values.sql`. That migration also limits the function to `service_role` (M-5). Until it is applied, the app falls back to the old plaintext-only match.
    - **Backfill:** `npm run seal:lead-values`. Dry run 2026-11-17: the key check passed, and 17 of 331,858 leads hold a plain SSN or bank value. The verification history holds none.
    - **Owner steps:**
      1. Confirm Vercel's `APPLICATION_DATA_ENCRYPTION_KEY` equals the one in `.env.local`.
      2. Deploy.
      3. Apply the migration.
      4. Run `npm run seal:lead-values -- --apply`.
    - **Not covered:** partner `form_drafts.payload`.
  - **Pre-existing, unrelated:** a stage change on a lead whose `ssn` is not on its template's form is refused with "Lead contains a hidden or unknown field". That was true before this change.

#### H-2. Production serves the staff console on the customer hosts, because `ADMIN_HOST` is not set. Confirmed (live).
- **Where:** `proxy.ts:26` (`refuseAdminOnThisHost(..., process.env.ADMIN_HOST)`), and `.env.example:15-25`, which says production MUST set `ADMIN_HOST`, `ADMIN_COOKIE_DOMAIN` and `AGENT_COOKIE_DOMAIN`.
- **Evidence (2026-11-16):**
  - `GET https://app.insurvas.com/admin/login` → `200`, `X-Matched-Path: /admin/login`.
  - The same on `https://www.insurvas.com/admin/login`.
  - `GET https://www.insurvas.com/api/admin/me` → `401` (it would be `404` if the host rule were active).
  - `admin.insurvas.com` is NXDOMAIN.
  - By contrast `SITE_HOST`/`APP_HOST` *are* set: `www…/app/login` → `308` to the app host.
- **Failure scenario:**
  - The admin login and the admin session cookie live on the same origin as the customer app, so any XSS or compromised script on `app.insurvas.com` runs in the staff console's origin.
  - The admin sign-in is reachable by every visitor and by credential-stuffing bots.
  - It cannot be put behind Cloudflare Access or IP rules without also catching customers.
  - Combined with M-2 (admin sessions cannot be revoked), a stolen staff cookie is hard to kill.
- **Fix:**
  1. Create `admin.insurvas.com` (CNAME to Vercel) and add it to the Vercel project.
  2. Set `ADMIN_HOST=admin.insurvas.com`, `ADMIN_COOKIE_DOMAIN=admin.insurvas.com` and `AGENT_COOKIE_DOMAIN=app.insurvas.com`, then redeploy.
  3. Check that `/admin/login` returns 404 on `app.` and `www.`.
  4. Then do L-14 (stop trusting `x-forwarded-host` for this rule).
- **CF:** yes, after the fix. Cloudflare Access on the admin host, and a WAF rule mirroring the host rule (Part 2, steps 4 and 7).
- **Status (2026-11-17): the code side is built, uncommitted. The settings are the owner's.**
  - **Host header:** `proxy.ts` reads the host from `Host` only, never a client-sent `X-Forwarded-Host` (`requestHostname`, `lib/adminAuth/adminHost.ts`). This closes L-14.
  - **Redirects:** with `ADMIN_HOST` set, a GET or HEAD of an `/admin` page on any other host moves (308) to the same page on the admin host, so the site footer's "Insurvas staff" link, the maintenance page link and old bookmarks still work. `/api/admin` and every write stay a 404.
  - **Alert:** the staff bar and the admin home's "Needs attention" show a critical "Staff console on the customer host" alert to super admins and platform-config staff while production runs without `ADMIN_HOST`. It also fires when a cookie domain is the shared parent (`adminHostSetupGaps`, `lib/adminAlerts/presentation.ts`).
  - **Cookie domains:** they are optional, and leaving them empty is the safer default (host-only cookies). `.env.example` now says so. It used to say they must be set, and setting `AGENT_COOKIE_DOMAIN` would also trip L-7, the logout gap.
  - **Tests:** `lib/adminAuth/adminHost.test.mjs` and `lib/adminAlerts/presentation.test.mjs`.
  - **Owner runbook, in order:**
    1. Deploy this code. Nothing changes for customers. Super admins will see the alert.
    2. Vercel → the project → Settings → Domains: add `admin.insurvas.com` to Production. Vercel shows the CNAME target for it.
    3. Google Cloud DNS, zone `insurvas.com`: add `admin` CNAME → that target. Wait until Vercel shows the domain as valid, with a certificate.
    4. Check that `https://admin.insurvas.com/admin/login` loads and staff can sign in there.
    5. Vercel → Settings → Environment Variables → Production: set `ADMIN_HOST=admin.insurvas.com`. Leave `ADMIN_COOKIE_DOMAIN` and `AGENT_COOKIE_DOMAIN` empty. Redeploy.
    6. Verify:
       - `curl -I https://app.insurvas.com/admin/login` gives `308` to `https://admin.insurvas.com/admin/login`;
       - `curl -I https://app.insurvas.com/api/admin/me` and `https://www.insurvas.com/api/admin/me` give `404`;
       - the admin host still serves `/admin`;
       - the alert is gone.
       - Staff signed in on `app.insurvas.com` sign in again on the admin host. Their old cookie stays on the app host and does nothing there.
    7. Then apply the M-2 migration (code built, see M-2 status) and, with Cloudflare, Access on `admin.insurvas.com`.

#### H-3. A second factor can be brute-forced from many IPs once the password is known. Confirmed (code).
- **Where:** `lib/authProtection/factor.ts:65-66`. For `factor === "totp"` the only bucket is `login_<plane>_email_ip` (email + IP). There is no per-account bucket that ignores the IP, and the lockout scope is also email + IP. The pending-2FA token (5 minutes) is not bound to an IP.
- **Failure scenario:**
  1. The attacker has an agent's or a staff member's password (phishing, reuse).
  2. One password sign-in gives a pending token.
  3. The attacker replays it from 1,000 IPs at 5 guesses each, about 25,000 guesses per window. At about 3 in 10⁶ per guess (±1 step), that is about 7% per 15 minutes. The code falls within hours, and a fresh pending token is one more sign-in away.
- **Why it matters here:** 2FA is the gate on SSN and bank reveals (`secondFactorBlock`), and it is mandatory for staff.
- **Fix:**
  - Add a per-account wrong-code counter that ignores the IP (for example 10 per hour), then lock 2FA and email the person.
  - Void the pending token after 5 wrong codes.
  - Bind the pending token to the IP or user-agent it was issued to.
- **CF:** partial. Rate limiting by IP cannot stop a distributed attempt; Bot management and Access (admin) raise its cost.

### Medium

#### M-1. An emailed password reset leaves existing sessions alive. Confirmed (live function body and code).
- **Where:** the live `public.consume_user_password_token` only updates `users.password_hash`, `status`, `active` and `must_reset_password`, plus the invitation row. It does not bump `session_version` or end `tenant_user_session` rows. `app/api/app/auth/set-password/route.ts:105-132` adds only `auth.admin.updateUserById`.
- **Contrast:** in-app password change does revoke (`lib/users/accountSecurity.ts:65-68`), and the partner reset does too.
- **Failure scenario:** someone who stole an agent's cookie keeps using it for up to 12 hours after the victim resets their password with "Forgot password". The trusted-device cookie also survives, because it is tied to `session_version`.
- **Fix:** in the RPC (or right after it), bump `users.session_version` and end every session row for the user.
- **CF:** no.

#### M-2. Admin sessions cannot be revoked; partner sign-out does not revoke. Confirmed (code).
- **Where:**
  - `lib/adminAuth/requireAdminRole.ts:30-42` checks only `is_active` and `role`. The admin token has no session id or version.
  - Admin logout only clears the cookie.
  - `app/api/partner/auth/logout/route.ts:5-6` only calls `cookies.delete`.
- **Failure scenario:** a copied staff cookie works for 12 hours after the person signs out or changes their password. The only kill switch is deactivating the account.
- **Fix:** add an `admin_sessions` table, or `admin_users.session_version` in the token, checked per request. Bump the partner `session_version` on logout.
- **CF:** Access on the admin host adds its own revocable session (Part 2, step 7). That helps, but it does not fix this.
- **Status (2026-11-17): the code is built, uncommitted. Migration `20261117200000_admin_session_version.sql` is not applied.**
  - **Version check:** every staff session token now carries `ver`, the admin's `session_version` when it was issued. Tokens from before this change carry none and count as 0.
    - Every API request (`resolveAdminContext`) and every page (`getCurrentAdmin`) compares the token's version with `admin_users.session_version`, and refuses a mismatch.
    - Code: `lib/adminAuth/sessionVersion.ts`. Sign-in issues the current version (`verify-2fa`).
  - **What raises the version** (ending every session of that admin at once):
    - Signing out. This now ends the admin's sessions in every browser, so a copied cookie dies with it.
    - **Sign out everywhere**, a new item in the staff table's row menu, for super admins (`POST /api/admin/admins/:id/sessions`, audited as `admin.sessions_ended`). It is not offered for your own account; sign out does that.
    - Deactivating or reactivating an account. A cookie from before a deactivation no longer comes back to life on reactivation.
  - **Raising is race-safe:** each raise is conditional on the version read, so two at once cannot skip a number. Only a live session can sign out, so an already-ended cookie can't keep signing its owner out.
  - **Partner sign-out** raises `users.session_version` the same way, which `requirePartner` already checks. Agency accounts never open the partner portal, so no agency session is affected. A partner's "remember this device" for 2FA is tied to the same version, so they enter a code at their next sign-in.
  - **Until the migration is applied:** the column is missing, and the code falls back to the old behaviour (42703 or PGRST204).
    - Signing out only clears the cookie, as before.
    - "Sign out everywhere" answers 503 with that reason.
    - Verified on the dev server with minted test-admin cookies: tokens with no version, version 0 and version 1 all still open `/api/admin/me` and `/admin/admins`.
    - No staff are signed out by applying it (default 0).
  - **Tests:** `lib/adminAuth/sessionVersion.test.mjs` (10 tests).
    - The raise, the lost race, the missing column and read errors failing closed.
    - Source guards on every gate and sign-out.
    - The behaviour after the migration is covered by those tests only. It has not been run against the live column.
  - **Owner steps:**
    1. Deploy.
    2. Paste `20261117200000_admin_session_version.sql` into the SQL editor. It ends with a check block that reports the column in place.
    3. Sign in to the console, sign out, and check that the old cookie now gets 401 on `/api/admin/me`.

#### M-3. Anyone can lock a known user out of signing in (lockout DoS). Confirmed (reviewer's code read, `lib/authProtection/index.ts`, `factor.ts:69`).
- **Where:** the per-email bucket (`login_<plane>_email`, 5 per 15 minutes) is claimed before the password is checked, from any IP, and successful attempts count too.
- **Failure scenario:** five POSTs every 15 minutes with someone's email and a wrong password keep that agent, partner or staff member out. Google sign-in and sign-in links run the same check, so they are blocked too.
- **Fix:**
  - Count failures only, per email.
  - Put the hard limit on email + IP, or on email + a device cookie.
  - Use the per-email count for step-up (Turnstile, Part 2.4) and alerts, not to block.
- **CF:** partial. Turnstile after failures (Part 2.4) is the right fix for the step-up. An edge rate limit only slows one IP.

#### M-4. Agent passwords can be tested directly against Supabase Auth, skipping the app's lockout. Suspected.
- **Where:** `lib/supabase/browser.ts:10-13` ships `NEXT_PUBLIC_SUPABASE_URL` and the publishable key, and agent passwords are verified by Supabase Auth (`app/api/app/auth/login/route.ts:60`).
- **Failure scenario:** `POST https://<project>.supabase.co/auth/v1/token?grant_type=password` checks a password without the app's per-email limit. Only Supabase's own per-IP auth limit applies, and its value was not visible. 2FA still protects enrolled users, but most are not enrolled (jordan.pike and helen.marsh are not).
- **Fix:** in the Supabase dashboard, lower the Auth sign-in rate limit and enable Supabase Auth's CAPTCHA protection (Turnstile is supported). Or move agent password checks to a server-only path that does not go through the public Auth endpoint.
- **CF:** no. That traffic goes to `*.supabase.co`, not to your zone.

#### M-5. Anon can execute 27 SECURITY DEFINER functions, and some have no caller check. Confirmed (live catalog; not exercised).
- **Where:** `has_function_privilege('anon', …)` is true for 27 `public` SECURITY DEFINER functions.
  - 14 are trigger functions, which PostgREST cannot call.
  - Most of the rest check `auth.uid()`, `private.is_org_member` or `has_permission`.
  - Five have no caller check (bodies read from `pg_get_functiondef`):

| Function | What anon can do |
|---|---|
| `release_organization_seat(target_org, target_quantity)` | Set any organization's `reserved_seats` towards 0, freeing seats beyond what was paid for |
| `record_outbound_suppression_usage(p_organization_id, p_checks)` | Inflate any organization's suppression-check usage meter (billing) |
| `release_expired_invitation_seats()` | Run housekeeping on demand (harmless but unintended) |
| `outbound_agent_campaign_allowed(agent, campaign)` | Boolean oracle on campaign assignment |
| `tenant_purge_active(jsonb)` | Boolean, harmless |

- **Precondition:** the publishable key is public, and the caller needs the target UUID. Docs/backlog #175 listed 32 such functions; some have since been revoked, and these remain.
- **Failure scenario:** `POST /rest/v1/rpc/release_organization_seat` with the publishable key and a known org id.
- **Fix:** run `revoke execute on function … from public, anon, authenticated` for every SECURITY DEFINER function not meant for PostgREST, including the trigger functions. Add a CI check that fails on any anon-executable definer function.
- **CF:** no (the call goes to Supabase).

#### M-6. No security headers. Confirmed (live and code).
- **Where:** `next.config.ts` has no `headers()`, `vercel.json` is `{}`, and `proxy.ts` sets none.
- **Evidence:** `GET https://app.insurvas.com/app/login` returns only `Strict-Transport-Security: max-age=63072000` (added by Vercel, with no `includeSubDomains`). It sends no CSP, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy` or `Permissions-Policy`, and it does send `X-Powered-By: Next.js`.
- **Failure scenario:**
  - Any future XSS (for example from a dependency) runs unrestricted.
  - The admin and app sign-in pages can be framed for clickjacking.
  - Full URLs leak through the Referer header.
- **Fix:** add `headers()` to `next.config.ts`:
  - `frame-ancestors 'none'` and `X-Frame-Options: DENY`;
  - `X-Content-Type-Options: nosniff`;
  - `Referrer-Policy: strict-origin-when-cross-origin`;
  - `Permissions-Policy` (allow the microphone for the dialer only);
  - HSTS with `includeSubDomains`;
  - a CSP shipped as `Content-Security-Policy-Report-Only` first, because of the inline theme script (`app/layout.tsx:47`), the Whop embed and, later, Turnstile;
  - `poweredByHeader: false`.
- **CF:** yes, as a fallback. Transform Rules can set these if the app does not (Part 2, step 8), but CSP belongs in the app.

#### M-7. The lead-post status callback can be aimed at internal addresses (SSRF). Confirmed (code).
- **Where:**
  - `lib/leadPost/statusCallback.ts:20` calls `fetch(callback.url, …)`.
  - The URL is only text-checked by `callbackUrlProblem` (`lib/leadPost/board.ts:367-385`). That check blocks literal private IPs and `localhost`/`.local`/`.internal`, but never resolves DNS, and it misses 100.64/10 and other reserved ranges.
- **Failure scenario:** an owner (or a hijacked owner account) sets the callback to `10.0.0.5.nip.io` or to their own domain resolving to `169.254.169.254`. Each vendor post then POSTs there, and the stored status code is shown back, which gives a blind port and host probe from the server.
- **Fix:** send the callback through the DNS-pinned `post()` and `isPrivateAddress` already used by outbound webhooks (`lib/webhooks/deliver.ts:36-58`, `lib/webhooks/rules.ts:40`).
- **CF:** no (outbound traffic).

#### M-8. The client-IP rule breaks behind Cloudflare and under `next start`. Confirmed (code; depends on deployment).
- **Where:** `lib/request/clientInfo.ts:13-20` reads `x-real-ip` first, else the last `X-Forwarded-For` hop.
- **On Vercel today:** correct, because Vercel overwrites `x-real-ip`.
- **With a Cloudflare proxy in front of Vercel:** `x-real-ip` becomes a Cloudflare edge IP (Vercel KB, 2026-11-13). Everyone behind one Cloudflare PoP then shares the 5-per-15-minutes `login_*_ip` bucket, so one attacker locks out a whole city, and audit logs record Cloudflare IPs.
- **Under `next start` with no proxy:** `x-real-ip` is client-controlled, so each request can pick a fresh per-IP bucket. This explains the shared localhost bucket `login_user_ip:::1`.
- **Fix:** the explicit `TRUST_PROXY` mode in Part 2.5. It must land **before** any Cloudflare proxying.
- **CF:** this is the Cloudflare integration point itself.

#### M-9. The partner duplicate check works as a cross-partner existence oracle. Confirmed (reviewer's code read).
- **Where:** `POST /api/partner/forms/[code]/duplicates` → `findPartnerLeadDuplicates` matches phone or SSN across the whole tenant. It returns `matched`, `matchedOn` and `submittedAt` even when the lead is not the partner's own (`yours: false`), and it has no rate limit.
- **Failure scenario:** a partner enumerates SSNs or phones to learn whether, and when, another partner of the same agency submitted that person.
- **Fix:** rate-limit the endpoint. For leads that are not the partner's own, return only "already submitted", without `matchedOn` or `submittedAt`.
- **CF:** no.

#### M-10. Realtime broadcasts use public channels. Confirmed (migrations).
- **Where:** `realtime.send(…, false)` publishes on `partner-pipeline:<partner_id>`, `partner-chat:<channel_id>`, `agent-notifications:<tenant>:<user>` and `agent-floor:<tenant>` (`20260903090000:24`, `20260903142000:11`, `20260902171000:8`).
- **Failure scenario:** anyone with the publishable key and a tenant or partner UUID can subscribe and watch event timing and ids. No row content is exposed.
- **Fix:** private channels with RLS on `realtime.messages`, or HMAC-derived topic names.
- **CF:** no.

#### M-11. A crafted spreadsheet can hang the importer. Confirmed (code).
- **Where:** `lib/ingestion/spreadsheetMl.ts:44` (`while (rows.length < Number(rowIndex) - 1) rows.push([])`) and `:52` (the same for cells). `ss:Index` has no upper bound.
- **Failure scenario:** a 100-byte `.xls` (SpreadsheetML) file with `<Row ss:Index="2000000000">` passes the magic-byte check and exhausts memory in the function. It can come from any member who uploads carrier files, or possibly by email to the Postmark inbound address. `lib/agentTemplates/xlsx.ts:105` may have the same problem with an inflated dimension (suspected).
- **Fix:** cap the row index (≤ 100k), the column index (≤ 1k) and the total number of cells.
- **CF:** no.

#### M-12. Dependencies: upgrade Next.js. Confirmed (`npm audit`), with reachability assessed.
`npm audit --omit=dev`: 1 critical, 6 high, 2 moderate. Each was checked against how the app uses the package:

| Package (installed) | Advisory | Reachable here? | Action |
|---|---|---|---|
| `next` 16.3.3 (critical) | GHSA-vcvr-r3jv-pc5j, RCE in `next/og` with attacker-controlled SVG input (fixed in 16.3.6) | **No**: the only `ImageResponse` is `app/apple-icon.tsx`, which uses a static file | Upgrade to ≥ 16.4.6 |
| | GHSA-2464-fhr4-w9xw, image-optimizer RCE via sharp/librsvg (glibc Linux) | **Suspected no on Vercel** (the platform optimizes images); yes if ever self-hosted | Upgrade next and sharp ≥ 0.35.5 |
| | GHSA-cjq9-62q9-8jv4, image-optimizer SSRF | **No**: `images.remotePatterns` is not configured | Upgrade |
| | GHSA-p3m5-59mp-jv5r, server-action DoS | **No**: there are no server actions | Upgrade |
| | `use cache` / ISR cache-poisoning advisories | **No `use cache`**; ISR on Vercel is unaffected | Upgrade |
| `nodemailer` 9.0.6 (high) | address-parser and recipient-domain bypass, SMTP DoS | **Low**: the app sends to addresses typed by members (invites) through one configured SMTP account, with no domain allow-list | Upgrade to the fixed release |
| `pdfjs-dist` 5.7.284 (high) | GHSA-hq66, script execution with `enableScripting` (viewer) | **Suspected no**: used only server-side for text extraction (`lib/ingestion/pdfText.ts:18`), with no viewer or scripting | Upgrade to ≥ 6.2.108 when convenient; keep `enableXfa: false` |
| `zod` 4.4.3 (high) | memory exhaustion on oversized constrained collections | **Yes, DoS only**: any zod-validated route with arrays | Upgrade to ≥ 4.6.6 |
| `sharp` 0.35.4, `brace-expansion`, `source-map-js` | librsvg CVE; DoS | Build or image paths; low | `npm audit fix` |

- **CF:** marginal. WAF managed rules carry some virtual patches; upgrading is the fix.

### Low

| # | Finding | Where | Status | Fix | CF |
|---|---|---|---|---|---|
| L-1 | Signup verification link signs in by GET, so link scanners or a forwarded mail open the owner session | `app/api/public/signup/verify/route.ts:12-27` | Confirmed | Token in the fragment, then a POST on a button, as the sign-in link does | No |
| L-2 | Sign-in-link single-use claim uses a fixed 1-hour window, so the jti can be claimed again later (mostly covered by `last_login_at`, but not when the first use stopped at 2FA) | `lib/tenantAuth/completeSignIn.ts:72` | Confirmed | A used-jti table | No |
| L-3 | Partner accept-invite checks a password with no `checkLoginAllowed` (needs a valid invite token) | `app/api/partner/auth/accept-invite/route.ts:69-75` | Confirmed | Apply login protection | Partial |
| L-4 | Sign-up reveals existing accounts with a 409 | `app/api/public/signup/route.ts:101,124` | Confirmed | Neutral response and a "check your inbox" email | Turnstile raises the cost |
| L-5 | Agent sign-in may reveal accounts through timing (Supabase does no hash work for unknown emails) | `app/api/app/auth/login/route.ts:60` | Suspected | Constant-time dummy work | No |
| L-6 | No bot protection on sign-up, forgot-password, sign-in link or contact. Per-email and per-IP limits exist, but rotating IPs allow about 3–5 mails per hour per victim address (email bombing) | app-wide (no Turnstile/CAPTCHA anywhere) | Confirmed | Turnstile (Part 2.4) | **Yes** |
| L-7 | Logout `cookies.delete(name)` without the domain leaves the cookie when `*_COOKIE_DOMAIN` is set (the agent row is still revoked) | `app/api/app/auth/logout/route.ts:19`, `app/api/partner/auth/logout/route.ts:6` | Confirmed | `set(name, "", {...options, maxAge: 0})` | No |
| L-8 | Cron and internal secrets compared with `!==`, with no minimum length (all fail closed when unset) | `app/api/cron/*/route.ts` (16), `app/api/internal/*` (4) | Confirmed | Reuse `same()` from `lib/ingestion/doorAuth.ts:16` and require ≥ 32 characters | **Yes** (Access service token) |
| L-9 | Checkout start, coupon and onboarding plan check the raw `role === "owner"`, so an agency "admin" title passes `refuseWithoutBilling`'s intent (onboarding only) | `app/api/app/checkout/start/route.ts:12`, `coupon/route.ts:30`, `onboarding/plan/route.ts:10-20` | Confirmed | Carry the agency title and call `refuseWithoutBilling` | No |
| L-10 | Vendor posting key accepted in the URL path, so it ends up in logs | `app/api/leads/post/[key]/route.ts:19` | Confirmed (documented legacy) | Deprecate in favour of the bearer header | No |
| L-11 | Reveal routes have no rate limit (logged, 2FA-gated) | the 4 reveal routes | Confirmed | Per-user reveals-per-hour cap and an owner alert | No |
| L-12 | Tax-ID and compliance-vendor ciphertexts have no tenant AAD and no `authTagLength` | `lib/agencyProfile/crypto.ts`, `lib/compliance/crypto.ts` | Confirmed | Tenant AAD and `authTagLength: 16`, as in `lib/applications/cryptoCore.ts` | No |
| L-13 | Legacy grants (`grant update … on tenant_users to authenticated`, `to public` policies keyed on `app.tenant_id`) are harmless only while nothing sets that GUC for anon | `20261018150000:31`; live policies on `form_drafts`, `pipeline_disposition_stages`, `tenant_template_assignments`, `tenant_template_revisions` | Suspected (defence in depth) | Revoke from anon and authenticated | No |
| L-14 | `proxy.ts` takes the host from client `x-forwarded-host` for the admin-host rule | `proxy.ts:16` | Fixed 2026-11-17, uncommitted (see H-2 status) | Use `host` only (or a platform-verified header) | Yes (the edge rewrites it) |
| L-15 | Consent certificate URLs from vendor data are stored without a scheme check (React 19 blocks `javascript:` today) | `lib/consent/capture.ts:93` | Confirmed | Require `https:` | No |
| L-16 | 52 write routes parse JSON with no schema (hand checks downstream) | e.g. `app/api/app/templates/[id]/webhook/route.ts:30` | Confirmed | `z.object(...).strict()` | No |
| L-17 | Expense, invoice, W-9, complaint and chat uploads trust the browser's MIME type (served via signed Supabase URLs on Supabase's domain) | those upload routes | Confirmed | Magic-byte check | No |
| L-18 | Inbound email processes attachments from any sender (the Basic-auth webhook is fine) | `lib/ingestion/registry.ts:237-258` | Info | Hold attachments from unknown senders for review | No |
| L-19 | `lib/supabase/service.ts` lacks `import "server-only"` (no client import found today) | `lib/supabase/service.ts` | Confirmed | Add it | No |
| L-20 | Apex `insurvas.com` has no A record (`curl` cannot resolve it) | DNS | Confirmed | Point it at Vercel (or Cloudflare) and redirect to www | n/a |

---

## What is in place (verified)

**Authentication**
- Three separate signing keys. Plane separation is enforced by audience/`partnerId`/`stage` claims and by membership checks (`lib/tenantAuth/session.ts:92`, `lib/partnerAuth/session.ts:52-55`, `lib/adminAuth/session.ts:430`).
- Agent sessions are checked against a DB row, `session_version`, user status and tenant suspension on every request (`requireTenant.ts:108-124`). "Sign out everywhere" really revokes.
- Session cookies are `httpOnly`, `SameSite=Lax` and `Secure` in production. No token is readable by JavaScript or placed in a URL.
- The password-only step yields a 5-minute pending token that is not a session. TOTP replay is blocked per time step. Recovery codes are hashed and single-use. Admin 2FA is mandatory.
- Trusted-device cookies are signed and tied to the user, `session_version` and the authenticator's `enabled_at`.
- Google sign-in uses PKCE with an httpOnly flow cookie and requires `email_verified`.
- Invite and reset tokens are 32 random bytes, stored as SHA-256, with an expiry, and used up atomically.
- Admin and partner sign-ins use a dummy bcrypt hash for unknown emails.
- Forgot-password and sign-in-link requests return the same response whether or not the account exists, and send after the response.
- The rate-limit store is shared through the database (`claim_rate_limit`). Login protection fails closed.

**Authorization**
- 621 route files and no server actions. 409 of 431 `/api/app` routes use `requireFeatureRole`/`requireTenant`; the remaining 22 are auth, onboarding, checkout (signup context) or extension-bearer routes.
- Every `/api/partner` non-auth route uses `requirePartner`.
- Admin routes re-read `is_active` and the role per request. Destructive admin routes are `super_admin` only.

**Tenant isolation**
- About 50 handlers taking an id were traced into their services. All filter `tenant_id` from the session (or use a `p_tenant_id` RPC). No route takes `tenant_id` from the body.
- Partner reads also filter `partner_id` and mask SSN and bank keys.

**Data and storage**
- Application data is encrypted with AES-256-GCM, a random IV, a per-tenant HKDF key, an AAD of tenant|application|field, and a key version (`lib/applications/cryptoCore.ts`).
- Reveal routes require 2FA in the current session and a typed reason, and write an access-log row and an audit row before returning the value.
- All 11 storage buckets are private. Every signed URL is issued after a tenant-filtered row read, with TTLs of 60–300 s.

**RLS and grants**
- RLS is on for 663 of 681 public tables. The 18 without it are `billing_waivers`, `state_timezones` and 16 `raw_rows_p*` partitions, all with no anon or authenticated privileges (verified live).
- `using (true)` policies for `authenticated` exist only on the global lookup tables (`feature_flags`, `permissions`, `role_permissions`, `roles`).
- The 12 public views readable by anon are all `security_invoker=true`.

**Integrations**
- Whop webhooks: HMAC over `id.timestamp.body`, constant-time compare, ±300 s window, raw body, fail closed, idempotent.
- Postmark inbound: constant-time Basic auth with minimum lengths.
- v1 API keys are `isk_` + 32 bytes, stored hashed, scoped, revocable, limited to 120 per minute, with sensitive fields stripped.
- Vendor keys are stored hashed and rate-limited.
- Browser-extension grants: a 60-minute JWT with issuer, audience and algorithm pinned, one carrier origin, re-checked per request. CORS echoes only that origin, without credentials, and that is the only CORS anywhere.
- Outbound webhooks use https on port 443 only, with a DNS-pinned private-IP block and no redirects.

**Input handling**
- Cross-site writes are refused by the Origin check (`lib/security/originCheck.ts`).
- The one raw `pg` use is parameterised. PostgREST `.or()` values are escaped or whitelisted.
- No unsafe HTML sinks receive user data. Email HTML is escaped.
- CSV exports have a formula-injection guard. Every upload has a size limit, and most have magic-byte checks. Storage paths are sanitised.
- Email links are built from configuration, never from the request host.

---

## Part 2: Cloudflare

### 2.1 What is in front of the app today (checked 2026-11-16, read-only)

| Check | Result |
|---|---|
| Nameservers for insurvas.com | `ns-cloud-e1..e4.googledomains.com` (Google Cloud DNS). **Not a Cloudflare zone.** |
| `app.insurvas.com` | CNAME `ed6fc8d340c49d1a.vercel-dns-017.com` → 64.29.17.65 / 216.198.79.65 (Vercel) |
| `www.insurvas.com` | CNAME `822043b168b01741.vercel-dns-017.com` (Vercel) |
| `insurvas.com` (apex) | No A record; `curl` cannot resolve it |
| `admin.insurvas.com` | NXDOMAIN |
| Response headers (`/app/login`) | `Server: Vercel`, `X-Vercel-Id: fra1::iad1::…`, HSTS `max-age=63072000`, `X-Powered-By: Next.js`. No `cf-ray` and no `Server: cloudflare`. No CSP, XFO, nosniff, Referrer-Policy or Permissions-Policy. |
| Env vars | No `TURNSTILE_*`, `CLOUDFLARE_*` or `CF_*` in `.env.example` or `.env.local`. `SITE_HOST`/`APP_HOST` are live; `ADMIN_HOST` is not (H-2). |
| Repo | No `wrangler.*` and no CAPTCHA of any kind |

**Conclusion:** Cloudflare is not in front of Insurvas. Hosting is Vercel (Frankfurt edge, `iad1` functions), DNS is Google Cloud DNS, and data is on Supabase.

### 2.2 The architectural choice that comes first

Vercel's guidance (KB "Using Cloudflare and other reverse proxies with Vercel", updated 2026-11-13) is to connect directly where possible. Proxying through Cloudflare (orange cloud) in front of Vercel has known costs:
- Vercel's DDoS mitigation and Bot Protection lose their client signals. Vercel's managed bot ruleset "does not work" behind a proxy and can challenge real users who share Cloudflare's egress IPs.
- Without Vercel **Verified Proxy** (Lite on all plans for supported providers, Advanced on Enterprise), `x-real-ip` becomes a Cloudflare IP, which is M-8.
- Two caches, so there can be stale HTML or assets after deploys unless Cloudflare bypasses HTML.
- SSL must be Full (strict), because Flexible loops. HTTP-01 on port 80 must still reach Vercel for certificate renewal.

| Option | What it is | When |
|---|---|---|
| **A. Turnstile only, no proxy (recommended first)** | DNS stays on Google and traffic stays direct to Vercel. Add Turnstile (free, no zone needed) to the abuse-prone forms, Vercel Firewall rules for edge rate limits, and headers in `next.config.ts`. | Most of the abuse protection with no routing risk |
| **B. Full Cloudflare proxy** | Move the zone to Cloudflare, proxy `app`/`www`/apex/`admin`, set up Verified Proxy (or the edge-secret rule in 2.5), then WAF, rate limiting, Super Bot Fight Mode and Access. | When you want edge WAF, rate limits and Access for `/admin`, and accept the Vercel caveats. 2.5 must ship before go-live. |

### 2.3 Rollout, in order

**Step 0: app changes before any proxy (both options)**
1. Fix `trustedClientIp` for the chosen topology (2.5, M-8).
2. Add security headers in `next.config.ts` (M-6).
3. Create `admin.insurvas.com` and set `ADMIN_HOST`, `ADMIN_COOKIE_DOMAIN` and `AGENT_COOKIE_DOMAIN` (H-2). This is a precondition for Access.

**Step 1: Turnstile (option A or B)**
See 2.4.

**Step 2: move DNS and proxy, observe only (B)**
- Add the zone, import the records, and proxy `app`, `www`, the apex and `admin`. SSL/TLS Full (strict), Always Use HTTPS, minimum TLS 1.2.
- Cache Rule: bypass the cache for everything except `/_next/static/*` and `/brand/*`.
- Vercel: enable Verified Proxy for Cloudflare if it is a supported Lite provider on your plan. Otherwise use the edge-secret header in 2.5.
- Origin lock:
  - A Cloudflare request-header Transform Rule sets `x-insurvas-edge: <random secret>`.
  - After cut-over, `proxy.ts` refuses `/app`, `/partner`, `/admin` and `/api` without it.
  - Turn off the public `*.vercel.app` production alias, or protect it with Vercel Deployment Protection, so nobody can go around Cloudflare.
- Run every rule below in **Log** mode (or Managed Challenge at low volume) for a week before switching it to Block.

**Step 3: WAF managed rules (B)**
- Cloudflare Managed Ruleset on (Free gets the Free Managed Ruleset).
- On Pro and above, OWASP Core Ruleset at paranoia level 1 with a Medium anomaly threshold: Managed Challenge on HTML, Block on `/api/*`.
- **Skip managed rules** for machine routes that authenticate themselves and carry unusual bodies:
  - `/api/webhooks/*` (Whop, Postmark inbound);
  - `/api/cron/*` and `/api/internal/*`;
  - `/api/v1/*`, `/api/post/*` and `/api/leads/*`;
  - the carrier-file, statement and CSV upload routes, where spreadsheet bodies cause false positives.

**Step 4: WAF custom rules (B)**
1. **Admin only on its host:** `(starts_with(http.request.uri.path, "/admin") or starts_with(http.request.uri.path, "/api/admin/")) and http.host ne "admin.insurvas.com"` → Block. This mirrors the H-2 fix at the edge.
2. **Auth routes take POST only:** `http.request.uri.path matches "^/api/(app|partner|admin)/auth/" and not http.request.method in {"POST" "GET"}` → Block. Adjust to the methods each route actually serves.
3. **Cron and internal routes only from the scheduler:** `/api/cron/*`, `/api/internal/*` and `/api/maintenance/*` without the Access service-token headers → Block. Step 7 adds Access itself.
4. **Body size on auth (Pro and above):** `starts_with(http.request.uri.path, "/api/") and http.request.uri.path contains "/auth/" and http.request.body.size gt 16384` → Block.
5. **Optional geo (owner's call):** Managed Challenge on sign-in, sign-up and forgot-password from outside the markets you serve.

**Step 5: rate-limiting rules (B), matched to the app's own limits**

The app allows 5 sign-in attempts per 15 minutes per IP and per email (successes count), sign-up 10 per IP and 3 per email per hour, the sign-in link 5 per email and 20 per IP per hour, and contact 5 per IP and 3 per email per hour.

Cloudflare plan limits:
- **Free:** 1 rule, a 10 s period, a 10 s timeout, counting by IP.
- **Pro:** 2 rules, periods up to 1 minute, timeouts up to 1 hour, counting by IP.
- **Business:** 5 rules, periods up to 10 minutes.
- Counting by an email body field needs Enterprise.

So the edge rule is a coarse cap on bursts, and the app keeps the exact per-account windows. Set the edge a little above the app's limit, so normal users see the app's own "too many attempts" message.

| Rule | Expression | Pro | Free |
|---|---|---|---|
| RL-1 auth | `http.request.method eq "POST" and (http.request.uri.path matches "^/api/(app|partner|admin)/auth/(login|verify-2fa|forgot-password|sign-in-link|set-password|accept-invite)$" or http.request.uri.path matches "^/api/public/(signup|contact)")` | 10 per 1 minute per IP → Block 1 hour | 5 per 10 s per IP → Block 10 s |
| RL-2 (Pro, 2nd rule) | `http.request.method eq "POST" and starts_with(http.request.uri.path, "/api/public/")` | 5 per 1 minute per IP → Managed Challenge 10 minutes | (folded into RL-1) |
| RL-3 (Business) | `/api/v1/*`, `/api/post/*`, `/api/leads/*` | 600 per 1 minute per IP → Block 1 minute | n/a |

**Step 6: bots (B)**
- **Pro or Business: Super Bot Fight Mode.**
  - Definitely automated → Block.
  - Likely automated → Managed Challenge.
  - Verified bots → Allow.
  - JavaScript detections on.
  - The product "may challenge API or mobile app traffic", so add SBFM Skip rules for `/api/webhooks/*`, `/api/cron/*`, `/api/internal/*`, `/api/v1/*`, `/api/post/*`, `/api/leads/*` and `/api/app/extension/*` (the browser extension).
- **Free:** Bot Fight Mode cannot be tuned through WAF rules, and it would hit webhooks and API-key lead posts. Leave it off and rely on Turnstile.

**Step 7: Access for /admin and cron (cloudflare-one; B)**
- **Admin host:** a self-hosted Access application covering all of `admin.insurvas.com`.
  - Policy: Allow, Include emails ending `@insurvas.com` (or an IdP group "Insurvas staff"), Require MFA.
  - Session duration 8 hours.
  - The app's own password and TOTP stay.
  - The app should also validate `Cf-Access-Jwt-Assertion` (team JWKS + AUD tag) on `/admin` and `/api/admin`, so the gate holds even if the origin is reached directly.
  - Access sessions can be revoked centrally, which softens M-2 until it is fixed.
- **Cron:** a second Access application for `app.insurvas.com/api/cron/*`, `/api/internal/*` and `/api/maintenance/*`, with a **Service Auth** policy for one service token.
  - The scheduler sends `CF-Access-Client-Id` and `CF-Access-Client-Secret`. For Supabase `pg_cron` + `net.http_post`, add both headers there.
  - Keep `CRON_SECRET` as a second check and fix L-8.
  - mTLS is only an option for callers that can present a client certificate (pg_net cannot), so prefer service tokens.

**Step 8: security headers through Transform Rules (fallback only)**
Only if the app cannot ship its own headers. Use a response-header Transform Rule to set:
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- `X-Frame-Options: DENY`;
- `Permissions-Policy: camera=(), geolocation=(), microphone=(self)`;
- removal of `X-Powered-By`.

CSP stays in the app.

### 2.4 Turnstile plan (turnstile-spin contract; option A or B)

**Widget and secrets**
- One managed-mode widget for the domains `app.insurvas.com`, `admin.insurvas.com` (once it exists), `localhost` and `127.0.0.1`.
- `TURNSTILE_SECRET` lives in the Vercel env.
- Production `TURNSTILE_HOSTNAMES=app.insurvas.com,admin.insurvas.com`, never with localhost. `.env.local` uses `localhost,127.0.0.1`.
- The sitekey goes in `NEXT_PUBLIC_TURNSTILE_SITEKEY`, which is public by design.

| Surface | Action | Frontend | Server: Siteverify at the top of the existing handler | When |
|---|---|---|---|---|
| Sign-up | `signup` | sign-up form (final submit) | `app/api/public/signup` (and `signup/google` start) | always |
| Agent forgot-password | `forgot_password` | `/app/login` forgot form | `app/api/app/auth/forgot-password` | always |
| Agent sign-in link request | `signin_link` | `/app/login` "email me a link" | `app/api/app/auth/sign-in-link` | always |
| Agent password sign-in | `login` | `/app/login` | `app/api/app/auth/login` | **after failures:** once the per-email or per-IP failure count reaches 2 (below the block at 5), the route answers `{ requireTurnstile: true }`; the client then renders the widget and resends with the token. This is also the fix for M-3. |
| Partner sign-in and forgot-password | `partner_login`, `partner_forgot` | `/partner/login` | `app/api/partner/auth/login`, `…/forgot-password` | the same as the agent plane |
| Admin sign-in | `admin_login` | `/admin/login` | `app/api/admin/auth/login` | always (low volume) |
| Contact form | `contact` | landing contact section | `app/api/public/contact` | always |
| (Supabase Auth) | n/a | n/a | Enable Supabase Auth CAPTCHA with the same widget | for M-4 |

**Server contract (one helper, `lib/security/turnstile.ts`, called by each route)**
1. Read `cf-turnstile-response` from the JSON body.
2. Refuse if it is missing, not a string or longer than 2,048 characters, or if `TURNSTILE_HOSTNAMES` is empty.
3. POST to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with `secret`, `response` and `remoteip` (the client IP from 2.5), with a 10 s timeout.
4. **Fail closed** on a network error or a non-2xx response.
5. Require `success === true`, `action === <expected>` and `hostname ∈ TURNSTILE_HOSTNAMES`.
6. Only then run the existing handler, unchanged.

**Browser side**
- Tokens are single-use. Render the widget explicitly and call `turnstile.reset(widgetId)` after every request, because these forms stay on the page after an error.
- When the CSP lands, allow `https://challenges.cloudflare.com` in `script-src` and `frame-src`.

**Validation (when built)**
- A real token passes once, and a replay of it is refused.
- A token minted for `login` is refused by `forgot-password`.

### 2.5 Real client IP

```ts
// lib/request/clientInfo.ts. TRUST_PROXY is set per deployment: "vercel" | "cloudflare" | "none".
export function trustedClientIp(headers: Headers): string | null {
  const mode = process.env.TRUST_PROXY ?? "vercel";
  if (mode === "cloudflare") {
    // Trust CF-Connecting-IP only when the request provably came through our zone: the secret
    // header a Cloudflare Transform Rule adds (constant-time compare), or Vercel Verified Proxy.
    if (sameSecret(headers.get("x-insurvas-edge"), process.env.EDGE_SECRET)) return headers.get("cf-connecting-ip");
    return null; // reached the origin around Cloudflare: no trusted IP, so per-account limits apply
  }
  if (mode === "vercel") return headers.get("x-real-ip"); // written by Vercel's edge
  return null; // "none" (bare `next start`): no header is trustworthy
}
```

- **Remove the `X-Forwarded-For` fallback.** Never read `True-Client-IP` or the first XFF hop.
- **Why CF-Connecting-IP needs a gate:** Cloudflare sets it from the connecting socket on proxied traffic, but anyone who reaches the Vercel origin directly can send their own value. Hence the edge secret (or Verified Proxy), which also defends the origin lock in Step 2.
- **Callers that get `null`:** they must still apply the per-account limits, so an unknown IP is never a free pass.
- **Local development:** use `TRUST_PROXY=none`. Every localhost sign-in then shares the per-account buckets only, which also ends the shared `login_user_ip:::1` lock-out.

### 2.6 What Cloudflare cannot fix

Do not count any of these as covered by Cloudflare:
- **Authorization and tenant isolation:** H-1 (unmasked lead SSN and bank data), M-9 (the partner oracle), role checks (L-9), and IDOR in general.
- **Supabase traffic, which never passes through your zone:**
  - PostgREST RPCs: M-5 (anon definer functions);
  - Realtime: M-10;
  - Supabase Auth's password endpoint: M-4.
- **RLS and service-role query discipline.**
- **Session design:** M-1 (reset does not revoke), M-2 (admin and partner revocation), H-3 (the TOTP per-account limit; edge IP limits cannot stop a distributed attack).
- **Data handling:** encryption (L-12), reveal limits (L-11) and logging.
- **Server-side bugs:** SSRF in outbound callbacks (M-7), parser DoS from authenticated uploads (M-11), and dependency upgrades (M-12).

---

## Top five actions

1. **Mask and encrypt SSN and bank values on leads (H-1).** Mask them in the lead list and workspace APIs now, then encrypt them at intake and backfill the existing plaintext. This is the one place where regulated data leaves without 2FA or an audit trail.
2. **Put the staff console on its own host (H-2).** Create `admin.insurvas.com` and set `ADMIN_HOST`, `ADMIN_COOKIE_DOMAIN` and `AGENT_COOKIE_DOMAIN` in Vercel. Then make admin sessions revocable (M-2), and put Cloudflare Access in front once the zone is proxied.
3. **Harden the second factor and session revocation.** Add a per-account TOTP failure limit that ignores the IP, and void pending tokens after failures (H-3). End all sessions on an emailed password reset (M-1). Count only failures in the per-email lockout, and step up with Turnstile instead of blocking (M-3).
4. **Close the Supabase-side gaps Cloudflare can't see.**
   - Revoke anon and authenticated EXECUTE on the SECURITY DEFINER functions (M-5): `release_organization_seat`, `record_outbound_suppression_usage` and the trigger functions.
   - Tighten Supabase Auth's sign-in rate limit and turn on its CAPTCHA (M-4).
   - Move Realtime to private channels (M-10).
5. **Ship the cheap hardening together.**
   - Security headers in `next.config.ts`, with CSP in report-only first (M-6).
   - Turnstile on sign-up, forgot-password, the sign-in link, contact, and sign-in after failures (Part 2.4).
   - Upgrade Next.js to ≥ 16.4.6, plus zod, nodemailer and sharp (M-12).
   - Fix the client-IP trust rule before any Cloudflare proxy goes live (M-8, Part 2.5).

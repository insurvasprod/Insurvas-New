# LA-2.22 / LA-2.23 implementation and QA review

Date: 2026-09-13

## Scope checked

The authoritative task pages were checked before implementation:

- LA-2.22 covers entitlement-backed outbound limits for setter seats, active campaigns,
  monthly imports, DNC scrub lookups, and consent claims. Enforcement must be server-side,
  with a hard scrub-credit stop before an unscrubbed lead can become dialable.
- LA-2.23 covers versioned campaign/default scripts, resolved live-lead variables, searchable
  one-click rebuttals, platform-owned state/product disclosures, and confirmation stored on the
  call attempt. AI prompting, transcription, recording/scoring, and A/B attribution remain out
  of scope.

## Implementation map

| Area | Implementation |
|---|---|
| Entitlement limits | `lib/metering/outbound.ts`, plan-limit editor/types, `20260913470000_la_2_22_outbound_limits.sql` |
| Import safety | `lib/agentTemplates/service.ts`, `/api/app/leads/import`, import usage card |
| Seat/campaign guards | `/api/app/team`, `/api/app/team/[userId]`, `/api/app/campaigns`, campaign status route, database constraint triggers |
| Consent metering | `lib/compliance/consentClaims.ts`, `/api/app/compliance/consent/claim` |
| Scripts/rebuttals/disclosures | `lib/dialerScripts/service.ts`, `20260913480000_la_2_23_scripts_rebuttals_disclosures.sql` |
| Dialer | `/app/dialer`, `components/app/dialer-workspace.tsx`, attempt/disclosure/click/disposition routes |
| Route authorization | `lib/entitlements/agentApiPolicy.ts`, tenant money-route classification tests |

## Functional and security review findings resolved

1. Import now preflights the entire batch against monthly-import and scrub meters, screens every
   row before insertion, uses an atomic idempotent operation for concurrent DNC cap enforcement,
   and records only newly created usage with an idempotency key.
2. Setter and active-campaign caps are checked by the API and protected by database constraint
   triggers, so direct mutation cannot bypass the limits. Paused campaigns are excluded from the
   active count.
3. Starting an attempt verifies that the lead belongs to the authenticated tenant. Disclosure
   confirmation is bound to the attempt's stored state/product and to an effective platform
   disclosure. Dial and disposition mutations refuse unconfirmed attempts.
4. The dialer editor creates a new script version and reloads it for the next panel request; the
   call panel remains independently scrollable from phone/disposition controls.

## QA evidence

Passed:

- `node --experimental-strip-types --test "lib/outboundLimits/la222223.test.mjs"` — 4 passing.
- `npm test` — 462 passing, 0 failing.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; Next generated 204 pages.
- `npm run db:check` — all migration files parsed.
- `git diff --check` was attempted but is not a useful clean-tree signal here because the
  pre-existing workspace changes use CRLF and are already reported as trailing whitespace.

## Runtime limitation

`supabase db lint --local` and authenticated tenant/browser acceptance checks require a running
local Supabase instance. The configured endpoint has been unavailable at
`127.0.0.1:54322` (`ECONNREFUSED`), so SQL execution, real 403 responses, RLS isolation, and
real state-disclosure confirmation are not claimed as live-verified. The migration parser and
static contract suite do pass, and missing approved disclosure data intentionally blocks dialing
until Compliance supplies reviewed state/product wording.

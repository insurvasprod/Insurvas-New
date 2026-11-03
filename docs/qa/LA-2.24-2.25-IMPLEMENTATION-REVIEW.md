# LA-2.24 / LA-2.25 implementation and QA review

Date: 2026-09-13

## Scope checked

The authoritative Notion page for LA-2.24 defines deterministic lead assignment by campaign,
state, language, product and fallback; capacity enforcement; licensing as a hard constraint;
unassigned-pool and inactive-user recovery; reassignment reasons; rest days between owners; and
sticky mid-conversation ownership. It explicitly excludes skill routing beyond language/product,
performance weighting, shift-aware routing, and automatic rebalancing of already assigned leads.

No authoritative LA-2.25 page or task record was found. Its goal, in-scope, and acceptance criteria
remain intentionally unimplemented until the direct task page or an authoritative acceptance contract
is supplied.

## Implementation map

| Area | Implementation |
|---|---|
| Rule and capacity data | `20260913490000_la_2_24_lead_assignment_rules.sql` |
| Transactional assignment | `assign_lead`, `assignment_candidate_is_eligible`, capacity row locking and live recount |
| Licensing | Existing `public.can_write()` reused for every owner/producer candidate |
| Sticky ownership and audit | `lead_assignment_events`, active undispositioned-owner short circuit, reason-required reassignment |
| Pool recovery | `return_lead_to_assignment_pool` and `users_return_inactive_assignments` trigger |
| Runtime API | `app/api/app/assignments/route.ts`, `lib/assignment/service.ts` |
| Operator surface | `/app/assignments`, rule editor, capacity controls, pool actions and manager reassignment |
| Authorization | `requireFeatureRole`, manager-only rule/capacity writes, tenant-scoped RLS and service-only RPCs |

## Functional and code review

The assignment decision is made inside the database transaction. A candidate must be an accepted,
active tenant owner/producer/setter; owner/producer candidates must pass `can_write` for the lead
state; term-life assignment is licensed-only; capacity is locked and recounted before selection;
the first active matching rule is selected by `priority, id`; and fallback rotation advances after
the previously selected assignee. Household/phone rest days, sticky ownership, explicit reasons,
and inactive-account return are all represented in persisted data rather than UI-only state.

The API exposes mutable rules and capacity settings, so a saved rule is read on the next assignment
call without a deploy. The operator page is tenant-authenticated and keeps rule management limited
to owners/producers while allowing eligible pool actions for the working roles.

## QA evidence

Live database promotion update (2026-09-14): `20260913490000_la_2_24_lead_assignment_rules.sql`
was applied to the authorized Supabase project. The migration initially exposed a PostgreSQL
compatibility error in `jsonb_object_length`; the local check was corrected to a valid empty-JSONB
comparison and the corrected migration then applied successfully. The live tenant-access, trigger,
RPC, and LA-1 security inventories are green. Authenticated assignment browser evidence remains
open, and LA-2.25 remains unimplemented because no authoritative task definition was found.

Passed:

- `node --test lib/assignment/la224.test.mjs` — 6 passing.
- `npm test` — 468 passing, 0 failing.
- `npm run build` — production build completed and `/app/assignments` is present in the route output.
- `npm run db:check` — every migration parsed, including LA-2.24.
- `npm run typecheck` — passed.
- `npm run lint` — passed after the React state/mutation review fixes.

Not available in this workspace:

- Authenticated RLS isolation and browser rule/capacity/licensing scenarios.
- Browser proof of `/app/assignments` with an authenticated tenant and live data.

`npx supabase db lint --local` and authenticated browser scenarios remain unavailable because the
local Supabase endpoint at `127.0.0.1:54322` is not running (`ECONNREFUSED`). The live MCP promotion
and focused live inventories above provide the database evidence; the fast migration parser also
passes the complete local file set. LA-2.25 is separately blocked by missing authoritative scope,
not by an implementation error. Unauthenticated HTTP smoke testing returns `307 /app/login` for
running local production instances, so protected browser proof is not claimed.

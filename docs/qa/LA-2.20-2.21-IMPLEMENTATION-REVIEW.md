# LA-2.20 / LA-2.21 implementation review

Date: 2026-09-13

## Outcome

LA-2.20 adds campaign-scoped lead recycling and nurture reactivation. LA-2.21 adds an immutable
served-lead activity log, server-side filters/export, setter-scoped scorecards, and explicit
integrity flags. The implementation is complete in the repository and passes static application
checks. Runtime migration and authenticated proof are blocked by the unavailable local Supabase
endpoint.

## Functional review

### LA-2.20

- `reactivate_nurture` selects only aged, allowed-disposition leads under the campaign recycle cap.
- The operation resets serving attempts but keeps `tenant_call_attempts` and exposes them through
  `lead_attempt_history` on lead detail.
- Suppression is checked before queueing and every queued lead is screened again before the campaign
  transitions from `scrubbing` to `scrubbed`. DNC and TCPA-litigator results are suppressed and
  remain exhausted.
- Import matches normalized phone identity, reuses the existing lead, and records each campaign
  source and its cost in `tenant_lead_sources`.
- `tenant_recycle_performance` labels activity as fresh or recycled and returns separate contact rates.

### LA-2.21

- A queue claim creates a served event; an attempt updates the matching activity row. Click time is
  only populated by a real click timestamp, so a disposition without a click is not disguised.
- The report returns separate served, clicked, and logged counts, plus zero-click, never-dispositioned,
  and impossibly-fast integrity flags.
- Activity export intentionally bypasses pagination while preserving tenant, role, agent, campaign,
  disposition, and date filters. Normal reads are indexed and page-size capped.
- Setter report calls are forced to the authenticated setter's own agent ID. The UI says
  `card_open_seconds` and does not expose a talk-time metric.

## Code/security review

- New RPCs are security definer functions with a fixed `public` search path and explicit grants.
- Tenant IDs are present in all new tables and RPC predicates; tenant-facing table access is RLS-scoped.
- Mutating RPCs are service-role-only; application routes enforce feature and role checks before calling
  the service layer.
- CSV cells are quoted and formula-prefixed values are neutralized to prevent spreadsheet formula injection.
- No credentials were created, transmitted, or stored during QA.

## QA evidence

Passed:

- `npm run typecheck`
- `npm run lint`
- `node --experimental-strip-types --test "lib/nurture/*.test.mjs" "lib/activityLog/*.test.mjs"`
- `npm test`
- `npm run build`
- Protected-route browser smoke check: `/app/activity` and `/app/nurture` redirect to `/app/login`
  without an authenticated session.

Blocked or limited:

- `npx supabase db lint --local` cannot connect because `127.0.0.1:54322` is unavailable; therefore
  the new SQL cannot receive live Postgres execution proof in this workspace.
- Authenticated tenant, setter-isolation, reactivation/suppression, 100k-row pagination, and complete
  CSV row-count checks require a reachable disposable Supabase environment and test identities.
- Linked lint is not evidence for these migrations because the remote schema does not contain this
  un-applied work; its reported legacy warnings are recorded separately and were not attributed here.

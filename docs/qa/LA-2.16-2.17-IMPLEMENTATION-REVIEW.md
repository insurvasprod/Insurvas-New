# LA-2.16 / LA-2.17 implementation review

Reviewed 2026-09-13 against the current repository decision log and the Insurvas Sprint task goals.

## Scope decision

LA-2.16 is cancelled by Decision 16. It duplicates the carrier autofill and field-map work now
owned by LA-3.12 / LA-3.13 / LA-3.14. No extension, content script, carrier allowlist, or autofill
surface is introduced here. The safety rules remain explicit in the decision record: allowlist-only,
never guess, and fill-never-submit.

LA-2.17 remains active. In simple words: show Ray which vendor and campaign is worth buying from
again, using the complete attribution chain and the cost of an actually issued policy.

## LA-2.17 acceptance review

| Area | Result | Evidence |
|---|---|---|
| Vendor/campaign scorecard | PASS locally | `tenant_vendor_scorecard_report` and the `/app/true-cpa` workspace group campaigns by tenant vendor. |
| Gross, credits, net/effective cost | PASS locally | Campaign spend and credits are read live; net cost and CPA are calculated from those source values. |
| Lead → application → deal → issued policy attribution | PASS locally by design | `tenant_issued_policies` stores the attribution snapshot and a trigger rejects cross-tenant or conflicting campaign hops. |
| Date/vendor/campaign/product filters | PASS locally | API validates dates and UUIDs; the UI exposes all four filters. |
| Drill-through | PASS locally | `/api/app/true-cpa/leads` returns operational counts only and the UI links each lead to its tenant lead workspace. |
| Contact rate by slot | PASS locally by design | The live report returns `contact_rate_by_slot`; no talk-time metric is queried or rendered. |
| Attempts-to-contact curve | PASS locally by design | The live report returns `attempts_to_contact` grouped by attempt number. |
| CSV export safety | PASS locally | Export formula-neutralizes cells and excludes personal, banking, SSN, and policy-number fields. |
| Tenant and role enforcement | PASS locally by design | Page and both APIs require `true_cpa` plus owner/producer/bookkeeper; database policy is tenant-scoped. |
| No nightly snapshot | PASS locally | The migration creates no snapshot table; the report is live and marks `snapshot: false`. |
| Under-two-second 12-month performance | NOT PROVEN | Requires the migration deployed and an authenticated tenant dataset of representative size. |

## Verification boundary

Local typecheck, lint, focused scorecard tests, full repository tests, and production build passed.
The protected route redirected to `/app/login` in both available browser surfaces, with no console
errors on the login page. Authenticated scorecard rendering and live Supabase migration execution
remain unproven because no browser session was signed in, local Postgres/Docker was unavailable, and
the linked project has migration-history drift plus pre-existing database lint errors. No shared
database migration was pushed or repaired.

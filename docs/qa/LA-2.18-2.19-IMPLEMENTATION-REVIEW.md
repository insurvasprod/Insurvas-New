# LA-2.18 / LA-2.19 implementation review

Reviewed 2026-09-13 against the current Insurvas Sprint task pages and the repository decision log.

## Scope decision

LA-2.18 compares two campaigns or two periods of one campaign. It refuses unequal periods or different
starting weekdays, shows both funnel volumes, lets Ray choose contact rate, issued conversion, or cost
per issued policy, and uses plain-English confidence language. Different observed volumes produce an
explicit size warning, and extreme rate samples are handled without a divide-by-zero failure. It does
not select a winner, run an A/B test, or move budget.

LA-2.19 prepares vendor-return claims from the evidence already recorded by screening and dialing. It
keeps the claim inside the tenant, stores evidence rows, exports a vendor-ready CSV summary, and only
updates campaign credits when a user records an accepted or partial vendor outcome. It does not submit
to a vendor system or chase unpaid credits.

## Acceptance review

| Task | Criterion | Result | Evidence |
|---|---|---|---|
| LA-2.18 | Different campaign sizes show a warning, not a verdict | PASS locally | Comparison RPC reports `insufficient` and states how many more observations are needed. |
| LA-2.18 | Periods match in length and weekday | PASS locally by design | RPC rejects unequal lengths and unaligned start weekdays. |
| LA-2.18 | Confidence is plain English and correct | PASS locally by design | Rate comparisons use a two-proportion 95% threshold; cost comparisons are explicitly directional. |
| LA-2.18 | Volumes are visible at every funnel stage | PASS locally | Comparison UI renders leads, attempted, contacted, applications, and issued policies side by side. |
| LA-2.18 | Small samples say what is needed | PASS locally | Confidence response names the remaining observations to reach 200. |
| LA-2.19 | Claimable leads are captured from scrub/disposition evidence | PASS locally by design | `vendor_claimable_leads` reads the tenant-scoped linked screening result for DNC/litigator/invalid outcomes and wrong-number/disconnected attempts. |
| LA-2.19 | Return window is tracked and warned | PASS locally by design | Vendor `return_window_days` becomes a deadline with remaining-day and expired states. |
| LA-2.19 | Accepted credit changes campaign economics | PASS locally by design | Credit-delta trigger adjusts `tenant_campaigns.credits_received_cents`; the scorecard consumes that value. |
| LA-2.19 | Evidence export is sufficient | PASS locally | Claim detail contains claim summary plus lead evidence and exports CSV. |
| LA-2.19 | Undialable rate and claim acceptance appear on scorecard | PASS locally | `vendor_return_metrics` is merged into the True CPA campaign table; undialable rate replaces dispute-rate wording and claim acceptance is credited-amount based. |
| LA-2.19 | Partial outcome records actual credit | PASS locally by design | Outcome RPC rejects out-of-range amounts and requires a strictly partial amount for `partial`. |

## Security and operational review

- All new API routes use the existing `true_cpa` entitlement and owner/producer/bookkeeper boundary.
- Tenant IDs come from the authenticated context; RPCs accept the tenant ID only as a scoped parameter and
  validate campaign, vendor, lead, and claim ownership before writing.
- Claim tables have RLS enabled, no public/anon/authenticated grants, and service-role-only RPC execution.
- Evidence is visible only behind the protected app route and is not included in the existing scorecard
  lead drill-through.
- The vendor action is an evidence package and recorded outcome; no external vendor submission is hidden
  behind the button.

## Evidence boundary

Local typecheck, lint, focused tests, full tests, and production build are repository evidence. Authenticated
tenant rendering, real Supabase migration execution, populated claim fixtures, and the comparison performance
target remain live-environment evidence and must be rechecked after migration history is reconciled.

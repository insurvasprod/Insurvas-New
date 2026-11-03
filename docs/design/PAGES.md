# Insurvas — every page and sub-page

Generated from the route tree in `app/` on 22 September 2026.

**94 page files** across four shells, plus 227 API routes (not listed — they render nothing).

Each page carries the **archetype** it belongs to. That is the unit the redesign works in: 94 pages
are only nine shapes, so a change made to an archetype lands on every page in it.

## The nine archetypes

| Archetype | Pages | Mockup | What it is |
|---|---:|---|---|
| List + filters | 45 | drawn | A table of records under a filter set. The workhorse. |
| Auth / gate | 16 | not yet | One centred card: sign in, accept, verify, pay, or a wall. |
| Settings / form | 8 | drawn | Section nav left, labelled fields right, a save bar. |
| Record detail | 8 | drawn | One record: identity header, facts, tabs, activity. |
| Marketing | 5 | not yet | Public pages — the only place a hero belongs. |
| Overview | 5 | not yet | The landing screen of a surface: what needs you, and where to go. |
| Live console | 3 | not yet | A stateful screen worked all day: dialer, floor, chat. |
| Guided flow | 3 | not yet | A sequence, one decision per step, nothing skippable. |
| Board + list | 1 | drawn | The same records as columns or as rows, one toggle apart. |
| **Total** | **94** | | |

The four drawn so far cover **67 of 94**.

## Public / marketing

8 pages · Shell: `app/layout.tsx` — no chrome, or the public site header

| Route | Archetype | Renders | Page file |
|---|---|---|---|
| `/` | Marketing | — | `app/page.tsx` |
| `/affiliate/[slug]` *(dynamic)* | Marketing | `affiliate/affiliate-intake-form` | `app/affiliate/[slug]/page.tsx` |
| `/design` | Overview | `design/primitives-showcase` | `app/design/page.tsx` |
| `/legal/[type]` *(dynamic)* | Marketing | `public/legal-document-body` | `app/legal/[type]/page.tsx` |
| `/maintenance` | Auth / gate | — | `app/maintenance/page.tsx` |
| `/pricing` | Marketing | `public/pricing-page` | `app/pricing/page.tsx` |
| `/signup` | Auth / gate | `public/signup-form` | `app/signup/page.tsx` |
| `/verification-failed` | Auth / gate | `public/onboarding-frame` | `app/verification-failed/page.tsx` |

## Tenant app (agency workspace)

42 pages · Shell: `app/app/(shell)/layout.tsx` — left nav, tenant session

| Route | Archetype | Renders | Page file |
|---|---|---|---|
| `/app` | Auth / gate | — | `app/app/page.tsx` |
| `/app/[section]` *(dynamic)* | Overview | `app/coming-soon` | `app/app/(shell)/[section]/page.tsx` |
| `/app/accept-terms` | Auth / gate | `app/accept-terms-panel` | `app/app/accept-terms/page.tsx` |
| `/app/activity` | List + filters | `app/activity-log-workspace` | `app/app/(shell)/activity/page.tsx` |
| `/app/appointments` | List + filters | `app/appointment-vault-settings` | `app/app/(shell)/appointments/page.tsx` |
| `/app/assignments` | List + filters | `app/assignment-workspace` | `app/app/(shell)/assignments/page.tsx` |
| `/app/callbacks` | List + filters | `app/callback-calendar` | `app/app/(shell)/callbacks/page.tsx` |
| `/app/campaigns` | List + filters | `app/campaign-workspace` | `app/app/(shell)/campaigns/page.tsx` |
| `/app/checkout` | Auth / gate | `public/checkout-start` | `app/app/checkout/page.tsx` |
| `/app/checkout/return` | Auth / gate | — | `app/app/checkout/return/page.tsx` |
| `/app/confirm-email` | Auth / gate | `app/confirm-email-panel` | `app/app/confirm-email/page.tsx` |
| `/app/dashboard` | Overview | `app/setup-checklist` | `app/app/(shell)/dashboard/page.tsx` |
| `/app/deal-flow` | List + filters | `app/deal-flow-workspace` | `app/app/(shell)/deal-flow/page.tsx` |
| `/app/dialer` | Live console | `app/dialer-workspace` | `app/app/(shell)/dialer/page.tsx` |
| `/app/duplicates` | List + filters | `app/contact-workspace` | `app/app/(shell)/duplicates/page.tsx` |
| `/app/floor` | Live console | `app/agent-floor` | `app/app/(shell)/floor/page.tsx` |
| `/app/import` | Guided flow | `app/lead-import-workspace` | `app/app/(shell)/import/page.tsx` |
| `/app/import/review/[batchId]` *(dynamic)* | Record detail | `app/import-review-bridge` | `app/app/(shell)/import/review/[batchId]/page.tsx` |
| `/app/inbound` | List + filters | `app/transfer-inbox` | `app/app/(shell)/inbound/page.tsx` |
| `/app/inbound/[workItemId]/disposition` *(dynamic)* | Guided flow | `app/disposition-wizard` | `app/app/(shell)/inbound/[workItemId]/disposition/page.tsx` |
| `/app/inbound/[workItemId]/verification` *(dynamic)* | Guided flow | `app/verification-panel` | `app/app/(shell)/inbound/[workItemId]/verification/page.tsx` |
| `/app/lapse-risk` | List + filters | `app/feature-gate-notice` | `app/app/(shell)/lapse-risk/page.tsx` |
| `/app/leads` | Board + list | `app/lead-workspace` | `app/app/(shell)/leads/page.tsx` |
| `/app/leads/[id]` *(dynamic)* | Record detail | `app/lead-detail-workspace` | `app/app/(shell)/leads/[id]/page.tsx` |
| `/app/ledger` | List + filters | `app/feature-gate-notice` | `app/app/(shell)/ledger/page.tsx` |
| `/app/login` | Auth / gate | `app/tenant-auth-workspace` | `app/app/login/page.tsx` |
| `/app/nurture` | List + filters | `app/nurture-workspace` | `app/app/(shell)/nurture/page.tsx` |
| `/app/onboarding/business-profile` | Settings / form | `app/business-profile-form` | `app/app/onboarding/business-profile/page.tsx` |
| `/app/partner-chat` | Live console | `app/partner-chat-workspace` | `app/app/(shell)/partner-chat/page.tsx` |
| `/app/partner-quality` | List + filters | `app/partner-quality-workspace` | `app/app/(shell)/partner-quality/page.tsx` |
| `/app/policies` | List + filters | `app/policies-workspace` | `app/app/(shell)/policies/page.tsx` |
| `/app/publishers` | List + filters | `app/partners-workspace` | `app/app/(shell)/publishers/page.tsx` |
| `/app/publishers/[id]` *(dynamic)* | Record detail | `app/partners-workspace` | `app/app/(shell)/publishers/[id]/page.tsx` |
| `/app/scorecard` | List + filters | — | `app/app/(shell)/scorecard/page.tsx` |
| `/app/scoring` | List + filters | `app/scoring-workspace` | `app/app/(shell)/scoring/page.tsx` |
| `/app/set-password` | Auth / gate | `app/set-password-form` | `app/app/set-password/page.tsx` |
| `/app/settings` | Settings / form | `app/agent-settings-tabs` | `app/app/(shell)/settings/page.tsx` |
| `/app/signup` | Auth / gate | `app/tenant-auth-workspace` | `app/app/signup/page.tsx` |
| `/app/true-cpa` | List + filters | `app/true-cpa-workspace` | `app/app/(shell)/true-cpa/page.tsx` |
| `/app/vendor-returns` | List + filters | `app/vendor-returns-workspace` | `app/app/(shell)/vendor-returns/page.tsx` |
| `/app/vendors` | List + filters | — | `app/app/(shell)/vendors/page.tsx` |
| `/app/verify-email` | Auth / gate | `app/verify-email-panel` | `app/app/verify-email/page.tsx` |

## Admin (staff control plane)

34 pages · Shell: `app/admin/(protected)/layout.tsx` — staff nav, admin session

| Route | Archetype | Renders | Page file |
|---|---|---|---|
| `/admin` | Overview | `admin/page-header` | `app/admin/(protected)/page.tsx` |
| `/admin/activity` | List + filters | `admin/activity-feed` | `app/admin/(protected)/activity/page.tsx` |
| `/admin/addons` | List + filters | `admin/addons-table` | `app/admin/(protected)/addons/page.tsx` |
| `/admin/admins` | List + filters | `admin/admin-users-table` | `app/admin/(protected)/admins/page.tsx` |
| `/admin/advanced` | Settings / form | `admin/settings-form` | `app/admin/(protected)/advanced/page.tsx` |
| `/admin/audit-log` | List + filters | `admin/audit-log-table` | `app/admin/(protected)/audit-log/page.tsx` |
| `/admin/billing` | List + filters | `admin/billing-tabs` | `app/admin/(protected)/billing/page.tsx` |
| `/admin/carriers` | List + filters | `admin/carriers-table` | `app/admin/(protected)/carriers/page.tsx` |
| `/admin/compliance-sources` | List + filters | `admin/compliance-vendors-table` | `app/admin/(protected)/compliance-sources/page.tsx` |
| `/admin/coupons` | List + filters | `admin/coupons-table` | `app/admin/(protected)/coupons/page.tsx` |
| `/admin/credit-notes` | List + filters | `admin/credit-notes-table` | `app/admin/(protected)/credit-notes/page.tsx` |
| `/admin/credits-limits` | List + filters | `admin/credit-limits-panel` | `app/admin/(protected)/credits-limits/page.tsx` |
| `/admin/email` | Settings / form | `admin/configuration-placeholder` | `app/admin/(protected)/email/page.tsx` |
| `/admin/features` | Settings / form | `admin/features-section` | `app/admin/(protected)/features/page.tsx` |
| `/admin/invoices` | List + filters | `admin/invoices-table` | `app/admin/(protected)/invoices/page.tsx` |
| `/admin/invoices/[id]` *(dynamic)* | Record detail | `admin/refund-dialog` | `app/admin/(protected)/invoices/[id]/page.tsx` |
| `/admin/invoices/[id]/print` *(dynamic)* | Record detail | — | `app/admin/(protected)/invoices/[id]/print/page.tsx` |
| `/admin/legal` | Marketing | `admin/legal-screen` | `app/admin/(protected)/legal/page.tsx` |
| `/admin/login` | Auth / gate | — | `app/admin/login/page.tsx` |
| `/admin/offers` | List + filters | `admin/offers-table` | `app/admin/(protected)/offers/page.tsx` |
| `/admin/payments` | List + filters | `admin/payment-status-panel` | `app/admin/(protected)/payments/page.tsx` |
| `/admin/plans` | List + filters | `admin/plans-table` | `app/admin/(protected)/plans/page.tsx` |
| `/admin/plans/[id]/edit` *(dynamic)* | Record detail | `admin/plan-version-editor` | `app/admin/(protected)/plans/[id]/edit/page.tsx` |
| `/admin/products` | List + filters | `admin/products-table` | `app/admin/(protected)/products/page.tsx` |
| `/admin/revenue` | List + filters | `admin/billing-tabs` | `app/admin/(protected)/revenue/page.tsx` |
| `/admin/settings` | Settings / form | — | `app/admin/(protected)/settings/page.tsx` |
| `/admin/subscriptions` | List + filters | `admin/subscriptions-table` | `app/admin/(protected)/subscriptions/page.tsx` |
| `/admin/system` | List + filters | `admin/system-settings-panel` | `app/admin/(protected)/system/page.tsx` |
| `/admin/templates` | List + filters | `admin/templates-table` | `app/admin/(protected)/templates/page.tsx` |
| `/admin/tenants` | List + filters | `admin/tenants-table` | `app/admin/(protected)/tenants/page.tsx` |
| `/admin/tenants/[id]` *(dynamic)* | Record detail | `admin/subscription-panel` | `app/admin/(protected)/tenants/[id]/page.tsx` |
| `/admin/trials` | List + filters | `admin/trials-table` | `app/admin/(protected)/trials/page.tsx` |
| `/admin/users` | List + filters | `admin/users-table` | `app/admin/(protected)/users/page.tsx` |
| `/admin/users/[id]` *(dynamic)* | Record detail | `admin/user-detail-summary` | `app/admin/(protected)/users/[id]/page.tsx` |

## Partner portal

10 pages · Shell: `app/partner/(portal)/layout.tsx` — partner nav, partner session

| Route | Archetype | Renders | Page file |
|---|---|---|---|
| `/partner` | Overview | `partner/partner-portal-workspace` | `app/partner/(portal)/page.tsx` |
| `/partner/accept-invite` | Auth / gate | `partner/accept-partner-invite-form` | `app/partner/accept-invite/page.tsx` |
| `/partner/login` | Auth / gate | `partner/partner-login-form` | `app/partner/login/page.tsx` |
| `/partner/messages` | List + filters | — | `app/partner/(portal)/messages/page.tsx` |
| `/partner/pipeline` | List + filters | — | `app/partner/(portal)/pipeline/page.tsx` |
| `/partner/set-password` | Auth / gate | `partner/partner-set-password-form` | `app/partner/set-password/page.tsx` |
| `/partner/settings` | Settings / form | — | `app/partner/(portal)/settings/page.tsx` |
| `/partner/submit-lead` | Settings / form | — | `app/partner/(portal)/submit-lead/page.tsx` |
| `/partner/team` | List + filters | — | `app/partner/(portal)/team/page.tsx` |
| `/partner/team-review` | List + filters | — | `app/partner/(portal)/team-review/page.tsx` |

## How to read this

- **Route groups are not URL segments.** `(shell)`, `(protected)` and `(portal)` only attach a
  layout, so `app/app/(shell)/leads/page.tsx` is served at `/app/leads`.
- **Dynamic routes** are marked. `[id]`, `[workItemId]` and the like each stand for many real URLs,
  so 94 is the count of distinct page *files*, not of pages a user can reach.
- **`Renders`** names the largest non-primitive component the page imports, which is usually the
  whole screen. `—` means the page holds its own markup.
- **The archetype is a judgement, not a fact in the code.** It was derived from what each page
  actually renders, then corrected by hand for ten pages the heuristic mislabelled (`/app/leads/[id]`,
  `/app/settings`, `/app/import`, `/design` and others). If one still looks wrong, it is worth saying so —
  the archetype decides which mockup a page is built against.
- **The four shells** own the navigation, the session and the page ground. A change to a shell lands
  on every page beneath it, which is why they are named per section rather than listed as pages.

## What this is for

The redesign is applied per archetype, not per page. The order of work follows the counts above:
the list archetype is 47 pages, so the control bar and the collapsible filter panel are worth more
than any single screen. A page appears in exactly one archetype; nothing is redesigned twice, and
nothing is missed.


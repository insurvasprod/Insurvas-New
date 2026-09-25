# Insurvas redesign — page-by-page checklist

Generated 2026-09-23. One line per screen. Work top to bottom.

- Design canvas: <https://claude.ai/artifact/KhSxKh1TmkCPMpdt7vwY12> (v21, 181 boards)
- Repo: `Insurvas-New`, branch `redesign/foundations`
- Rule in force: **redesign only — no functionality removed, nothing deleted.**

Legend: `[ ]` not started &nbsp;·&nbsp; `[~]` partly done (shell/chrome only) &nbsp;·&nbsp; `[x]` matches the artboard

---

## 0. Shell & chrome (applies to every page)

| | Piece | Artboard | Where it lives |
|---|---|---|---|
| [x] | Top bar — search, notifications, alerts, account menu | `p-nav-spec` | `components/app/app-top-bar.tsx` |
| [x] | Top bar flush to the top of the content column | `p-nav-spec` | three `layout.tsx` + `.portal-top-bar` |
| [x] | Search results panel | `p-nav-search` | `lib/search/*`, `app/api/*/search` |
| [x] | Notifications panel (personal events) | `p-nav-notifications` | `lib/agentAlerts/useAgentAlertFeed.ts` |
| [x] | Alerts panel (workspace events) | `p-nav-alerts` | same |
| [x] | Account menu + sign out | `p-nav-profile` | `app-top-bar.tsx` |
| [x] | Staff search variant | `p-nav-admin` | `lib/search/adminService.ts` |
| [x] | Motion layer (`m-in`, `m-stagger`, `m-seq`, `m-row`, `m-meter`) | `p-mkt-motion` | `app/globals.css` |
| [x] | Sidebar — agent — dark 264px rail, orange active chip | `Main` | `components/app/agent-sidebar.tsx` |
| [x] | Sidebar — admin — same rail, 8px items, 14px labels | `p-adm-home` | `components/admin/admin-sidebar.tsx` |
| [x] | Sidebar — partner — shares the agent rail | `p-par-overview` | `components/partner/partner-sidebar.tsx` |
| [x] | Shared table — filled 10.5px header, 8px rows, grey rule, 16px gutters | `List` | `components/ui/table.tsx` |
| [x] | Shared table card — 12px radius, hairline shadow, plinth footer | `List` | `components/ui/table-card.tsx` |
| [x] | Stat strip — 30px figure, 10.5px label, delta chip | `List` | `components/ui/stat.tsx` |
| [x] | **Orange purge** — 91 structural borders/grounds off the soft orange | `Foundations` | `app/globals.css` |
| [x] | ~20 bespoke tables normalised onto the artboard table | `List` | `app/globals.css` |
| [x] | One page title — 32px/1.13/-0.025em everywhere inside the shell | every board | `components/ui/page-header.tsx` + `app/globals.css` |
| [x] | One control bar — white card, 34px controls, 8px corners, 13px type | `List` | `app/globals.css` |
| [ ] | Dark mode pass (all artboards are light-only) | — | `app/globals.css` |

---

## Public / marketing / auth — 9 pages

| | # | Route | Screen | Artboard | File |
|---|---|---|---|---|---|
| [ ] | 1 | `/` | Root redirect | `p-pub-root` | `app/page.tsx` |
| [ ] | 2 | `/` | Landing page | `p-mkt-home` | `app/page.tsx` |
| [ ] | 3 | `/affiliate/[slug]` | Affiliate intake | `p-pub-affiliate` | `app/affiliate/[slug]/page.tsx` |
| [ ] | 4 | `/design` | Primitives | `p-pub-design` | `app/design/page.tsx` |
| [ ] | 5 | `/legal/[type]` | Legal document | `p-pub-legal` | `app/legal/[type]/page.tsx` |
| [ ] | 6 | `/maintenance` | Maintenance | `p-pub-maintenance` | `app/maintenance/page.tsx` |
| [ ] | 7 | `/pricing` | Pricing · interactive | `p-pub-pricing` | `app/pricing/page.tsx` |
| [ ] | 8 | `/signup` | Public signup | `p-pub-signup` | `app/signup/page.tsx` |
| [ ] | 9 | `/verification-failed` | Verification failed | `p-pub-verification-failed` | `app/verification-failed/page.tsx` |

## Agent app — 47 pages

| | # | Route | Screen | Artboard | File |
|---|---|---|---|---|---|
| [ ] | 10 | `/app` | Home redirect | `p-app-home` | `app/app/page.tsx` |
| [x] | 11 | `/app/[section]` | On the way | `p-app-section` | `app/app/(shell)/[section]/page.tsx` |
| [ ] | 12 | `/app/accept-terms` | Accept terms | `p-pub-accept-terms` | `app/app/accept-terms/page.tsx` |
| [x] | 13 | `/app/activity` | Activity & scorecard | `p-app-activity` | `app/app/(shell)/activity/page.tsx` |
| [x] | 14 | `/app/appointments` | Carrier appointments | `p-app-appointments` | `app/app/(shell)/appointments/page.tsx` |
| [x] | 15 | `/app/assignments` | Lead assignment | `p-app-assignments` | `app/app/(shell)/assignments/page.tsx` |
| [x] | 16 | `/app/calendar` | Appointment calendar | `p-app-calendar` | `app/app/(shell)/calendar/page.tsx` |
| [x] | 17 | `/app/callbacks` | Callback calendar | `p-app-callbacks` | `app/app/(shell)/callbacks/page.tsx` |
| [x] | 18 | `/app/campaigns` | Vendors & campaigns | `p-app-campaigns` | `app/app/(shell)/campaigns/page.tsx` |
| [ ] | 19 | `/app/checkout` | Checkout | `p-pub-checkout` | `app/app/checkout/page.tsx` |
| [ ] | 20 | `/app/checkout/return` | Checkout return | `p-pub-checkout-return` | `app/app/checkout/return/page.tsx` |
| [ ] | 21 | `/app/confirm-email` | Confirm email | `p-pub-confirm-email` | `app/app/confirm-email/page.tsx` |
| [x] | 22 | `/app/consent` | Consent locker | `p-app-consent` | `app/app/(shell)/consent/page.tsx` |
| [x] | 23 | `/app/dashboard` | Dashboard | `p-app-dashboard` | `app/app/(shell)/dashboard/page.tsx` |
| [x] | 24 | `/app/deal-flow` | Daily deal flow | `p-app-deal-flow` | `app/app/(shell)/deal-flow/page.tsx` |
| [x] | 25 | `/app/dialer` | Dialer | `p-app-dialer` | `app/app/(shell)/dialer/page.tsx` |
| [x] | 26 | `/app/duplicates` | Duplicate check | `p-app-duplicates` | `app/app/(shell)/duplicates/page.tsx` |
| [x] | 27 | `/app/floor` | Agent Floor | `p-app-floor` | `app/app/(shell)/floor/page.tsx` |
| [x] | 28 | `/app/import` | List import | `p-app-import` | `app/app/(shell)/import/page.tsx` |
| [x] | 29 | `/app/import/review/[batchId]` | Import review | `p-app-import-review` | `app/app/(shell)/import/review/[batchId]/page.tsx` |
| [x] | 30 | `/app/inbound` | Inbound transfers | `p-app-inbound` | `app/app/(shell)/inbound/page.tsx` |
| [x] | 31 | `/app/inbound/[id]/disposition` | Disposition | `p-app-disposition` | `app/app/(shell)/inbound/[workItemId]/disposition/page.tsx` |
| [x] | 32 | `/app/inbound/[id]/verification` | Verification | `p-app-verification` | `app/app/(shell)/inbound/[workItemId]/verification/page.tsx` |
| [x] | 33 | `/app/lapse-risk` | Lapse risk | `p-app-lapse-risk` | `app/app/(shell)/lapse-risk/page.tsx` |
| [x] | 34 | `/app/lead-lists` | Lead lists | `p-app-lead-lists` | `app/app/(shell)/lead-lists/page.tsx` |
| [ ] | 35 | `/app/lead-lists/[batchId]` | Lead list detail | `p-app-lead-list-detail` | **no page.tsx found** |
| [x] | 36 | `/app/leads` | Lead workspace | `p-app-leads` | `app/app/(shell)/leads/page.tsx` |
| [x] | 37 | `/app/leads/[id]` | Lead detail | `p-app-lead-detail` | `app/app/(shell)/leads/[id]/page.tsx` |
| [x] | 38 | `/app/ledger` | Commission ledger | `p-app-ledger` | `app/app/(shell)/ledger/page.tsx` |
| [ ] | 39 | `/app/login` | Agent sign-in | `p-pub-app-login` | `app/app/login/page.tsx` |
| [x] | 40 | `/app/nurture` | Lead recycling | `p-app-nurture` | `app/app/(shell)/nurture/page.tsx` |
| [ ] | 41 | `/app/onboarding/business-profile` | Business profile | `p-pub-business-profile` | `app/app/onboarding/business-profile/page.tsx` |
| [x] | 42 | `/app/partner-chat` | Partner chat | `p-app-partner-chat` | `app/app/(shell)/partner-chat/page.tsx` |
| [x] | 43 | `/app/partner-quality` | Partner quality | `p-app-partner-quality` | `app/app/(shell)/partner-quality/page.tsx` |
| [x] | 44 | `/app/policies` | Policies | `p-app-policies` | `app/app/(shell)/policies/page.tsx` |
| [x] | 45 | `/app/publishers` | Partners | `p-app-publishers` | `app/app/(shell)/publishers/page.tsx` |
| [x] | 46 | `/app/publishers/[id]` | Partner detail | `p-app-publisher-detail` | `app/app/(shell)/publishers/[id]/page.tsx` |
| [x] | 47 | `/app/scorecard` | Scorecard alias | `p-app-scorecard-alias` | `app/app/(shell)/scorecard/page.tsx` |
| [x] | 48 | `/app/scoring` | Queue scoring | `p-app-scoring` | `app/app/(shell)/scoring/page.tsx` |
| [ ] | 49 | `/app/set-password` | Set password | `p-pub-set-password` | `app/app/set-password/page.tsx` |
| [~] | 50 | `/app/settings` | Settings · overview | `p-app-settings` | `app/app/(shell)/settings/page.tsx` |
| [ ] | 51 | `/app/signup` | Agent signup | `p-pub-app-signup` | `app/app/signup/page.tsx` |
| [x] | 52 | `/app/tcpa` | TCPA / DNC | `p-app-tcpa` | `app/app/(shell)/tcpa/page.tsx` |
| [x] | 53 | `/app/true-cpa` | True CPA | `p-app-true-cpa` | `app/app/(shell)/true-cpa/page.tsx` |
| [x] | 54 | `/app/vendor-returns` | Vendor returns | `p-app-vendor-returns` | `app/app/(shell)/vendor-returns/page.tsx` |
| [x] | 55 | `/app/vendors` | Vendors alias | `p-app-vendors-alias` | `app/app/(shell)/vendors/page.tsx` |
| [ ] | 56 | `/app/verify-email` | Verify email | `p-pub-verify-email` | `app/app/verify-email/page.tsx` |

## Partner portal — 10 pages

| | # | Route | Screen | Artboard | File |
|---|---|---|---|---|---|
| [x] | 57 | `/partner` | Overview | `p-par-overview` | `app/partner/(portal)/page.tsx` |
| [ ] | 58 | `/partner/accept-invite` | Accept invite | `p-par-accept-invite` | `app/partner/accept-invite/page.tsx` |
| [ ] | 59 | `/partner/login` | Partner sign-in | `p-par-login` | `app/partner/login/page.tsx` |
| [x] | 60 | `/partner/messages` | Messages | `p-par-messages` | `app/partner/(portal)/messages/page.tsx` |
| [x] | 61 | `/partner/pipeline` | Pipeline | `p-par-pipeline` | `app/partner/(portal)/pipeline/page.tsx` |
| [ ] | 62 | `/partner/set-password` | Set password | `p-par-set-password` | `app/partner/set-password/page.tsx` |
| [x] | 63 | `/partner/settings` | Settings | `p-par-settings` | `app/partner/(portal)/settings/page.tsx` |
| [x] | 64 | `/partner/submit-lead` | Submit a lead | `p-par-submit-lead` | `app/partner/(portal)/submit-lead/page.tsx` |
| [x] | 65 | `/partner/team` | Team access | `p-par-team` | `app/partner/(portal)/team/page.tsx` |
| [x] | 66 | `/partner/team-review` | Team review | `p-par-team-review` | `app/partner/(portal)/team-review/page.tsx` |

## Admin (staff console) — 35 pages

| | # | Route | Screen | Artboard | File |
|---|---|---|---|---|---|
| [x] | 67 | `/admin` | Dashboard | `p-adm-home` | `app/admin/(protected)/page.tsx` |
| [x] | 68 | `/admin/activity` | Activity | `p-adm-activity` | `app/admin/(protected)/activity/page.tsx` |
| [x] | 69 | `/admin/addons` | Addons | `p-adm-addons` | `app/admin/(protected)/addons/page.tsx` |
| [x] | 70 | `/admin/admins` | Admins | `p-adm-admins` | `app/admin/(protected)/admins/page.tsx` |
| [x] | 71 | `/admin/advanced` | Advanced | `p-adm-advanced` | `app/admin/(protected)/advanced/page.tsx` |
| [x] | 72 | `/admin/audit-log` | Audit log | `p-adm-audit-log` | `app/admin/(protected)/audit-log/page.tsx` |
| [x] | 73 | `/admin/billing` | Billing | `p-adm-billing` | `app/admin/(protected)/billing/page.tsx` |
| [x] | 74 | `/admin/carriers` | Carriers | `p-adm-carriers` | `app/admin/(protected)/carriers/page.tsx` |
| [x] | 75 | `/admin/compliance-sources` | Compliance sources | `p-adm-compliance` | `app/admin/(protected)/compliance-sources/page.tsx` |
| [x] | 76 | `/admin/coupons` | Coupons | `p-adm-coupons` | `app/admin/(protected)/coupons/page.tsx` |
| [x] | 77 | `/admin/credit-notes` | Credit notes | `p-adm-credit-notes` | `app/admin/(protected)/credit-notes/page.tsx` |
| [x] | 78 | `/admin/credits-limits` | Credits & limits | `p-adm-credits-limits` | `app/admin/(protected)/credits-limits/page.tsx` |
| [x] | 79 | `/admin/email` | Email | `p-adm-email` | `app/admin/(protected)/email/page.tsx` |
| [x] | 80 | `/admin/features` | Feature flags | `p-adm-features` | `app/admin/(protected)/features/page.tsx` |
| [x] | 81 | `/admin/invoices` | Invoices | `p-adm-invoices` | `app/admin/(protected)/invoices/page.tsx` |
| [x] | 82 | `/admin/invoices/[id]` | Invoice detail | `p-adm-invoice-detail` | `app/admin/(protected)/invoices/[id]/page.tsx` |
| [x] | 83 | `/admin/invoices/[id]/print` | Invoice print | `p-adm-invoice-print` | `app/admin/(protected)/invoices/[id]/print/page.tsx` |
| [x] | 84 | `/admin/legal` | Legal | `p-adm-legal` | `app/admin/(protected)/legal/page.tsx` |
| [ ] | 85 | `/admin/login` | Staff sign-in | `p-adm-login` | `app/admin/login/page.tsx` |
| [x] | 86 | `/admin/offers` | Offers | `p-adm-offers` | `app/admin/(protected)/offers/page.tsx` |
| [x] | 87 | `/admin/payments` | Payments | `p-adm-payments` | `app/admin/(protected)/payments/page.tsx` |
| [x] | 88 | `/admin/plans` | Plans | `p-adm-plans` | `app/admin/(protected)/plans/page.tsx` |
| [x] | 89 | `/admin/plans/[id]/edit` | Plan editor | `p-adm-plan-edit` | `app/admin/(protected)/plans/[id]/edit/page.tsx` |
| [x] | 90 | `/admin/products` | Products | `p-adm-products` | `app/admin/(protected)/products/page.tsx` |
| [x] | 91 | `/admin/revenue` | Revenue | `p-adm-revenue` | `app/admin/(protected)/revenue/page.tsx` |
| [x] | 92 | `/admin/settings` | Settings | `p-adm-settings-alias` | `app/admin/(protected)/settings/page.tsx` |
| [x] | 93 | `/admin/state-disclosures` | Disclosures | `p-adm-state-disclosures` | `app/admin/(protected)/state-disclosures/page.tsx` |
| [x] | 94 | `/admin/subscriptions` | Subscriptions | `p-adm-subscriptions` | `app/admin/(protected)/subscriptions/page.tsx` |
| [x] | 95 | `/admin/system` | System | `p-adm-system` | `app/admin/(protected)/system/page.tsx` |
| [x] | 96 | `/admin/templates` | Templates | `p-adm-templates` | `app/admin/(protected)/templates/page.tsx` |
| [x] | 97 | `/admin/tenants` | Tenants | `p-adm-tenants` | `app/admin/(protected)/tenants/page.tsx` |
| [x] | 98 | `/admin/tenants/[id]` | Tenant overview | `p-adm-tenant-detail` | `app/admin/(protected)/tenants/[id]/page.tsx` |
| [x] | 99 | `/admin/trials` | Trials | `p-adm-trials` | `app/admin/(protected)/trials/page.tsx` |
| [x] | 100 | `/admin/users` | Users | `p-adm-users` | `app/admin/(protected)/users/page.tsx` |
| [x] | 101 | `/admin/users/[id]` | User detail | `p-adm-user-detail` | `app/admin/(protected)/users/[id]/page.tsx` |

### Boards without a matching route

- [ ] Appointments & setters — `p-app-booked-appointments`

## Settings sections — 13

Each is a body inside `/app/settings`; the rail itself is done.

- [ ] agency-profile  ·  Agency profile — `p-set-agency-profile`
- [ ] cadence  ·  Dialing cadence — `p-set-cadence`
- [ ] calendar  ·  Calendar & availability — `p-set-calendar`
- [ ] calling-windows  ·  Calling windows — `p-set-calling-windows`
- [ ] carrier-library  ·  Carrier library — `p-set-carrier-library`
- [ ] dispositions  ·  Dispositions — `p-set-dispositions`
- [ ] form-templates  ·  Form templates — `p-set-form-templates`
- [ ] lead-posting  ·  Lead posting — `p-set-lead-posting`
- [ ] alerts, billing  ·  Managed elsewhere — `p-set-managed`
- [ ] pipelines  ·  Pipelines — `p-set-pipelines`
- [ ] queue-sla  ·  Queue & SLA — `p-set-queue-sla`
- [ ] states-licences  ·  States & licences — `p-set-states-licences`
- [ ] team-access  ·  Team & access — `p-set-team-access`

## Record tabs — 7

Tabs inside a detail page, not routes of their own.

- [ ] tab  ·  Feature overrides — `p-adm-tenant-features`
- [ ] tab  ·  Subscription & billing — `p-adm-tenant-subscription`
- [ ] tab  ·  Users & seats — `p-adm-tenant-users`
- [x] tab  ·  Attempts — `p-lead-attempts`
- [x] tab  ·  Callbacks — `p-lead-callbacks`
- [x] tab  ·  Notes — `p-lead-notes`
- [ ] tab  ·  Nurture — `p-lead-nurture`  ← no per-lead nurture data; needs a new fetch

## Overlays & drawers — 6

Dialogs raised from a page.

- [ ] overlay  ·  Assign the remainder — `p-ov-assign-drawer`
- [ ] overlay  ·  Map the columns — `p-ov-column-mapping`
- [ ] overlay  ·  Revoke a posting key — `p-ov-confirm-revoke`
- [x] overlay  ·  Screening preflight — `p-ov-dialer-preflight`
- [x] overlay  ·  Record call outcome — `p-ov-disposition-wizard`
- [ ] overlay  ·  New stage — `p-ov-stage-manager`

## Gate screens — 3

Shown instead of a page when access is refused.

- [ ] 404  ·  Not found — `p-gate-404`  ← no `not-found.tsx` exists in the app yet
- [x] gate  ·  Plan does not include it — `p-gate-feature`
- [x] gate  ·  Role does not include it — `p-gate-role`

## Other boards — 26



- [ ] LA-2 §10 · Dialer — `Dialer`
- [ ] LA-2 §13 · Queue scoring — `QueueScoring`
- [ ] LA-2.24 · Lead assignment — `Assignment`
- [ ] LA-2 §6 · Before it reaches an agent — `Pool`
- [ ] LA-2 §11 · Appointments & setters — `Appointments`
- [ ] LA-2 §16 · Activity / call log — `Activity`
- [ ] LA-2 §14 · Scorecard — `Scorecard`
- [ ] LA-2 §4 · Lead recycling — `Recycling`
- [ ] LA-2 §15 · Vendor returns — `Returns`
- [ ] LA-2 §5 · Vendors — `Vendors`
- [ ] LA-2 §5 · Campaigns & cadence — `Campaigns`
- [ ] LA-2 §3 · Daily deal flow — `DealFlow`
- [ ] LA-1 §7 · Agent floor — `Floor`
- [ ] LA-1 §6 · Inbound inbox — `Inbox`
- [ ] LA-1 §8 · Lead workspace — `LeadWorkspace`
- [ ] LA-1 §4 · Partner submits a lead — `SubmitLead`
- [ ] LA-1 §9 · Callbacks — `Callbacks`
- [ ] LA-1 §12 · Partner chat — `PartnerChat`
- [ ] LA-1 §3 · Partners & publishers — `Publishers`
- [ ] LA-1 §10 · Pipelines — 4 views — `Pipelines`
- [ ] Board — kanban by stage — `PipelineBoard`
- [ ] Table — sort, select, act — `PipelineTable`
- [ ] List — grouped, with preview — `PipelineList`
- [ ] Edit a stage — `StageEditor`
- [ ] Disposition library — `DispositionLibrary`
- [ ] New pipeline — guided flow — `NewPipeline`

## Reference boards (nothing to port)

- Today — the grey wall — `Before`
- Proposed — light — `Main`
- Proposed — dark — `Dark`
- Foundations — what changed and why — `Foundations`
- 1 · List + filters — 45 pages — `List`
- 2 · Record detail — 8 pages — `Detail`
- 3 · Settings & forms — 8 pages — `Settings`
- 4 · Board view — 1 page — `Board`
- 5 · Auth & gates — 16 pages — `Auth`
- 6 · Overview — 5 pages — `Overview`
- 7 · Live console — 3 pages — `Console`
- 8 · Guided flow — 3 pages — `Flow`
- 9 · Marketing — 5 pages — `Marketing`
- The three sign-in doors — `p-mkt-logins`
- Motion — `p-mkt-motion`
- The outbound chain — `p-mkt-chain`
- Every screen in Insurvas — `p-index`
- The five states of a list — `p-states`

---

**Totals:** 101 routed pages, 13 settings sections, 7 tabs, 6 overlays, 3 gates.

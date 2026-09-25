# INSURVAS Brex-inspired UI/UX mockups

This collection contains one desktop UI/UX mockup for every Licensed Agent and Partner portal page requested by the product owner.

## Design sources

- Visual reference: <https://designmd-store.com/packs/brex/preview>
- Design specification supplied by the product owner: `C:\Users\Victus\Downloads\brex.design.md`
- Product behavior and terminology: the current route and component implementation in this repository
- Mock-data date anchor: September 16, 2026

The Brex material is used only as a visual-language reference. INSURVAS workflows, permissions, plan gates, role gates, terminology, and life-insurance content come from this repository.

## Shared design rules

- Desktop canvas: 1440 x 1024.
- Inter-like typography with tight tracking and weights 400/600.
- `#FCFCFD` canvas, `#FFFFFF` surfaces, `#F6F7F9` grouped panels, `#E6E8EB` quiet borders, and `#15191E` primary ink.
- `#FF5900` is reserved for one primary action and the active navigation signal.
- Controls use 8px rounding, panels use 12px rounding, and layout follows an 8px spacing rhythm.
- Working tables and lists remain dense and legible; decorative cards, gradients, glass effects, and heavy shadows are avoided.
- Generated people, companies, identifiers, dates, and numbers are fictional demo content.
- A mockup illustrates proposed UX. It is not proof that the route is implemented or legally approved.

## Known mismatches with the live product

Checked 2026-09-18. See `docs/design/06-MOCKUP-INDEX.md` for the full reconciliation.

- **Row 34 (Signup)** was drawn from `components/app/tenant-signup-form.tsx`, which was an orphan —
  nothing imported it, and it has since been deleted. The live `/app/signup` renders
  `tenant-auth-workspace.tsx`, which has a different structure (a split shell with an inline plan
  picker and a billing-cycle select). Check the mockup against the live form before implementing it.
- **Row 18 (Commission ledger)** shows *Import statement* and *Ledger settings* as active controls.
  Carrier statement ingestion does not exist, so the live page renders those buttons `disabled` with
  an explanation. Implementing the mockup literally would ship an enabled button with no backend.
- **Row 1 (Dashboard)** shows partial checklist progress ("2 of 4 complete"). `setupChecklistForState`
  reports only 0/5 or 5/5 on purpose, because per-step completion is not persisted and a fabricated
  partial bar would be a lie.
- **Sidebar**: several mockups draw a flat seven-item navigation. The real sidebar is
  entitlement-aware (LA-1/LA-2 module disclosures, "Not included", the plan-access card) and is
  built from `lib/menu/definition.ts`. Take page content from the mockups, never the navigation.

## Progress

| # | Surface | Route | Source evidence | Mockup | Status |
|---:|---|---|---|---|---|
| 1 | Dashboard | `/app/dashboard` | `app/app/(shell)/dashboard/page.tsx` | `01-agent-dashboard.png` | Complete |
| 2 | Dynamic section page | `/app/[section]` | `app/app/(shell)/[section]/page.tsx`, gate and coming-soon components | `02-agent-dynamic-section.png` | Complete |
| 3 | Activity & Scorecard | `/app/activity` | `components/app/activity-log-workspace.tsx` | `03-agent-activity-scorecard.png` | Complete |
| 4 | Appointments | `/app/appointments` | `components/app/appointment-vault-settings.tsx` | `04-agent-appointments-licences.png` | Complete |
| 5 | Lead Assignment | `/app/assignments` | `components/app/assignment-workspace.tsx` | `05-agent-lead-assignment.png` | Complete |
| 6 | Callbacks | `/app/callbacks` | `components/app/callback-calendar.tsx` | `06-agent-callback-calendar.png` | Complete |
| 7 | Deal Flow | `/app/deal-flow` | `components/app/deal-flow-workspace.tsx` | `07-agent-daily-deal-flow.png` | Complete |
| 8 | Dialer | `/app/dialer` | `components/app/dialer-workspace.tsx` | `08-agent-dialer-workspace.png` | Complete |
| 9 | Duplicate Check | `/app/duplicates` | `components/app/contact-workspace.tsx` | `09-agent-contacts-duplicates.png` | Complete |
| 10 | Agent Floor | `/app/floor` | `components/app/agent-floor.tsx` | `10-agent-floor.png` | Complete |
| 11 | Lead Import | `/app/import` | `components/app/lead-import-workspace.tsx` | `11-agent-import-leads.png` | Complete |
| 12 | Inbound Transfers | `/app/inbound` | `components/app/transfer-inbox.tsx` | `12-agent-inbound-transfers.png` | Complete |
| 13 | Inbound Disposition | `/app/inbound/[workItemId]/disposition` | `components/app/disposition-wizard.tsx` | `13-agent-inbound-disposition.png` | Complete |
| 14 | Inbound Verification | `/app/inbound/[workItemId]/verification` | `components/app/verification-panel.tsx` | `14-agent-inbound-verification.png` | Complete |
| 15 | Lapse Risk | `/app/lapse-risk` | `app/app/(shell)/lapse-risk/page.tsx` | `15-agent-lapse-risk.png` | Complete |
| 16 | Lead Workspace | `/app/leads` | `components/app/lead-workspace.tsx` | `16-agent-lead-workspace.png` | Complete |
| 17 | Lead Details | `/app/leads/[id]` | `components/app/lead-detail-workspace.tsx` | `17-agent-lead-detail.png` | Complete |
| 18 | Commission Ledger | `/app/ledger` | `app/app/(shell)/ledger/page.tsx` | `18-agent-commission-ledger.png` | Complete |
| 19 | Lead Recycling | `/app/nurture` | `components/app/nurture-workspace.tsx` | `19-agent-lead-recycling.png` | Complete |
| 20 | Partner Chat | `/app/partner-chat` | `components/app/partner-chat-workspace.tsx` | `20-agent-partner-chat.png` | Complete |
| 21 | Partner Quality | `/app/partner-quality` | `components/app/partner-quality-workspace.tsx` | `21-agent-partner-quality.png` | Complete |
| 22 | Policies | `/app/policies` | `app/app/(shell)/policies/page.tsx` | `22-agent-policies.png` | Complete |
| 23 | Partner Records | `/app/publishers` | `components/app/partners-workspace.tsx` | `23-agent-partner-records.png` | Complete |
| 24 | Settings | `/app/settings` | `components/app/carrier-library-settings.tsx`, `components/app/appointment-vault-settings.tsx`, `components/app/team-settings.tsx` | `24-agent-settings.png` | Complete |
| 25 | True CPA | `/app/true-cpa` | `components/app/true-cpa-workspace.tsx` | `25-agent-true-cpa.png` | Complete |
| 26 | Agent Home | `/app` | `app/app/page.tsx` (redirect fallback concept) | `26-agent-home-redirect.png` | Complete |
| 27 | Accept Terms | `/app/accept-terms` | `components/app/accept-terms-panel.tsx` | `27-agent-accept-terms.png` | Complete |
| 28 | Checkout | `/app/checkout` | `app/app/checkout/page.tsx`, `components/public/checkout-start.tsx` | `28-agent-checkout.png` | Complete |
| 29 | Checkout Return | `/app/checkout/return` | `app/app/checkout/return/page.tsx` (verification fallback concept) | `29-agent-checkout-return.png` | Complete |
| 30 | Confirm Email | `/app/confirm-email` | `components/app/confirm-email-panel.tsx` | `30-agent-confirm-email.png` | Complete |
| 31 | Licensed Agent Login | `/app/login` | `app/app/login/page.tsx` | `31-agent-login.png` | Complete |
| 32 | Business Profile Onboarding | `/app/onboarding/business-profile` | `components/app/business-profile-form.tsx` | `32-agent-business-profile.png` | Complete |
| 33 | Set Password | `/app/set-password` | `components/app/set-password-form.tsx` | `33-agent-set-password.png` | Complete |
| 34 | Signup | `/app/signup` | `components/app/tenant-auth-workspace.tsx` | `34-agent-signup.png` | Check before use |
| 35 | Verify Email | `/app/verify-email` | `components/app/verify-email-panel.tsx` | `35-agent-verify-email.png` | Complete |
| 36 | Partner Dashboard | `/partner` | `components/partner/partner-portal-overview.tsx` | `36-partner-dashboard.png` | Complete |
| 37 | Partner Messages | `/partner/messages` | `components/partner/partner-chat-panel.tsx` | `37-partner-messages.png` | Complete |
| 38 | Lead Pipeline | `/partner/pipeline` | `components/partner/partner-lead-pipeline.tsx` | `38-partner-pipeline.png` | Complete |
| 39 | Partner Settings | `/partner/settings` | `components/partner/partner-settings-workspace.tsx` | `39-partner-settings.png` | Complete |
| 40 | Submit Lead | `/partner/submit-lead` | `components/partner/partner-portal-workspace.tsx` | `40-partner-submit-lead.png` | Complete |
| 41 | Partner Team | `/partner/team` | `components/partner/partner-team-workspace.tsx` | `41-partner-team.png` | Complete |
| 42 | Accept Invite | `/partner/accept-invite` | `components/partner/accept-partner-invite-form.tsx` | `42-partner-accept-invite.png` | Complete |
| 43 | Partner Login | `/partner/login` | `components/partner/partner-login-form.tsx` | `43-partner-login.png` | Complete |
| 44 | Partner Set Password | `/partner/set-password` | `components/partner/partner-set-password-form.tsx`, `app/api/partner/auth/set-password/route.ts` | `44-partner-set-password.png` | Complete |
| 45 | Partner Team Review | `/partner/team-review` | `components/partner/partner-team-review-workspace.tsx`, `app/api/partner/leads/pipeline/route.ts`, `app/api/partner/users/route.ts` | Approved Team Review mockup | Implemented |

# Plan: Sign-in and sign-up (manager review, 28 Oct 2026)

Source: `tasks/manager-review-2026-10-28.md` (sections 1 and 2) and the full transcript
`tasks/manager-transcript-2026-10-28.md` (00:00–19:10). Rion's own review notes (screenshots,
29 Oct) are added as tasks A3, A4 and A8.

This plan narrows `tasks/plan.md` Tasks 1–6 to the auth journey only and records what is already
done in source, so nothing gets built twice.

## What the manager asked for (checklist)

| # | Request | Time | Status in source |
|---|---------|------|------------------|
| M1 | Step 1 = email + password + Google only; email and password full width, one column | 00:00, 12:21 | Done (form). Google: **not wired** |
| M2 | First name, last name, phone move to the next step | 12:51 | Done (About you step) |
| M3 | "Account created" screen: one Continue button, no "Not you? Sign out" | 01:16 | Done, needs browser check |
| M4 | No "Back to your email" link at top; Back + Continue pair at the bottom; only Privacy · Terms · Support under it | 02:45 | Footer component exists; not on every step yet |
| M5 | Copy follows landing-page choice: independent agent → "Tell us about you" | 02:15 | Done |
| M6 | Plan picked on Pricing → don't ask again; show plan, 14-day trial, $0 today. Header "Start free trial" → show chooser | 03:43–06:37 | Done in source; migration unapplied |
| M7 | "Independent agent", "For an Agency", "Primary State" (Title Case labels) | 06:37–07:38 | Not done |
| M8 | Checkout must not scroll; remove things around the Whop embed | 07:38–09:12 | Partly (one heading removed); not fitted |
| M9 | Right panel: real product images/motion design, changes per step, storytelling | 09:37–11:42 | Placeholder mini-cards only; **manager would not accept these** |
| M10 | Payment before business info; business info has Skip; gate on first login if skipped | 13:20–15:18 | Done in source; migration unapplied |
| M11 | Smooth transitions between steps | 14:41 | Not done (full page loads) |
| M12 | Sign-in: partner-portal line same font/colour as "New to Insurvas?", same line | 16:43 | Done, needs browser check |
| M13 | Sign-in subtitle "Sign in to your workspace" | 17:41 | Done |
| M14 | Remove "Email me a link" | 18:10 | Done |
| M15 | Google button on sign-in says "Sign in with Google" | 18:10 | **Not done** (no Google route in this checkout) |
| M16 | Sign-in right panel = same showcase as sign-up | 15:52 | Uses shared panel; same problem as M9 |

## Findings from Rion's screenshots (29 Oct)

1. **"Open Gmail / Open Outlook" buttons look bad** (`components/app/verify-email-panel.tsx:136-143`).
   Two bare outline buttons, no icons, uneven width, sitting between the email chip and a
   spinner line. No structure.
2. **Right panel** does not match what the manager asked for (M9). The current `AuthShowcase`
   draws generic text cards ("Transfer queue / Ready for an agent"). He asked for what the
   software actually looks like, animated, as a story.
3. **Phone row misaligned** (`components/app/about-you-form.tsx:54-55`, same pattern in
   `business-profile-form.tsx`). Root cause: the country picker goes through `cn()`, so its
   `mt-0` overrides `authControl`'s `mt-1.5`; the number input uses plain string join, so both
   `mt-1.5` and `mt-0` stay and the CSS order picks `mt-1.5`. Result: the input sits 6px lower
   than the `+1` box. Picker also uses `rounded-md` vs the input's `rounded-lg`.

## Open questions (need an answer before the affected task)

1. **Google OAuth**: is the Google provider enabled in Supabase (prod + preview) with the
   callback URL set? Blocks A2. If not, who sets it up?
2. **Title Case** (M7): apply to labels, buttons and tabs app-wide, or only to the three he named?
   Recommendation: Title Case for labels/buttons/tabs, sentence case for helper text.
3. **Legal consent**: keep the required checkbox, or switch to "By continuing you agree…" under
   the button? Keep the checkbox until legal confirms.
4. **Showcase visuals** (A8): use screenshots from the real app (needs a seeded demo workspace),
   or animated recreations from the Remotion `insurvas-demo-video/` scenes?
5. **Migrations** `20261028400000_pricing_plan_intent.sql` and
   `20261028500000_payment_before_business_profile.sql`: who applies them, and to which
   environment first?

## Dependency order

```
A1 phone fix ─┐
A3 mail btns ─┼─ (independent, small)
A4 labels ────┘
A2 Google OAuth ── needs Q1 ── unlocks M1/M15 fully
A5 shared step footer ── A6 smooth transitions
A7 checkout fit (needs migrations applied to test end-to-end)
A8 showcase visuals ── needs Q4
A9 full journey review (after all above)
```

## Tasks

### A1. Fix the phone row alignment
**Acceptance:**
- Country box and number input share top edge, height (44px) and corner radius on About you and
  Business profile.
- Fix is in one place: a shared `PhoneField` (picker + input + error) used by both forms, built
  with `cn()` so overrides always win.
**Verify:** screenshot both forms at 1536×826 and 390px wide; lint passes.
**Files:** `components/app/about-you-form.tsx`, `components/app/business-profile-form.tsx`,
`components/public/phone-country-picker.tsx`, new `components/public/phone-field.tsx`.
**Size:** S

### A2. Wire Google sign-up and sign-in
**Acceptance:**
- Sign-up step 1: "Continue with Google" full width above an "or" divider, then email, password,
  Create account.
- Sign-in: "Sign in with Google" full width under the divider (M15).
- After Google sign-up the email counts as verified, so the "Confirm your email" step is skipped
  and the user lands on About you with the name pre-filled from Google.
- Existing email/password accounts that sign in with Google for the same address are handled
  (link or a clear error, not a silent duplicate).
**Verify:** sign up and sign in with a test Google account on a preview deploy.
**Files:** `components/public/signup-form.tsx`, `components/app/tenant-auth-workspace.tsx`,
a new `/auth/callback` route, `lib/signup/*`.
**Depends on:** Q1. **Size:** M

### A3. Redesign the "Confirm your email" screen
**Acceptance:**
- Gmail and Outlook buttons sit in one row, equal width (2 columns), each with the provider logo,
  same 48px height as the other buttons.
- Clear order top to bottom: heading → email chip → "Open your inbox" buttons → waiting status →
  one secondary "Send the link again" → "Wrong address?" link.
- No sign-out link (M3). Privacy · Terms · Support stay in the shared footer.
**Verify:** screenshot desktop + phone; keyboard tab order follows the visual order.
**Files:** `components/app/verify-email-panel.tsx`. **Size:** S

### A4. Title Case labels on the auth journey
**Acceptance:** "Independent agent", "For an Agency", "Primary State", and every label/button in
sign-up, About you, plan, business profile and sign-in follow the rule chosen in Q2.
**Files:** `components/app/plan-choice.tsx`, `components/app/business-profile-form.tsx`,
`components/app/about-you-form.tsx`, `components/public/signup-form.tsx`.
**Depends on:** Q2. **Size:** S

### A5. One step footer on every step
**Acceptance:**
- About you, Plan, Business profile and Checkout all use `FunnelStepFooter`: Back (outline) left,
  Continue (primary) right, same height and position on every step.
- No top "← Back to …" links anywhere in the funnel; no "Signed in as … · Sign out".
- Business profile shows "Skip for now" as a text button next to Back/Continue (M10).
- Enter submits the form.
**Verify:** walk every step by keyboard only.
**Files:** `components/app/funnel-frame.tsx`, onboarding pages under `app/app/onboarding/*`,
`app/app/checkout/page.tsx`. **Size:** M

### A6. Smooth step transitions
**Acceptance:**
- Logo, progress bar and right panel stay mounted between steps (shared layout); only the form
  area fades and slides ~8px (≈200ms).
- No white flash or layout jump between steps.
- Reduced-motion users get an instant swap.
**Files:** `app/app/onboarding/layout.tsx` (new or existing), `components/app/funnel-frame.tsx`.
**Depends on:** A5. **Size:** M

### A7. Checkout fits on one screen
**Acceptance:**
- At 1536×826 the whole checkout (Whop embed + plan card) is visible without page scroll.
- Left: Whop embed only (no duplicate heading/email block). Right column: compact plan card
  (plan, billing period, $0 today, 14-day trial, first charge date, Change plan link) and the
  "You won't be charged until…" line under it.
- When the plan came from Pricing, the plan step is skipped and this card is the only place the
  plan shows (M6).
**Verify:** screenshot at 1536×826, 1366×768 and phone; both entry paths (Pricing vs header
"Start free trial").
**Files:** `app/app/checkout/page.tsx`, `components/app/plan-choice.tsx`.
**Depends on:** Q5 for end-to-end testing. **Size:** M

### A8. Product showcase with real visuals
**Acceptance:**
- One scene per step, each showing real Insurvas UI (screenshot or recreated component with fake
  data): Inbound transfers → Dialer + DNC check → Lead cost to policy → Commissions.
- Scene changes with the step; while on one step it auto-advances every ~5s; pause control kept.
- Motion: soft crossfade + slide, product frame slightly tilted, small animated details (a row
  appearing, a number counting up) so it reads as "motion design", not a slideshow of text.
- Sign-in uses the same panel (M16).
- No real customer data. Reduced motion respected. Panel hidden below `lg`.
**Verify:** record a short screen capture of the full journey for the manager.
**Files:** `components/app/auth-showcase.tsx`, `auth-showcase.module.css`,
`public/showcase/*` (assets), possibly exported clips from `insurvas-demo-video/`.
**Depends on:** Q4. **Size:** L

### A9. Journey review before showing the manager
**Acceptance:**
- Walk both paths end to end on a preview deploy: Pricing → plan picked, and header
  "Start free trial" → chooser. Plus: skip business info → gate on first login.
- Desktop 1536×826 and phone 390px, light and dark.
- Every item M1–M16 ticked with a screenshot.
**Depends on:** A1–A8 and the two migrations applied to the preview database.

## Checkpoints

- **After A1, A3, A4:** quick visual pass with Rion (small fixes, no backend).
- **After A2, A5, A7:** full flow works with Google and email; checkout fits.
- **After A6, A8, A9:** ready to show the manager.

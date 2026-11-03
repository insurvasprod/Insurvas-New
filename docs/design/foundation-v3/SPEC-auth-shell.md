# Spec: auth-shell

Module 4 of the [UI Foundation v3 capability map](CAPABILITY-MAP.md). Depends on
`foundation-components` (committed in `d6732dd`). Status: **approved 2026-10-27 (44px fields everywhere; accept terms in the layout at 720px), built.**

## Objective

Give every sign-in and sign-up screen one layout, so they read as one product. Today they share a
split shell but each builds its own heading, stepper, inputs, alerts and right-hand panel. This
module makes the screens look the same. `signup-flow` then fixes what they say and adds Back
navigation.

**Users:** everyone who signs in or signs up: agency owners and agents, partners, Insurvas staff.

**Success looks like:** sign-in, every sign-up step, the account screens, the partner screens and
staff sign-in all show:
- the logo in the same place;
- a column of the same width;
- the same heading, field, button and alert styles;
- one right-panel style.

Nothing a user can do on any screen changes.

## What exists today

All of these use `PortalAuthSplitShell` (`components/portal/portal-auth-split-shell.tsx`): the
form column on the left, the dark-green panel with the ribbon on the right, and view transitions
between doors. It hides the panel below 1024px.

| Screen | How it is built | Differences |
|---|---|---|
| `/app/login` (sign-in, reset, 2FA, magic link) | Shell built inline in `components/app/tenant-auth-workspace.tsx:587` | Default `Input` (36px), `.portal-auth-alert`, story = label + 4 label/value rows |
| `/signup` (step 1) | `FunnelFrame` | `h-11` inputs with `--border-strong`, inline bordered error box, 5-bar stepper, story = 2 check-chip points |
| `/app/verify-email` (step 2) | `FunnelFrame` | `h-10` change form, left-border alert, no primary button |
| `/app/onboarding/business-profile` (step 3) | `FunnelFrame wide` (720px) | `authControl` (44px), no subtitle |
| `/app/onboarding/plan` (step 4) | `FunnelFrame wide` + `aside` | Panel replaced by `PlanChoiceSummary` (glass receipt) |
| `/app/checkout`, `/checkout/return` (step 5) | `FunnelFrame wide` + `aside` | Panel is a dark `Receipt`; return page uses an `h-11` button |
| `/app/welcome` (done) | `FunnelFrame step={6}` | Sign-in story |
| `/app/set-password`, `/app/confirm-email`, `/app/suspended`, `/verification-failed` | `AppAuthFrame` + `AuthCard` with its box removed | `AuthCard` title is 32px only, centred |
| `/app/accept-terms` | Plain centred page, **not** the shell | 820px column |
| `/partner/login`, `/accept-invite`, `/set-password` | `PartnerAuthFrame` | Story = bordered box with ✓/✗ list |
| `/admin/login` | Shell built inline in `app/admin/login/page.tsx:151` | Own 2-bar stepper, own error box, story = bordered box with lock list |

Five headings are drawn five ways, four stories in four styles, three input heights (36/40/44px),
four alert styles, and two separate stepper implementations.

## Scope

1. **`AuthLayout`** (new, `components/portal/auth-layout.tsx`): the only thing that renders
   `PortalAuthSplitShell`.
   - **Props:** `plane` (`"agent" | "partner" | "admin"`, which sets the portal class), `width`
     (`"default"` 472px | `"wide"` 720px), optional `steps`, optional `back`, `story` (or `aside`
     for real content), `children`.
   - **Column, top to bottom, always in this order:** logo (`AuthBrand`), steps, back link,
     heading, form, legal footer (Privacy · Terms · Support).
   - **`wide`** is only for screens whose content is a grid of choices or a document: Your agency,
     Your plan, Payment, accept terms.
2. **`AuthSteps`** (replaces `FunnelStepper` and the admin's inline stepper):
   - `{ current, total, label }` renders "Step 2 of 5 · Your email" over N bars;
   - `done` renders "All 5 steps done";
   - `FUNNEL_STEPS` stays the sign-up source.
3. **`AuthBack`:** a slot for "← Back to …" above the heading, as a real link. The layout renders
   it; `signup-flow` decides which steps get one and where it goes.
4. **`AuthHeading`** (replaces `FunnelHeading`, the sign-in `h1`, `AuthCard`'s title inside the
   frame, and the admin heading):
   - `--font-display`, 32px, and 40px from `sm`;
   - left-aligned, with an optional one-line description;
   - one bottom margin before the form.
5. **One story style:** `AuthStory { label?, title, rows }`, rendered in the sign-in panel's
   style: a small label, the large title, then rows with a hairline above each.
   - A row is `{ label, value? }` or `{ label, state: "yes" | "no" }`. The state renders as a
     check or a cross plus the word, never colour alone.
   - The four stories move to it with their **current words unchanged**. Changing the words is
     `signup-flow`'s job.
     - **Agent sign-in:** "Your floor is already running." with its 4 rows.
     - **Sign-up:** its 2 points become 2 rows.
     - **Partner:** its 5 boundary lines become 3 "yes" rows and 2 "no" rows.
     - **Admin:** its sign-in facts become rows.
   - `PlanChoiceSummary` (step 4) and `Receipt` (step 5) stay as `aside` content, because they are
     real content and not a story. They keep their layout and get the same panel padding and title
     style.
6. **One set of auth controls** (`components/portal/auth-controls.tsx` or extending
   `components/app/auth-card.tsx`):
   - **Fields:** labels at 14/600 and `authControl` inputs at **44px** (touch-first, as on every
     sign-up step today) on every auth screen, sign-in included. This includes password fields
     with the show/hide button, and the phone picker.
   - **Buttons:** the shared `Button` at 44px full width (`AuthSubmit`) for the primary action, and
     the outline variant for the secondary action. 8px corners come from `foundation-components`.
   - **Alerts:** one `AuthAlert` with `tone: "error" | "info" | "success"`, a one-line role alert
     on the status tokens. It replaces `.portal-auth-alert`, the inline bordered box, the
     left-border box and the admin error box.
   - The ratchet's `tall-control` rule gets an auth exemption list naming these files, since auth
     controls are deliberately 44px. App pages keep 36px.
7. **Move every screen in the table above onto `AuthLayout`:**
   - Delete `AppAuthFrame`, `FunnelFrame` and `PartnerAuthFrame`, or reduce each to a two-line
     wrapper over `AuthLayout` if that keeps the diff small.
   - Delete the inline shells in `tenant-auth-workspace.tsx` and `app/admin/login/page.tsx`.
   - `/app/accept-terms` moves into the layout (`wide`, sign-in story) instead of its plain page.
   - **No behaviour change:** every field name, request, redirect, polling loop, 2FA path and link
     stays exactly as it is.
8. **CSS:** auth rules in `globals.css` that nothing uses any more are deleted, for example
   `.portal-auth-alert` and the old `.portal-auth-header` / `.portal-auth-main` page chrome if
   unused. The split-shell rules stay.
9. **`/design/auth`** (dev only): `AuthLayout` in every combination, so the screens behind the
   sign-up state machine can be checked without driving a real sign-up:
   - default and wide;
   - with steps, back, alert, the four stories and the plan aside.
10. **Tests:**
    - **`lib/design/authShell.test.mjs`:**
      - only `auth-layout.tsx` imports `PortalAuthSplitShell`;
      - every auth route listed above renders through `AuthLayout`;
      - no auth file draws its own `h1` or stepper;
      - no auth file keeps its own `.portal-auth-alert` / ad-hoc alert box.
    - **The existing ratchet:** no rise.
11. **Docs:** `UI-CONSISTENCY.md` §13's layout half moves to **Live**, and its copy and Back half
    stays "Decided, lands in `signup-flow`". `components/portal/README.md` names `AuthLayout` and
    its parts.

Out of scope (`signup-flow`):
- any change to words, including "Start your free trial" and "Free trial. Card required.";
- which steps get Back and where Back goes;
- trial length and card wording from data;
- removing text.

Also out of scope: pricing, plan data, Whop checkout behaviour and the ribbon scene.

## Tech stack

Next.js 16.3 App Router (with React `ViewTransition`), React 19.2, Tailwind CSS 4, shadcn/ui,
Lucide. No new dependencies.

## Commands

```
Dev (visual check):  npx next dev --webpack -p 3002
Test:                npm test
One test:            node --experimental-strip-types --test lib/design/authShell.test.mjs
Types:               npm run typecheck
Lint:                npm run lint
Build:               npx next build --webpack
```

## Project structure

```
components/portal/auth-layout.tsx        → AuthLayout, AuthSteps, AuthBack, AuthHeading, AuthStory (new)
components/portal/auth-controls.tsx      → AuthField/authControl, AuthSubmit, AuthAlert (new or moved)
components/portal/portal-auth-split-shell.tsx → unchanged except used only by AuthLayout
components/app/funnel-frame.tsx, app-auth-frame.tsx, components/partner/partner-auth-frame.tsx → removed or thin wrappers
components/app/tenant-auth-workspace.tsx, app/admin/login/page.tsx → inline shells removed
the 17 auth route pages and their form components → render through AuthLayout
app/design/auth/page.tsx + components/design/auth-showcase.tsx → dev-only showcase (new)
lib/design/authShell.test.mjs            → structure contracts (new)
```

## Code style

Match the portal components: a doc comment above each export saying why, token colours only,
`cn()` for classes.

```tsx
<AuthLayout
  plane="agent"
  steps={{ current: 3, total: FUNNEL_STEPS.length, label: FUNNEL_STEPS[2] }}
  width="wide"
  story={<AuthStory {...SIGN_UP_STORY} />}
>
  <AuthHeading title="Tell us about your agency" />
  <BusinessProfileForm … />
</AuthLayout>
```

## Testing strategy

- **Structure contracts** (above) and the existing ratchet under `npm test`.
- **Visual check** on the dev server, light and dark, at 1280px and 375px:
  - **`/design/auth`:** every combination.
  - **Logged-out routes, opened directly:** `/app/login`, including the reset and magic-link
    states (switched in-page with no request sent), `/signup`, `/partner/login`, `/admin/login`,
    `/verification-failed`.
  - **The same measurements on every screen:** logo top, column left edge and width, heading font
    and size, and input height.
- **Behaviour, without writing data:**
  - required-field errors show in `AuthAlert`;
  - the show/hide password button works;
  - the stepper and links point where they did before (compared with `HEAD`).
- **No real submissions:** no sign-up or sign-in requests are sent.
- **Build:** `npx next build --webpack`, typecheck and lint pass; `npm test` shows no new failures
  beyond the 23 known ones.

## Boundaries

- **Always:** keep every request, redirect, field name and state transition identical; keep the view
  transitions; keep copy word-for-word (copy is `signup-flow`).
- **Ask first:** changing any text; removing a screen state; touching `/api/*` or
  `lib/signup/*`; changing the plan summary or receipt content.
- **Never:** submit a real sign-up, sign-in, password reset or checkout while testing; widen a
  feature gate; change pricing or Whop behaviour.

## Success criteria

1. `AuthLayout` is the only importer of `PortalAuthSplitShell`, and all 17 screens in the table
   render through it.
2. Across those screens, the following match within 1px at 1280px:
   - the logo position;
   - the column width (472 default, 720 wide);
   - the heading font (Inter Tight) and size;
   - the input height (44px);
   - the primary button height (44px).
3. One stepper (`AuthSteps`) serves sign-up and staff sign-in.
4. One right-panel style (`AuthStory`) serves agent, sign-up, partner and admin, with the current
   words. The plan and payment steps keep their summary and receipt.
5. One alert style (`AuthAlert`) on every auth screen.
6. `/app/accept-terms` uses the layout.
7. No text, request or redirect differs from `HEAD`. `authShell.test.mjs` passes and the ratchet
   does not rise.
8. Screenshots of `/design/auth`, `/app/login`, `/signup`, `/partner/login` and `/admin/login`,
   in light and dark, are attached to the hand-off.

## Open questions

1. **Input height on sign-in:** the spec makes every auth field 44px, so sign-in grows from 36px to
   match sign-up. The alternative is 40px everywhere. 44px is recommended: it is already what four
   of the five sign-up steps use, and these screens are often used on phones.
2. **`/app/accept-terms`:** it shows full legal documents. The spec moves it into the split layout
   at 720px, with the panel beside it. Say if it should stay a plain full-width page instead.

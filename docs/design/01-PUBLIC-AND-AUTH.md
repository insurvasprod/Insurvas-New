# 01 · Public and authentication

17 pages. Marketing, signup, sign-in, email verification, onboarding, checkout, legal.

Read [`00-FOUNDATION.md`](00-FOUNDATION.md) first.

## The funnel, as it actually runs

`signupDestination()` in `lib/signup/context.ts` is the authority on where a half-finished account
goes. The agent shell calls it on every render and redirects, so **no page in the funnel can be
skipped by typing a URL**:

```
userStatus = pending_verification            → /app/verify-email
onboardingState = business_profile           → /app/onboarding/business-profile
onboardingState = ready_for_checkout         → /app/checkout
onboardingState = awaiting_payment           → /app/checkout      ← abandoning is recoverable
otherwise                                    → the shell
```

Then two more shell-level gates, in order: outstanding legal documents → `/app/accept-terms`;
maintenance `locked` → `/maintenance`.

Design consequence: **each funnel page must state its own position** (`Step 2 of 3`) because the
reader can arrive at any of them directly, from an email, days later.

## Identity note

`/pricing`, `/signup` and `/legal/*` are the **blue** identity (`SiteHeader`, `--brand-800`).
Everything under `/app/*` is **orange** portal. This split is the subject of defect **D-16** — two
parallel signup systems. Do not silently unify; see the register.

---

## 1. Root — `/`

**File:** `app/page.tsx` (5 lines)
**Mockup:** none needed
**Gate:** none

`redirect("/pricing")`. Nothing renders, so there is nothing to design.

**Must do:** stay a server-side redirect. Do not turn it into a landing page that then bounces —
that costs a paint and breaks the back button.

**Must not:** become a marketing home page without a product decision. `/pricing` is currently the
front door and carries the hero copy.

---

## 2. Pricing — `/pricing`

**Files:** `app/pricing/page.tsx`, `components/public/pricing-page.tsx` (182), `components/public/site-header.tsx`
**Mockup:** NONE — design from foundation, Brex marketing mode
**Gate:** none. Public.
**Data:** `GET /api/public/plans`

**Purpose:** the front door — say what the product is and let a visitor pick a plan.

### Must do
- Fetch and render live plans. Never hard-code a price; plans are admin-managed and versioned.
- Each plan card links to `/signup?plan=<code>` with the code URL-encoded.
- Render a loading state (`aria-label="Loading plans"` exists today) and a failure state — if
  `/api/public/plans` fails, say so. Do not render an empty pricing page, which reads as "no plans
  for sale".
- Only plans marked public appear (enforced server-side; do not filter client-side).
- `h1` is currently "The operating system for modern insurance teams" — keep or rewrite with the
  owner, but keep exactly one `h1`.

### Controls
| Control | Destination |
|---|---|
| Header logo | `/pricing` |
| Header "Sign in" | `/app/login` |
| Header "Start free trial" | `/signup` |
| Plan card CTA | `/signup?plan=<code>` |

### Layout — Brex marketing mode
The one page in the product that gets the marketing treatment. Hero headline at 56/600/−0.035em on
`--color-page-bg`. Pricing cards share the feature-card system: white surface, 12px radius, 32px
padding, `--color-border` edge, no shadow at rest. Price in 32/600/−0.025em. Plan differentiation
comes from content and CTA emphasis, **not** from colour-blocking a card. Exactly one filled
primary CTA — the recommended plan; the others are `button-secondary`. Section rhythm 80–120px.
Stack to one column before the comparison grid gets cramped.

### Must not
- Invent plan names, prices or feature lists. Every number comes from the API.
- Colour-block the recommended plan in brand fill. A border, a badge and a filled CTA is the whole
  emphasis budget.
- Add glassmorphism, gradient hero, or animated counters.
- Hide the cheapest plan to drive upsell.

---

## 3. Public signup — `/signup`

**Files:** `app/signup/page.tsx`, `components/public/signup-form.tsx` (278)
**Mockup:** NONE for this path. `34-agent-signup.png` designs the *other* signup (see D-16).
**Gate:** none. Rate-limited by IP server-side.
**Data:** `GET /api/public/plans`, `GET /api/public/legal`, `POST /api/public/signup`

**Purpose:** create a workspace, a user, and a plan selection in one transaction.

> **Decide D-16 before redesigning this page.** It duplicates `/app/signup`. If the portal path
> wins, this becomes a redirect and this prompt is void. If this one wins, it should adopt the
> orange split-shell and `34-agent-signup.png`. Redesigning both is wasted work.

### Must do
- Accept `?plan=` and `?cycle=` and preselect them. A visitor who chose a plan on `/pricing` must
  not choose again.
- Validate before submit: password ≥ 12 characters, passwords match, all of workspace name, full
  name, email present. Show errors next to their field.
- Render current legal documents from `GET /api/public/legal` and link each to `/legal/<doc_type>`.
  Acceptance is recorded against a **version**, so the link must resolve to the version shown.
- On success, follow the server's destination — it lands in the funnel, normally
  `/app/verify-email`.
- On failure, keep every entered value. Re-typing an agency name because the email was taken is the
  most avoidable abandonment in the funnel.
- Never echo a submitted password back into the DOM.

### Controls
| Control | Destination / effect |
|---|---|
| Submit | `POST /api/public/signup` → funnel |
| "Already have an account?" | `/app/login` |
| Legal links | `/legal/<doc_type>` |
| Back to plans | `/pricing` |

### Layout
Two columns ≥ 1024px: form left, order summary right (plan, cycle, price, trial length, what
happens next). Summary is sticky. Below 1024px, summary moves **above** the form so the reader sees
what they are buying first. Single primary submit; label states the outcome — "Create workspace and
continue", not "Submit".

### Must not
- Take payment details. Card entry happens only on the provider's hosted page.
- Let the submit button be pressable twice.
- Show a plan the API did not return.
- Put a second primary action anywhere on the page.

---

## 4. Agent sign-in — `/app/login`

**Files:** `app/app/login/page.tsx`, `components/app/tenant-auth-workspace.tsx` (132), `components/portal/portal-auth-split-shell.tsx`
**Mockup:** `31-agent-login.png` — **authoritative.** Also in generated set (orange split, "Run your agency from one calm workspace.")
**Gate:** none. `export const dynamic = "force-dynamic"`.
**Data:** `fetchPublicPlans()`, `getMaintenanceStatus()` (both server-side, both `.catch(() => …)`), `POST /api/app/auth/login`

**Purpose:** get a licensed agent into their workspace.

### Must do
- Both modes in one component: `initialMode="sign-in"` here, `"sign-up"` on `/app/signup`.
  Switching modes must not reload the page or lose typed input.
- Show the maintenance notice when `getMaintenanceStatus()` reports one. Both data reads are
  wrapped in `.catch()` so the page **still renders sign-in if they fail** — preserve that. A
  failing plans query must never block a returning customer from signing in.
- Password visibility toggle with `aria-pressed` and an `aria-label` that changes with state.
- On failure, one message above the submit. Never reveal whether the email exists.
- Errors clear on the next keystroke.

### Controls
| Control | Destination / effect |
|---|---|
| Sign in | `POST /api/app/auth/login` → shell (funnel decides) |
| Forgot password | `mailto:support@insurvas.com?subject=Password%20help` |
| Create a workspace | switches mode in place |
| Privacy / Terms | `/legal/privacy`, `/legal/tos` |
| Support | `mailto:support@insurvas.com` |

> "Forgot password" is a `mailto:`, not a reset flow. That is the current truth. If a self-serve
> reset is wanted it is new work — do not design a form for an endpoint that does not exist.

### Layout — the split shell
Form left on `--portal-canvas`, story panel right on near-black `#15191e`. Below 1024px the story
panel drops entirely — it is reassurance, not content, and must never push the form below the fold.

Left: wordmark, `Licensed agent` eyebrow, `Welcome back` at 40–48/600, one line of subtitle, then
the form. Fields use `--color-control-border`. Submit is the single orange action, full width.

Right: 40/600 headline, three or four benefit rows each with an icon in a rounded-square tile
(orange glyph on a dark tile). Muted footer line. No photography, no gradient mesh.

### Must not
- Autofocus the password field.
- Disable paste on password.
- Say "Invalid password" — it confirms the email exists.
- Let the dark story panel and the orange button compete: the button is the only saturated element.
- Drop the `.catch()` fallbacks on the two server reads.

---

## 5. Agent signup — `/app/signup`

**Files:** `app/app/signup/page.tsx`, `components/app/tenant-auth-workspace.tsx` (`initialMode="sign-up"`)
**Mockup:** `34-agent-signup.png` — **check before use**; drawn from an orphaned component (D-17)
**Gate:** none
**Data:** `fetchPublicPlans()`, `POST /api/app/signup`

**Purpose:** same as `/signup`, in the portal identity. See **D-16**.

### Must do
- Everything in § 3 (Must do), plus:
- Inline plan picker: a radio list of live plans, each showing name, description and the cycles
  offered with prices. Selecting a plan must recompute which billing cycles are available — a plan
  with no yearly price must not offer yearly.
- Billing-cycle `<select>` disabled when no cycle is available.
- When `plans` is empty, say "Plans are temporarily unavailable" **and disable submit**. Never let
  someone submit a signup with no plan.
- Both password fields have independent visibility toggles with distinct `aria-label`s.

### Controls
| Control | Destination / effect |
|---|---|
| Create workspace and continue | `POST /api/app/signup` → funnel |
| Plan radio | selects plan, recomputes cycles |
| Billing cycle select | sets cycle |
| Sign in | switches mode in place |
| Privacy / Terms / Support | `/legal/privacy`, `/legal/tos`, `mailto:` |

### Layout
Same split shell, form column scrolls. Order: identity → credentials → plan → cycle → submit. The
plan block sits on `--portal-group` to separate "who you are" from "what you are buying". Selected
plan card: orange border + orange check, not an orange fill.

### Must not
- Show a "No charge in local demo" style reassurance in production. The current build renders
  exactly that string — replace with the real trial terms from the plan.
- Take payment details.
- Preselect the most expensive plan when no `?plan=` was given.

---

## 6. Verify email — `/app/verify-email`

**Files:** `app/app/verify-email/page.tsx`, `components/app/verify-email-panel.tsx` (150)
**Mockup:** `35-agent-verify-email.png` — authoritative
**Gate:** session required (page reached via the funnel)
**Data:** `GET /api/app/onboarding/status`, `POST /api/app/onboarding/verification`

**Purpose:** hold the account until the address is proven, and make the wait recoverable.

### Must do
- Show the address the link went to. The commonest failure is a typo, and the reader cannot see it
  otherwise.
- Resend, with a visible cooldown and a disabled button during it. The mockup shows "Available
  again in 42 seconds" — keep that pattern; a disabled button with no countdown reads as broken.
- Correct-the-address affordance ("Wrong address?") that updates the email and sends a fresh link.
- Say the link's lifetime (24 hours) and that it expires after use.
- Poll or otherwise advance automatically once verified — the mockup promises "Return here
  automatically after verification" and the page must honour it.
- Keep a Sign out control. This page is a dead end otherwise.

### Controls
| Control | Destination / effect |
|---|---|
| Resend verification email | `POST /api/app/onboarding/verification` |
| Update address | same endpoint with the new email |
| Cancel | closes the correction panel |
| Sign out | `POST /api/app/auth/logout` → `/app/login` |
| Help / Privacy / Terms | `/pricing#help`, `/legal/privacy`, `/legal/tos` |

### Layout
Centred single card, `max-w-2xl`, on `--portal-canvas`. Orange mail glyph in a tinted circle,
`Step 1 of 3`, `h1`, one line of explanation, then the address in a `--portal-group` row with a
"Sent just now" status chip. Numbered "What to expect" list. Resend is the primary action. The
correction panel is a collapsed disclosure, not a second visible form.

### Must not
- Claim the mail was delivered. "Sent" is what is known.
- Hide the address behind "your email".
- Allow unlimited resends.
- Let this be the only place the state is enforced — the shell redirect is the real gate.

---

## 7. Confirm email — `/app/confirm-email`

**Files:** `app/app/confirm-email/page.tsx`, `components/app/confirm-email-panel.tsx` (123)
**Mockup:** `30-agent-confirm-email.png` — authoritative
**Gate:** token in the query string
**Data:** `GET /api/app/auth/confirm-email?token=…`, `POST /api/app/auth/confirm-email`

**Purpose:** confirm a **change** of address, arrived at from a link in the new inbox.

### Must do
Three distinct terminal states, each with its own copy and its own action:
1. **Pending** — show current and new address side by side. State plainly that the existing address
   keeps working until confirmation. Primary: "Confirm email address".
2. **Confirmed** — "Email updated", then route to `/app/login` (the session changes).
3. **Invalid or expired** — "Link no longer valid", explain single-use and expiry, offer a way
   forward. Never a blank page or a raw error.

Also: single-use notice, and a "Didn't request this change? Contact your administrator" escape —
this page is a security-relevant moment.

### Controls
| Control | Destination / effect |
|---|---|
| Confirm email address | `POST /api/app/auth/confirm-email` |
| (on success) | `router.push("/app/login")` |
| Contact your administrator | support route |
| Back to sign in | `/app/login` |

### Layout
Centred card, `max-w-xl`. Orange `@` glyph in a tinted circle. The address comparison is a
two-row `--portal-group` block with a status chip per row: current = green "Still active", new =
orange "Awaiting confirmation". That contrast is the whole point of the screen — build it as one
block, not two paragraphs.

### Must not
- Confirm on page load. A GET that mutates gets fired by link previewers and scanners.
- Reveal any other account's address.
- Show a generic "Something went wrong" for an expired link; that is an expected state.

---

## 8. Set password — `/app/set-password`

**Files:** `app/app/set-password/page.tsx`, `components/app/set-password-form.tsx` (162)
**Mockup:** `33-agent-set-password.png` — authoritative
**Gate:** invitation token in the query string
**Data:** `GET <endpoint>?token=…` then `POST`. Props default to `/api/app/auth/set-password` and
`loginPath="/app/login"` — the component is shared with the partner portal, which passes its own.

**Purpose:** an invited user chooses their first password.

### Must do
- Three states, as § 7: **form**, **"Password set"**, **"Link no longer valid"**.
- Show invitation context before the fields: organization, role, expiry. The reader needs to know
  which workspace they are joining — some users belong to several.
- Live requirement checklist, each rule ticking green as satisfied. The mockup shows ≥ 12
  characters, one uppercase, one number, one symbol, plus a strength meter. **The displayed rules
  must match what the endpoint enforces** — a checklist that goes all-green and then fails
  server-side is worse than no checklist.
- Confirm field with live match feedback.
- Submit disabled until every rule passes.
- State the invitation is single-use.
- Keep `endpoint` and `loginPath` as props. Do not hard-code agent paths.

### Controls
| Control | Destination / effect |
|---|---|
| Set password & continue | `POST <endpoint>` |
| Visibility toggles | local |
| Need a new invitation? | support / administrator |
| Back to sign in | `loginPath` |

### Layout
Centred card, `max-w-xl`. Orange key glyph. Context strip as a three-column
`--portal-group` block (Organization · Role · Invitation expires). Checklist on
`--portal-group` with the strength meter top-right as four segments. Green ticks for satisfied
rules; unmet rules stay an outline circle in `--portal-muted` — never red before the user has
typed.

### Must not
- Show requirements only after a failed submit.
- Use red for a not-yet-met rule.
- Accept a password the API will reject.
- Sign the user straight in unless the endpoint issues a session; otherwise send them to
  `loginPath`.

---

## 9. Business profile — `/app/onboarding/business-profile`

**Files:** `app/app/onboarding/business-profile/page.tsx`, `components/app/business-profile-form.tsx` (128), `components/public/onboarding-frame.tsx`
**Mockup:** `32-agent-business-profile.png` — authoritative
**Gate:** signup context; redirects away if this is not the current step
**Data:** `POST /api/app/onboarding/business-profile`

**Purpose:** collect the few facts that personalise the post-checkout setup checklist.

### Must do
- `Step 2 of 3` with the three steps visible and their states (Account complete · Business profile
  current · Checkout upcoming).
- Collect: business name, NPN, primary state, products sold (multi), monthly application volume,
  lead sources (multi).
- Explain why the NPN is wanted and who sees it. The mockup's note — "used for agency setup and
  verification, not shown to partners" — is the right level of candour for a licence number.
- Show the derived setup preview live as answers change. It is the reason the questions are being
  asked, and it makes the form feel like it is doing something.
- `recommended_setup_steps` produced here is read later by `/app/checkout`. Keep the contract.
- Persist on submit and advance via the funnel.

### Controls
| Control | Destination / effect |
|---|---|
| Save and continue | `POST …/business-profile` → `/app/checkout` |
| Back | previous step |
| Save and exit | persists, leaves the funnel |
| Product / lead-source toggles | local, recompute preview |

### Layout
`OnboardingFrame` (centred, `max-w-3xl`) with a stepper across the top. Two columns ≥ 1024px: form
left, live "Your setup preview" + "Business summary" right. Multi-selects are checkbox **cards** in
a wrapping grid — selected gets an orange border and tinted fill, not a filled orange block.
Preview steps are a numbered list. Below 1024px the preview moves below the form.

### Must not
- Make every field required. This is personalisation; a blocked funnel costs more than a blank
  field.
- Validate the NPN against a registry — there is no such integration.
- Promise that a preview step will happen if the plan may not grant it.

---

## 10. Checkout handoff — `/app/checkout`

**Files:** `app/app/checkout/page.tsx`, `components/public/checkout-start.tsx` (105)
**Mockup:** `28-agent-checkout.png` — authoritative
**Gate:** signup context; `userStatus` must be `active`; redirects if this is not the step
**Data:** reads `signup_selections`, `business_profiles`, `plans` server-side. `POST /api/app/checkout/coupon`, `POST /api/app/checkout/start`

**Purpose:** confirm what is being bought, then hand off to the provider's hosted page.

### Must do
- Show the selected plan, billing cycle, price, and trial length from the database — never a
  literal.
- Show the personalised setup steps from the business profile.
- Coupon entry validated **before** handoff via `POST /api/app/checkout/coupon`. The ticket's
  requirement is that a dead code is rejected here, not discovered on the provider's page. On
  success say plainly whether the discount auto-applies — the current copy ("Enter it on the
  payment page to get your discount—it is not applied automatically") is exactly right if that is
  the behaviour.
- Say clearly that the card is entered on the provider's page and never touches Insurvas servers.
  This is true (`lib/checkout/start.ts`) and it is the strongest trust signal available.
- State the trial terms and the cancel-by date.
- Reusing an open session is correct: an abandoned checkout returns to the same page.
- Offer a route back to change plan (`/pricing`).
- `?pending=1` (set by the return page when the provider has not confirmed) must render a calm
  "still confirming" notice — **not** an error. The commonest cause is a customer who backed out.

### Controls
| Control | Destination / effect |
|---|---|
| Continue to secure checkout | `POST /api/app/checkout/start` → provider URL |
| Apply (coupon) | `POST /api/app/checkout/coupon` |
| Change selected plan | `/pricing` |
| Terms / Refund policy | `/legal/*` |

### Layout
`OnboardingFrame`. Green check + "Your workspace is ready" as the header — this is a reassurance
moment, the only place green outranks orange. Two columns: left = selected plan, setup preview,
coupon, primary CTA; right = sticky order summary (plan, billing, price, today's charge, after
trial, next charge date). Card-safety line with a shield glyph sits directly under the CTA, never
in a footer.

### Must not
- Render a card field.
- Claim a discount amount the provider has not confirmed.
- Show `$0` for "today" without also showing what is charged after the trial and when.
- Treat `?pending=1` as a failure.

---

## 11. Checkout return — `/app/checkout/return`

**File:** `app/app/checkout/return/page.tsx` (71)
**Mockup:** `29-agent-checkout-return.png` — designs a waiting state the route does not currently render
**Gate:** signup context
**Data:** `verifyCheckoutWithProvider()`, `completeCheckout()`

**Purpose:** verify with the provider that a membership exists, then grant access.

**This page renders nothing today.** It is a server component that verifies and redirects:

```
no open session      → /app/dashboard
not confirmed        → /app/checkout?pending=1     (logged as a warning, not an error)
confirmed            → /app/dashboard?welcome=1    (completion failure is logged, not shown)
```

The security reasoning is load-bearing and must not be softened: this URL is a GET with no secret,
so landing here proves nothing. It previously trusted the local plan selection and granted a trial
outright, which made typing the URL enough to get the product free. It now **asks the provider**.
The signed `membership.activated` webhook is the second, independent path.

### Must do
- Keep provider verification before any grant. Never infer payment from arrival.
- Keep `?pending=1` as a redirect to checkout, not an error page.
- If `completeCheckout` throws after the provider confirmed, let the customer through and log
  loudly — they have paid; the webhook will reconcile.

### If you implement the mockup
Only worth building if verification becomes slow enough to need a waiting room. Then: centred card,
three-step progress (Returned → Verifying → Activate), "this usually takes a few seconds", the
never-stores-card reassurance, and a Return-to-checkout escape. Poll a status endpoint; **never**
grant access client-side.

### Must not
- Show a failure screen for an unconfirmed return.
- Grant entitlement from the browser.
- Add a client-side redirect on top of the server one.

---

## 12. Accept terms — `/app/accept-terms`

**Files:** `app/app/accept-terms/page.tsx`, `components/app/accept-terms-panel.tsx` (165)
**Mockup:** `27-agent-accept-terms.png` — authoritative
**Gate:** session required; redirects to `/app` when nothing is outstanding
**Data:** `outstandingDocuments()`, `fetchDocument()`, `POST /api/app/legal/accept`

**Purpose:** block the product until a materially changed document is accepted.

Deliberately **outside** the `(shell)` route group — the shell redirects here whenever anything is
outstanding, so a page inside it would redirect to itself forever. Do not move it.

### Must do
- Render the **full text** inline, not a link. The page loads it server-side specifically so
  "accept without reading" is harder to argue. Do not replace it with a link.
- Show version and effective date.
- Show "What changed" from `change_summary` and link the previous version when one exists.
- Draft documents carry a visible draft warning (a real state: `is_draft`).
- Explicit checkbox per document; the accept button stays disabled until all are ticked.
- Say that the acceptance, its timestamp and the version are recorded.
- Handle multiple outstanding documents in one pass.
- On success, `router.push("/app")`.

### Controls
| Control | Destination / effect |
|---|---|
| I have read and agree | enables accept |
| Accept and continue | `POST /api/app/legal/accept` → `/app` |
| Read version N | `/legal/<type>?v=N` |
| Download PDF | only if a real endpoint exists — otherwise omit |

### Layout
Centred `max-w-3xl`. Notice card, then the document card: title, effective date, a
`--portal-group` "What changed" block with the previous-version link on the right, then the text in
a scrollable region with a visible scrollbar. The acceptance bar is **sticky at the bottom** with
the checkbox left and the primary right; disabled state is visibly disabled, not merely dimmed.

### Must not
- Offer a way past without accepting.
- Pre-tick the checkbox.
- Summarise the terms in place of showing them.
- Ship a "Download PDF" button with no endpoint.

---

## 13. Legal document — `/legal/[type]`

**Files:** `app/legal/[type]/page.tsx` (79), `components/public/legal-document-body.tsx` (57)
**Mockup:** NONE — design from foundation
**Gate:** none. Public, and must stay public — acceptance records point here.
**Data:** `fetchDocument(docType, version?)`

**Purpose:** render a legal document at a specific version, forever.

`?v=1` must keep working after v2 publishes. That is what makes an acceptance record meaningful: the
record stores a version, and this URL turns that version back into the words the person saw.

### Must do
- Validate `type` against `LEGAL_DOC_TYPES`; 404 otherwise.
- `?v=` must be a positive integer; 404 otherwise. Never coerce a bad value to the current version.
- Show version and effective date prominently.
- Draft banner when `is_draft`.
- **Superseded banner** when a newer version exists, with a link to current, and the explanation of
  why the old text is still here: people accepted it, and what they accepted is what it says.
- Per-version `generateMetadata` title.

### Controls
| Control | Destination |
|---|---|
| Header logo / Sign in / Start free trial | `/pricing`, `/app/login`, `/signup` |
| "Read the current version" | `/legal/<type>` |

### Layout
Blue identity, `SiteHeader`, `max-w-3xl`, white document card. Version line in
12/600/uppercase/+0.02em `--brand-600`. Body at 16/400/1.5 with generous heading spacing; `h2` and
`h3` scale down proportionally. Banners are bordered tinted blocks above the body: draft =
warning, superseded = neutral. Legal text is the one place in the product where line length
discipline matters most — cap the measure.

### Must not
- Paginate or collapse sections behind accordions. It must be readable and printable in one pass.
- Require a session.
- Change the text of a published version. Publish a new one.

---

## 14. Affiliate intake — `/affiliate/[slug]`

**Files:** `app/affiliate/[slug]/page.tsx` (5), `components/affiliate/affiliate-intake-form.tsx` (60)
**Mockup:** NONE — design from foundation
**Gate:** none. Public, unauthenticated, consumer-facing.
**Data:** `GET /api/affiliate/<slug>`

**Purpose:** a consumer arrives from an affiliate link and asks to be contacted by a licensed agent.

**The only page in the product a member of the public fills in.** It is the highest-risk page for
consent and the lowest-effort page in the codebase (60 lines). Treat it accordingly.

### Must do
- Resolve the slug first. An unknown or inactive one renders "Referral unavailable" — never a blank
  form that silently discards a submission.
- Explicit, unbundled consent to be contacted by phone and SMS, with the wording visible and
  unticked by default. This record is the TCPA defence; it must be a deliberate act.
- Minimum fields only. Every extra field on a consumer form is abandonment and a larger breach
  surface.
- Confirmation state naming what happens next and roughly when.
- Full client-side validation before submit — this reader will not retry.

### Controls
| Control | Destination / effect |
|---|---|
| Submit | `POST /api/affiliate/<slug>` |
| Consent checkbox | required, defaults unticked |
| Privacy | `/legal/privacy` |

### Layout
Single centred card, `max-w-xl`, generous touch targets — assume mobile. No sidebar, no product
nav; the reader is not a customer. Show the affiliate's name so the page is recognisable. Consent
sits in its own bordered block directly above submit, at 14/400 and genuinely readable — not 11px
grey.

### Must not
- Pre-tick consent, or bundle phone and SMS consent into one statement with anything else.
- Ask for SSN, date of birth, or coverage amount. Not on an unauthenticated public form.
- Promise a callback time the agency has not committed to.
- Render the form before the slug resolves.

---

## 15. Maintenance — `/maintenance`

**File:** `app/maintenance/page.tsx` (40)
**Mockup:** NONE
**Gate:** none. The shell redirects here when maintenance level is `locked`.
**Data:** `getMaintenanceStatus()`

**Purpose:** say the platform is down, for how long, and stay honest when it comes back.

### Must do
- Re-check status on render. If no longer locked, show "The platform is available again" and a
  sign-in link. A maintenance page that outlives the maintenance is its own outage.
- Show the admin-set message when present; a sane default otherwise.
- Show expected end when `scheduledEnd` is set.
- Keep the admin sign-in link — staff need in while customers are out.

### Controls
| Control | Destination |
|---|---|
| Continue to sign in (recovered only) | `/app/login` |
| Admin sign in | `/admin/login` |

### Layout
Centred card, `max-w-lg`. Warning-tinted wrench glyph, `We'll be back shortly`, the message, the
expected end as a caption. Admin link is `variant="outline"` — present, not prominent.

### Must not
- Show a spinner implying auto-recovery unless it actually polls.
- Invent an end time.
- Use `--color-danger`. Planned maintenance is warning, not error.

---

## 16. Verification failed — `/verification-failed`

**File:** `app/verification-failed/page.tsx` (23)
**Mockup:** NONE
**Gate:** none
**Purpose:** an email verification link was invalid or expired.

### Must do
- Name both causes (invalid, expired) so the reader can tell whether they did something wrong.
- Give the exact recovery: sign in with the account you created, then request a fresh 24-hour link.
- Single primary action to `/app/login`.

### Controls
| Control | Destination |
|---|---|
| Sign in and resend | `/app/login` |

### Layout
`OnboardingFrame`, centred `max-w-lg` card, warning triangle. Three lines and one button. Resist
adding more.

### Must not
- Use danger red — the user did nothing wrong.
- Offer a resend button here; there is no session, so it cannot work. Send them to sign in.

---

## 17. Agent home — `/app`

**File:** `app/app/page.tsx` (6)
**Mockup:** `26-agent-home-redirect.png` designs an "Opening your workspace" interstitial
**Gate:** none directly; the shell gates everything downstream
**Purpose:** `redirect("/app/dashboard")`.

Dashboard is always entitled, so it is a safe landing place.

### Must do
Stay a server redirect. It is instant and costs no paint.

### On the mockup
`26-agent-home-redirect.png` (and `agent-floor.tsx`'s loading state, which is the same design)
shows a progress card. **Do not add it here** — an interstitial in front of an instant redirect
makes the product slower to feel. The design is already correctly used as `AgentFloor`'s loading
state; leave it there.

### Must not
Become a second dashboard, or a client component with a `useEffect` redirect.

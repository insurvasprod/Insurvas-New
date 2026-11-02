# Auth doors — research and evidence (2026-10-30)

Input to [`CAPABILITY-MAP.md`](CAPABILITY-MAP.md). Nothing here is a decision; it is what was read,
measured and found. Owner's ask: *"search and analyze sign in / sign up of big companies, how we can
make it better and easier to use, have a great design — especially that right part with that
animation, it's really simple bad and it's not working good."*

**How this was gathered:** eight sign-in pages opened first-hand on 2026-10-30 and read from the
live DOM (not from blog round-ups); our own doors inspected running on `http://localhost:3000/design/auth`
at 1536×826 in dark and light, measured in the page; `components/app/auth-showcase.tsx`,
`auth-showcase.module.css`, `components/portal/auth-layout.tsx`,
`components/portal/portal-auth-split-shell.tsx`, `components/app/tenant-auth-workspace.tsx` and the
auth block of `app/globals.css` read in full.

---

## A. What big companies actually do

Read live, 2026-10-30. "Panel" = a second column beside the form.

| Product | Layout | First thing asked | Other ways in | Panel |
|---|---|---|---|---|
| Linear | Centred, one column, dark | *Continue with Google* (first button) | Email, SAML SSO, **passkey** | none |
| Vercel | Centred, one column | Email, then providers | — | none |
| Stripe | Centred, one column | Email **and** password together | Google, **Passkey**, SSO under "Or sign in with" | none |
| Intercom | Centred, one column | Account region, then Google, then work email + password | SAML SSO | none |
| Pipedrive | Centred, one column | Email + password | Google, SSO ("or access quickly") | none |
| HubSpot | Split | **Email only → Continue** | — | static: one line + "Get a demo" |
| Ramp | Split | **Email only → Continue** | — | static marketing panel |
| Attio | Split | Google, then email | — | static: one value sentence + **one customer quote** (name, role, company) |

### What the pattern says

1. **Nobody runs an auto-rotating product carousel on a sign-in page.** Five of eight have no panel
   at all. The three that do show one static thing: a sentence, or a single quote. Not four scenes,
   not a numbered pager, not a tilted 3D mock.
2. **Identifier-first is the split-layout norm.** Both CRM-adjacent split layouts (HubSpot, Ramp)
   ask for the email alone and route on Continue. Our door asks email + password up front, which is
   the centred-layout pattern (Stripe, Pipedrive).
3. **Passkeys are now first-class, not exotic.** Stripe lists Passkey beside Google and SSO; Linear
   offers passkey log-in. We have none.
4. **Social/SSO is always separated from the password form** by a labelled divider ("or", "or access
   quickly", "Or sign in with"). We do this correctly already.
5. **Every one of them keeps the sign-in page visually quiet.** The brand carries it; motion does not.

### Supporting guidance

- Chrome's identity guidance (updated Oct 2026) recommends **Conditional UI** for passkeys —
  `autocomplete="webauthn"` on the username field, so a saved passkey offers itself in the normal
  autofill sheet — paired with an explicit "Sign in with a passkey" button, and advises against
  Immediate UI on a dedicated sign-in page.
- Carousel guidance is consistent that auto-rotation pulls attention off the task; the accessibility
  minimum, where rotation stays, is a pause control plus pause on hover and focus. A testimonial
  reads better when it stays until the reader moves it.
- Reddit reported a ~90% lift in desktop sign-ups after adding Google One Tap beside its existing
  Google button; the general finding across sign-up write-ups is that fewer fields in the first step
  means less drop-off. (Vendor and secondary sources — directional, not controlled data.)

---

## B. Our right panel — what is actually wrong

The panel is `AuthShowcase` (`components/app/auth-showcase.tsx`, 299 lines, plus a 113-line CSS
module): four scenes, each a miniature of the app, auto-advancing every 7 seconds, with a pause
button and a numbered 1·2·3·4 pager under it. Severity: **P0** breaks the screen · **P1** materially
wrong · **P2** friction · **P3** polish.

### P0 — the miniature does not fit its own column

Measured in the page at 1536×826, identical in all four scenes:

| | x |
|---|---|
| Panel content box (after the panel's 64px padding) | **827 → 1462** |
| The miniature's rendered box | **856 → 1496** |

The mock sits **29px right of the heading it belongs to** and runs **34px past the column** into the
padding. It is not clipped only because the shell is `overflow: hidden`. Nothing lines up — the
eyebrow, the title, the paragraph and the thing they describe all start at different x. That is most
of why the panel reads as unfinished.

Cause: `.frame` combines `zoom: 0.86` with `transform: rotateY(-7deg) rotateX(4deg)` and
`transform-origin: 30% 50%` under `perspective: 1400px`. The rotation makes the painted box wider
than the layout box, and the 30% origin pushes it right.

### P0 — the miniature's text is unreadable

The mock is drawn at the app's real type scale, then shrunk by `zoom: 0.86` **and** rotated in 3D.
Body text inside it lands at roughly 8px effective, on a tilted, resampled surface. "Mutual of Omaha
· October statement" and "Work › Commissions" are illegible at the owner's screen size. A product
shot that cannot be read is decoration pretending to be proof.

### P1 — it moves while you are typing your password

The scene advances on a 7-second interval on the **sign-in** door, where the only job is to type
credentials. It pauses on mouse-over and on keyboard focus — correct, and better than most — but the
default state for someone reading the form with the pointer parked elsewhere is motion, every 7
seconds, in the corner of their eye.

### P1 — five decorative tab stops

The miniature is `aria-hidden="true"`, yet the panel contributes **five focusable controls** —
Pause, and "Show … preview" ×4 — to the page's tab order. They sit after the form, so a keyboard
user tabbing past the submit button lands inside a decoration.

### P1 — nobody on a phone ever sees it

`app/globals.css:1851` — below 1024px, `.portal-auth-split-story { display: none; }`. All of this
work (299 lines of TSX, 113 of CSS, four hand-built app miniatures) is desktop-only, and the mobile
sign-in gets no brand content at all, not even one line.

### P2 — the controls look like a slideshow widget, not like us

A circular **1 2 3 4** pager plus a pause button is the visual language of a marketing slider. It is
the only place in the product with numbered round buttons, and it sits at the bottom-right of our
most-seen page.

### P2 — five infinite animations run forever

`frame-float` (7s), `ring` (1.6s), `glow` (2s), `live` (1.8s) and `progress` (7s) all loop with no
end. `frame-float` animates a 3D transform on a subtree that also carries `zoom` — the expensive
combination. All are correctly disabled under `prefers-reduced-motion`.

### P3 — the docs and a live test say this panel does not exist

- `docs/design/UI-CONSISTENCY.md` §13 still states: *"The brand panel is still: `--brand-700` with
  one soft light, no ribbon or other motion (owner, 2026-10-27)."*
- `app/globals.css:3183` repeats it in a comment.
- `lib/design/signupCopy.test.mjs` has a **passing** test named *"the sign-in and sign-up brand panel
  is still: no ribbon, no WebGL"* — it passes only because it checks for the *old* ribbon component
  by name, so the carousel added on 2026-10-28 went straight past it.

The rule, the comment and the test all describe a still panel; the code ships a moving one. Whatever
we decide, this contradiction gets resolved in the same change.

---

## C. The sign-in door — what else is in the way

Read from `components/app/tenant-auth-workspace.tsx` (498 lines).

- **Both fields up front.** Email + password together, so the door cannot route an address to
  Google, to SSO, or to "you have no password yet" before the person has already guessed.
- **No passkey.** Not offered, not enrolled, and the email field carries no `autocomplete="webauthn"`,
  so a saved passkey cannot even offer itself through autofill.
- **The magic link is unreachable.** `linkRequestPanel` and `/api/app/auth/sign-in-link` are fully
  built, but the "Email me a link" entry point was removed on 2026-10-28; the panel now appears only
  for someone who already arrived holding a link. Working code, no door to it.
- **Worth keeping:** the last-used address is remembered and focus goes straight to the password; the
  429 lock-out explains itself in minutes instead of lying about the password; the OTP auto-submits
  on the sixth digit; "Trust this device" sits on the code step, where it belongs.
- **Three doors, three experiences.** `/app/login` (agent), `/partner/login` and `/admin/login` share
  `AuthLayout` but not their panel, their alternatives, or their recovery paths.

## D. The sign-up funnel — what the rules already fix, and what they do not

Five steps (account → email → agency → plan → payment), defined in
`docs/design/foundation-v3/SPEC-signup-flow.md` and held by `lib/design/signupCopy.test.mjs`. Back
from step 2 onward, no confirm-password field, no typed trial length — already correct and tested.
The open question is not the copy; it is that **the panel changes scene per step** (step N shows
scene N). That is the one place the carousel has a real argument, and also where the 3D mock is at
its least legible.

---

## E. Things I did not verify

- No first-hand read of a *sign-up* flow at any of the eight companies — sign-in pages only.
- No conversion data of our own; I did not look for analytics on drop-off per sign-up step.
- Light and dark both checked at 1536×826; 1366×657 and 375-wide not re-measured for this round.
- Panel text contrast is fine where measured (eyebrow 6.13:1, title 11.34:1, body 10.5:1 on
  `--brand-700`). Contrast *inside* the miniature was not measured.

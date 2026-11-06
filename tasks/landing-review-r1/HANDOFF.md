# Handoff: landing review round 1 (6 Nov 2026)

Read this first, then `plan.md` and `todo.md` in this folder, then
`docs/design/landing-review-2026-11-04.md` (Umar's review call, the source of the work list).

## Where things are

- **Branch:** `redesign/landing-review-r1`, 15 commits on top of `origin/main` @ `5100428c`.
  **Not pushed, no PR yet.** Working tree clean.
- **Dev server:** `npx next dev --turbopack --port 3000` (the owner reviews on localhost:3000;
  the owner's screen is 1536×826).
- **Tests:** `node --experimental-strip-types --test lib/design/*.test.mjs` is green (102 pass).
  `npm run typecheck` is clean. Lint the touched files with `npx eslint <files>`.
- **Screenshots:** Python Playwright works with `python -P script.py` (the package is installed in
  the user site; `python -I` hides it). The helper scripts used this session were in the session's
  scratchpad and are gone; write a new one (viewport 1536×826, `color_scheme`, scroll to a selector,
  screenshot).
- **After every edit to an existing file run `git diff --stat`.** Several files have CRLF working
  copies over LF in git; a whole-file diff means the endings flipped. Fix with `sed -i 's/\r$//'`.
- The old phone-pass work from 4 Nov is saved on the local branch `wip/landing-mobile-2026-11-04`.

## Done this session (all committed)

Page order now: Hero → Trust band → What's broken today → Five tools (Clepso) → What it does (7
modules) → Pricing → FAQ → Roadmap → Contact → Footer.

- **Hero:** headline without "Complete" ("The operating system / for life insurance sales teams.").
  The device shows five real app pages (Dashboard, Inbound, Dialer, Callbacks, Applications), changing
  every **5 s**; its sidebar items are buttons that open a page and hold the cycle for 20 s. The app's
  real top bar and the real logo. Files: `landing-device.tsx`, `landing-device-pages.tsx`.
- **What's broken today:** the photo row slides right endlessly (Web Animations transform, 30 px/s,
  three copies of the cards), arrows glide one card, drag on phones, faded edges, no scrollbar.
  `landing-broken.tsx`.
- **Five tools → Insurvas (Clepso pattern, A3.1–A3.3):** five tilted 3D tool cards spread across the
  stage fly into one stack, the Insurvas tile lands on top; then problems flow in under "Coming in",
  outcomes out under "Coming out". Dark band. `landing-stack.tsx`.
- **What it does (A5.1–A5.3):** Umar's seven modules in his order, four points and an "Inside" row
  of real menu pages each; the right half is a **3D workflow canvas** (`landing-flow.tsx`): nodes per
  module page, curved connectors a record travels, nodes go waiting → done, the outcome counts up.
  White band in light theme so it does not merge with the dark five-tools band.
- **Pricing:** "Agent workspace / Team workspace"; no hatched ring; pressing a card brings it forward
  (deep olive, green edge, filled button); mint section ground in light.
- **FAQ:** no rule under the last row.
- **Roadmap (A8.3–A8.5):** one screen tall like the hero (100svh), header row on top (label, heading
  left; why-line and link right), the road photo filling the rest, faded in from the FAQ above.
- **Contact form (A8.6, the one missing feature):** `landing-contact.tsx` → `POST /api/public/contact`
  (zod, honeypot, rate limits per IP and per email, one email to `CONTACT_INBOX_EMAIL`, falling back
  to `SMTP_FROM_EMAIL`, Reply-To the visitor). Footer links "Contact us" → `/#contact`.
  Locally the API returns 502 because SMTP is configured but not reachable; the success state was
  verified with a mocked response.
- **Colour:** every dark band and the footer use one dark,
  `color-mix(in srgb, var(--footer-bg) 62%, black)`. The footer is marked by a fading hairline on top.

## Next, in order

1. **Trust band ("Built by industry experts", `LandingBuiltFor` in `landing-audience.tsx`).** The owner
   asked for the best possible design here: Umar's A2.1 says it introduces us and must build
   credibility (who built it, how long it has run, who uses it) before the page says why. Use the
   impeccable, emil-design-eng and ui-taste skills. Today it is a heading, one line and three figures
   on hairlines; it reads flat. Ideas: a stronger composition with the figures counting up on
   entrance, an origin line with a founder name (still unconfirmed), a carrier/partner proof row if
   real names exist. **Do not invent figures:** 2 years, 2,400+, 180+ and $48M are all marked TO
   CONFIRM (Umar).
2. **Workflow canvas polish:** several node sub-lines truncate ("Partner posts…", "Source and c…").
   Widen the nodes or shorten the subs in `landing-bento.tsx`; check all seven cards in both themes
   and at 390 px (the narrow one-column layout has not been eyeballed).
3. Remaining plan items (`todo.md`): A1.2 a shape behind the hero headline, A7.3 rewrite the FAQ
   questions, A9.1 footer pass, A0.2 cut text across the page, A0.1 full phone pass (360/390/430/768).
4. Polish pass (impeccable + emil), `npm run build`, push the branch, open the PR. In the PR body list
   the open questions below and note that A1.4 (hero cycling) and the 3D diagrams were the owner's
   calls against Umar's "later" / "2D is fine".

## Open questions for Umar (put in the PR)

- The seven module names are now his spoken ones; confirm the wording.
- Should `/pricing` stay a separate route (A10.1)?
- The logo redesign (A1.3), brand work, not started.
- A better roadmap photo (A8.2)? The current one is kept, darkened.
- The "two years" claim, the trust figures and the roadmap why-line.
- Which inbox should contact requests go to (`CONTACT_INBOX_EMAIL`)?

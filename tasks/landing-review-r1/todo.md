# Landing review round 1: tasks

Commands used throughout:
- Types: `npm run typecheck`
- Lint (touched files): `npx eslint <files>`
- Design rules: `node --experimental-strip-types --test lib/design/*.test.mjs`
- Full tests: `npm test` (expect the known local migration line-ending failures on this Windows
  checkout; they are not this branch)
- Build: `npm run build`
- Screens: Python Playwright against `localhost:3000`, at 1536×826 (the owner's screen), 1366×657,
  390×844
- After every edit to an existing file: `git diff --stat`

---

## Phase 0

### Task 0: Critique and distill before building
**Description:** Run the ui-taste critique and distill pass over the designs below (contact form,
roadmap band, bento modules and diagrams, the five-tools flow, the trust band) and fold the outcome
into this file before writing code.
**Acceptance criteria:**
- [x] Each structural task below names what was cut or changed by the critique
**Dependencies:** None · **Scope:** XS (docs)

**Outcome (2026-11-06, live page at 1536×826, dark; 9,618px tall).** No image-generation tool is
available in this session, so the critique ran on the live page and the Clepso screenshots.
- **Page length is the first risk.** It is already ~11.6 screens; seven bento cards would add two.
  Cut: each card ~520px tall (from 600), the side rail of dashes goes (the `01 / 07` count says the
  same), lede one line, three points.
- **Flow diagrams stay flat and quiet:** at most five nodes, one accent, the record is a small chip
  on a wire, no glow, no tilt. They must read at 560px wide.
- **Five-tools section has three blocks saying one thing** (tools, a quote, "One system instead").
  Distill to: one-line header → the stage (tools collapse into Insurvas, mess in, outcomes out) →
  one story line. The outcomes on the stage replace the "instead" card. The placeholder caption
  "Founder name and role" goes: an unattributed first-person quote with a fake caption reads as
  unfinished. The story is told in "we".
- **Trust band:** the four coloured dots stand in for faces that do not exist; they go. The band
  becomes a statement plus three proof facts (years run in our own agency, agents, commission
  matched) on hairlines, no new invented numbers.
- **Roadmap:** the form does not sit on the photo (text on a busy photo is the exact complaint).
  Photo band ≈ 520px with the heading, a two-line why, and the pins; the form follows below on the
  same dark ground, two columns: the ask on the left, four fields on the right, one button.
- **Pricing selection** must not make the card a focusable button with a link inside (round 5
  audit). Pointer click on the card selects it; keyboard focus inside the card selects it too.

---

## Phase 1: Small and unambiguous

### Task 1: Rename the audience switch (A6.4)
**Acceptance criteria:**
- [ ] The switch reads "Agent workspace" / "Team workspace" (`landing-pricing.tsx`)
**Verification:** the switch on `/` shows the new labels in both states
**Dependencies:** None · **Files:** `components/marketing/landing-pricing.tsx` · **Scope:** XS

### Task 2: No rule under the last FAQ row (A7.2)
**Acceptance criteria:**
- [ ] `.item:last-child` has no bottom border; the other rows keep theirs
**Verification:** screenshot of the FAQ list
**Dependencies:** None · **Files:** `landing-faq.module.css` · **Scope:** XS

### Task 3: Remove the hatched ring (A6.2)
**Acceptance criteria:**
- [ ] `.featured::before` is gone, and so is the hatched fill of the featured tab
- [ ] The recommended card still reads as recommended (its tab and filled CTA)
**Dependencies:** None · **Files:** `landing-pricing.module.css` · **Scope:** XS

### Task 4: Hero headline without "Complete" (A1.1)
**Acceptance criteria:**
- [ ] Reads "The OS for / life insurance sales teams." with "the operating system for life
      insurance" sitting on the lower line, as Umar described; the italic accent stays on one word
- [ ] Line break holds at 1536, 1366 and 390 wide
**Dependencies:** None · **Files:** `landing-hero.tsx`, `landing-hero.module.css`, footer tagline ·
**Scope:** S

### Checkpoint A
- [ ] Design tests green, typecheck clean, page checked at 1536×826

---

## Phase 2: Structural

### Task 5: Contact / custom-request form (A8.6)
**Description:** The site has no way to contact Insurvas. Add a request form at the end of the
roadmap section: "Need something we haven't built? Tell us."
**Acceptance criteria:**
- [ ] Fields: name, work email, agency (optional), what you need (message). Hidden honeypot.
- [ ] `POST /api/public/contact` validates (zod), rate-limits per IP and per email, sends one email
      to `CONTACT_INBOX_EMAIL` (fallback `SMTP_FROM_EMAIL`) with Reply-To set to the visitor
- [ ] The form shows sending, sent and error states; a field error is shown under its field
- [ ] The form is reachable from the footer ("Contact" → `/#contact`)
- [ ] Unit test for the schema and the email body escaping
**Verification:** `npm test`; submit on the dev server (email delivery is off locally, so the log
line "recorded but not sent" proves the path); keyboard-only submit works
**Dependencies:** None
**Files:** `lib/marketing/contact.ts`, `lib/marketing/contact.test.mjs`,
`app/api/public/contact/route.ts`, `lib/rateLimit/index.ts`, `components/marketing/landing-contact.tsx`
(+ module css), `components/marketing/cta.tsx`
**Scope:** M

### Task 6: Roadmap photo shorter, darker, text over it (A8.3, A8.4, A8.5)
**Acceptance criteria:**
- [ ] The photo band is at most ~70% of the viewport tall at 1536×826, not the full aspect ratio
- [ ] Dark green overlay: the photo recedes, the green cast stays
- [ ] Over the photo: the heading, a two-line statement of why we build, and the four pins
- [ ] The contact form (Task 5) follows on the same dark ground
**Dependencies:** Task 5 · **Files:** `landing-roadmap.tsx`, `landing-roadmap.module.css`,
`brandContrast.test.mjs` (dark-band list) · **Scope:** S

### Task 7: Seven modules, shorter copy (A5.1, A5.2)
**Acceptance criteria:**
- [ ] Seven cards: Partnerships & lead flow · Outbound dialer & leads · Applications ·
      Commissions & book · Accounting · Retention · Compliance (names marked TO CONFIRM)
- [ ] Each card: title, one-line lede, three points at most, CTA. Layout (sticky stack) kept.
- [ ] Every point describes something the product does today
**Dependencies:** None · **Files:** `landing-bento.tsx`, `landing-features.module.css` · **Scope:** S

### Task 8: 2D animated flow diagrams (A5.3)
**Acceptance criteria:**
- [ ] `landing-flow.tsx`: nodes, wires and a record that travels them in order, each node lighting
      as the record arrives; loops while its card is in view, paused otherwise
- [ ] Seven diagrams, one per module, each showing that module's real workflow
- [ ] Reduced motion: the finished state, still. No 3D transforms left in the bento.
- [ ] The isometric `Scene`, its tiles and its CSS are removed
**Dependencies:** Task 7 · **Files:** `landing-flow.tsx` (+ css), `landing-bento.tsx`,
`landing-features.module.css` · **Scope:** M

### Checkpoint B
- [ ] Tests green; contact form submits; bento checked in dark and light at 1536×826

### Task 9: Five tools → Insurvas, Clepso pattern (A3.1, A3.2, A3.3)
**Acceptance criteria:**
- [ ] On the deep-olive ground: a short header (problem in one line), the five tools as a 3D card
      stack that collapses into the Insurvas tile when the section scrolls in
- [ ] Mess cards (dead lead, duplicate dial, unmatched statement line, missed draft, consent
      missing) drift into the tile from the left; clean outcomes leave it on the right
- [ ] The founder line carries the story in one sentence; the long cost and "instead" lists go
- [ ] Reduced motion: the resolved state, still. Pauses off-screen.
**Dependencies:** None · **Files:** `landing-stack.tsx`, `landing-stack.module.css`,
`brandContrast.test.mjs` · **Scope:** M

### Task 10: Social proof that builds credibility (A2.1)
**Acceptance criteria:**
- [ ] Says who built it (people who ran a final expense floor), how long it has run (two years,
      TO CONFIRM), who uses it (the existing figures, TO CONFIRM)
- [ ] More than a headline and two numbers: a short origin line plus a proof row
**Dependencies:** None · **Files:** `landing-audience.tsx`, `landing-audience.module.css` · **Scope:** S

### Checkpoint C
- [ ] Tests green; whole page at 1536×826 dark and light

---

## Phase 3: Judgement and copy

### Task 11: Selectable pricing cards (A6.1)
**Acceptance criteria:**
- [ ] Clicking a card (or its keyboard equivalent) selects it; the recommended card starts selected
- [ ] The selected card gets the brand edge and its CTA fills, with a short transition
- [ ] One selection per view; the plan links still go to sign-up
**Files:** `landing-pricing.tsx`, `landing-pricing.module.css` · **Scope:** S

### Task 12: Pricing in light mode (A6.3)
**Acceptance criteria:**
- [ ] In light, the section has its own ground so the cards keep their edge
**Files:** `landing-pricing.module.css` · **Scope:** XS

### Task 13: FAQ rewritten (A7.3)
**Acceptance criteria:**
- [ ] Five questions a buyer asks before a trial, each answer at most two sentences, all true
**Files:** `landing-faq.tsx` · **Scope:** XS

### Task 14: Footer (A9.1)
**Acceptance criteria:**
- [ ] Compact; tagline without "Complete"; a Contact link; nothing else added
**Files:** `components/public/site-footer.*` · **Scope:** S

### Task 15: Behind the hero headline (A1.2)
**Acceptance criteria:**
- [ ] The faint grid becomes a deliberate shape behind the headline; text contrast unchanged
**Files:** `landing-hero.module.css` · **Scope:** XS

### Task 16: Phones and tablets (A0.1)
**Acceptance criteria:**
- [ ] No horizontal overflow at 360, 390, 768
- [ ] Tap targets ≥ 44px on touch for the new controls
- [ ] Every new section readable on a phone, its motion sized to fit
**Files:** the new and changed modules · **Scope:** M

### Checkpoint D
- [ ] ui-taste polish pass; full verification; PR opened with the open questions

---

## Added 2026-11-06 (owner, after seeing the work in progress)

### Task 17: Pricing cards: press one and it comes forward (replaces Task 11's first pass)
**Acceptance criteria:**
- [ ] Clicking (or tabbing into) a card selects it: it rises and comes forward, the others settle back
- [ ] The corner tabs keep their earlier cut-out look, with no hatched green lines on any card
- [ ] The selected card has its own finished look: brand edge, a filled tab dot and a filled button
- [ ] Motion: transform and opacity only, ease-out under 300ms, press feedback, hover only on fine pointers
**Files:** `landing-pricing.tsx`, `landing-pricing.module.css` · **Scope:** S

### Task 18: "What's broken today" photo row: arrows only, auto-scroll, faded edges
**Acceptance criteria:**
- [ ] No scrollbar under the photos; the ‹ › arrows at the top are the only controls
- [x] The row moves to the right on its own, slowly and continuously, and only ever that way
      (owner, 6 Nov: no rewind at the end; the cards repeat endlessly); it pauses on hover, focus,
      touch and when off screen
- [ ] The left and right edges fade out
- [ ] Reduced motion: no auto-advance; arrows still work
- [ ] Swipe still works on phones; checked at 360, 390, 430 and 768
**Files:** `landing-broken.tsx`, `landing-broken.module.css` · **Scope:** S

### Task 19: The seven module cards, as Umar named them (owner, 6 Nov; replaces Task 7's names)
**Description:** Umar's seven (10:23 in the call), in his order and wording, each card carrying the
main information for that module: a one-line promise, three or four points, and the real app pages
the module is made of, plus its flow diagram.
**Acceptance criteria:**
- [ ] 1 Partnerships & lead flow · 2 Outbound dialer & lead management · 3 Interview and submit in
      one window · 4 Commissions, book of business & automations · 5 Accounting · 6 Retention ·
      7 Compliance (sentence case, marketing README)
- [ ] Each card lists "Inside" chips that are real menu pages (lib/menu/definition.ts)
- [ ] Long titles fit on two lines at 1366 and 1536; cards stay one screen tall; phone layout holds
**Verification:** screenshots of cards 1, 2, 4 at 1536×826 and 390×844; design tests green
**Files:** `components/marketing/landing-bento.tsx`, `landing-features.module.css` · **Scope:** S

### Task 20: Five tools: one screen, and each problem visibly becomes its fix (owner, 6 Nov)
**Description:** The section ran past one screen and the two sides drifted on their own, so nothing
showed a problem *becoming* a solution. Rebuild the stage as three lanes that run through an Insurvas
gate in the middle: every card is a matched pair (a dropped transfer → claimed once, an unmatched
statement line → matched to its policy). It travels in as the problem and leaves as its fix, switching
at the gate, so the change happens exactly where Insurvas is.
**Acceptance criteria:**
- [ ] The whole section (header, stage, story line) fits 1536×826 and 1366×657 without scrolling
- [ ] Nine problem/fix pairs, each switching at the gate; three lanes at different speeds, endless,
      compositor-only motion, paused off screen; reduced motion shows problems left and fixes right, still
- [ ] The five-tools stack still collapses into the Insurvas tile on first sight (Umar's A3.1)
- [ ] Phones: the lanes and gate still read; no horizontal overflow at 360–768
**Verification:** measured section height at both sizes; screenshots; design tests green
**Files:** `components/marketing/landing-stack.tsx`, `landing-stack.module.css` · **Scope:** S

## Round of 7 Nov (owner): the hero laptop as the app is now, and the roadmap page

### Task 21: The laptop's dashboard is the app's new Overview, with good figures
**Description:** Main (PR #57) redrew the dashboard as the Overview (Needs you, premium and the month's
goal, modules and lead to policy, the money card and Today). The laptop showed the old one. Draw it with
the app's own cards (dash-kit) and healthy sample figures that agree with the True CPA report; the
sidebar and top bar as the app draws them now.
**Acceptance criteria:**
- [x] Overview drawn from dash-kit, StatStrip and LineSeries; nothing in it can be focused (inert)
- [x] Figures agree with the True CPA report (spend, issued, CPA, commission)
- [x] Sidebar in the app's order with Today open; dark top bar
- [x] Nothing overflows the 1280 screen; no label cut short
**Verification:** flat screenshots in light and dark at 1536×826; typecheck, lint, design tests
**Files:** `landing-device.tsx`, `landing-device-overview.tsx`, `landing-device.module.css` · **Scope:** M

### Task 22: The laptop follows the site's theme
**Description:** The screen took light surfaces in dark mode (a CSS-module `.dark` is hashed, so
`:root:not(.dark)` always matched), leaving dark-mode text on white cards.
**Acceptance criteria:**
- [x] Dark mode: a dark screen; light mode: the app's light screen, never mixed
- [x] Every laptop page checked in both themes
**Verification:** screenshots of each page in both themes · **Scope:** XS

### Task 23: Every sidebar entry in the laptop opens a page
**Description:** Only Home, Today's and the Leads and Sales pages opened; the rest of the sidebar was a
picture (owner's screenshot). Give each section a believable page of its own, from the app's real pages,
in the same sample world, and add them to the cycle.
**Acceptance criteria:**
- [x] Agency, Calendar, Book of Business, Carrier Sync, Retention, Commissions, Accounting, Partners,
      Compliance, Reports and Settings each open a page; the trail and title are the app's
- [x] Each page fits the 1280 × 780 screen, in light and dark
- [x] The phone and tablet tabs offer the same pages
**Verification:** a screenshot of every page in both themes · **Files:** `landing-device-pages.tsx`, `landing-device.tsx`, CSS · **Scope:** M

### Checkpoint E
- [ ] Tasks 21–23 committed; reviewed in both themes at 1536×826 and on a phone

### Task 24: The roadmap page reveals as it scrolls (impeccable, Emil Kowalski, taste)
**Description:** /roadmap shows everything at once. Critique it first, then give it scroll reveals that
explain the timeline: the header settles, the rail draws down as you read, each quarter's stop lights
when it reaches it, its cards rise in a short stagger. Fast (under 600ms each), ease-out, transform and
opacity only, once per element; reduced motion shows it all still.
**Acceptance criteria:**
- [ ] A short critique (what to keep, what to change) before building
- [ ] Reveals on the header, rail, stops and cards; nothing waits on a scroll to be readable at the top
- [ ] No layout shift; no element hidden if scripts fail (the page renders fully without JavaScript)
- [ ] Works on iPhone Safari (no large layers held at once)
**Verification:** step-scroll screenshots at 1536×826 and iPhone 14, both themes · **Files:** `app/roadmap/*`, its CSS · **Scope:** S

### Checkpoint F: Complete
- [ ] Typecheck, lint, design tests green; committed and pushed; graph updated

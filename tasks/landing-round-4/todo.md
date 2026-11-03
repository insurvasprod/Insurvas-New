# Todo: Landing round 4 — nav order, a two-colour ground, FAQ illustration

Plan, audit evidence and decisions: [plan.md](plan.md). Branch `redesign/landing` (off `origin/main`
@ `2d8e7401`). Decisions D1–D4 are settled; the three open questions are in the plan.

Commands used throughout:

- Dev: `npm run dev -- --port 3000`
- Types: `npx tsc --noEmit -p .`
- Lint: `npx eslint components/marketing components/public app/page.tsx`
- Design rules: `node --experimental-strip-types --test lib/design/*.test.mjs`

---

## Phase 1 — Colour

### Task 1: Scoped landing palette

**Description:** Add a landing-only palette block to `app/globals.css` beside the existing
`.landing-type` font block: white ground, green-tinted neutrals. Global `:root` and `.dark` are not
touched (D1 — `--muted` alone is used in 220 files).

**Acceptance criteria:**
- [x] `.landing-type` sets `--canvas: #ffffff`, plus green-leaning `--border`, `--muted`, `--surface-alt`, `--surface-sunken`
- [x] No value in `:root` or `.dark` changes; `git diff app/globals.css` touches only the landing block
- [x] `--muted` on white is ≥ 4.5:1; `--border` on white stays visible (≥ 1.5:1 non-text)
- [x] Dark theme values are chosen deliberately, not inherited by accident

**Verification:**
- [x] `node --experimental-strip-types --test lib/design/*.test.mjs`
- [x] Computed contrast read in the browser, not from token names
- [x] `app/globals.css` is still CRLF (`git diff --stat` shows ~10 lines, not a whole-file rewrite)

**Dependencies:** None
**Files:** `app/globals.css`, `docs/design/BRAND.md` (record the rule)
**Scope:** S

---

### Task 2: Light sections onto the white ground

**Description:** Make every light section white and re-establish separation with hairlines, spacing
and mint rather than a second grey. The dark bands (hero, features, footer) stay as the rhythm (D2).

**Acceptance criteria:**
- [x] `#industries`, `#answer`, `#pricing`, `#faq` and the close section render `#ffffff`
- [x] Every card (FAQ side card, pricing cards, True CPA report, close board) is still clearly a
      distinct surface — verified by eye, not assumed
- [x] No `--surface-alt`/`--surface-sunken` left doing section-level work on the landing page
- [x] Section boundaries read without a grey fill (hairline or spacing)
- [x] Dark theme checked separately — `--canvas` and `--surface` are near-identical there today

**Verification:**
- [x] Screenshots: 1536×826, 1366×657, 390×844 — light and dark
- [x] `npx tsc --noEmit -p .` and `npx eslint components/marketing`
- [x] No console errors

**Dependencies:** Task 1, Task 3
**Files:** `landing-page.module.css`, `landing-pricing.module.css`, `landing-faq.module.css`,
`landing-close.module.css`, `landing-features.module.css`
**Scope:** M

---

### Task 3: Close the contrast blind spot

**Description:** `brandContrast.test.mjs` forbids bright green as text on a light ground but only
scans `globals.css` and `.tsx` — never CSS modules. Extend it before Task 2 lands, so flipping a
section to white fails the build instead of shipping 1.8:1 text.

**Acceptance criteria:**
- [x] The test reads `components/**/*.module.css` for `color: var(--primary)`
- [x] Modules whose rules sit on a dark ground are allowlisted **with a reason**, as the existing
      `DARK_GROUND` set does (`landing-hero.module.css`, `landing-features.module.css`)
- [x] Deliberately introducing `color: var(--primary)` into a light-ground module fails the test
- [x] Any real offender found is fixed to `--accent-ink`

**Verification:**
- [x] `node --experimental-strip-types --test lib/design/brandContrast.test.mjs`
- [x] Temporarily add an offending rule and confirm the test fails, then revert

**Dependencies:** None (do before Task 2)
**Files:** `lib/design/brandContrast.test.mjs`
**Scope:** S

---

### Checkpoint: Colour
- [x] Both themes at all three viewports
- [x] Nothing invisible; nothing still blue-grey
- [x] `npm test` green

---

## Phase 2 — Navigation

### Task 4: Nav order and labels

**Description:** Reorder the header to page order and rename "Product" to "Home". Confirmed during
the audit: `#industries` ("Who it's for") really is the section directly after the hero, so the
owner's requested order matches the scroll order.

Current → target:

| # | Now | Target | Href |
|---|-----|--------|------|
| 1 | Product → `/#answer` | **Home** | `/` |
| 2 | Features | **Who it's for** | `/#industries` |
| 3 | Who it's for | **Features** | `/#features` |
| 4 | FAQ | **Pricing** | `/pricing` *(open question 1)* |
| 5 | Pricing | **FAQ** | `/#faq` |

**Acceptance criteria:**
- [x] Header order is Home, Who it's for, Features, Pricing, FAQ — desktop bar and mobile menu
- [x] "Home" carries `key: "home"` so the active state works on `/`
- [x] Pricing keeps its active state on `/pricing`
- [x] `#answer` is still reachable (hero "See how it works" CTA, footer link)
- [x] Footer "Product" column matches the new order

**Verification:**
- [x] Click each item on `/` and confirm it lands on the right section (`scroll-mt-20` clears the pill)
- [x] Same in the mobile menu at 390×844
- [x] Load `/pricing` and confirm Pricing is marked current

**Dependencies:** Open question 1 answered
**Files:** `components/public/site-header.tsx`, `components/public/site-footer.tsx`
**Scope:** S

---

### Checkpoint: Navigation
- [x] Five items, correct order, correct targets, both layouts

---

## Phase 3 — FAQ illustration

### Task 5: Isometric FAQ scene

**Description:** An isometric graphic for the FAQ left column, beside "The ones people actually
ask". Takes the *composition* of the supplied reference — one raised tile carrying the label, flat
tiles settled around it — and draws it in Insurvas's own language: the `.scene`/`.plane`/`.tile`
system from `landing-features.module.css`, in brand green and mint (D4). Not the reference's blue,
not its puzzle-piece metaphor.

**Acceptance criteria:**
- [x] Sits in the FAQ side column with the eyebrow and title (the "Still deciding?" card was removed on the owner's instruction, 3 Nov — the column is eyebrow, title, mark)
- [x] Built from the existing isometric tile classes, not a new illustration system
- [x] Green/mint/white only — no colour outside the Task 1 palette
- [x] `aria-hidden="true"` (decorative; the FAQ list carries all meaning)
- [x] Static or pointer-reactive only — no always-on animation loop
- [x] Degrades to a still, complete composition under `prefers-reduced-motion`
- [x] At 390×844 it either stacks sensibly or is hidden — it never squeezes the card

**Verification:**
- [x] Screenshots at all three viewports, light and dark
- [ ] Reduced-motion screenshot (verified structurally instead: the scene has no animation/keyframes, the tilt transition is removed and the JS handler returns early)
- [x] FAQ open/close still works by keyboard; focus order unchanged

**Dependencies:** Tasks 1–2 (must be drawn in the final palette)
**Files:** `components/marketing/landing-faq.tsx`, `components/marketing/landing-faq.module.css`
**Scope:** M

---

### Task 6: Fix the nested `<main>` landmark

**Description:** `landing-device.tsx:204` renders `<main>` inside the page's `<main>`. Two `main`
landmarks is an accessibility defect. The device mock is decorative; it should use `<div>`.

**Acceptance criteria:**
- [x] Exactly one `<main>` in the rendered landing page
- [x] Device layout unchanged (the class does the work, not the tag)

**Verification:**
- [x] `document.querySelectorAll('main').length === 1` in the browser
- [x] Hero screenshot identical to before

**Dependencies:** None
**Files:** `components/marketing/landing-device.tsx`
**Scope:** XS

---

### Checkpoint: Complete
- [ ] All acceptance criteria met
- [ ] `tsc`, `eslint`, `npm test` green
- [ ] Line endings unchanged (`git diff --stat` sane on every touched file)
- [ ] Committed on `redesign/landing`; PR opened

---

## Phase 4 — the FAQ mark, rebuilt to the reference

### Task 7: Rebuild the FAQ mark as an assembling puzzle piece

**Description:** Replace the static pile with the reference's composition and motion — a puzzle-tab
tile carrying a three-line label in the isometric plane, a "?" badge above it, three flat tiles
around it, assembling in on a loop. Motion authored here, not lifted from their Lottie (D5).

**Acceptance criteria:**
- [x] Composition matches the supplied screenshot: puzzle-tab tile, label on it, badge above, three flat tiles
- [x] The label lies in the isometric plane, as the reference's does
- [x] Pieces assemble in staggered, hold, then loop — transform and opacity only
- [x] The loop pauses when the section is off screen (IntersectionObserver)
- [x] Brand palette only: green, mint, white, deep-olive ink — no blue, no `color: var(--primary)` on the light ground
- [x] `aria-hidden`; the FAQ list still carries every word that matters
- [x] `prefers-reduced-motion` shows the finished composition, still and complete
- [x] Hidden below 1000px, as now; the questions keep the room
- [x] No Lottie file, runtime, or any new dependency

**Verification:**
- [x] Rendered at 1536x826 and compared against the supplied reference screenshot, not from memory
- [x] 1366x657 and 390x844; light and dark
- [ ] Reduced motion exercised by emulation — the browser tool emulates colour scheme but not prefers-reduced-motion. The *outcome* was exercised instead: with the animation forced off, all six pieces measured opacity 1, i.e. the complete composition, still.
- [x] `npx tsc --noEmit -p .`, `npx eslint components/marketing`, `node --experimental-strip-types --test lib/design/*.test.mjs`
- [x] No console errors in a clean tab

**Dependencies:** Phases 1–3
**Files:** `components/marketing/landing-faq.tsx`, `components/marketing/landing-faq.module.css`
**Scope:** M

### Checkpoint: Phase 4
- [x] Side-by-side with the reference shows the same composition and the same motion beats
- [x] `npm test` green

---

## Fixes after Phase 4 (3 Nov)

### Duplicate React key in the hero's activity feed — fixed
The owner reported intermittent "Encountered two children with the same key, `4`" from
`landing-device.tsx:259`. **I had twice attributed these to `/pricing` and called them pre-existing;
that was wrong** — the stack trace is landing code written this round.

Cause: the feed's id counter lived inside the `useEffect` keyed on `live`. The IntersectionObserver
flips `live` every time the hero leaves and re-enters the viewport, so the counter restarted at 4
on each scroll back and re-issued an id the feed was still rendering. Intermittent because the feed
only holds four items — the collision needed the scroll-back within ~4 ticks.

Fix: the counter is a `useRef` seeded at `FEED_SIZE`, so it outlives the effect and ids only climb.

- [x] Reproduced by flipping the hero out of view and back six times; no console errors after the fix

### The flat green tiles in the bento scenes — restyled
The owner: the bright green `solid` tiles ("Claim", "Clear to dial", "True CPA", "Issued", "Only
their own") looked bad next to the `accent` tiles, which were fine. They were a flat slab of
`--primary` with no light direction, so they glared and read as loose buttons rather than lit faces.

Now they carry the same 160deg light direction as the accent tiles, with a lit rim, an inset
highlight and an offset elevation shadow.

- [x] `--on-primary` clears AA on every gradient stop in both themes (light 4.96:1, dark 4.71:1)
- [x] The darkest stop is capped at 85% primary — a full footer-mix fell to 4.01:1

---

## Phase 5 — "Who it's for" as a split panel (3 Nov)

Spec: [docs/design/landing-who-its-for-spec.md](../../docs/design/landing-who-its-for-spec.md), approved.
Built as `components/marketing/landing-audience.tsx` + `.module.css`; the old `landing-sections.tsx`
("Built for" strip) and its dead CSS in `landing-page.module.css` are gone.

Decisions taken where the spec left them open, in the owner's own words from the request
("a split section … that says for Agent and Agency"):

- Labels are the one-word **Agent / Agency**, as the reference does it.
- **Full-bleed**, edge to edge.
- Lines of business sit **under both halves** — they belong to both.
- Agent = white ground, Agency = deep olive: the page's own two grounds doing the reference's
  two-colour job, so no palette is imported.

### Verified
- [x] Both halves readable at rest — nothing is hidden, so hover is never load-bearing
- [x] Hover grows the half to 57/42 and dims the other
- [x] Tab reaches both; `:focus-visible` produces the same grown state
- [x] 390x844 stacks, both halves at opacity 1, no horizontal overflow
- [x] "Who it's for" in the nav still lands on `#industries` (top 80 under a 76px header)
- [x] The four guarantees are still on the page
- [ ] Reduced motion exercised by emulation — same tool limit as Phase 4; the rule is in the CSS and
      the rest state (which is what reduced motion shows) was verified directly

### Two defects the measurements caught
1. **The dim failed AA.** At `opacity: .82` the agency CTA measured **3.94:1** and two more colours
   fell under 4.5. Dimming a dark panel over a white backdrop lightens the ground far faster than
   the text. `.88` was the floor; the dim is **`.9`** (worst case now 4.78:1). The `who` line's own
   `opacity` was replaced with real colours — two opacities multiply into a failure neither value
   looks guilty of.
2. **The split vanished in dark.** `--surface` #0f1a17 against `--footer-bg` #06211c measured
   **1.05:1** — one slab with a hairline. In dark the agency half now takes
   `color-mix(--primary 22%, --footer-bg)`: separation **1.71:1**, text still 5.49:1.

Also fixed while building: with a pointer parked on one half and the keyboard on the other, both
grew and both dimmed. Focus now wins over hover.

### The contrast gate caught this section
The Phase 1 CSS-module gate failed the build on `landing-audience.module.css`: the agency half's CTA
is `color: var(--primary)`. It is legitimate — that half is `--footer-bg` deep olive, measured
6.17:1 in light and 5.52:1 in dark — so the file is allowlisted. The allowlist entry records that
the exemption is **wider than the truth**: the agent half of the same file is on white, so green
text added there would be a real failure this entry now hides.

- [x] 102/102 design tests, exit code checked directly rather than through a pipe

---

## Phase 6 — the "Built for" band restored and rebuilt (3 Nov)

The owner: items were missing from the band, it belongs between the hero and "Who it's for", and
both it and the split looked plain.

**What had gone missing, precisely.** The old strip listed seven businesses; Phase 5 kept three in
the band and moved four onto the panels, so the band looked gutted. All seven are back in one place,
and the panels no longer repeat them — nothing is listed twice.

The guarantee list had also lost three entries from source. The strip only ever rendered four
(`.slice(0, 4)`), so nothing changed on screen, but the wording for the other three was gone. All
seven are back in the array; four still show.

### Task 8: Rebuild the band
- [x] `LandingBuiltFor`, its own section between the hero and the split
- [x] All seven businesses as chips — white pills, hairline, soft shadow — on a mint `--surface-alt` band
- [x] Guarantees on a real grid with mint icon tiles instead of a bare text row
- [x] 4 columns → 2 at 1000px → 1 at 640px; seven chips wrap, no horizontal overflow at 1536 or 390
- [x] The split's `#industries` anchor is untouched; the band sits before it
- [x] Dead CSS from the old in-section band removed

### On "use a graphic design tool"
There is no image-generation tool in this session — I searched. It would also have been the wrong
instrument: this band has to theme light and dark, reflow from one row to three, keep selectable
text and stay crisp at any zoom. A raster image loses all four. The improvement is craft in CSS.

### Correction to Task 8 — the chips were reverted (3 Nov)
I read "they look so plain, make it more realistic" as a brief to redesign the band, and rebuilt it
as chips on a tinted ground with mint icon tiles. The owner's answer: "why did you change the design
of these they were good."

The band is back to the original strip styling, verbatim — white ground, "Built for", the businesses
separated by `/`, and the small inline guarantee row. What stays from this round is only what was
actually asked for:

- [x] All seven businesses, in one place, not split across the band and the panels
- [x] The band sits between the hero and "Who it's for"
- [x] The guarantee wording for all seven is back in source; four still render

Worth remembering: "make it better" from this owner has meant *fix what is wrong with it*, not
*restyle it*. The plain treatment was a decision, not an oversight.

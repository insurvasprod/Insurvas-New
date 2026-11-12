# Implementation Plan: "What it does" feature cards (Keller's call, 10 Nov)

**Branch:** `redesign/landing-feature-cards`, off `origin/main` @ `c6f8295e` (`redesign/landing-review-r1`
is fully merged). PR at the end.
**Source:** Keller's review call, 10 Nov 2026, transcribed in [transcript.md](transcript.md). Clip 1,
0:00–3:00 is about these cards; the rest of the call (pricing position, analytics, visuals elsewhere)
is **not** this round.
**Scope:** `components/marketing/landing-bento.tsx` and `landing-features.module.css`, plus a small
change to `landing-flow.tsx` only if the card's new height needs it. Nothing else on the page.
**Status:** approved and built 2026-11-10 (both phases); waiting for the owner's review on localhost:3000.

## What Keller asked for (his words → what it means here)

| He said | Change |
| --- | --- |
| "It's an elevator pitch… just say *manage customers easier than anyone else*. Boom." | Each card's lede becomes a tagline of 7 words or fewer, in a sales rep's language. |
| "There's little buttons for more info. Throw all that in there… right now what's on the surface is too much, so I don't feel the need to click." | Current points and "Inside" chips move behind a **More info** control. The surface keeps 3 points of 6 words or fewer. |
| "Let's say I just wanted to scroll past this part. See how fast it is? We want to elongate it." | Each card **holds** fully in view for a stretch of scroll before the next one starts to cover it. |
| "This starts to fade out… it could stack on top of each other." | The covered card recedes (scales down) and fades under a shade as the next one slides over. |
| "A little bit of colour on the outside of this to show you depth, like shading when you draw… so it illuminates." | A brand-green rim light on the incoming card's top edge, and a soft glow behind the stack. |
| "There should be colour here… you can see the colour break and it's behind." / "Not enough separation between the sections." | A colour break when the section begins: a green glow that blooms behind the stack as it enters, so it reads as a new chapter, not a continuation. |
| "It's too clean, too fast." | Covered by the four rows above. No other restyle. |

Keller also likes these cards ("definitely one of the coolest features"): the stack, the numbering, the
flow diagrams and the dark-olive card stay as they are.

## Architecture decisions

- **"More info" lives inside the card, not on a new page.** The card is sticky, so it must keep its
  height. *More info* swaps the copy column for a detail panel (the current four points plus the
  "Inside" chips), crossfading in place; *Back* returns. It is a real `<button aria-expanded>` that
  controls a region, works with the keyboard, and closes when the card scrolls out. Dedicated pages per
  module (Keller: "or even a dedicated section") are a possible later step, not this round.
- **Motion is written directly onto elements, no CSS variable per frame.** Today the desktop path sets
  `--cover` on the card and applies `filter: brightness()`, which repaints the whole card on every
  frame. It moves to the approach the phone path already uses: `transform` on the card and `opacity`
  on its `.dim` shade, so only compositor-friendly properties change (Emil: animate transform and
  opacity only; avoid inherited CSS variables driving per-frame work).
- **The hold is plain layout, not scroll hijacking.** A taller gap between sticky cards gives each one
  a still stretch; the cover phase is still driven by the scroll position. Lenis smooth scrolling is
  already on the page, so this stays smooth without any extra script.
- **The glow is light, not new colour.** Only `--primary` at low alpha, so it holds in both themes and
  passes `brandContrast.test.mjs` (the cards sit on `--band` there).
- **Phones keep today's behaviour** (owner, 6 Nov: each card fits one screen). They get the new
  copy. Their points and chips are already hidden, so *More info* is the only way to reach them there.
- **Reduced motion:** no hold scaling or fades; the shade and glow stay static; the panel swaps instantly.

## Draft copy (for approval; truthful to what the app does today)

| # | Title (kept) | Tagline | Three points |
| --- | --- | --- | --- |
| 01 | Partnerships & lead flow | Every lead source, one queue. | Partners get their own portal · Live transfers claimed once · Cost on every lead |
| 02 | Outbound dialer & lead management | Buy a list. Dial it today. | Duplicates caught on import · DNC checked before every dial · Callbacks in the client's time |
| 03 | Interview and submit in one window | Close the sale before you hang up. | Interview to submission, one window · Draft date checked first · Pending cases tracked |
| 04 | Commissions, book of business & automations | Know you got paid right. | Statements matched line by line · Expected vs. paid, side by side · Splits worked out per agent |
| 05 | Accounting | Profit is a number, not a guess. | Every lead dollar tracked · Payouts worked out for you · True CPA by campaign |
| 06 | Retention | Save policies before they lapse. | Save queue ranked by money at risk · Lapses flagged before the draft · Reinstatements tracked |
| 07 | Compliance | Every dial on the record. | Consent kept on every lead · DNC refusals logged · Evidence report in one click |

The current four points and the "Inside" chips move, unchanged, into each card's *More info* panel.

## Task list

### Phase 1: Copy and disclosure (the biggest part of what he asked)

- [ ] **Task 1: New copy on the card surface.** Add `tagline` and `short` (three points) to `Module`;
  render them in place of `lede` and `points`. Keep `lede`, `points` and `inside` for the panel.
  *Accept:* each card's surface is ~25 words; the card at 1536×826 has clear empty space around the
  copy; nothing wraps past two lines. *Files:* `landing-bento.tsx`, `landing-features.module.css`. **S**
- [ ] **Task 2: The More info panel.** A button under the points swaps the copy column for the detail
  panel (lede, four points, Inside chips) and back. It has a 200 ms crossfade with a slight rise
  (ease-out, `cubic-bezier(.23,1,.32,1)`), and the card keeps its height. Keyboard: Enter/Space
  toggles it, focus moves to the panel and back to the button, `aria-expanded`/`aria-controls` are
  set, and the panel closes when the card leaves the screen. Phones get the same control.
  *Accept:* toggling never changes the card's height or jumps the page, at desktop and 390 px.
  *Files:* `landing-bento.tsx`, `landing-features.module.css`. **M**

### Checkpoint A
- [ ] `node --experimental-strip-types --test lib/design/*.test.mjs` green, `npm run typecheck` clean,
  `npx eslint` on touched files clean.
- [ ] Screenshots at 1536×826 (light and dark) and 390×844: surface copy, panel open.
- [ ] **Show the owner before the motion work.**

### Phase 2: Motion and depth

- [ ] **Task 3: The hold and the recede.** Make the gap between cards a stretch of roughly 35–45 vh,
  so a landed card holds still before the next covers it. The covered card scales to ~0.92 from the
  top and its `.dim` shade rises to ~0.6 as it is covered. The desktop path moves off `--cover` and
  `filter` onto direct `transform` + shade `opacity`. *Accept:* scrolling through all seven cards takes
  noticeably longer, each card readable while still; no `filter` on cards; Performance panel shows no
  per-frame paint of card contents. *Files:* `landing-bento.tsx`, `landing-features.module.css`. **M**
- [ ] **Task 4: Rim light and the glow behind the stack.** The incoming card gets a thin brand-green
  light along its top edge (inset highlight + outer `--primary` glow at low alpha) that brightens as it
  rises over the one beneath. A soft radial `--primary` glow sits behind the stack (a pseudo-element
  of the section, opacity-only). *Accept:* depth reads clearly in both themes; brand contrast test
  passes. *Files:* `landing-features.module.css`, `landing-bento.tsx`. **S**
- [ ] **Task 5: The colour break into the section.** As the section scrolls into view, the glow behind
  the stack blooms from nothing (opacity and scale on one layer, played once, ~900 ms ease-out). The
  section's top padding grows, so the header and the stack read as a new chapter after the
  "What's broken today" band. *Accept:* the boundary between the two sections is obvious at 1536×826 in
  both themes. *Files:* `landing-features.module.css`, `landing-bento.tsx`. **S**

### Checkpoint B (complete)
- [ ] Tests, typecheck and lint as in A.
- [ ] Scroll the whole section at 1536×826 (light and dark), 1280, 1000 (the non-sticky layout) and
  390 (phones); reduced motion on.
- [ ] `git diff --stat` shows no line-ending flips.
- [ ] `graphify update .`
- [ ] Owner review on localhost:3000, then commit and PR.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| A longer hold reads as "stuck" rather than calm | Med | Tune the gap on the owner's screen; start at 40 vh; the shade and rim light keep visible motion during the hold. |
| *More info* inside a sticky card hides content from people who never click | Low | The surface still says what the module does; the detail is one click away and reachable by keyboard and screen readers. |
| The glow muddies the white light-theme band | Med | Low alpha, checked in both themes; drop it in light theme if it looks dirty. |
| The new copy over-promises | Med | Every tagline maps to a current point; the owner approves the table above before Task 1. |

## Open questions

- Approve or edit the copy table above.
- The uncommitted Life & Health band and the trust-band fix from 9 Nov are still in the working tree.
  Commit them first as their own change, or keep them out of this PR?

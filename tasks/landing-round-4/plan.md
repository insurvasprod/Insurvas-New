# Implementation Plan: Landing round 4 — nav order, a two-colour ground, FAQ illustration

**Branch:** `redesign/landing` (off `origin/main` @ `2d8e7401`, 0 commits ahead)
**Scope:** `/` only — `components/marketing/*`, `components/public/site-header.tsx`,
`components/public/site-footer.tsx`, and one **scoped** palette block in `app/globals.css`.
**Status:** planned, not started. Round 3's work sits uncommitted on this branch and is verified
(`tsc` clean, `eslint` clean, 102/102 design tests).
**Not this round:** `/pricing`, the apps, the hero device, copy changes.

> `tasks/plan.md` and `tasks/todo.md` hold a **different, unfinished** plan (Sidebar legibility +
> Lead Sources, 120 unchecked tasks). They are untouched. This round uses the repo's per-topic
> folder convention, as `tasks/partner-pipeline/` and `tasks/agency-dashboard-redesign/` do.

---

## Overview

Three owner requests from 3 Nov, in dependency order:

1. **Colour.** The page is grey in some places and white in others; reduce it to the brand green
   plus white.
2. **Navigation.** Reorder and relabel the header: Home, Who it's for, Features, Pricing, FAQ.
3. **FAQ illustration.** Add an isometric graphic beside "The ones people actually ask", in the
   spirit of the supplied reference but in Insurvas's own visual language.

Colour comes first because the FAQ illustration must be drawn in the final palette, and the nav
sits on the header pill whose surface the palette defines.

---

## Audit findings

Measured in Chromium at 1536×826, light theme, against the running dev server — computed
backgrounds, not token names.

| # | Section | Ground now | Reads as |
|---|---------|-----------|----------|
| 1 | Hero | deep olive gradient | dark |
| 2 | Who it's for (`#industries`) | `#f1f3f7` | blue-grey |
| 3 | True CPA (`#answer`) | `#f1f3f7` | blue-grey |
| 4 | Features (`#features`) | `--band`, olive mixed to black | dark |
| 5 | Pricing (`#pricing`) | `#f1f3f7` | blue-grey |
| 6 | FAQ (`#faq`) | `#f1f3f7` | blue-grey |
| 7 | Close | `#f1f3f7` | blue-grey |
| — | Footer | `#0d4037` | olive |

Every card inside those sections is `#ffffff`. So the light half of the page runs on **three**
surfaces — white cards on a blue-grey canvas with an `#e4e8ee` third tone — which is exactly the
"grey here, white there" the owner saw.

**The root cause is hue, not just count.** The neutrals are blue:

| Token | Light value | Hue |
|-------|-------------|-----|
| `--canvas` | `#f1f3f7` | ~220° blue |
| `--surface-alt` | `#e4e8ee` | ~218° blue |
| `--border` | `#d5dbe3` | ~215° blue |
| `--muted` | `#59606b` | ~218° blue |
| `--ink` | `#0d4037` | ~168° **green** |
| `--primary` | `#07d6a0` | ~165° **green** |

Body text (`--muted`) and every hairline are blue-grey while the brand is green. That mismatch is
why the page reads as unresolved even where the greys are individually fine.

**Verified live.** Setting the landing root to a white ground with green-tinted neutrals was tested
in the browser: the FAQ card still separates from the page on its existing hairline and shadow, and
the green accents (icon tile, CTA pill, open-question button) carry the section on their own.

### Two defects found while auditing

- **Nested `<main>`** — `components/marketing/landing-device.tsx:204` renders a `<main>` inside the
  page's `<main>`. Two `main` landmarks is an accessibility defect and it skews DOM queries.
- **A blind spot in the contrast gate** — `lib/design/brandContrast.test.mjs` forbids the bright
  green as text on light grounds, but only scans `app/globals.css` and `.tsx`. It never reads CSS
  modules. Today the landing modules are clean because every green-text rule sits on a dark ground
  (`landing-hero.module.css`, `landing-features.module.css`); the moment a section flips to white
  that protection is gone and nothing fails the build.

---

## Architecture decisions

**D1 — Scope the palette; never touch the global tokens.**
`--muted` is used in **220 files**, `--surface-alt` in 215, `--surface` in 105, `--canvas` in 53.
Editing `:root` would restyle the whole CRM. The override goes in a `.landing-type` block, the class
already on the landing root, exactly as the round-3 font override does. Blast radius: `/` only.

**D2 — Two grounds: white and deep olive.**
White (`#ffffff`) replaces the blue-grey canvas; the existing dark bands (hero, features, footer)
stay. The page then alternates white → olive → white → olive, which is a *stronger* rhythm than
grey-on-white ever gave, and it is unmistakably green-and-white. Separation inside a white section
comes from hairlines, spacing and the mint `--primary-soft`, not from a second grey.

**D3 — Green stays a fill, never text on white.**
`--primary` is 1.8:1 on white. Green text on a light ground uses `--accent-ink` (`#00735a`, ~5.3:1).
This is already the house rule; D2 widens where it bites, so the gate must be widened with it.

**D4 — Draw the FAQ illustration in the idiom that already exists.**
`landing-features.module.css` already has an isometric CSS-3D system (`.scene`, `.plane`, `.tile`,
`perspective: 2000px`). The FAQ graphic reuses it rather than introducing a second illustration
style — per AGENTS.md, "compose, do not hand-roll". The reference image's *composition* is the
input; its blue palette and puzzle metaphor are not.

---

## Task list

Tasks, acceptance criteria and verification: [todo.md](todo.md).

### Phase 1 — Colour (foundation)
- [x] Task 1: Scoped landing palette in `app/globals.css`
- [x] Task 2: Move the light sections onto the white ground
- [x] Task 3: Close the contrast blind spot in the design gate

### Checkpoint: Colour
- [x] Both themes inspected at 1536×826, 1366×657, 390×844
- [x] No card or control disappears into its ground
- [x] `npm test` green

### Phase 2 — Navigation
- [x] Task 4: Reorder and relabel the header nav, align the footer

### Checkpoint: Navigation
- [x] Every nav item scrolls to the right section, desktop and mobile menu

### Phase 3 — FAQ illustration
- [x] Task 5: Isometric FAQ scene
- [x] Task 6: Fix the nested `<main>` landmark

### Checkpoint: Complete
- [ ] Reduced-motion still state verified
- [ ] `tsc`, `eslint`, `npm test` all green; PR opened

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| White cards vanish on a white ground | High | Already tested live — the hairline and shadow carry them. Task 2 re-checks every card type. |
| A scoped override leaks into `/pricing` | Medium | `/pricing` also carries `.landing-type` (round 3). Task 1 decides deliberately whether it inherits; inspect both pages. |
| Green text becomes illegible when a section turns white | High | Task 3 extends the gate to CSS modules *before* Task 2 lands, so the build catches it. |
| Dark theme regresses — `--canvas` `#08110f` and `--surface` `#0f1a17` are already nearly identical | Medium | Treat dark as its own pass in Task 2; do not assume the light fix transfers. |
| Isometric scene costs frames on a mid laptop | Low | Reuse the existing `.plane` transforms; static, no rAF loop; `aria-hidden`. |

---

## Open questions

1. **Pricing nav target.** The requested order (…Features, Pricing, FAQ) matches page scroll order,
   which implies `/#pricing` (the teaser). But today it points at the full `/pricing` page and
   `key: "pricing"` drives the active state there. **Recommendation: keep `/pricing`** — it is a
   destination people expect to land on, the teaser is still reachable by scrolling, and the active
   state keeps working. **Answered 3 Nov: keep `/pricing`** — implemented.
2. **Does the dark features band stay?** It is the rhythm anchor for D2. Recommendation: keep.
3. **Carried over from the branch move:** the 21MB of research images — one commit or two?

---

# Phase 4 — the FAQ mark, rebuilt to the reference (added 3 Nov, owner)

The owner pointed at the FAQ illustration on [zabalmedia.co](https://zabalmedia.co) and asked for ours
to match it: "there it has an animation and it looks better than what we have right now."

## What the reference actually is

Inspected live, 1440x900. The illustration is a **Lottie** (`61cb3955308c1777485f303f_faq.json`,
424x348, `data-loop="1"`). Sampling the loop shows an **assemble-in**: the flat tiles fade and slide
up first, the labelled tile and its badge drop in after them, the composition holds, then it clears
and replays.

Composition: one rounded isometric tile with a puzzle tab on its edge, carrying a three-line label
lying in the isometric plane; a circular "?" badge standing above it; three flat tiles settled
around it.

## Architecture decisions

**D5 — The motion is ours, the idea is theirs.** The Lottie is Zabal Media's authored asset and is
not reused, nor is a Lottie runtime added (the spec allows no dependency beyond `animejs@4.5.0`).
The composition and the assemble-in are reproduced in our own CSS/anime.js, in brand green, mint,
white and deep-olive ink. This is the manager's "study, then adapt", not a copy of their file.

**D6 — The loop is allowed now, but it pauses off screen.** Phase 3's Task 5 said "no always-on
animation loop"; the owner has now asked for the animation, so that criterion is superseded. The
cost is paid back with an IntersectionObserver: nothing runs while the section is out of view, and
only transform and opacity are animated.

**D7 — The label lies on the tile, as it does in the reference.** It is a label on an object, not a
heading, so it does not compete with "The ones people actually ask" above it.

## Task

- [x] Task 7: Rebuild the FAQ mark as an assembling puzzle piece

## Open question

4. **The tile's label.** The reference's tile says "Frequently asked questions". Ours uses that same
   generic phrase by default — it is the thing the owner pointed at, and it reads as an object label
   rather than a second headline. Flagged as new copy for review per the spec's copy rule. Say the
   word and it becomes "Questions" (the existing eyebrow, moved onto the tile) instead.

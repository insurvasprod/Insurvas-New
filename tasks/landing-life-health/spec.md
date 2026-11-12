# Spec: Life and health, as a before and after

**Branch:** `redesign/landing-feature-cards`. **Revert:** `git checkout -- components/marketing/landing-lines.*`
(the band it replaces is its own commit, `87e36bb8`).

## Objective

The band between the trust band and "What's broken today" tells one story in one gesture: Insurvas
began on the life insurance floor, and now runs life and health. Owner, 10 Nov: two "photos" with a
slider between them; on arrival the slider sits fully on the first ("we started on life insurance"),
then glides across to reveal the second ("now life and health"). Fancy copy, the site's colours,
animated, modern, "but not too much". Reference: the 21st.dev NexaCore hero (dark ground, a fan of
light rising from below).

## Decisions

- **The photos are drawn, not generated.** No image-generation key is configured here, and a drawn
  scene stays sharp at every size, animates, and follows the theme. Each scene: deep-olive ground, a
  fan of light rays rising from the bottom centre, a soft glow, film grain, a vignette, and centred
  type. *Before* is narrow and quiet (one green fan). *After* is wide and bright (green and soft-mint
  fans, a stronger glow): the business grew.
- **Brand only:** `#07d6a0`, `#0d4037`, `#0a8769`, `#c5ffed`, mint `#4fe3bb`. No blue (reserved for
  "info"). Headline in the brand sans with the key words in the accent serif italic, as the hero does.
- **The slider:** a hairline divider with a small round handle (two chevrons). Drag anywhere on the
  image, click to jump, arrow keys and Home/End on the focused handle (`role="slider"`). Phones keep
  vertical scrolling (`touch-action: pan-y`).
- **The reveal is two counter-moving transforms**, not an animated `clip-path` (which repaints): the
  *before* scene sits in a wrapper that slides away while the scene inside slides back by the same
  amount. Compositor-only, so the drag and the glide hold 60 fps.
- **The glide:** once the band is ~55% in view, it holds on *before* for 0.8 s, then glides to *after*
  over 1.8 s (ease-in-out). Once. Touching the slider cancels it. Reduced motion: *after* shown, no glide.
- **The rays breathe** (a slow rotation of a few degrees), only while the band is on screen.

## Copy

| | Before | After |
|---|---|---|
| Tag | Then | Now |
| Kicker | Chapter one | Chapter two |
| Headline | Born on the *life* floor. | Now *life* and *health*, under one roof. |
| Line | Final expense, term, whole life and IUL. One ledger for every policy written. | Medicare and the ACA, beside final expense. One book of business for every line your agents sell. |
| Chips | Final Expense · Term Life · Whole Life · IUL | the same, plus Medicare Advantage · Medicare Supplement · ACA Marketplace |

Medicare Supplement and ACA Marketplace stay **to confirm** (owner): they must be in the product
catalogue before this goes live, as for the band this replaces.

## Success criteria

- At 1536×826 (light and dark) and 390×844: the band shows *before* on arrival, glides to *after*,
  and the handle drags both ways; keyboard works; vertical scroll on a phone is not captured.
- During the glide and a drag: no layout, no repaint of the scenes (trace).
- Design tests, typecheck and lint pass.

## Boundaries

- Always: brand colours, sample-free truthful copy, both themes and a phone checked.
- Ask first: new dependencies, generated or stock photography.
- Never: claims the product does not support.

# Insurvas brand (2026): how the guide maps onto the product

**Sources:**
- the designer's guide, kept verbatim in [BRAND-GUIDE-SOURCE.md](BRAND-GUIDE-SOURCE.md) (Spanish; "Manual de Marca Insurvas 2026");
- the logo delivery (SVG, EPS, PDF, PNG and JPG).

This file is the English summary and records every place the product had to interpret the guide.
[UI-CONSISTENCY.md](UI-CONSISTENCY.md) stays the authority for how a page is built. This file is the
authority for colour, type and the logo.

## The identity

- **Concept:** "Data Highway" (speed, real-time data, reliability). The isotype fuses an **I** and a
  **V** into one checkmark with sloped speed lines.
- **Bright green `#07d6a0`:** action, active state, the isotype. It is used as a **fill or mark,
  never as text on a light ground** (1.8:1 on white).
- **Deep olive "ink" `#0d4037`:** headlines, the navigation rail, the top bar, the footer.
- **Mid green `#0a8769` / `#008769`:** the institutional middle tone. The product uses `#008769`
  for the focus ring.
- **Soft green `#c5ffed`:** the light end of the ramp (`--brand-100`). Chip and selection grounds
  use the lighter `--primary-soft` `#dcfaf0`.
- **Type:** the guide's brand face is Montserrat, with negative tracking on headings. Coolvetica is for display
  banners only.
  - **v3 (2026-10-27), Live:** the agent, partner and admin apps, every auth page, legal and
    affiliate pages use **Inter**, with **Inter Tight** for page titles and large numbers
    (`--font-display`) and Geist Mono for identifiers. Montserrat stays on the marketing pages (`/`
    and `/pricing`, through `.type-brand`) and in emails. See
    [UI-CONSISTENCY.md §0](UI-CONSISTENCY.md#0-foundation-v3-2026-10-27).
- **Shape:** pill-shaped buttons, 12px cards, 8px inputs.
  - **v3 (2026-10-27), Live:** buttons have 8px corners like inputs; cards stay 12px. See [UI-CONSISTENCY.md §5a](UI-CONSISTENCY.md#5a-control-shape-v3).

## Where it lives in code

| Thing | Where |
|---|---|
| Colour tokens (light and dark) | `app/globals.css`, `:root` and `.dark` |
| Contrast and naming rules, enforced | `lib/design/brandContrast.test.mjs` |
| Admin console (the app's colours and shell with a blue accent, owner decisions 2026-10-13: accent tokens only) | `app/admin/admin-plane.css` |
| Font | `app/layout.tsx` loads Inter, Inter Tight, Geist Mono and Montserrat via `next/font` (self-hosted at build). Tokens in `app/globals.css`: `--font-sans` (Inter), `--font-display` (Inter Tight), `--font-mono` (Geist Mono), `--font-brand` (Montserrat, applied with `.type-brand` on the marketing pages). Held by `lib/design/typeface.test.mjs`. |
| Logo | `components/shared/insurvas-logo.tsx`, which reads `public/brand/*.svg` |
| Favicon / home-screen icon | `app/icon.svg`, `app/apple-icon.tsx` (rendered from the isotype) |
| Emails | `lib/email/brand.ts` |

## Logo files (`public/brand/`)

All of them are cut from the designer's master, `insurvas-logo-source.svg`, by viewBox only. Paths
and proportions are untouched.

| File | Use |
|---|---|
| `insurvas-logo.svg` | Isotype and wordmark on a light ground |
| `insurvas-logo-on-dark.svg` | On the olive rail, the dark top bar, dark mode. The wordmark is white. |
| `insurvas-isotype.svg` | The mark alone: the collapsed rail, the favicon |
| `insurvas-isotype-on-dark.svg` | The mark alone on a dark ground |

`<InsurvasLogo tone="dark">` picks the on-dark file. With no `tone` it follows the theme.

## Interpretations (confirm with the designer)

1. **The on-dark isotype.** The supplied gradient ends in exactly `#0d4037`, the colour of the new
   rail, so the "V" vanished on it. The on-dark file remaps the gradient from `#07d6a0` to
   `#09af85`: the same sweep, ending in a green that stays visible. The supplied white PNG keeps the
   olive end.
2. **Canvas (light theme v1, owner pick "C · White + olive lines", 2026-11-12).** A near-white page
   (`#fbfcfb`) whose structure comes from green-tinted lines and olive-tinted bands, not grey fills or
   shadows. Every neutral takes the brand's green hue, the same family as the dark theme's olive:
   band `--surface-alt` `#e9f2ee` (table and card heads, chip grounds), white tiles outlined by
   `--tile-edge` `#d9e5df`, hover `--hover-wash` `#f1f7f4`, row line `--rule` `#dbe6e1`, border
   `#cbd8d2`, body `#26332e`, muted `#4d5f58`. Cards are solid white; a card's edge, not a shadow,
   separates it. Shadows are olive, never black. The old blue-grey ramp (`#f1f3f7` / `#e4e8ee`, ~220°)
   fought the green brand and is gone. "A · Sage" was built first and dropped the same day as too
   close to the old look. Board: `docs/design/light-v1/mockup.html`.
2a. **Gold, the third brand colour (owner pick 2026-11-12, `docs/design/accent-v1/mockup.html`).**
   Green acts, olive frames, gold **highlights**. Use it only for:
   - a rise (`DeltaChip` when the change is good);
   - the second line on a chart (`LineSeries` `compare`, `--cat-2` / `--data-2`);
   - people (avatars and initials);
   - counts of new things (the bell, the rail counts, "New");
   - at most one feature button a page (`Button variant="highlight"`, e.g. the dashboard's Start Calling).
   
   It is never a status and never an everyday button. Tokens:
   - `--highlight` `#f2b33d` is a fill (1.9:1 on white, so never text) carrying `--on-highlight` (ink, 6.2:1).
   - Gold text is `--highlight-ink`: `#8a5a00` in light, `#f5c562` in dark.
   - `--highlight-soft` is a gold chip's ground. `--highlight-mark` (`#c98a12` in light) is gold as a chart line.
   
   To keep "needs action" from reading as gold, warning moved from amber to burnt orange: `--warning`
   `#b04400`, `--warning-ink` `#9a3d00`, and `#f08a4b` in dark. The categorical palette swapped its 2nd
   and 5th hues (gold is 2nd, indigo 5th). The alert badge on the bell stays red (`.is-alert`).
3. **Brand text.** Text in the brand colour uses `--accent-ink` `#00735a`. The guide's mid green is
   4.6:1 on white but 3.6:1 on the grey bands, under the 4.5:1 text bar.
4. **Pressed button.** The guide's pressed `#008769` under ink text is 2.5:1. The product uses
   `#08ba8d` (4.6:1).
5. **"Info" is blue** (`#2563b8`). The product's old teal would read as brand green, so in-progress
   states use blue.
6. **Dark mode** is derived; the guide defines light only:
   - near-black surfaces with a trace of olive;
   - the same bright green;
   - mint text links (`#4fe3bb`).
   
   It needs designer sign-off.
7. **Coolvetica** was not supplied and needs a licence. `--font-display` is Inter Tight (v3) in
   the apps; the marketing pages use Montserrat until the files are added with `next/font/local`.
8. **Eyebrows.** The guide styles uppercase "eyebrow" labels. App pages keep the no-eyebrow rule
   (UI-CONSISTENCY §2). Marketing and sign-in panels may use the label style.
9. **Landing page type (owner decision 2026-11-03).** The landing page (`/`) sets headlines in
   Inter Tight and body copy in Inter, with one italic word per headline in Instrument Serif
   (`--font-accent`) as the accent. Montserrat stays in the wordmark and on `/pricing`. Wired through
   `.landing-type` in `app/globals.css`.
10. **Public-site ground (owner decision 2026-11-03).** The public pages run on **two** grounds:
    white, and the deep olive already under the hero, the features band and the footer. There is no
    grey canvas. Since light theme v1 (2026-11-12) the app's own neutrals are green-tinted too (rule 2);
    the public pages still set `--canvas` and `--surface` to white and `--info-*` to teal. These live in the
    `:root:not(.dark) .landing-type` block in `app/globals.css` and are **light-only and
    landing-scoped**: `--muted` alone is read by 220 files, so `:root` must never be edited for a
    marketing change. Separation inside a white section comes from hairlines, spacing and
    `--primary-soft` — never a second grey. The bright green stays a fill (rule 3); green text on a
    light ground is `--accent-ink`, enforced for CSS modules too by
    `lib/design/brandContrast.test.mjs`.

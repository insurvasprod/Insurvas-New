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
- **Type:** Montserrat throughout, with negative tracking on headings. Coolvetica is for display
  banners only.
  - **v3 (2026-10-27), Decided, lands in `foundation-tokens`:** the agent, partner and admin apps and
    every auth page move to **Inter**, with **Inter Tight** for page titles and large numbers and
    Geist Mono for identifiers. Montserrat stays on the marketing site. See
    [UI-CONSISTENCY.md §0](UI-CONSISTENCY.md#0-foundation-v3-2026-10-27).
- **Shape:** pill-shaped buttons, 12px cards, 8px inputs.
  - **v3 (2026-10-27), Decided, lands in `foundation-components`:** buttons move to 8px corners
    like inputs; cards stay 12px. See [UI-CONSISTENCY.md §5a](UI-CONSISTENCY.md#5a-control-shape-v3).

## Where it lives in code

| Thing | Where |
|---|---|
| Colour tokens (light and dark) | `app/globals.css`, `:root` and `.dark` |
| Contrast and naming rules, enforced | `lib/design/brandContrast.test.mjs` |
| Admin console (the app's colours and shell with a blue accent, owner decisions 2026-10-13: accent tokens only) | `app/admin/admin-plane.css` |
| Font | `app/layout.tsx` (Montserrat via `next/font`, self-hosted at build); `--font-sans` / `--font-display`. Inter for the apps lands in `foundation-tokens`. |
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
2. **Canvas.** The guide's `#FCFCFD` canvas is 1.03:1 behind a white card, so cards disappear. The
   product keeps its grey canvas ramp (`#f1f3f7`, bands `#e4e8ee`), which was tuned for depth.
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
7. **Coolvetica** was not supplied and needs a licence. `--font-display` falls back to Montserrat
   600 until the files are added with `next/font/local`.
8. **Eyebrows.** The guide styles uppercase "eyebrow" labels. App pages keep the no-eyebrow rule
   (UI-CONSISTENCY §2). Marketing and sign-in panels may use the label style.

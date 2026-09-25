# 00 · Foundation

The contract every page inherits. Read this once; every page prompt assumes it.

---

## 1. There are two visual identities, and that is deliberate

This is the single most important fact about the design system, and the thing most likely to be
broken by someone redesigning "consistently".

| Identity | Where | Accent | Canvas | Defined in |
|---|---|---|---|---|
| **Insurvas blue** | public marketing, `/admin/*`, `/legal/*` | `#0070cc`, navy `#00407f` | `#f7f9fb` | `:root` in `app/globals.css:40` |
| **Brex orange** | `/app/*` (agent), `/partner/*` (partner) | `#ff5900` | `#fcfcfd` | `.portal-agent, .portal-partner` at `app/globals.css:163` |

The orange tokens are scoped to a root class, not to `:root`. A page enters the orange identity by
carrying `portal-agent` (and `portal-partner` for the partner portal) on its outermost element.

**Do not unify these without an explicit decision from the product owner.** The split exists so the
platform-operator surface (admin) and the customer-facing product read as different systems. If the
decision is made to unify, it is a one-file change in `globals.css` — move the portal block to
`:root` — not a 93-page change.

### The orange accent is an action signal, not a colour scheme

From `brex.design.md`, and it is the rule most often broken:

> Do not flood sections with orange backgrounds; Brex orange is an action signal, not the page canvas.

Concretely: **one** `#ff5900` element per viewport. It is the primary action, or the active nav item,
or a single selected state — never two of those at once in the same view. Everything else is ink,
border, or surface. A page with three orange buttons has no primary action.

### Dark mode

`.dark .portal-agent` (`globals.css:201`) redefines the portal tokens for dark. The theme class goes
on `<html>` via `components/theme-provider.tsx`, and `ThemeToggle` sits in the sidebar footer of both
portals.

Note the selector: it keys on `.portal-agent`, **not** `.portal-partner`. The partner shell works
because `app/partner/(portal)/layout.tsx` sets `className="portal-agent portal-partner"` — both
classes. Three partner auth pages set only `portal-partner` and therefore stay light in dark mode.
That is defect **D-07**; fix the selector, not the pages.

---

## 2. Tokens

Use tokens. Do not write a hex value in a component. Every colour below already exists.

### Surfaces and ink (portal identity)

```
--portal-canvas      #fcfcfd   the page ground
--portal-panel       #ffffff   a card
--portal-group       #f6f7f9   a grouped/banded panel, table header row
--portal-line        #e6e8eb   a divider or card edge
--portal-line-strong #c9cdd2   a heavier rule
--portal-ink         #15191e   primary text
--portal-muted       #69707b   secondary text, metadata, captions
--portal-primary     #ff5900   THE action colour
--portal-primary-hover #e84d00
```

Consumed through the Tailwind semantic layer, so `bg-card`, `text-muted-foreground`, `border-border`
and `bg-muted` all resolve correctly inside a portal root. **Prefer the semantic utility over the raw
variable** — it is what makes dark mode work without touching the component.

### Semantic

```
--color-success  #12894f (light) / #4cb98a (dark)
--color-warning  #b54708 (light) / #d99a4e (dark)
--color-danger   #d92d20 (light) / #f2837a (dark)
```

### Two tokens that exist for a reason — do not collapse them

**`--color-accent-ink` vs `--brand-700`.** `--brand-700` is a *surface* (the sidebar, a table header)
and stays dark in both themes. `--color-accent-ink` is *ink* — a heading or a link on a card. Thirty-two
places once used the surface colour as a text colour, which is legible on white and invisible on a dark
card. If you need accent-coloured text, it is `--color-accent-ink`.

**`--color-border` vs `--color-control-border`.** A divider is `--color-border` (`#e6e8eb`, deliberately
soft). A form control's edge is `--color-control-border` (`#a6abb3` in portal). WCAG 1.4.11 asks for 3:1
on a control boundary; `--color-border` measures 1.28:1 on white, which is a divider's job. **Every
input, select, textarea and outline button uses `--color-control-border`.** This was measured and fixed;
do not undo it by styling inputs with `border-border`.

---

## 3. Type

Inter, weights 400 and 600 only. Avoid 700+ except for a compact numeric status label. Tracking
tightens as size grows — this is the Brex voice and a headline at `0em` is wrong.

| Role | Size | Weight | Tracking | Use |
|---|---:|---:|---:|---|
| hero | 56 | 600 | −0.035em | marketing hero only |
| headline-lg | 40 | 600 | −0.03em | page `h1` on a wide workspace |
| title-lg | 32 | 600 | −0.025em | page `h1` default, metric values |
| title-md | 24 | 600 | −0.02em | panel heading (`h2`) |
| title-sm | 18 | 600 | −0.015em | sub-panel (`h3`), card title |
| label | 12 | 600 | +0.02em, uppercase | the eyebrow, table column headers |
| button | 14 | 600 | −0.01em | all buttons and nav |
| body | 16 | 400 | −0.02em | paragraphs |
| caption | 14 | 400 | −0.02em | metadata, helper text, card descriptions |
| legal | 12 | 400 | −0.01em | footnotes |

**Numerals in any column that is compared vertically get `tabular-nums`.** Money, counts,
percentages, durations. A table of right-aligned proportional digits does not line up and is the
most common data-table defect in this codebase.

---

## 4. Shape, spacing, elevation

```
radius:   6px editorial media · 8px controls and inputs · 12px panels and cards · pill for marketing CTAs
spacing:  8 / 16 / 24 / 32 · marketing sections 80–120 · card padding 24–32
```

**Elevation is almost never the answer.** Hierarchy comes from the surface ladder
(canvas → group → panel), the border, and type scale. The only sanctioned shadow is
`0 4px 16px rgba(0,0,0,0.12)` on hover for a card that is genuinely clickable. No glassmorphism, no
gradients, no glow. A static card gets a border, not a shadow.

---

## 5. The page skeleton

Every workspace page in `/app` and `/partner` renders this shape. The 21 different hand-written
variants that exist today are the reason the product feels inconsistent.

```tsx
<div className="portal-<name>-page mx-auto max-w-7xl space-y-6">
  <header className="flex flex-wrap items-end justify-between gap-4">
    <div>
      <p className="portal-page-eyebrow">{SECTION}</p>     {/* see below */}
      <h1 className="text-4xl font-bold tracking-tight">{TITLE}</h1>
      <p className="mt-1 text-lg text-muted-foreground">{ONE_LINE_PURPOSE}</p>
    </div>
    <div className="flex flex-wrap gap-2">{ACTIONS}</div>   {/* at most one primary */}
  </header>

  {SUMMARY_STRIP}   {/* optional: 3–5 metric cards, grid sm:grid-cols-2 xl:grid-cols-4 */}
  {FILTER_BAR}      {/* optional: on --portal-group, one row, ends in the apply action */}
  {CONTENT}         {/* the work */}
</div>
```

### The eyebrow rule

The eyebrow is currently **38 distinct hand-typed strings**, six of which are mockup file numbers
(`10 / OPERATIONS`, `19 / Licensed agent`, `22 / Licensed agent`, `24 / Licensed agent`,
`25 / Analytics`, `25 / Vendor economics`) that leaked out of `docs/uiux-mockups/brex/` filenames
and shipped to production. That is defect **D-01**.

The other 32 are no better as a system: `Operations`, `Licensed agent`,
`Licensed Agent · Live operations`, `Licensed agent · Insight`, `Communication`,
`Communication / Partner workspace`, `Partners / Insight`, `Sell`, `Activity`, `LEADS`,
`LEAD PREVIEW`, `QUICK ACTION` and two dozen more — six competing taxonomies, inconsistent casing,
and several that are page titles rather than sections.

**The eyebrow is the page's `section` from `lib/menu/definition.ts`.** Nothing else. That file already
assigns every route a section: `Home`, `Book of Business`, `Leads`, `Sell`, `Retention`, `Insight`,
`Partners`, `Accounting`, `Compliance`, `Settings`. Derive it; never type it.

For the handful of pages outside the menu (auth, onboarding, checkout), the eyebrow is the step
position (`Step 2 of 3`) or omitted entirely. Never a number without a scale.

### Max width

`max-w-7xl` for tables and dense workspaces. `max-w-5xl` for a form or a reading page.
`max-w-3xl` for a single-column document. Do not stretch a text column past ~75 characters.

---

## 6. The six states — all six, every page

This is where the product currently fails hardest, and it is not a cosmetic issue.

### 6.1 Loading
Skeletons that match the final layout's shape, not a spinner in the middle of an empty page. The
metric strip and the table header render immediately; only the values are skeletal. Never move
content when data arrives.

### 6.2 Empty (success, zero rows)
A heading that says what will appear here, one sentence of explanation, and **the action that
creates the first row**. `/app/policies` does this well: "No policies yet" + Import CSV + Add
manually + Download CSV template.

### 6.3 Error — and this is the important one
**An error is not an empty state.** When a fetch fails the page must say so, in its own words, and
offer a retry. It must never render the zero-row copy.

```
✗ "No vendors yet"                            ← what /app/campaigns showed for an HTTP 500
✓ "We could not load your vendors." + [Try again]
```

Two supporting rules, both learned the hard way in this codebase:

- **A count that was never measured renders `—`, never `0`.** Zero is a fact. If the request failed,
  you do not have that fact.
- **A permanent condition never gets a transient message.** "Temporarily unavailable, try again
  later" for a missing database column is a lie that costs a support cycle. If the cause is a
  contract failure, say the contract failed and log the real cause.

`lib/supabase/schemaGap.ts` exists to distinguish a schema gap (fall back and show a pending notice)
from a real fault (surface it). It is deliberately narrow: `42501`, `57014`, `23505`, `23503`,
`08006`, `PGRST301` and `fetch failed` must all return `false`. Do not widen it.

### 6.4 Not entitled
`<FeatureGateNotice guard={guard} featureLabel description />` — or `<UpgradePrompt>` where the page
already uses it. Never a blank page, never a 404.

### 6.5 Wrong role
`<RoleGateNotice featureLabel detail />`. The `detail` says which roles *do* have it, so the reader
knows what to ask for: "Only owners and producers can see lead spend and vendor costs."

### 6.6 Read-only
When `entitlement.access === "read_only"` or status is `suspended`/`paused`: reading stays, writing
is disabled. Disabled controls keep a `title` explaining why. A visible read-only badge in the
header. **Never hide the data** — a suspended account keeps access to its book of business.

---

## 7. The shell

### Agent shell — `app/app/(shell)/layout.tsx`

Sidebar is `position: fixed`, 280px (250px at 768–1100px, 76px collapsed), `--brand-800` background,
dark in both themes by design — it is the workspace anchor. `<main>` gets a matching `margin-left`;
below 768px the offset resets to 0 and the sidebar becomes a drawer.

Above the page content, in this order, and the order is by urgency:

1. `MaintenanceMessage` — platform-wide outage
2. `AnnouncementStrip` — campaign message
3. `SubscriptionStateBanner` — trial ending, account suspended
4. `AgentAlertCenter` — per-user alerts
5. `AgentWorkspaceBar` — current workspace, plan, role, read-only

Do not reorder. An outage outranks an announcement, which outranks a trial notice, which outranks an
account state.

Navigation is built by `buildAgentMenu(effectiveFeatures, role)` and grouped by
`components/app/agent-sidebar.tsx` into: Home · **LA-1 Inbound operations** · **LA-2 Outbound
acquisition** · Business (8 collapsible sub-groups) · Partners · Settings · Plan access card.

The two module disclosures show `Enabled` / `Not included` / `Role restricted` and lock when
unavailable. **This structure is correct and the newest mockups match it** — see
`06-MOCKUP-INDEX.md`; several older mockups show a flat 7-item sidebar that does not exist and must
not be implemented.

An unbuilt destination renders a `portal-agent-nav-waypoint` dot titled "On the way".

### Partner shell — `app/partner/(portal)/layout.tsx`
Same sidebar mechanics. Overview · Submit lead · Pipeline · Messages, then an Organization group
(Team review, Team access — partner_admin only — and Settings), then the Partner access card. A
workspace bar shows partner name, role, status, and a "Submissions restricted" chip when the partner
is not `active`.

### Admin shell — `app/admin/(protected)/layout.tsx`
Blue identity. Nav from `buildAdminNav(role)`: Dashboard, then Customers · Billing · Catalog ·
Monitoring · Platform. Groups are drawn from permission boundaries, not a tidy taxonomy, so a group
is rarely half-empty for the role looking at it. A link is not rendered for a role that cannot open
the page — a visible link to a 403 is worse than no link.

`min-w-0` on `<main>` is load-bearing in all three shells. A flex item defaults to
`min-width:auto`, so without it one wide table drags the whole page sideways. Do not remove it.

---

## 8. Data tables

The product is mostly tables. Get these right once.

- Header row on `--portal-group`; 12px/600/uppercase/+0.02em labels in `--portal-muted`.
- `border-bottom: 1px solid --portal-line` per row; last row none.
- Row hover: `color-mix(in srgb, var(--portal-primary), transparent 95%)` — a 5% orange tint, not grey.
- Selected row: 3px `--portal-primary` left border + the same tint at ~92%.
- Numeric columns right-aligned with `tabular-nums`.
- The table scrolls inside its own `overflow-x-auto` container. The page never scrolls sideways.
- Sortable headers get a real `<button>` and `aria-sort`.
- Row actions: one visible primary (`View`) plus a `⋯` menu. Never five buttons per row.
- A row that opens a detail panel is a `<button>`, not a `<div onClick>`.

**Pagination shows the range and the total** ("Showing 1–8 of 1,482 leads"). A bare page number does
not tell an operator whether their filter worked.

---

## 9. Accessibility floor

Not optional and mostly already done — the work is in not regressing it.

- Contrast 4.5:1 body, 3:1 large text and control boundaries. Use `--color-control-border` on
  controls; that is what it is for.
- Focus is always visible: `outline: 2px solid var(--portal-primary); outline-offset: 2px`. Never
  `outline: none` without a replacement.
- Touch targets ≥ 44px high for buttons, nav items, dropdown triggers.
- Every icon-only control has an `aria-label`. Every decorative icon has `aria-hidden="true"`.
- Status is never colour alone — pair the colour with a word or a shape. ~4% of men cannot separate
  the danger and success hues.
- `aria-current="page"` on the active nav item.
- A modal traps focus, closes on Escape, and returns focus to its trigger.
- `prefers-reduced-motion` disables transitions. The stylesheet already honours it in five places;
  add to it, do not bypass it.

---

## 10. Responsive

| Width | Behaviour |
|---|---|
| 375 | single column, 16px gutters, sidebar is a drawer |
| 767 | last single-column breakpoint; `main` offset resets to 0 |
| 768–1100 | sidebar narrows to 250px |
| 1024 | two- and three-column grids engage |
| 1280+ | content centres at `max-w-7xl` |

Collapse rules: metric strips go 4 → 2 → 1. A filter bar becomes stacked full-width rows with a
full-width apply button. A detail side-panel becomes a full-screen sheet, never a squeezed column. A
board view falls back to the table view — do not shrink kanban columns below readable width.

---

## 11. Copy

- Sentence case for headings and buttons. Not Title Case.
- A button is a verb: `Claim`, `Import policies`, `Save mapping`.
- Say what happened, then what to do. "We could not load your vendors. Try again."
- **Never ship an internal ticket ID.** Four are live right now (`SA-0.1`, `SA-2.4`, `SA-2.3`,
  `SA-1.2 – 1.4`) plus "land in later tickets" — defect **D-02**.
- **Never ship a roadmap promise.** No dates. `ComingSoon` gets this right: it never gives a date,
  and always offers somewhere else to go.
- Never a mockup index number in an eyebrow — defect **D-01**.
- Numbers get units and scale. `$496.28`, `12.4%`, `68 waiting`, not `68`.

---

## 12. Before you call a page done

- [ ] All six states render correctly, including a forced fetch failure.
- [ ] Every control in the page's **Controls** table goes where the table says.
- [ ] Nothing in **Must do** regressed.
- [ ] One orange element in the first viewport.
- [ ] Eyebrow derived from the menu section, not typed.
- [ ] 375px: no horizontal page scroll, nothing overlapping.
- [ ] Keyboard-only: reach and operate every control; focus always visible.
- [ ] Dark mode: no invisible text, no white card on a dark page.
- [ ] Numeric columns are `tabular-nums`.
- [ ] `npm run lint`, `npm run typecheck`, `npm test` clean — including
      `lib/design/contract.test.mjs`, which holds the invariants on this page. If it fails, read
      the message: it names the rule you broke and where.

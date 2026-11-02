# Capability Map: Auth doors (sign-in and sign-up)

**Status:** proposed 2026-10-30, **not approved**. No module spec is written until this map is.
**Evidence:** [`RESEARCH.md`](RESEARCH.md) — eight competitor sign-in pages read live, plus a
measured critique of our own doors.
**Branch when approved:** `redesign/auth-doors`, off current `main` (not off `foundation-v3`).

The request bundles three things that can ship and be verified separately, so the boundaries get
agreed before anything is specified.

## Modules

| Module id | Responsibility | Depends on |
|---|---|---|
| `auth-panel` | The right-hand panel on every door: what it shows, whether it moves, how it aligns, and what replaces it below 1024px | — |
| `auth-sign-in` | The three sign-in doors (agent, partner, staff): what is asked and in what order, the other ways in, errors, recovery | `auth-panel` |
| `auth-sign-up` | The five-step funnel: what each step asks, progress, Back, and what the panel does per step | `auth-panel`, `auth-sign-in` |

**Build order:** `auth-panel` → `auth-sign-in` → `auth-sign-up`

**Why this direction.** The panel is the owner's stated priority and the only piece with P0 defects,
and both doors render it — fixing it first means the other two are specified against something that
already works. Sign-up step 1 shares its controls, its Google button and its first-field decision
with sign-in, so sign-in settles those once. Nothing points back the other way.

**Why not one spec.** The panel's acceptance criteria are visual and measurable (alignment, motion,
legibility, the mobile case) and owe nothing to what the form asks. Sign-in could ship
identifier-first with the panel untouched. The funnel could be cut entirely and neither of the other
two would change. One spec would force every task to reason over all three contracts at once.

## What each module has to settle

Not answers — the decisions its spec must close.

**`auth-panel`**
- Does the panel still move at all? (Research says: nobody in the peer set auto-rotates on a sign-in
  page. Three options to weigh: still panel with one message; still panel with one customer quote;
  one legible product still with no rotation.)
- If any product imagery stays: drawn at a size it can be read at, aligned to the text column, and
  not a 3D-rotated `zoom`ed live DOM.
- What the panel becomes below 1024px, where it is `display: none` today.
- How §13 of `UI-CONSISTENCY.md`, the comment at `app/globals.css:3183` and the
  "brand panel is still" test in `signupCopy.test.mjs` are brought back in line with the code.

**`auth-sign-in`**
- Identifier-first (email → Continue → route) versus both fields up front.
- Passkeys: Conditional UI on the email field, an explicit button, both, or not this round.
- Whether the built-but-unreachable magic link gets its entry point back.
- Whether the three doors converge on one set of alternatives or stay deliberately different.

**`auth-sign-up`**
- Whether the panel still changes per step, and what it shows if the carousel goes.
- Whether anything in the five steps can be cut or merged (the copy rules are settled and tested;
  the shape is not).

## Open questions for the owner

1. **The panel's job:** proof that the product is real (a product still), proof that other people
   use it (a quote), or just the brand said well (one line)? This decides `auth-panel` and nothing
   else can be specified before it.
2. **Scope of this round:** the panel only, or the sign-in form as well? The panel alone is the
   stated complaint; identifier-first and passkeys are a larger, separately shippable change.
3. **Mobile:** is a phone-sized version of the panel wanted, or is the form alone the right answer
   below 1024px?

## Assumptions I am making

Correct these now or the module specs proceed on them.

1. The split layout itself stays. The complaint is the panel's content and behaviour, not the
   two-column shape (five of eight peers are centred single-column — a real alternative, but a much
   bigger change).
2. `AuthLayout` stays the one layout and `PortalAuthSplitShell` its only renderer
   (`authShell.test.mjs` holds this). Nothing here proposes changing that.
3. Settled rules stay settled: 44px fields and buttons, the column order, 472/720px widths, the
   sign-up copy rules, no typed trial length, Back from step 2 on.
4. No auth screen scrolls at 1536×826, 1366×657 or 1920×1030 — this round keeps that.
5. Nothing changes about what the auth API routes accept or return. Passkeys, if taken up, are a new
   route beside them, not a change to the existing ones.
6. No new runtime dependency without asking (a WebGL or Lottie library would be a question, not a
   decision I make).

## Shared constraints on every module

- `npm run typecheck` · `npm run lint` · `npm test` — which runs `lib/design/uiConsistency.test.mjs`,
  `brandContrast.test.mjs`, `designDocs.test.mjs`, `authShell.test.mjs`, `signupCopy.test.mjs`.
- Every combination verified on `/design/auth` (dev only) at 1536×826, 1366×657 and 375 wide, in
  light and dark.
- `prefers-reduced-motion` honoured by anything that moves.
- A rule changed in `docs/design/UI-CONSISTENCY.md` §13 is changed in its test in the same commit.

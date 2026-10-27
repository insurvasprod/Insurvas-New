# Capability map: UI Foundation v3

Approved 2026-10-27. Source of the decisions: the "Insurvas UI Foundation v3" review page
(mockup copy in this folder, `mockup.html`) and the manager's feedback on it.

This map is the index of the work. Each module gets its own spec in this folder, named
`SPEC-<module id>.md`, written and approved in build order. Module ids never change.

| Module id | Responsibility | Depends on |
|---|---|---|
| `design-foundation` | Write the v3 decisions into the design docs (`UI-CONSISTENCY.md`, `BRAND.md`, `00-FOUNDATION.md`), keep the mockup in the repo, and put a short pointer `README.md` in every component and route folder plus a rule in `AGENTS.md`, so anyone building a page finds the rules. Docs only, plus one docs test. | — |
| `foundation-tokens` | Inter for the app and auth pages via `next/font` (Montserrat stays on marketing), gloss surface tokens, status tokens, 8px control corners, in `app/layout.tsx` and `app/globals.css`. | design-foundation |
| `foundation-components` | New glossy `StatRow` / `StatCard` (footer-fact layout) beside the untouched `StatStrip`, the inline filter panel in `DataToolbar`, the Button shape change, and the `uiConsistency` ratchet updated to the new rules. | foundation-tokens |
| `auth-shell` | One auth layout for sign-in, every sign-up step, set-password, confirm-email, partner and admin login: logo position, column width, step slot, one right-panel style, shared inputs, buttons and alerts. | foundation-components |
| `signup-flow` | Sign-up copy that makes sense (account first, trial only where it starts, trial length from one source, card wording from the payment mode), Back on steps 3 to 5, less text. Products and pricing unchanged. | auth-shell |
| `foundation-rollout` | On demand, page by page: when a page is being worked on, move it to `StatRow` / `StatCard`, the inline filters and the other v3 rules, and drop its avatars. Pages nobody is working on are left as they are. | foundation-components |

Build order: `design-foundation` → `foundation-tokens` → `foundation-components` →
(`auth-shell` → `signup-flow`) in parallel with `foundation-rollout`.

## Decisions taken with the approval

| Question | Decision |
|---|---|
| Stat figures | The glossy stat card (option E, "footer fact") is the v3 stat figure. It is a new component, adopted page by page only on the pages being worked on (revised 2026-10-27); `StatStrip` stays on the rest. |
| Typeface | Inter (Inter Tight for headings and large numbers) in the agent, partner and admin apps and all auth pages. Montserrat stays on the marketing site. |
| Button shape | 8px corners, as in the v2/v3 mockups, replacing pill buttons. |
| Trial and card copy | Worded from the payment mode (`checkoutPaymentMode()`), never hard-coded either way. |
| Where the work happens | Branch `redesign/foundation-v3`, its own worktree. |

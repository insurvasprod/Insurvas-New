# Implementation Plan: Landing review round 1 (Umar's call, 4 Nov)

**Branch:** `redesign/landing-review-r1`, off `origin/main` @ `5100428c`. PR at the end.
**Source:** [docs/design/landing-review-2026-11-04.md](../../docs/design/landing-review-2026-11-04.md),
the priority summary is the work list. Section ids (A1.1, A8.6 …) refer to that doc.
**Scope:** `/` only: `components/marketing/*`, `components/public/site-footer.*`, one new public API
route for the contact form and its `lib/` module.
**Status:** planned 2026-11-06, building in the same session.

> `tasks/plan.md` / `tasks/todo.md` hold a different unfinished plan (sidebar + Lead Sources) and
> are left alone. So are `tasks/landing-round-4/` and the 4 Nov phone plan saved on the local
> branch `wip/landing-mobile-2026-11-04`.

## Not this round

- **A1.4** the hero device cycling through app screens (Umar: "we can do this later").
- **A11** SEO and social copy.
- **A1.3** the logo. Brand work, needs Umar.
- **A4** "What's broken today": no criticism given; left as it is.
- **A10.1** the standalone `/pricing` and `/roadmap` pages: waits on Umar's answer about `/pricing`.
- Anything Umar did not name. No wider redesign.

## Architecture decisions

- **Contact form: email, no table.** `POST /api/public/contact` validates with zod
  (`lib/marketing/contact.ts`), drops bots by honeypot, rate-limits per IP and per email with the
  existing `lib/rateLimit` claims, then sends through `lib/email/transport.ts` `sendEmail()`, which
  already writes `email_log`. Reply-To is the visitor. The inbox is `CONTACT_INBOX_EMAIL`, falling
  back to `SMTP_FROM_EMAIL`. No migration, nothing new to administer. If the business later wants
  requests in the admin console, a table is a follow-up.
- **The form is composed, not hand-rolled:** `Field`, `Input` and `textareaControl` from
  `components/ui`. Its submit button is `MarketingCta`, extended once to render a `<button>`
  (the marketing CTA is a link today).
- **One flow-diagram component** (`landing-flow.tsx`) draws every bento module's diagram from data:
  nodes, edges and the order a record visits them. Rendered as HTML plus one SVG for the wires, and
  animated with anime.js (approved). It runs only while its card is in view, and under reduced
  motion it shows the finished state still. This replaces the per-feature isometric `Scene`.
- **The five-tools section is rebuilt on the Clepso pattern** (looked at clepso.io on 2026-11-06:
  three curved rows of "mess" cards drift towards a central logo tile, and a beam drops from it into
  the next section). Ours: the agency's five tools as a 3D card stack that collapses into the
  Insurvas tile on scroll-in (A3.1), mess cards drifting into it, clean outcomes coming out the other
  side (A3.3). It moves to the deep-olive ground, so the page alternates dark and light (A0.3).
- **Looping motion is allowed here.** The §17 "no endless motion" ratchet exempts marketing files
  (`marketing()` in `uiConsistency.test.mjs`). Every loop still pauses off-screen
  (IntersectionObserver) and stops under `prefers-reduced-motion`.
- **Copy is cut, not rewritten from scratch.** Every claim stays one the product enforces; anything
  new that is unconfirmed is marked `TO CONFIRM (Umar)` in the code.

## Task list

See [todo.md](todo.md) for the acceptance criteria and verification of each task.

### Phase 0: Critique before building
- [ ] Task 0: ui-taste critique and distill pass on this plan's designs

### Phase 1: The four small ones
- [ ] Task 1: "Agent workspace" / "Team workspace" (A6.4)
- [ ] Task 2: No rule under the last FAQ row (A7.2)
- [ ] Task 3: No hatched ring on the recommended card (A6.2)
- [ ] Task 4: "Complete" out of the hero headline, line re-broken (A1.1)

### Checkpoint A
- [ ] `npm test`, typecheck, lint on touched files; page checked at 1536×826

### Phase 2: Structural, biggest first
- [ ] Task 5: Contact / custom-request form on the roadmap section (A8.6)
- [ ] Task 6: Roadmap photo shortened, darkened, text over it (A8.3, A8.4)
- [ ] Task 7: Bento: seven modules, shorter copy (A5.1, A5.2)
- [ ] Task 8: Flow-diagram component and the seven diagrams (A5.3)

### Checkpoint B
- [ ] Tests green; contact form submits on the dev server; bento checked in both themes

- [ ] Task 9: Five tools → 3D stack resolving into Insurvas, Clepso flow (A3.1, A3.2, A3.3)
- [ ] Task 10: Social proof band rebuilt (A2.1)

### Checkpoint C
- [ ] Tests green; full page scroll at 1536×826 in dark and light

### Phase 3: Design judgement and copy
- [ ] Task 11: Pricing cards selectable, with a transition (A6.1)
- [ ] Task 12: Pricing ground in light mode (A6.3)
- [ ] Task 13: FAQ questions rewritten (A7.3)
- [ ] Task 14: Footer pass, with a Contact link (A9.1)
- [ ] Task 15: Shape behind the hero headline (A1.2)
- [ ] Task 16: Phone and tablet pass over the whole page (A0.1)

### Checkpoint D: Complete
- [ ] ui-taste polish pass done
- [ ] `npm test`, `npm run typecheck`, lint, `npm run build` pass
- [ ] Screens at 1536×826, 1366×657, 390×844 in dark and light
- [ ] PR opened with the three questions for Umar

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Edits flip CRLF/LF line endings | Med | `git diff --stat` after every edit to an existing file |
| Seven sticky cards make the page too long | Med | Shorter cards (copy cut to a line and three points); sticky only above 1000px |
| Motion jank (three loops on one page) | Med | transform and opacity only; each loop paused off-screen; one rAF-free anime.js timeline per visible diagram |
| Contact form used to spam the inbox | Med | honeypot, per-IP and per-email limits, length caps, plain-text escaping |
| No contact inbox configured in an environment | Low | falls back to `SMTP_FROM_EMAIL`; `sendEmail` logs a skipped send instead of throwing; the form still says it was received |
| `brandContrast.test.mjs` rejects green text on the new dark sections | Low | add the new dark-ground modules to its dark-band list with a reason, as the bento's is |

## Open questions for Umar (flagged in the PR, not blocking)

1. **A5.1:** the final seven module names. Built with his spoken first pass: Partnerships & lead
   flow · Outbound dialer & leads · Applications · Commissions & book · Accounting · Retention ·
   Compliance.
2. **A10.1:** should `/pricing` stay its own route, or should pricing live only on the landing page?
3. **A1.3:** the logo redesign.
4. Also: which inbox should contact requests go to (`CONTACT_INBOX_EMAIL`), and is there a better
   roadmap photo (A8.2)? The current one is kept, darkened.

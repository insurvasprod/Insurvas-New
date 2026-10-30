# components/partner

Screens and parts of the partner portal (`/partner/*`), including its sign-in and invite frames.

**Rules:** [UI-CONSISTENCY.md](../../docs/design/UI-CONSISTENCY.md): the same rules as the agent
app (§2, §4/§4a, §6/§6a, §8, §10, §11, §12, §14). The auth screens here (`partner-auth-frame.tsx`,
`partner-login-form.tsx`, the invite and set-password forms) follow §13.
**Visual reference:** [foundation-v3/mockup.html](../../docs/design/foundation-v3/mockup.html).

Use the shared parts in [`components/ui`](../ui/README.md). The partner portal is not a separate
design system: it differs only in its menu and story copy.

## The Pipeline board's columns (2026-10-30)

`partner-lead-pipeline.tsx` draws its board from the **four shared lanes** — New · Claimed · On a
call · Converted, plus Closed when it holds something (`PARTNER_BOARD_COLUMNS` in
[`lib/partnerLeads/view.ts`](../../lib/partnerLeads/view.ts)) — not the agency's configured stage
names.

This reverses LA-1.17. The counters above the board have always spoken the lane vocabulary
(`lib/partnerLeads/counters.ts`), so with stage columns the page contradicted itself on screen:
"Claimed 1" over a column headed "New lead". Both are generated from the lane figures now, so they
cannot disagree.

The agency's own stage name is **not** lost: it is on every card, is a column in the table view, and
is still a filter. It stopped being the thing that sorts the board, nothing more.
`lib/partnerLeads/board.test.mjs` holds both halves of that.

Check a change on `/design/pipeline` (development only): busy, quiet, SLA-flagged, many pipelines,
empty and error, for both roles and three payout models, at 1536×826, 1366×657 and 375 wide.

Do not: introduce partner-only colours, controls or table styles.

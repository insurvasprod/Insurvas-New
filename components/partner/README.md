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

## Messages (2026-10-30)

A messenger, built from the kit — not a document with a form under it.

- **The thread** is [`chat-message.tsx`](chat-message.tsx), drawing what
  [`lib/partnerChat/thread.ts`](../../lib/partnerChat/thread.ts) returns: days, then runs of
  messages from one sender. That module is pure and tested; the component only draws it. Change
  *what groups with what* there, not here.
- **The composer** is the shared [`ChatComposer`](../ui/chat-composer.tsx): one bar, paperclip
  inside on the left, send on the right. Enter sends, Shift+Enter breaks the line.
- **Two panes, not three.** Conversation details is a `Sheet` (§11) opened from the thread's
  header. Below `md` it is one pane: the list, then the conversation, with a back control.
- **No avatars for channels** (§10). A Lucide glyph says agent channel, direct message or team
  channel.
- **No page CSS.** The 147 `.portal-agent-chat-*` rules are gone (§9). Keep it that way.

`viewerId` comes from `/api/partner/chat` — the caller's own id, from the session. Without it the
thread cannot tell your messages from the agency's, and draws everything on the received side
rather than guessing.

Check a change on `/design/messages` (development only): busy, quiet and empty, both roles, at
1536×826 and 375 wide. The development database has one channel and no reply, so two sides, a run,
a day separator and an attachment exist only there.

## Controls (2026-10-30)

The portal has **no native `<select>` left**. Every dropdown is `SelectMenu` — the searchable one
the owner approved on 2026-10-29 — a two-way choice is a `Segmented`, and picking several people is
`MultiPicker`. UI-CONSISTENCY §5b carries the rule. Native date inputs remain, for the reason §5b
gives.

Do not: introduce partner-only colours, controls or table styles, or a native `<select>`.

# Todo: Partner portal round 3 — Messages, Overview, Organization

Plan and decisions: [`plan.md`](plan.md). Branch `redesign/partner-pipeline`.

**Standing bar for every task:** `npm run typecheck` · `npm run lint` · `npm test` · no new offender
in `lib/design/uiOffenders.json` · the `PageHeader` treatment unchanged · CRLF preserved on files
that have it.

**Sizes:** 1536×826 and 1366×657 for desktop; 320, 360, 375, 390, 430 for phones.

---

## Phase A — Messages

### Task A1: One composer bar

**Description:** The owner's named complaint. Three stacked rows — textarea, then
`[Attach files | Send message]`, then a character counter — become one bar: paperclip inside on the
left, text growing in the middle, send on the right.

**Acceptance criteria:**
- [ ] One rounded bar: attach (icon, labelled) left, auto-growing textarea centre, send right
- [ ] The textarea grows from one line to about six, then scrolls; the bar grows with it
- [ ] Enter sends, Shift+Enter inserts a line break; the send control is disabled with nothing to send
- [ ] Chosen files are removable chips **inside** the bar, above the text
- [ ] The counter appears only within ~10% of the cap, not permanently
- [ ] Sending, attaching and the existing error handling behave exactly as before

**Verification:**
- [ ] Send a message; attach a file and send; remove a chosen file before sending
- [ ] 375 wide: the bar fits, the send control is at least 36px, nothing overlaps
- [ ] Paste a 2,000-character string: the counter appears and send still works

**Dependencies:** None · **Files:** `components/partner/partner-chat-panel.tsx`,
`components/ui/chat-composer.tsx` · **Scope:** Medium

---

### Task A2: The thread reads as a conversation

**Description:** Full-width blocks become bubbles with a side, grouped by sender, split by day.

**Acceptance criteria:**
- [ ] Your messages right on the brand surface; the agency's left on the card surface
- [ ] Consecutive messages from one sender group under one name and time
- [ ] Date separators between days ("Today", "Yesterday", "28 Oct" via `lib/format/dates`)
- [ ] System cards keep their meaning but sit centred, narrower and quieter than a message
- [ ] Attachments render inside their bubble; the delivered tick survives
- [ ] The thread scrolls to the newest message on open and on send

**Verification:**
- [ ] A thread with both senders, a system card and an attachment reads correctly
- [ ] Contrast measured on both bubble grounds, against the real surface, ≥ 4.5:1
- [ ] 375: bubbles cap at ~85% width and never overflow

**Dependencies:** A1 · **Files:** `components/partner/partner-chat-panel.tsx`,
`components/partner/chat-message.tsx` · **Scope:** Medium

---

### Task A3: Two panes, and Details as a sheet

**Description:** Three panels become conversations + thread, with Details opened from the header.
On a phone it is one pane: the list, then the thread.

**Acceptance criteria:**
- [ ] Details is a `Sheet` (§11), opened by the header's Details button, closed by Escape
- [ ] Its labels are sentence case with real values; "Not set by your agency" only where true
- [ ] "Open pipeline" is a proper action in the sheet, not a floating link
- [ ] Under `md`: the list is the page, a conversation opens the thread, a back control returns
- [ ] No avatars for channels (§10); a Lucide icon says direct message or team channel

**Verification:**
- [ ] Escape and the close button both dismiss; focus returns to the Details button
- [ ] 375: list → thread → back, with no horizontal scroll
- [ ] 1536: two panes, the thread taking the space Details used to

**Dependencies:** A2 · **Files:** `components/partner/partner-chat-panel.tsx` · **Scope:** Medium

---

### Task A4: Retire the chat CSS

**Description:** 127 `.portal-agent-chat-*` / `.portal-chat-*` rules in `app/globals.css` (§9).
Remove only what nothing else uses — the agent's lead workspace may share some.

**Acceptance criteria:**
- [ ] Every selector checked against `components/app/**` before removal, as round 2 did
- [ ] Rules nothing references are gone; shared ones stay, with a note naming their user
- [ ] No `.portal-agent-chat-*` class left in `components/partner/**`
- [ ] `globals.css` line endings unchanged (CRLF)

**Verification:**
- [ ] `grep -r "portal-agent-chat" components/partner/` returns nothing
- [ ] The agent app's chat and lead workspace still render (`/design/*` previews)
- [ ] `git diff --stat app/globals.css` shows a deletion-only change of sane size

**Dependencies:** A3 · **Files:** `app/globals.css`, `components/partner/partner-chat-panel.tsx`
· **Scope:** Small

---

### ✅ Checkpoint: Messages
- [ ] Send, attach, create a conversation, open details — all work as before
- [ ] Usable end to end at 375 and at 1536
- [ ] `npm test`, typecheck, lint green; no new offender

---

## Phase B — Overview

### Task B1: A chart kit, and the trend helper it draws

**Description:** The shapes the portal needs, in the house style, in one file so they can be
swapped for Recharts later. Plus the daily bucketing that Team review currently hides in a
`useMemo`, extracted and tested.

**Acceptance criteria:**
- [ ] `components/ui/chart.tsx` exports a bar series, a stacked share bar with a legend, and a
      sparkline — tokens only, no hex, no local surface
- [ ] Every shape has an accessible summary: a table or a described list behind the visual
- [ ] `lib/partnerLeads/trend.ts` buckets rows into days or weeks over a range, picks the step, and
      returns the max — pure, no React
- [ ] Unit tests: a single day, a range crossing a month, an empty range, a range longer than the
      data, the day/week step boundary

**Verification:**
- [ ] `node --experimental-strip-types --test lib/partnerLeads/trend.test.mjs`
- [ ] The shapes render at 320 and 1536 without overflow
- [ ] Reduced motion: no animation on first paint beyond the kit's own

**Dependencies:** None · **Files:** `components/ui/chart.tsx`, `lib/partnerLeads/trend.ts`,
`lib/partnerLeads/trend.test.mjs` · **Scope:** Medium

---

### Task B2: Submissions over time — the hero

**Description:** Replace the one-bar "Lead pipeline" panel with a real 30-day series.

**Acceptance criteria:**
- [ ] A daily bar series over 30 days, from the existing pipeline API (as Team review does)
- [ ] The 7-day total with its change against the previous 7, naming the comparison (§14)
- [ ] Best day as a supporting fact; a link into Team review for the date range
- [ ] Loads without blocking the stat cards; its own skeleton, and an honest empty state
- [ ] A figure that was not read is never drawn as 0

**Verification:**
- [ ] Busy and quiet fixtures both read correctly; empty says so
- [ ] The 7-day total matches the sum of the last 7 bars
- [ ] 375: the chart is legible and the page does not scroll sideways

**Dependencies:** B1 · **Files:** `components/partner/partner-portal-overview.tsx` · **Scope:** Medium

---

### Task B3: Where they end up, and how fast

**Description:** The share breakdown and the speed the partner actually experiences.

**Acceptance criteria:**
- [ ] A stacked share bar by lane (New / With a closer / On a call / Converted / Closed) with a
      legend and counts, replacing the stage-share panel
- [ ] Conversion rate as a figure with its comparison named
- [ ] A speed panel: average time to claim, and average reply in chat (from the pulse endpoint)
- [ ] Each figure links to the rows behind it where one exists
- [ ] Nothing shows a rate computed from zero submissions

**Verification:**
- [ ] The lane shares sum to the total and agree with the stat cards
- [ ] With no data the panels say so rather than drawing 0%
- [ ] Contrast of every legend swatch and label measured against the real surface

**Dependencies:** B1 · **Files:** `components/partner/partner-portal-overview.tsx` · **Scope:** Medium

---

### Task B4: Earnings, and the way out

**Description:** Money over time, and the shortcut list that replaces the three tiles.

**Acceptance criteria:**
- [ ] Statement history as a small bar series with the latest figure, from `/api/partner/payouts`
- [ ] The partner's rate shown beside it; a revenue share shows the percentage and no estimate
- [ ] "Jump to" as one-line links with their figures (§4b), replacing the three tiles
- [ ] `partner_user` sees only what their role may see; nothing new is exposed

**Verification:**
- [ ] A partner with no published statement gets an honest empty state, not an empty chart
- [ ] Both roles checked on the preview

**Dependencies:** B1 · **Files:** `components/partner/partner-portal-overview.tsx` · **Scope:** Medium

---

### Task B5: `/design/overview`

**Description:** The Overview on fixtures, so its states are checkable without a database.

**Acceptance criteria:**
- [ ] Busy, quiet, empty, error; both roles; development only, as `/design/pipeline`
- [ ] Fixtures reuse `lib/partnerLeads/fixtures.ts` rather than inventing a second set

**Verification:**
- [ ] Every state renders at 1536×826 and 375 with no console error

**Dependencies:** B2, B3, B4 · **Files:** `app/design/overview/page.tsx`,
`lib/partnerLeads/fixtures.ts` · **Scope:** Small

---

### ✅ Checkpoint: Overview
- [ ] A partner can answer "am I sending more, do they convert, how fast, what do I earn"
- [ ] Every figure agrees with the Pipeline page
- [ ] `npm test`, typecheck, lint green

---

## Phase C — Organization

### Task C1: Team review to the kit

**Acceptance criteria:**
- [ ] Six `StatTile`s become v3 `StatCard`s; no `StatStrip` left (`mixed-stat` stays at 0)
- [ ] The hand-rolled `<section className="rounded-lg border…">` becomes `Card`
- [ ] The trend uses B1's chart and B1's helper — one implementation with Overview
- [ ] The date range and Export Report keep working unchanged

**Verification:** range change redraws; export downloads; 375 has no sideways scroll
**Dependencies:** B1 · **Files:** `components/partner/partner-team-review-workspace.tsx` · **Scope:** Medium

---

### Task C2: Team access to the kit

**Acceptance criteria:**
- [ ] `StatStrip` → `StatCard`s; sentence case throughout
- [ ] The members table keeps §6's 40px head and 44px rows; actions right-aligned
- [ ] The invite flow and the fixed-role control (round 2) behave as before

**Verification:** invite opens and validates; 375 readable
**Dependencies:** C1 · **Files:** `components/partner/partner-team-workspace.tsx` · **Scope:** Small

---

### Task C3: Statements and Settings consistency

**Acceptance criteria:**
- [ ] Statements: figures as v3 cards, dates via `lib/format/dates`, §6a toolbar on the list
- [ ] Settings: §15's frame — section titles with their (i), help behind the tip
- [ ] The dispute flow unchanged

**Verification:** a statement opens; a dispute can still be raised; both at 375
**Dependencies:** C2 · **Files:** `components/partner/partner-payouts.tsx`,
`components/partner/partner-settings-workspace.tsx` · **Scope:** Medium

---

### ✅ Checkpoint: Organization
- [ ] Every Organization page uses the same stat pattern as Pipeline and Overview
- [ ] No `StatStrip` left anywhere in `components/partner/**`

---

## Phase D — Finish

### Task D1: Sweep, docs, and the open decisions

**Acceptance criteria:**
- [ ] 320/360/375/390/430 and 1366/1536 across all three surfaces: no horizontal scroll, nothing clipped
- [ ] Contrast measured against the real surfaces for every new ground (bubbles, legends, chart fills)
- [ ] Keyboard: the composer, the thread, the sheet, the charts' summaries
- [ ] `components/partner/README.md` and UI-CONSISTENCY updated — the chat kit, the chart kit, §5b's chart line
- [ ] Round 2's task 21 decisions carried: the (i) target size, and the date inputs
- [ ] `uiOffenders.json` no higher than it started; ideally lower (the chat CSS)

**Verification:** full `npm test`, typecheck, lint; screenshots of each surface at 1536 and 375
**Dependencies:** A–C · **Files:** docs, `components/partner/README.md` · **Scope:** Medium

---

### ✅ Checkpoint: Round 3 complete
- [ ] Messages feels like a messenger and is built from the kit
- [ ] Overview answers the four questions a partner has, with charts that agree with the Pipeline
- [ ] Organization matches the rest of the portal
- [ ] Owner has seen all three

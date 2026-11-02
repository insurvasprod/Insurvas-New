# Partner portal — what to say in the demo

Branch `redesign/partner-pipeline`, PR #34. Three rounds, 16 commits, 54 files.

**The one-sentence version:** the partner portal went from a page that contradicted itself to one
that tells a partner what happened to their leads, how fast the agency moved, and what they are
owed — with no new database reads.

Open each page at **1536×826**. The dev-only previews (`/design/*`) are the only place these pages
can be seen with real volume — the development database holds one lead and one channel.

---

## 1 · Pipeline — `/partner/pipeline`

**Say:** "This page used to disagree with itself."

The counters above the board spoke one vocabulary and the board's columns spoke another, so you
could read **"Claimed 1" above a column headed "New lead"**. Both are generated from the same lane
figures now, so they cannot drift apart. A test holds the rule.

Point at, in order:

| What | Say |
|---|---|
| The four figures | Each one is clickable and lands on the rows behind it |
| The board | New · Claimed · On a call · Converted — the agency's own stage is still on every card and in the table |
| An amber/red age badge | That is the agency's real response ladder, not a number we invented — 5 minutes to flag, 4 hours to expire |
| A card | Product and age as tags; who submitted it, for admins |
| "Show 20 more" | A busy lane pages instead of scrolling forever |
| Open a lead | It opens as its own page, not a panel over the board. The form reads in two columns, in the order it was filled in |
| Any dropdown | Searchable, with the search at the top. **No native dropdowns left in the portal** |

**On a phone** (`/design/pipeline?state=busy` at 375): the first lead was at y=1536 — nearly two
screens down. It is at **y=551** now. The board stacks instead of scrolling sideways, an empty lane
is 86px instead of 420px of nothing.

---

## 2 · Messages — `/partner/messages`

**Say:** "This is the one the owner pointed at."

| What | Say |
|---|---|
| The composer | It was three stacked rows with the attach button next to Send. It is one bar now — Enter sends, Shift+Enter breaks a line |
| Start typing anywhere | The message starts in the box. You never hunt for it |
| The thread | Messages have a side, runs from one person share a name and a time, and the days are separated |
| An automatic update | Still every fact it carried, but centred and quiet — a notice between turns, not a wall of panels |
| "Details" | Opens as a sheet; Escape closes it and the focus goes back to the button |
| The page itself | It reaches the bottom margin. It used to stop short and leave a band of empty page |

**The number worth saying:** **163 hand-rolled CSS rules deleted** — the largest such block left in
the portal, and the reason this page looked unlike the rest of the product.

---

## 3 · Overview — `/design/overview?state=busy`

**Say:** "This page answered nothing. Now it answers the four questions a partner actually has."

Before: a panel drawing one bar at 100%, three rows of "—", three link tiles.

| Question | Where it is answered |
|---|---|
| Am I sending more than last week? | The 30-day series, with the 7-day total and its change named against the 7 days before |
| Do my leads convert? | "Where they end up" — every lane, with counts and share |
| How fast does the agency move? | Average reply in chat, longest wait right now, follow-ups waiting |
| What am I earning? | Statement history, with the rate in the heading |

**Say this too:** it needed **no new endpoint and no migration** — it reads the same pipeline data
Team review already asks for.

Click `empty` and `error` in the preview bar. **This is worth showing:** a figure that was not read
says "—", never 0, and a panel whose read failed says so while the rest of the page stays live.

---

## 4 · Organization — `/design/organization`

**Say:** "The last pages still on last year's pattern."

- **Team review** — six figures, and a real submission trend drawn from the same helper the Overview
  uses, so the two pages cannot disagree about a week you can see on both.
- **Team access** — the same figures as everywhere else.
- **Statements** — three figures above the list, and the dates read as months instead of
  `2026-09-01 to 2026-09-30`.
- **Settings** — house date format, and an (i) on each section saying what it covers.

---

## Things that are true but you cannot point at

Worth saying once, near the end:

- **A partner sees only their own leads.** It was already enforced in four places; it is now named
  in one file and proved by a test that fails if someone weakens it.
- **The partner can see their own payout rate.** It was locked behind a server-only import, so the
  agent could see "$35.00 / transfer" and the partner could not.
- **Everything is checked on every screen size** — 320 to 1536 — with no horizontal scrolling and
  nothing clipped.
- **Colour contrast measured, not guessed**, against the real glass surfaces, in both themes: every
  new piece of text is above the accessibility standard.
- **The portal is built from the shared kit.** Nothing here is partner-only, so a change to the
  product's buttons, cards or tables reaches this portal for free.
- **`main` is merged in**, including the owner's 30 Oct look, so this is current.

---

## Do not promise

- **Sending a message and creating a conversation were not exercised in testing.** They are
  unchanged — byte-identical requests — but if the demo is live, try one before the audience does.
- **Team access and Settings have no preview page**, so demo those on the real signed-in portal.
- A few figures depend on the agency having published statements or replied in chat. On an empty
  tenant those read "—" by design — which is itself worth showing, but know it before it happens.

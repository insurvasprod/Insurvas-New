# Book of business, round 3: the compact pass

The owner asked for this on 2026-11-02, after PR #38 was pushed. The work goes on branch `redesign/book-of-business-r3`; **do not open a PR**. This file is the critique and the change list that the builders share. `docs/la4/BUILD-ROUND2.md` still applies: one frame, no DDL, no commits, the same tools and the same "don't touch" list. `lib/design/*` is now also open to edit, but only for tests that belong to these changes.

## What the owner saw
- The file page spends half its height on three stacked cards (stages, a sentence, seven tiles) before the work starts.
- Files has six tabs, which is too many for an agent.
- Explainer cards waste space. The example is the blue "A policy left out of a newer file is never lapsed on its own" card.

## Rules for this pass
1. **No explainer cards.** An `info`-tone `Callout` that only explains something goes:
   - Its fact becomes a chip's tooltip, a muted half-line beside the heading it explains, or an (i).
   - Warnings and errors stay, as **one line** each: a title, and at most one action.
   - Stacked warnings are merged into one line with the most urgent first.
2. **Compact detail pages.**
   - **Header:** the title row (title, status chip, one muted facts line), then actions on the right.
   - **Actions:** at most two buttons; the rest go in a "More" menu (`DropdownMenu` from `components/ui`).
   - **No card exists only to hold one sentence.**
   - **Figures:** one `StatStrip` row, where the whole tile is the link. No "See rows ›" under every figure.
   - **Lists inside a page:** at most 10 rows, then "See all N".
3. **Fewer surfaces.** A page has one tab bar at most. A tab shows only when it has content for this record (e.g. Commissions only on a commission file).

## Decisions
- **Files: six tabs become no tabs.** The Files step is one list with filter chips **All · Needs you · Failed · Missing**. Missing shows the due-but-not-here files, from the file-monitor findings, with Upload on the row.
  - **How files arrive** is setup, not work: it moves to **Setup › How files arrive**, a new Setup tab. Old `?view=doors`, `?view=bucket` and `?view=arrive` redirect there.
  - **Policy changes** is about policies: it moves to **Policies**, as a "Recent changes" view switch next to the book. Old `?view=changes` redirects there.
  - **Runs** and **Agent findings** are diagnostics: they go into the Files header's "More" menu ("Run history", "Checks"), each opening its existing view. They don't take a tab or a rail entry.
    - *Superseded 2026-11-02 (owner):* Run history is a tab on each file's page (the runs that took that file). Checks are renamed "Problems found" and shown under the Files list's Needs you chip, whose count includes the open ones. "Download problem rows" is removed. ?view=runs and ?view=findings redirect.
- **The rail stays four steps** (Files, Needs you, Policies, Setup). Nothing new is added to the left menu; diagnostics live in a menu and setup lives in Setup.
- **A file page:**
  - **Tabs:** Overview · Rows · Changes, plus Commissions for a commission file. "Whole file" moves to a Rows-tab action ("As sent"), and the `/whole` page stays.
  - **Overview:**
    - The 8-stage strip is one slim row: stage dots/pills with their counts, and the active stage outlined. It sits directly under the header with no card around it.
    - The sentence is removed: the strip and the figures already say it.
    - The figures are one `StatStrip`.
    - "This file needs you for N" is a compact table: Kind, About, Open, 10 rows, then "See all N in Needs you".
  - **Header actions:** Read again and Download. "Replace with a corrected file" goes in More.
  - **Changes:** no callout. Two sections, each a `TableCard` with its count in the title:
    - "Not in this file · 80", with a muted half-line "compared with <file> of <date> · watched, never lapsed" and "Open the previous file" as the card action.
    - "Changed · N".
- **A row page:** the same compact header. What happened is one table; As sent is the second tab.
- **Needs you:**
  - Notes about missing sources go into one line.
  - On the item page, "A letter is out" and "Waiting on Insurvas" become one muted line under the title, not cards.
  - The `?file=` filter must use the same rule as the file page: match reviews of that file, plus `no_deal_flow` items tied by carrier and file_date. "Same person?" and "Sale no carrier has" never belong to a file.
- **Policies:**
  - **The policy header:** the Overview's three `role=status` lines (provisional client, linked application, no client) move into the header's facts line as chips or links.
  - **The Commissions tab:** the clawback warning is one line.
  - **The Policies list page:** the NextStepLine and the pending banner are one line each. Add the "Book · Recent changes" switch (Recent changes is the old Carrier files › Policy changes view, moved).
- **Setup:**
  - Add the How files arrive tab.
  - Pipeline rules: the five possible stacked callouts become one summary line (in forecast / held / capped / off), each part a link.
  - The rule page: the "This rule is live" info card goes; the status chip already says it.

## Missing from the LA-4 tasks (add where it's cheap)
- **LA-4.1:** a file page action, "Not a carrier file" (set aside), for a failed file with no carrier. Add it only if an existing API supports it; otherwise leave it.
- **LA-4.9:** on queue items, show the owner and the escalation (the Exceptions data has `escalated`) as a chip on the Needs you list.
- **LA-4.20:** every figure on the file Overview opens the rows behind it (it already does). Keep that.

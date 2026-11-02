# Book of Business in one page: step guide + the ask for a peer

Drafted 2026-11-02. Planning note only; nothing is built from it yet.

## Part 1: The job an agent is doing, step by step

The agent drops a carrier file in and wants to know what happened to it, what's wrong, and what changed.

| # | Step | What already happens in our system | Where it is today |
|---|---|---|---|
| 1 | **Upload** | A file arrives by bucket drop, email or a hand upload. It is registered once, with duplicates caught by content hash, and given a carrier and a type (policies, commissions or new business). | Data in › Carrier files |
| 2 | **Read** | The carrier's layout map reads the rows (csv, xlsx, xls or PDF). PDFs must balance to their stated total. | Carrier files › file page |
| 3 | **Hold** | Rows whose status word has no mapping yet are held, not guessed. | Carrier files (held count) and admin status maps |
| 4 | **History** | Each policy gets a snapshot. Every changed field is written to that policy's change log, and the current view is rebuilt from it. | Policies › policy page timeline |
| 5 | **Match** | Policy → client. Cases that can't be matched for sure go to a person. | Data in › Policy matching |
| 6 | **Pipelines** | The policy status moves the deal or case to its stage (issued, lapsed, chargeback…). | Pipelines |
| 7 | **Commissions** | Commission lines go into an immutable ledger, with reversals and never edits. Expected pay comes from the **rate card** and the **carrier rules** (first-payment window, grace, pay trigger). | Commissions › Statements, Ledger, Rate card |
| 8 | **What's wrong** | Discrepancies are expected vs paid. Orphans are lines with no policy. Exceptions, missing files and retention risks are also flagged. | Discrepancies, Exceptions, Retention |
| 9 | **Fix and re-run** | Fix a layout, status word, rate or rule, then re-read the file. Every stage after it re-runs and gives the same result. | Spread over 4 pages |

**The pain:** this one job is spread over about 11 pages: Carrier files, Import your book, Policy matching, Exceptions, Policies, Statements, Ledger, Discrepancies, Rate card, Carrier rules and Scorecards. The agent can't see **one file's journey** from upload to "everything updated" in one place.

## Part 2: The prompt to send

> Hey! We're both building the Book of Business side of an insurance agency platform, and I heard you got the whole flow down to **one page**. I'd love to learn how you did it so I can simplify ours. I'm not asking for code, just how you think about it and how the screen is laid out.
>
> **Our flow:** an agent uploads a carrier file (policies or commissions; csv, xlsx or PDF). The system then:
> 1. reads it with a per-carrier layout
> 2. holds rows with unknown status words
> 3. writes a history entry for every policy field that changed
> 4. matches policies to clients
> 5. moves the deals in the pipelines
> 6. posts commission lines to a ledger
> 7. works out the expected commission from a rate card and carrier rules (pay trigger, first-payment window, grace)
> 8. flags what's wrong: discrepancies, unmatched lines, missing files and lapse risk
>
> Today that's spread across about 11 pages, and an agent can't follow one file from upload to done.
>
> **Questions:**
>
> **1. The page itself**
> - What's on the one page, top to bottom? Could you send a screenshot or a rough sketch?
> - Is it built around **a file** (one upload and its journey), **the book** (all policies), or **a to-do list** (things needing a person)?
> - What's on screen first when an agent opens it with nothing to do, versus with problems waiting?
>
> **2. Upload → progress**
> - How do you show which stage a file is in (received, reading, read, matched, posted, done or failed)? A progress bar, steps, a timeline?
> - Is it live while it runs, or does the agent refresh?
> - When a file fails halfway, what exactly does the agent see, and what can they do right there?
>
> **3. "What's wrong"**
> - How do you group problems: by file, by policy, by type, or by who has to act?
> - Which problems can the agent fix inline (e.g. pick the client, map a status word, enter a missing rate) without leaving the page?
> - After a fix, do you re-run the file automatically? How do you show what the fix changed?
>
> **4. Policy history**
> - Where does a policy's change history live: a side panel, an expandable row, or its own page?
> - How do you show "this field changed from X to Y because of file Z on date D"?
>
> **5. Commissions, rate card and carrier rules**
> - Do commissions update on the same page, or is that a separate area?
> - How does the agent see expected vs paid per policy?
> - Where do rate cards and carrier rules live, and how does an agent learn "this is missing a rate, so there's no expected figure"?
> - When a rate or rule changes, do past figures change or stay as they were?
>
> **6. Pipelines**
> - Does a policy status change move the deal/stage automatically? How does the agent see that it happened?
>
> **7. Roles and the trade-offs**
> - Who uses the page (agent, owner, bookkeeper)? Does it change per role?
> - What did you **remove or hide** to get to one page, and did anyone miss it?
> - What would you do differently if you started again?
>
> Anything you can share helps: screenshots, a quick screen-share, or even "here's the order of the sections". Thanks a lot!

## Part 3: What we do with the answers

1. Map each of their sections onto our nine steps above. Mark each as **we have it**, **we have it but it's buried**, or **we don't have it**.
2. Draw two or three mockups of a single Book of Business page. Each one draws every panel, pop-up and edit surface. They go on the canvas for the owner's pick, and nothing is built before that.
3. Keep every existing feature and route. Old addresses open the right part of the new page, the same way Data in and Commissions work now.
4. Check against the Notion LA-4 spec before building. Anything outside it gets a label.

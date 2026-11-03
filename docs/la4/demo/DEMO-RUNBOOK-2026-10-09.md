# LA-4 demo runbook: Oct 9, 2026

Every figure below was read from the demo agency's own screens on the morning of Oct 9. The one file you upload was dry-run against the demo agency's LA14 layout: it is not a duplicate, it reads cleanly (8 policies, no findings), and it changes exactly one thing.

**The file you upload:** `docs/la4/demo/sample-files/LA14-policies-2026-10-09.csv`. Upload it **once, during the demo, not before.**

**The fallback:** if a screen fails, `docs/la4/demo/shots/` has 37 screenshots, numbered by task (for example `31-4.12-ledger-totals.jpg`).

---

## Before you start (10 minutes before)

1. Open `http://localhost:3000` and sign in as the **demo agency owner** (Demo Agent, demo.agent@insurvas.test). The agency is "Advance Team (QA demo)". If sign-in fails, ask Claude to set the session up.
2. In a second window, sign in to **staff** (`/admin`) with your own staff account.
3. Open these tabs in this order. The `?source=carrier` matters: without it, Policies, the ledger and Discrepancies also show old hand-entered test data.
   1. `/app/carrier-files`
   2. `/admin/layout-maps` (staff window)
   3. `/app/book-import`
   4. `/app/policies?source=carrier`
   5. `/app/ledger?source=carrier`
   6. `/app/rate-card`
   7. `/app/discrepancies?source=carrier`
   8. `/app/lapse-risk`
   9. `/app/book-scorecards`
   10. `/app/carrier-rules`
4. Have File Explorer open at `docs\la4\demo\sample-files\`.

**Three things that look odd on screen, and what to say if anyone notices:**

| What you see | Why | Say |
|---|---|---|
| The **Discrepancies** tab badge says **17**, but the list shows 2 | The badge also counts old hand-entered test items | "The list is filtered to carrier files; the badge counts everything." |
| The ledger's **Lines** tab says **152**, but the list shows 10 | Same reason | Same answer |
| A blue notice: "10 statement lines are waiting for someone to accept a match" | Old hand-imported test statements | "That's the hand-import path; today is about carrier files." |

Also:
- **Don't open** the Lead vendor and Campaign dropdowns on a policy page. They list old QA test names.
- **Never press Save** in the rate card or letter dialogs.

---

## 1. Files come in (4.1, 4.2, 4.19): Carrier files

**Click:**
1. Show the tiles: **Files in use 5**, **2 more replaced by a corrected file**, **Failed 0**, **Duplicates skipped 1**.
2. Point at the four filters (carrier, type, status, how it arrived) and the seven LA14 files.
3. Click the tabs **Bucket**, then **Email**, to show the other two doors. Don't press **Create address** unless you want the demo agency to get a permanent email-in address. It's harmless if you do.
4. Click **Runs**: each run, stage by stage. Click one run's time to open its stages.

**Say:**
- "There are three ways files arrive: upload, email to the agency's own address, and a folder per carrier and date that a script fills. **Check now** reads whatever is waiting."
- "A duplicate is recognised by its contents and skipped. A corrected file replaces the one from the same day, and the old one is kept."
- "Nothing is ever changed: each file is kept exactly as it arrived, row by row."

## 2. Reading carrier files (4.3, 4.4, 4.5): staff window

**Click:**
1. `/admin/layout-maps`: the layouts, one per carrier format, each with its live version. Scroll to **Carrier assignments**: which layout reads each carrier's files.
2. `/admin/status-maps`: each carrier's status words mapped to the nine statuses.

**Say:**
- "We set a carrier's format up once and every agency gets it. There are 14 published layouts for 8 carriers, including PDF statements."
- "**PDF statements are checked against their own totals.** If the lines don't add up to the total the statement states, the file is refused and nothing reaches the ledger. In testing, the sample Corebridge statement was $247.30 short and was refused; the corrected copy was read."
- "A person approves each carrier's status words once. Nothing is guessed."

## 3. Import your book (4.10)

**Click:** `/app/book-import`.

**What you'll see:**

| Tile | Value |
|---|---|
| Carriers done | 1 of 9 |
| Policies | 8 |
| Premium a month | $377 (1 policy at risk) |
| Persistency | Building |
| Advances at risk | **$1,220.78** (on 7 policies with an advance) |

**Say:** "Each carrier lists where to find its file in its portal. The agency uploads each one once, and its whole book is in, with each client created as provisional until someone checks it."

## 4. Policies and history (4.6, 4.7, 4.11)

**Click:**
1. `/app/policies?source=carrier`. The tiles read **8 policies**, **$4,520 a year**, **1 at risk**. DEMO-1006 is listed as **At risk · Critical**.
2. Open **DEMO-1002** (Blake Demo).
3. Read the top: **Active**, paid to **Nov 1, 2026** "per the carrier file of Oct 9", and **30 days until the carrier closes it**.
4. Scroll to **Timeline**: first seen Sep 5, an advance of +$400.00 on Sep 30, payments credited, the product added on Oct 8.
5. Click **Source · LA14-demo-upload-2.csv, row 3**: each field shows the file and row it came from.

**Money (same page):**

| Line | Value |
|---|---|
| Advance received | **$400.00** |
| Still at risk | **$177.78** (inside the chargeback window) |
| Expected first-year commission | **$621.00 · $465.75 as an advance**, first draft Oct 5, due by Oct 26 |

**If asked "why two payments on Oct 5?"** "The carrier sent a file that day and then a corrected one. Both are kept, and the history shows the correction as a change rather than hiding it."

## 5. Follow a number down (4.20)

**Click:**
1. On DEMO-1002's timeline, click **demo-la14-commissions-2026-10-06.csv, row 3** (on the Sep 30 advance line).
2. **Row 3 of 10** opens. Show "What it became": an advance of $400.00 on DEMO-1002. Below it, **every column as the carrier sent it**: "400.00" becomes 40000 cents.
3. Click **The whole file**: all 10 rows.
4. Click **Download the original**: a 60-second link, and every download is logged.
5. *(Optional)* Click **Read again**. It re-reads the kept rows and says nothing changed.

**Say:** "Every number on every screen can be clicked down to the exact cell of the carrier's file."

## 6. Commission ledger (4.12, 4.14)

**Click:** `/app/ledger?source=carrier`.

| Tile | Value |
|---|---|
| Advanced | **$3,302** |
| Earned | $0 |
| Charged back | **−$266** |
| Net received | **$3,032** (after $5 of fees and interest) |
| Held | $0 |

Then:
1. Point at the 10 lines, each with its file and row.
2. Click **Carrier accounts**. The **Oct 6 statement** reads $0.00 opening, **$3,031.85** activity, **$3,031.85** closing, **Adds up**.
3. Below it, **Commission for policies not seen yet**: **$300.00, 1 line**.

**Say:** "Ledger lines are never edited, only reversed. The statement is checked to add up. And money for a policy no file has shown yet is kept, then joins its policy the moment the policy arrives."

## 7. Rate card (4.13)

**Click:** `/app/rate-card`.

| Tile | Value |
|---|---|
| Carriers covered | **1 of 1** |
| Premium covered | **100%** ($377 of $377 a month) |
| Expected so far | **$4,520** (8 policies priced) |
| Past the usual lag | 0 |

Then:
1. On the LA14 row, click **Edit**. Show the product mapping ("FE Level" → Final Expense), the rate, and the **advance rule** (9 months at 75%, with a 12-month prorated clawback).
2. **Close it without saving.**

**Say:** "Once the agency enters its contract, every payment can be checked against what it should have been."

## 8. Discrepancies (4.15)

**Click:** `/app/discrepancies?source=carrier`.

| Tile | Value |
|---|---|
| You appear to be owed | **$65.75** |
| Coming back | **$233.40** (chargebacks not taken yet, don't spend it) |
| Held by carriers | $0.00 |
| Open | 2 |

The two items:

| Item | Expected | Received | Difference |
|---|---|---|---|
| **Paid short:** DEMO-1002 | $465.75 | $400.00 | **$65.75** (tolerance $1.00) |
| **Chargeback coming:** DEMO-1003 | | | **−$233.40** (not taken back yet) |

Then:
1. Click **Why** on DEMO-1002: the explanation and the line it came from. Click **Close**.
2. Tick DEMO-1002's checkbox, then click **Draft letter (1)**. You'll see **"Dispute letter: $65.75"**, drafted from the records, figure for figure.
3. Click **Cancel**. **Do not click Save letter.**

**Say:** "Insurvas never sends the letter. The agent saves it, downloads the PDF, sends it and records the outcome. DEMO-1003 lapsed inside its clawback window, so part of its advance is expected back."

## 9. Lapse risk (4.16): before the upload

**Click:** `/app/lapse-risk`.

| What | Value |
|---|---|
| Call list | **1: Finley Sample, DEMO-1006**, "Payment missed, 7 days past due", $29.50, 23 days left |
| Save rate | **100%** (1 saved of 1, decided by the files) |

**Say:** "Who to call today to keep a policy alive, soonest deadline first. Watch what happens when today's file arrives."

## 10. The live moment

**Do this, slowly:**
1. Go to **Carrier files** and click **Upload a file**.
2. Under **File**, choose `docs\la4\demo\sample-files\LA14-policies-2026-10-09.csv`. **Type** fills in as **Policies** and **File date** as **10/09/2026** on their own.
3. Under **Carrier**, choose **LA14 Market 1790707977690**. This one does not fill in by itself.
4. Leave **Agency (optional)** empty. Click **Upload**.
5. The dialog says: *"Received policies file from LA14 Market 1790707977690, dated Oct 9, 2026. It is read in the next few seconds… It replaces the earlier file for that day, which is kept."* Click **Done**.

**Then show:**

| Where | What changed |
|---|---|
| **Files** | The new file is at the top, **Read**. Yesterday's upload for Oct 9 now reads **Replaced**. |
| **Runs** | A new **"Files arrived"** run, a few seconds long. Click its time to open its stages. |
| **Policy changes** | **DEMO-1006, Paid-to date, Oct 1, 2026 → Nov 1, 2026**. |
| **Lapse risk** (refresh) | DEMO-1006 has left the call list, and the call list is empty. |
| **Import your book** (refresh) | **0 policies at risk** (it was 1). |

**Say:** "The carrier's file says DEMO-1006 paid. Within seconds the history records it, and the call list no longer asks anyone to chase a client who has already paid."

*(Optional extra)* Upload the same file once more. The dialog says *"This exact file was already received, so it was not stored again."*

## 11. Book scorecards (4.18)

**Click:** `/app/book-scorecards`.

| Tile | Value |
|---|---|
| Annualised premium | **$4,519.80** (7 of 8 policies in force) |
| Month-9 persistency | **Building** (needs 9 months of issue history) |
| Placed | **8 of 8** |
| Chargeback ratio | **Building** ($265.50 back of $3,002.35 advanced; a ratio needs 10 policies) |
| Today | "1 chargeback was recorded, $265.50 in all." |

Then click any figure to open the policies behind it.

**Say:** "Every figure opens its rows. Ratios wait until there are enough policies to mean something. We'd rather say 'Building' than show a misleading percentage."

## 12. Settings that drive it (4.17, 4.8, 4.9)

**Click:**
1. `/app/carrier-rules`. LA14 reads **30 days, yours · unverified**, **Pays: On first draft**, **Files: Monthly**.
2. **Policy matching** shows:
   - To review **0**, Links **8**, Agent codes **1**;
   - **linked automatically 83.3%**.
   - Click **Agent codes**: one writing code still to map to an agent.
3. **Exceptions** shows **nothing open** and 1 closed in the last 30 days.

**Say:** "How long each carrier gives to save a policy, when it pays, and how often its files come all drive the countdowns and the missing-file checks. Matching links each policy to a client and an agent. Exceptions catch what the files and the sales don't agree on."

---

## What they should know (closing)

- **It's tested end to end.** On Oct 9 the whole workflow ran on an empty test agency: 212 checks across all 20 LA-4 tasks. Every policy of 8 carriers matched the answer key on status, paid-to date and premium. Two bugs were found, fixed and verified live.
- **Nothing is rewritten.** Raw rows, ledger lines and expected figures are never edited, and corrections are new entries. That's why every number can be traced.
- **The money is made up.** It's a test carrier with eight fictional clients, built to show one short payment, one chargeback, one unpaid policy and one line for a policy not seen yet.
- **AI is not switched on yet.** Everything shown works without it. The AI steps (PDF reading, matching suggestions, written summaries) wait until a provider is chosen. Any AI wording must pass a check that refuses figures not in the records.

## Decisions to ask for

1. The AI provider.
2. Real carrier files from a few agencies, to replace the synthetic samples.
3. Which carriers come next, beyond the 8 with layouts.
4. Production email set-up (Postmark) for the email door.

## Questions you may get

- **"Is the money real?"** No. See "The money is made up" above.
- **"How does it know DEMO-1003's advance is coming back?"** The carrier calls the product "FE Level"; the rate card maps that to Final Expense, whose advance rule claws back over 9 months. DEMO-1003 lapsed early, so the unearned part, $233.40, is expected back.
- **"Why does persistency say Building?"** It counts only policies issued since the agency's first file. Older policies were only seen because they survived, which would flatter the figure.
- **"What is 'Entered by hand' in the Source filter?"** Policies and statements an agency types in or imports itself, for a carrier that sends no file. On the demo agency it's older test data.
- **"Can the AI write the dispute letter?"** Not yet: it's a template over the records. When a provider is chosen, the AI's wording must pass the same check against the records.
- **"Where does a number come from?"** Click it.

# Replicate the LA-4 working demo (10 workflows)

These are the exact steps, files and values used in the demo run on Oct 9, 2026, with what you should see after each one. Do them in order: each workflow builds on the one before.

**Start state required:** the demo agency "Advance Team (QA demo)" as it was before the demo. The system recognises a file by its contents, so these files are skipped as duplicates if the agency already has them. Check before you start: on **Carrier files**, the list must **not** contain `LA14-policies-2026-10-09.csv`, a Corebridge `view_statements.pdf`, or an American Amicable `Policies.csv`, and the **Lapse risk** call list must show **DEMO-1006**.

**Sign in:** as the demo owner (Demo Agent) at `http://localhost:3000`.

## The files (this folder)

| Workflow | File | What it is |
|---|---|---|
| 2 and 3 | `W2-W3-LA14-policies-2026-10-09.csv` | LA14's policy file for Oct 9. Same as the current one, except DEMO-1006 has paid (paid-to Oct 1 → Nov 1) |
| 5, part 1 | `W5a-Corebridge-statement-SHORT-by-247.30.pdf` | Corebridge PDF statement whose lines are $247.30 short of its stated total |
| 5, part 2 | `W5b-Corebridge-statement-CORRECTED.pdf` | The same statement with the missing $247.30 line, so it adds up |
| 6 | `W6-American-Amicable-Policies.csv` | American Amicable's in-force file: 70 policies |

---

## Workflow 1 · Log a retention call
**Where:** Lapse risk (`/app/lapse-risk`)
1. On **Finley Sample · DEMO-1006** (payment missed), open **Log the call…** and choose **Reached, promised to pay**. It saves straight away.

**You should see:** *"Logged. The next carrier file will show whether it was saved."* Last contact reads **Reached, promised to pay · today**. Save rate shows **1 waiting**. DEMO-1006 stays on the list: a promise isn't a payment.

## Workflow 2 · A carrier file arrives
**Where:** Carrier files (`/app/carrier-files`)
1. Click **Upload a file**.
2. **File:** `W2-W3-LA14-policies-2026-10-09.csv`. **Type** fills in as **Policies** and **File date** as **10/09/2026**.
3. **Carrier:** choose **LA14 Market 1790707977690** (it doesn't fill in by itself). Leave Agency empty.
4. Click **Upload**, then **Done**.

**You should see:**
- **Dialog:** *"…It replaces the earlier file for that day, which is kept."*
- **Files:** the new file shows **Read · 8 rows · v2**, and the older Oct 9 file shows **Replaced**.
- **Runs:** a new **Files arrived · Succeeded** run, about 14 seconds.
- **Policy changes:** **DEMO-1006 · Paid-to date · Oct 1 → Nov 1**.
- **Lapse risk:** **Nobody to call**.
- **Import your book:** **0 policies at risk**.
- **The call from workflow 1 stays "waiting".** It's judged by a carrier file *dated later* than the one the call list was showing, and this is a same-day correction.

## Workflow 3 · The same file twice
1. **Upload a file** again, with the same file and carrier LA14 → **Upload**.

**You should see:** *"This exact file was already received, so it was not stored again."* **Duplicates skipped** goes up by 1. No new file appears.

## Workflow 4 · Read again
1. On **Files**, open `W2-W3-LA14-policies-2026-10-09.csv` (click its name).
2. Click **Read again**. It shows "Reading…" for a few seconds.

**You should see:** the run succeeds and the policies don't change. Anything that follows the carrier's settings is brought up to date. In our run that was **DEMO-1008**: its commission due date moved to Sep 26, so a new **Missing commission $429.00** finding appeared in Discrepancies.

## Workflow 5 · The PDF totals check
**Part 1, the statement that doesn't add up**
1. **Upload a file** → **File:** `W5a-Corebridge-statement-SHORT-by-247.30.pdf`.
2. **Carrier:** **Corebridge Financial**. **Type:** **Commissions**. **File date:** **10/02/2026**.
3. **Upload** → **Done**. Wait a few seconds and refresh.

**You should see:**
- **Files:** **Failed**, and the **Failed** tile at **1**.
- **File page:** *"Totals don't add up: the lines sum to −$1,511.08, the file states −$1,758.38, a difference of $247.30. Nothing was read from this file."* Every row reads **Nothing (held, or not read)**.

**Part 2, the corrected statement**
1. **Upload a file** → **File:** `W5b-Corebridge-statement-CORRECTED.pdf`, with the **same** carrier, type and date (Corebridge Financial, Commissions, 10/02/2026).
2. **Upload** → **Done**. Wait and refresh.

**You should see:**
- **Dialog:** *"…It replaces the earlier file for that day, which is kept."*
- **Files:** the new file is **Read · 9 rows · v2**, the bad one **Replaced**, and the **Failed** tile back to **0**.
- **Commission ledger › Carrier accounts:** **Commission for policies not seen yet: Corebridge Financial · 8 policies · 8 lines · −$1,758.38**.

## Workflow 6 · Import a new carrier's book
**Where:** Import your book (`/app/book-import`)
1. Open **Add another carrier…** and choose **American Amicable**. A row is added on screen; nothing is saved yet.
2. On the **American Amicable** row, leave the date as today and click **Upload**. Choose `W6-American-Amicable-Policies.csv`. It uploads at once.
3. Wait about 20 seconds and refresh.

**You should see:**

| Where | Value |
|---|---|
| American Amicable row | *"Reading the file…"*, then **"70 policies, $4,579/mo. 0 at risk."** |
| Carriers done | **2 of 10** |
| Policies | **78** |
| Premium a month | **$4,956** |
| Exceptions | **"American Amicable · 70 policies imported, 70 provisional clients created"** |

## Workflow 7 · Clear the Exceptions item
**Where:** Exceptions (`/app/exceptions`)
1. On the American Amicable item, click **Resolve**.
2. Choose **Looked over**, then click **Save**.

**You should see:** *"Closed."* **Open 0** ("Nothing open"), and **Closed, 30 days** goes up by 1.

## Workflow 8 · The dispute letter
**Where:** Discrepancies (`/app/discrepancies?source=carrier`)
1. Tick **DEMO-1008** (Missing commission $429.00) and **DEMO-1002** (Paid short $65.75).
2. Click **Draft letter (2)**. The letter reads **"Dispute letter: $494.75"**.
3. In **To**, type: `LA14 Market Commissions Department, 100 Sample Way, Dallas, TX 75201`.
4. Click **Save letter**. Both items now read **In a letter**.
5. Open **Letters**. On the letter, choose **I sent it by… → Email**. It shows *"Marked sent."*
6. Click **Record outcome**: **Partly credited**, amount **429.00**, note `Carrier paid DEMO-1008; refused the DEMO-1002 short payment` → **Save**.

**You should see:**
- **Message:** *"Outcome recorded."*
- **Letter:** **Partly credited · $429.00 credited**, with a card reading **"credited $429.00 of $494.75 claimed"**.
- **Discrepancies:** both items are **resolved** ("Settled by the dispute letter"), and "You appear to be owed" drops to **$265.50**.

## Workflow 9 · Map a writing code to an agent
**Where:** Policy matching › Agent codes (`/app/policy-matching?tab=agents`)
1. On **DEMO/ AGENT TWO** (LA14, 4 policies), choose **Marisol Vance** and click **Map**.

**You should see:** *"Agent code mapped."* The code reads **Marisol Vance · Mapped**, and **Agent codes to map** goes down by 1. On **Policies** (carrier LA14), DEMO-1003, -1004, -1006 and -1008 show **Marisol Vance** as their agent.

## Workflow 10 · Change a carrier rule
1. Open **DEMO-1002** and note **"30 days until the carrier closes it"**.
2. Go to **Carrier rules** and click **Edit** on **LA14 Market**. Under **Ongoing payment**, click **Change**.
3. **Window (days)** **14**, **Grace (days)** **3**, **Where it comes from** **Carrier agreement**, **Applies from** today, **Notes** `LA14 shortened its save window to 14 days` → **Save rule**.
4. Open **DEMO-1002** again.

**You should see:** *"Ongoing payment rule saved."* LA14 reads **14 day window, 3 day grace · carrier agreement · from today**. DEMO-1002 now says **"14 days until the carrier closes it"**.

---

## What to say, one line each
1. **Call:** "Save rates come from the carrier's files, not from what the agent says."
2. **Upload:** "The file is stored, the old one kept, exactly what changed is recorded, and the call list updates in seconds."
3. **Duplicate:** "The same file twice is recognised by its contents: nothing is stored or counted twice."
4. **Read again:** "Any file can be read again from the rows kept; the same rows always give the same book."
5. **PDF check:** "A statement that doesn't add up is refused; the corrected one replaces it and is read."
6. **Import:** "A whole carrier book in one file, with new clients marked to be checked."
7. **Exceptions:** "Anything that doesn't line up has an owner and a clear choice."
8. **Letter:** "The letter is written from the records; the agent sends it and records what the carrier paid."
9. **Agent code:** "Map a writing code once, and every policy with it belongs to the right agent."
10. **Rule:** "Change a carrier's rule once, and every countdown follows; old rules are kept."

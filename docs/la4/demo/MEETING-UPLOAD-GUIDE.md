# Meeting: upload the carrier files

Demo agency "Advance Team (QA demo)", signed in as the owner (demo.agent@insurvas.test) on
http://localhost:3000. Every file is synthetic: made-up people and numbers, the carriers' real layouts.
Rehearsed end to end on 2026-10-13 through the same two screens. Every figure below is what it gave.

## Before the meeting
1. Run `clean-demo/CLEAR-DEMO-POLICIES-COMMISSIONS-2026-10-13.sql` in the Supabase SQL editor (paste the
   whole file). The last query reads 0 files, 0 policies, 0 ledger lines, 8 rates, 6 advance rules,
   0 triggers off. It is safe to run more than once.
2. Open each page below once, so the first click in the meeting is fast.

## 1 · Policies: Import your book (`/app/book-import`)
Folder `book-import-files/`. On each carrier's row set **Date on the file** to **09/01/2026**, then
**Upload** the file. Carriers not on the page yet: **Add another carrier…**

| File | Carrier | Policies |
|---|---|---|
| `1-Americo-americo-policies-2026-09-08.xlsx` | Americo | 40 |
| `2-Mutual-of-Omaha-7376635-8641652185198.csv` | Mutual of Omaha | 32 |
| `3-Aetna-CVS-policySummary.xlsx` | Aetna / CVS | 80 |
| `4-American-Amicable-Policies.csv` | American Amicable | 70 |
| `5-Aflac-policySummary.xlsx` | Aflac | 80 |
| `6-American-Home-Life-policySummary.xlsx` | American Home Life | 80 |
| `7-Corebridge-PolicySummary_09012026.xlsx` | Corebridge Financial | 30 |
| `8-Sentinel-Security-Life-PolicyList.xls` | Sentinel Security Life | 45 |

457 policies. Each row shows its count within about 20 seconds. **Skip for now** on American National,
Foresters, Gerber Life, National Life Group and Transamerica (no files for them).

## 2 · Corebridge New Business: Carrier files (`/app/carrier-files`) → Upload a file
`new-business-files/1-Corebridge-New-Business-PolicySummary_09012026.xlsx`, carrier **Corebridge
Financial**, type **New Business**, date **09/01/2026**. Adds 6 pending policies (Corebridge 30 → 36).

## 3 · Statements: Carrier files → Upload a file (type **Commissions**)
Folder `commission-files/`. The file date is the date printed on each statement.

| File | Carrier | Date | Total |
|---|---|---|---|
| `1-Americo-Commissions-Statements-Agent-Portal.pdf` | Americo | 08/31/2026 | $234.84 (4 lines) |
| `2-Mutual-of-Omaha-ebssr_e5112b32.xlsx` | Mutual of Omaha | 09/01/2026 | −$2,105.95 (11 lines) |
| `3-Aetna-CVS-Commission-Detail.xlsx` | Aetna / CVS | 08/29/2026 | $1,444.88 (10 lines) |
| `4-American-Amicable-Advances_0003559471_01Sep26.csv` | American Amicable | 09/01/2026 | −$1,375.83 (5 lines) |
| `5-Aflac-Commission-Detail.xlsx` | Aflac | 08/29/2026 | $422.93 (14 lines) |
| `6-American-Home-Life-Commission-Detail.xlsx` | American Home Life | 08/29/2026 | $1,599.27 (14 lines) |
| `7-Corebridge-view_statements.pdf` | Corebridge Financial | 08/21/2026 | −$1,758.38 (8 lines) |
| `8-Sentinel-Security-Life-Statement_69148518058182096.pdf` | Sentinel Security Life | 09/01/2026 | −$46.25 (1 account line) |

Aetna, Aflac and American Home Life files look alike: match the file name to the carrier.

## What the rehearsal showed
- 17 of 17 files **Read**, none held, 0 status words waiting, 0 failed steps.
- Every policy count and every statement total exact (answer key / printed total).
- 463 clients created from the files (Exceptions: one item per carrier to look over).
- Pages: Policies, Commission ledger, Discrepancies, Lapse risk, Book scorecards, Exceptions,
  Dashboard all load (use **Source = From carrier files** on the lists).

## Editing a file live
A file opened in Excel and saved, or with a row added (in Excel or a text editor), reads exactly like
the original (tested on every spreadsheet, 2026-10-13). A file can be uploaded once per agency, so an
edited copy (different contents) is accepted as a new file for the same carrier and day: it
**replaces** the earlier one, and the change shows on the policy's history.
To show a lead becoming a policy: submit the application with **Policy number** as the reference,
then add that policy number as a new row (status Active) to the carrier's policy file and upload it
on **Carrier files** (type Policies): the application closes as issued.
PDF statements (Americo, Corebridge, Sentinel) cannot be edited.

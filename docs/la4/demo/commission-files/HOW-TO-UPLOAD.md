# Commission statements: the files to upload

One commission statement for each of the 8 carriers in `../book-import-files/`, for the demo agency "Advance Team (QA demo)". The data is made up; the layouts are the carriers' real ones. Each file is checked by `lib/ingestion/bucketLayouts.test.mjs`, which confirms every line is read and the total below is exact.

**Do the policy files first** (`../book-import-files/HOW-TO-UPLOAD.md`). A statement line is tied to its policy when the policy is already in the book; otherwise it waits under "Commission for policies not seen yet".

**Where:** Carrier files (`/app/carrier-files`) → **Upload a file**, signed in as the demo owner.

## The files

| # | File | Carrier | File date | What it holds |
|---|---|---|---|---|
| 1 | `1-Americo-Commissions-Statements-Agent-Portal.pdf` | Americo | 08/31/2026 | 4 override lines, **$234.84** |
| 2 | `2-Mutual-of-Omaha-ebssr_e5112b32.xlsx` | Mutual of Omaha | 09/01/2026 | 11 lines, earned and charged back, **−$2,105.95** |
| 3 | `3-Aetna-CVS-Commission-Detail.xlsx` | Aetna / CVS | 08/29/2026 | override lines incl. 9-month advances, **$1,444.88** |
| 4 | `4-American-Amicable-Advances_0003559471_01Sep26.csv` | American Amicable | 09/01/2026 | 1 advance and 4 taken back, **−$1,375.83** |
| 5 | `5-Aflac-Commission-Detail.xlsx` | Aflac | 08/29/2026 | override lines, **$422.93** |
| 6 | `6-American-Home-Life-Commission-Detail.xlsx` | American Home Life | 08/29/2026 | override lines, **$1,599.27** |
| 7 | `7-Corebridge-view_statements.pdf` | Corebridge Financial | 08/21/2026 | 8 weekly lines, **−$1,758.38** |
| 8 | `8-Sentinel-Security-Life-Statement_69148518058182096.pdf` | Sentinel Security Life | 09/01/2026 | 1 account line (advance interest, no policy), **−$46.25** |

Each file date is the date printed on that statement.

## For each file
1. Click **Upload a file** and choose the file.
2. **Carrier:** choose it from the table (it doesn't fill in by itself).
3. **Type:** **Commissions**.
4. **File date:** the date in the table.
5. Leave **Agency** empty. Click **Upload**, then **Done**.
6. After a few seconds, refresh. The file reads **Read** with its number of rows.

The Aetna, Aflac and American Home Life files look alike: match the file name to the carrier.

## Where to see the result
- **Commission ledger** (Source = From carrier files): the new lines, by carrier.
- **Commission ledger › Carrier accounts:** Sentinel's −$46.25 shows here, as an account line rather than on a policy.
- **Discrepancies:** anything paid short, missing or charged back against what was expected.

## Before you start
- **Corebridge** here is the corrected statement (it adds up to −$1,758.38). The copy in the carrier's original folder is $247.30 short and is refused on purpose: *"Totals don't add up"*.
- **To use these files again,** clear the agency first: run `clean-demo/CLEAR-DEMO-POLICIES-COMMISSIONS-2026-10-13.sql` in the Supabase SQL editor (safe to run more than once). Each file can be uploaded only once per agency, because the system recognises a file by its contents.

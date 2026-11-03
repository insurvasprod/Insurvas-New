# Import your book: the files to upload

One policy file for each carrier the system can read, for the demo agency "Advance Team (QA demo)". Every file is synthetic: made-up people and numbers, real carrier layouts. Each one is checked by `lib/ingestion/bucketLayouts.test.mjs` and gives back exactly the policies listed below.

**Where:** Import your book (`/app/book-import`), signed in as the demo owner.

## The files, in upload order

| # | File | Carrier row | How to get the row | Policies |
|---|---|---|---|---|
| 1 | `1-Americo-americo-policies-2026-09-08.xlsx` | Americo | already on the page | 40 |
| 2 | `2-Mutual-of-Omaha-7376635-8641652185198.csv` | Mutual of Omaha | already on the page | 32 |
| 3 | `3-Aetna-CVS-policySummary.xlsx` | Aetna / CVS | already on the page | 80 |
| 4 | `4-American-Amicable-Policies.csv` | American Amicable | **Add another carrier…** | 70 |
| 5 | `5-Aflac-policySummary.xlsx` | Aflac | **Add another carrier…** | 80 |
| 6 | `6-American-Home-Life-policySummary.xlsx` | American Home Life | **Add another carrier…** | 80 |
| 7 | `7-Corebridge-PolicySummary_09012026.xlsx` | Corebridge Financial | **Add another carrier…** | 30 |
| 8 | `8-Sentinel-Security-Life-PolicyList.xls` | Sentinel Security Life | **Add another carrier…** | 45 |

Together that is 457 policies (checked on 2026-10-13 against the answer key: every carrier exact).

## For each file
1. If the carrier isn't on the page yet, pick it from **Add another carrier…**. A row is added on screen; nothing is saved until you upload.
2. On that carrier's row, set **Date on the file** to **09/01/2026**: the day these files were made, so the paid-to dates read correctly.
3. Click **Upload** and choose the file. You can also drag the file onto the row.
4. The row reads *"Reading the file…"*. In about 20 seconds it shows the number of policies, the premium a month, and how many are at risk.

Upload into the right row: each row is one carrier, and the file is read with that carrier's layout. The Aetna, Aflac and American Home Life files look alike, so match the file name to the row.

## The carriers without a file
**American National, Foresters, Gerber Life, National Life Group, Transamerica.** The agency says it writes these, but the system has no layout for them yet, so a file from them can't be read. Click **Skip for now** on each one. When every row is done or skipped (9 on the page, plus the 5 you add), **Carriers done** reads **14 of 14**.

## After the uploads
- **Exceptions:** one item per carrier, such as *"Americo · 40 policies imported, 40 provisional clients created"*. These are the new clients for someone to look over.
- **Policies** (Source = From carrier files): the new carriers' policies are listed.
- **Lapse risk:** policies that missed a payment show on the call list.

## Before you start
- **To use these files again,** clear the agency first: run `clean-demo/CLEAR-DEMO-POLICIES-COMMISSIONS-2026-10-13.sql` in the Supabase SQL editor (safe to run more than once). Each file can be uploaded only once per agency, because the system recognises a file by its contents.

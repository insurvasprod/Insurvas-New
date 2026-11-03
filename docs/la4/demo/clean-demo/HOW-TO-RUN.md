# Clean LA-4 demo: 8 carriers, everything matches, 2 planted problems

Synthetic data only. Built by `scripts/la4-demo-clean-dataset.mjs` and checked by `scripts/la4-demo-clean-dataset.check.mjs`.

**Before you start:** run [RESET-BEFORE-THE-DEMO.sql](RESET-BEFORE-THE-DEMO.sql) in the Supabase SQL editor. Its last line must read *0 files, 0 policies, 0 ledger lines, 2001 clients, 120 hand policies, 9 contracts, 0 triggers off*. Sign in as the demo owner.

## Step 1 · Policy files → Import your book (`/app/book-import`)

Set **Date on the file** to **10/01/2026** on each row, then **Upload** the file from `policies/`.

| File | Row |
|---|---|
| `1-Aetna-CVS-policySummary.xlsx` | Aetna / CVS (already on the page) |
| `5-Americo-policies-2026-10-01.xlsx` | Americo (already on the page) |
| `7-Mutual-of-Omaha-7376635-policies.csv` | Mutual of Omaha (already on the page) |
| `2-Aflac-policySummary.xlsx` | **Add another carrier…** → Aflac |
| `3-American-Home-Life-policySummary.xlsx` | **Add another carrier…** → American Home Life |
| `4-American-Amicable-Policies.csv` | **Add another carrier…** → American Amicable |
| `6-Corebridge-PolicySummary_10012026.xlsx` | **Add another carrier…** → Corebridge Financial |
| `8-Sentinel-Security-Life-PolicyList.xls` | **Add another carrier…** → Sentinel Security Life |

Then **Skip for now** on American National, Foresters, Gerber Life, LA14 Market, National Life Group and Transamerica.

**You should see:** each row *"6 policies"*; **Carriers done 14 of 14**; **Policies 48**; **Premium a month $1,840**.
Discrepancies will show 6 Aetna *Missing commission*: Aetna pays within 10 days of the first draft and nothing has come in yet. The next step clears 5 of them.

## Step 2 · Commission statements → Carrier files (`/app/carrier-files`) › Upload a file

Type **Commissions** for every file. Choose the carrier yourself; leave Agency empty.

| File (in `commissions/`) | Carrier | File date | Total |
|---|---|---|---|
| `1-Aetna-CVS-Commission-Detail.xlsx` | Aetna / CVS | 10/02/2026 | $786.51 (5 lines) |
| `2-Aflac-Commission-Detail.xlsx` | Aflac | 10/02/2026 | $827.82 |
| `3-American-Home-Life-Commission-Detail.xlsx` | American Home Life | 10/02/2026 | $827.82 |
| `4-American-Amicable-Advances_0003559471_02Oct26.csv` | American Amicable | 10/02/2026 | $1,034.79 |
| `5-Americo-Commissions-Statements-Agent-Portal.pdf` | Americo | 10/02/2026 | $91.98 |
| `6-Corebridge-view_statements.pdf` | Corebridge Financial | 10/02/2026 | $931.30 |
| `7-Mutual-of-Omaha-ebssr-statement.xlsx` | Mutual of Omaha | 10/02/2026 | $570.88 |
| `8-Sentinel-Security-Life-Statement.pdf` | Sentinel Security Life | 09/01/2026 | −$46.25 (advance interest) |

**You should see:** 16 files **Read**, 0 failed. **Commission ledger** (From carrier files): Advanced **$4,979.12**, Earned **$91.98**, fees and interest **−$46.25**, **Net received +$5,024.85**.

## Step 3 · When each carrier pays → Carrier rules (`/app/carrier-rules`)

On each carrier: **Edit** → **Commission triggers** and **Payment lag (days)** → **Save settings**. Leave Aetna, Americo and Mutual of Omaha as they are (Insurvas already has them).

| Carrier | Commission triggers | Payment lag (days) |
|---|---|---|
| Aflac | On issue | 30 |
| American Home Life | On issue | 30 |
| American Amicable | On the first draft | 30 |
| Corebridge Financial | On issue | 30 |
| Sentinel Security Life | On issue | *(leave blank)* |

## Step 4 · The rate card (`/app/rate-card`) › Set up / Edit on each carrier

Do it in this order on each carrier, saving each part before the next:
1. **Your contract level:** type the level, writing number and **Applies from 01/01/2026** → **Save level**.
2. **Products in your book:** pick the family → **Save**.
3. **Rates:** the family, **Policy year 1**, the rate, **For level** = your level, **From 01/01/2026** → **Add rate**.
4. **Advance rules** (where there is one): the family, **Months 9**, **Advance 75%**, **Clawback 12**, **Prorated**, **From 01/01/2026** → **Save advance rule**.

| Carrier | Level | Writing number | Product → family | Rate | Advance rule |
|---|---|---|---|---|---|
| Aetna / CVS | 75 | GNW5067869 | Final Exp → Final Expense | 45% | 9 months, 75% |
| Aflac | 100 | TEW5035090 | Final Exp → Final Expense | 40% | 9 months, 75% |
| American Home Life | 100 | AMW5038355 | Final Exp → Final Expense | 40% | 9 months, 75% |
| American Amicable | 100 | 0000952654 | CCI2N → Final Expense | 50% | 9 months, 75% |
| Americo | 100 | MML13W-444 | EAGLE SELECT I NS → Final Expense | 40% | none |
| Corebridge Financial | 100 | 1JTZ5-AGL | SimpliNow Legacy MAR 2026 → Whole Life | 45% | 9 months, 75% |
| Mutual of Omaha | 82.5 | MOO-5408 | Living Promise - Level Benefit → Final Expense | 30% | 9 months, 75% |
| Sentinel Security Life | 100 | K099581428 | New Vantage III → Whole Life | 50% | none |

**You should see:** every carrier *"6 of 6 policies can be checked"*.

## Step 5 · Discrepancies (`/app/discrepancies?source=carrier`) › Check now

**You should see exactly 2 open:**
- **Paid short · Mutual of Omaha · BU8100004:** the advance should be **$75.20** (75% of 30% of $334.20), **$25.20** came in, **$50.00** short.
- **Missing commission · Aetna / CVS · ACC7810006:** **$193.05** expected, nothing came in.

## Other pages

| Page | What it shows |
|---|---|
| Lapse risk | **2** to call: American Home Life AMH6810002 and Corebridge 7268100003 (paid to Sep 15) |
| Exceptions | **8** *"imported book to look over"*, one per carrier (click **Resolve** → Looked over to clear) |
| Carrier files › Agent findings | notes about columns the layouts don't read; information only |
| Americo policies | no expected commission: Americo's report has no issue date or paid-to date, so the system can't tell when Americo owes from one file. Its payments still count in full. |

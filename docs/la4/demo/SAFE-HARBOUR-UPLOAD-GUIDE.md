# Upload the Safe Harbour files (real carrier reports, edited)

Folder to upload: `C:\Users\Victus\Downloads\Safe_Harbour_Edited_Files - corrected` (15 files). It is
your folder with one change: Corebridge's statement is the corrected copy
(`..._CORRECTED.pdf`, ending balance −$2,021.45 instead of −$2,021.44, so it adds up). The files stay
outside git: they come from real reports.

Where: **Carrier files → Upload a file**, signed in as the demo owner. For each file choose the
carrier, the type (**Policies** or **Commissions**) and the date in the table. **Upload the policy
files first, one at a time** (wait until each reads), then the statements.

Rehearsed on 2026-10-13 in the test agency (Isolation Test A) with these exact files; the figures
below are what it gave.

## 1 · Policies

| Folder / file | Carrier | Date | Policies |
|---|---|---|---|
| `Aetna/Policies/policySummary (1).xlsx` | Aetna / CVS | 10/01/2026 | 408 |
| `Aflac/Policies/safeharbor_aflac_policy_2026-10-01.xlsx` | Aflac | 10/01/2026 | 465 |
| `AHL/Policies/safeharbor_ahl_policy_2026-10-01.xlsx` | American Home Life | 10/01/2026 | 990 |
| `AMAM/Policies/safeharbor_amam_policy_2026-10-01.csv` | American Amicable | 10/01/2026 | 1,720 |
| `Americo/Policies/safeharbor_americo_policy_2026-10-01.csv` | Americo | 10/01/2026 | 170 (171 rows: one policy is in the file twice) |
| `CoreBridge/Policies/safeharbor_corebridge_policy_inforce_2026-10-01.xlsx` | Corebridge Financial | 10/01/2026 | 33 |
| `Sentinel/Policies/safeharbor_sentinel_policy_2026-10-01.xls` | Sentinel Security Life | 10/01/2026 | 185 |

Mutual of Omaha has no policy file in this set.

## 2 · Statements (type Commissions)

| Folder / file | Carrier | Date | Lines | Total |
|---|---|---|---|---|
| `Aetna/Commissions/Commission-Detail (1).xlsx` | Aetna / CVS | 10/01/2026 | 10 | −$1,548.76 |
| `Aflac/Commissions/safeharbor_aflac_commission_2026-09-30.xlsx` | Aflac | 09/30/2026 | 18 | $975.06 |
| `AHL/Commissions/safeharbor_ahl_commission_2026-09-30.xlsx` | American Home Life | 09/30/2026 | 31 | −$1,500.23 |
| `AMAM/Commissions/safeharbor_amam_commission_2026-10-01.csv` | American Amicable | 10/01/2026 | 12 (+1 held) | −$2,222.95 |
| `Americo/Commissions/safeharbor_americo_commission_2026-09-29.pdf` | Americo | 09/29/2026 | 6 advances | $569.68 |
| `CoreBridge/Commissions/safeharbor_corebridge_commission_2026-09-25_CORRECTED.pdf` | Corebridge Financial | 09/25/2026 | 2 (advance + override) | −$538.41 |
| `Mutual of Omaha/Commissions/safeharbor_mutualofomaha_commission_2026-10-01.xlsx` | Mutual of Omaha | 10/01/2026 | 3 | $348.49 |
| `Sentinel/Commissions/safeharbor_sentinel_commission_2026-10-01.pdf` | Sentinel Security Life | 10/01/2026 | 1 account line | −$53.37 |

## What to know
- **AMAM "ADJUST" is held (1 row, +$626.37).** It is on "D674578782", an account, not a policy; a layout
  cannot record it at account level while that column has text. Everything else on the statement reads.
- **Mutual of Omaha** reads the "Comm Amt" column only (owner decision, 2026-10-13); the "Adv Comm"
  column is not in the ledger yet.
- **Corebridge's original statement** (1 cent off) still reads nothing, by design: "the statement
  doesn't add up". Use the corrected copy for the meeting.
- **The older synthetic kit** (`book-import-files/`, `commission-files/`) no longer matches the PDF
  statements: the Americo, Corebridge and Sentinel PDF layouts are now measured on these real
  reports. Its spreadsheets still read.
- To start again: `clean-demo/CLEAR-DEMO-POLICIES-COMMISSIONS-2026-10-13.sql` (safe to run again).

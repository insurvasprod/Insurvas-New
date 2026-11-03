SAMPLE CARRIER FILES - SYNTHETIC DATA ONLY
==========================================
Every name, address, phone (555-01xx fictional range), email (@example.com), DOB, SSN last-4,
policy number, agent number, agency/MGA name and dollar amount in these files is randomly generated.
Nothing comes from real clients, agents or statements. Only the carrier names and the file
layouts (column names, column order, status values, codes, sheet structure) match the real files.

Folder layout mirrors Drive:  09-01-2026 / Sample Agency / <Carrier> / Policies | Commissions
As-of date for all scenarios: 2026-09-01.

Each policy was generated from a scenario so the system rules can be tested:
  active_current, first_missed (1st premium never credited), later_missed (paid-to behind),
  lapsed_first (lapse at effective + 45 days), lapsed_later, not_taken, declined, withdrawn,
  incomplete, pending, approved_unpaid, requested_term.
Commission files are generated from the same policies (advances, earned lines, reversals,
chargebacks in 9ths), so policy and commission files reconcile.

_answer_key_scenarios.csv lists every sample policy with its planted scenario: use it to check
that a detection rule finds exactly the right policies.

Files:
  AMAM            Policies.csv (27 cols, ="..." text style) + Advances_<acct>_01Sep26.csv
  Americo         americo-policies-2026-09-08.xlsx + "Commissions - Statements - Agent Portal.pdf"
  Corebridge      New Business + Policies PolicySummary xlsx + view_statements.pdf (weekly)
  Aetna/Aflac/AHL policySummary.xlsx (46 cols) + Commission-Detail.xlsx (summary + details sheets)
  Mutual of Omaha <prod#>-<id>.csv (76 cols) + ebssr_<uuid>.xlsx (SUMMARY + DETAILS)
  SSL             PolicyList.xls (Excel 2003 XML) + Statement_<n>.pdf
Generated with a seeded script (kept internally), so the same files can be reproduced.

# Eight carriers, lead to issued (2026-10-13)

Demo agency "Advance Team (QA demo)", signed in as the owner (demo.agent@insurvas.test).
Every person below is made up (555-01xx phone range, no real data).

## What you do, for each row

1. Create the lead the same way as Rinor yesterday (Inbound), with the name, date of birth, phone and state below.
2. Start the application from it (Final Expense).
3. **Quote:** pick the carrier in the row, the face amount and the monthly premium below.
4. Fill the rest: gender, height, weight, tobacco = no, address, a test SSN (you type this one), one primary beneficiary at 100%, payment **Direct bill**, acknowledge the disclosures.
5. Mark it **Ready**.
6. **Submit:** reference = the policy number in the row, and choose **Policy number** (not application number).
7. Tell me when all 8 are submitted.

Five carriers have no appointment in the state, so the QA panel shows a warning there. It does not block the submission (the agency has "appointment blocks" off).

| # | Carrier | Person | Date of birth | Phone | State | Address | Face | Monthly | Policy number to submit |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Aetna / CVS | Dana Whitfield | 1958-03-14 | 512-555-0141 | TX | 410 Pecan Grove Rd, Austin TX 78704 | $10,000 | $52.40 | `ACC7913013` |
| 2 | Aflac | Marcus Holloway | 1956-07-22 | 205-555-0142 | AL | 88 Magnolia Ct, Birmingham AL 35209 | $8,000 | $47.15 | `TER6913013` |
| 3 | American Home Life | Ruth Ellison | 1960-11-05 | 614-555-0143 | OH | 2217 Elm Ridge Dr, Columbus OH 43215 | $12,000 | $61.80 | `AMH6913013` |
| 4 | American Amicable | Calvin Brooks | 1957-01-30 | 919-555-0144 | NC | 15 Loblolly Ln, Raleigh NC 27603 | $10,000 | $55.25 | `0119913013` |
| 5 | Americo | Gloria Mendez | 1959-09-12 | 305-555-0145 | FL | 742 Coral Way, Miami FL 33145 | $15,000 | $68.90 | `AM09913013` |
| 6 | Corebridge Financial | Harold Pierce | 1955-05-18 | 215-555-0146 | PA | 39 Chestnut St, Philadelphia PA 19106 | $10,000 | $58.30 | `7269913013` |
| 7 | Mutual of Omaha | Irene Kowalski | 1961-04-09 | 615-555-0147 | TN | 506 Briar Hollow, Nashville TN 37203 | $7,500 | $44.60 | `BU9913013` |
| 8 | Sentinel Security Life | Walter Nguyen | 1956-12-27 | 314-555-0148 | MO | 1201 Laclede Ave, St. Louis MO 63103 | $10,000 | $49.95 | `0913013` |

Type the policy numbers exactly as shown, leading zeros included (rows 4 and 8): the carrier
file is matched on carrier + policy number, letter for letter.

## What I do after you tell me

1. Add each person as a new row in that carrier's policy file, status **Active**, opened and saved
   in Excel (as you would): Aetna, Aflac, AHL, Americo, Corebridge (.xlsx), AMAM, MoO (.csv), SSL (.xls).
2. Upload the 8 policy files dated 10/13/2026 (SSL's .xls through the bucket, the only door that
   takes .xls), then the commission statements, with a commission line added for each new policy
   where the statement is a spreadsheet (Aetna, Aflac, AHL, AMAM, MoO; Americo, Corebridge and
   SSL send PDFs).
3. Check each application closes as **issued** by the carrier, its card moves to Issued in the
   pipeline, and the policy shows in the book with its commission.

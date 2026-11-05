# Upload test: one lead, eight carrier files

Written 2026-11-05 for the owner, so you can check by hand that carrier files link a policy to its lead and move the card by themselves.

**Where:** Ellery & Fields (the demo agency), signed in as `demo.agent@insurvas.test`, on **localhost:3000**. The engine fixes from 2026-11-05 are in commit `64986d7a`, which is not pushed yet. Production runs the old code until that commit is merged, so test on localhost.

**The lead:** Riley Uploadtest, born 14 Feb 1964. The application is with American Amicable and was submitted under policy number `0119990201`.

## Steps

1. **Create the lead.** Paste `00-create-lead.sql` into the Supabase SQL editor and run it. It ends with a notice naming the lead. (Done 2026-11-05.)
2. **Fill the application.** Paste `00b-fill-application.sql` and run it. It reopens the application and fills the quote, every application field (each marked checked) and one beneficiary at 100%. The health interview was already filled and completed through the app on 2026-11-05: 20 answers, sealed by the app. Riley's card is back on **Qualified**.
3. **Finish it yourself in the app.** Open Riley's application (Leads › Riley Uploadtest › Application) and:
   - **Application step:** type the Social Security number. The app encrypts it, so it is never put in by SQL.
   - **Payment step:** choose how Riley pays and fill it in.
   - **Review:** only the SSN and payment were missing, so it should pass. Mark it ready.
   - **Submit:** enter `0119990201` as the **policy number** (not the application number), then record the submission. The card moves to **Submitted** by itself.
4. **Upload the files in order.** Use Book of Business › Files › Upload a File. The dialog fills in carrier, type and date from each file name; check them before pressing Upload. After each upload, wait about 30 seconds, then refresh Leads › Sales Pipeline.

| # | File | What the carrier says | Card should move to |
|---|---|---|---|
| 1 | `01-AMAM-policies-2027-01-04.csv` | IssNotPaid: approved, first premium not paid | **Issued** |
| 2 | `02-AMAM-policies-2027-01-05.csv` | Active, paid to 1 Feb | **In force** |
| 3 | `03-AMAM-advances-2027-01-06.csv` | Commission advance, $275.85 | stays **In force** (already there) |
| 4 | `04-AMAM-policies-2027-01-07.csv` | Act-Pastdue: in force, behind on payment | **At risk** |
| 5 | `05-AMAM-policies-2027-01-08.csv` | Active, paid to 1 Mar: paid again | **In force** |
| 6 | `06-AMAM-policies-2027-01-09.csv` | Terminated, after being paid | **Lapsed** |
| 7 | `07-AMAM-policies-2027-01-10.csv` | Active again, paid to 1 Apr: reinstated | **In force** |
| 8 | `08-AMAM-advances-2027-01-11.csv` | Chargeback of the advance | **Charged back** |

## What to look at besides the card

- **Auto-link:** after file 1, open the policy from Book of Business › Policies (search `0119990201`). Its Client tab says it was linked by the submission, with no review needed, and nothing new appears under Needs you.
- **Why it moved:** the card's history on the lead page shows each move made by a pipeline rule or the application sync. Setup › Pipeline rules shows which rule moved it.
- **Commissions:** after files 3 and 8, the policy's Commissions tab shows the advance and then the chargeback.

## If a card does not move

- **You moved it by hand.** A card someone moved, by dragging it or by a disposition, is left alone by the rules for 7 days. Don't drag Riley's card during the test.
- **Two uploads on the same day.** Each file has its own date. If the dialog asks to replace a file, the date was changed: put back the date from the file name.
- **The same file twice.** A file identical to one already read is skipped as a duplicate.
- **Commission type.** If the dialog leaves Type empty for files 3 and 8, choose Commissions.

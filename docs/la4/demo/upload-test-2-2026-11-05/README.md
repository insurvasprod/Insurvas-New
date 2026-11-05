# Upload test 2: every policy status and every commission line

Written 2026-11-05 for the owner. It covers every American Amicable policy status and every commission action, with a commission file beside the policy file on each day money moves.

**Where:** Ellery & Fields (the demo agency), signed in as `demo.agent@insurvas.test`, on **localhost:3000**. The engine fixes are in commit `64986d7a`, which is not pushed yet.

**Why eight leads:** Declined, Withdrawn, Not taken and a chargeback each end a card, and an ended card is not moved again. So Sam walks the whole life of a policy, and seven others each take one of the dead ends.

| Lead | Policy | Path |
|---|---|---|
| Sam Fulltest | 0119990301 | the whole life: pending, issued, in force, at risk, paid again, lapsed, reinstated, paid up |
| Bea Declinetwo | 0119990302 | declined |
| Cal Withdrawtwo | 0119990303 | withdrawn |
| Dee Incomplete | 0119990304 | needs requirements, then incomplete |
| Eli Nottaken | 0119990305 | issued, then not taken |
| Fern Infnottaken | 0119990306 | issued, then not taken (InfNotTaken) |
| Gus Chargeback | 0119990307 | in force with an advance, then past due with a chargeback |
| Hana Nopremium | 0119990308 | issued, then a no-premium chargeback |

## Steps

1. **Create the leads.** Paste `00-create-leads.sql` into the Supabase SQL editor and run it. All eight cards are on Sales pipeline › **Submitted**. Their applications are recorded as submitted by the SQL, so there is nothing to fill in.
2. **Upload day by day.** Use Book of Business › Files › Upload a File. Upload the **policies file (a) first, then that day's commissions file (b)** if there is one. The dialog fills in carrier, type and date from each file name. Wait about 30 seconds, then refresh Leads › Sales Pipeline.

Every policies file lists all eight policies. A row whose status did not change moves nothing.

| Day | Files | What the carrier says | Cards should be |
|---|---|---|---|
| 1 | `01a` policies, `01b` advances | Sam, Bea, Cal: Pending · Dee: NeedReqmnt · Eli, Fern, Hana: IssNotPaid · Gus: Active · advance (DELIVR) for Gus | Sam, Bea, Cal, Dee **Submitted** · Eli, Fern, Hana **Issued** · Gus **In force** |
| 2 | `02a` policies, `02b` advances | Sam: NeedReqmnt · Bea: Declined · Cal: Withdrawn · Dee: Incomplete · Eli: NotTaken · Fern: InfNotTaken · Gus: Act-Pastdue · past-due chargeback (PSTDUE) for Gus · no-premium chargeback (NOPREM) for Hana | Sam **Submitted** · Bea **Declined** · Cal, Dee **Withdrawn** · Eli, Fern **Not taken** · Gus **Charged back** (the chargeback outranks at risk) · Hana **Charged back** |
| 3 | `03a` policies, `03b` advances | Sam: IssNotPaid · Gus: Terminated · cancel chargeback (CANCEL) for Gus | Sam **Issued** · Gus stays **Charged back** |
| 4 | `04a` policies, `04b` advances | Sam: Active · advance (DELIVR) for Sam | Sam **In force** |
| 5 | `05a` policies, `05b` advances | Sam: Act-Ret Item (payment returned) · advance (PAIDFR) for Sam | Sam **At risk** (at risk outranks the advance) |
| 6 | `06a` policies | Sam: Active, paid to 1 Apr | Sam **In force** |
| 7 | `07a` policies | Sam: Act-Pastdue | Sam **At risk** |
| 8 | `08a` policies | Sam: Active, paid to 1 May | Sam **In force** |
| 9 | `09a` policies | Sam: Terminated, after being paid | Sam **Lapsed** |
| 10 | `10a` policies | Sam: Active, paid to 1 Jun: reinstated | Sam **In force** |
| 11 | `11a` policies | Sam: RPU (reduced paid-up) | Sam **Paid up** |

## Every status and line, and where it is tested

| AMAM word | Reads as | Day |
|---|---|---|
| Pending, NeedReqmnt | submitted | 1, 2 |
| IssNotPaid | approved, not paid | 1, 3 |
| Active | in force | 1, 4, 6, 8, 10 |
| Act-Ret Item, Act-Pastdue | at risk | 5, 2 and 7 |
| RPU | paid up | 11 |
| Terminated | lapsed (paid before) | 3, 9 |
| Declined | declined | 2 |
| Withdrawn, Incomplete | withdrawn | 2 |
| NotTaken, InfNotTaken | not taken | 2 |
| DELIVR, PAIDFR (commissions) | advance | 1, 4, 5 |
| PSTDUE, NOPREM, CANCEL (commissions) | chargeback | 2, 3 |

## What to look at besides the cards

- **Auto-link:** every policy links by its submission, with nothing new under Needs you. Open one from Book of Business › Policies and look at its Client tab.
- **Who moved it:** each card's history shows the pipeline rule or the application sync. Setup › Pipeline rules shows each rule's decision, including "comes later in the policy's life, so it decides" on days 2 and 5.
- **Money:** each policy's Commissions tab shows its advances and chargebacks.

## If a card does not move

- **You moved it by hand.** A card someone moved is left alone by the rules for 7 days.
- **The dialog asks to replace a file.** The date was changed; put back the date from the file name.
- **The order within a day.** Upload the policies file before the commissions file. Either order lands in the same place, but this one matches the table step by step.

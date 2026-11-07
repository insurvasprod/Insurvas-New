# Power-policies demo: one sale, linked without its policy number, through to paid out

Written 2026-11-06. One client goes from submitted to paid out in three carrier files. The carrier's policy links to the sale by the person, because the sale was submitted before any policy number existed.

**Where:** Ellery & Fields (the demo agency), signed in as `demo.agent@insurvas.test`, on **localhost:3000**. The identity link (`linkByIdentity` in `lib/ingestion/policyMatchingStore.ts`) is in the working tree only. Production does not have it until it is committed and merged, so run the demo on localhost.

## The client (already made)

**Paige Paidout**, born 19 May 1962, phone 813-555-0312, 120 Test Palm Ave, Tampa FL. American Amicable term life, **$15,000 face, $45.00 a month**. Beneficiary at 100%. The writing agent is the demo owner.

Made on 2026-11-06 with:

```
node --env-file=.env.local --experimental-strip-types scripts/seed-submitted-application.mjs --first Paige --last Paidout --dob 1962-05-19 --policy 4400312061 --phone 8135550312
```

The script copies the case Quinn Testmore walked through the app on 2026-11-03, with a new person:
- the verify step;
- the interview (19 answers, re-sealed to Paige's interview);
- the quote, the application fields and the beneficiary;
- the payment method (last four digits only);
- the review and the submission.

It is **submitted under application number `4400312061` and no policy number**, and the card is on **Sales pipeline › Submitted**.

The Social Security number is not copied, so the Application step shows no tick. Nothing asks for the number, because the application is already submitted.

**Open it:** Sales › Applications › Paige Paidout.

**For another client**, run the same line with a new name, date of birth, application number and phone. Then copy the three files below and change the name, date of birth, phone and policy number in them.

## The files (upload in order)

Upload each one with Book of business › Carrier files › Upload a file. The dialog fills in the carrier, type and date from the file name; check them before pressing Upload. After each upload, wait about 30 seconds and refresh.

Every file carries the carrier's policy number **`0119990312`**, which the sale has never seen. The writing agent code is `7771878615`, the demo owner's American Amicable code.

| # | File | What the carrier says | What you should see |
|---|---|---|---|
| 1 | `01-AMAM-policies-2026-11-10.csv` | IssNotPaid: approved, first premium not paid | The policy **links to Paige's sale by herself**: name, date of birth, writing agent, premium and face agree. `0119990312` is written onto her submission, the application closes as issued, and the card moves to **Issued**. Nothing new appears under Needs you. |
| 2 | `02-AMAM-policies-2026-11-11.csv` | Active, paid to 10 Dec | Card to **In force** |
| 3 | `03-AMAM-advances-2026-11-12.csv` | Commission advance, **$202.50** (75% of a $540 annual premium at 50%) | **Paid out**: the advance shows on the policy's Commissions tab and in the Commission ledger. The card stays on In force. |

## The second client: Nora Paidtwo

Made by the owner on 2026-11-06 with the same script (`--first Nora --last Paidtwo --dob 1958-09-02 --policy 4400312062 --phone 8135550313`):
- lead `6405babc`, application `4131ab45`;
- the same cover, $15,000 at $45.00 a month;
- submitted under application number `4400312062` with no policy number, and on Submitted.

Her files carry policy **`0119990313`**. Their dates come after Paige's, so the two clients never share a day.

| # | File | What the carrier says | What you should see |
|---|---|---|---|
| 4 | `04-AMAM-policies-2026-11-13.csv` | IssNotPaid | Links to Nora's sale by the person; card to **Issued** |
| 5 | `05-AMAM-policies-2026-11-14.csv` | Active, paid to 13 Dec | Card to **In force** |
| 6 | `06-AMAM-advances-2026-11-15.csv` | Commission advance, $202.50 | **Paid out** |

## What to show

- **The link:** Book of business › Policies, search `0119990312`. The page is titled Paige Paidout. The Client tab says it was "Linked by identity, no policy number on the submission" and names what agreed.
- **The application:** Sales › Applications › Paige Paidout now shows Issued, with the policy number on it.
- **Why the card moved:** the lead's history shows each move. Carrier sync › Card moves shows which rule made it.
- **The money:** after file 3, the policy's Commissions tab shows the $202.50 advance, and so does Book of business › Commission ledger.

## If something does not happen

- **The policy waits under Needs you instead of linking.** A second open American Amicable sale with the same name and date of birth would make it ambiguous. Today Paige is the only one that fits; this was checked 2026-11-06 against the six open American Amicable submissions.
- **The card does not move.** A card someone dragged is left alone by the rules for 7 days, so don't drag Paige's card.
- **The dialog asks to replace a file.** The date was changed: put back the date from the file name. No other American Amicable file exists for 10, 11 or 12 Nov.
- **The same file twice** is skipped as a duplicate.
- **The commission file's type is empty.** Choose Commissions.

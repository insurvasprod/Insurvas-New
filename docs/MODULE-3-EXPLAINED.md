# Module 3, explained simply

**Underwriting, Quoting & Application — the whole thing in plain words**

Read this if you want to understand what Module 3 *is* without knowing anything about insurance.
No jargon that isn't explained. Nothing assumed.

Built from: the Notion doc *Module 3 — Underwriting, Quoting & Application*, all **26 LA-3 tasks**
in the Insurvas Sprint board, and *Sixteen Open Questions, Answered* (which changes three of them).
Read 2026-09-21. Every LA-3 task is currently **Backlog** — none of this is built yet.

---

## 1. The one-sentence version

> Modules 1 and 2 get a person on the phone. **Module 3 is the sale itself** — the health quiz, the
> price, picking a company, filling in their form, and writing down the receipt number. Module 4
> keeps track of the money afterwards.

```
MODULE 1 (inbound)          MODULE 2 (outbound)
someone fills in a form     you ring a bought list
       │                            │
       └──────────┬─────────────┘
                  ▼
        ┌──────────────────────┐
        │   MODULE 3 — this    │   ← 20 to 40 minutes on one phone call
        └──────────┬───────────┘
                  ▼
        the receipt number ("policy number")
                  ▼
        MODULE 4 — keeping the books
```

**The most important design rule in the whole module:** build it **once**. Inbound and outbound must
end up in the *same* sale flow. If they each get their own, every future change has to be made
twice and they slowly drift apart. The only difference between the two doors is how much is
already filled in when you walk through.

---

## 2. Who's in the story

| Who | What they are | Think of them as |
|---|---|---|
| **Ray** | the insurance agent — our user | a shop assistant who sells several brands |
| **Dolores / Rita** | the customer, usually 60–85, on a fixed income | the person buying |
| **The carrier** | the company that actually provides the insurance (Americo, Aetna, Mutual of Omaha…) | the brand whose product Ray sells |
| **Insurvas** | our software | Ray's till, notebook and filing cabinet |

Ray does **not** work for one carrier. He's signed up with several, and part of his job is picking
which one to send each customer to.

---

## 3. Words you need (and only these)

| Word | What it actually means |
|---|---|
| **Underwriting** | The carrier deciding *"will we insure this person, and for how much?"* For cheap funeral policies it's just health questions on the phone — no doctor's visit. |
| **Knockout question** | A question where the wrong answer = instant no. "Are you on oxygen?" "Do you have dialysis?" |
| **Level benefit** | Full payout from day one. Best outcome. |
| **Graded benefit** | Reduced payout for the first 2–3 years. What you get when health isn't great. |
| **Guaranteed issue (GI)** | Nobody is refused. No health questions. Most expensive, longest wait. Last resort. |
| **Face amount** | How much the policy pays out when the person dies. e.g. $10,000. |
| **Premium** | What the customer pays each month. e.g. $68.40. |
| **Draft date** | The day each month the money is taken from their bank. **This turns out to matter enormously — see §6.** |
| **Contract level** | Ray's personal commission rate with a carrier. "I'm at 115% with Americo." Two agents selling the identical policy earn different amounts. |
| **NIGO** | *Not In Good Order.* The carrier handed the form back because something's wrong. Like homework returned for corrections. Costs days. |
| **Policy number** | The carrier's reference number for the policy. **The single most important number in the entire product.** |
| **Final Expense (FE)** | Small policies (~$10k) to cover a funeral. The main product. |
| **Term life** | Bigger policies ($250k–$1m) for a fixed number of years. Second product, added later. |

---

## 4. The journey, first thing to last

Nine steps. This is the spine of the whole module.

```
①  VERIFY        "Are you who you say you are?"        ← already built (LA-1.11)
        ↓
②  UNDERWRITE    the health quiz + list their medicines
        ↓
③  QUOTE         Ray gets prices from each carrier's own website and types them in
        ↓
④  CHOOSE        which carriers can he legally use? which pays him best?
        ↓
⑤  APPLICATION   one big form: beneficiaries, bank details, draft date
        ↓
⑥  CHECK IT      catch what the carrier would reject, before sending
        ↓
⑦  FILL IT IN    copy everything onto the carrier's own website
        ↓
⑧  SUBMIT        Ray presses submit — on the carrier's site, himself
        ↓
⑨  WRITE IT DOWN the policy number + a screenshot as proof
```

**Steps ⑤ and ⑦ are where the software earns its money.** Step ⑦ is currently *twenty minutes of
retyping* with a customer waiting on the phone. Step ⑨ is currently *a number in a paper notebook*
— and when it's lost, money arrives months later that nobody can match to a sale.

---

## 5. The three big ideas

### Idea 1 — We never guess the price

Insurance prices change constantly — per carrier, per state, per product, per age. If we kept our
own price list it would go stale, and then Ray quotes a price the carrier won't honour **in front of
a customer.**

So: **Ray opens the carrier's own website, gets the real price, and types it in.** We check it looks
*sensible* (not that it's *correct*) and warn if it looks odd. A warning, never a block — if our
guess disagrees with the carrier, the carrier is right.

### Idea 2 — The AI helps, but never decides

There's an AI assistant (LA-3.3) that explains medicines, spots contradictions, and writes the
"describe your condition" paragraphs carriers ask for.

**The hard rule, and it's the most important sentence in the module:**

> The assistant never states a carrier's decision as fact.

Not *"Americo will decline this."*
Instead *"Carriers commonly treat this as a decline or a graded rating. Check Americo's guide."*

Why so strict? Because **nobody is maintaining a list of what each carrier accepts** — that was a
deliberate decision. An assistant that sounds certain about something nobody maintains *will be
believed, and it will be wrong,* and Ray only finds out when the case is declined.

### Idea 3 — AI builds the map once; a robot follows it a thousand times

To fill in a carrier's website, the software needs to know *which box is which*. That's a **field
map** — a translation sheet: "our `date_of_birth` goes in the box called `P1_DOB`".

- **AI reads the carrier's form once and *proposes* the map.** A human checks it and approves it.
- From then on it's a boring lookup table. **No AI runs while a real application is being filled.**

> Never let an AI fill a live application box-by-box every time. It's slow, it's unpredictable, and
> one day it will put a date of birth in the policy-number box with a customer on the phone.

A map can't be published until every **sensitive** box (social security number, bank routing
number, bank account number) has been checked by a human by name.

---

## 6. The single cleverest feature: the draft-date optimiser (LA-3.9)

This looks like a date picker. It is the highest-value feature in the module.

**The problem, in pocket-money terms.** Most of these customers live on Social Security. The
government pays them on a schedule based on **their birthday**:

| Born on the… | Money arrives |
|---|---|
| 1st–10th | 2nd Wednesday of the month |
| 11th–20th | 3rd Wednesday |
| 21st–31st | 4th Wednesday |
| (SSI recipients) | 1st of the month |

Now: if the insurance takes its $68 on the **3rd**, but her money arrives on the **17th**, the
account is empty. The payment bounces. Within about 60 days the policy is dead, and the commission
Ray already spent gets clawed back.

**The customer didn't change her mind. The date was just wrong.**

So the software works out when her money arrives and recommends a draft day **2–4 days after** —
and it checks *all twelve months ahead*, because "3rd Wednesday" moves around. It caps at day 28
(because the 29th–31st break in February), and it gives Ray a sentence he can read aloud:

> "Your Social Security lands on the third Wednesday. We'll take the payment on the 22nd, so your
> money is always there first."

If Ray picks a bad date, it warns loudly — but **lets him override it and writes down that he did.**
Some customers genuinely have other income. And an agent who *can't* override will start typing in
fake birthdays, which is far worse.

**The economics, from the docs:** a lead costs ~$500 per issued policy, the carrier advances ~$540,
and a month-4 lapse costs ~$1,040 all-in — which wipes out the profit on **26 good sales**. That's
why a date picker is the best-value thing here.

---

## 7. The pages / screens

Grouped by where they sit in the journey.

### The main working screens (what Ray uses on a call)

| Screen | What it's for | Task |
|---|---|---|
| **Underwriting interview** | The health quiz, question by question, with follow-ups appearing as needed. Medicines go in a proper table (name, dose, since when, what for) — **never a free-text blob**, because the carrier asks for exactly those columns. | LA-3.2 |
| **AI assistant panel** | Sits beside the interview. Suggestions look *visibly* like suggestions and need a click to accept. | LA-3.3 |
| **Quote capture** | Type in the prices you got from each carrier's site. | LA-3.5 |
| **Quote comparison** | 2–4 quotes side by side in columns. Has an **"Appointed?"** row — *can Ray legally sell this one?* — which stops the most expensive mistake there is. | LA-3.5 |
| **Client-facing comparison** | A clean print/PDF for the customer. No commission, no internal columns. | LA-3.5 |
| **Application form** | The big one. Renders whatever fields this carrier needs. | LA-3.7 |
| **Beneficiary editor** | Who gets the money. Has a **"split evenly"** button and a live running total that's green only at exactly 100%. | LA-3.8 |
| **Draft-date picker** | §6 above. | LA-3.9 |
| **Disclosures panel** | Legal forms that appear automatically when needed. | LA-3.10 |
| **Pre-submission QA** | **One screen that says "this will go through" or "these four things will get it kicked back."** Every item links straight to the field that's wrong. | LA-3.11 |
| **Copy-assist panel** | When autofill can't work: every value with a one-click copy button, tick marks to keep your place through a 60-field form, and format options (is it `03/14/1953` or `19530314`?). | LA-3.14 |
| **Submission capture modal** | Pops up the moment Ray submits. Paste the policy number, paste the screenshot. | LA-3.15 |
| **Case timeline** | Every attempt for this customer: carrier, price, outcome, reason. What Ray shows the customer. | LA-3.16 |
| **Counteroffer delta screen** | Applied-for vs offered, side by side, with the difference in **dollars and percent** so Ray isn't doing sums on a live call. | LA-3.26 |

### The "check on things" screens (what Ray uses each morning)

| Screen | What it's for | Task |
|---|---|---|
| **Pending cases** | Everything waiting between *submitted* and *issued*. Sorted so anything **waiting on the customer** is at the top — because that's the only column Ray can actually move. | LA-3.18 |
| **Missing reference list** | Applications submitted with no policy number yet. Doesn't go away until it's empty. | LA-3.15 |
| **Sales performance report** | The funnel, conversion rates, and timings. | LA-3.21 |
| **Decline-reason report** | *"Carrier A declines 8 of 11 diabetic cases; Carrier C declines 1 of 9."* The one report that changes what Ray does on the next call. | LA-3.21 |

### The settings screens (set up once, reused forever)

All under one **Sales settings hub** (LA-3.17):

```
Settings → Sales
├─ Carriers & products      names, portals, age/face limits, commission %
├─ Appointments             which carriers, which states, is it still valid
├─ Underwriting templates   the health quizzes             (LA-3.1)
├─ Quotation templates      what each carrier needs to price  (LA-3.4)
├─ Application field sets   what each carrier's form asks     (LA-3.7)
├─ Carrier field maps       the autofill translation sheets   (LA-3.13)
├─ Disclosure library       the legal forms                   (LA-3.10)
├─ QA rules                 which checks block, which warn    (LA-3.11)
├─ Draft-date rules         income schedules, safe windows    (LA-3.9)
├─ Carrier portal register  usernames only, never passwords   (LA-3.22)
└─ AI assistant             on/off, which provider            (LA-3.3)
```

**Everything is versioned.** An application already in progress keeps the version it started on —
so editing a template never silently rewrites something half-finished.

---

## 8. All 26 tasks, in plain words

Grouped by what they're for. **High** = build first.

### Getting the health picture (steps ① and ②)

| # | Name | In plain words | Priority |
|---|---|---|---|
| **3.1** | Underwriting question templates | Build the health quiz once, reuse it forever. Different quizzes per product and per carrier. Questions can trigger follow-ups. Mark a question as a **knockout** so a bad answer shows up immediately instead of at the end. | High |
| **3.2** | Underwriting interview & medication capture | Actually running the quiz on a live call. Answers save as they're given, so a dropped call loses nothing. Medicines in a **table**, not a paragraph. | High |
| **3.3** | AI underwriting assistant | Explains medicines, spots contradictions ("you said no heart problems but listed a heart pill"), drafts the wordy answers. Advisory only. Can be switched off entirely. | High |

> **A lovely detail in LA-3.1:** every quiz ships with five questions that have *nothing* to do with
> health and everything to do with whether the policy survives:
> *When does your Social Security arrive?* · *Is this the account it lands in?* · *Does anyone else
> need to be on this call?* · *Do you have existing coverage?* · *Can you get a text without hanging
> up?*
> A new agent wouldn't know to ask any of them. So they're in the template by default.

### Working out the price (step ③)

| # | Name | In plain words | Priority |
|---|---|---|---|
| **3.4** | Quotation templates | A checklist of what each carrier needs *before* Ray opens their website, so he isn't going back and forth. Handles the fiddly stuff — some carriers use "age nearest birthday", some "age last birthday". | High |
| **3.5** | Quote capture & comparison | Type in the prices. 2–4 side by side. Warns if a price looks odd, never blocks. Keeps the ones **not** chosen — a quote from three weeks ago is often why she's calling back today. | High |

### Picking the carrier (step ④)

| # | Name | In plain words | Priority |
|---|---|---|---|
| **3.6** | Carrier appointments & payout ranking | Two things Ray keeps in his head: *which carriers am I actually allowed to sell?* and *which pays me more?* Shows estimated commission — with a **permanent, non-dismissible line**: *"Recommend on fit first."* | High |

> **The honest limitation, printed on the screen:** this ranks what Ray *earns*, not whether the
> carrier will *accept her*. Nothing in the system knows the latter. One line of copy stops an agent
> reading it as "these three will take her".

### The application (step ⑤)

| # | Name | In plain words | Priority |
|---|---|---|---|
| **3.7** | Application record & field sets | **The foundation.** One record holding everything, as one row per field (not 200 columns). Social security and bank numbers are **encrypted**, masked as `••••1234`, and every reveal writes an audit line. | High |
| **3.8** | Beneficiary editor | Who gets the money. Shares **must** total exactly 100 — this is the #1 reason applications get bounced. "Split evenly" across 3 people gives 33.34 / 33.33 / 33.33. | High |
| **3.9** | Draft-date optimiser | §6. The best-value feature here. | High |
| **3.10** | Disclosure library | Legal forms that appear automatically. Answer "yes, I have existing coverage" → the replacement notice appears as **required** and blocks submission until acknowledged. | Medium |
| **3.19** | Payment methods beyond bank transfer | Lots of these customers have **no bank account** — they get a government **Direct Express** prepaid card. If the only thing we can store is a bank account, agents will type card numbers into the account-number box, which corrupts the data *and* the compliance position at once. **We never store CVV.** | High |

### Checking before sending (step ⑥)

| # | Name | In plain words | Priority |
|---|---|---|---|
| **3.11** | Pre-submission QA engine | One verdict screen. **Blocking** things (missing required field, shares ≠ 100, bad routing number) vs **warnings** (odd price, unusual age). Every item links straight to the broken field. The verdict is **saved** — so when it's declined three weeks later you can see what the system said at the time. | High |

### Filling in the carrier's website (steps ⑦ and ⑧)

| # | Name | In plain words | Priority |
|---|---|---|---|
| **3.12** | Browser extension security | Built **before** any filling logic. The extension handles social security and bank numbers on websites we don't control, so this is the most consequential decision in the module. Short-lived token, locked to **one** application and **one** carrier website. | High |
| **3.13** | Carrier field maps + AI proposal | §5, Idea 3. Also: **"never guess"** — an uncertain field is left **empty and flagged**, never filled with a best guess. And **"fill, never submit"** — Ray always presses submit himself. | High |
| **3.14** | Copy-assist panel | The fallback, and honestly the thing most agents will use for months. One click per value, format options, tick marks. Treated as a first-class feature, not a consolation prize — **some carrier websites will never be safely fillable.** | High |

### Writing down the result (step ⑨)

| # | Name | In plain words | Priority |
|---|---|---|---|
| **3.15** | Submission capture | Grab the policy number and a screenshot **while the confirmation is still on screen**. Warns if the same number appears twice. An application submitted with no number sits on a **Missing reference** list that won't go away. | High |

> **Why this small task is the most important one.** Everything later — the book of business,
> retention, commission reconciliation — matches carrier data back to ours using **their** number.
> If it's missing or mistyped, the policy is an **orphan**: in no book, triggering no follow-up,
> matching no commission. *And an orphaned policy is invisible until it lapses.*

### When it doesn't go cleanly

| # | Name | In plain words | Priority |
|---|---|---|---|
| **3.16** | Resubmission & attempt model | Carrier A says no; Carrier B would say yes. Today that's 15 minutes of re-typing with a customer whose enthusiasm just took a hit — and it's where a lot of these cases get abandoned. So: **carry forward** the health quiz, medicines, address, beneficiaries and bank details. **Don't** carry forward the quote or the carrier-specific bits. Nothing is edited or deleted; the declined attempt is kept whole, forever. | Medium |
| **3.26** | Counteroffer handling | **The biggest gap they found.** The carrier says *"yes, but on different terms"* — applied for Level, approved Graded; or applied Preferred at $38/month, approved Standard at $71/month. There was **nowhere to put this**, so agents recorded it as "issued" — and then the welcome letter told the customer $38 while the bank took $71. Now it's its own record, with a countdown, because the carrier's window closing is the quiet killer. | Medium |
| **3.18** | Pending-requirements tracker | Owns the gap between *submitted* and *issued*, which nothing owned before, so cases stalled silently. Tracks doctor's reports, the carrier's phone interview, missing info, amendments, medical exams. Sorted so **"waiting on the customer"** is at the top. One-click "log a chase". | High |

### Everything else

| # | Name | In plain words | Priority |
|---|---|---|---|
| **3.17** | Sales settings hub | One place for all of the above, instead of thirteen scattered screens. | Medium |
| **3.20** | Client welcome pack | One email/PDF after submission: **the carrier's name, what will appear on your bank statement, the amount, the day it's taken.** Plus: *"If anything here is wrong, call me first — not your bank."* | Medium |
| **3.21** | Sales performance & decline report | Reads back what's already collected. Distinguishes **issued** (the number agents brag about) from **placed** (issued *and* the first payment actually cleared — the number that pays). A cell with fewer than 5 cases shows a count, never a percentage. | Medium |
| **3.22** | Carrier portal credential register | Stores usernames, **never passwords.** *The schema itself is the control* — there's no password column to fill in later. | Medium |
| **3.23** | Pipeline stage sync | When an application moves, the lead's card on the board moves too. Forward-only. If Ray dragged a card by hand, that wins — software that keeps undoing your drag is software you turn off. | Medium |
| **3.24** | Joint / spouse applications | Sell both spouses on one call without typing everything twice. **Two** applications, two policies — never one joint record. Shares the address, phone and bank details. **Never** shares anything health-related (*"the single worst bug this feature could ship"*). | Medium |
| **3.25** | Term life | Adds the bigger product. Four things differ: term length matters, face amounts are 25× larger, "health classes" replace tiers, and there's usually a real medical exam (3–8 weeks, not 3–8 days). **Everything else works unchanged** — which is the payoff for building 3.7 as one-row-per-field. | Medium |

---

## 9. Rules that never bend

These come up again and again. They're the spine of the module.

1. **Fill, never submit.** The software types into the carrier's form. **Ray** presses submit.
2. **Never guess.** An uncertain field is left empty and flagged. A silently wrong bank number is
   far worse than a blank one.
3. **The AI never states a carrier decision as fact.**
4. **No AI at fill time.** AI builds the map once, under supervision; the fill is a lookup table.
5. **Warnings warn, blocks block.** Money-ish and legal things block. Anything where the carrier
   might know better than us only warns.
6. **Nothing is deleted or overwritten.** Declined attempts, discarded quotes, old template
   versions, counteroffers — all kept. What Ray sold and what the carrier offered are two different
   facts and both must stay readable.
7. **Money is stored as whole cents.** Never a decimal number that can drift.
8. **Sensitive data is encrypted, masked, revealed one field at a time, and every look is logged.**
   It's never in a bulk payload and never sent to any AI provider.
9. **Everything is versioned, and work in progress keeps the version it started on.**
10. **Say the limitation on the screen.** The payout ranking says it doesn't check acceptance. The
    "placed" metric says it's partial. The clipboard cleaner says it's best-effort. Honest software
    tells you what it doesn't know.

---

## 10. What they deliberately decided *not* to build

This list is as important as the features. Each one is a considered trade, not an oversight.

| Not building | Why | What it costs us |
|---|---|---|
| **Carrier acceptance rules** — a list of what each carrier will accept | Nobody can keep it current, and a wrong answer is discovered at decline | The AI can only speak in generalities; the ranking can't check eligibility |
| **Price/rate tables** | Prices change constantly; a stale table quotes a price the carrier won't honour, in front of a customer | Ray types every price by hand |
| **E-signature** | The carrier's own portal collects signatures | — |
| **Storing carrier portal passwords** | It's the agent's *identity* with the carrier — it can bind business and change bank details on existing policies. A breach would lose our agents' entire books at every carrier at once. Usually a contract violation too. | Agents keep using their own password manager |
| **Any proof the customer agreed to the bank payment** | The carrier's process owns it | **In a month-two dispute it's Ray's word against the customer's, and the chargeback stands.** Flagged for revisit. |
| **Who-can-see-what inside one agency** | Fine for a solo agent | The first time an agency adds an assistant, anyone can open any application and see social security and bank numbers. *Becomes urgent, not just desirable, at the first multi-person account.* |
| **Draft autosave / connection recovery** | Cheap to add later | A long application lost to a dropped connection is retyped from scratch, one call at a time |
| **Carrier APIs** of any kind | None exist for this market | Ray types what the carrier tells him |

---

## 11. Three things the decisions doc changed

*Sixteen Open Questions, Answered* found real contradictions. Three touch Module 3:

**1. The extension token was too short (was 15 minutes → now 60–90).** A real application takes
longer than 15 minutes; nobody had walked through the timing. They chose one longer token over
auto-renewal, because renewal machinery is three more things that can be wrong. The trade: the
token now sits in a browser for up to 90 minutes, so **every other control has to hold** — and
revocation must be checked against the database on every request, not inferred from the token.
Corrections flowing back get their own separate permission that **can never write bank details.**

**2. "One lead = one application" was wrong wording.** It was meant to say *don't build a duplicate
pipeline*, not *one lead can only ever produce one application*. The real shape:

```
contact/household
  └─ lead                  one per time you acquired them
     └─ application_case   one per attempt to make a sale
        └─ application     one per carrier tried
           └─ submission    one per time you pressed submit
              └─ policy
```

**3. Two tasks were duplicates and are cancelled.** LA-2.15 and LA-2.16 described the same extension
and field maps as LA-3.12/3.13/3.14, with different rules. The LA-3 versions win — they answered the
security question, they version the maps, they refuse to publish while a bank field is unverified,
and they detect when a carrier redesigns their form.

---

## 12. Still undecided

Worth knowing before anyone starts building.

1. **Which AI provider**, and are its terms acceptable for health and prescription data? (Not
   OpenAI — the plan is OpenRouter / Fireworks / Kimi.) **Settle before shipping, not after.**
2. **Who reviews the AI-proposed field maps** — Ray, or us? It needs someone who can tell a
   routing-number box from an account-number box.
3. **What if a carrier's website has no fillable form at all?** Some are built in a way that defeats
   this entirely. Fall back to a filled-in PDF, or accept manual entry for those carriers?
4. **Do we support paper applications?** Some small carriers still take them.
5. **How long is "waiting for a policy number" acceptable** before we call the submission failed?
6. **Consumer data deletion** — a brand-new gap. There's no way today for one individual to say
   "remove my data". *It will arrive with a legal clock attached.*

---

## 13. If you were building it, in this order

Nothing here is started, so the order matters. Derived from what each task says it depends on.

**Foundations first — everything else reads from these**
1. `LA-3.7` Application record — *the single source of truth. The extension is worthless without it.*
2. `LA-3.1` Underwriting templates
3. `LA-3.2` The interview
4. `LA-3.19` Payment methods — *do this with 3.7, not after; retrofitting card payments into a bank-only schema is the worse path*

**Then you can make a sale**
5. `LA-3.6` Appointments — *needed before 3.5 can show "Appointed?"*
6. `LA-3.4` Quotation templates
7. `LA-3.5` Quote capture & comparison
8. `LA-3.8` Beneficiaries
9. `LA-3.9` Draft-date optimiser — *best value-for-effort in the module*
10. `LA-3.10` Disclosures
11. `LA-3.11` QA engine — *aggregates 3.5, 3.6, 3.8, 3.9, 3.10, so it comes after them*

**Then close the loop — nothing downstream works without this**
12. `LA-3.15` Submission capture — *the join key for Modules 4, 5 and 7*

**Then the typing problem**
13. `LA-3.12` Extension security — *before any filling logic*
14. `LA-3.14` Copy-assist — *before 3.13, because it works on day one with zero maps and it's the fallback when a map misses*
15. `LA-3.13` Field maps + AI proposal

**Then reality**
16. `LA-3.18` Pending requirements
17. `LA-3.26` Counteroffers
18. `LA-3.16` Resubmission & attempts
19. `LA-3.3` AI assistant — *needs 3.2 done, and the provider question answered*

**Then the tidying**
20. `LA-3.17` Settings hub · `LA-3.20` Welcome pack · `LA-3.22` Portal register · `LA-3.23` Stage sync

**Then growth**
21. `LA-3.21` Reports · `LA-3.24` Spouse applications · `LA-3.25` Term life

---

## 14. The five ways this could go wrong

Straight from the module doc's own risk list.

1. **The AI will be believed.** It has no real carrier data behind it, and agents will treat its
   suggestions as facts. → never phrase as a decision, mark visibly as a suggestion, log everything.
2. **Field maps decay silently.** A carrier changes one box's name and that field quietly stops
   filling. → monitor the fill rate per map, alert when it drops.
3. **The policy number gets skipped.** It happens at the end of a long call when Ray wants to move
   on. → prompt while the confirmation is still on screen, and a chase list that doesn't go away.
4. **Our record and the carrier's drift apart.** He fixes something in their portal and our copy is
   now wrong. → corrections flow back; where they can't, mark our record unverified after submission.
5. **Two application flows get built.** The easiest failure of all: inbound gets one, outbound gets
   another, and six months later they behave differently. → one entry point, and a test that
   exercises it from both.

---

## 15. If you remember only five things

1. **Module 3 is the sale.** Modules 1 and 2 just get someone on the phone. Build the sale **once**,
   shared by both.
2. **The policy number is everything.** It's how every future pound of commission finds its way back
   to the right sale. Miss it and the policy is invisible until it lapses.
3. **The draft date is the cleverest feature.** Take the money after her Social Security arrives,
   not before, and a huge share of lapses simply stop happening.
4. **The AI builds the map once; a lookup table fills the form a thousand times.** That split is the
   difference between a demo and a product.
5. **Almost every hard rule exists because the alternative fails in front of a customer.** Stale
   prices, confident-but-wrong AI, a guessed bank number, a policy number in a notebook. That's the
   thread running through all 26 tasks.

# LA-3 demo: setup, script and demo data

How to present LA-3 (the application flow) in a meeting. Rehearsed live on 2026-09-30 on the
demo agency **LA-1.25 Alert Demo**, signed in as the demo agent. It takes about 12–15 minutes.

**The one-line pitch:** "LA-3 turns a verified caller into a submitted application, and the
system does the checking, so an agent can't skip a step or submit something the carrier will
bounce."

---

## Part 1 · The day before: setup (about 20 minutes)

Do these in order. Each one removes a rough edge that showed up in the rehearsal.

### 1. Agent phone number (or the welcome pack is held)
- **Profile** (avatar, top right) → **Phone** → enter the demo phone number → Save.
- **Why:** the welcome pack never goes out without the agent's phone number. In the rehearsal it was
  held with: *"the statement descriptor, your phone number are missing"*.

### 2. Carrier facts for American National
- **Settings → Sales → Carriers and products** → select **American National**.

| Field | Value |
|---|---|
| Portal origin | `https://agents.americannational.com` |
| Billing descriptor | `AMERICAN NATL INS` |
| Reference pattern | leave blank, or `^AN-` |

- Also open the carrier's **portal** panel and set the **Portal URL**:
  `agents.americannational.com/login`
- **Why:**
  - The billing descriptor is the second item the welcome pack was missing.
  - The portal URL enables the **Open portal** button, which was greyed out ("Choose a carrier with
    a portal address first").

### 3. An Arizona appointment for American National
- **Book of Business → Carrier appointments** (or **Settings → States & licences**). Add
  **American National · AZ · Active**.
- **Why:** this clears the only QA warning about the carrier: *"No state on file to check the
  American National appointment against."*

### 4. Check the Welcome pack settings
- **Settings → Sales → Welcome pack**: make sure it is on and sends **on submit**.
- **Settings → Sales → Quote & QA rules**: leave the defaults.
- **Note:** email delivery is **disabled** in this environment, and the demo addresses use
  reserved test domains. **No real email is sent.** The pack is still generated (PDF and email
  text) and logged, which is what you show.

### 5. A fresh inbound lead to work
Last rehearsal's case is already submitted, so start from a new lead. Pick one:
- **Option A (easiest):** ask Claude to re-queue the demo inbound leads. It runs:
  ```bash
  node --env-file=.env.local scripts/seed-qa-inbound.mjs --refresh-live
  ```
  This re-queues the live transfers and re-claims the live work items for the demo agent. Run it
  **within an hour of the meeting**, because the SLA ladder expires unclaimed transfers.
- **Option B:** on **Agent Floor**, claim any waiting inbound transfer, or use a lead the demo agent
  is already holding ("On a call now" → **Open lead**). *Agent Floor Demo 2* and *4* were used in
  rehearsals and are now closed; *test1 test* and *Qam1a Lead1* are still open.

On the lead page, click **Verification** (or **Start application** to skip straight to the case).

### 6. Machine and browser
- The database is on Supabase **NANO** compute, so saves take 3–8 seconds. If you can, **upgrade
  to Micro** for the day (Supabase → Project settings → Compute). Otherwise talk while it saves.
- Make sure the dev server is running at `http://localhost:3000`.
- Use **one** browser window, zoomed to 100%, dark theme, other tabs closed.
- Sign in as the demo agent (**demo.agent@insurvas.test**). The password is in your password
  manager or seed notes, not in this file.
- Turn off notifications on your computer.

### 7. Rehearse once, end to end
Use the demo data in Part 3. Then leave the rehearsal case at **Pending carrier**: it's a ready
fallback if anything goes wrong live (see Part 4).

---

## Part 2 · The meeting: click by click

Keep the **Pre-submission QA rail** (right side of the case) visible the whole time. It updates
live and is the most convincing part of the demo.

### Scene 0 · Where LA-3 lives (30 s)
- **Click:** the sidebar **Applications** heading. Show its four items: **Applications, Pending
  cases, Draft dates, Sales performance**.
- **Say:** "Inbound and Outbound bring the caller in. Applications is where the sale happens."

### Scene 1 · The case list (30 s)
- **Click:** **Applications**.
- **Say:** "Every open case, with its status. Anything waiting on the carrier is in Pending
  cases, and upcoming drafts are in Draft dates."

### Scene 2 · From the call into the case (1 min)
- **Click:** Agent Floor → **Open lead** → **Verification**. Confirm each field (**Confirm**), or
  fix it (**Save correction**), until it says *6 of 6 required fields confirmed*. Then click
  **Continue to underwriting**.
- **Good story:** demo leads often arrive with a wrong date of birth from the partner. Correct it
  live: "the partner sent it wrong, and the correction is logged in the change history".
- **Say:** "The lead from the call carries straight in. Nobody retypes the name, date of birth,
  phone or state." Point at the steps on the left: Verify → Interview → Quote → Application →
  Beneficiaries → Payment → Disclosures → Review → Submit → After submit.

### Scene 3 · Interview (1.5 min)
- **Click:** answer the questions using the Interview data in Part 3. Make sure you answer
  **Q1 "When does your Social Security arrive?" = 3rd Wednesday** (Payment picks it up later) and
  **Q4 "Do you have any life insurance now?" = Yes**.
- **Say:** "Questions only show if they apply to this client's age, state and product. And the
  answers drive what comes later: because they have coverage now, a replacement disclosure will
  be required." Finish with **Interview complete**.

### Scene 4 · Quote (2 min)
- **Click:** **Add quote** twice (Aetna/CVS and American National; see Part 3), then **select
  American National**.
- **Say:**
  - "Quotes side by side, from the agency's own carriers and products."
  - Point at the commission card: "The agent sees what they earn, and only the agent sees it.
    We don't pretend to rank carriers for the client."
  - "If a quote is too old, it's flagged as expired."
- **Optional:** **Print** the comparison to show the client-facing version.

### Scene 5 · Application (1.5 min)
- **Click:** fill in the address, birth state, height and weight, then the SSN.
- **Say:**
  - "Everything we already knew is prefilled, and flagged as 'filled in for you' so the agent
    confirms it with the client."
  - After saving the SSN: "It's masked straight away. If someone presses Reveal, that's recorded.
    You'll see it in the timeline at the end."
- **Watch:** the QA rail's "must be fixed" count dropping as you go.

### Scene 6 · Beneficiaries (1 min)
- **Click:** **Add beneficiary** → Maria (spouse). **Add beneficiary** → Luis (child). Then
  **Split evenly**.
- **Say:** "Primary shares have to total exactly 100.00 per cent, or the step won't let you go
  on. Split evenly does the maths."

### Scene 7 · Payment: the highlight (2 min)
- **Click:** **ACH** → bank name, routing and account numbers, account type, name on the account.
  Then **Income type = Social Security / SSDI**.
- **Say:**
  - "The routing number is checksum-checked as you type. A wrong one is refused right there,
    not by the carrier three days later."
  - "The account number is masked once saved. **CVV is never stored**, ever."
  - Then the draft-date panel: "This client gets Social Security on the third Wednesday, so it
    recommends drafting on the **24th**, so the money is always in the account first. It even
    gives the agent the exact words to say, and shows the next twelve payment dates."
  - "Alternates are offered, and an override is allowed but logged."
- **This is the scene to slow down on.** Failed first drafts are where agencies lose policies.

### Scene 8 · Disclosures (1 min)
- **Click:** **Continue to Disclosures** → read a line of the replacement notice → **Read
  aloud**.
- **Say:** "This notice is here because they said they already have coverage. Each
  acknowledgement is stamped with who, when, how (read aloud, emailed or mailed) and which
  version of the text."

### Scene 9 · Review (1 min)
- **Click:** **Continue to Review**. The page shows "Pass with N warnings / Must fix 0". Then
  **Mark ready to submit**.
- **Say:** "Nothing blocks it, so it can be marked ready. Warnings are worth a look but don't
  stop the sale. The QA verdict is frozen at this moment, so you can always prove what was
  checked before submit." The status chip changes from **Draft** to **Ready to submit**.

### Scene 10 · Submit (2 min)
- **Click:**
  1. Show **Copy-assist**: every field in the carrier's own format; click a **Copy**.
  2. Say "the agent submits on the carrier's own site", then click **Capture submission**.
  3. In **Record the submission**: carrier reference number, **Reference type = Application
     number**, then paste the confirmation screenshot (**Ctrl+V**).
  4. Click **Record submission**.
- **Say:** "The agent files on the carrier's real site. Copy-assist (or our browser extension)
  fills it. Then they capture the reference and the confirmation screen. It's stored privately,
  behind signed links. And the welcome pack goes out on its own." The status changes to
  **Submitted**.

### Scene 11 · After submit (1.5 min)
- **Click:** **Add requirement** → *Phone health interview*, waiting on *Client*, description
  from Part 3 → **Add requirement**. The status becomes **Pending carrier**.
- **Click:** **Pending cases** in the sidebar and show it listed there. Go back and click
  **Satisfied**.
- **Say:** "When the carrier asks for something, it's tracked with an owner and an age, it goes
  amber after 5 days and red after 10, and it can be chased."

### Scene 12 · The ending: Issued (1 min)
- **Click:** **Outcome = Issued** → **Record outcome**.
- **Say:** "Issued. The lead's pipeline card moves by itself."
- **Then click:** **Sales performance**. "And it's counted: the funnel, how long each step took,
  and why carriers decline."

### Scene 13 · Case timeline (30 s)
- **Click:** **Case timeline**.
- **Say:** "Every step, who did it, and when. That includes the SSN reveal and the disclosure
  acknowledgement. This is what compliance asks for."

---

## Part 3 · Demo data (type exactly this)

All values are **made up** for the demo. They are not real people or accounts.

### Client (prefilled from the lead; confirm, don't retype)
| Field | Value |
|---|---|
| Name | the lead's name (rehearsal: *Agent Floor Demo 2*) |
| Date of birth | `04/12/1968` (age 58) |
| Gender | Male |
| State | AZ |

### Interview
| Question | Answer |
|---|---|
| Tobacco in the last 12 months | No |
| Do you have any life insurance now? | **Yes** (this triggers the replacement notice) |
| Height | 70 in (5′10″) |
| Weight | 185 lb |
| Health questions (heart, cancer, diabetes, hospital stays…) | No |
| Anything not required | can be skipped; show "nothing required left" |

### Quotes (Quote step → Add quote)
| Carrier | Product | Face amount | Term | Monthly premium |
|---|---|---|---|---|
| Aetna / CVS | Term Life | $250,000 | 20 years | `$42.10` |
| American National | Term Life | $250,000 | 20 years | `$44.00` (**select this one**) |

**Story:** "Slightly dearer, but this agency is appointed with American National and the client
qualifies."

### Application
| Field | Value |
|---|---|
| Street | `418 W Roosevelt St` |
| City | `Phoenix` |
| State | AZ |
| ZIP | `85003` |
| Birth state | AZ |
| SSN | `123-45-8841` (made up; shows as `•••-••-8841`) |

### Beneficiaries
| # | First | Last | Relationship | Tier | Share |
|---|---|---|---|---|---|
| 1 | Maria | Demo | Spouse | Primary | 50.00 |
| 2 | Luis | Demo | Child | Primary | 50.00 |

Press **Split evenly** rather than typing the shares.

### Payment (ACH)
| Field | Value |
|---|---|
| Bank name | `Chase` |
| Routing number | `021000021` (a public, checksum-valid test routing number) |
| Account number | `000123456789` |
| Account type | Checking |
| Name on the account | the client's name |
| Income type | Social Security / SSDI |
| Draft day | accept the recommendation (**24th**) |

**Optional extra:** type a wrong routing number first (`021000022`) and press **Tab**. The error
*"That is not a valid 9-digit routing number"* only appears once you leave the field, and the card
says *"Not saved — fix the field marked in red"*. Then correct it to `021000021`.

### Submit
| Field | Value |
|---|---|
| Carrier reference number | `AN-2026-1001-4471` (anything that starts `AN-`) |
| Reference type | Application number |
| Confirmation screenshot | a screenshot or PNG of a fake "Application received" page; paste with Ctrl+V |

### After submit
| Field | Value |
|---|---|
| Requirement kind | Phone health interview |
| Waiting on | Client |
| Description | `Carrier needs a 15-minute phone health interview before underwriting` |
| Outcome (finale) | Issued |
| Policy number | `ANL-7730041` (any value; without one the case waits on *Awaiting policy number*) |

---

## Part 4 · If something goes wrong live

| Problem | What to do |
|---|---|
| A save spins for a while | Keep talking. It's the small database, not the app. Saves land within about 10 s. |
| The lead didn't appear | Open the rehearsal case from **Applications** (status *Pending carrier*) and present the remaining scenes from there. |
| "Open portal" is greyed out | Part 1 step 2 was skipped. Say "this opens the carrier's own site" and move on to Copy-assist. |
| The welcome pack says "held" | Part 1 steps 1–2 were skipped. Say "it refuses to send a pack with a blank phone number or bank-statement name. That's deliberate." |
| The copy counter stays at 0 | Only happens with scripted clicks. A real mouse click counts it (checked: 1 of 32). |
| Someone asks about AI autofill | "That's the next phase. The provider decision is being made." (LA-3.3 and the AI half of 3.13 are intentionally not built yet.) |
| Someone asks about the browser extension | "It works today, and goes on the Chrome Web Store next." |
| Someone asks about bounced emails | "Delivery failures are logged now. Automatic bounce handling comes with the email provider we pick." |

---

## Part 5 · Questions to expect

- **"Can the agent skip QA?"** No. "Must fix" items block **Mark ready**, and the verdict at
  submit is frozen and kept.
- **"Where's the card data?"** Card and bank numbers are encrypted and masked, and every reveal is
  logged. The CVV is never stored at all.
- **"What if the carrier counter-offers?"** Record **Outcome = Counteroffer** and the case tracks
  it. If it's declined, a **New attempt** with another carrier starts from the same answers.
- **"Couples?"** **Add spouse** creates a linked household case. Shared fields (address, payment,
  draft day) follow the primary, and can be detached.
- **"Who sees commissions?"** Only the agent on the case.

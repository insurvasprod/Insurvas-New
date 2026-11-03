# Insurvas test CRM: visual and workflow observations

Observed 2026-11-03 in the user-provided signed-in localhost test account. This is research for the landing page. The running server's checkout could not be confirmed from the sandbox, so these observations identify the visible application, not a verified deployment or Git commit. No real customer details are included here.

## What was visible

| Area | What the browser showed | What it suggests for the landing page |
|---|---|---|
| Home | A live workspace with setup progress, today’s figures, calls, schedule, money and retention, and shortcuts. Most values were empty in this account. | A workday has several roles and jobs; the site should show the product helping a person act, not merely decorate a dashboard. |
| Inbound | A five-step path: incoming calls, caller profile, verification, application, finish the call. The user was not taking calls and nobody was waiting. An existing test call was available. | A call has recognizable moments and a human handoff. The story can focus on one moment rather than compressing the entire system into the hero. |
| Existing test call | The finish screen offered different outcomes including application submitted, sent to underwriting, callback, not interested, do not call, dropped call, no answer, and voicemail. Submission and underwriting options indicated verification was required. No outcome was selected. | The real story branches: not every conversation becomes a sale. Show the agent's choice and the next action accurately. |
| Leads | Pipeline tabs and a choice of stages, board, table, and list views. The selected board showed New, Contacted, Submitted, Issued, and Declined columns with no records. | Submitted and issued are distinct; pipeline stages can explain the work without pretending every lead follows a happy path. |
| Source / campaigns | A lead-flow navigation bar: Source, Import, Review, Clean, Recycle. No vendors or campaigns were present; creating a campaign was disabled until a vendor exists. | The source story is broader than a floating cost tag. An agency obtains, reviews, cleans and works leads. The specific screens need populated examples before illustrating their details. |
| Dialer | Priority filters, Check a Number, Auto-Next, Serve Next Lead, a campaign filter, outcome and notes areas. The queue was empty. | A useful product moment could be the transition from a lead to an action, but calling checks, queue behavior, and live calls were not exercised. |
| Applications | Cases, Waiting on the Carrier and Quotes tabs. Status choices included Draft, Ready to submit, Submitted, Pending carrier, Counteroffer, Issued and other closed outcomes. No applications existed. | The important story is the difference between an application being prepared, sent, and actually issued. Do not depict issuance immediately after a call. |
| Statements | Statements, Commission ledger, Discrepancies, and Rate card. The page says a carrier statement can be imported as CSV, Excel or PDF. No statement was imported. | The financial story has real review steps and exceptions; do not imply that every payment is automatically matched without confirming the complete workflow. |
| Policies | The book has Files, Needs you, Policies and Setup. No policies were present in the account. | The product continues after the sale, but there was no policy detail available to visually inspect. |

## Design implications

1. **The story should have a person making a decision.** The call outcome screen is more specific and human than a generic line moving from lead to policy. A compelling scene could show a conversation ending and the appropriate next step becoming clear, using actual verified UI states.
2. **A lead has more than one possible future.** The landing page can simplify without suggesting that all leads are immediately issued or paid. A short reveal of two or three meaningful outcomes may feel more truthful than a guaranteed linear journey.
3. **Use the actual visual vocabulary.** The dark olive workspace, green actions, compact status labels, real step navigation and calm lists are recognizably part of the product. Marketing can interpret them with better pacing and scale, rather than inventing disconnected dashboard art.
4. **One hero moment, deeper proof later.** A newcomer needs to understand who the product helps and why. One product moment can earn attention; source, application, policy and money details can appear as separate sections further down.
5. **Visual fidelity needs populated examples.** The signed-in account has no campaigns, queued leads, application cases, policies or carrier statements. The layout and empty states were observed; a complete lead-to-commission journey was not. Do not claim the browser proved that complete journey.

## Follow-up material needed

A populated test agency or approved synthetic sample records would allow inspection of the active transfer, caller profile, application, issued policy, campaign cost and statement review together. A walkthrough or representative screenshots from a real workflow can also help, with sensitive information removed. The test account given for this pass remains useful for its existing navigation and empty states.

## Small sample dataset added

- Vendor **Demo Northstar Leads** and draft campaign **Demo Final Expense**, marked **Test Batch**: $360 spend and 12 records purchased in the campaign form. No list has been imported and the campaign is not live.
- Lead **Demo Alex Morgan**, added by hand using fictional details and a reserved 555 phone number. The lead detail displays its source as **Direct / Entered by hand**, with no campaign or cost. It is a separate record from the sample policy below.
- Manually entered policy **DEMO-LANDING-001**, also named **Demo Alex Morgan**, with a fictional carrier and product and $840 annual premium. The policy detail explicitly shows its source as **Unattributed**. Its commission tab says the fictional carrier is not in the carrier library, no expected commission exists and no accepted statement line pays the policy. Matching names do not establish a link.

These records populate real UI states but do not establish an end-to-end attribution chain. The lead form used the active Term Life template, while the draft campaign and manual policy are Final Expense; they should be treated as independent samples. The statement import requires a file and carrier selection; no statement was imported and no real call was placed. The lead-to-campaign linkage, an application, and a commission statement remain unobserved in a populated state.

The populated lead workspace offers a useful idea: its source, verification state, ownership, attempts and next action sit alongside a practical checklist asking whether the customer can finish and sign on the call. The policy's commission view separates **what the contract expects** from **what the carrier reported**, giving the marketing story a concrete question without inventing a result.

## Lead file experiment

On the draft test campaign, the importer accepted `demo-final-expense-leads.csv` for preview: three fictional rows and seven columns, including all three required fields, were mapped automatically. The screen described the next step as checking Do Not Call, litigators, duplicates and phone numbers before opening Review, and explicitly said nothing had been written yet. The review check did not visibly complete during this session, so these three rows are **not verified as imported leads**. The selected campaign remained a draft. No dialing or messages were initiated.

This is a useful storytelling moment in its own right: a vendor's list becomes recognizable fields, then the agency checks the list before putting it to work. A landing-page animation could move from a small, legible file into named fields and a review decision, keeping the campaign and its status in view. The animation should stop short of suggesting the checks or import succeeded until that outcome is verified.

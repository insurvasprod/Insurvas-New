# Workflow story evidence — 3 November 2026

Research for the landing page, not a design approval or a claim that all stages were tested end to end. The manager asked for a story a newcomer could understand, with each section's graphic explaining a part of it. Existing homepage copy is preserved separately.

## A simple story to test

An insurance agency starts with a list of people it might help. It needs to know where the list came from and check it before work begins. An agent speaks with someone, records what happened and decides what comes next. If the person applies, the application can be prepared and tracked while the carrier makes its decision. If a policy is issued, it becomes part of the agency's book. Later, the agency can look at what the carrier reported and what the contract expects.

This is a comprehension narrative, not a claim that every lead is called, every application is issued, or each record is automatically linked and reconciled. A person may need a callback, decline, or never answer.

## Evidence and possible visual moments

| Moment | Evidence | Visual opportunity | Limit |
|---|---|---|---|
| A list becomes usable information | Browser: the draft campaign import preview mapped all seven sample CSV columns and said checks precede review. | A file resolves into a few readable fields, then a review decision. | Check stayed pending; no successful import or review was verified. |
| A conversation leads to a next step | Browser: the test call offered outcomes including callback, no answer, underwriting and submitted. | A single lead record opens into a small set of meaningful outcomes, with the chosen next action kept in view. | No call was placed or outcome recorded. |
| Work can happen outside the dialer | Source: `components/app/deal-flow-workspace.tsx` describes a manual deal update and fields including customer, product, date, carrier and premium. | Show one person's work as a real record instead of an abstract counter. | Source inspection only; a populated deal update was not verified in the browser. |
| An application has stages | Browser: application list distinguished draft, submitted, pending carrier and issued. Source: `components/app/applications/workspace/application-workspace.tsx` groups review and submit and gates the after-submission stage. | One carefully paced transition from preparation to waiting on the carrier. | No populated application or actual submission was verified. |
| A policy and its money are different records | Browser: the sample policy showed source as Unattributed; its commission tab separated contract expectations from carrier reports and had no accepted statement lines. | Place the two questions side by side: “What should we receive?” and “What did the carrier report?” | The fictional carrier has no rate card; there was no matched statement. Do not invent an amount or resolution. |

## Priority for further observation

1. Resolve the pending import check, then inspect review and confirm whether any rows were actually imported.
2. Create and inspect a small fictional deal or draft application in the test account, if the app becomes responsive.
3. Inspect statement review with an explicitly fictional sample and a library carrier, without implying the existing fictional policy is linked.
4. Use those results to select one coherent story for a later visual mockup. The current samples do not prove one connected journey.

During this pass the import still displayed “Checking…” and navigation to Daily deal flow timed out. Browser access to the page then stopped responding. No new CRM record was confirmed during this pass.

## Follow-up: populated deal and statement preview

Daily deal flow became available. A manually entered fictional deal, **Demo Jamie Parker**, was saved with a $70 monthly premium and $15,000 face amount. Its row showed **New lead** and $840 annualised; its detail showed the quote, carrier, owner, next action and a submission timeline. It showed no campaign or partner, and no call outcome. The manual deal created a lead link; it is not verified as connected to the earlier uploaded CSV or sample policy.

The detail suggests a stronger visual subject than a generic dashboard: keep a person's record anchored while a quote, decision and next action come into focus. Show the status honestly, without turning the quote into an issued policy.

A two-line fictional commission CSV was prepared separately and selected for the existing test carrier **LA14 Market 1790707977690**. The statement wizard recognized the policy, amount, transaction type, paid date and insured columns. Its preview showed two readable lines totalling $126, zero proposed matches and two policies not found in the book. The UI said nothing posts to the ledger until a person accepts a match. Import for review was started but remained on “Importing…” during this pass; a saved statement is not verified. These sample policy numbers are distinct from the earlier manually entered policy.

The new deal's lead detail showed **Direct lead**, screening pending, verification not started, zero attempts and no next action. Its verification tab also said verification had not started. No application entry was visible for this lead; no draft application was created. The source of the application entry says starting one requires an eligible work item, but that condition has not been tested here.

## Statement review follow-up

The earlier statement import ultimately completed: the statement review showed two waiting lines and zero accepted. A separate fictional policy, **DEMO-STATEMENT-001 / Demo Morgan Sample**, was added by hand under the same test carrier for $840 annual premium. Re-Match proposed the first line based on matching number and carrier; accepting it posted $84 to the test ledger. The policy commissions page then showed **Carrier paid $84**, with a link back to the statement row. Its demo product is not in the rate card, so no expected commission was available. The second statement line remains unmatched. This verifies a policy-to-statement link, not a complete lead-to-policy journey.

The existing test call's Application step was opened, but remained at “Opening the application…” during this pass. No completed application workflow or submission is verified.

## Application and source reporting follow-up

The test call eventually created a **draft** case, which appeared in Applications and opened in the application workspace. The workspace has Verify, Interview, Quote, Application, Beneficiaries, Payment, Disclosures, Review, Submit and After submit steps. The interview displayed required questions and a remaining-work count. The quote step said the agent types premiums from a carrier's own tool, chooses a quote and can print a client comparison. It displayed no quote for this case. The draft was not submitted. These observations supersede the earlier note that the application workspace had not opened.

True CPA showed the demo vendor's test batch: 12 bought, zero received or issued, and a dash for cost per issued policy. The report explicitly explains that a dash means no issued policy yet, not zero cost. Its drop-off view distinguishes bought, dialable, dialled, contacted, quoted, applied and issued; its comparison offers contact rate, issued conversion and cost per issued policy. This makes a promising storytelling structure: a source's journey is a series of human-readable questions and real exceptions, not a decorative graph or a claim that all leads become policies. The sample campaign's entered spend and purchased count are fictional; do not present them as performance proof.

# Production CRM workflow observations — 3 November 2026

This is a read-only continuation of the landing-page research. It records visible workflow structure and design opportunities, not proof that the production account's mixed test records describe a real agency's performance. No records or settings were changed. The application draft was navigated through steps for inspection only; no applicant details were edited, and the draft was not submitted.

## What the CRM makes tangible

### 1. A lead has a traceable work history

The Lead Workspace can be viewed as a board, table, list, or stages. Stage columns include New, Contacted, Submitted, Issued, and Declined. A record preview separates the submitted form from a timeline of events. The Daily Deal Flow table adds campaign, vendor, state, status, owner, annualized premium, and a route back to the lead. A lead can still be unclaimed or have no campaign; the interface exposes these gaps rather than implying a complete sale.

**Story opportunity:** “A name comes in. The agency can see where it came from, who owns it, what happened, and what still needs doing.” Use one fictional record with a short event trail. Do not imply that assignment, calls, applications, or sales happen automatically.

### 2. Import is an operations workflow, not just file upload

The Lead Flow area exposes Source, Import, Review, Clean, and Recycle. Campaign rows show a next step, such as adding a list, and the cleanup workspace calls out missing data that affects whether leads can be contacted. Duplicate review and recycle cadence are distinct jobs.

**Story opportunity:** Let a list resolve from a file into a few legible lead records, then show a human review or cleanup choice. A quiet motion cue can reveal where a bad or incomplete row needs attention. The account currently has no usable imported list for the demo campaign, so a polished mockup must use clearly labeled sample data rather than present this account as a successful import.

### 3. The call queue and application are staged around human decisions

Inbound is a live queue with an explicit “taking calls” status, caller profile, verification, application, and finish-the-call phases. An uncompleted call can remain in the agent's open-call list. Application attempts have their own visible steps. In the inspected draft, the quote step had no carrier options; the application record marked imported values for confirmation; the beneficiary and payment steps required decisions; and Review grouped hard blockers apart from softer checks, with links back to the relevant step. Submission remained unavailable.

**Story opportunity:** Animate a human decision changing the next task. Show a value arriving with a “needs confirmation” marker, then settling only after an agent verifies it. Keep health, identity, payment, and other private fields out of marketing visuals. Do not present a draft or quote as an issued policy.

### 4. Carrier files are a second source of evidence

Book of Business has separate views for Files, Needs You, Policies, and Setup. File intake can arrive by upload, email, or script and carries a processing stage. Needs You describes carrier decisions waiting for a person. Setup ties carrier rate cards and rules to whether policies can be priced. The account had no actual carrier file on the Files screen and had incomplete carrier/rate setup, so the demo state is not representative of a configured agency.

**Story opportunity:** Use a carrier-file “arrival → review → matched record” handoff as a genuine transition, with clear provenance. Do not suggest that every file is matched without review.

### 5. Reported money and expected money are different questions

The sample commission workflow already documented in `workflow-story-evidence-2026-11-03.md` demonstrated an accepted statement line linked to a fictional policy; its rate-card gap meant the expected commission was unavailable. The accounting page likewise distinguishes carrier-reported commission, acquisition cost, overhead, cash/accrual basis, and per-issued-policy cost. True CPA follows Bought → Dialable → Dialled → Contacted → Quoted → Applied → Issued and explicitly explains that a dash for CPA means no issued policy yet, not zero cost. It also distinguishes leads dialled from dial attempts and exposes contact-rate, speed-to-lead, and consent-proof views when relevant data exists.

**Story opportunity:** This is the strongest product-specific visual: two narrow trails—“what we expected” and “what the carrier reported”—meet at one policy. A discrepancy can become a meaningful pause and review action. Counts should move only when backed by real relationships; a missing result stays blank or marked unavailable, never a fabricated zero. The prior demo line proves only a policy-to-statement relationship, not one connected lead-to-policy journey.

## Product-aware art and motion direction

- Give the page one central object: a readable insurance case record with its source and event history. Let it open into a handful of neighboring CRM details as the reader scrolls; avoid a gallery of disconnected dashboard cards.
- Use restrained, event-driven motion: a source label attaches to a lead; an agent action leaves a dated event; a policy and carrier statement line resolve into a visible match. Each movement should explain a relationship or decision. Avoid perpetual floating, generic glow, and charts that merely animate for decoration.
- Keep the established olive/green brand cues, typography, and real component shapes, but art-direct the marketing composition separately from the internal sidebar-and-table layout. Product screenshots can supply authentic details; they should not be assembled into a fake live dashboard.
- Show sample labels beside every synthetic name, record, amount, or performance figure. The current production account shares test data with localhost and also contains other workspace records; its current metrics are not suitable marketing proof.
- Preserve uncertainty as part of the story: “needs review,” “waiting on the carrier,” or “no issued policy yet” is more credible than a forced success arc.

## Evidence boundary and next research step

Observed directly in the production browser on 3 November 2026: lead workspace and preview, lead-source campaign area, duplicate cleanup, nurture/recycle, daily deal flow, inbound status, book-of-business file and needs-you views, carrier setup, accounting overview, reports/True CPA, compliance overview, dashboard, and application beneficiary/payment/review steps. Several screens are sparse, and a number of dashboards expose empty states. Earlier notes record the statement import and fictional policy match in greater detail.

The remaining useful exploration is a targeted look at the expected-commission ledger and discrepancy queue, plus one existing call outcome if the account has a safe, clearly synthetic example. Do not alter this shared production account to manufacture proof. For the next visual iteration, use an explicitly marked illustrative case and label unverified joins as illustrative rather than claiming an observed end-to-end conversion.

## Follow-up: policy and retention surfaces

The policy book keeps source as a first-class field (carrier file, hand-entered, or a recorded sale awaiting a file), and distinguishes the agency's status from the carrier's own status wording. Its table includes premium, face amount, late days, risk, issue date, and agent. The inspected records are hand-entered examples, not carrier-file-confirmed policies.

Retention work starts only after carrier policy files have been received and scored. The Save Queue ranks cases by risk × money by default and can sort by risk, advance at risk, time to next draft, or months since issue. Lapse-risk cases can be triggered by a missed or bounced draft, a carrier conservation notice, cancellation request, recent lapse still eligible for reinstatement, or a paper bill that could be converted. Servicing requests cover changes such as payment date, bank/card details, paper-bill conversion, and address; the UI has separate states for requests not present in a carrier file and verified requests. Reinstatement cases open from a carrier-file lapse only within a configured carrier window.

The retention scorecard and “Does it work?” screen try to measure both the team's work and whether the risk predictions were right. The latter checks a prediction 90 days later on policies nobody worked and exposes a holdout setting; its copy says an emergency is never withheld. In this account the score queue, reinstatement queue, and outcome sample are empty, so these are observed workflow descriptions rather than demonstrated results.

**Story opportunity:** Extend the narrative beyond “policy issued.” The CRM is designed to keep watching carrier evidence, identify a policy that may need help, and track whether a person worked it and what happened. This can support a second, quieter post-sale chapter. Avoid portraying the scoring as a proven prediction or promising saved policies until a sufficiently populated, verified result exists.

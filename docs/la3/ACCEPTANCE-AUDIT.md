# LA-3 acceptance audit

Audited 2026-09-29 against `docs/la3/ACCEPTANCE.md`, criterion by criterion, with `STATUS-MODEL.md`,
`SCHEMA-PLAN.md` (decisions log) and `ROUTES.md`. Out of scope: 3.3 (AI assistant — blocked on
decision 4), the AI-proposal half of 3.13, and Chrome Web Store publishing.

**Statuses.** MET — code meets it and a test proves it, or the code was verified by reading (said so).
MET-UNTESTED — the code clearly meets it and no test exists (only used where the logic is not pure; pure
logic got a test in this pass). PARTIAL — part of it is met; the gap is named. NOT MET — it is not built.

**Tests** named below live in `lib/**/*.test.mjs`. `acceptanceAudit` is the new
`lib/applications/acceptanceAudit.test.mjs` (37 tests, written in this pass). Line numbers are as of
this pass.

**Live data** (read-only probe, demo tenant `d6f3950f…`, case `bb743a05…`, attempt `e898611c…`,
closed/withdrawn): the SSN row stores `value = null`, a ciphertext starting `a1.` and a 4-digit
last-four (`key_version 1`); one `tenant_sensitive_access_log` row for one reveal; the disclosure
acknowledgement carries `method = read_aloud` and `acknowledged_at`; the submission carries its
reference, kind, method and the frozen verdict. Two findings: the attempt's `phone_interview`
requirement is still `open` although the attempt was closed (it was closed at 08:44, before the
close-waives-requirements fix — a one-off data fix, user decision); and its quote's `rating_inputs`
is `{}` (saved before rating inputs were sent — now impossible, see 3.5). `mv_la3_funnel` reports 0
submitted for September against 2 live — the materialised views were never refreshed (3.21).

---

## 3.1 Underwriting question templates

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| Create / edit needs no deploy | MET | Templates are rows in `sales_templates` (`20260926100100`), edited through `lib/salesSettings/templates.ts:134` (create), `:153` (save). | — |
| Editing a live template doesn't change an interview in progress | MET | Published rows immutable (trigger in `20260926100100`); an edit of a published row inserts version N+1 (`templates.ts:172-181`). The interview stores `sales_template_id` + `template_version` (`mutations.ts:326` `ensureInterview`) and is read by id (`service.ts` interview views). Verified by reading. | — |
| Knockout visible the moment it's given | MET | `question-input.tsx:174,184-189` (agent A), recomputed per answer. | — |
| Follow-ups appear/disappear without reload; hidden answers not stored | MET | Client: `interview-form.tsx:20-34` (`isVisible`, `pruneHidden`). Server: **now also decides** — `saveAnswers` (`mutations.ts:342`) merges stored + new answers, runs `hiddenAnswerKeys` (`templates.ts`) from the interview's own template, and deletes every hidden answer, not only those the client named. Test: `acceptanceAudit` "3.1: the server finds hidden follow-up answers…". | **Fixed** (server enforcement; before, the server trusted the client's `hidden` list) |
| Five persistency questions in every seeded template | MET | Seeds in `20260926100100`; test `salesTemplates` "3.1: the five persistency questions are on both seeded underwriting templates and cannot be removed". Live: both platform underwriting templates published. | — |
| Preview matches the interview exactly | MET | Preview renders `InterviewQuestionList` (`templates-preview.tsx:40`) from `interviewQuestions()`; test `salesTemplates` "3.1: preview == interview — the builder's round trip…". | — |
| Question types, sections, ordering, required, duplicate | MET | Test `salesTemplates` "3.1: every question type the task names is accepted…"; duplicate `copySalesTemplate` (`templates.ts:219`), button `underwriting.tsx:189`. | — |

## 3.2 Interview & medications

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| Interrupted interview resumes with every answer (autosave) | MET | Debounced PUT `context.tsx:109,231-261`; answers read back in the case view (`service.ts` `interviewViews`). Verified by reading. | — |
| Knockout impossible to miss | MET | `question-input.tsx:207` (red rule + surface), chip ring `:45`. QA also warns (`qa.ts` `QA_KNOCKOUT`). | — |
| Medications are rows with named fields | MET | `tenant_medications` (`20260926100200`), written by `saveMedications` (`mutations.ts:395`). | — |
| Free entry; "prescribed for" Unknown prompts the agent | MET | `medication-table.tsx:74-85` (plain input + datalist), `:95-109` ("Ask what it was prescribed for"); `prescribed_for_unknown` column + CHECK. | — |
| Amending after the call leaves an audit trail | MET | Answers: `tenant_uw_answer_changes` rows before the change (`mutations.ts:342`), **now also for removed (hidden) answers, and the save fails if the record can't be written**. Medications: **now recorded** as one change row (`question_key 'medications'`, old and new list) before the list is replaced. Test: `acceptanceAudit` "3.2: amending the medication list after the call leaves an audit row". | **Fixed** (medication amendments were not audited; a failed audit insert was ignored) |
| Renders any template, no template-specific code; progress; notes | MET | `interview-form.tsx`, progress `interview-step.tsx:101`, notes `question-input.tsx:151-155,190-200`. | — |

## 3.4 Quotation templates

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| Create / publish / version; published not editable | MET | `templates.ts:153-202` + immutability trigger (`20260926100100`). Verified by reading. | — |
| Form fields match the template exactly, in order | MET | `quotationFieldsOf`; test `quotes` "3.4: the rendered form's fields match the template exactly, in order". | — |
| Interview-derived values prefilled and marked | MET | `rating-inputs.tsx:64-68` (`PrefillHint`). | — |
| Age matches `age_basis`, shown beside DOB | MET | Test `la3Rules` "3.4: a DOB seven months past…"; `rating-inputs.tsx:81`. | — |
| Saved quote references (template_id, version) | MET | `tenant_quotes.quotation_template_id/template_revision` (`mutations.ts:432`). **Now validated**: the id must be a published (or retired) quotation template the agency can see, at the version named, else 400/409. | **Fixed** (server trusted the client's id/version) |
| Generic FE template in a fresh tenant; no rate tables | MET | Platform row `tenant_id null` (live: "Final Expense — generic", published); test `salesTemplates` "the four platform seeds…". | — |
| *(implied)* the template is chosen per carrier | PARTIAL | Server: `quoteCatalog` (`catalog.ts:51`) **now returns `quotationTemplate` on each carrier** — the carrier's own published template, else the general one (`pickQuotationTemplate`, `lib/quotes/quotationTemplate.ts`). Test: `acceptanceAudit` "3.4: a carrier's own quotation template is chosen…". UI still uses the catalog's top-level template for every carrier. | **Fixed server-side**; UI gap U2 |

## 3.5 Quote capture & comparison

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| Quote saves with all rating inputs frozen as JSON + template version | MET | `saveQuote` (`mutations.ts:432`) **now freezes the row's own facts** (face, tier, DOB, age basis, age used, term length, health class) into `rating_inputs` over what the client sent (`freezeRatingInputs`), so it can never be `{}` again (the live quote was). Test: `acceptanceAudit` "3.5: a saved quote's rating inputs always hold the facts it was rated on". | **Fixed** |
| Premium in cents; $68.40 → 6840; no float | MET | `parseDollarsToCents` (`lib/money.ts:6`), `cents = z.number().int()` (`schemas.ts`), `bigint` columns. Test: `acceptanceAudit` "3.5: $68.40 reads back as exactly 6840 cents…". | Test added |
| Premium ≥ face rejected; out-of-band warns and saves | MET | `checkQuote` (`lib/quotes/math.ts:40`); test `la3Rules` "3.5: premium ≥ face…". **Now the agency's band (Settings › Sales) is used when the product has none** — before, save used the hard-coded 0.5–15. | **Fixed** (3.17 consumer) |
| Comparison renders 2–4 quotes incl. Appointed? | MET | `quote-comparison.tsx:45-54,66`. | — |
| Selecting one discards the rest, none removed | MET | `selectQuote` (`mutations.ts:486`) updates status only. Verified by reading. | — |
| Client view has no per-$1,000 / commission / appointment | MET | Test `quotes` "3.5: the client sheet has no per-$1,000, commission, advance or appointment". | — |

## 3.6 Appointments & payout ranking

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| Appointment CRUD; terminated keeps date, stays in register | MET | Existing LA-2 module (`lib/appointments/eligibility.ts`, tests `appointments/eligibility`, `readiness`). | — |
| No active appointment → Appointed? = No with reason, still saves | MET | `appointed()` in `getCaseView` (`service.ts`), catalog `catalog.ts`; save never checks it. Verified by reading; QA warns (`acceptanceAudit` "3.11: a missing appointment warns by default…"). | — |
| FYC in integer cents: $820.80 / $861.84 / $646.38 | MET | Test `la3Rules` "3.6: $68.40/mo at 105%…". | — |
| Payout strip agent-only, sorted by FYC visibly, fixed line | MET | `payout-strip.tsx:21,30,58-64`; not in the print page. | — |
| Ranking never changes the selected quote | MET | The strip sorts a copy (`payout-strip.tsx:30`); selection is only `selectQuote`. Verified by reading. | — |

## 3.7 Application record & field sets

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| From a selected quote: name, DOB, address, gender, tobacco, face, tier, premium, each with source | MET | Lead prefill `prefillFromLead` (`prefill.ts`) at attempt creation (`service.ts:72`); coverage from the quote (`selectQuote`). **Now the quote's rating inputs (DOB, gender, tobacco, state) also reach the application**, source `quote`, unreviewed, never over a value a person typed, the interview gave or the household shares (`prefillFromQuote`, `QUOTE_MAY_REPLACE`). Test: `acceptanceAudit` "3.7: a selected quote's rating inputs prefill…". | **Fixed** |
| One row per field; new carrier field needs no migration | MET | `tenant_application_values` key/value. A new canonical key is one line in `constants.ts` `CANONICAL_GROUPS` (code, no migration). | — |
| SSN and bank numbers encrypted at rest | MET | `crypto.ts` (AES-256-GCM, per-tenant HKDF, row-bound AAD); live row: ciphertext `a1.…`, `value` null. (No node test: the module is `server-only`.) | — |
| Reveal writes exactly one access-log row; masked by default | MET | `revealField` (`mutations.ts:105`): log row, then audit, then value. Live: 1 row for 1 reveal. Masks `service.ts` (`maskFromLast4`). | — |
| List endpoints contain no SSN or bank values | MET | Test: `acceptanceAudit` "3.7: list reads carry no SSN, bank or card value". | Test added |
| No field set → platform-default FE set | MET | `requiredFor` fallback in `getCaseView` (`service.ts`). Verified by reading. | — |

## 3.8 Beneficiaries

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| 99.99 blocks `ready`, naming the rule | MET | Test `la3Rules` "3.8: primaries totalling 99.99 block…"; `acceptanceAudit` BENEFICIARY_PRIMARY_TOTAL. | — |
| Split evenly 3 → 33.34/33.33/33.33 | MET | Test `la3Rules` "3.8: split evenly…". | — |
| Contingent with no primary rejected; "other" needs text | MET | Tests `la3Rules`, `beneficiaryEntities`. | — |
| Under-18 / estate / >4 primaries warn and save | MET | `checkBeneficiaries` (`beneficiaries.ts:67`); tests `la3Rules`, `beneficiaryEntities`. | — |
| Live running total per tier, green only at 100.00 | MET | `beneficiaries-step.tsx:108,114,121`. | — |
| Survive a resubmission attempt | MET | `open_next_attempt` copies them. Test: `acceptanceAudit` "3.16: attempt N+1 carries…". | Test added |

## 3.9 Draft-date optimiser

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| DOB day 7/15/28 → 2nd/3rd/4th Wed | MET | Test `la3Rules` "3.9: day-of-birth 7…". | — |
| Pre-1997 / SSI-concurrent → the 3rd | MET | Test `la3Rules` "3.9: the pre-1997…". | — |
| SSI on a Sunday 1st → preceding Friday | MET | Test `la3Rules` "3.9: SSI on a month whose 1st is a Sunday…". | — |
| Never past day 28 | MET | Test `la3Rules` "3.9: the recommendation is 2–4 days after the LATEST…". | — |
| 2–4 days after the latest arrival; 12 arrivals viewable | MET | Same test (`arrivals.length === 12`); `draft-date-panel.tsx:267-312`. | — |
| Writes through; each option has a read-aloud reason; override logged | PARTIAL | Server: `saveDraftDay` (`mutations.ts:205`) recomputes with the tenant buffer, requires and audits the override. Every option carries `reason` (`optimiser.ts:165-169`), but the UI shows the alternates' reason only as a hover title (`draft-date-panel.tsx:429`, `draft-date-calculator.tsx:90`). | UI gap U3 |

## 3.10 Disclosures

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| "Yes" to existing coverage → REPLACEMENT_NOTICE required without reload | MET | Server `saveAnswers` → `refreshDisclosures`; client reloads on `existing_*` (`context.tsx:248-249`). Test `editing` ""Yes" to existing coverage makes the replacement notice required". **Now a `ready` attempt that gains a required disclosure goes back to draft** (it stayed `ready` before). | **Fixed** |
| Unacknowledged required disclosure blocks `ready`, naming which | MET | `qa.ts` `QA_DISCLOSURE`; tests `la3Rules` fixture test, `acceptanceAudit` QA_DISCLOSURE. | — |
| Acknowledging records user, timestamp, method | MET | `resolveDisclosure` (`mutations.ts:311`) + CHECK; live row. | — |
| Not applicable without a reason rejected | MET | `mutations.ts:313` + CHECK `not_applicable requires a note`. | — |
| TX/OK scope doesn't trigger for NM | MET | Test `editing` "a TX / OK scoped disclosure does not trigger for NM". | — |
| New version doesn't change the version on an acknowledged application | MET | Library guard `20260926102500`. **Fixed a gap**: `refreshDisclosures` added a new *required* row for the new version beside the acknowledged old one (a second, blocking copy of the same notice). Now a settled code is never re-added; a still-required older version is swapped (`disclosureChanges`, `disclosureRules.ts`). Test: `acceptanceAudit` "3.10: an acknowledged disclosure keeps its version…". | **Fixed** |

## 3.11 Pre-submission QA

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| Each blocking rule has a pass + fail test; routing / SSN cases | MET | Routing/SSN: `la3Rules`. **All 17 blocking codes now have a pass and a fail test** (`acceptanceAudit` "3.11: <CODE> — passes on the clean fixture, blocks when broken…", plus the appointment-blocks setting). Before, only `QA_DISCLOSURE`'s fail case was tested. | Tests added |
| `fail` blocks `ready`; the extension receives nothing | MET | `transition` QA guard (`mutations.ts:561`); `mintGrant` requires `ready` (`grants.ts:85`); `authenticateExtension` re-checks `ready` every request (`grants.ts:177`). **Now `ready → draft` through the route also revokes grants**, and the interview save and the household sync demote a failing `ready` attempt (before, only the values/payment/draft-day/beneficiaries/SSN routes did). | **Fixed** |
| Every item deep-links to the named field | PARTIAL | Every item has a link (tests); in-app `goTo` scrolls and focuses (`context.tsx:141-146`) and the fields carry the ids. Opening a URL that already has `#pay.routing_number` does not scroll (no load/`hashchange` handler). | UI gap U4 |
| Verdict persisted and retrievable; runs live as the agent types | PARTIAL | Frozen on `tenant_application_submissions.qa_verdict` (`recordSubmission`), live row. Live QA: `context.tsx:277` runs `runQa` without the agency's settings, so with "appointment blocks" on the rail shows a warning the server enforces as a block. **Server now sends `qaSettings` on the case view** (`service.ts` `getCaseView`, `types.ts` `CaseView.qaSettings`) and the product's own band (`AttemptView.product.band`, used by `runQa`). | Server **fixed**; UI gap U1 |

## 3.12 Extension auth (60-minute grants)

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| Expires exactly 60 min; after → 401 | MET | Tests `grants` "a grant lives exactly 60 minutes", "an expired token is refused…"; CHECK in `20260926100800`. | — |
| Token for A → 403 on B; other origin → 403 | MET | Tests `grants` "a token for application A is refused for application B", "the wrong origin is refused…"; `REFUSAL_STATUS` (`token.ts:45`). | — |
| Revoke blocks the next request (DB each request) | MET | `authenticateExtension` reads the row every request (`grants.ts:166`); test `grants` "a revoked grant is refused…". | — |
| Bulk has no SSN/bank/card; per-field reveal = one value, one audit row | MET | Test `grants` "the bulk payload contains no sensitive key and no sensitive value"; `readSensitive` (`fields.ts:81`) → `revealField`. | — |
| No `<all_urls>`; hosts from carrier origins; calls only Insurvas | MET | `extension/manifest.json` (no `<all_urls>`; `optional_host_permissions: ["https://*/*"]`, requested per grant origin `sidepanel.js:95`); only fetch `content/carrier.js:16` to `config.js` app origins. Note: the optional wildcard is as broad as the user grants. | — |

## 3.13 Carrier field maps (AI half blocked)

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| Proposed/draft map can't be used by a fill | MET | `fillableMapFor` (`maps.ts:392`) takes `published`/`needs_review` only. Test: `acceptanceAudit` "3.13: a draft or in-review map is never used by a fill…". | Test added |
| Publishing with an unverified sensitive entry rejected, naming the field | MET | Trigger `CARRIER_FIELD_MAP_SENSITIVE_UNVERIFIED: verify % before publishing` (`20260926100800`), surfaced by `maps.ts:46-57`; migration probe publishes one and expects the refusal. | — |
| Highlight outlines the element | MET | `extension/content/carrier.js:164`. | — |
| Zero matches → map_miss, no fill, needs_review, others fill | PARTIAL | Server `recordMapMiss` (`maps.ts:428`) records events and flags `needs_review`; the fill skips and continues (`carrier.js:114-118`). But misses are only reported for steps whose URL pattern matched exactly (`carrier.js:116-117,139`); a miss on a wildcard step is never reported. | Extension gap X1 |
| No AI call at fill time | MET | Same `acceptanceAudit` test; no provider anywhere (agent grep). | — |

## 3.14 Copy-assist

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| Every field with a value, grouped, stable order | MET | `copy-groups.ts`, `TAB_ORDER` `copy-assist-panel.tsx:36`. | — |
| Copying writes that value and shows which field | MET | `copy-assist-panel.tsx:191,198`. | — |
| DOB/phone ≥ 2 variants | MET | Test `la3Rules` "3.14: DOB and phone offer the format variants…". | — |
| Sensitive masked; reveal = one audit row; re-mask after 60 s | MET | `copy-assist-panel.tsx:28,105-123,174-180` via `/reveal` (`surface copy_assist`). | — |
| Ticks persist while open, reset on a new attempt | MET | `tenant_copy_assist_ticks` keyed by `application_id` (new attempt = new id). Verified by reading. | — |
| Works without the extension (pop-out), same record | MET | `app/app/applications/[caseId]/copy-assist/page.tsx:61`. | — |

## 3.15 Submission capture

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| Reference, kind, timestamp, method, frozen verdict | MET | `recordSubmission` (`mutations.ts:632`); live row. | — |
| Clipboard paste uploads and attaches (private, signed URL) | MET | Paste handler `attachment-field.tsx:53-64`; upload on save (`submission-dialog.tsx:101-103`) → `attachConfirmation` (`confirmations.ts:36`, `upsert: false`). | — |
| Reference failing the pattern warns and saves | MET | Test `afterSubmit` "3.15: a reference failing the carrier's pattern warns…". | — |
| Duplicate reference links to the other application | MET | `checkReference` (`confirmations.ts:72`), link `submission-dialog.tsx:201-208`. | — |
| No reference → Missing reference until filled | MET | Test `listRules` "3.15: submitted with no reference is on Missing reference…". | — |
| Confirmation only via short-lived signed URL, cross-tenant 403 | MET | `confirmationUrl` (`confirmations.ts:59`); test `afterSubmit` (60-second signed URL). | — |
| Later policy number doesn't overwrite the application number; deal row updated | MET | `setSubmissionReference` (`mutations.ts:671`) writes `policy_number` separately; deal row update in `recordSubmission`. | — |

## 3.16 Attempts

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| Decline sets outcome + reason; values stay readable | MET | `application_transition` (`20260926100000`) requires the reason; nothing deletes values. | — |
| Attempt 2 = new row, attempt_no 2, supersedes | MET | `open_next_attempt` (`20260926100900`). Test: `acceptanceAudit` "3.16: attempt N+1 carries…". | Test added |
| Carries interview, meds, address, beneficiaries, banking — not quote/tier/premium/disclosures/QA | MET | Same test (SQL copy set; the app re-encrypts SSN and bank numbers, `openNextAttempt` `mutations.ts:684`). | Test added |
| Superseded attempt's submission and confirmation untouched | MET | No delete/update path; test `afterSubmit` "nothing … deletes a counteroffer, submission or welcome pack". | — |
| Won when issued and nothing live (Q4); lost only explicitly with reason | MET | `application_transition` `:311-319`; `closeCase` (`mutations.ts:716`) + CHECK `tenant_application_cases_lost_reason`. | — |
| Timeline lists every attempt with carrier, premium, outcome, reason | MET | UI: `timeline-step.tsx:37-50,93-101`. Server timeline (`timeline.ts:44`) **now carries carrier and premium** (the effective premium after an accepted counteroffer) on each attempt's started and outcome events — before it had neither premium nor, usually, the carrier. | **Fixed** (server timeline) |

## 3.17 Sales settings hub

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| Every setting editable and read by its consumer (tenant-scoped) | PARTIAL | Band: QA (`qaFor`), **now also quote save and the Quote-step catalog** (a product with no band gets the agency's). Appointment rule: QA. Buffer: `saveDraftDay`, UI `use-draft-buffer.ts`. Ageing: `pending.ts:42`. Welcome pack + auto-send: `welcomePack.ts`. Carrier facts: `effectiveCarrierFacts`. Remaining: `POST /api/app/draft-dates/recommend` defaults the buffer to 3 instead of the tenant's (`app/api/app/draft-dates/recommend/route.ts`, outside this pass's files; the UI computes client-side with the tenant's, so the Payment step is right); the live QA rail ignores the settings (U1). | **Fixed** (band); gaps R1, U1 |
| Map-status chip incl. needs review | MET | `carriers.tsx:57,274`; `carrierSites` (`grants.ts:310`) ranks `needs_review` first. | — |
| Any change writes an audit row with old and new values | MET | `settingsAuditDiff` (test `editing` "the audit diff names exactly the keys that changed…"); templates/products/carriers/portals `auditSalesSetting` (`lib/salesSettings/audit.ts`), disclosures and stage map `auditSales`. | — |
| Copy to my tenant clones as a tenant draft; original untouched | MET | `copySalesTemplate` (`templates.ts:219`), `copyProduct` (`carriers.ts:304`), `copyDisclosure` (`disclosures.ts:308`). | — |
| Revoke-all invalidates every active grant within 1 s | MET | `revokeGrants` (`grants.ts:236`); row read on every request. | — |

## 3.18 Pending requirements

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| Adding moves to pending_carrier; satisfying the last leaves it | MET | `addRequirement` (`requirements.ts:89`), `updateRequirement` (`:124`) never transitions. Test: `acceptanceAudit` "3.18: satisfying a requirement never moves the attempt…". **The bare transition route can no longer jump to `pending_carrier`** (it bypassed the requirement). | **Fixed** + test |
| Sort: waiting on client first, then oldest | MET | Tests `afterSubmit`, `listRules`. | — |
| One-click chase increments count and stamps time | MET | Compare-and-set `chaseRequirement` (`requirements.ts:155`). | — |
| Ageing amber N / red 2N, tenant-configurable | MET | Tests `afterSubmit`, `listRules`; setting `requirementAgeingDays`. | — |
| A requirement can create a callback that links back | MET | `bookRequirementCallback` (`requirements.ts:188`) → `la3_requirement_callback` (`20260926102200`); After step `requirements-table.tsx:126`. | — |
| On the case timeline for live and closed attempts | MET | `caseTimeline` reads every attempt's requirements (`timeline.ts`). | — |

## 3.19 Payment methods

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| Five methods store and read back with the right required fields | MET | `savePayment` (`mutations.ts:151`) + per-method CHECKs (`20260926100000`); read `service.ts` `PAYMENT_COLUMNS`. | — |
| No CVV in schema, API or UI | MET | Test: `acceptanceAudit` "3.19: no CVV…"; migration check `20260926100000:338`. | Test added |
| Luhn on save, failures rejected with the reason | MET | `mutations.ts` `CARD_INVALID`; test `la3Rules` "3.19: card numbers pass Luhn…". | — |
| Direct Express outside Mastercard warns and saves | MET | Test: `acceptanceAudit` "3.19: Direct Express outside the Mastercard BIN warns…". | Test added |
| Routing checksum only for ACH | MET | Only in the `ach` branch of `savePayment`. Verified by reading. | — |
| Bulk extension / AI payloads have no card or account numbers | MET | Test `grants` bulk payload; AI blocked. | — |
| Carrier not accepting the method warns in the comparison | MET | `QuoteView.acceptsPaymentMethod` (`service.ts`), `quote-comparison.tsx:56-58`; QA `QA_PAYMENT_NOT_ACCEPTED`. | — |

## 3.20 Welcome pack

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| Submitting generates the PDF and attaches it to the attempt | MET | Submissions route runs `runWelcomePack(…, "submit")` server-side; `writePdf` stores it privately (`welcomePack.ts`). | — |
| Email once, send state recorded, never twice | MET | `claim()` compare-and-set, unique `(application_id)`, `dedupeKey` (`welcomePack.ts:266-359`). | — |
| Descriptor, amount, draft day, agent phone always render, can't be removed | MET | Tests `afterSubmit` "3.20: the four locked facts always render…", `editing` "removing any locked token is refused…". | — |
| A bounce is visible on the application | PARTIAL | A synchronous refusal is stored as `bounced` and shown (`welcome-pack-panel.tsx:35`). An asynchronous bounce (the mailbox rejects after SMTP accepted) is never captured — SMTP transport, no bounce webhook. | Blocked B2 |
| Resubmission produces a new pack without altering the old | MET | New attempt = new row; `upsert: false` (test `afterSubmit`). | — |
| *(noted)* the email carries no PDF attachment | — | Not a criterion (the PDF is attached to the attempt). `lib/email/transport.ts` has no attachment support. | User decision D2 |

## 3.21 Sales performance & decline reasons

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| Each stage matches a hand count; placed partial | MET | Test `reportRules` "3.21: each stage matches the hand count…". Read live from base tables (`report.ts:23`). | — |
| Every rate shows numerator and denominator | MET | Test `reportRules` "3.21: every rate carries its numerator and denominator…". | — |
| Cell under 5 → greyed count | MET | `crossCell`; same test. | — |
| Filters compose | MET | Test `reportRules` "3.21: filters compose…". | — |
| FYC estimated, integer cents; CSV matches the table | MET | Test `reportRules` "3.21: FYC is estimated…"; CSV built from the same report object client-side (`sales-performance.tsx:135-151`). **FYC now follows an accepted counteroffer** (3.26). | **Fixed** (see 3.26) |
| *(noted)* matview refresh | — | `la3_sales_report()` views never refreshed (live: 0 vs 2). The page does not read them; **now refreshed hourly** by the new migration so the function is not stale for any other reader. | **Migration** `20260926103000` |

## 3.22 Portal register

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| No password/secret column (test); no API accepts or returns one | MET | Tests `portalRegister` "3.22: no key…", "the API refuses a body that carries a password", "no migration gives … a secret column". | — |
| Open portal opens URL and copies username, confirming | MET | `carriers-portal.tsx:36-46,123`. | — |
| Portal accounts on the carrier row beside appointment and map status | MET | `carriers.tsx:254-274`. | — |
| `last_verified_at` > 90 days nudges | MET | `PORTAL_VERIFY_NUDGE_DAYS` (`lib/salesSettings/views.ts:8`), `needsCheck` (`portals.ts:28`), `carriers.tsx:264`. | — |

## 3.23 Pipeline stage sync

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| Each mapped state moves the lead exactly once | MET | Tests `stageSync` "each application state maps…", "each mapped state moves the card exactly once…". Live: the demo tenant has no `application_sync` event (its stage map is not configured). | — |
| Manual drag overrides; sync doesn't move; reconcile hint | MET | Test `stageSync` "a manual drag wins…"; `lead-stage-hint.tsx:26-54`. | — |
| Dragging never changes an application | MET | Test `boardNeverWritesApplications`. | — |
| Decline + attempt 2 → Quoted; closing case → Lost | MET | Test `stageSync` "a decline that opens attempt 2…". | — |
| Two live attempts → the more advanced | MET | Test `stageSync` "with two live attempts…". | — |
| Every automatic move writes a history row, system actor, `application_sync` | MET | `moveLead` (`stageSyncService.ts:108-126`); test `boardNeverWritesApplications`. Note: an attempt closed by the SQL expiry sweep moves its card on the next app-side sync, not at expiry (B3). | — |

## 3.24 Spouse-linked applications

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| Add spouse shares address/contact/payment/draft day, no health field | MET | `addSpouse` (`household.ts:62`); test `afterSubmit` "3.24: adding a spouse copies no insured.* or health value…". | — |
| Detaching stops tracking | MET | `detachShared` (`household.ts:123`); `shared-detail.tsx:55-58`. | — |
| Household header: both statuses, carriers, premiums, combined total | PARTIAL | `household-header.tsx:42-60` renders it, but only on the Timeline step (`timeline-step.tsx:78`); the workspace header shows only a "Household · N" chip (`application-workspace.tsx:173`). | UI gap U5 |
| "Each other, then the children" shortcut, editable | MET | `beneficiaries-step.tsx:296-313,335`. | — |
| A QA failure on one doesn't block the other | MET | QA is per attempt. **The household sync now re-checks a `ready` spouse after a shared detail changes** (its own verdict only). | **Fixed** |
| Shared email → one welcome email with both premiums and the total | MET | `deliver` household branch (`welcomePack.ts:290-333`); test `afterSubmit` householdTotal/sameEmail. | — |
| Each application counts once in the funnel | MET | Test `reportRules` "3.24: a spouse's application counts once…". | — |

## 3.25 Term life

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| Product type drives which rating inputs render; FE unaffected | MET | Product type is the product code (SCHEMA-PLAN step 23); `isTermProduct` (`catalogue.ts:69`), term inputs `add-quote-form.tsx:159-181`. | — |
| Term quote stores term length, health class, monthly and annual | MET | `tenant_quotes` columns written by `saveQuote`; UI requires the annual figure. | — |
| Bands and face limits resolve per product ($500k term no warning; $500k FE warning) | MET | `bandFallback` + product limits in `checkQuote`; **QA now judges by the product's own band first**. Test: `acceptanceAudit` "3.25: bands resolve per product…", "3.25: QA judges a quote by its product's own band…". `face_bands` (jsonb, `20260926100300`) is read and edited by nothing — face limits are `face_min/max_cents` per product. | **Fixed** (QA) + tests; D1 |
| Term UW template ships and doesn't alter FE | MET | Test `salesTemplates` seeds ("Term Life — standard"). | — |
| Exam fields only for paramed_exam | MET | `examPatch` (`requirements.ts:67`) + CHECK; `requirement-dialog.tsx:51,133-148`. | — |
| Maps, extension, copy-assist, beneficiaries, submission work on term | MET | No product-specific branch in those paths. Verified by reading. | — |

## 3.26 Counteroffers

| Criterion | Status | Evidence | Changed |
|---|---|---|---|
| Recording preserves applied-for values and the original quote | MET | `recordCounteroffer` (`counteroffers.ts:92`) writes beside the attempt; quote untouched. | — |
| → counteroffer_pending and a waiting-on-client requirement | MET | Same function. **The bare transition route can no longer set `counteroffer_pending`** without a counteroffer row, nor close as `declined_by_client`/`offer_expired` around the answer flow. Test: `acceptanceAudit` "3.18 / 3.26 / 3.15: the bare transition route refuses…". | **Fixed** |
| Delta in dollars and percent, and face difference | MET | Tests `afterSubmit` "3.26: the delta…", `listRules` "3.26: the delta…". | — |
| Accept updates coverage, regenerates the pack, recalculates FYC | MET | `respondCounteroffer` (`counteroffers.ts:136`): `cov.*` values, deal row, `regenerateWelcomePack`, `estimateFyc`; case payout uses the effective premium (`service.ts`). **The sales report's issued premium and estimated FYC now use it too** (it used the quote's). Test: `acceptanceAudit` "3.26: an issued application placed on an accepted counteroffer…". | **Fixed** |
| Reject / expire → distinct outcomes, separable in the report | MET | `declined_by_client` / `offer_expired`; test `reportRules` "3.21: decline reasons by carrier, with refused and expired counteroffers separable". **Expiry at `expires_at` is now scheduled** (pg_cron every 5 min) and the sweep waives the attempt's other open requirements. Test: `acceptanceAudit` "3.26 / 3.21: the expiry sweep…". | **Migration** `20260926103000` |
| Countdown before `expires_at`; nothing deletes the record | MET | Test `listRules` "3.26: an expiring counteroffer shows a countdown…"; `afterSubmit` "nothing … deletes a counteroffer…". | — |

---

## Changes made in this pass

Server / pure logic (no component edited):

- `lib/applications/transitionRules.ts` (new) — `genericTransitionRefusal`; `transition()` (`mutations.ts:561`) refuses `submitted`, `pending_carrier`, `counteroffer_pending` and closing as `declined_by_client`/`offer_expired` (their own services own those edges), and revokes extension grants on `ready → draft`.
- `lib/applications/mutations.ts` — `saveAnswers`: server-side hidden-answer pruning from the template, removals recorded after the call, audit insert checked, `ready` attempts demoted when a disclosure becomes required. `saveMedications`: post-call amendments recorded. `refreshDisclosures`: a settled code is never re-added (uses `disclosureChanges`). `saveQuote`: product read tenant-scoped and checked against the carrier/product, template id + version validated, agency band used when the product has none, rating inputs frozen with the row's facts. `selectQuote`: DOB/gender/tobacco/state from the quote's rating inputs. `demoteIfFailing` takes `{tenantId, userId}`.
- `lib/applications/templates.ts` — `hiddenAnswerKeys`.
- `lib/applications/disclosureRules.ts` — `disclosureChanges`.
- `lib/applications/prefill.ts` — `prefillFromQuote`, `QUOTE_MAY_REPLACE`.
- `lib/applications/household.ts` — a `ready` spouse is re-checked after the household sync changes it.
- `lib/applications/service.ts` / `types.ts` — `CaseView.qaSettings` (agency QA settings), `AttemptView.product.band`; the product read is tenant-scoped.
- `lib/applications/qa.ts` — the product's own per-$1,000 band before the agency's.
- `lib/applications/catalog.ts` — per-carrier `quotationTemplate`; the agency band for products without one (term excepted).
- `lib/quotes/quotationTemplate.ts` — `pickQuotationTemplate`, `freezeRatingInputs`.
- `lib/applications/timeline.ts` — carrier and (effective) premium on attempt events.
- `lib/applications/reportRules.ts` / `report.ts` — issued premium and estimated FYC on the effective (counteroffer) premium.
- `lib/applications/acceptanceAudit.test.mjs` (new) — 37 tests.

New migration (not applied — apply in the Supabase SQL editor):

- `supabase/migrations/20260926103000_la_3_26_21_scheduled_jobs.sql` — replaces `la3_expire_counteroffers()` (adds waiving the closed attempt's other open requirements), schedules `la3-expire-counteroffers` (`*/5 * * * *`), `la3-refresh-sales-report` (`7 * * * *`) and `la3-jobs-log-cleanup` (daily). Its check block runs both job bodies once and rolls them back, then checks `cron.job`. `check-migrations.mjs`: every statement parsed then blocked on rights; the final assertion fails as expected (nothing was committed). Verify after applying by re-running the checker (the assertion should pass) and, after 5 minutes, `cron.job_run_details` for `la3-%`.

## Summary

| Task | Met | Partial | Not met |
|---|---|---|---|
| 3.1 | 7 | 0 | 0 |
| 3.2 | 6 | 0 | 0 |
| 3.4 | 7 | 0 | 0 |
| 3.5 | 6 | 0 | 0 |
| 3.6 | 5 | 0 | 0 |
| 3.7 | 6 | 0 | 0 |
| 3.8 | 6 | 0 | 0 |
| 3.9 | 6 | 0 | 0 |
| 3.10 | 6 | 0 | 0 |
| 3.11 | 4 | 0 | 0 |
| 3.12 | 5 | 0 | 0 |
| 3.13 | 5 | 0 | 0 |
| 3.14 | 6 | 0 | 0 |
| 3.15 | 7 | 0 | 0 |
| 3.16 | 6 | 0 | 0 |
| 3.17 | 5 | 0 | 0 |
| 3.18 | 6 | 0 | 0 |
| 3.19 | 7 | 0 | 0 |
| 3.20 | 4 | 1 | 0 |
| 3.21 | 5 | 0 | 0 |
| 3.22 | 4 | 0 | 0 |
| 3.23 | 6 | 0 | 0 |
| 3.24 | 7 | 0 | 0 |
| 3.25 | 6 | 0 | 0 |
| 3.26 | 6 | 0 | 0 |
| **Total** | **144** | **1** | **0** |

Counts updated 2026-09-29 after the follow-up fixes below (U1–U6, X1, R1, D3). The one remaining partial is 3.20 (no PDF attachment on the email, no asynchronous bounces: D2, B2). 3.3 and the AI half of 3.13 are blocked on decision 4 and not counted.

## Resolved after this audit (2026-09-29)

| # | How |
|---|---|
| U1 | `context.tsx` passes `settings: caseView.qaSettings` to `runQa`: the rail blocks where the server's Ready check does. |
| U2 | `catalogue.ts` carries `carrierTemplates` and `templateFor(catalogue, carrierId)`; `quote-step.tsx` and `add-quote-form.tsx` use the chosen carrier's template (fields, age basis, id and version), falling back to the general one. |
| U3 | Both draft-date surfaces print each alternate's reason under its button. |
| U4 | `context.tsx` scrolls to and focuses `location.hash` on mount and on `hashchange`. |
| U5 | `HouseholdHeader` renders under the workspace header on every step of a household case (removed from the Timeline step). |
| U6 | `transition`'s `to` narrowed to `ready` / `draft` / `closed`. |
| X1 | `extension/content/carrier.js` reports a field that was found but refused its value on any page; only `selector_not_found` stays exact-page-only (a wildcard page cannot tell "not here" from "not found"). |
| R1 | `/api/app/draft-dates/recommend` defaults the buffer to the agency's `draftBufferDays`. |
| D3 | Pending reads (`lib/applications/pending.ts`) no longer list requirements or counteroffers of closed attempts, so the old demo row is gone from every list; closing now waives on every path (`requirements.ts` `waiveOpenRequirements`, used by `transition` and `moveAttempt`). |

## Remaining gaps

| # | Gap | Owner | Exact change |
|---|---|---|---|
| U1 | Live QA rail ignores the agency's QA settings (3.11, 3.17) | UI agent | `components/app/applications/workspace/context.tsx:277` — `runQa({ caseId, attempt, interview, settings: caseView.qaSettings })` (the field is optional; sample data falls back to the defaults). |
| U2 | Quote step uses the general quotation template for every carrier (3.4) | UI agent | `components/app/applications/quotes/catalogue.ts:78` — add `quotationTemplate` to `LiveCatalogCarrier` and map it from the API's `carriers[].quotationTemplate`; `workspace/steps/quote-step.tsx:167` and `add-quote-form.tsx` (`quotationFields`, `ageBasis` at :69) — use the chosen carrier's template (fields, age basis, `quotation_template_id`, `template_version`), falling back to `catalogue.quotationTemplate`. |
| U3 | Alternates' read-aloud reason only in a hover title (3.9) | UI agent | `components/app/applications/draft-dates/draft-date-panel.tsx:429` and `draft-date-calculator.tsx:90` — render `o.reason` as visible text (as the recommended day's callout at `:422` / `:85`). |
| U4 | A deep link opened from a URL with `#field` doesn't scroll (3.11) | UI agent | `components/app/applications/workspace/context.tsx` near `:141-146` — on mount and on `hashchange`, `document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ block: "center" })` and focus it. |
| U5 | Household header only on the Timeline step (3.24) | UI agent | `components/app/applications/application-workspace.tsx:173` — render `HouseholdHeader` under the workspace header when the case has a spouse (it is already built, `household/household-header.tsx`). |
| U6 | Workspace types still offer `pending_carrier` / `counteroffer_pending` to `transition` | UI agent (tidy) | `components/app/applications/workspace/context.tsx:49` — narrow the `to` union to `"ready" \| "draft" \| "closed"`; the server now refuses the others (409 `TRANSITION_USE_*`). No caller uses them today. |
| X1 | Map misses not reported on wildcard steps (3.13) | Extension owner | `extension/content/carrier.js:116-117,139` — report a `selector_not_found` for every step the fill ran, not only `step.match === "exact"`. |
| R1 | `/api/app/draft-dates/recommend` defaults the buffer to 3 (3.17) | Route owner (outside this pass's files) | `app/api/app/draft-dates/recommend/route.ts` — when `buffer` is absent, use `(await salesSettingsFor(auth.context.tenantId)).draftBufferDays` (`lib/salesSettings/settings.ts:65`). |
| M1 | Apply `20260926103000` | User | SQL editor, then re-run `node --env-file=.env.local scripts/check-migrations.mjs 20260926103000_la_3_26_21_scheduled_jobs.sql`. |
| D1 | `carrier_products.face_bands` is stored but read and edited by nothing (3.25) | User decision | Face limits already resolve per product through `face_min/max_cents`. Decide whether term face bands (e.g. per-band pricing hints) are wanted; if so, add them to `updateProductSchema` and `carriers-products.tsx`, and a consumer in `checkQuote`. |
| D2 | Welcome-pack email has no PDF attachment | User decision | `lib/email/transport.ts` would need an `attachments` input (nodemailer supports it); then `welcomePack.ts` `deliver()` attaches the stored PDF. |
| D3 | The demo attempt `e898611c…` still has an open `phone_interview` requirement | User decision | It was closed before close-waives-requirements existed. One-off: `update tenant_application_requirements set status='waived', satisfied_at=current_date, note='Waived: the attempt was closed.' where application_id='e898611c-b892-4a74-9b1e-32570b4bf1df' and status in ('open','in_progress');` |
| B1 | AI assistant (3.3) and AI map proposals (3.13) | Blocked (decision 4) | — |
| B2 | Asynchronous email bounces (3.20) | Blocked | SMTP gives no bounce callback; needs an HTTP provider with a webhook. |
| B3 | A counteroffer expired by pg_cron moves the lead's card only on the next app-side sync (3.23/3.26) | Accepted (same split as the SLA ladder) | Revisit when the app gets a scheduled host. |

## Functional QA through the UI (2026-09-29)

Driven in the browser on the demo agency, real data. Result: every workflow passes; bugs found were fixed and re-verified.

- **Case A** `14d6a0a7…` — lead → all 11 steps → Issued (policy TAQA-PN-929001) → case won; list, Pending, dashboard and Sales performance agree.
- **Case B** `e3b6bb33…` — declined → attempt 2 (values and SSN carried, product kept) → withdrawn → case lost; nothing left on Pending.
- **Case C** `e9ae3bf3…` (Final Expense, inbound) — Ready → extension grant (60 min, origin-bound) → wrong origin 403, no/fake token 401 → revoke from Settings → token refused as revoked → withdrawn. Not run live: a field read from the carrier's own origin (needs a server-side client holding the token; covered by unit tests).
- **Settings › Sales** — all 11 panels saved, checked at their consumer, and restored; QA drafts left retired/switched off (see the QA report).
- **Quotes page** — tested with the kill switch named to the demo agency only, then set back to off for everyone.
- **Roles** — setter, assistant, bookkeeper: LA-3 hidden, 403 on every LA-3 API; producer: works, settings writes 403.
- **Phone width** — every LA-3 page and panel at 375px: no sideways scroll.

Fixed during QA (selection): interview never started from the UI; answers deleted on the server when a save re-read the case mid-typing; height/weight asked twice; raw markdown in disclosures; QA-rail deep links not focusing cross-step fields; timeline dates and wording; agency time zone across screens; retry lost the product; a draft attempt could not be withdrawn nor the case closed; no Retire for quotation templates, field sets and disclosures; no way to remove a portal account; carrier-specific underwriting templates never used; quote validity (`valid_days`) now marks expired quotes; field-set fallback matched to Settings; Sales performance counted agency-withdrawn attempts as carrier declines; duplicate interview section heading.

## Follow-up (2026-09-30)

- **D2 resolved — the welcome-pack email now carries the PDF.** `lib/email/transport.ts` accepts optional `attachments` (additive; no other caller changes); `welcomePack.ts` `packAttachment()` reads the stored PDF from the tenant's own path and attaches it (plus the spouse's pack on a household email). If the file can't be read, the email still goes without it. Verified: the stored 2,058-byte PDF downloads through the same call; test `welcomePackAttachment.test.mjs`. Live SMTP stays off by design (`EMAIL_DELIVERY_MODE`), so the send is logged as skipped here.
- 3.20 remains PARTIAL only for **asynchronous bounces** (B2): SMTP gives no bounce callback; needs an HTTP email provider with a webhook.
- Verified live on real data this day: confirmation screenshot upload (magic-byte check, no overwrite, 60-second signed read), welcome-pack send path, pipeline card move via `application_sync`, dialer "Start application" and inbound "Continue to underwriting" both open the one workspace, and the extension fill script on a mock carrier form (fills, never submits, never guesses, reports gaps).
- `scripts/verify-*.mjs` now refuse to run against production (`scripts/lib/refuseProduction.mjs`); they were the source of 605 leftover test tenants.

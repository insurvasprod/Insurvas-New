# LA-3 acceptance criteria (from the Insurvas Sprint, 2026-09-28)

Every criterion below must be met by the build, or listed as not met with the reason. Decisions that
changed a criterion are noted inline (see `docs/la3/SCHEMA-PLAN.md` decisions log).

## 3.1 Underwriting question templates
- Creating or editing a template requires no deploy.
- Editing a live template does not change an interview already in progress (versioned; published rows immutable; edit = version N+1).
- A knockout answer is visible the moment it is given.
- Conditional follow-ups appear and disappear without a page reload, and hidden answers are not stored.
- The five persistency questions (SS deposit date, is this the account, anyone else on the call, existing coverage, can receive a text/email) are present in every seeded template.
- Preview matches the interview exactly.
- Question types: yes/no, single, multi, number, date, free text, medication list; sections, ordering, required; duplicate a template.

## 3.2 Interview & medications
- An interrupted interview resumes with every answer intact (autosave).
- A knockout answer is impossible to miss.
- Medications are stored as rows with named fields (name, dose, since, prescribed for), never one string.
- A medication not in the list can still be entered; "prescribed for" may be Unknown and that prompts the agent to ask.
- Amending an answer after the call leaves an audit trail.
- The interview renders any template with no template-specific code. Progress indicator; notes per answer.

## 3.3 AI underwriting assistant — BLOCKED (decision 4: provider + health-data terms unresolved)
- Settings shows it as unavailable, with the fixed statement of what would be sent. No provider call anywhere.

## 3.4 Quotation templates
- Create / publish / version; a published template cannot be edited in place.
- Rendering produces a form whose fields match the template exactly, in order.
- Interview-derived values are prefilled and visibly marked as prefilled.
- Computed age matches `age_basis` (7 months past birthday: nearest = age+1, last = age), shown beside DOB.
- A saved quote references (template_id, version); publishing a new version does not change it.
- The generic Final Expense template exists in a fresh tenant. No rate tables.

## 3.5 Quote capture & comparison
- A quote saves with all rating inputs frozen as JSON alongside the template version.
- Premium stored in cents; $68.40 reads back as exactly 6840; no float anywhere.
- Premium ≥ face amount is rejected outright; out-of-band per-$1,000 shows an amber warning and still saves.
- Comparison renders 2–4 quotes in columns including the Appointed? row.
- Marking one quote selected sets the rest to discarded; none are removed.
- The client-facing view contains no per-$1,000, commission or appointment columns (print/PDF).

## 3.6 Appointments & payout ranking
- Appointment CRUD works; a terminated appointment keeps its termination date and stays in the register (existing /app/appointments).
- A quote for a carrier with no active appointment covering the client's state shows Appointed? = No with a reason, and still saves.
- FYC in integer cents: $68.40/mo, 105%, 9-month advance → $820.80 annual, $861.84 FYC, $646.38 advance.
- The payout strip is invisible in the client print view; it is agent-only, sorted by FYC with a visible sort, with the fixed line "Recommend on fit first…".
- Payout ranking never changes which quote is selected.

## 3.7 Application record & field sets
- Creating an application from a selected quote prefills name, DOB, address, gender, tobacco, face, tier, premium, each with its source.
- One row per field; a new carrier field needs no migration.
- SSN and bank numbers encrypted at rest (ciphertext in the column).
- A reveal writes exactly one sensitive_access_log row with user, field, timestamp; masked by default (••••1234).
- List endpoints contain no SSN or bank values.
- A carrier with no field set renders the platform-default Final Expense set.

## 3.8 Beneficiaries
- Primary shares totalling 99.99 block `ready`, naming the rule.
- Split evenly across 3 → 33.34 / 33.33 / 33.33 = 100.00.
- A contingent with no primary is rejected; "other" needs text.
- A beneficiary under 18 warns (trustee/custodian) and still saves; estate warns; >4 primaries warns.
- Live running total per tier, green only at exactly 100.00.
- Beneficiaries survive a resubmission attempt without re-entry.

## 3.9 Draft-date optimiser
- Day-of-birth 7 → 2nd Wed; 15 → 3rd Wed; 28 → 4th Wed.
- Pre-May-1997 or SSI-concurrent → the 3rd.
- SSI on a month whose 1st is a Sunday resolves to the preceding Friday.
- No recommendation exceeds day 28.
- Recommended day is 2–4 days after the LATEST arrival in a rolling 12 months; 12 arrival dates are viewable.
- Writes through to the application's draft day; each option carries a read-aloud reason; override allowed and logged.

## 3.10 Disclosures
- "Yes" to existing coverage makes REPLACEMENT_NOTICE required without a reload.
- An unacknowledged required disclosure blocks `ready`, naming which.
- Acknowledging records user, timestamp and method (read aloud / emailed / mailed).
- Not applicable without a reason is rejected.
- A TX/OK-scoped disclosure does not trigger for NM.
- A new disclosure version does not change the version recorded on an acknowledged application.

## 3.11 Pre-submission QA
- Each blocking rule has a unit test (pass + fail input). Routing 021000021 passes, 021000022 fails. SSN 666-12-3456 fails, 123-45-6789 passes.
- A `fail` verdict blocks `ready`, and the extension receives nothing.
- Every item has a deep link that lands on the named field.
- The verdict is persisted with the submission and retrievable afterwards. Runs live as the agent types.

## 3.12 Extension auth (decision 1: 60-minute grants)
- Grant expires exactly 60 minutes after issue; a request after that returns 401.
- A token for application A returns 403 on B; a request from another origin returns 403.
- Revoking a grant blocks the next request within one second (checked in the DB each request).
- The bulk fields response contains no SSN or bank/card numbers; a per-field reveal returns one value and writes one audit row.
- The manifest requests no `<all_urls>`; host permissions come from configured carrier origins; the extension calls only the Insurvas API.

## 3.13 Carrier field maps (AI proposal half BLOCKED by decision 4)
- A proposed/draft map cannot be used by a fill.
- Publishing with any unverified sensitive entry is rejected, naming the field.
- Highlight on page outlines the element a selector resolves to.
- A selector matching zero elements → a map_miss event, no fill of that field, a needs_review flag, and the other fields still fill.
- No AI call at fill time.

## 3.14 Copy-assist
- Every canonical field with a value appears, grouped, in a stable order.
- Copying writes exactly that value and shows which field it was.
- DOB and phone offer ≥2 format variants; copying a variant copies that format.
- Sensitive fields masked until revealed; a reveal writes one audit row and re-masks after 60 s.
- Copy ticks persist while the application is open and reset on a new attempt.
- Works with the extension absent, in the web app (pop-out), reading the same record.

## 3.15 Submission capture
- Captures reference, kind, timestamp, method and the frozen QA verdict.
- Clipboard paste of an image into the modal uploads and attaches it (private storage, signed URL).
- A reference failing the carrier's pattern warns and still saves.
- A duplicate reference on the same carrier in the same tenant links to the other application.
- Submitted with no reference → appears on Missing reference until filled.
- Confirmation assets are readable only via a short-lived signed URL, tenant-scoped (cross-tenant 403).
- A later policy number does not overwrite the application number. Deal flow row updated on submit.

## 3.16 Attempts
- A decline sets outcome + reason and leaves the attempt's values readable.
- Attempt 2 = new row, attempt_no 2, supersedes set.
- Carries interview, medications, address, beneficiaries, banking; not quote, tier, premium, disclosures, QA verdict.
- The superseded attempt's submission and confirmation are untouched.
- Case → won when an attempt is issued (and no live attempt remains — Q4); lost only when closed explicitly with a reason.
- The case timeline lists every attempt with carrier, premium, outcome, reason.

## 3.17 Sales settings hub
- Every LA-3 setting is editable there and read by the feature that consumes it (tenant-scoped, server-enforced).
- Each carrier row shows an accurate map-status chip including needs review after a map_miss.
- Changing any setting writes an audit row with old and new values.
- Copy to my tenant clones a platform default as a tenant draft; the original is untouched.
- Revoke-all-grants invalidates every active grant within one second.

## 3.18 Pending requirements
- Adding a requirement moves the application to pending_carrier; satisfying the last one leaves it there until an outcome is recorded.
- Pending cases sorts waiting_on = client first, then oldest.
- Logging a chase increments chase_count and sets last_chased_at in one click.
- Ageing thresholds (amber N, red 2N) are tenant-configurable.
- A requirement can create a callback (tenant_callbacks) that links back.
- Requirements appear on the case timeline for live and closed attempts.

## 3.19 Payment methods
- ACH, Direct Express, debit, credit, direct bill store and read back with the right required fields.
- No CVV in schema, API or UI.
- Card numbers pass Luhn on save; failures are rejected with the reason.
- Direct Express outside Mastercard BIN warns and still saves.
- The routing checksum runs only for ACH.
- Bulk extension payloads and AI payloads contain no card or account numbers.
- A carrier that does not accept the client's method warns in the comparison.

## 3.20 Welcome pack
- Submitting generates the PDF and attaches it to that attempt.
- Where an email exists and auto-send is on, the email goes out once, with send state recorded; never twice for the same attempt.
- The billing descriptor, monthly amount, draft day and agent phone always render and cannot be removed from the template.
- A bounce is visible on the application.
- A resubmission to another carrier produces a new pack without altering the old one.

## 3.21 Sales performance & decline reasons
- Each funnel stage matches a hand count; Placed is labelled partial and never inferred from issued.
- Every rate shows its numerator and denominator.
- A reason × carrier cell under 5 cases shows a greyed count, no percentage.
- Filters compose (carrier + lead source + date range).
- FYC labelled estimated, integer cents. CSV export matches the table.

## 3.22 Portal register
- No password or secret column (a test asserts it); no API accepts or returns a password.
- Open portal opens the URL and copies the username, confirming what was copied.
- Portal accounts appear on the carrier row beside appointment and map status.
- last_verified_at older than 90 days shows a nudge.

## 3.23 Pipeline stage sync
- Each mapped application state moves the lead to the configured stage exactly once.
- A manual drag sets an override; a later automatic sync does not move the card and shows the reconcile hint.
- Dragging a card never changes an application's status.
- A decline that opens attempt 2 returns the lead to Quoted; a decline that closes the case moves it to Lost.
- With two live attempts the stage follows the more advanced one.
- Every automatic move writes a stage-history row with the system as actor (source `application_sync`).

## 3.24 Spouse-linked applications
- Add spouse creates a second application sharing address, contact, payment method and draft day, copying no health field.
- Detaching a shared field on one side stops it tracking the other.
- The household header shows both sides' status, carrier, premium and the combined monthly total.
- The "each other, then the children" beneficiary shortcut works and is editable.
- A QA failure on one application does not block the other.
- Both sharing an email → one welcome email stating both premiums and the combined total.
- Each application counts once in the report funnel.

## 3.25 Term life
- product_type drives which rating inputs render; FE quotes are unaffected.
- A term quote stores term length, assumed health class, monthly AND annual premium.
- Plausibility bands and face limits resolve per product ($500k term: no warning; $500k FE: warning).
- The term underwriting template ships as a platform default and does not alter the FE one.
- Exam fields exist on requirements and appear only for paramed_exam.
- Maps, extension, copy-assist, beneficiaries and submission work on term with no term-specific code.

## 3.26 Counteroffers
- Recording a counteroffer preserves the applied-for values and the original quote.
- Status → counteroffer_pending and a waiting-on-client requirement appears.
- The delta view shows premium difference in dollars and percent, and face difference, with no agent arithmetic.
- Accepting updates effective coverage, regenerates the welcome pack with the new premium, recalculates FYC.
- Rejecting or expiring produce distinct outcomes (declined_by_client, offer_expired), separable in the report.
- An expiring counteroffer shows a countdown before expires_at. Accepting or rejecting never deletes the record.

# LA-3 status model

Decision 3: one definition for every application state and outcome across all 26 tasks, written
before any migration. Every LA-3 migration, service and UI reads its values from here. If a task
needs a value that is not in this file, this file changes first.

Status: **approved** 2026-09-28. The eleven Step 0 questions were settled on the recommendations
recorded in each section below (marked **Decided**).

---

## 1. Three levels, three columns

The hierarchy from `MODULE-3-EXPLAINED.md` §11:

```
lead (agent_leads)
 └─ case         tenant_application_cases      one per attempt to make a sale      (exists, LA-2.14)
     └─ attempt  tenant_applications           one per insured per carrier tried   (new, LA-3.7/3.16)
         └─ submission tenant_application_submissions  one per time submit was pressed   (new, LA-3.15)
             └─ policy   tenant_issued_policies        written on issue                 (exists, LA-2.17)
```

| Level | Column | Kind |
|---|---|---|
| Case | `tenant_application_cases.status` | lifecycle, text + CHECK (existing) |
| Attempt | `tenant_applications.status` | lifecycle, text + CHECK |
| Attempt | `tenant_applications.outcome` + `outcome_reason_code` | terminal result, set once, when `status = 'closed'` |

The repo uses text + CHECK, never `CREATE TYPE`, for statuses (`tenant_application_cases`,
`tenant_issued_policies`, `deal_flow`). LA-3 follows that.

---

## 2. Attempt status (`tenant_applications.status`)

| Status | Meaning | Introduced by | Who sets it |
|---|---|---|---|
| `draft` | Being filled. Interview, quote, application values may all be incomplete. | 3.7 | created |
| `ready` | QA verdict is not `fail`, every required disclosure is acknowledged, beneficiary shares are valid. The only state in which the extension can be granted a token. | 3.7, 3.11 | system, when the agent clicks **Ready to submit** and QA passes |
| `submitted` | The agent recorded a submission (reference number may be empty — then it sits on Missing reference). | 3.15 | agent, via the capture modal |
| `pending_carrier` | At least one requirement was raised after submission. Stays here even when every requirement is satisfied — issue is never inferred. | 3.18 | system, when the first requirement is added |
| `counteroffer_pending` | The carrier offered different terms; waiting for the client to accept or refuse. | 3.26 | system, when a counteroffer is recorded |
| `closed` | Terminal. `outcome` says how it ended. Nothing on a closed attempt is edited again. | 3.16 | agent (outcome) or system (`offer_expired`) |

**Dropped from the Notion text:** `submitting` (LA-3.7). Nothing writes it — the extension fills,
the agent presses submit on the carrier's site, and the capture modal moves the attempt to
`submitted`. A state no code enters is a state the UI has to render forever for no reason.
**Decided (Q1): dropped.**

**Also not a status:** `issued`, `declined`, `withdrawn` (LA-3.7 listed them as statuses). They are
outcomes on a closed attempt, per LA-3.16. One column for "where is it" and one for "how did it
end" keeps "closed but we don't know how" impossible.

---

## 3. Attempt outcome (`tenant_applications.outcome`)

Required when `status = 'closed'`, null otherwise (CHECK).

| Outcome | Meaning | Introduced by | Reason required? |
|---|---|---|---|
| `issued` | The carrier issued the policy. Recorded by the agent from the carrier's notice. Writes `tenant_issued_policies` through the existing `mark_deal_policy_issued` RPC. | 3.7 / 3.16 | no |
| `declined` | The carrier declined. | 3.16 | **yes** |
| `postponed` | The carrier postponed (e.g. recent hospitalisation — reapply later). | 3.16 | **yes** |
| `withdrawn` | The client or agent withdrew before the carrier decided. Also used for a `draft` that is abandoned. | 3.16 | **yes** |
| `declined_by_client` | The carrier counteroffered and the client refused. | 3.26 | no (implied) |
| `offer_expired` | The counteroffer window closed with no answer. Set by the system at `expires_at`. | 3.26 | no (implied) |

`declined_by_client` and `offer_expired` are separate outcomes, not reasons under `declined`, so
LA-3.21 can count them on their own without parsing reason text — which is the whole point of
3.26's reporting row.

### Structured reasons (`outcome_reason_code`)

A platform list, extendable per tenant and optionally scoped to a carrier (table
`application_outcome_reasons`, Step 15). Seeded with the LA-3.16 Final Expense set:

| Code | Label | Valid for |
|---|---|---|
| `medication` | Medication disclosed | declined, postponed |
| `recent_hospitalisation` | Recent hospitalisation | declined, postponed |
| `height_weight` | Height / weight (build chart) | declined |
| `prior_decline` | Prior decline | declined |
| `banking_nsf` | Banking / NSF | declined, withdrawn |
| `incomplete_application` | Incomplete application | declined |
| `replacement_not_disclosed` | Replacement not disclosed | declined |
| `client_changed_mind` | Client changed their mind | withdrawn |
| `client_unreachable` | Client unreachable | withdrawn |
| `other` | Other — free text required | all |

Free text (`outcome_reason_text`) is always allowed and is required when the code is `other`.

---

## 4. Legal transitions

Enforced in one SQL function (`application_transition`) that every writer calls, so the table below
is the only place a transition can be allowed. Anything not listed is rejected with
`APPLICATION_TRANSITION_INVALID`.

| From | To | Trigger | Guard |
|---|---|---|---|
| — | `draft` | attempt created (new case, **Add spouse**, or **New attempt**) | case is `open` |
| `draft` | `ready` | agent: Ready to submit | QA verdict ≠ `fail` (3.11); no `required` disclosure unacknowledged (3.10); beneficiary rules pass (3.8); payment method valid for its type (3.19) |
| `ready` | `draft` | any edit that makes QA `fail` again | automatic; revokes every live extension grant for the attempt (3.12) |
| `ready` | `submitted` | agent: capture modal saved | QA re-run at that moment and frozen onto the submission row |
| `submitted` | `pending_carrier` | first requirement added | — |
| `submitted`, `pending_carrier` | `counteroffer_pending` | counteroffer recorded | — |
| `counteroffer_pending` | `pending_carrier` | client **accepts** | offered values become effective coverage; welcome pack reissued; FYC recalculated |
| `submitted`, `pending_carrier` | `closed` / `issued` | agent records issue | policy number present (warn only if missing — it goes on Missing reference) |
| `submitted`, `pending_carrier` | `closed` / `declined` or `postponed` | agent records outcome | reason code |
| `counteroffer_pending` | `closed` / `declined_by_client` | client refuses | — |
| `counteroffer_pending` | `closed` / `offer_expired` | `now() > expires_at` | system job |
| `draft`, `ready`, `submitted`, `pending_carrier`, `counteroffer_pending` | `closed` / `withdrawn` | agent withdraws | reason code |

Not allowed, on purpose:

- `closed` → anything. A new try is a **new attempt** (3.16), never a reopened one.
- `pending_carrier` → `submitted`. Satisfying the last requirement does not undo "the carrier asked
  for something" (3.18).
- Any transition caused by the pipeline board. Dragging a card never changes an attempt (3.23).

### After a transition

| Event | Effect |
|---|---|
| attempt → `closed/issued` | case → `won`, once no attempt for either insured is still live (§7) |
| attempt → `closed/declined`, `postponed`, `declined_by_client`, `offer_expired` | agent is offered **New attempt** (3.16) or **Close case as lost** |
| attempt → `submitted` | welcome pack generated (3.20); `deal_flow` row updated from the attempt (3.15) |
| any change | pipeline sync evaluated (§6) |

---

## 5. Case status (`tenant_application_cases.status`)

Existing CHECK: `'open','submitted','closed','abandoned'`, with the partial unique index
`tenant_application_cases_one_open_idx (tenant_id, lead_id) where status = 'open'`.

LA-3.16 wants `open | won | lost`. Proposed final CHECK:

| Status | Meaning | Source |
|---|---|---|
| `open` | At least one attempt is live, or the agent has not closed the case. | existing |
| `won` | An attempt reached `closed/issued`. Terminal. | **new** (3.16) |
| `lost` | The agent closed it explicitly, with `outcome_reason_code`. Terminal. | **new** (3.16) |
| `submitted` | **Legacy.** Kept valid; LA-3 code never writes it. | existing |
| `closed` | **Legacy.** Kept valid; LA-3 code never writes it. | existing |
| `abandoned` | **Legacy.** Kept valid; LA-3 code never writes it. | existing |

The legacy values stay in the CHECK so existing rows keep validating (rule 1).
**Decided (Q2):** nothing writes them. `start_application_from_lead` only inserts `open` (the
column default), and no function, route or lib module updates `tenant_application_cases.status`
(checked 2026-09-28). They stay valid and unused; LA-3 writes only `open`, `won`, `lost`.

The one-open-per-lead index stays as it is. A spouse is **not** a second case — see §7.

---

## 6. Pipeline stage mapping (feeds 3.23)

`tenant_pipeline_stages` has no system key (only `name`, `position`, `stage_type open/won/lost`),
so the map is data: `tenant_application_stage_map (tenant_id, sync_key, stage_id)`, edited in
Settings › Pipelines. An unmapped key moves nothing.

| `sync_key` | Derived from | LA-3.23 default stage name |
|---|---|---|
| `quoted` | attempt `draft` with ≥ 1 saved quote | Quoted |
| `application_started` | attempt `ready` | Application started |
| `submitted` | attempt `submitted` | Submitted |
| `pending_requirements` | attempt `pending_carrier` **or** `counteroffer_pending` | Pending requirements |
| `issued` | attempt `closed/issued` | Issued |
| `requoting` | attempt closed as declined/postponed/declined_by_client/offer_expired **and** a new attempt opened | back to Quoted |
| `lost` | case `lost`, or attempt `closed/withdrawn` with no other live attempt | Lost |

Rules (from 3.23):

- **The lead follows the most advanced live attempt**, ordered
  `quoted < application_started < submitted < pending_requirements < issued`.
- **Forward only**, except `requoting`.
- **A manual move wins.** If the lead's latest `tenant_lead_stage_events` row came from a human
  source (`board`, `table`, `list`, `lead_detail`, `owner_fix`, `dialer`) and is newer than the last
  `application_sync` row, the sync does not move the card; the board shows a reconcile hint.
- Every automatic move writes a `tenant_lead_stage_events` row with the new source
  `application_sync` and `actor_user_id = null`.
- Seeding the default map matches stage names case-insensitively on the tenant's default pipeline;
  anything that does not match is left unmapped rather than guessed.

**Decided (Q3):** an `application_sync` move carries `disposition_key = null`, the same as an
`owner_fix` move. The "a move is a disposition" rule governs moves a person makes on a call; an
application changing state is not a call outcome, and inventing a disposition for it would put
fake dispositions into the dial funnel.

---

## 7. Spouse attempts (3.24)

A spouse is a second **insured on the same case**, not a second case: the case is unique-open per
lead, and the spouse has no lead of their own. So:

- `tenant_applications.insured_role in ('primary','spouse')`, and `attempt_no` is unique per
  `(case_id, insured_role)`.
- Each insured has its own attempts, statuses, outcomes and policy numbers. Nothing in this file is
  shared between them.
- **Decided (Q4):** the case → `won` when at least one attempt is issued **and** neither insured has
  a live attempt left. While the spouse's attempt is still in flight the case stays `open`. That
  keeps the one-open-case-per-lead index from letting a second case open beside a half-finished
  household, and keeps the spouse's attempt on the same case.

This replaces LA-3.24's `household_link` table — the case already is the household link.

---

## 8. Where each value is used

| Value | Written by (step) | Read by |
|---|---|---|
| attempt `draft` | 1 | 2, 3, 5–10, 17 |
| attempt `ready` | 10 | 12 (grant), 17 |
| attempt `submitted` | 11 | 17, 18, 20, 24 |
| attempt `pending_carrier` | 18 | 17, 19, 24 |
| attempt `counteroffer_pending` | 19 | 17, 18, 24 |
| outcome `issued` | 15 | 11 (policy), 17, 24 |
| outcomes `declined`, `postponed`, `withdrawn` | 15 | 17, 24 |
| outcomes `declined_by_client`, `offer_expired` | 19 | 17, 24 |
| case `won` / `lost` | 15 | 17, 24 |

Every value is created in the Step 1 migration so no later step re-migrates the CHECK. The steps
above are where the value first gets a writer.

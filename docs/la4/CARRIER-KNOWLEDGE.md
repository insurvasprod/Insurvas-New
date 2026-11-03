# LA-4 carrier knowledge and feature spec

> Received 2026-10-07 from Olti (live doc: https://claude.ai/code/artifact/93b7ba43-66bc-49e0-ba63-9b95a7c557d2), built from the Safe Harbour 09-01-2026 files. Kept here as received. What it means for the build is in [CARRIER-SEED-PLAN.md](CARRIER-SEED-PLAN.md). Nothing in it is written to the platform until approved there.

Oct 7, 2026 · Olti · Live doc: https://claude.ai/code/artifact/93b7ba43-66bc-49e0-ba63-9b95a7c557d2

## Purpose and how to read this

LA-4 has to turn raw carrier rows into six daily answers: who missed a first draft, how many days are left to save it, what each lapse will cost in chargebacks, what each pending app is waiting on, which commissions never arrived, and whether the ones that did arrived at the right rate. Everything below is either **configuration** (a per-carrier value the engine reads) or a **feature** (a rule or view built on top of the registry and the layout map).

- **Registry** = the raw rows, kept as received. Nothing here changes that.
- **Layout map** = column → canonical field, per carrier and file type. Section 2 lists the extra canonical fields the map needs beyond what is built today.
- **Snapshot** = one normalized row per policy per file date. Most rules below are a diff between today's snapshot and an earlier one; carriers only give current state.
- **Config** values marked *measured* come from the Safe Harbour 09-01 files (8 carriers, about 3,700 policies). Values marked *to confirm* are guesses or industry norms. Seed the config with measured values and replace them as the agency confirms.
- Problem numbering follows your list (1 first draft, 2 lapse windows, 3 chargebacks, 4 pending, 5 missing commissions, 6 rate check). In the project docs, missing commissions and rate check share one doc, and #5 there is recovery tracking (section 7 here).

## Canonical data model

Every carrier status maps into nine normalized statuses, and **status alone is never enough**: at Aetna/Aflac/AHL and MOH a policy that has missed payments still reads Active or Inforce. Paid-to date drives most risk logic.

### Normalized policy status

| Normalized | Meaning | In book? | Commission effect |
| --- | --- | --- | --- |
| SUBMITTED | Received, in underwriting, requirement outstanding | pipeline | none |
| DECLINED | Carrier declined (knockout, over limits, medical) | no | none |
| WITHDRAWN | Closed before decision (withdrawn, incomplete, unable to underwrite) | no | none |
| APPROVED\_UNPAID | Issued, first premium not yet credited | pipeline | AMAM and MOH already advanced |
| NOT\_TAKEN | Issued, never paid, or free-look cancel | no | full chargeback if advanced |
| ACTIVE | Paying, paid-to current | yes | earning |
| AT\_RISK | Active but past due, returned draft, lapse/conservation pending | yes, flagged | unearned advance at risk |
| LAPSED | Stopped paying, terminated, surrendered | no | chargeback of unearned part |
| PAID\_UP | Reduced paid-up (RPU) | yes, no premium | none |

AT\_RISK is set two ways: by a carrier status (AMAM Act-Pastdue / Act-Ret Item, Corebridge Lapse Pending / Conservation Pending) or **computed** when paid-to is behind expected by more than the carrier's grace buffer. Keep `carrier_status_raw` and `status_reason_raw` on the snapshot; never overwrite them with the normalized value.

### Policy fields to add to the layout map

The built map covers the core fields. These are also needed:

| Canonical field | Why | Carriers that have it |
| --- | --- | --- |
| `status_reason` | Decline/cancel reason, SSL bracket codes | Aetna/Aflac/AHL (STATUSDISPLAYTEXT), SSL (Reason) |
| `status_category` | Second status layer | Aetna/Aflac/AHL (STATUSCATEGORY) |
| `status_date` | Last status change | Americo |
| `term_date` | Lapse/not-taken date | Aetna/Aflac/AHL (TERMDATE), Americo (Terminated Date), MOH (POLICY\_TERM\_DTE) |
| `draft_day` | Chosen draft day | Aetna/Aflac/AHL (DRAFTDAY, only \~22% filled) |
| `last_payment_date`, `last_payment_amount` | Attempted payment, **not proof of payment** | Aetna/Aflac/AHL |
| `premium_due_date` | Next due date | Corebridge |
| `commissionable_premium` | Basis for expected commission (excludes policy fee) | Corebridge (Target/Commissionable) |
| `annual_premium` | When only AP is given | Americo, SSL, MOH, Aetna/Aflac/AHL |
| `app_received_date`, `app_signed_date` | Submit date | most; SSL has none |
| `open_requirements` | Requirement text, posted date, responsible party | Corebridge NB file only |
| `replacement_flag` | Replacement commission rules | Aetna/Aflac/AHL (REPLACEMENTIND), MOH (REPLACEMENT\_TYPE) |
| `split_pct` | Agent split | AMAM (WrtPct), Aetna/Aflac/AHL, MOH |
| `company_code` | Issuing company | AMAM (110/770), Aetna/Aflac/AHL (ACC/TIER/AMH) |
| `issue_age`, `underwriting_class`, `email`, `ssn_last4` | Rate card band, client matching | varies; SSN last 4 only MOH (treat as sensitive) |

### Commission fields to add

| Canonical field | Source examples |
| --- | --- |
| `carrier_action_code` (raw) | AMAM Action (DELIVR / PSTDUE / NOPREM / CANCEL), MOH Activity Type, Corebridge Comm Type, ACC/TIER/AMH COMMISSIONTYPE |
| `commission_category` | ACC/TIER/AMH: Advance, Initial, First Year, Renewal, Adjustments |
| `advance_balance` | AMAM Adv Bal, Corebridge Outstanding Adv Balance |
| `months_paid` | Americo PAID n, MOH MOS |
| `duration` | MOH DUR (F = first year), Corebridge FY/REN |
| `statement_date`, `pay_period` | every file |
| `account_balance_begin/end` | statement summaries (Americo Advances account, SSL, Corebridge Primary) |
| `upline_or_writing` | whether the line is the writer's commission or an upline override |

Map each raw action code to your entry types with a per-carrier table (section 3). Two entry types are missing from the built list: **recovery** (unearned-advance chargeback distinct from a reversal of a single payment) and **as\_earned** (Americo AE-NA). Add both, or document that chargeback covers recovery.

## Per-carrier configuration

Eight carriers, six file layouts: Aetna (ACC), Aflac (TIER) and AHL (AMH) share one 46-column policy file and one Commission-Detail file, so **one layout map and one config profile serve all three**. The `carrier_config` table below is the seed; every number is per carrier and editable.

### carrier\_config seed

| Carrier | Has paid-to | Bill method in file | Client phone in file | First-pay window (issue → closed) | Later-pay window | Pay trigger | Pay cycle | Advance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AMAM | yes (PaidtoDate) | yes (Form) | yes | \~30 days past PolicyDate → NotTaken *(measured)* | Act-Pastdue up to \~60 days past paid-to *(measured)* | issue/delivery (DELIVR) | daily | 75%, 9 months |
| Aetna / Aflac / AHL | yes (PAIDTODATE) | yes (EFT / DIRECT BILL, M/Q) | yes | EFT: Not Taken \~24–27 days after effective; Direct Bill: lapse at **effective + 45** *(measured)* | **paid-to + 45 days** *(measured, exact)* | first premium received | weekly, Friday | 9 months × monthly premium × rate |
| Corebridge | Premium Due Date only | yes (Billing Method) | no | Pending Issue → Not Taken (days to measure) | Lapse Pending → Conservation Pending → lapse (grace \~31 *to confirm*) | first premium / placed *(inferred)* | weekly | 75%, 9 months |
| Mutual of Omaha | yes (PAID\_TO\_DTE) | no (commission Bill Type only) | fields empty | unknown | paid-to vs today; status lags | issue (NEW ISS) | per statement period | terms *to confirm* |
| Americo | **no** | no | no | **\~8 days** after effective → Cancelled *(measured, fastest)* | unknown | paid months (AE-NA) + advance account | monthly portal statement | advance account; terms *to confirm* |
| SSL | **no** | no | no | \[70\] → \[NT\]/\[NP\] (days unknown) | unknown | *to confirm* | per period (TPA: illumifin/SFS) | advance with **interest** and an **advance cap** |

Other per-carrier config keys: `grace_buffer_days` (default 7: time between a draft clearing and paid-to moving), `missing_commission_days` (AMAM 3, weekly payers 10, monthly 35), `min_payout` (SSL $5; Americo and MOH hold "below minimum" amounts), `commission_cap` (Americo: as-earned over $2,500 per life held 30 days), `exclude_rows` (SSL "TEST TEST").

### Status maps

| Carrier | Raw → normalized |
| --- | --- |
| AMAM | Pending, NeedReqmnt → SUBMITTED · Incomplete, Withdrawn → WITHDRAWN · Declined → DECLINED · IssNotPaid → APPROVED\_UNPAID · NotTaken, InfNotTaken → NOT\_TAKEN · Active → ACTIVE · Act-Pastdue, Act-Ret Item → AT\_RISK · Terminated → LAPSED · RPU → PAID\_UP |
| Aetna / Aflac / AHL (STATUSCATEGORY) | Pending → SUBMITTED · Decline → DECLINED · Closed, Withdrawn → WITHDRAWN · Issued Not In Force → APPROVED\_UNPAID · Not Taken → NOT\_TAKEN · Active → ACTIVE (AT\_RISK by paid-to rule) · Lapsed, Terminated → LAPSED |
| Corebridge | Incomplete → SUBMITTED · Pending Issue → APPROVED\_UNPAID · Active – Free Look Period, Active, Placed in Force → ACTIVE · Lapse Pending, Conservation Pending → AT\_RISK · Not Taken, Cancelled-FreeLook → NOT\_TAKEN · Surrendered → LAPSED |
| Mutual of Omaha | Inforce → ACTIVE (AT\_RISK by paid-to rule) · Lapsed – Non payment → LAPSED · others will appear; route unknowns to a review queue |
| Americo | Applied For, Incomplete, No Premium – Incomplete, Pending Outstanding Requirements → SUBMITTED · Carrier declined to issue → DECLINED · Issued, not paid → APPROVED\_UNPAID · Free Look, Active (inforce) → ACTIVE · Cancelled → NOT\_TAKEN if never ACTIVE in snapshot history, else LAPSED |
| SSL (Status + Reason) | Pending \[70\] → APPROVED\_UNPAID · Pending \[72\], \[PH\], \[UC\] → SUBMITTED · Declined \[DC\] → DECLINED · Cancelled \[UW\] → WITHDRAWN · Cancelled \[NT\] → NOT\_TAKEN · Cancelled \[NP\], Lapsed \[CV\]/\[CA\] → LAPSED · Active → ACTIVE |

The status map needs three features the layout map alone cannot give: a **two-field key** (status + reason for SSL, category + display text for ACC/TIER/AMH), a **history-dependent rule** (Americo Cancelled), and an **unknown-value queue** so a new raw status never silently normalizes to nothing.

### Commission action-code maps

| Carrier | Advance | Earned | Chargeback / recovery | Reversal | Other |
| --- | --- | --- | --- | --- | --- |
| AMAM | DELIVR | — (daily file is advances only) | NOPREM (9/9), CANCEL (8/9), PSTDUE (7/9 seen) | — | Freq MPAC = bank draft, MDIR = direct bill |
| Aetna / Aflac / AHL | Advance Commission Override | Commission Override ($0 lines track premium movement) | Recover Unearned Advance; Refund of Unearned Commissions | Commission Override with **negative** premium = bounced draft | override (upline) lines |
| Corebridge | AD | AE | 13 (month-13 unearned) | AE +/− pair on the same policy = reversed payment | TA terminated agent, FY/REN, \* replacement |
| Mutual of Omaha | (new issue, not seen directly) | BFY PAYMENT (applied to advance balance) | LAPSE | NEW ISS REV | "UNDER PAY THRESHOLD" = held |
| Americo | advance account balance | AE-NA (as-earned, not advanced) | via Advances account | — | below-minimum hold; cap hold |
| SSL | not seen yet | First Year / Renewal by line | not seen yet | — | **AI Advance Interest** (fee); advance-limit notice |

### File quirks the parser must handle

- **SSL** policy file is SpreadsheetML (.xls that is XML). Reason codes are in brackets inside the text. Drop "TEST TEST" rows.
- **Corebridge** sends two policy files (New Business and Policies) with different columns; join on policy number. Commissionable premium is lower than premium.
- **Americo, Corebridge (weekly), SSL** commission statements arrive as **PDFs**; they need a PDF table parser per layout, plus the account-balance summary block.
- **Americo** policy export only started 09-08; earlier dates have commissions only.
- **MOH** policy file holds **issued business only** (no pending or declines) and lags the commission file.
- **AMAM** "IssDate" on the advances file is the PolicyDate (often in the future), not an issue date. "RecvDate" follows paid-to, not app receipt.
- **ACC/TIER/AMH** LASTPAYMENTDATE / LASTPAYAMT are filled on never-paid policies; treat them as billed, not received. AHL quarterly shows 1/3 of the modal premium there (unexplained).
- Commission files in Drive are the **upline's (Aidan Coleman's) override statements**, not the writing agents'. Every line must carry who it pays.

## Problem 1: First-draft failures

About **82% of all lapses at Aetna, Aflac and AHL are first payments that never cleared**, all on mailed bills, and on 09-01 there were **125 such live policies ($78.3k AP)** still showing Active. AMAM had 28 IssNotPaid policies past due (27 on Direct Notice). The feature is a daily "First Payment Missed" list built before the carrier closes the policy.

### Rule

```
first_payment_missed =
    status_norm in (APPROVED_UNPAID, ACTIVE)
 and due_date < today − grace_buffer_days          # config, default 7
 and paid_to_date <= effective_date                # paid-to never moved
where due_date = draft date if known, else effective_date
      days_left = first_pay_window_end − today     # from carrier_config
```

| Carrier | Carrier-specific signal | Due date | Amount due |
| --- | --- | --- | --- |
| AMAM | IssNotPaid, PolicyDate passed, PaidtoDate = PolicyDate | PolicyDate | ModePrem |
| Aetna / Aflac / AHL | Active – Premium paying with PAIDTODATE = ORIGEFFDATE (status stays Active), or "Approved; EFT payment pending" past effective | DRAFTDAY if filled, else ORIGEFFDATE | CURRENTMODALPREMIUM |
| Corebridge | Pending Issue / Placed in Force past Premium Due Date | Premium Due Date | Billable premium |
| Mutual of Omaha | PAID\_TO\_DTE = POLICY\_EFFECTIVE\_DTE after effective | effective | PREMIUM |
| Americo | "Issued, not paid" past Effective Date. **Always red** (\~8-day window) | Effective Date | AP ÷ 12 |
| SSL | Reason \[70\] Approved – Awaiting Issue | Issue Date | AP ÷ 12 |

**Confirmed failure (too late, still record):** yesterday APPROVED\_UNPAID or never-paid ACTIVE → today NOT\_TAKEN, or a NOPREM / NEW ISS REV / Recover Unearned Advance line. Store it for placement stats and a re-apply call (scenario S7).

**Output columns:** carrier · agency · policy · insured · phone · agent · product · payment method · modal premium · due date · days late · days left · advance at risk (AP × rate × 75%) · status yesterday → today. Sort by advance at risk, then days left.

**Data from outside the carrier file:** phone for Corebridge, MOH, Americo, SSL and payment method for MOH, Americo, SSL must come from our own application record, joined on policy number. The draft date the client chose should also be stored at application, because DRAFTDAY is mostly blank.

## Problem 2: Lapse and retention windows

A retention window runs from the first day a policy is at risk to the day the carrier ends it; **`days_left = window_end − today`** is the number every board sorts by. Aetna/Aflac/AHL lapse at exactly **paid-to + 45 days** (44/44, 69/69 and 82/83 lapses matched), so their windows are known to the day. Americo gives about a week. AMAM gives the most room.

### Windows (config)

| Carrier | First payment | Later payment | Source |
| --- | --- | --- | --- |
| Aetna / Aflac / AHL | EFT: \~24–27 days to Not Taken (range 10–58); mailed bill: effective + 45 | paid-to + 45 | measured |
| AMAM | \~30 days past PolicyDate | Act-Pastdue to \~60 days past paid-to; Act-Ret Item \~28 | measured |
| Americo | \~8 days | unknown | measured / to confirm |
| Corebridge | unknown | status path only | to measure from snapshots |
| MOH, SSL | unknown | unknown | to measure |

### Later-payment rule

```
expected_paid_to = effective_date + modes_elapsed(mode, today)
later_payment_missed = status_norm = ACTIVE and months_paid >= 1
                       and paid_to_date < today − grace_buffer_days
window_end = paid_to_date + later_pay_window_days   # 45 for ACC/TIER/AMH
```

Quarterly mode moves paid-to by 3 months per payment, and one missed quarterly draft is three months at once (AHL: 98 of 99 lapses were quarterly direct bill).

### Retention board

One board, rows tagged by scenario. Urgency colour: ≤ 3 days left red, ≤ 7 amber; Americo first-payment always red.

| # | Scenario | Trigger | Main signal |
| --- | --- | --- | --- |
| S0 | Pre-draft reminder | draft due in ≤ 7 days on mailed bill or new EFT | AMAM IssNotPaid Direct Notice; ACC/TIER/AMH upcoming effective |
| S1 | First payment missed | Problem 1 rule | see above |
| S2 | Draft bounced | returned draft | AMAM Act-Ret Item; ACC/TIER/AMH negative premium line; Corebridge AE +/− |
| S3 | Later payment missed | later-payment rule | AMAM Act-Pastdue; MOH Inforce with stale paid-to |
| S4 | Carrier conservation | carrier flags it | Corebridge Lapse Pending / Conservation Pending |
| S5 | Cancel request / free look | Requested Termination, Cancelled-FreeLook, Surrendered, SSL \[NT\] | same-day save call |
| S6 | Recently lapsed | lapsed ≤ 30–60 days | reinstatement |
| S7 | Recently not taken | not taken ≤ 30 days | rewrite with the right payment setup |
| S8 | Structural risk | active on mailed bill or quarterly | proactive EFT conversion |
| S9 | Data mismatch | policy Active, commission shows lapse | MOH seen |

**Priority score** = unearned advance $ × urgency (3 / 2 / 1) × save likelihood (EFT bounce 0.6, mailed-bill first payment 0.4, reinstatement 0.25; tune from real save rates). Each scenario's "saved" and "lost" outcome is read from the next day's snapshot.

## Problem 3: Chargeback exposure

Every advancing carrier pays 9 months of commission up front and claws back the unearned part when a policy fails; the exposure on any policy is **advance × (9 − months\_paid) / 9**. AMAM proves it exactly: an advance of $552.95 was charged back −$430.06 (PSTDUE) = 7/9 after two paid months.

### Formulas

```
advance          = AP_commissionable × rate × 0.75        # = 9 × monthly premium × rate
months_paid      = months between effective_date and paid_to_date
unearned_at_risk = advance × max(0, 9 − months_paid) / 9   # 0 after month 9
example: $50/mo, 145% → advance $652.50; after 2 paid months $507.50 at risk
```

| Carrier | Chargeback signal | Timing | Size seen |
| --- | --- | --- | --- |
| AMAM | PSTDUE, then CANCEL / NOPREM; Adv Bal → 0 | posts **while past due**, before Terminated | exact 9ths |
| Aetna / Aflac / AHL | Recover Unearned Advance | the Friday statement after the lapse | not exact 9ths yet: 0 paid ≈ 91–93%, 1 paid ≈ 73–86%, 2 paid ≈ 60–75%, 5 paid ≈ 43% |
| Corebridge | AD reversal; 13 (month-13 unearned) | after surrender/lapse; one seen while still Pending Issue | outstanding annualization balance |
| Mutual of Omaha | LAPSE, NEW ISS REV | can arrive before the policy file shows the lapse | remaining advance balance |
| Americo | Advances account balance grows | monthly | rules to confirm |
| SSL | not seen yet; **advance interest** accrues on any balance | per period | unearned + interest |

### Features

1. **$ at risk per policy** on the retention board (above), and rolled up per agent, carrier and agency.
2. **Expected chargeback:** when a policy lapses in the snapshot, expect a recovery line. None within 14 days → "expected chargeback not posted".
3. **Chargeback without lapse:** a recovery line while the policy file shows Active → mismatch alert (S9).
4. **Debit balance tracker** per carrier account: beginning balance, advances, chargebacks, interest, ending balance. AHL carried about −$2,990 and Corebridge −$849.98 into the next period; Aflac paid $0 in a week with −$2,130 of recoveries. The agent is not paid until the balance clears, so show weeks-to-clear.
5. **Advance cap and interest** (SSL): store the cap and rate in config; alert when the balance nears the cap, since new advances get cut back.
6. **Chargeback ratio** = chargebacks ÷ advances, rolling 90 days, per agent and carrier.

## Problem 4: Pending requirements

Only Corebridge and SSL say **what** a pending app is waiting for; the other six only say **that** it is pending, so the pending board needs a manual entry path from day one. On 09-01 AMAM had 54 Pending (median 14 days, max 41) and 32 Incomplete (median 70 days), AHL 27 pending (max 42 days), Americo 17 with outstanding requirements.

| Carrier | Pending statuses | Requirement detail | Age from |
| --- | --- | --- | --- |
| Corebridge | Incomplete, Pending Issue | **Open Requirement(s)** column: description; posted date; responsible party (NB file) | App Received |
| SSL | Pending + reason | \[72\] signed amendment · \[PH\] medical records · \[UC\] underwriter call to client · \[70\] approved, awaiting issue | none in file (use our app date) |
| AMAM | Pending, NeedReqmnt, Incomplete | status only | App Date |
| Americo | Applied For, Pending Outstanding Requirements, Incomplete, No Premium – Incomplete | status only | Received Date, Status Date |
| Aetna / Aflac / AHL | New Business – in process | status only | APPRECDDATE |
| Mutual of Omaha | not in file (issued only) | none | needs portal report |

### Features

1. **Pending clock** on every SUBMITTED app: days since received. Amber > 14 days, red > 30.
2. **Day-one action items** for any status that means a specific requirement: NeedReqmnt, Pending Outstanding Requirements, No Premium – Incomplete (banking), SSL \[72\]/\[PH\]/\[UC\], any Corebridge open requirement. Don't wait for aging.
3. **Requirement parser:** split the Corebridge column into requirement, posted date and responsible party; map SSL codes to text and responsible party (amendment → client, PHI → doctor, call → client).
4. **Manual requirement log** on the board: what, responsible party (agent / client / doctor / carrier), due date, owner, notes. Later, a shared inbox for carrier requirement emails can feed it.
5. **Lost to requirements:** SUBMITTED → Closed / Incomplete / Withdrawn / \[UW\] counted per agent and carrier.
6. **Slow-issue alert:** app older than the carrier's p75 submit-to-issue without a decision (Aetna 11 days, Aflac 16, AHL 25).

Board columns: carrier · agency · app # · client · phone · agent · product · AP · received · days pending · requirement · responsible party · next step · owner · last update.

## Problem 5: Missing commissions

A commission is missing when the carrier's pay trigger has happened, the carrier's normal lag has passed, and **no commission line exists for that carrier + policy number**. The trigger differs by carrier, so the clock must start from a config value, not one global date.

| Carrier | Pays on | Clock starts at | Days before alert (`missing_commission_days`) |
| --- | --- | --- | --- |
| AMAM | issue / delivery (paid before the first draft) | PolicyDate, or first snapshot showing an issued status | 3 (daily file) |
| Mutual of Omaha | issue | POLICY\_ISSUE\_DTE | per statement period, *to confirm* |
| Aetna / Aflac / AHL | first premium received | first snapshot where PAIDTODATE > ORIGEFFDATE | 10 (weekly Friday) |
| Corebridge | first premium / placed *(inferred)* | Placed in Force or paid-to moving | 10 (weekly) |
| Americo | paid months (as-earned) plus advance account | effective date + first payment | 35 (monthly) |
| SSL | *to confirm* | *to confirm* | 35 |

### Matching rules

- Match on **carrier + normalized policy number** (strip spaces, prefixes, leading zeros per carrier rule).
- **Paid but not in book:** a commission line whose policy number is in no policy file → wrong agent or agency coding, or a carrier not yet ingested.
- **Upline vs writer:** the Drive statements are Aidan Coleman's override statements. A policy can be "paid" to the upline and missing for the writer, or the other way round. Track presence per payee level.
- **Held amounts:** "below minimum" (Americo, MOH) and cap holds (Americo > $2,500) are *received but held*, not missing. Carry them as `held` until released.

Output: missing-commission list with policy · carrier · product · agent · trigger · trigger date · days since · expected $ · status.

## Problem 6: Rate check (contracted vs received)

The rate check compares each received advance with what the contract says it should be; today the only rates we have are the ones seen on statements, so **the rate card must store its source** and be replaced by contract schedules as the agency supplies them.

### rate\_card table

`carrier, product_code, tier, age_min, age_max, level (agent / upline), first_year_rate, advance_pct, advance_months, renewal_rate, effective_from, effective_to, rate_source (contract | statement-observed)`

| Carrier · product | Rate seen | Notes |
| --- | --- | --- |
| AMAM Senior Choice Immediate (CCI) | 145% | 110% at age 80 (age band) |
| AMAM Senior Choice CCR / CCG tiers | 130% |  |
| Corebridge SimpliNow Legacy Max | 147% | Legacy 102% on one line |
| Aflac Final Expense Level | 143% | Modified not seen |
| Aetna Final Expense Level / Modified | 120% / 110% |  |
| AHL Final Expense Level / Modified | 120% / 120% | Modified at 120% *to confirm* |
| Mutual of Omaha Living Promise | 82.5% | may be after the MGA share |
| Americo Eagle Select | .75 override seen | rates *to confirm* |
| SSL New Vantage I/II/III | not seen |  |
| AMAM Easy Term, Term Made Simple | not seen |  |

### Expected vs received

```
expected_advance = commissionable_premium_annual × rate(level, product, tier, issue_age) × advance_pct
  ACC/TIER/AMH check: commissionable on the line = 9 × monthly premium
  override expected  = upline_rate − writing_agent_rate
expected_earned_to_date = monthly_premium × rate × months_paid   # capped at the advance through month 9
received_net      = Σ advances + earned − chargebacks ± reversals − fees (interest)
```

### Alerts

| Alert | Rule | Likely cause |
| --- | --- | --- |
| Underpaid / overpaid | received advance differs from expected by > $5 or > 2% | wrong rate, age band, split or contract level |
| Wrong premium basis | statement commissionable premium ≠ policy premium (after known exclusions) | mode error, policy fee, riders |
| Replacement | REPLACEMENTIND / REPLACEMENT\_TYPE set | reduced or no commission; check the rule before alerting |
| Rate drift | a product's received rate moves vs its rate card | contract change or carrier error |

A rate check cannot run for a policy without three inputs: the writer's contract level, the issue age, and a rate card row for that product and band. Show "cannot check" with the missing input rather than a false pass.

## Lifecycle, recovery and how the team works

The six problems sit on one policy lifecycle, and three more features close the loop: real milestone dates, a recovery state after a save, and one client record across carriers.

### Milestone dates

| Milestone | Source | Gap |
| --- | --- | --- |
| Submitted | carrier app date, else our CRM | SSL has none |
| Issued | carrier issue field | AMAM and Americo have none: use the **first snapshot date with an issued status** (AMAM: day the DELIVR advance appears confirms it) |
| Effective | carrier effective field |  |
| Placed | first snapshot where paid-to > effective, or a paying status | AMAM, Americo, SSL by status only |
| Outcome (declined, withdrawn, not taken) | first snapshot showing it |  |

Measured submit → issue medians: Aetna 7 days (p90 42), Aflac 8 (p90 39), AHL 7 (p90 39), Americo 15 (p90 28), MOH mostly 0–4. The p90 tail is apps stuck on requirements.

### Placement KPIs

Placement ratio = placed ÷ decided apps, cohort by app month, matured after \~60 days. Measured: AMAM 43%, Americo \~40%, SSL 40%, Aflac 30%, Aetna 28%, AHL 28%. Aetna/Aflac/AHL approve about half and only about half of approved clients ever pay. Normalize decline reasons to: health/Rx knockout, over coverage limit, medical history, underwriting decline, unable to underwrite, other. Alert when an agent's decline rate is 15 points over the carrier average, or a carrier's take rate drops under 50%.

### Recovery after a save

A saved policy moves through stages before it counts as healthy: AT\_RISK → FIX\_IN\_PROGRESS (logged by a person; carriers don't report it) → RECOVERING (paid-to moves or status returns to Active) → STABLE after **2 on-time payments** (to decide: 2 or 3). A return to AT\_RISK within 90 days is RELAPSED; a lapsed policy that comes back is REINSTATED.

_Diagram (in the live doc): recovery stages AT_RISK → FIX_IN_PROGRESS → RECOVERING → STABLE; AT_RISK → LAPSED → REINSTATED → RECOVERING; relapse within 90 days returns to AT_RISK._

Only FIX\_IN\_PROGRESS needs a person; every other move is read from the next snapshot.

| Carrier | "Fixed" signal | Commission confirmation |
| --- | --- | --- |
| AMAM | Act-Ret Item / Act-Pastdue → Active; PaidtoDate moves | no new PSTDUE / CANCEL |
| Aetna / Aflac / AHL | PAIDTODATE jumps forward (status never changed) | positive Commission Override premium |
| Corebridge | Lapse/Conservation Pending → Active; Premium Due Date moves | AE lines resume |
| Mutual of Omaha | PAID\_TO\_DTE catches up (status stays Inforce) | BFY PAYMENT resumes |
| Americo, SSL | status back to Active only (weak) | statement lines resume |

Fix log fields: fix type (redraft, bank change, new draft date, EFT conversion, card payment, reinstatement), date, who, notes. Alert **"recovered but charged back"** when a chargeback posted before the save, so ops can ask the carrier to re-advance.

### One client across carriers

In the 09-01 files, 495 clients had more than one policy or app, 223 of them with different agents, and 59 had 2+ active policies. Match tiers: exact (last name + DOB + phone, ZIP or first-name prefix) auto-merge · strong (nickname/typo first name + last + DOB) auto-merge flagged · probable (name + phone or address, no DOB) review queue · household (same phone/address, different person) link only. Americo and SSL carry name only, so their matches stay weak until our app record joins in. **Lead source is in no carrier file**; it comes from our CRM.

### Team workflow the boards must support

1. **Every file drop** (daily for AMAM; weekly for ACC/TIER/AMH and Corebridge statements; monthly for Americo): ingest, normalize, snapshot, diff, rebuild boards. "Real-time" means per file drop.
2. **Retention rep** works the retention board top-down by priority score, logs each contact and fix. The writing agent is the fallback owner.
3. **Ops** owns the pending board and the manual requirement log; ops also checks the carrier portal when a file lacks detail (requirements, payment method, contact).
4. **Commission reviewer** works the missing-commission and rate-check lists weekly, after the Friday statements land.
5. **Next day**, outcomes update themselves from the snapshot (saved, lost, issued, paid), giving save rate per scenario, carrier and rep.

## Open questions and gaps

The engine can be built now with the measured config; these items change values, not structure. The team roles in the workflow above are a proposal. Ops has not confirmed who owns requirements and retention calls.

### Build decisions (Olti)

- [ ] Grace buffer between due date and "missed": 7 days (data) or 3 days (earlier suggestion)?
- [ ] STABLE after 2 or 3 on-time payments?
- [ ] Add `recovery` and `as_earned` as commission entry types, or fold them into chargeback / earned?
- [ ] Agent attribution when two agents wrote the same client: first lead date or the placing agent?
- [ ] Do agents see the retention board, or only reps and ops?

### From the agency or carriers

- [ ] Contract rate schedules for all carriers, by product, age band and level (agent and upline), plus each writing agent's level.
- [ ] The writing agents' own statements, or confirmation that we reconcile only the upline statements.
- [ ] Grace and lapse rules for Corebridge, MOH, Americo and SSL; confirm Americo's \~8-day cancel.
- [ ] Earn-off rule at ACC/TIER/AMH (9ths or pro-rata) and how overrides are recovered.
- [ ] Advance terms for MOH, Americo and SSL; SSL advance interest rate and Aidan's advance cap.
- [ ] Does reinstatement reverse a chargeback, or does the carrier re-advance?
- [ ] Commission rules on replacements (MOH internal replacements, ACC/TIER/AMH REPLACEMENTIND).
- [ ] Pending/declined reports for Corebridge and MOH; which portals can export pending requirements.
- [ ] Code meanings: AMAM company 770, CCR vs CCG, the 2/3 digit; MOH Bill Type BSP and MOS; Americo DU / PRO / LV.

### Data that only time gives us

- [ ] A month of daily snapshots to measure: lag from a cleared draft to paid-to moving, reinstatement status codes, Corebridge/MOH/SSL windows, time to close incomplete apps.
- [ ] Heritage and Unlimited file layouts (folders exist; layouts unverified).
- [ ] Why AHL quarterly LASTPAYAMT shows 1/3 of the modal premium.

### Sources

All figures come from the Power Policies project docs, built from the Safe Harbour 09-01-2026 files (Americo policies 09-08): book-of-business blueprint, Problems #1–#6 docs, retention playbook, submission-to-issue, declines and placement, product catalog, client matching, carrier scorecard, and the eight carrier lesson plans.

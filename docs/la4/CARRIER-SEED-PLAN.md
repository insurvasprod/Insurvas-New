# LA-4 carrier seed plan

What [CARRIER-KNOWLEDGE.md](CARRIER-KNOWLEDGE.md) (Olti, 2026-10-07) means for what is built. Written 2026-10-07 and checked against production the same day.

Nothing below is written to the platform until it is approved. Approved status mappings and platform rules can't be changed or deleted afterwards.

## 1. What already agrees

- **The nine statuses** match 4.5's `status_normalized` exactly: submitted, declined, withdrawn, approved_unpaid, not_taken, active, at_risk, lapsed, paid_up.
- **The unknown-value queue** is 4.5's `unmapped_status_queue`. A new raw word is held and never guessed.
- **Raw status is kept:** `carrier_status_raw` is on the snapshot.
- **Rule types** in 4.17 already cover the spec's windows: first_payment, ongoing_payment, conservation and cancellation_request. Rules are marked `observed` and unverified.
- **Seeds already live:** Aetna ongoing payment, 45 days; Americo first payment, 8 days. The spec measures both and agrees with both.
- **Computed AT_RISK** already exists in 4.7: an active policy whose days past paid-to exceed `grace_days` reads at_risk. The spec's `grace_buffer_days` is that `grace_days`.
- **Matching tiers** (exact, strong, probable, household) are close to 4.8's ladder plus 4.9's provisional clients.

## 2. Carrier library: approval needed

In production today: aetna, american_national, americo, foresters, gerber, mutual_of_omaha, national_life, transamerica.

These are missing:

| Add | Code | Note |
|---|---|---|
| American-Amicable (AMAM) | `amam` | Company codes 110 and 770 come in one file. |
| Aflac (TIER) | `aflac` | Shares the ACC/TIER/AMH file with Aetna. |
| AHL (AMH) | `ahl` | Same file. |
| Corebridge | `corebridge` | Two policy files, joined on policy number. |
| Sentinel Security Life (SSL) | `ssl` | SpreadsheetML file. |

**Decision: the shared ACC/TIER/AMH file.** We recommend keeping three carriers. The layout map is attached to the Aetna carrier, and `company_code` routes each row to aetna, aflac or ahl. This keeps rates, placement and chargebacks separate for each carrier, which the spec reports separately.

## 3. Platform rules: proposed seed

Every row below is marked observed and unverified, effective 2026-09-01. They are taken from the spec's measured values only. Values the spec marks *to confirm* are left out.

| Carrier | Rule | Window | Grace | Basis |
|---|---|---|---|---|
| AMAM | first_payment | 30 | 7 | about 30 days past PolicyDate to NotTaken |
| AMAM | ongoing_payment | 60 | 7 | Act-Pastdue up to about 60 days past paid-to |
| Aetna | first_payment | 24 | 7 | EFT not taken at 24–27 days. We use the short end; see gap G3. |
| Aetna | ongoing_payment | 45 | 7 | Exists. Grace is missing, so computed at-risk never fires today; see gap G1. |
| Aflac, AHL | first_payment / ongoing_payment | 24 / 45 | 7 | Same file and rule as Aetna. |
| Americo | first_payment | 8 | 7 | Exists, without grace. With an 8-day window, a 7-day grace leaves a single day of warning; see decision D1. |

Corebridge's 31 days and everything for MOH and SSL are *to confirm*. They aren't seeded, so those carriers show "no rule" rather than a guess.

## 4. Status mappings: for approval, one carrier at a time

Proposed as written in the spec. Each mapping is approved in `/admin/status-maps` by the person who signs it off.

| Carrier | Raw | Normalized |
|---|---|---|
| AMAM | Pending, NeedReqmnt | submitted |
| | Incomplete, Withdrawn | withdrawn |
| | Declined | declined |
| | IssNotPaid | approved_unpaid |
| | NotTaken, InfNotTaken | not_taken |
| | Active | active |
| | Act-Pastdue, Act-Ret Item | at_risk |
| | Terminated | lapsed |
| | RPU | paid_up |
| ACC/TIER/AMH (STATUSCATEGORY) | Pending | submitted |
| | Decline | declined |
| | Closed, Withdrawn | withdrawn |
| | Issued Not In Force | approved_unpaid |
| | Not Taken | not_taken |
| | Active | active |
| | Lapsed, Terminated | lapsed |
| Corebridge | Incomplete | submitted |
| | Pending Issue | approved_unpaid |
| | Active – Free Look Period, Active, Placed in Force | active |
| | Lapse Pending, Conservation Pending | at_risk |
| | Not Taken, Cancelled-FreeLook | not_taken |
| | Surrendered | lapsed |
| Mutual of Omaha | Inforce | active |
| | Lapsed – Non payment | lapsed |
| Americo | Applied For, Incomplete, No Premium – Incomplete, Pending Outstanding Requirements | submitted |
| | Carrier declined to issue | declined |
| | Issued, not paid | approved_unpaid |
| | Free Look, Active (inforce) | active |
| | Cancelled | *history-dependent (G2)* |
| SSL (status + bracket code) | Pending [70] | approved_unpaid |
| | Pending [72], [PH], [UC] | submitted |
| | Declined [DC] | declined |
| | Cancelled [UW] | withdrawn |
| | Cancelled [NT] | not_taken |
| | Cancelled [NP], Lapsed [CV], Lapsed [CA] | lapsed |
| | Active | active |

**Mutual of Omaha "ACTIVE".** It is in the queue now, holding 1,201 rows from one agency. The spec maps Inforce to active, and "ACTIVE" is the same meaning, so we recommend approving it as active. AT_RISK then comes from paid-to.

**Exact spelling.** The strings above are as the spec writes them. A mapping must match the raw word byte for byte: case, dashes ("–" vs "-") and spacing. So the real words are taken from the queue when a file arrives, not typed from this table. Words that don't match exactly would just wait in the queue, which is safe.

**Two-field keys.** SSL's reason code sits inside the status text ("Cancelled [NT]"), so the existing single-string key already works if the layout map sends the whole text. For ACC/TIER/AMH, mapping STATUSCATEGORY alone is enough. No schema change is needed unless a carrier sends the two parts in separate columns.

## 5. Gaps the build needs

| # | Gap | Where | Size |
|---|---|---|---|
| G1 | Platform rules need `grace_days`, or a platform default (7), or computed at-risk never fires. | Seed or 4.7 default | small |
| G2 | **History-dependent mapping** (Americo Cancelled): not_taken if the policy was never active in snapshot history, else lapsed. This needs a mapping target such as `by_history`, resolved in snapshot derivation. | 4.5 + 4.6 | medium |
| G3 | **Bill method on rules:** ACC/TIER/AMH first payment is 24–27 days on EFT and effective + 45 on direct bill. Rules have no bill-method dimension yet. | 4.17 | medium |
| G4 | **No paid-to** (Americo, SSL; Corebridge only has Premium Due Date): days past due is null, so there's no countdown. The fallback should be effective date, or premium_due_date. | 4.7 | small |
| G5 | **approved_unpaid has no countdown.** 4.7 counts down only for active/at_risk. AMAM IssNotPaid is exactly the first-draft failure (Problem 1). | 4.7 | small |
| G6 | **Extra canonical fields:** status_reason, status_category, term_date, draft_day, last_payment_date/amount (billed, not received), premium_due_date, commissionable_premium, annual_premium, app dates, open_requirements, replacement_flag, split_pct, company_code, issue_age, underwriting_class, email, ssn_last4 (sensitive). | 4.3 + 4.6 | medium |
| G7 | **Parsers:** SpreadsheetML (SSL), joining the two Corebridge files, PDF statements (Americo, Corebridge, SSL), and an `exclude_rows` filter ("TEST TEST"). | 4.2 | large (PDF) |
| G8 | **Commission side** (all of it belongs to 4.12): the action-code map per carrier; `recovery` and `as_earned` entry types (decision D3); `held` amounts; payee level (upline vs writer); advance balance; account balance summaries; `missing_commission_days`, `min_payout`, `commission_cap` and advance interest/cap config. | 4.12 | large |
| G9 | **rate_card** with `rate_source` (contract or statement-observed), and "cannot check" when an input is missing. | rate check task | medium |
| G10 | **Recovery states** (FIX_IN_PROGRESS through RELAPSED/REINSTATED), a fix log, scenarios S0–S9, and the priority score. | retention board task | medium |
| G11 | **Pending:** a requirement parser (Corebridge column, SSL codes), a manual requirement log, the pending clock, and slow-issue p75. | pending board task | medium |

## 6. Decisions for Olti

- **D1 Grace buffer, 7 or 3 days.** With Americo's 8-day window, 7 leaves one day. We suggest 7 by default with a per-carrier override, and 3 for Americo.
- **D2 STABLE after 2 or 3 on-time payments.**
- **D3** Should `recovery` and `as_earned` be separate entry types? We suggest yes. They behave differently from a single reversal and from earned.
- **D4 Agent attribution** when two agents wrote the same client.
- **D5** Do agents see the retention board?

## 7. Effect on the next tasks

- **4.11 Policy list and detail:** ships after G1, G4 and G5, so first-draft failures and countdowns show for every carrier. It adds a "days left" sort and the first-payment-missed filter (Problem 1).
- **4.12 Commission ledger:** take the G8 shape from the start, so action codes, payee level and held amounts aren't retrofitted later.
- **Later boards:** G9, G10 and G11 are the rate check, retention and pending boards. Their structure is now known; only the values wait on the agency.

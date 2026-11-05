# Carrier status words → normalized status → Sales pipeline stage

Checked on 2026-11-05 against the real carrier files (`Downloads\Safe_Harbour_Edited_Files - corrected`, 15 files, 8 carriers, read 2026-10-01). Every status word in those files has an approved mapping; nothing gets stuck in the unknown-status queue.

**How a file moves a card:** the carrier's word is mapped to one of LA-4.5's nine statuses (`carrier_status_map`, exact match). Each status raises an event (`lib/pipelineRules/events.ts`), and a pipeline rule moves the lead's card to the matching stage. Rules start in Forecast and move cards once switched to Live (Book of business › Setup › Pipeline rules).

## The nine statuses and where they go

| Normalized status | Event | Sales pipeline stage |
| --- | --- | --- |
| submitted | Submitted (carrier file) | Submitted |
| approved_unpaid | Issued | Issued |
| active | In force | In force |
| at_risk | At risk | At risk |
| paid_up | Paid up | Paid up |
| lapsed | Lapsed (Not taken when nothing was ever paid, see below) | Lapsed |
| not_taken | Not taken | Not taken |
| declined | Declined | Declined |
| withdrawn | Withdrawn | Withdrawn |

Also: a commission advance or earned line → In force; a chargeback line → Charged back; a first or later payment past the carrier's grace (7 days) → At risk; a lapsed policy that is Active again → back to In force.

**How the engine reads them (2026-11-05):**
- **Ended before it was ever paid → Not taken**, whatever the carrier's word (the owner's SOP: a cancellation inside the first draft's grace is a cancellation, after it a failed payment). With a paid-to date: paid-to on or before the effective date. Without one (Americo's file has none): the status it left was Submitted or Issued, not paid. Nothing known: the carrier's word stands.
- **The latest news decides.** A status the policy has since left, a first sighting whose status has changed since, and a commission line older than the latest status change move nothing.
- **A link is news.** A policy linked to its lead after its file was read (by a person, or a policy number added later) raises its status on the link day.
- **Every open stage.** Starter rules move a card from every open stage of every pipeline and from the other pipelines' sold stages; a stage added later joins them automatically. An owner's own rule is left as written.
- **Rules act on news only.** A rule switched Live acts from then on; Setup › Pipeline rules › Switch to live shows how many past cards a replay would move.

## Each carrier's words

| Carrier | Raw word in the file | → status |
| --- | --- | --- |
| **American Amicable** | Pending, NeedReqmnt | submitted |
| | IssNotPaid | approved_unpaid |
| | Active | active |
| | Act-Pastdue *(was active, corrected 20261105100000)*, Act-Ret Item | at_risk |
| | RPU | paid_up |
| | Terminated | lapsed |
| | NotTaken, InfNotTaken *(was lapsed, corrected)* | not_taken |
| | Declined | declined |
| | Incomplete, Withdrawn | withdrawn |
| **Aetna, Aflac, AHL** (STATUSDISPLAYTEXT) | New Business - in process | submitted |
| | Approved; EFT payment pending | approved_unpaid |
| | Active - Premium paying | active |
| | ETI (Aflac) | paid_up |
| | Policy Lapsed, Requested Termination, Cash Surrender (AHL) | lapsed |
| | Application not taken | not_taken |
| | Auto-decline, Underwriting Decline, User Defind Dcl, Over Issue Limits-Life, Over Issue Limits-Health | declined |
| | Application Withdrawn, Closed / Incomplete | withdrawn |
| **Americo** | Pending Outstanding Requirements | submitted |
| | Issued, not paid | approved_unpaid |
| | Active (inforce), Free Look | active |
| | Lapse Pending | at_risk |
| | Cancelled, Canceled | lapsed |
| | Carrier declined to issue | declined |
| | Incomplete, No Premium - Incomplete | withdrawn |
| **Corebridge** | Pending Issue | approved_unpaid |
| | Active, Active- Free Look Period | active |
| | Lapse Pending, Conservation Pending *(were active, corrected)* | at_risk |
| | Surrendered | lapsed |
| | Not Taken, Cancelled-FreeLook | not_taken |
| **Sentinel** (Status + Reason) | Pending, Pending [72], [PH], [UC] | submitted |
| | Pending [70] Approved - Awaiting Issue | approved_unpaid |
| | Active | active |
| | Lapsed [CA], Lapsed [CV], Cancelled [CV], Cancelled [NP] *(was not_taken, corrected)* | lapsed |
| | Cancelled [NT] Not Taken | not_taken |
| | Declined [DC] | declined |
| | Cancelled [UW] Unable to Underwrite | withdrawn |
| **Mutual of Omaha** | Inforce, ACTIVE | active |
| | Lapsed - Non payment | lapsed |

## Auto-link

A policy links to its lead with no person when the number on the agent's submission equals the carrier's policy number (ladder step 2):
- the submission recorded as a **policy number**: always;
- recorded as an **application number** (AMAM turns it into the policy number): when the insured is the same person, by surname and date of birth. **Since 2026-11-05**, when the carrier's file has no birth date (Aetna, Aflac and AHL leave it empty; Americo and Sentinel carry none), by surname and the whole first name instead.

Anything else goes to the review queue for a person.

## Status of the open items (2026-11-05)

- **Grace: 7 days for every carrier.** Migration `20261105110000` is LIVE. Aetna, Aflac and AHL keep the 45-day window and Americo its 8-day first-payment window. The rows stay unverified until a person confirms each carrier in Setup › Carrier rules, and an agency can set its own.
- **Americo "Cancelled": done.** It now reads Not taken when nothing was ever paid, and Lapsed otherwise, through the rule above. Walked live: "Issued, not paid" then "Cancelled" moved the card to Not taken.
- **Declined: settled.** The owner kept Sales › Declined. On Ellery & Fields the agency's own "Declined" rule is turned off, not deleted.
- **Every carrier walked live (2026-11-05).** One file per carrier, in its own published layout, moved its card to the expected stage: Aetna (Issued, In force), Aflac (pending, Not taken), AHL (In force, Lapsed), Americo (Issued, Not taken), Corebridge (In force, At risk), Sentinel (Issued, Declined) and Mutual of Omaha (Marketing leads to In force, then Lapsed). Every policy auto-linked by its submission.
- **Starter rules from every open stage:** migration `20261105120000` (written, to paste) does this for every agency, along with Lapsed back to In force. The demo already has it.
- **Still open: three unknown carrier words** from test files, Mutual of Omaha "Active" ×2 and American Amicable "Decline" ×1. Approving a carrier word changes it for every agency, so only Insurvas staff can do it, in Admin › Status maps.

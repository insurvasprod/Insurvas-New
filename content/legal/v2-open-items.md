# Terms of Service and Privacy Policy v2: open items before publishing

`tos-v2.md` and `privacy-v2.md` are written as finished documents, but **they have not been
reviewed by a lawyer**. Do not publish them from `/admin/legal` until counsel has reviewed both and
every item below is resolved. Publishing a version sets `is_draft = false`, which removes the
"This is a draft" notice from `/legal/tos` and `/legal/privacy`, and asks every user to accept the
new version. Legal documents are append-only, so a published version cannot be withdrawn.

## Facts to supply (shown in [SQUARE BRACKETS] in the text)

| Placeholder | Where | Notes |
|---|---|---|
| `[LEGAL ENTITY NAME]` | ToS §1, Privacy intro and §14 | Exact registered name of the company |
| `[ENTITY TYPE]` | ToS §1 | e.g. limited liability company, corporation |
| `[STATE OF FORMATION]` | ToS §1 | |
| `[POSTAL ADDRESS]` | Privacy §14 | |
| `[SUPPORT EMAIL]` | ToS §4, §11, §13, §19 | Account, security and cancellation contact |
| `[PRIVACY EMAIL]` | Privacy §9, §14 | Privacy requests and appeals |
| `[LEGAL NOTICE ADDRESS]`, `[LEGAL NOTICE EMAIL]` | ToS §19 | Where formal legal notices go |
| `[GOVERNING LAW STATE]` | ToS §19 | |
| `[COUNTY, STATE]` | ToS §19 | Venue for disputes |
| `[insurvas.com/legal/refund]` | ToS §9 | The Refund Policy must be published at this address first |
| `[insurvas.com/legal/subprocessors]` | Privacy §5 | The Subprocessor List must be published first |
| `[insurvas.com/legal/cookies]` | Privacy §6 | The Cookie Notice must be published first |
| `[CONFIRM HOSTING AND DATABASE REGIONS]` | Privacy §12 | Supabase project region and the app's hosting region |

## Suggested values to confirm (bracketed numbers in the text)

| Value | Where | Notes |
|---|---|---|
| `[90]` days read-only after cancellation | ToS §13, Privacy §7 | Code default for `billing.cancelled_retention_days`; confirm the production setting |
| `[30]` days to delete on request | ToS §13, Privacy §7 | Business decision; deletion on request is built |
| `[30]` days to cure a breach | ToS §12 | Common SaaS default |
| `[12]` months of fees as the liability cap | ToS §17 | Common SaaS default |
| `[, which acts as merchant of record …]` | ToS §9 | Keep only if the Whop agreement makes Whop merchant of record |

## Decisions for counsel

- **Dispute resolution.** ToS §19 is drafted for courts with a jury waiver. Decide whether to use
  arbitration and a class-action waiver instead.
- **Liability carve-outs.** ToS §17 excludes indemnities, your breach of §6/§7, and payment
  obligations from the cap. Decide whether data-protection or confidentiality breaches need a
  separate (super) cap.
- **Indemnities.** ToS §18 has the customer indemnify for outreach/TCPA and data claims, and
  Insurvas indemnify for US IP infringement. Confirm both are acceptable commercially.
- **HIPAA.** ToS §5 prohibits use as a HIPAA business associate without a signed BAA. Many agencies
  sell Medicare and health products. Confirm this position, or offer a BAA.
- **State privacy laws.** Privacy §9 and §10 assume Insurvas may be subject to US state privacy
  laws, including the CCPA. Confirm which apply, given company size and the GLBA exemptions, and
  remove the California notice if it does not apply.
- **Automatic renewal.** Confirm the ToS §10 and §11 disclosures meet state automatic-renewal laws
  (for example, California's), including any reminder email before annual renewals.
- **Taxes.** Confirm ToS §9 against how tax is collected under the Whop arrangement.
- **Health-data encryption.** Privacy §8 lists field-level encryption only for SSNs, bank and card
  numbers, tax IDs, calendar tokens and 2FA secrets. Once health answers are confirmed encrypted
  in production (migration `20261016420000` applied and existing records sealed), §8 can say so.
- **Companion documents.** The DPA, Refund Policy, Cookie Notice and Subprocessor List drafts in
  this folder still carry their own counsel notes. They should be finalised alongside these two
  documents, because the ToS and Privacy Policy refer to them.

## How to publish

1. Resolve every bracket above in both files.
2. In `/admin/legal`, paste each document into its draft, set a change summary and require
   re-acceptance, and publish. The page header shows the version and effective date, so the text
   does not repeat them.
3. Check that `/legal/tos` and `/legal/privacy` show version 2 with no draft notice, and that
   `?v=1` still shows the original.

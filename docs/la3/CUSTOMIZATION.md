# LA-3 · What is customizable, and by whom

LA-3 is customized **per agency**, not per agent. One owner sets how the agency sells, and every
agent in it works the same way. That is what makes the frozen QA verdict and the case timeline
mean something: every application went through the same questions, disclosures and checks.

Written 2026-10-01 from the spec ([ACCEPTANCE.md](ACCEPTANCE.md),
[LA-3-BUILD-PROMPT.md](../LA-3-BUILD-PROMPT.md), [MODULE-3-EXPLAINED.md](../MODULE-3-EXPLAINED.md))
and from what the Settings → Sales screens actually do today.

## Who can change what

| Who | Where | What they control |
|---|---|---|
| **Insurvas platform staff** | Admin console → Carriers, Products, Templates, Field maps, State disclosures | The **platform defaults** every agency starts from: the carrier library, the generic Final Expense and Term Life templates, seeded disclosures, published field maps. Agencies never edit these in place. |
| **Agency owner** | Settings → Sales (and Settings → States & licences) | Everything in the next table. Changes are tenant-scoped, enforced on the server, and audited with old and new values (3.17). |
| **Agent / producer** | Profile | Only their own details: name and **phone** (the welcome pack prints the agent's phone and is held without it). Agents cannot open Settings. |

**Copy to my agency:** an owner who wants to change a platform default clicks **Copy to my agency**.
That clones it as the agency's own draft, and the platform original is untouched (3.17).

**Versioning:** templates and disclosures publish as immutable versions. Editing a published one
creates version N+1. An application already in progress keeps the version it started on, so an edit
never rewrites a half-finished case (3.1, 3.4, 3.10).

## What an agency owner can change

| Settings → Sales screen | Task | What can be changed | Spec says |
|---|---|---|---|
| **Underwriting templates** | 3.1 | Questions, **sections (add, rename, remove empty), order (move up or down)**, required, question type, choices, knockout answers, conditional follow-ups, which insureds a question applies to. Preview, duplicate, publish. | "sections, ordering, required; duplicate a template". **The only place the spec asks for sections and ordering.** |
| **Quotation templates** | 3.4 | Per carrier × product: which inputs the Quote step asks for (switched on or off from a fixed list), age basis (nearest or last birthday), how long a quote stays valid. | "fields match the template exactly, in order". *Built today: inputs are chosen from a fixed list in a fixed order. They cannot be reordered, and no new input types can be added.* |
| **Application field sets** | 3.7 | Per carrier × product: which fields the application asks for, the carrier's label for each, and required. Add or remove fields. | "a new carrier field needs no migration". Nothing about order or sections: **the application's sections are the platform's.** |
| **Carrier field maps** | 3.13 | Where each field goes on the carrier's site. Publish is refused while any sensitive entry is unverified. | Per carrier, per agency. |
| **Disclosures** | 3.10 | Text, state scope, the rules that make each one required (AND within a rule, OR across rules), the PDF. Versioned. | "rules are AND clauses over application values". |
| **Carriers and products** | 3.6, 3.17, 3.22 | Which carriers and products the agency sells, contract and commission, portal URL and username (**never a password**), portal origin, reference pattern, billing descriptor. | |
| **Quote & QA rules** | 3.5, 3.9, 3.11, 3.18, 3.20 | Per-$1,000 plausibility band, whether a carrier you're not appointed with **warns or blocks**, draft-date buffer days, requirement ageing (amber N, red 2N), welcome pack auto-send on or off. | "Ageing thresholds are tenant-configurable." Only the appointment check can be set to block; the rest are always warnings. |
| **Welcome pack** | 3.20 | All of the email's wording. | Four items **cannot be removed** (see below). |
| **Pipeline sync** | 3.23 | Which of the agency's pipeline stages a card moves to at each application state, or "doesn't move". | A card moved by hand always wins. |
| **Browser extension** | 3.12 | Install state, which carrier sites it may work on, revoke all grants. | |
| **AI assistant** | 3.3 | Shown as unavailable until the provider decision is made. | Blocked by decision 4. |
| **States & licences** | 3.6 | Carrier appointments by state, licences. | The appointment QA check reads these. |

## What nobody can change (by design)

These are compliance guarantees. If an agency could turn them off, the audit trail would stop
proving anything.

- **The ten workflow steps and their order:** Verify → Interview → Quote → Application →
  Beneficiaries → Payment → Disclosures → Review → Submit → After submit.
- **The sections of the application form** (Insured, Address, Coverage, Payment, Beneficiaries…).
  Field sets choose fields inside them, not the sections themselves.
- **The five survival questions** in every seeded underwriting template: Social Security deposit
  date, is this the account, anyone else on the call, existing coverage, can receive a text/email.
  They are locked in the builder.
- **Beneficiary rules:** primaries total exactly 100.00, a contingent needs a primary, "other" needs
  text.
- **Payment checks:** routing checksum (ACH), Luhn (cards), the Direct Express check; **CVV is never
  stored**; SSN and bank numbers are encrypted, masked, and every reveal is logged.
- **Hard blocks on "ready":** an unacknowledged required disclosure, any "must fix" QA item.
  "Not applicable" always needs a reason.
- **The four welcome-pack items:** bank statement descriptor, monthly amount, draft day, agent's
  phone. Both the editor and the server refuse a template without them.
- **Draft-date limits:** never later than the 28th; an override is allowed but logged.
- **The status model** and the rule that a pipeline drag never changes an application's status.
- **History:** nothing is deleted or overwritten. Discarded quotes, declined attempts and old
  versions are kept.

## Not in the spec (raise as a new requirement if wanted)

- **Per-agent customization** of templates, QA rules or disclosures. The spec is per agency
  throughout, and per-agent rules would undo the consistency above. Reasonable per-agent
  additions would be personal preferences only (e.g. favourite carriers, a default quote layout).
- **Rearranging the application form's sections**, or reordering the workflow steps.
- **Reordering quotation inputs, or adding custom ones.** The spec says the form matches the
  template "in order", but the builder offers a fixed list in a fixed order. This is the one place
  the build is narrower than the spec's wording.
- **Letting a non-owner role (e.g. a sales manager) edit Sales settings.** Today Settings is
  owner-only.

# Module 1 — the sections to add, and the sections to replace

*Changes to **Module 1 — Inbound Lead Acquisition**, in that document's voice and numbering.*

**Part 1** is eight sections that were never written — eight of LA-1's 25 tasks have no section in
the module document, and four are not mentioned at all.

**Part 2** replaces four sections that describe a codebase that no longer exists. The module document
was written before LA-1 was built and every "the current system" passage in it refers to the legacy
CRM that LA-1 replaced. §5.1, §6.3 and §14 state things that were true then and are false now; §15
asks five questions that have since been answered.

Nothing here is aspirational: every behaviour described below is built, and was checked against the
running code on 2026-09-22. The gap analysis that produced both lists is in
`docs/qa/LA-1-DOCUMENTATION-GAPS.md`.

---

# Part 1 — Sections to add

---

## §3.3 — What the partner actually sees

*LA-1.17 · Partner lead pipeline*

§3.2 gives the publisher a one-line promise — *"see their own lead pipeline"*. That line is doing a
lot of work, because the partner's view of a lead is not Ray's view with a filter on it. It is a
different document about the same person.

The partner sees, for each lead they submitted:

| | |
| --- | --- |
| **Where it is** | Pipeline and stage, by name — not the stage id, and not Ray's internal ordering |
| **What happened** | Claimed or not, when, and by whom in the loosest sense: *an agent*, not which one |
| **The outcome** | The disposition once it lands, and the call result and notes from the deal-flow row |
| **What they sent** | The form values they submitted, so they can answer their own closer's question about what was typed |

And they do **not** see: another partner's leads, another licensed agent's anything, or the
sensitive half of the record they themselves submitted.

### The masking rule, and why it applies to the partner's own data

> **A partner does not get back everything they sent.** Banking and identity values are masked on the
> way out — routing number, account number, institution, SSN, IBAN, SWIFT — and render as `[Masked]`.

This looks wrong the first time you read it. The closer typed those numbers; why can they not see
them?

Because "the partner" is not the closer. It is every user account at that call centre, for as long
as the account exists, and the review that opened this module found **224 of 280 accounts were
external call-centre staff**. A submission form is a one-time channel from a person who had the
customer on the phone. A pipeline view is a permanent, queryable, exportable window. Handing the
second one a routing number because the first one typed it is how a bank detail leaves the building
eighteen months later.

The mask is applied by key name rather than by field definition, so a partner who adds a custom
field called `bank_account` gets the same treatment as one using the standard form.

---

## §5½ — Have we spoken to this person before?

*LA-1.24 · Existing-customer pre-flight check*

A live transfer arrives. Before Ray says hello, one question changes the entire call: **is this
somebody we already know?**

Three answers, and they are genuinely different conversations:

| Status | What it means | What it changes |
| --- | --- | --- |
| `new_household` | Nobody at this address or number has been here before | Nothing. The normal call. |
| `spoken_before` | We have a lead for this person, and it did not become a sale | Ray knows the objection before it is raised, and knows not to re-pitch what was already declined |
| `already_customer` | They bought from us | The call is a service call or a second policy, and treating it as a cold intake is the fastest way to lose both |
| `not_checked` | The lookup did not run | Said out loud rather than shown as `new_household`, because "we did not look" and "we looked and found nothing" are different facts |

The check is **lead-level evidence, not a policy lookup** — the migration says so in its first line,
and the Book of Business module owns policy matching later. What is stored on the lead is the status,
when it was checked, and the evidence that produced it, so the answer on screen can be justified
months later without re-running anything.

### The rule that decision 6 added, and why

The obvious design is to merge the duplicate automatically above a confidence threshold. LA-0.6 does
exactly that on the import path, and it is right to.

> **Never auto-merge on a live call.** On a live transfer the match produces a **prompt**, not a
> merge:
>
> *Looks like **Marla Jenkins**, your customer since June — [ Same person ] [ Different person ]*
>
> One click. The agent decides.

The reasoning is worth keeping in full, because it is the opposite of the usual safety argument. This
is not caution — it is that **Ray needs the information anyway.** Knowing "this person already bought
from you in June" changes the call, and the merge-on-confidence design was about to hide that fact
behind a silent database operation.

The performance budget follows from the same point: the **match** has to be fast enough that the
banner is on screen before the agent speaks. The **merge** waits for a human and can take as long as
it likes.

---

## §6.1½ — When nobody claims

*LA-1.23 · Unclaimed SLA & escalation*

§6.1 describes a pull model: the lead sits unclaimed and whoever claims it first owns it. That works
until nobody does, and a live transfer that nobody picks up is the most expensive thing in this
module — the partner has a customer on the phone and a bill to send.

So an unclaimed lead walks a ladder, and every rung has a different audience:

```
   0s   submitted, unclaimed
  45s   ⚠ warn        amber on the Agent Floor — the team's own problem, nobody outside sees it
 120s   ↑ escalate    the tenant owner is alerted — this is now Ray's problem
 300s   → tell the partner   the channel gets a card; they find out from us, not from the customer
   4h   ✕ expire      out of the active queue, still in the record
```

**The four rungs are one ladder, configurable in one place** — Settings → Queue & SLA — and they
apply on the next scheduler run with no deploy. That matters because the right numbers are a property
of Ray's team size, not of our code: a solo agent and a room of six buffer agents should not share a
45-second warning.

Two rules the ladder encodes:

> **The partner is told before the customer complains, and not before Ray has had a chance.** Five
> minutes is deliberately after the escalation, not with it — a card that fires at the same moment
> Ray is alerted turns every busy minute into a support conversation.

> **Expiry removes the lead from the queue, never from the record.** An expired lead is still a lead
> Ray paid for, still counts against the partner's quality numbers, and is still there to be worked
> late. Nothing is deleted by a clock.

---

## §6.4½ — Notes and internal comments

*LA-1.21 · Notes & internal comments*

A lead accumulates things that are not fields: *"wife makes the decisions, call after 6"*, *"third
time this centre has sent a wrong number"*, *"said yes then went quiet — try Tuesday"*.

Two kinds, and the difference is the whole feature:

| Visibility | Who reads it | What it is for |
| --- | --- | --- |
| `internal` | Ray and his team only | What he actually thinks, including about the partner who sent the lead |
| `shared` | Ray's team **and** the partner's channel | What he wants the partner to know |

> **An internal note must never reach the partner's channel.** That is not a preference; it is the
> reason the two kinds exist. A note saying "third wrong number from Apex this week" is a management
> observation when Ray reads it and a business-relationship problem when Apex does.

### Every note keeps its history

Notes can be edited and deleted, and both leave a trail. `lead_note_edits` records the action, the
old body, the old visibility, the new body, the new visibility and who did it. A delete is a
timestamp, not a `DELETE`.

The visibility columns in that history are the ones that earn their place. **Changing a note from
shared to internal does not unsend it** — the partner already saw it — and the history is what tells
you that the note currently marked internal was visible to them for two days. Without it, a note that
had been shared and was quietly reclassified reads as though it never left the building.

### Mentions, and search

A note can mention a teammate, which raises an alert for them (§8½). And notes are searchable across
leads, because the useful ones are almost always found by remembering the phrase rather than the
customer.

---

## §6.5 — Callbacks

*LA-1.22 · Callback scheduling & calendar*

*"Callback scheduled"* is one of the eight dispositions in §6.3, and it is the most common productive
outcome that is not a sale. §6.3 records it and stops. This is what happens next.

### The time is the customer's, always

> **"Call me Thursday after 2" means 2pm where the customer is.** The picker defaults to their local
> time with Ray's shown beside it, and the stored instant is resolved from the customer's state.

This is the single failure this feature exists to prevent, and it is not theoretical: an agent in
Arizona booking a customer in Ohio, typing "2pm" and meaning his own afternoon, produces a call that
arrives at 11am for a person who is at work. Every screen that shows a callback shows the customer's
time, and the agent's beside it when they differ.

### Two things it refuses

- **A time outside the legal calling window**, evaluated **at the booked instant** rather than now.
  "Thursday 2pm" has to be legal on Thursday at 2pm where the customer is; whether it happens to be
  legal at the moment of booking is irrelevant and would reject most evening bookings made in the
  morning.
- **A time in the past.** Refused outright, in the database rather than in the form, because a
  compliance rule enforced only in the browser stops applying the moment anything else calls the API.

### Due, and overdue

A due callback surfaces at the top of the work queue rather than in a list somebody has to remember
to open. An overdue one **stays visible and is counted separately** — the count is the point, because
a callback that quietly disappears at midnight is a promise broken with no record that it was ever
made.

---

## §7½ — The lead workspace

*LA-1.20 · Lead workspace page*

§8 describes the Agent Floor: live transfers, right now, across every partner. That is where Ray
works when calls are landing. The lead workspace is where he works the rest of the time — and it is
the page with everything on it.

```
┌──────────────────────────────────────────────────────────────┐
│  Submitted today   Claimed   Converted   Still open          │
├──────────────────────────────────────────────────────────────┤
│  search · filters · [ Board | Table ]                        │
├──────────────────────────────────────────────────────────────┤
│  PIPELINE   [ All 19 ] [ Publisher transfers 14 ] [ … ]      │
├──────────────────────────────────────────────────────────────┤
│  New Transfer │ Incomplete │ Needs Callback │ Submitted │ …  │
│  ┌─────────┐  │            │                │           │    │
│  │ Rinor G │  │            │                │           │    │
│  └─────────┘  │            │                │           │    │
└──────────────────────────────────────────────────────────────┘
```

**Two views of one set of leads.** The board is columns of stages with cards that drag between them;
the table is a list with the same filters and a CSV export. Filters are shared: product, stage,
submitted-by, screening outcome and a date range narrow both.

### The pipeline tabs, and the one called All

Each pipeline is a tab with its lead count, and the first tab is **All**.

> **All is a view, not a pipeline.** Every pipeline has its own stage vocabulary — one board here has
> twelve stages and another has seven, with no name in common — so there is no honest single set of
> columns across them. All does not invent one. The table becomes the combined list with a Pipeline
> column; the board stacks one section per pipeline, each drawn with its own stages.

The counts on the tabs are the reason this page replaced a single filtered list: a lead that belongs
to a pipeline Ray is not currently looking at used to be counted in the filters and rendered nowhere.

### Editing the board

An owner can rename a stage, change its colour, change whether it counts as open, won or lost,
reorder it, or archive it — from the board itself, on the pipeline being looked at. Archiving removes
a stage from pickers and from the board; **leads already on it keep it and stay readable**, because a
stage that disappears takes its leads with it.

This is owner-only, and the button is absent rather than disabled for everyone else, because a
producer shown an *Edit stages* button gets a 403 from a control that looked available.

---

## §8½ — When Ray is not on the Floor

*LA-1.25 · Agent alerts away from the Floor*

§8 calls the Agent Floor *"a place you work from"*, and it is. But Ray is a licensed agent running a
small business: he is on the Floor for part of the day and somewhere else — the deal flow, settings,
a carrier's portal, lunch — for the rest of it.

Everything §8 shows is useless if the only way to see it is to be looking at it. So the alerts follow
him:

| Alert | Fires when |
| --- | --- |
| `new_unclaimed_lead` | A transfer arrives and nobody has claimed it |
| `handoff_offered` | A buffer agent is handing a verified customer over |
| `callback_due` · `callback_reminder` | A promise from §6.5 is coming up, or is now |
| `appointment_reminder` | A booked appointment is approaching |
| `lead_note_mention` | Somebody mentioned him in a note (§6.4½) |
| `partner_message` · `partner_message_mention` | A partner wrote in a channel, or wrote to him by name |

The alert centre lives in the application shell, so it is on every screen rather than on one.

> **An alert is keyed by the thing that caused it, not by the moment it was raised.** The same
> underlying event cannot produce two alerts, which is what makes a scheduler that runs every minute
> safe to run every minute.

---

## §12½ — Which partners are worth keeping

*LA-1.18 · Lead quality by partner*

§12 explains that all three sources converge on the same spine. This is the screen that tells Ray
which of them to keep paying.

A partner sends leads. Some are good. The question is not answerable from volume, and it is not
answerable from conversion alone either — a centre sending fifty transfers a week at a 4% conversion
rate and one sending five at 20% are not obviously ranked until you know what each lead cost and how
many were never workable in the first place.

So the screen carries the funnel and the failures side by side:

```
sent → claimed → worked → submitted
  └─ disqualified · duplicate · TCPA · DNC · invalid
```

with three rates derived from them:

| Rate | Question it answers |
| --- | --- |
| **Conversion** | Of what they sent, how much became business |
| **Disqualification** | How much of it was never sellable |
| **Duplicate** | How much of it we already had |

### Two things that make it usable rather than merely true

**Per closer, not only per centre.** The metrics break down to the individual partner user, because
"Apex is getting worse" is rarely true of Apex — it is usually true of two people who joined last
month. A centre manager given a name can fix it; a centre manager given a percentage argues about it.

**Against the previous period.** Every figure carries the same figure from the period before it.
A 12% disqualification rate means nothing on its own and means a great deal next to last month's 4%.

> **These numbers are a negotiation, not a verdict.** They exist so that a renewal conversation is
> about evidence rather than impressions — which is also why the screening rejections are reported as
> counts and coded reasons, and never as a list of blocked numbers. Handing a call centre a list of
> litigator phone numbers is handing them something they can sell.

---

# Part 2 — Sections to replace

---

## §5.1 — The TCPA / DNC check *(replaces the section of the same number)*

> **What changed.** The original §5.1 ends *"None of these block anything… whether the rebuild keeps
> advisory semantics or makes TCPA a hard block is a legal decision."* That decision was taken —
> decision 9 of *Sixteen Open Questions, Answered* — and it is built. This section describes what
> runs.

The check fires **when the closer types the phone number and tabs out** — not on submit. That timing
is the whole design:

```
closer types the number
        │
        │  five seconds
        ▼
   screening runs  ──►  blocked?  ──►  the transfer never happens
        │
        ▼
   clear or warned  ──►  fills the form  ──►  transfers the call
```

The original system screened at form submit, which is **after the call had already been transferred**.
Moving it to number entry converts a live-call catastrophe — a litigator on the phone with a licensed
agent — into a "do not transfer this one".

### Six outcomes, three behaviours

| Outcome | What it means | What happens |
| --- | --- | --- |
| **TCPA litigator** | Known to sue over calls | **Blocked.** A rejected submission is recorded and audited |
| **Invalid phone** | Not a usable US number | **Blocked** |
| **Screening unavailable** | The vendor is down, or the plan's lookup allowance is spent | **Blocked** — see below |
| **Internal DQ** | Our own rules say this person cannot be sold | Allowed, with a warning carried onto the lead |
| **DNC list match** | On a do-not-call registry | Allowed, with a warning carried onto the lead |
| **Clear** | Nothing found | Allowed |

The rule in one line, from the screening service itself:

```ts
allowed: outcome !== "tcpa_litigator" && outcome !== "unavailable"
```

Only two things stop a submission, and only one of them is about the customer.

### What the closer is told, and what the partner is told

A litigator hit returns a fixed, neutral script:

> *"I'm sorry, but I cannot continue this call today. Thank you for your time, and take care."*

> **Never tell a consumer they have been flagged as a litigator.** That is how a blocked transfer
> becomes a lawsuit. The script says nothing, and it is fixed rather than composed, so no agent has
> to improvise it under pressure.

The partner sees a **masked number and a running count** — `••••4817`, and how many times this has
happened — in their own quality view. They never get the list.

> **Handing a call centre a list of litigator phone numbers is handing them something they can
> sell.** The count is the quality signal; the numbers are not theirs.

And the transfer is **not billable**. A rejection is recorded as a rejected submission with reason
`tcpa_block`, counts against that partner's quality stats, and never enters deal flow.

### When the vendor is down

> **Blocked, with a 503 and this sentence:** *"Screening could not be completed. Do not treat this
> number as safe."*

The status code is doing work. A **422** means the submission is wrong — a litigator, an unusable
number — and retrying will not help. A **503** means *we* could not answer, and the closer should try
again shortly. The same outcome covers a spent plan allowance, with its own message, because from the
closer's side the difference between "the vendor is down" and "you have run out of lookups" is the
same instruction: wait, do not transfer.

This is the conservative answer to a question the original §15 left open. It costs the partner a
transfer during an outage. The alternative costs $500 to $1,500 per call.

---

## §6.3 — Disposition *(replaces the section of the same number)*

> **What changed.** The four vocabularies were collapsed into one, "do not call" now writes to a
> list, and the configurable wizard's three problems were fixed. The disposition table below is
> unchanged — it was right.

The agent records what happened. **One vocabulary**, eight flat outcomes, no sub-reasons, each
carrying an explicit flag for whether it counts as work completed:

| Disposition | Counts as work? | Closes as |
| --- | --- | --- |
| Application submitted | **Yes** | completed |
| Sent to underwriting | **Yes** | completed |
| Callback scheduled | No — the call has to come back | completed |
| Did not qualify | No | completed |
| No payment method | No | completed |
| Not interested | No | completed |
| Do not call | No — and never call again | completed |
| Call dropped | No — the client hung up | **dropped** |

`counts_as_work_completed` and `closes_as` are columns, not conventions, and the set is per tenant and
editable — so a tenant can rename a label or retire an outcome without a deploy, and nothing
downstream has to guess which outcomes were the productive ones.

Two design notes carried from the original, both still true:

> **A disposition is not a status.** The row's status stays a small closed set; the disposition sits
> beside it. Do not merge them.

> **The four vocabularies are one.** They shared no table, no key space and no validation path, and
> collapsing them was the highest-value simplification in this module. A drift guard fails the build
> if a second vocabulary appears, because this is the kind of thing that grows back.

### "Do not call" writes to a list

> The original note here read *"'Do not call' currently writes nothing to any DNC list. It is a label
> on one row. If that is meant to prevent future contact, it has to be built."* It was built.

`tenant_do_not_call` holds the tenant's own suppression list, with a unique index on the active
`(tenant_id, phone_digits)` pair, and the `do_not_call` disposition writes it. The outbound module has
its own equivalent — `tenant_suppression_list` — written by the dialer's DNC disposition, by the
import scrub and by the nurture re-screen, so a number suppressed on one plane is not dialled on the
other.

**Suppression is permanent, and it is never inferred.** Nothing un-suppresses a number automatically,
and a reactivated lead is re-screened before it can be served again.

### The configurable disposition wizard

A database-driven decision tree: a flow per pipeline stage, nodes, options, and note templates that
compose a written note from the path the agent walked. The idea was always good; the original section
lists three problems with the implementation, and all three are fixed.

| Was | Is |
| --- | --- |
| One active flow per stage **name**, globally — two tenants with the same stage name broke each other | `unique (tenant_id, stage_id)`. Per tenant, and keyed by stage **id**, so the name is free |
| Configuration tables readable by every authenticated user, no tenant scope | Row-level security on all six wizard tables |
| One flow's logic hardcoded in the generic wizard, reading steps **by array position** | The wizard follows the configured option edges. A test fails if it reads by position again |

> **The note the wizard composes is assembled from the path, not written by it.** The agent's answers
> are stored as the walk; the sentence is derived from them. A stored sentence freezes today's
> wording into every row already written.

---

## §14 — The risks, and where they stand *(replaces "The five biggest risks")*

> **What changed.** The original five were a review of the **legacy CRM**, written before LA-1 was
> built. Three are closed. The two that remain are restated as what to protect rather than what to
> fix.

### Closed

**1 · Tenant isolation.** Every table in this module carries a tenant id and row-level security. The
finding that opened the original section — *"224 of 280 user accounts are external call-centre staff,
and the pipeline configuration tables are readable and deletable by any authenticated user"* — is a
fact about the system that was replaced, and it is why the isolation is where it is.

**2 · Four disposition vocabularies.** One vocabulary, per tenant, with a guard. See §6.3.

**3 · Silent lead loss.** The original hazard was that a failed enqueue left the lead submitted,
unworked and unreported. `intake_failures` now records every non-fatal step that fails, and an audit
row fires when even *that* insert fails — the failure of the failure record is itself recorded.

> The original prescription was **"swallowing must never mean silence — best-effort on the response,
> never on the record."** That is what shipped, and it is the sentence to keep.

### Still live

**4 · One eligibility rule, and a name collision.** There is one implementation of "is this agent
appointed for this carrier in this state" — `canWriteFromVault`, wrapped by the appointments service
— mirrored in SQL as `public.can_write` for the assignment path, which runs inside the database.

Two things to protect. The **parity** between the TypeScript and SQL forms is structural, not proved:
they are the same rule written twice for two runtimes, and nothing compares their answers on the same
input. And the name `canWrite` is also used by an entirely unrelated entitlement predicate — *does
this plan allow writing at all* — which a guard keeps separate.

> **Three things are called `canWrite` and they answer three different questions.** If the
> entitlement helper ever takes a carrier and a state, two of them have merged and one caller is now
> wrong.

**5 · The form is enormous, and it is the partner's first experience.** Permanently true. The
autosave, the resumable draft and the duplicate override with its justification are built; the risk
does not go away, because every field added to the form is paid for by a closer with a customer on
hold.

---

## §15 — Open questions *(replaces the section of the same number)*

> **What changed.** Six of the original seven have been answered — five by decisions and
> implementation, one by §16 of this same document. They are listed as decided rather than deleted,
> because a question that reappears without its answer gets re-litigated at 2am. The one that
> remains is joined by §16's own deferred question, which would otherwise be lost when that list
> shrinks.

### Still open

**1 · Is the money ledger built here or stubbed?** Every accepted transfer creates a debt to the
partner. Invoicing belongs to the accounting module, but the ledger entry has to exist now or be
retrofitted against history later. Unresolved.

**2 · Dispute evidence, and recording.** Deferred with §16 rather than settled. Rejecting a transfer
is currently Ray's word against the partner's, and there is no recording to attach. Worth revisiting
before the first real argument about an unqualified transfer.

### Decided

| Question | Answer |
| --- | --- |
| Does TCPA block, or warn? | **Blocks**, at phone-number entry, with a neutral script and a coded reason to the partner. Decision 9. See §5.1 |
| What happens when the screening vendor is down? | **Blocks**, with a 503 and *"do not treat this number as safe"*. The same applies to a spent lookup allowance. See §5.1 |
| Do partners self-register, or does Ray invite them? | **Ray invites.** There is no self-registration path; partner users are created and invited from Ray's side, with a resend |
| How does the phone call itself arrive? | **However it arrives today.** Telephony is out of scope — §16 is the full answer, including the three precautions taken so it can be added later |
| How long does a lead stay unclaimed before it escalates? | **45s warn → 120s escalate → 300s tell the partner → 4h expire**, configurable per tenant. See §6.1½ |
| Do buffer agents count as subscription seats? | **Yes.** `max_buffer_seats` is on the entitlement and enforced when the invite is sent |

# LA-1 · What the Module 1 document is missing

**Checked 2026-09-22** against the sprint board (25 tasks, **all `Completed`**) and against the
running code. Every claim below was verified, not inferred.

## The core finding

*Module 1 — Inbound Lead Acquisition* carries its own status line:

> **Status:** module brainstorm. Second draft; the first got the shape wrong.

It still is one. It was written **before** LA-1 was built, and it has not been updated since. That
matters more than any individual omission, because of what the document does on nearly every page: it
describes "the current system" — and *the current system it describes is the legacy CRM that LA-1
replaced.*

An engineer joining today reads:

> *"None of these block anything."* · *"'Do not call' currently writes nothing to any DNC list."* ·
> *"the lead is submitted successfully, never reaches the agent, and says nothing about it."*

and reasonably concludes those are properties of the product they are about to work on. All three
were fixed by the module the document is introducing. **The document explains the problem beautifully
and never says what was built.**

Three things follow, and they are the three parts of this file:

| | |
|---|---|
| **A** | 8 of 25 tasks have no section — 4 are not mentioned at all |
| **B** | 6 factual statements are now false, each one actionable and wrong |
| **C** | 6 of 7 open questions have answers, and 3 of 5 risks are closed |

---

## A′. What the document describes that the web app did **not** have

Added 2026-09-22, after walking every feature the document describes against the running code —
the partner lifecycle, the capability gate, the intake steps, the claim, verification progress, the
eight dispositions and their `counts_as_work_completed` flag, the six disposition write targets, the
buffer flow, the Agent Floor's nudge/handoff/presence/language, all seven notification cards, the
tracked affiliate link, autosave, the resumable draft, and the duplicate override with its
justification.

**All of it is built, with one exception.** §16 asks for three telephony precautions, "all worth
taking now":

| | Precaution | State |
|---|---|---|
| 1 | Keep an `active_call` record even without a provider | Built — `public.active_calls`, opened at claim, closed at disposition |
| 2 | **Leave a `provider_call_id` column on it, nullable** | **Was not built** |
| 3 | Never let call state be inferred from work-item state | Built — the Floor derives `on_call` from an open `active_calls` row |

The outbound plane took the identical precaution and argued for it at the time, under a header
reading *"THE SEAM"*: `tenant_call_attempts.provider_call_id` is nullable from the start because
*"leaving the column out until one arrives would mean migrating a table that by then has history in
it."* That argument is stronger on the inbound side, not weaker — `active_calls` gains a row on
**every claim**.

Added by `supabase/migrations/20260922210000_la_1_inbound_telephony_seam.sql`, with a partial index
for the day a provider does arrive, and an assertion that the column stays nullable — a `not null`
provider id on a table written at claim time would make every claim depend on a provider that does
not exist, which is the precaution inverted into a blocker.

`lib/transferInbox/telephonySeam.test.mjs` keeps **both** planes' seams open. A column nothing reads
is exactly what a later tidy-up removes, and the cost of removing this one is not the column — it is
the backfill against live call history that putting it back would need.

---

## A. Tasks the document does not cover

| Task | Coverage today | What is missing |
|---|---|---|
| **LA-1.17 · Partner lead pipeline (their own view)** | One bullet in §3.2 | The partner's own portal view is a screen with its own isolation rules. It gets a line; §3.2's *"see their own lead pipeline"* is the whole treatment |
| **LA-1.18 · Lead quality by partner** | Five words in §2 | A complete task — *"sees leads by partner, quality by partner"* is the only trace. There is no description of what quality means, how it is measured, or what Ray does about a bad partner |
| **LA-1.20 · Lead workspace page** | **Absent** | Ray's main leads screen. The document has a §8 for the Agent Floor and nothing for the page where leads are actually worked, filtered, and moved between pipelines |
| **LA-1.21 · Notes & internal comments** | **Absent** | Not mentioned. Notes have a visibility boundary — internal notes must not reach the partner — which is exactly the kind of rule a document like this exists to state |
| **LA-1.22 · Callback scheduling & calendar** | One line in §16 | *"Callback scheduled"* is one of the eight dispositions in §6.3, and what happens next — a calendar, a timezone-correct reminder, an overdue count — is described only as a telephony limitation |
| **LA-1.23 · Unclaimed SLA & escalation** | Open question 6 | **Built, and still written as an unanswered question.** See Part C |
| **LA-1.24 · Existing-customer pre-flight check** | **Absent** | Knowing that the person on the phone already bought in June changes the entire call. Decision 6 of the decision log is largely about this task, and the document predates both |
| **LA-1.25 · Agent alerts away from the Floor** | **Absent** | §8 says the Agent Floor is *"a place you work from"*. LA-1.25 exists because Ray is not always on it. Nothing says so |

**Four of these — LA-1.20, LA-1.21, LA-1.24, LA-1.25 — appear nowhere in the document at all.** All
four are built and reachable: `components/app/lead-workspace.tsx`, `/api/app/leads/[id]/notes` and
`/api/app/notes/search`, `/api/app/leads/[id]/preflight`, `components/app/agent-alert-center.tsx`.

---

## B. Statements that are no longer true

Each of these is a sentence an engineer could act on, and each is wrong now. They are listed with
what replaced them.

### B1 · "None of these block anything" (§5.1)

The document's TCPA table ends: *"The modal's only buttons are Dismiss, Close and Continue — and all
three do the same thing."*

**Decision 9 of the decision log changed this and it is implemented.** `POST
/api/partner/forms/[productCode]/screen` screens on phone-number entry, before the transfer, and a
litigator hit is a rejection:

- `TCPA_REJECTION_REASON = "tcpa_block"`, recorded as a rejected submission
- `NEUTRAL_END_CALL_SCRIPT` — *"I'm sorry, but I cannot continue this call today…"* — because the
  decision is explicit that you never tell a consumer they have been flagged
- `maskLastFour()` so the partner's own quality view shows `••••4817` and a count, never a list of
  blocked numbers, which the decision calls *"handing a call centre something they can sell"*
- an audit row on every rejection

The document's whole §5.1 and open question 1 describe the world before this.

### B2 · "'Do not call' currently writes nothing to any DNC list" (§6.3)

`public.tenant_do_not_call` exists, with a unique active index on `(tenant_id, phone_digits)`, and the
`do_not_call` disposition writes it. The outbound plane has its own `tenant_suppression_list` written
by `suppress_phone` from the dialer, the import preflight and the nurture re-screen.

The document's follow-up — *"If that is meant to prevent future contact, it has to be built"* — was
acted on. It reads as an outstanding instruction.

### B3 · "the lead is submitted successfully, never reaches the agent, and says nothing about it" (§5)

This was risk 3, and it is closed. `lib/agentTemplates/intake.ts` writes an `intake_failures` row
when a non-fatal step fails, and audits `tenant.intake_failure_recording_failed` when even *that*
insert fails — the failure of the failure record is itself recorded.

The document's own prescription was *"swallowing must never mean silence… best-effort on the
response, never on the record."* That is what shipped. It should say so.

### B4 · "four separate disposition vocabularies" (§6.3, and risk 2)

Collapsed by LA-1.12 into one, with a drift guard (`lib/dispositions/oneVocabulary.test.mjs`) that
fails if a second vocabulary appears. The document still calls this *"the single highest-value
simplification available in this module"* — in the future tense.

### B5 · "the 60-second escalation and 4-hour expiry belong to two different subsystems" (open question 6)

LA-1.23 built one ladder, tenant-configurable, with four rungs:

```
warn 45s  →  escalate 120s  →  notify the partner 300s  →  expire 14,400s (4h)
```

editable under **Settings → Queue & SLA**, applying to the next scheduler run with no deploy. The
document describes the disorder that was replaced.

### B6 · The risks section describes a codebase that no longer exists

§14's five risks are a review of the **legacy CRM**. Three are closed — tenant isolation (every table
is tenant-scoped with RLS), the four vocabularies (B4), and silent lead loss (B3).

Two are worth keeping, because they are still live:

- **Three copies of the eligibility rule** — `can_write` is now the single implementation and LA-2.24
  defers to it rather than reimplementing it, so this is *mostly* closed. Worth restating as "one
  implementation; do not add a second."
- **The form is enormous and it is the partner's first experience** — permanently true, and the
  autosave and resumable draft the document asks for are built.

---

## C. Open questions that have answers

| # | Question | Answer, and where it came from |
|---|---|---|
| 1 | Does TCPA block, or warn? | **Blocks**, on phone-number entry, with a neutral script and a coded reason to the partner — decision 9, implemented. See B1 |
| 2 | What happens when the screening vendor is down? | **Blocks**, with a 503 and *"Screening could not be completed. Do not treat this number as safe."* See the correction below |
| 4 | Do partners self-register or does Ray invite them? | **Invited.** `/api/app/partners/[id]/users` with an invite and a resend path; there is no self-registration route |
| 5 | How does the phone call itself arrive? | **Answered by §16 of the same document** — telephony is out of scope, the call arrives however it arrives. The question and its answer sit eleven sections apart and contradict each other in tone |
| 6 | How long does a lead stay unclaimed before it escalates? | **45 / 120 / 300 / 14,400 seconds**, configurable. See B5 |
| 7 | Do buffer agents count as subscription seats? | **Yes.** `max_buffer_seats` is on the entitlement and enforced at invite time |

### Correction — Q2 is answered, and this file said it was not

> This file originally listed **Q2 — what happens when the screening vendor is down?** as one of two
> that remain genuinely open, on the reasoning that decision 3 answered the *outbound* equivalent and
> the inbound one *"has no written answer"*.
>
> It has an answer, in code, and the answer is **block**. Found while rewriting §5.1:
>
> ```ts
> allowed: outcome !== "tcpa_litigator" && outcome !== "unavailable"
> ```
>
> A screening that cannot complete returns `allowed: false` with the message *"Screening could not be
> completed. Do not treat this number as safe."* and a **503**.
>
> The status code is the part that shows this was designed rather than defaulted. A **422** is
> returned for a litigator or an unusable number — the submission is wrong and retrying will not
> help. A **503** says *we* could not answer and the closer should try again shortly. The same
> `unavailable` outcome also covers a spent plan allowance for TCPA or DNC lookups, with its own
> message, because from the closer's side both mean the same thing: wait, do not transfer.
>
> What was true is narrower and is a documentation gap, not a product one: **nobody wrote it down.**
> The behaviour is in one expression in `lib/compliance/screening.ts` and in the route's status
> selection, and a reader of the module document would have no way to discover it. That is now §5.1
> of `docs/MODULE-1-MISSING-SECTIONS.md`.
>
> I reached "no written answer" by searching the decision log and the module document, finding
> nothing, and not checking the code — the same shape as the three corrections in the LA-2 audit,
> where "not here" was taken for "nowhere".

**One remains genuinely open:**

- **Q3 — is the money ledger built here or stubbed?** Still deferred to the accounting module, and
  the document is right that every accepted transfer creates a debt that has to land somewhere.

§16 also defers one of its own, separately from §15's list: **dispute evidence and call recording**,
which it leaves as *"deferred not resolved"*. Worth carrying into the pruned §15 so it is not lost
when that section shrinks.

---

## D. What to add

**Written, 2026-09-22 — all eight sections are in `docs/MODULE-1-MISSING-SECTIONS.md`**, in the
document's own voice and numbered for insertion (§3.3, §5½, §6.1½, §6.4½, §6.5, §7½, §8½, §12½).
There was no repo copy of Module 1 to insert them into, so they live in their own file until the
Notion document is updated. Items 7 and 8 below are rewrites of existing sections and are not
included — they change text this audit did not author.

A concrete list, in the order the document's own structure suggests.

1. **§6.4½ — Notes and internal comments (LA-1.21).** Who can write one, and the visibility rule
   that keeps an internal note away from the partner's channel.
2. **§6.5 — Callbacks (LA-1.22).** The disposition already promises one; say where it goes, that the
   time is the customer's rather than the agent's, and that overdue ones stay visible and counted.
3. **§7½ — The lead workspace (LA-1.20).** The page Ray works from when he is not on the Floor:
   pipelines, stages, filters, the preview panel.
4. **§8½ — Alerts away from the Floor (LA-1.25).** Because §8's premise is that Ray is on the Floor,
   and the reason this task exists is that he is not.
5. **§5½ — The existing-customer pre-flight (LA-1.24).** Including decision 6's rule, which the
   document predates: on a live transfer, a high-confidence match produces **a prompt, not a merge**
   — *"no merge is ever written during a live transfer intake without an explicit human
   confirmation."*
6. **§12½ — Lead quality by partner (LA-1.18)** and **the partner's own pipeline view (LA-1.17).**
   What Ray sees about a partner's quality, and what the partner sees about their own leads.
7. **Rewrite §5.1, §6.3's DNC line, §5's silent-loss passage and §14** to describe what was built.
   Keep the "what was wrong before" framing — it is the most valuable writing in the document — but
   mark it as history rather than as the present tense.
8. **Prune §15 to the one question of its own that is still open** — the money ledger — plus §16's
   deferred one about dispute evidence, and move the **six** that were answered into a short
   "decided" list with their answers. A stale open-questions list is worse than none, because it
   invites someone to re-litigate a settled decision at 2am, which is the exact failure the decision
   log was written to prevent.

### What to keep untouched

The document is unusually good at the thing most specs are bad at: saying **why**. These should
survive any rewrite verbatim —

- *"Only the lead insert is fatal… reporting it as failed invites a second submission of the same person."*
- *"Being claimed is not being on a call."*
- *"A disposition is not a status."*
- *"Language is a property of the pairing, not of the agent."*
- *"A filter over an empty table is an empty floor."*
- *"Identify a card by what it declares, not by what it lacks."*
- *"A stored emoji freezes today's decision into every row already written."*
- The §16 telephony section in full, including the three cheap precautions — all three were taken.

And the measured findings, which are the document's strongest evidence and are still true of the
*legacy* system they describe: 224 of 280 accounts being external partner staff, the 336 buffer rows
with every handshake column empty, the 42 of 91 claims that announced nothing.

---

## Method

- **Task list** — SQL against the sprint data source filtered to `Module = 'LA-1'`: 25 rows, all
  `Completed`.
- **Coverage** — each task mapped to the document section that describes it; "absent" means the task
  name, its subject and its screens appear nowhere.
- **Every claim in Part B** — checked against the code named beside it, not against a ticket.
- **Decisions** — from *Sixteen Open Questions, Answered*, which post-dates this document by two
  weeks and supersedes several of its open questions.

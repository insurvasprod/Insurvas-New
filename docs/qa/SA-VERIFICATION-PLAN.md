# Super Admin (SA-0.1 → SA-6.3) — verification & remediation plan

Written 2026-09-21. Authority for scope: the Notion doc *Basic Idea Super Admin Side* (Document 2),
the *SA-00 build plan*, and all 45 `SA-x.y` task rows in the *Insurvas Sprint* database, each read
in full on 2026-09-21.

**SA-5.5 and SA-6.4 do not exist.** Confirmed against the sprint database, not inherited from the
local docs: module 5 is SA-5.1–5.4 and module 6 is SA-6.1–6.3, in both the SA-00 build plan and the
task rows. The in-range set is therefore **45 tasks** (SA-0 ×4, SA-1 ×5, SA-2 ×8, SA-3 ×9, SA-4 ×12,
SA-5 ×4, SA-6 ×3), one of which (SA-3.5) is cancelled.

---

## 0. Baseline established before planning

Measured, not read off a document. Each line is a command anyone can repeat.

| Check | Command | Result |
|---|---|---|
| RPC contract | `npm run verify:rpc-contract` | **174 of 175 present.** One missing, `record_campaign_scrub_rejections`, and it belongs to LA-2 |
| SA route/screen matrix | `npm run qa:sa-matrix` | **0 server errors, 0 anonymous leaks** across 37 static API routes and 29 screens × 4 admin roles |
| Unit tests | `npm test` | 637 pass, **4 fail** — all in `lib/agentTemplates/`, all `Cannot find package '@/lib'`, all LA-2 |
| Admin role fixtures | live query | All four roles now exist. SA-completion-backlog gate 0.3 is **closed** |
| Plan prices | live query | **Seeded** — `basic` $99, `pro` $249, `advance` $449, 14-day trials. Backlog gate on this is **closed** |

### The local docs are materially stale

`docs/architecture/sa-completion-backlog.md` reports *"27 Database-misaligned"* and three Gate-0
blockers. **All three gates have since cleared.** It also contradicts itself inside one section —
claiming both that the six SA-2 migrations "have been applied to the live project" and that "none
has been applied". It is not a trustworthy input and is rewritten at the end of this plan (phase 5),
not consulted during it.

### What the baseline actually found

Five findings that no document records, each root-caused to a line or a row:

1. **`/admin/revenue` does not load at all** — for `super_admin` *and* `billing_admin`.
   `fetchFunnel()` in `lib/metrics/queries.ts` selects every tenant in a 90-day window and passes
   the ids into a PostgREST `.in()` filter. That is **542 UUIDs in a URL**, and the request dies
   with `fetch failed` after ~9s. Not slow — broken, and it gets worse with every signup.
   SA-3.9's *"loads in under 2 seconds with 500 tenants"* is failing, not merely unverified.
2. **Five active `super_admin` accounts left behind by verifier scripts** — `verify-*@insurvas.invalid`,
   `is_active = true`, in `admin_users`. 33 fixture rows in total. Newer scripts deactivate what
   they create ("temporary admin fixtures deactivated: 2"); these are the ones that leaked before
   they did.
3. **`plan_meters` holds 0 rows.** `meters` (8) and `meter_pricing` (6) are seeded, so SA-2.5's
   engine exists — but no plan grants an allowance, which means the cap enforcement the ticket is
   about has nothing to enforce.
4. **Six tables are absent**, confirmed by `PGRST205` and not by inference:
   `email_templates`, `email_settings` (SA-4.11) · `job_runs`, `job_schedule` (SA-6.1) ·
   `export_jobs`, `deletion_requests` (SA-6.3).
5. **The audit log is hard-capped at 100 rows and now holds 41,564.** SA-0.4 flagged this when the
   volume was trivial. "Who suspended this user and when" — SA-0.3's own acceptance criterion — is
   now unanswerable for anything older than the last 100 actions.

Plus one structural problem that distorts every number on every screen: **fixture litter**.
19 of 22 plans are `pbv_*` verifier leftovers; 282 of 315 subscriptions are cancelled fixtures;
542 tenants exist. This is what breaks `/admin/revenue`, and it is why MRR, churn and the
activation funnel cannot currently be read as true.

---

## 1. The blind spot this plan exists to close

`qa:sa-matrix` skips **35 dynamic API routes** — every `[id]` route. That is not a rounding error;
it is precisely the **mutation surface**, and it is where most acceptance criteria live:

```
users/[id]/suspend · unsuspend · activate · deactivate · send-reset · resend-invite
invoices/[id]/void · mark-paid · credit-notes/[id]/approve · reconcile
plans/[id]/version · new-version · subscriptions/[id] · addons · coupon
offers/[id]/apply · templates/[id]/duplicate · trials/[id]
tenants/[id]/billing-mode · payment-provider · compliance-vendors/[id]/test-connection
credits-limits/packs/[id]/purchase · features/[id] · products/[id] · admins/[id] · …
```

Everything currently proven about the admin surface is proven about **reads**. Claims like
*"a `support_agent` calling a `super_admin` route gets 403 from the API, not just a hidden button"*
(SA-0.1) and *"the requesting admin cannot approve their own refund"* (SA-3.8) are assertions about
these routes, and none of them has been exercised by the matrix.

**This is built first**, because without it the audit would be opinion.

---

## 2. How each task gets judged

For every one of the 45 tasks, two questions, in this order:

1. **What is this task for?** One sentence from the ticket's own Goal. If a criterion is met but the
   purpose is not served, the task is not done — recorded as `Criteria met, purpose not served`.
2. **Is each acceptance criterion met?** Criterion by criterion, never task by task. Every verdict
   carries an evidence class, and **no verdict may rest on a Notion checkbox or on the existence of
   code**:

| Class | What it means | Weight |
|---|---|---|
| `DB` | Live query against the project in `.env.local` | Proof of state |
| `HTTP` | Real request to the running app with a minted session of a named role | Proof of behaviour |
| `TEST` | A test that fails when the behaviour regresses | Proof it stays |
| `SCRIPT` | An existing `verify:*` script, re-run today | Proof, scope-limited |
| `BROWSER` | Driven through the UI in the built-in browser | Proof a human can do it |
| `READ` | Source read, nothing executed | **Not proof.** Recorded as unverified |

The Notion checkboxes are ignored as evidence in both directions. Several ticked boxes are for
behaviour that cannot currently work — SA-4.11's *"every template exists and is wired to its
trigger"* is ticked and its table does not exist — and several unticked boxes are for behaviour
that demonstrably does.

Output: **`docs/qa/SA-ACCEPTANCE-AUDIT-2026-09-21.md`**, one row per criterion, ~230 rows.

### Three cross-cutting checks run once, not per task

- **The three-point gate must agree.** SA-2.8's rule is that the menu, the page guard and the API
  middleware all enforce the same thing. The agent side has this as a DB-free contract test
  (`lib/design/contract.test.mjs`); the admin side has nothing equivalent. One is added, covering
  all four admin roles across all 66 admin routes.
- **Silent-empty must be impossible.** This codebase has a documented history of handlers that
  delete the evidence of their own failure: `/api/admin/features` answered `200 {groups: []}` with
  the table absent, and `/api/admin/invoices` answered `200 {invoices: []}` while querying columns
  that did not exist. Both were reportedly fixed; both get re-probed against a deliberately broken
  query, because prose is not a guard.
- **Money is integer cents everywhere.** An SA-00 locked decision. Asserted as a test over the
  billing surface, not eyeballed.

---

## 3. Fix order

Sequenced by *what is unsafe or visibly wrong*, not by task number.

| # | Fix | Task | Why it is first |
|---|---|---|---|
| 1 | `/admin/revenue` — aggregate in SQL instead of shipping 542 ids over the wire | SA-3.9 | A headline screen returns nothing. Gets worse weekly |
| 2 | Deactivate the 5 live fixture `super_admin` accounts; make the verifier clean-up unconditional | SA-0.1 | Live god-mode accounts with password hashes |
| 3 | Paginate the audit log | SA-0.3, SA-0.4 | Its own acceptance criterion is unanswerable at 41k rows |
| 4 | Seat `plan_meters`; prove cap enforcement blocks at 100% server-side | SA-2.5 | Needs one business input — see below |
| 5 | Author migrations for the six absent tables | SA-4.11, SA-6.1, SA-6.3 | Three tasks cannot be completed without them |
| 6 | Namespace and purge fixture litter; stop verifiers leaving live rows | cross-cutting | Every metric is currently unreadable |
| 7 | Whatever the audit in phase 2 turns up | — | Unknown until the 35 routes are probed |

**On DDL.** This environment still cannot apply migrations — `TENANT_DB_URL` connects as
`tenant_app` with no `CREATE`, and the Supabase MCP is authenticated to a different organisation.
So #5 is delivered as **reviewed migration files plus `npm run db:check`**, handed over to be applied
with the project's own method (`supabase db query --linked --file`). Nothing is claimed as complete
on the strength of an unapplied migration.

### The one open business input

**Meter allowances per plan** (SA-2.5): how many `tcpa_checks`, `dnc_lookups`, `dialer_minutes`,
`sms_segments`, `statement_pages` and `esign_envelopes` `basic` / `pro` / `advance` each include.
Nothing pins these anywhere, and enforcement reads them — a guessed number becomes a cap that
blocks a paying agent mid-call, or an allowance that bills them for overage they were never sold.
Prices were left unset for the same reason and have since been decided; this is the same class of
decision. **Asked, not invented.** Everything else in SA-2.5 is verified meanwhile.

---

## 4. UI/UX pass

The 34 admin pages have **no mockups** — `docs/design/04-ADMIN.md` says so explicitly, and the
96 generated mockups cover the agent app only. So the standard is
`docs/design/00-FOUNDATION.md`, applied to a surface that has never had a design pass:

- **The six required states** on every page: loading · empty · **error** · not-entitled ·
  wrong-role · read-only. Rule 3 of the design contract is that *an error must never render as an
  empty state* — the exact defect this codebase has shipped twice.
- **Every button's destination verified against source**, the same method as the agent-side pass
  that found two 404s, an Export that only apologised, and a Save in dead code. Admin pages have
  never been checked this way.
- **Role-correct emptiness.** A `support_agent` seeing nothing on a billing page is the correct
  answer. The page must say *why* — not render a blank panel, and not widen the gate to fill it.
- **Mobile.** `C4` records the fixed bottom-left user badge covering content at 375×812. Re-checked
  across all 34 pages, not just the dashboard.

Driven in the built-in browser with a real session per role, not asserted from source.

---

## 5. Close-out

1. Re-run `npm test`, `typecheck`, `lint`, `build`, `verify:rpc-contract`, `qa:sa-matrix`, and the
   extended dynamic-route matrix from phase 1.
2. **Rewrite `docs/architecture/sa-completion-backlog.md`** from the new evidence. Leaving a
   document in place that reports three cleared gates and 27 phantom misalignments costs the next
   reader a day.
3. Update `docs/architecture/task-traceability.md`, including its `SA-5.5 = N/A` and `SA-6.4 = N/A`
   entries, which this plan confirms independently.
4. Report honestly per task: `Pass` · `Partial` · `Blocked` · `Not built` · `Cancelled` — and for
   anything short of Pass, name the specific criterion and the specific reason.

## Constraints held throughout

- Existing `.env.local` and existing Supabase project only. No new project.
- Disposable, clearly namespaced QA fixtures only. No reset, delete, rename or overwrite of shared
  records — the fixture *litter* in §0 is cleaned by deactivation and namespacing, not by
  truncating shared tables.
- No real payments, emails, telephony, carrier or tax integrations enabled.
- No secret printed, committed or echoed.
- **No task marked complete on the strength of a Notion status or the existence of code.**

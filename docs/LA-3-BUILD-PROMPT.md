# LA-3 — Application Flow: build prompt for Claude Code

Paste this whole file as your first message in a fresh Claude Code session at the repo root,
or save it as `docs/LA-3-BUILD-PROMPT.md` and open with:
`Read docs/LA-3-BUILD-PROMPT.md and follow it from Step 0.`

---

## 0. Who you are and what this is

You are implementing **Module LA-3, the application flow** of Insurvas, a multi-tenant
insurance-operations SaaS. Twenty-six tasks, 3.1 to 3.26. Almost all of it is new work:
there is no underwriting, quote, beneficiary, QA, medication, field-map or browser-extension
code in the repo today. A handful of pieces already exist and must be **extended, not rebuilt** —
each step below names them.

**Stack:** Next.js 16.3.3 (App Router, Turbopack), React 19, TypeScript, Tailwind v4
(`@import "tailwindcss"` + `@theme inline` in `app/globals.css`), Supabase (Postgres + RLS),
Zod for request schemas.

**Three portals**, each with its own shell: `app/app/(shell)` (agent), `app/admin/(protected)`
(staff), `app/partner/(portal)` (partner). LA-3 is almost entirely agent-side plus some admin.

---

## 1. Rules that override everything else

1. **Do not destroy existing functionality.** No removed props, handlers, fetches, guards,
   entitlement checks, role checks, API routes or conditional branches. If a change would alter
   behaviour outside the task you are on, stop and say so instead.
2. **Do not build a second form engine.** LA-1.4 already has one:
   `tenant_template_revisions`, `form_drafts`, `lib/templates/*`. Underwriting templates,
   quotation templates and application field sets are new *kinds* on that model.
3. **Extend the tables that exist.** Creating a parallel table where one already exists is a
   failure of the task, not a shortcut. The list is in §4.
4. **One migration per step, forward-only, reversible by a written-down down-migration.**
   Never edit a migration that has already been applied.
5. **Money is integer cents. Dates are date-only where they are dates** (DOB, effective date,
   draft day). Never float money, never store a local time where a date is meant.
6. **Sensitive values** (SSN, bank account, routing number, card number) are encrypted at rest,
   masked by default, revealed one field per request with an audit row. Reuse
   `lib/verification` and `/api/app/inbound/verification/reveal` — do not write a second
   reveal path. **CVV is never stored, in any form, anywhere.**
7. **Every new page uses the existing design system.** See §5. Do not invent a card, a table,
   a page header or a stat tile.
8. **Feature-flag everything new.** Flags `quoting`, `applications` and `draft_date_optimizer`
   already exist. Add `ai_assistant`, `carrier_extension`, `sales_report`.
9. **Never commit or push unless I ask.** Work on a branch, leave it uncommitted or commit
   only when I say so.

---

## 2. The five decisions — already made, build to these

| # | Decision | Build to this |
|---|---|---|
| 1 | Extension token lifetime | **60–90 minutes**, not 15. Security comes from scope (one application, one carrier domain, one sensitive field per call) and sub-second revocation, not from a short clock. Also correct the Notion task text. |
| 2 | Where underwriting templates live | **The LA-1.4 form engine.** A new `kind` on `tenant_template_revisions`, not new `uw_templates`/`uw_questions` tables. Knockout flags and conditional follow-ups are new question metadata on the existing model. |
| 3 | One status list | **Define it in Step 0, before any migration.** One enum covering every application state and outcome across all 26 tasks, including `counteroffer_pending`, `declined_by_client` and `offer_expired`. |
| 4 | AI provider / health data | **UNRESOLVED — do not start 3.3 or 3.13's AI half.** Build 3.13's map *storage, review UI and fill path* without the AI proposal step; leave a clean seam for it. Ask me before writing any provider call. |
| 5 | Reveal permissions | **Limit the reveal API to `owner` and `producer`**, matching the Applications menu. The menu is a convenience; the API is the boundary. |

---

## 3. Step 0 — read and plan. Write no feature code yet.

Do all of this, then **stop and show me the plan for approval**:

1. Read `docs/MODULE-3-EXPLAINED.md` in full, especially §11 and §13.
2. Map the repo: list every existing table, API route and lib module this module touches.
3. Produce **`docs/la3/STATUS-MODEL.md`** — decision 3. One table of:
   - every application/attempt status, its meaning, and which task introduces it
   - every terminal outcome and its structured reason list
   - the legal transitions between them, as a table
   - which statuses map to which pipeline stage (feeds 3.23)
4. Produce **`docs/la3/SCHEMA-PLAN.md`** — every table you will create or alter, per step,
   with columns, types, FKs, indexes and RLS policy, and for each one a line saying either
   "new" or "extends `<existing table>` because …".
5. Produce **`docs/la3/ROUTES.md`** — every page route and API route, with its method,
   Zod schema name, entitlement flag and allowed roles.
6. List anything in §4 below that you could not find in the repo, or that does not match
   this description. Do not guess — ask.

---

## 4. What already exists — extend these, do not recreate

| Thing | Where | Used by |
|---|---|---|
| Form engine: templates, revisions, drafts, renderer | `tenant_template_revisions`, `form_drafts`, `lib/templates/*` | 3.1, 3.4, 3.7 |
| Application case, one open per lead | `tenant_application_cases` (LA-2.14) | 3.7, 3.16 |
| Issued policies, with `policy_number`, `application_case_id`, `deal_id` | `tenant_issued_policies` (LA-2.17) | 3.15 |
| Carrier appointments, licences, the page | `appointments`, `licenses`, `/app/appointments` (LA-0.5) | 3.6 |
| Contract levels in basis points | `commission_schedules.contract_level_bp` (LA-0.4) | 3.6, 3.21 |
| Lead stage history | `tenant_lead_stage_events` — add source `application_sync` | 3.23 |
| State disclosures (these are **call scripts**, a different thing) | `state_disclosures` (LA-2.23) | 3.10 — separate table, same admin area |
| Masking + one-field reveal + audit | `lib/verification`, `/api/app/inbound/verification/reveal` | 3.7, 3.14, 3.19 |
| The "start an application" entry path | `lib/outboundApplication/service.ts` | every entry point |
| Settings section registry | `lib/settings/sections.ts` | 3.17 |
| Menu + section labels | `lib/menu/definition.ts` (`sectionForPath`) | every new page |
| Admin nav | `lib/adminNav/build.ts` (`adminSectionForPath`) | admin pages |

**Blocker to clear before step 12:** `lib/carriers/cancelledAutofillStaysCancelled.test.mjs`
currently fails the build if any `manifest.json` or field-map schema exists. Update that test
(do not delete it — it guards a real rule) as the first commit of the extension work.

---

## 5. Design system — use it, do not restyle it

The whole product was just redesigned. Every new screen inherits it.

| Need | Use | From |
|---|---|---|
| Page title block | `PageHeader` `{eyebrow, title, description, actions}` — eyebrow via `sectionForPath()` | `@/components/ui/page-header` |
| Admin page title | `AdminPageHeader` `{title, subtitle, path, backHref, backLabel, actions}` | `@/components/admin/page-header` |
| KPI tile | `StatTile` `{label, labelTitle, value, valueTone, unit, delta, meter, action, footnote, reserveFootnote}` | `@/components/ui/stat` |
| Bar against a target | `Meter` (tones: neutral, good, info, warning, danger, primary) | `@/components/ui/stat` |
| Change vs prior period | `DeltaChip` `{value, unit, goodWhen}` | `@/components/ui/stat` |
| A list page's table | `TableCard` `{title, description, action, toolbar, footer}` + the `Table` family | `@/components/ui/table-card`, `@/components/ui/table` |
| State on a row | `StatusChip` (neutral, good, info, warning, danger, action) | `@/components/ui/status-chip` |
| Secondary "go here" link | `LinkArrow` (supports `asChild` for `next/link`) | `@/components/ui/link-arrow` |
| Detail page frame | `DetailLayout` | `@/components/ui/detail-layout` |
| Settings page frame | `SettingsLayout` | `@/components/ui/settings-layout` |

**Rules:**
- One `PageHeader` per page. Title renders at 32px everywhere — never override it.
- Filter bars use the `portal-*-filters` class shape; they are already styled as the white
  control bar. Do not restyle them.
- Tables are already styled — filled 10.5px uppercase header, 8px rows, 16px outer gutters.
  Write plain markup; do not add table CSS.
- Motion: put `m-stagger` on a page's top-level vertical stack. `m-seq` on `TableBody`,
  `m-row` on rows and `m-card` on cards are already applied globally. **Never add a motion
  class to a print route.**
- Colour: `--primary` is the orange. Structural borders are `--border`, panel grounds are
  `--surface-alt`. **Orange is only ever the active/selected/action state** — never a border,
  a table header or a divider.
- The navigation rail is dark: `--nav-bg`, `--nav-ink`, `--nav-muted`, `--nav-line`.
- Every new agent page must be reachable from `lib/menu/definition.ts` with a section label.

---

## 6. Build order

Work **one step at a time**. Do not start a step until the previous one's QA gate passes.

### Phase 1 — the core flow

| Step | Tasks | Why here |
|---|---|---|
| 1 | **3.7 + 3.19** | The application record is the spine. 3.19 replaces 3.7's `bank.*` fields, so they are one step or you migrate twice. |
| 2 | **3.1** | Underwriting templates, on the LA-1.4 engine. |
| 3 | **3.2** | The interview that runs them, plus medication rows. |
| 4 | **3.6** | Appointments — extend what exists; the payout strip is new. |
| 5 | **3.4** | Quotation templates. |
| 6 | **3.5** | Quote capture and comparison. |
| 7 | **3.8** | Beneficiaries. |
| 8 | **3.9** | Draft-date optimiser. |
| 9 | **3.10** | Disclosures. |
| 10 | **3.11** | Pre-submission QA engine. |
| 11 | **3.15** | Submission capture. |

### Phase 2 — the extension

| Step | Tasks | Why here |
|---|---|---|
| 12 | **3.12** | Token auth. Clear the `cancelledAutofillStaysCancelled` test first. |
| 13 | **3.14** | Copy-assist — build before maps: it is what agents use for most carriers. |
| 14 | **3.13** | Field maps, **storage + review + fill only**. The AI proposal waits on decision 4. |

### Phase 3 — everything the flow hangs off

| Step | Task | Why here |
|---|---|---|
| 15 | **3.16** | Attempts and resubmission. Schema shape is settled in Step 0; the UI lands here. |
| 16 | **3.17** | Sales settings hub — by now there are eight things to put in it. |
| 17 | **3.23** | Pipeline stage sync. |
| 18 | **3.18** | Pending requirements. |
| 19 | **3.26** | Counteroffers. Needs 3.16 and 3.18. |
| 20 | **3.20** | Welcome pack. |
| 21 | **3.22** | Carrier portal register. |
| 22 | **3.24** | Spouse-linked applications. |
| 23 | **3.25** | Term life. |
| 24 | **3.21** | Sales performance report — last, because it reads everything above. |
| 25 | **3.3** | AI assistant — **blocked on decision 4.** Do not start without my go-ahead. |
| 26 | **Extension package** | The browser extension itself, once 3.12–3.14 are stable. |

---

## 7. How to work each step — three phases

Every step goes **Design → Build → QA**. Announce which phase you are in.

### Design (no feature code)
- Write `docs/la3/steps/<step>-<task>.md`: the routes, the components and where they live,
  the schema delta, the API contracts with Zod schema names, the entitlement flag and roles,
  the states the UI can be in (loading, empty, error, read-only, blocked-by-QA).
- Build the **UI shell only**: real routes, real components from §5, real copy, with stub data
  clearly marked. No database, no API.
- Stop. Show me the shell. I will tick **Design** on the tracker.

### Build
- Migration first, then types, then service layer in `lib/`, then API routes with Zod, then
  wire the UI to real data.
- Autosave anywhere an agent types during a call. **Banking details are never lost** —
  a failed save must surface and retain the value, never silently drop it.
- Every value that was pre-filled is marked as pre-filled, with its source recorded.
- Stop. Show me it working. I will tick **Build**.

### QA
Run, and paste the output of:
```
npx tsc --noEmit
npx eslint <every file you touched>
npm run build
npm test            # if the step added tests
```
Then verify by hand and report on each:
- **Entitlement**: the page 403s without its flag; the API does too.
- **Roles**: a role that should not see it cannot, at the API not just the menu.
- **Tenant isolation**: a row from another tenant is unreachable. Say which RLS policy proves it.
- **Sensitive fields**: masked by default; one reveal per request; an audit row written; CVV absent from the schema, the logs and the API response.
- **Money**: cents end to end, no float, no rounding on the way in.
- **Empty, loading, error and read-only states** all render.
- **Design**: the page uses `PageHeader`/`StatTile`/`TableCard`, has no orange structural
  border, and has `m-stagger` on its stack.
- **Nothing else broke**: name the existing routes you re-checked.

Then stop. I will tick **QA**.

---

## 8. Task acceptance criteria

Only the rules that are easy to get wrong. The full text is in the sprint.

**3.7 Application record** — one key/value row per field in *our* field names; carrier forms map
onto them, never the reverse. Each value records its source (lead / interview / quote / typed).
Each carrier has a field set; with none, the platform Final Expense set is used.

**3.19 Payment** — ACH, Direct Express, debit, credit, direct bill. Luhn for cards, the Mastercard
check for Direct Express, routing checksum **for ACH only**. The form switches fields by method.

**3.1 UW templates** — conditional follow-ups, knockout flags, versions, preview. Every seeded
template carries the five survival questions: SS deposit date, is this the right account, anyone
else on the call, existing coverage, can you get a text now.

**3.2 Interview** — answers autosave; a knockout is impossible to miss; progress bar; post-call
edits allowed **with an audit trail**. Medications are always rows (name, dose, since, prescribed
for) with autocomplete and free entry — never a text box.

**3.6 Appointments** — add writing number, advance months, state coverage to the existing table.
The payout strip is agent-only, carries a fixed "recommend on fit first" line, and **never
auto-selects a quote**.

**3.4 Quotation templates** — age basis (nearest/last birthday) is part of the template.
Versioned. Interview values pre-fill and are marked. **No rate tables.**

**3.5 Quotes** — cents. **Premium ≥ face amount is rejected.** Amber on an unusual per-$1,000
rate or an out-of-band face amount. Selecting one quote discards the others but **deletes
nothing**. The client print route carries no internal columns.

**3.8 Beneficiaries** — primaries total **exactly 100.00**; a contingent needs a primary;
"other" needs text. Warn on under-18, on "estate", on more than 4 primaries. Split evenly gives
33.34 / 33.33 / 33.33. The live total is green only at 100.

**3.9 Draft dates** — SS pays the 2nd/3rd/4th Wednesday; the 3rd for pre-May-1997 or
SSI-concurrent; the 1st for SSI, moving to the business day before on a weekend or federal
holiday. Recommend 2–4 days after the **latest** arrival across the next 12 months, never past
the 28th. Two alternates, a read-aloud sentence, the 12 arrival dates. Override allowed **and
logged**. Needs a federal holiday calendar — say which source you used.

**3.10 Disclosures** — replacement notice and 1035 exchange seeded. Rules are AND clauses over
application values. An unacknowledged required disclosure **hard-blocks "ready"**. Acknowledging
records the method (read aloud / emailed / mailed). "Not applicable" needs a reason.

**3.11 QA engine** — one verdict: pass / pass with warnings / fail. Every item links to the exact
field (`?attempt=2&step=payment#bank.routing_number`). Runs **live while the agent types**. Fail
blocks "ready" and the extension. The verdict is **frozen at submission**.

**3.15 Submission capture** — reference number with a format check and duplicate warning; pasted
screenshot in private storage behind signed URLs; submission time. Writes into
`tenant_issued_policies`. Application number and policy number both kept. The Missing reference
list stays visible until empty.

**3.12 Extension auth** — 60–90 min tokens, scoped to one application and bound to the carrier's
domain. Revocation checked in the DB **on every request**, effective under a second. One
sensitive field per call. **No `<all_urls>` permission.**

**3.14 Copy-assist** — **one component**, used in the extension and as a detachable window.
One-click copy with a toast, DOB and phone format variants, group copy, progress ticks.
Sensitive fields re-mask after 60 seconds with a best-effort clipboard clear.

**3.13 Field maps** — publishing is blocked until every sensitive entry is verified. A missed
selector logs a `map_miss`, does **not** fill, opens copy-assist for that field, and marks the
map "needs review". Fills are plain lookups — **no AI at fill time, ever.**

**3.16 Attempts** — one attempt per carrier tried; never edited in place, never deleted.
The next attempt carries health, medications, address, beneficiaries and payment.
It does **not** carry the quote, disclosures, QA verdict or copy-assist ticks.

**3.23 Pipeline sync** — forward only. A decline that opens a new attempt goes back to Quoted.
A hand-dragged stage **wins** and shows a reconcile hint. Dragging on the board **never** changes
an application's status. With several live attempts the stage follows the most advanced.

**3.18 Pending** — amber after N days, red after 2N (N is a setting). Can create a callback.
**Never marks a policy issued on its own.**

**3.26 Counteroffers** — a new record beside the original, which is never overwritten. Status
`counteroffer_pending`, plus a waiting-on-client requirement. Accept updates coverage, reissues
the welcome pack, recalculates commission. `declined_by_client` and `offer_expired` each offer a
one-click new attempt.

**3.20 Welcome pack** — four items cannot be removed from the template: the bank statement
descriptor, the amount, the draft day, the agent's phone. Once per attempt; bounces shown.

**3.22 Portal register** — **no password column, and a test that enforces it.**

**3.24 Spouse** — address, contact, payment and draft day shared with a detach option.
**Health is never copied.** One welcome email if both share an address.

**3.21 Report** — every rate shows numerator and denominator. A reason×carrier cell with fewer
than 5 cases shows a greyed count, **not a percentage**. Reads from a materialised view.
"Placed" is labelled partial until Module 5.

---

## 9. Pages

**Create**
- `/app/applications/[caseId]` — the workspace. Steps: Verify (reuse `VerificationPanel`) →
  Interview → Quote → Application → Beneficiaries → Payment & draft date → Disclosures →
  Review (QA) → Submit → After submit → Case timeline. A live QA rail on every step.
  Header: client, attempt switcher, status chip, household toggle, Open portal, Add spouse.
- `/app/applications/[caseId]/quotes/print` — client comparison, no shell, printable.
- `/app/applications/[caseId]/copy-assist` — pop-out for agents without the extension.
- `/app/applications` — list. Stats: Draft, Ready, Submitted, Pending carrier, Awaiting policy #.
- `/app/quoting` — every quote including discarded ones.
- `/app/draft-dates` — standalone calculator.
- `/app/pending` — Requirements / Counteroffers / Awaiting policy number.
- `/app/sales-performance` — Funnel, Timing, Decline reasons, Counteroffers, Premium.
- `/admin/field-maps` — platform-default review queue.

**Adjust**
`/app/leads/[id]` (start/continue, Case tab, Add spouse) · `/app/dialer` ("They are interested")
· `/app/inbound/[id]/verification` ("Continue to underwriting") · `/app/leads` (stage sync +
reconcile hint) · `/app/dashboard` (Awaiting policy number, Waiting on client, Counteroffers
expiring) · `/app/deal-flow` (written on submission from the application) · `/app/appointments`
· `/app/policies` (both numbers, re-run draft date) · Callbacks & Calendar (chases as callbacks)
· `/app/settings` (new Sales group) · `/admin/products` · `/admin/carriers` · `/admin/templates`
· `/admin/state-disclosures` · `/admin/features` (three new flags).

**Entry points**: lead detail, the dialer's "They are interested", and inbound verification all
open the **same case** through `lib/outboundApplication/service.ts`. Build that path once.

---

## 10. Report back after every step

```
Step N — task 3.x — <phase>

Files:      created / changed / deleted
Migration:  name, tables, RLS
API:        route, method, schema, flag, roles
Pages:      route → component
Verified:   tsc / eslint / build / tests  (paste the actual output)
Checked:    entitlement, roles, tenant isolation, sensitive fields, money, states
Not done:   anything the task asks for that the data cannot support — name it, don't fake it
Questions:  anything you had to guess
```

If an acceptance criterion cannot be met with the data that exists, **say so and leave it out**.
Do not invent a figure, a metric or a status to fill a shape.

---

## 11. Start

Do Step 0 now. Produce `STATUS-MODEL.md`, `SCHEMA-PLAN.md` and `ROUTES.md`, list what you could
not find, and stop for approval. Write no feature code until I approve the plan.

# Money & compliance settings: Accounting, Retention, Compliance (2026-11-03)

The three settings pages under Settings › Money & compliance:

- `/app/accounting-settings` (LA-7.9)
- `/app/retention-settings` (LA-5.11)
- `/app/compliance/settings` (LA-6.8)

The owner asked for them to be redesigned so that a person understands what each page is for and
what to do on it. They stay where they are (owner, 2026-11-03).

The mockups are at https://claude.ai/artifact/7x3qg2Q785AiXwpjZvVGjy. The owner picked **A**: a
Start here tab and the tabs on the title line. Direction B (settings written as sentences) was not
built.

## 1. Inventory: every value and what reads it

Every value on the three pages has an engine that reads it. None is dead.

### Accounting (`accounting_settings`, LA-7)

| Value | Read by |
|---|---|
| default_basis, fy_start_month | `lib/accounting/pnlStore.ts`, `pnlCore.ts`, P&L pages and drill, `taxStore`, `producerStore` |
| persistency_month, sample_threshold | `pnlStore.ts` (cost per persisting policy) |
| acquisition_defaults | `expenseStore.ts`, the expenses API and the new-expense page |
| invoice_tolerance_cents | `invoiceStore.ts` (vendor bills, LA-7.2) |
| payout_cadence, payout_draft_days, payout_auto_publish | the `la7-payout-drafts` cron function (20261015240000, then 20261015300000) |
| payout_statement_footer, payout_dispute_tolerance_cents | the payout run functions (20261015620000) |
| producer_default_split_bp, producer_default_basis, producer_negative_policy, producer_recovery_cap_bp, producers_see_balance | `producerStore.ts` and the producer-ledger functions |
| producer_share_fees | the producer split function (20261015620000) |
| bank_amount_tolerance_cents, bank_window_days | the deposit-match suggestion functions (20261015260000) |
| tax_1099_threshold_cents, tax_id_viewer_roles | `taxStore.ts` |

### Retention (`retention_settings`, `risk_weight_set`, `queue_assignment_rule`, LA-5)

| Value | Read by |
|---|---|
| weights (versioned) | the radar (`radarStore` / `score.ts`) |
| medium_from, high_from, critical_from, danger window, affordability bands | `lib/retention/score.ts` |
| queue_min_band, include_medium_when_empty, worked_cooldown_days, max_cards, queue_default_sort | `queue.ts`, `queueStore.ts`, the Save queue page |
| sample_floor, carrier_sample_floor | `signals.ts`, `campaignStore.ts` |
| bill_decline_cooloff_days, bill_talk_track | `campaignStore.ts` |
| servicing_grace_days | the servicing verifier (20261019200000) |
| reinstatement amber, red and pin days | `reinstatement.ts`, the Reinstatement board |
| reinstatement_escalate_days, assignment strategy, carrier map, rep order, queue owners | `assignmentStore.ts` |
| winback_*_days | the win-back guard and sync (20261014500000) |
| holdout_*, prediction_horizon_days | `effectivenessStore.ts` |

### Compliance (`compliance_settings` + the rule, deadline and hold tables, LA-6)

| Value | Read by |
|---|---|
| gate_* (consent missing, timeout, four switchable checks) | `lib/compliance/transferGate.ts` |
| complaint_amber_days, complaint_red_days, response deadlines | `complaintStore.ts`, `/api/cron/complaint-deadlines` |
| deletion_hold_days, deletion_methods | `dataSubjectStore.ts` |
| deletion_performer_roles | the deletion API and pages |
| purge_* (schedule, window, recipients), retention rules, holds | `retention_execute` and the scheduled job, `/api/cron/retention-summary` |
| report_roles, report_gap_checks | `evidenceReport.ts` |
| dashboard_hidden_tiles | `dashboard.ts` |
| dashboard_monthly_email, dashboard_email_recipients | `/api/cron/compliance-monthly` |

The cron routes run through the app-cron dispatcher (20261015500000).

### Other findings

- "Flag invoices off by more than" is a vendor-bill setting (LA-7.2). It was filed under Partner
  payouts.
- LA-7.9 lists the recurring-expense templates and the tax category map on this page. They are
  still links only, to Expenses and Tax summaries; nothing new is edited here.

## 2. Critique (before)

A first-time owner could not tell three things:

- **What to decide first.** Each page opened on whatever its first tab held: the P&L basis, the
  scoring weights, the complaint deadlines.
- **What a value does.** Labels named the stored field ("Persisting at month", "Draft after
  (days)", "Time budget per check (ms)"). The effect, when stated at all, was a grey line under the
  card.
- **Whether a value was still Insurvas's.** Retention printed "Platform: N" under every field. The
  other two pages said nothing.

The pages also broke the foundation rules:

- The tabs sat on their own row instead of the title line.
- Compliance drew amber notice boxes on the page: coverage, FTC, the not-legal-advice line and
  "purge schedule off".
- There were three save models:
  - Accounting had one save bar.
  - Retention had a Save and a Reset in each of 10 cards.
  - Compliance saved when a field lost focus and said nothing.
- Forms sat inside lists. Add a deadline and Place a hold were forms in the table's toolbar, and a
  retention rule was a pop-up form.
- Yes/no choices were dropdowns, and Compliance used checkboxes instead of switches.
- A separate "Locked" card held the safety limits, away from the settings they guard.
- Compliance had an in-page Change log that duplicated the header's History. Settings history
  (LA-8.8) already reads `compliance_setting_change`.

## 3. What changed

### Shared

- **Tab slot on the title line.** The Settings frame (`components/app/agent-settings-tabs.tsx`) has
  a lead slot for routed sections. `SettingsSectionHeader` takes `lead`
  (`components/app/settings/primitives.tsx`). Both edits are additive.
  - The frame sets `--frame-rail-w`, so the tabs start on the cards' left edge.
  - The "Last changed · History" note wraps inside the title column instead of widening it.
- **`components/app/settings/setting-row.tsx`** is new:
  - `SettingRow`: the name, the control, and "What this changes", with Insurvas's value shown only
    where yours differs.
  - `LockedNote`: a safety limit with its lock, beside the setting it guards.
  - `SectionTabs`: the tabs on the title line.
  - `useAnchorTab`: a Settings-search link such as `#tax` opens the right tab, opens an Advanced
    fold if the anchor is inside one, and scrolls to it.
- **One save bar per page, with a leave guard.** Each page's More menu holds History and related
  pages.

### Accounting

The tabs are **Start here · Partner payouts · Producer pay · Bills, bank & tax**.

- **Start here:** how your P&L counts money (accrual or cash, and the year start) and acquisition or
  overhead per category, with the consequence sentence. Persistency month and the sample size are
  under Advanced.
- **Partner payouts:** "When a payout run is ready" comes first (wait for review, or publish to the
  partner). The dispute tolerance is under Advanced.
- **Producer pay:** yes/no choices are switches and three-way choices are segmented controls. The
  recovery cap shows only with "Recover a capped share".
- **Bills, bank & tax:**
  - The invoice tolerance moved here.
  - Each bank account is a row that opens Bank deposits. The match tolerances are under Advanced.
  - The tax notice stays as plain text, never a card.
- Each of the three safety limits sits beside its setting, with its reason behind the (i).

### Retention

The tabs are **Start here · Who works it · Campaigns & win-back · Holdout**.

- **Start here:**
  - "The save queue takes", with today's queue count and the book's bands.
  - The risk bands.
  - "How a policy is scored", which opens **`/app/retention-settings/weights`**. That page draws the
    weights table; Save stays off until the exact weights have been previewed, and saving makes a new
    version. Its More menu has Reset to Insurvas weights.
  - Queue behaviour and signal settings are under Advanced.
- **Who works it:** queue owners, how reps share work, and the reinstatement hand-off.
- **Campaigns & win-back:** the paper-bill campaign, the reinstatement countdown (servicing grace
  under Advanced) and the win-back waits. The affordability floor sits beside them as a lock.
- **Holdout:** the fixed explanation, then "I have read what the holdout does", then the switch.
- **One save bar** replaces the 10 per-card Saves and the separate "Save queue owners" button.
  - It sends `save_settings` and/or `save_rules`, the same API actions as before.
  - A shorter affordability wait asks for the typed word in a confirm when you save.
- **Reset this tab to Insurvas values** (More, with a confirm) replaces the 10 Reset buttons. It
  calls the same `reset` action for each section on the tab.

### Compliance

The tabs are **Start here · Complaints · Records · Holds & deletion · Gate & reports**.

- **Start here:** the coverage sentence with Set deadlines, "If a transfer has no consent on file"
  (accept and flag, or block), and "Delete records on a schedule".
- **Complaints:**
  - Every licensed state without a deadline, and the FTC if unset, is a row with an amber "Not set"
    chip. These rows replace the notice boxes.
  - A row opens **`/app/compliance/settings/deadlines/[regulator]`**, which has Remove deadline with
    a confirm. Add deadline opens **`…/deadlines/new`**, where `?regulator=` preselects a regulator.
  - The escalation days are on this tab.
- **Records:**
  - The rules table opens **`…/retention/[recordType]`**. That page shows the Insurvas default, your
    rules (Change, or Remove with a confirm) and the add-or-change form that replaces the pop-up.
  - The not-legal-advice line stays as plain text.
  - The scheduled-purge settings are on this tab.
  - Runs open **`…/runs/[id]`**, with each record type's figures.
  - Dry run now and Live run are the tab's two buttons. Live run confirms with the count.
- **Holds & deletion:**
  - Holds open **`…/holds/[id]`**. Release confirms, and asks for a reason.
  - Place hold opens **`…/holds/new`**.
  - The deletion settings are on this tab.
- **Gate & reports:**
  - The transfer gate switches. Litigator and internal do-not-call are locked on.
  - The time budget, gap checks and dashboard tiles are under Advanced.
  - Who may generate reports, and the monthly email with its recipients.
- **One save bar** sends one `op: "settings"` patch of the changed keys. The server validates and
  audits each key, as before. Lists save on their own pages.
- **The Change log is gone.** The header's History has every change.

## 4. Behaviour

Every value saves to the same column through the same API action as before, so the audit rows are
unchanged. Only how the screen gathers edits changed:

- **Retention:** sections are saved together from one save bar, instead of one section per click.
- **Compliance:** values are saved from the save bar, instead of when a field loses focus.
- **Compliance record pages:** they read the same `GET /api/app/compliance/settings` as the page.

No migration.

## 5. Checks

- tsc 0, and eslint is clean on every touched file.
- `npm test`: 3,793 of 3,793 pass.
- Tests updated to the new layout, keeping each test's intent:
  - `lib/settings/registry.test.mjs` reads each board's `SECTION_TAB` and checks each anchor's
    `id="…"`.
  - `lib/retention/la5_8_9_11.test.mjs`: the holdout switch, and Save after preview on the weights
    page.
  - `lib/settingsAudit/settingsAudit.test.mjs` accepts the wrapper around the "Last changed" note.
- The AG-0.5 isolation audit reads each page's own role check. That is why every new compliance
  route has the owner guard inline.
- **Walk:** at 1440×900 and 1280×800 on :3000 as the demo owner, with nothing saved.
  - Every tab of all three pages was opened, plus the weights page and the deadline, record-type,
    hold and run pages.
  - The save bar and Discard were tested, as were the weights error state and the hold-release
    confirm (closed without releasing).
  - Anchor links (`#tax`, `#queue`, `#purge`, `#holds`) open their tab and fold.
  - At 1280, the Compliance tabs fit beside two buttons once two labels were shortened ("Records",
    "Gate & reports"). A tab with its own buttons drops More, because History is on the line under
    the title.

## 6. Not done

- No save was made on live demo data, so no write path was walked end to end. The endpoints are
  unchanged.
- The recurring-expense templates and the tax category map are still links (see §1).
- The read-only (bookkeeper) view of Accounting was not walked with a bookkeeper session.

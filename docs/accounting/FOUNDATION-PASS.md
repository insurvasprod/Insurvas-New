# Accounting: foundation pass (2026-11-03)

A /ui-taste pass (polish + distill) over every Accounting step, measured against
[UI-CONSISTENCY.md](../design/UI-CONSISTENCY.md) (§2, §3, §4, §6, §6b, §6c, §8a, §11, §17),
the owner's rules for this round and the Notion spec (Module 7 · Accounting, LA-7.1 to 7.9).
Book of business (`/app/carrier-files`, `/app/needs-you`, `/app/policies`, `/app/book-setup`) is the
reference for the look.

The owner's rules used here:

- Tabs and sub-pages sit on the title line.
- The pattern is list page → detail page → tabs.
- No side panels or sheets. Pop-ups only to confirm or to upload.
- No explainer or info cards. Notices go to the bell; a dialog keeps one line.
- A detail header is the title, a status chip and one muted line of facts. It has at most two buttons,
  plus a More menu.
- Figures are one StatStrip, and its tiles are the links.
- Tables come from `TableCard`. Text stays 12/14px. No eyebrows, glows or gradients.

Out of scope: Payout runs (Partners) and Accounting settings (Settings) open from other menus. Both are
listed only where an Accounting page links to them.

## Inventory

| Step | Address | Tabs / views | Opens from it (before this pass) |
|---|---|---|---|
| Profit & loss | `/app/pnl` | none (statement and six-month trend were two stacked cards) | Period chips, ‹ › stepping, custom From/To + Show, Basis toggle; a line opens a **Sheet** with its entries (paged 200); tax warning banner links to Tax |
| Bank deposits | `/app/bank` | To match · Not explained · Not received · Accounts (a row of tabs under the strip) | Suggest again, Add account (**dialog**), Import a bank export (**upload dialog**, two steps); per row: Confirm, Decline/Remove, Match by hand (inline), Not carrier money (inline) |
| Vendor bills | `/app/vendor-bills` (also `/app/invoices`, `/app/vendor-returns`) | Invoices · Returns (a tab row inside the step) | Enter an invoice (**920px dialog**), From a template (**dialog** with a delete list), status dropdown, search; Open → **DetailPanel overlay** with Approve, Mark paid (inline), Edit (**dialog**), Dispute / Close dispute, Void (inline), Save as monthly template, attach document |
| Expenses | `/app/expenses` | To confirm · Booked · Recurring (a row under the strip) | Add an expense (**dialog**), Confirm all; per row: Counts as dropdown, Confirm, Mark paid, Edit, Skip/Void (all inline), Receipt upload/open |
| Producer splits | `/app/producer-splits` | none: Producers and Payout runs stacked | Policy sentence + Change link; per producer: Set split (**dialog**), Open → **Sheet** (Draft a run, Write off, splits, entries); per run: Publish, Mark paid, Void (inline) |
| My balance | `/app/my-balance` | none: entries and runs stacked | none (read-only) |
| Tax summaries | `/app/tax` | Contractors · By category · Export (a row under the strip) | Year dropdown, Reveal tax ID, Details (**dialog**, 11 fields), category dropdowns, download links styled by hand |

## Critique and fixes, page by page

### The frame (`accounting-page.tsx`, `steps.ts`)
- **Defect.** The frame took no `titleInfo` or `meta`, so a step could not put its (i) or a record's facts
  on the title line. Three steps instead drew a sentence or a tab row above their first card.
  **Fix:** `AccountingPage` takes `title`, `titleInfo`, `chip`, `facts`, `lead` and `actions`, as
  `DataInPage` does.
- **Defect.** `accountingStepOf` matched only the step's own address, so a record under a step lost its
  rail and sidebar highlight. **Fix:** sub-paths match their step.

### Profit & loss
- **Notice on the page.** "N contractors need a 1099…" was a tinted banner (§3). **Fix:** a warning
  `Callout`, so it goes to the bell and links to Tax.
- **Side panel.** A line's entries opened in a Sheet. **Fix:** a detail page, `/app/pnl/entries`.
  - Its header: the line's name and one facts line (amount · entries · period · basis).
  - Its body: a `TableCard` with the entries, fitted paging, and each entry's source link.
  - Its trail: Accounting › Profit & loss › line.
- **Two lists stacked.** The statement and the six-month trend were two cards. **Fix:** tabs on the title
  line, Statement · Last six months (`?view=trend`), so the statement fills to the rail's foot.
- **Explainer rows.** The table carried the basis note, the acquisition-only sentence and the threshold
  sentence. **Fix:** they move behind the title's (i).
  - The basis stays on screen: the Accrual/Cash toggle states it.
  - "Received: not imported" stays visible, never $0 (spec 7.7).
- **Hand-made stepping.** ‹ › were text glyphs. **Fix:** icon buttons with names.
- **Figures.** Tiles were not links. **Fix:**
  - Commission reported → Bank deposits.
  - Acquisition cost → Vendor bills.
  - Cost per persisting policy → the trend tab.

### Bank deposits
- **Tabs under the strip.** **Fix:** To match · Not explained · Not received · Accounts on the title line,
  at their own addresses (`?view=`). The figure tiles link to the same views.
- **Four buttons and a sentence in the toolbar.** "Nothing is matched until a person confirms it." was an
  explainer (§3), and the toolbar held Suggest again, Add account and Import. **Fix:**
  - The sentence moves behind the (i).
  - The header has Import a bank export (primary) and More (Add account, Suggest again).
  - The toolbar has search and Refresh. Before, there was no search; it now covers the description,
    carrier and account.
- **Add account was a form pop-up.** **Fix:** an inline row at the foot of the Accounts view, built from
  `Field`/`control`. Header More → Add account opens it.
- **Import dialog (an upload, so it stays a pop-up).** **Fix:**
  - Its labels and dropdowns are now `Field` + `control`.
  - The tinted "lines could not be read" box is a one-line dialog `Callout`.
- **Paging.** It used the shared Pager with `useFittingPageSize`. Kept.

### Vendor bills
- **Tabs inside the step.** **Fix:** Invoices · Returns on the title line, as links
  (`/app/vendor-bills`, `?tab=returns`).
- **Invoice detail was a DetailPanel overlay.** **Fix:** a detail page, `/app/vendor-bills/[id]`.
  `?open=<id>` on the list and on `/app/invoices` redirects there, so the P&L links still work.
  - **Title:** the invoice number, with the status chip. The source opens the facts line: at 1280 a
    "source · number" title squeezed the tabs.
  - **Facts line:** source · dated · period · due · paid · document.
  - **Buttons:** at most two by status (Approve or Mark paid, and Edit), plus More: Dispute or Close
    dispute, Void, Save as monthly template, Attach or replace the document, Open the document.
  - **Tabs:** Lines · Against our count · In the ledger.
  - **Figures:** one strip: Total · Our figure · Difference · Unattributed.
  - **Notices:** the beyond-tolerance warning is a `Callout`, so it goes to the bell; approving is still
    allowed (spec). The unattributed sentence is the Lines tab's table footer.
  - **Pop-ups:** Mark paid, Dispute and Void are confirm dialogs with their one or three fields.
- **Enter / Edit invoice was a 920px form pop-up.** **Fix:** a page, `/app/vendor-bills/new`, which also
  covers `?edit=<id>` and `?template=<id>`. It has a `LeaveGuard`, Discard and Save, and a Blank / From a
  template switch. Deleting a template stays a `confirmAction`.
- **List.** **Fix:**
  - The status filter is the shared dropdown, and rows link to the detail page.
  - The tiles link to filtered lists (`?status=`).
- **Returns tab.** This is LA-2.19's `VendorReturnsWorkspace`, shared with Lead sources. Its inner views
  and its three dialogs are **not reworked in this pass**; see "Not done".

### Expenses
- **Tabs under the strip.** **Fix:** To confirm · Booked · Recurring on the title line (`?view=`). The tiles
  link to them.
- **Add an expense was a form pop-up.** **Fix:** a page, `/app/expenses/new`, with a LeaveGuard. The
  acquisition sentence is the field's hint.
- **Up to five small buttons per row.** **Fix:** each row has one primary action (Confirm on To confirm,
  Mark paid on an unpaid booked row), plus a row menu: Edit, Skip/Void, Attach or open the receipt.
  - Mark paid, Void and Edit are confirm dialogs.
  - The row's own "Counts as" dropdown stays, because it is the classification the spec requires visible,
    with "Overrides the category default".
- **Header.** **Fix:** Add an expense (primary), and Confirm all N when that view is open.

### Producer splits
- **Two lists stacked.** **Fix:** Producers · Payout runs on the title line (`?view=runs`).
- **A sentence under the strip.** "Negative balances: carry forward. Change" moves behind the (i) with
  its link to Accounting settings.
- **Producer was a Sheet.** **Fix:** a detail page, `/app/producer-splits/[userId]`.
  - **Title:** the name, with a chip: "Owes the agency" or "Owed".
  - **Facts line:** the current split · balance · owed to date · clawed back.
  - **Buttons:** Draft a run (primary, a confirm dialog with From/To), plus More: Write off the balance (a
    confirm dialog with its reason; only when negative).
  - **Tabs:** Entries · Splits · Payout runs.
  - **Splits tab:** the effective-dated rules, and an Add a split form at its foot. The old pop-up is gone.
- **Runs.** **Fix:** Publish is the row's action. Mark paid and Void are confirm dialogs. The status reads
  in words, not the raw key.

### My balance
- **Two lists stacked.** **Fix:** Entries · Payout runs on the title line (`?view=runs`), each table paged.
- **Figures.** The strip stays: the balance, and the runs. The runs tile links to the runs view.

### Tax summaries
- **Notice card.** The not-tax-advice notice was a tinted box above the page. The spec requires it
  "visible and non-dismissible" on the 1099 report and the export. UI-CONSISTENCY §8 says legal wording
  stays on screen in full. **Fix (labelled: the spec's legal wording beats the no-notice rule):**
  - The full sentence is kept, as plain muted text in the table card's foot on every view and on the
    error state.
  - It has no box, ground or tint.
- **Tabs under the strip.** **Fix:** Contractors · By category · Buckets on the title line (`?view=`). The
  "Export" tab is gone: the export is the header's Download XLSX (primary), with More for the three CSV
  sheets. These are kit `Button`s, not hand-styled links.
- **One table holding two jobs.** By category mixed totals and the bucket map under a heading row.
  **Fix:** split into By category and Buckets.
- **Sentences in the toolbar.** **Fix:** they move behind the (i). The year stays as the toolbar dropdown.
- **Details was an 11-field form pop-up.** **Fix:** a detail page, `/app/tax/payee/[type]/[id]`.
  - **Title:** the name on the form, with the 1099 chip.
  - **Facts line:** display name · type · paid in the year · masked tax ID.
  - **Buttons:** Reveal tax ID (audited, only for roles allowed to), and Save.
  - **Body:** the form, with a LeaveGuard.
- **Figures.** **Fix:** Missing details → Contractors; Under the threshold stays a count.

## Spec check (Notion LA-7)

| Spec item | State |
|---|---|
| Reported and Received side by side, "not imported" not $0 (7.7) | Present, kept |
| "Building" for the persisting cost, counts under the threshold (7.7) | Present, kept |
| Previous period and last year beside the current one, basis stated (7.7) | Present, kept |
| Every figure drills through (rule 8) | Lines drill to a page now. **Added:** strip tiles link to their rows |
| Missing W-9 count during the year (7.8) | Present on P&L (now via the bell) and the Tax strip |
| Invoiced vs recorded before approving, flags but does not block (7.2) | Present, now its own tab |
| Unattributed lines visible (7.2) | Present; **added** an Unattributed tile on the invoice |
| Recurring templates, three fields or fewer (7.2) | Present, now on the new-invoice page |
| Confirm this month's recurring expenses (7.3) | Present: the To confirm tab and Confirm all |
| Acquisition override visible (7.3) | Present, kept |
| Partial amounts, unexplained and never-received findings (7.6) | Present, kept |
| Duplicates shown as skipped on import (7.6) | Present in the import result |
| Negative balance never clamped, write-off with reason (7.5) | Present, kept |
| Entry links to the commission entry that caused it (7.5) | **Not built**: no route opens one commission entry |
| Masked tax ID, audited reveal, legal name separate (7.8) | Present, kept |
| Non-dismissible notice on report and export (7.8) | Present: plain text on every Tax view, and in the export file |
| XLSX + three CSV sheets (7.8) | Present, now the header's Download + More |
| W-9 upload on the tax profile (7.8) | **Not built**: no upload API for a W-9 file; the W-9 on file switch stays |
| No pay, delete or edit-amount controls (rules) | Holds. Edit amount exists only on recurring templates and unconfirmed instances, which book nothing |

Added outside the spec (labelled):

- Search on Bank deposits.
- Strip tiles as links. This is the owner's foundation rule, not LA-7.

## Checks (2026-11-03)

- **Typecheck:** `npx tsc --noEmit -p .` exits 0.
- **Lint:** eslint on every changed file exits 0.
- **Tests:** `npm test` passes 3,745 of 3,745. This includes the new `lib/accounting/foundationPass.test.mjs`
  (9 rules) and the updated `accountingFlow`, `pnl`, `tax` and `invoices` tests.
- **Browser walk.** Every step was walked on :3000 as the demo agency owner, at 1440×900 and then at
  1280×800, measuring table width against card width:
  - P&L: Statement, Last six months, and a line's entries page.
  - Bank: To match, Accounts with Add a row, the More menu and the Import dialog. All were opened and
    cancelled.
  - Vendor bills: the list, Returns, an invoice's Lines and Against our count, the Mark paid confirm
    (cancelled), and Enter an invoice.
  - Expenses: Booked, the row menu, and Add an expense.
  - Producer splits: Producers, Payout runs, and a producer's Entries and Splits.
  - Tax: Contractors, Buckets, and a contractor's page.
- **Saving.** Nothing was saved on the demo data.
- **Fixed during the walk:**
  - The Expenses row menu was pushed off the card. The "Paid to" lines now truncate, with the full text on
    hover.
  - The Bank queue and invoice count tables were wider than the card at 1280.
  - A long facts line squeezed the invoice tabs. The facts line no longer widens the title column.
  - The Bank search placeholder was clipped.
  - The invoice form's Type column was cut off.

## Round 2 (owner, 2026-11-03)

- **Bank deposits:** More (Add an account, Suggest matches again) sits beside Refresh. Import a bank
  export stays the header's one button.
- **Profit & loss, readability:**
  - Each section (Money in, Held, Acquisition cost, Overhead, Producer splits, Per policy) opens on a
    tinted band, with its note after a dot.
  - Its lines are indented under the band.
  - Every total sits on a hairline, its comparisons in full ink.
  - Net profit is the last band, red when negative.
- **Tax summaries:**
  - Contractors' columns spread evenly; their fixed widths are gone.
  - The 1099 strip shows only on Contractors, so By category fits without scrolling (698 of 698 px).
  - Buckets is left as it was.
- **Partner payouts moves into Accounting.** It was Partners › Payout runs. This is LA-7.4, part of
  Module 7 in Notion.
  - **Where it is:** a step between Expenses and Producer splits, at the same address `/app/payouts`,
    with the same menu key. Its rail badge counts drafts.
  - **The run page:** a run is now its own page, `/app/payouts/[id]`, with the tabs Statement · Items ·
    Disputes · Terms used. It was a 960px pop-up.
  - **Pop-ups:** drafting a run, marking it paid, voiding it, disputing an item and resolving a dispute
    are confirm pop-ups.
  - **Publishing without business details:** the warning goes to the bell.
  - **The partner record:** its Payouts tab still lists the partner's runs, and each run opens on the new
    page.
- **Mark paid** on expenses and producer runs now asks for the payment reference (spec LA-7.3 and 7.5).
  The APIs already took it.

### Feature test, round 2

Run on the demo agency as the owner. Only actions that can be undone were run; the permanent ones were
checked by refusal.

- **Reads:** every GET answered 200, between 0.4 and 1.8 s on dev:
  - steps, invoices, expenses, bank, producers, payouts, tax, settings and the P&L drill (accrual and
    cash);
  - the run detail and its CSV statement;
  - the XLSX export and the three CSV exports.
  - My balance answers 403 to an owner, which is correct.
- **Undoable writes**, all of which worked and were put back:
  - Invoice SLL-2609: dispute, then close the dispute. It is back to Received.
  - An expense's classification flipped and back. It is not left marked "overridden".
  - A tax bucket changed and back. It is not left marked "overridden".
  - Suggest matches again.
- **Permanent actions, sent with an ID that does not exist.** Every one refused:
  - 404 for invoice approve, paid and void; expense confirm, void and paid; payout publish and void;
    payout build; producer-run publish.
  - 400 for invalid invoice and expense bodies, a manual bank match, and a write-off with nothing to
    write off.
  - 403 for reveal tax ID, from a session that has not passed two-factor. This is the intended step-up.
- **Three routes answer 200 to an ID that does not exist.** Nothing is written, but they should say not
  found:
  - bank confirm (`result: 0`);
  - bank ignore (`result: null`);
  - invoice-template delete (`ok: true`).
- **Partner portal:** signed in as a partner, Statements shows only that partner's published run. None of
  the 14 drafts are visible.

## Round 3: spec gaps closed (owner, 2026-11-03)

| Gap (Notion) | Built | Checked live |
|---|---|---|
| Producer splits are for agencies only (7.5) | A plan whose audience is `individual` gets no Splits step on the rail. Producer splits, a producer's page and My balance each show the "is for teams" gate. | The demo is an agency, so it still sees them |
| A producer's entry opens what caused it (7.5) | The entry's policy number links to that policy's Commissions tab. | The link renders: `…/0119106916?tab=commissions` |
| W-9 upload on the tax profile (7.8) | On a contractor's page, More has Attach the W-9 / Replace / Open, and the facts line says whether one is on file. Attaching ticks "W-9 on file". New route: `/api/app/accounting/tax/w9`, owner and bookkeeper. The file is stored in `accounting-files/{tenant}/w9/{profile}/` and opened through a 60-second link. **No database change.** | "No W-9 is attached" (404); a fake profile is refused (404). No real file was uploaded. |
| The P&L's trailing view (7.7) | A Persisting cost tab lists the six months old enough to have a cost per persisting policy. Each row shows acquisition cost, issued, cost per issued, how many lasted, cost per persisting and the chargeback tax. It costs three reads for all six. The Cost per persisting tile links to it. | It renders. On the demo every month reads "Building", because the policy history doesn't reach back the 13-month horizon yet. |
| The bank's reference (7.6) | Read with each deposit and shown under its description as `ref …`. Search covers it too. | `MOBILE DEPOSIT CHECK 1042`, ref `MD1042` |
| "Not found" instead of a quiet success | Bank confirm, bank ignore and template delete now answer 404 for an ID that isn't the agency's. | All three answer 404 |

Not built, and needs your decision: **Team › Producer payouts** (AG-1.7, `/app/producer-payouts`) is a second
producer-payout system beside the payout runs on Producer splits (LA-7.5).

## Not done

- **Vendor returns (LA-2.19).** The Returns tab's own views and its three review dialogs are untouched:
  - the component is shared with Lead sources;
  - its dialogs review claims, which goes beyond "confirm or upload".
  
  It needs its own pass with the Lead sources owner.
- **Commission entry link.** A producer entry cannot open its commission entry, because no page shows one
  commission entry.
- **W-9 upload.** There is no upload API for a W-9 file.
- **Bank queue rows.** Match by hand and Not carrier money stay inline under the row: decide in place, the
  Book of business pattern.
- **My balance, not seen live.** It is a producer's page, and the walk ran as the owner. It is covered by
  the typecheck and the source tests only.
- **Buckets is not paged.** About 26 rows scroll inside the step column, so the tax notice in its foot sits
  below the fold there. It is fully visible on Contractors and By category.
- **Book of business still has its own More menu.** `components/app/book/files/more-menu.tsx` duplicates
  the new shared `components/ui/more-menu.tsx`. It was left alone because it belongs to another session's
  area.
- **Dev CSS gotcha.** On the shared dev server, some new bracketed classes (for example `max-w-[210px]`)
  were not generated until replaced with standard-scale ones (`max-w-52`, `w-26`). Check a new arbitrary
  class in the browser before trusting a width measurement.

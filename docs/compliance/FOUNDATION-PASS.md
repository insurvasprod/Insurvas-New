# Compliance: foundation pass (2026-11-03)

A /ui-taste pass (polish + distill) over every Compliance step, measured against
[UI-CONSISTENCY.md](../design/UI-CONSISTENCY.md) (§2, §3, §4, §6, §6b, §6c, §8a, §11, §16, §17),
the owner's rules for this round and the Notion spec (Module 6 · Compliance, LA-6.1 to 6.8). Book of business
and the Accounting pass ([../accounting/FOUNDATION-PASS.md](../accounting/FOUNDATION-PASS.md)) are the reference
for the look.

The owner's rules used here:

- Tabs and sub-pages sit on the title line.
- The pattern is list page → detail page → tabs.
- No side panels or sheets. Pop-ups only to confirm or to upload.
- No explainer or info cards. Notices go to the bell; a dialog keeps one line.
- A detail header is the title, a status chip and one muted line of facts. It has at most two buttons,
  plus a More menu.
- Figures are one StatStrip, and its tiles are the links.
- Tables come from `TableCard`. Text stays 12/14px. No eyebrows, glows or gradients.

Out of scope: Compliance settings (`/app/compliance/settings`) is a Settings page; it is listed only where a
Compliance page links to it (the rail's foot, a tile, a More item).

## Inventory

| Step | Address | Tabs / views | Opens from it (before this pass) |
|---|---|---|---|
| Overview | `/app/compliance` | none | 7 coverage tiles, each with a small text link inside it; Needs you rows with an icon in a tinted circle and an Open-the-fix button |
| TCPA / DNC | `/app/tcpa` | Suppression list · DNC exemptions · Screening audit · Feed health (`?tab=` read once, then local) | Check a number (corner field; **runs a billed DNC + litigator check**), Suppress a number (**form pop-up**); the answer drawn as a card holding a `Callout`; a "Next up" feed line with a Feed health button; Exemptions: Record an exemption (**form pop-up** with a certificate finder), Revoke (**pop-up** with reason), Exemptions/Uses toggle; Audit: outcome filter, Raw response under the row |
| Consent | `/app/consent` | Leads · Coverage by vendor (local state) | Export CSV (corner), evidence filter, source toggles, search; tiles with a "Show" button inside; a "Next up" gap line with a Show button; Open → **certificate pop-up** (8 facts, stored copy JSON, provider link, evidence link) |
| Complaints | `/app/complaints` | Not resolved · All (local state) | Record a complaint (**620px form pop-up**, 12 fields); a "Next up" line with Open it / Set them; Open → **DetailPanel overlay** (facts, no-deadline tinted box with a days field, files with inline upload, checklist, respondent, response textarea, status/outcome/owner/notes, Save in the panel header); `?open=` opened the panel |
| Deletions | `/app/deletion-requests` | Open · Ready to delete · Done · All (local state) | Log a request (**form pop-up**); a "Next up" line with Open it / Verify; Open → **Sheet** (preview sentence, Verify form inline, Reject form inline, Cancel / Delete now, a confirm pop-up for Delete, certificate download, audit trail as text lines) |
| Evidence | `/app/evidence-report` | none: the scan, or one report as four stacked cards | A toolbar alone in a card (number, From, To, Run report / Scan the book, Refresh); scan: a "Next up" line, findings table with Show numbers expanding up to 300 numbers inline; report: Whole book, Timeline CSV and Download PDF in the corner (three buttons), Gaps / Consent / Where it came from / Timeline (collapsed, Expand) cards |
| Licences & appointments | `/app/appointments` | Carrier appointments · State licences · Carrier trainings (`?tab=licences` read once) | Connect a carrier (owner), read-only `<p>` banner and a View-only tinted card, a tinted list of every readiness item, Edit appointments (grid with Discard / Save / Done), a cell pop-up per carrier × state, Add a licence (**pop-up**), Trainings (**pop-up**); the trainings tab was one "N outstanding" line in a half-width card |

The frame: `ComplianceFlowPage` had **its own copy of the rail** (`compliance-rail.tsx`), kept in step with the
shared `StepRail` by hand, and took no title, chip or facts, so no step could have a record page.

## Critique and fixes, page by page

### The frame (`compliance-flow.tsx`, `steps.ts`, the shared rail)
- **Duplicate component.** The Compliance rail was a fork of the shared `StepRail` (same markup, its own
  counts, its own settings link). **Fix:** the frame is the shared `StepFrame`; `compliance-rail.tsx` is
  deleted. `StepRail` gained one optional `foot` link (Compliance settings for the owner), the only thing it
  lacked, and the Compliance icons. The badges use `COMPLIANCE_WAITING` words ("2 complaints due or overdue").
- **No record pages possible.** **Fix:** `ComplianceFlowPage` takes `title`, `info` (the (i)), `chip`, `facts`,
  `lead` and `actions`, as `AccountingPage` does; client screens keep the `ComplianceSlot` portals.
- **Sub-paths lost the step.** **Fix:** `complianceStepOf` matches a step's sub-paths (`/app/complaints/[id]`,
  `/app/tcpa/exemptions/new`…); `/app/compliance/settings` is still not a step. The trail adds "› record".

### Overview
- **A link inside each tile.** Every tile carried its own small text link ("Open the 59", "Details"). **Fix:**
  the tile is the link (`href`), as §4 / the owner's rule says.
- **Hand-made severity marks.** Needs you drew a tinted circle with an icon per row. **Fix:** a `StatusChip`
  (Incident / Fix today / Soon) in a fixed-width column, so the sentences line up.
- Kept: seven tiles, one more than §4's six, because LA-6.7 names seven standing figures (spec wins).

### TCPA / DNC
- **The answer went missing.** The check's Yes/No was a `Callout`, which since 2026-11-02 draws nothing on the
  page, so the card showed only the per-list table and a close button (also found by the test session, which
  had patched it in place). **Fix:** the answer is the result asked for, not a notice: a card titled with the
  number, a "Do not call" / "Can call" chip, one sentence why, and the lists that decided it.
- **"Next up" line.** The feed state was a tinted line with a stray Feed health button (since the strip was
  retired, only the button drew). **Fix:** a failing feed, refused dialing, no vendor or demo screening go to the
  bell; the Feed health tab carries the failing count.
- **Tabs were local state.** **Fix:** each tab is its address (`?tab=`), so the three figures link to Suppression
  list, Screening audit and Feed health.
- **Suppress a number was a form pop-up.** It cannot be undone, so it stays a pop-up as a **confirm with its
  fields** (number, list, how you learned, reason, the "I have checked" tick), labelled "Suppress permanently" /
  "Keep calling it".
- **Columns.** The list had seven columns at `min-w-[1040px]`; Added by is now the line under Source.
- **Hand FILL heights.** `min-h-[420px] flex-1 …` on every card fought the table foundation. **Fix:** removed;
  `TableCard` fills to the rail's foot itself.
- **DNC exemptions.**
  - Record an exemption was a form pop-up with a certificate finder. **Fix:** a page,
    `/app/tcpa/exemptions/new` (owner only, the API's write role), with Discard, Record and a leave guard; the
    expiry sentence is the date field's hint, an already-expired date its error.
  - Revoke is a confirm with its reason ("Revoke exemption" / "Keep it").
  - The table was 11 columns at `min-w-[1280px]`, wider than the card at 1440. **Fix:** seven columns: the
    evidence and the note are the line under Basis, the revoke reason the line under State, the last use under
    the count, who recorded it under the date.
  - "Needs a database update" was a warning-coloured sentence; now an `EmptyState`.
- **Screening audit.** Nine columns at `min-w-[1180px]`. **Fix:** seven: the vendor under "Answered by", the
  origin under "Who". The raw response still opens under its row (read in place).

### Consent
- **"Next up" line with a Show button.** **Fix:** the biggest gap (no consent text, else no IP) goes to the bell.
- **"Show" buttons inside tiles.** **Fix:** the tiles are links to `?evidence=full|no_text|no_ip`; the evidence
  filter and the tab (`?view=coverage`) are the address.
- **Certificate pop-up.** **Fix:** a page, `/app/consent/[id]`.
  - Title: the lead; chip: Copy stored / Link only / Link expired / Capture failed.
  - Facts: provider · vendor · captured · consent given.
  - Buttons: Provider's certificate (primary, when there is a link), More: Open the lead, Evidence report for
    this number (only for roles that may generate one).
  - Tabs: Details (every fact, "Not recorded" where the locker holds nothing) · Our stored copy.
- **The card scrolled inside itself** (50 rows a page under sticky headers). **Fix:** a page is the rows that fit
  above the rail's foot; the API takes `pageSize` (5 to 50).

### Complaints
- **"Next up" line.** **Fix:** the most urgent open complaint, else a regulator with no deadline, else licensed
  states with no days, goes to the bell. (The overdue DOI complaint is still the top bar's pinned alert.)
- **Overdue rows tinted red.** **Fix:** removed; the countdown chip already says it (§12).
- **Tabs.** **Fix:** Not resolved · Due soon (new: amber, red, overdue, no deadline) · All, at `?view=`; the
  four figures link to them, No deadline set to Compliance settings › Deadlines for the owner.
- **Record a complaint was a 620px pop-up.** **Fix:** a page, `/app/complaints/new`, with Discard, Record and a
  leave guard. "A complaint about unwanted calls puts the number on your do-not-call list" is the field's hint.
- **The record was a DetailPanel overlay.** **Fix:** a page, `/app/complaints/[id]`; `?open=` on the list
  redirects there, so Overview, the top bar's urgent alert and the daily email still land on it.
  - Title: what it is about ("Unwanted calls complaint"); chip: the countdown.
  - Facts: made to · received · complainant · number · policy · about · via partner · owner · respond by · on
    do-not-call since.
  - Buttons: Save (only while something changed) and More: Evidence report for this number, Set the response
    days (owner, no deadline), Deadlines in Compliance settings.
  - Tabs: Complaint (what it says, the response checklist) · Response (responding as, the agent's own text,
    status, outcome, owner, notes) · Files (what arrived, the attached evidence report, what we sent; Attach a file
    is an upload button on each card).
  - The no-deadline tinted box with its days field is a bell notice plus More › Set the response days, a confirm
    with the one field.

### Deletions
- **"Next up" line.** **Fix:** a hold that is over, else requests to verify, go to the bell (and the rail badge).
- **Tabs.** **Fix:** Open · Ready to delete · Done · All at `?queue=`; the figures link to them.
- **Log a request was a pop-up.** **Fix:** a page, `/app/deletion-requests/new`, with a leave guard.
- **The request was a Sheet with two inline forms.** **Fix:** a page, `/app/deletion-requests/[id]`.
  - Title: who (name · number · email); chip: the state.
  - Facts: received · from · verified (how) · the hold · deleted · rejected because.
  - Buttons by state, each a confirm with its fields: Verify who it is (method, where it came from, note), More ›
    Reject the request (reason); once on hold, Delete now when the hold is over (the destructive confirm) and More
    › Cancel the request; once deleted, Download the certificate.
  - Tabs: What we hold (before: what a deletion would reach, for the agency's performers; after: "What was
    deleted", per table: deleted, anonymised, kept and why — LA-6.5's certificate content, now on screen) · Audit
    trail (a table, was text lines).
  - Who may move a request follows Compliance settings' performer roles, as the API does (it was `isOwner`).

### Evidence
- **A card holding only a toolbar.** **Fix:** the scope picker (number, From, To, Run report / Scan the book,
  Refresh) is the gap table's toolbar.
- **"Next up" line.** **Fix:** the worst finding goes to the bell.
- **Show numbers expanded up to 300 numbers inside the table.** **Fix:** each finding opens its own page,
  `?focus=<finding>`: the finding as the title, its severity chip, one facts line, and the numbers paged, each
  opening its report. The tiles link there too (Overview's links already used `?focus=`).
- **A report was four stacked cards and three corner buttons.** **Fix:** a record page:
  - Title: the number(s); chip: "N gaps" / "No gaps".
  - Facts: names on file · the range · generated when, by whom.
  - Buttons: Download PDF (primary) and More: Timeline CSV, Scan the whole book.
  - Tabs: Gaps (first, as LA-6.3 orders it) · Consent · Where it came from · Timeline (`?view=`), with the
    timeline paged. A consent row opens its certificate page.

### Licences & appointments
- **Three notices on the page.** The read-only `<p>`, the View-only tinted card and the tinted list of every
  readiness item. **Fix:** each is a bell notice (one per readiness item, so none is dropped).
- **Tabs were local state.** **Fix:** `?tab=`; the figures link to them (Readiness to the tab that needs it).
- **Carrier trainings was one line in a half-width card.** **Fix:** a table of every training (carrier, training,
  due, Done / Overdue / Outstanding), with Trainings in its toolbar.
- **A page loader inside the frame** drew a second title skeleton. **Fix:** rows only.

## Spec check (Notion LA-6)

| Spec item | State |
|---|---|
| Gaps section first, plain counts (6.3) | Present; now the report's first tab and its title chip |
| Undetermined, never a pass (6.3) | Present, kept ("Undetermined" chip) |
| Timeline collapsed by default, record detail per event (6.3) | Present: its own tab, paged; module, table and id per row |
| PDF for counsel, timeline CSV (6.3) | Present: Download PDF and More › Timeline CSV |
| Book-wide scan; every figure clicks through and adds up (6.3, 6.7) | Present; **added** a finding page with every number, paged (was 300 inline) |
| Days remaining is the default order; amber 10, red 5 (6.4) | Present, kept |
| No deadline = empty date and a prompt, never a default (6.4) | Present: bell notice and More › Set the response days |
| Overdue DOI complaint persistent and loud (6.4) | The top bar's pinned alert (owner rule 2026-11-02 placed it there; not changed here) |
| Unwanted-calls complaint writes DNC at once (6.4) | Present; the new-complaint page says so in the field's hint |
| Response checklist, response text and files, no AI draft (6.4) | Present, now the Complaint, Response and Files tabs |
| Verify before purge, reject with reason, cancellable hold (6.5) | Present, now confirms with their fields |
| Per-table counts after the purge, retained categories stated (6.5) | **Added on screen:** "What was deleted" lists deleted / anonymised / kept and why; the certificate PDF was already there |
| Dashboard: problems above, standing figures below, figure = link (6.7) | Present; tiles are now the links |
| "Not configured" with a fix link, never 0 (6.7) | Present, kept |
| Retention rules, holds, dry runs (6.6) | In Compliance settings, out of this pass |

Added outside the spec (labelled):

- The Due soon tab on Complaints.
- Strip tiles as links everywhere (the owner's foundation rule, not LA-6).
- `pageSize` on the consent API (fitted paging).

## Checks (2026-11-03)

- **Typecheck:** `npx tsc --noEmit -p .` exits 0.
- **Lint:** eslint on every changed file exits 0.
- **Tests:** `npm test` passes 3,780 of 3,780. This includes the new `lib/compliance/foundationPass.test.mjs`
  (9 rules) and the updated `complianceFlow`, `dashboard`, `evidenceReport` and `persistency/insight` tests.
- **Browser walk** on :3000 as the demo agent (LA-1.25 Alert Demo, owner), at 1440×900 and then 1280×800,
  measuring each table against its card and each card against the rail's foot:
  - Overview; TCPA / DNC: Suppression list, DNC exemptions (empty on demo), Screening audit, Feed health, and
    the Suppress a number confirm (opened, Keep calling it). **Check a number was not pressed**: it bills a meter.
  - Consent: Leads, and a certificate's Details, Our stored copy and More.
  - Complaints: the list, an overdue DOI complaint's Complaint, Response and Files tabs, and Record a complaint.
  - Deletions: the list, a request on hold (the Delete now confirm opened, then Keep it), a rejected request.
  - Evidence: the scan, a finding's numbers, one number's Gaps and Timeline.
  - Licences & appointments: all three tabs.
- **Saving.** Nothing was saved, recorded, verified or deleted on the demo data.
- **Fixed during the walk:**
  - Consent, the screening audit, Complaints, Deletions and the suppression list were 5–70px wider than the
    card at 1280 (Consent at 1440 too). Second lines and tighter truncation fixed it; no column was hidden.
  - The evidence timeline's rows are of mixed height, so a fixed page size ran past the foot. It is now a
    `PagedTableCard`, which measures them.
  - Overview's Needs you ran past the foot on a busy day, so it is paged now. That found two faults in the
    shared `components/ui/paged.tsx`, both fixed once for every list:
    - a `PagedBody` list (`as="ul"`) was never measured, because nothing set the `data-paged-body` the measurer
      looks for;
    - the first measure left no room for the pager it was about to bring in.
  - A finding's page showed 300 of 2,384 numbers. It now reads up to the API's 1,000-row cap for that one line.
  - The trail missed a record that sits at its step's own address (a report, a finding). It names it now.
  - A deletion request's facts line showed raw digits and repeated the rejection reason.

## Not done

- **Licences & appointments' pop-ups.** Add a licence, the carrier × state cell editor and Trainings are still
  form pop-ups (`components/app/appointment-vault-parts.tsx`, shared with Settings' States & licences). Making
  them pages is its own piece of work with that owner.
- **The appointments grid scrolls sideways.** 33 states × 120px is wider than any screen; the region filter
  narrows it. Kept on purpose.
- **A finding past 1,000 numbers.** The page says "of N found". No export lists every number of a finding.
- **The overdue DOI complaint.** LA-6.4 wants "a persistent banner that cannot be dismissed". It is the top
  bar's pinned urgent alert (owner rule 2026-11-02) and was not changed here.
- **Dashboard tiles.** There are seven, one past §4's six, because LA-6.7 names seven figures.
- **DNC exemptions with rows** were not seen live (the demo holds none). The seven-column table is covered by
  the source test only.
- **Not walked as a producer, setter or assistant.** The role gates are unchanged and covered by the existing
  tests. The deletion page's buttons now follow Compliance settings' performer roles, as the API does.
- **Browser pane.** It was hidden for the whole walk, so the pages were read by measurement, not screenshots.
  React's streamed sections needed the documented requestAnimationFrame workaround.

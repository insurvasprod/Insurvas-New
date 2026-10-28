# 02 · Agent app (`/app/*`)

32 pages inside `app/app/(shell)/`. The licensed-agent workspace — the product customers live in.

Read [`00-FOUNDATION.md`](00-FOUNDATION.md) first.

## The gate model — copy it exactly

Every gated page opens with the same preamble. Three independent enforcement points must agree:
the **menu** (`lib/menu/definition.ts`), the **page** (`guardPage`), and the **API**
(`requireFeature` / `requireFeatureRole`).

```tsx
const guard = await guardPage("<feature_key>");
if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="…" description="…" />;
if (!["owner", "producer"].includes(guard.role))
  return <RoleGateNotice featureLabel="…" detail="Only owners and producers can …" />;
return <Workspace readOnly={guard.entitlement.access === "read_only"} />;
```

**Where a role list differs between two similar pages, the difference is deliberate.** The clearest
case: `/app/import` includes `assistant`, `/app/campaigns` does not — because campaigns shows spend
and cost per lead, and the API enforces the same boundary. A screen that renders for a role the API
refuses is a page of error toasts.

Read-only is not the same as ungated: a suspended account keeps read access to its book of business
and loses writes.

## Money boundary

`bookkeeper` sees money and not call operations. `setter` sees their own queue and scorecard, not
vendor cost. `assistant` (buffer) verifies but does not dispose. `producer` does everything
operational. `owner` adds settings, team and spend. `/app/partner-quality` exists specifically as
the cost-free sibling of `/app/true-cpa`, so quality can be reviewed by roles that must not see
spend — **do not merge those two pages.**

---

## 1. Dashboard — `/app/dashboard`

> **Superseded in layout (2026-10-28).** The Home dashboard is now the v3 layout in
> [UI-CONSISTENCY.md §4b](UI-CONSISTENCY.md#4b-home-dashboard-v3): needs-you row, four stat cards,
> the calls chart beside today's schedule, money beside the team, then every module as a link. The
> calls chart draws `getDashboardToday`'s fourteen days of dials, so "Add a chart" below no longer
> applies; the schedule shows up to six appointments and callbacks together. The gates, data and
> empty-state rules below still hold.

**File:** `app/app/(shell)/dashboard/page.tsx` (66)
**Components:** `SetupChecklist`, `DashboardTile`, inline callbacks card
**Mockup:** `01-agent-dashboard.png` — authoritative
**Gate:** none — always entitled, which is why `/app` lands here
**Data:** `getEntitlement`, `getDashboardOnboardingState`, `effectiveFeatures`, `visibleDashboardTiles`, `setupChecklistForState`, `listDueCallbacks`

**Purpose:** the next thing this person should do, in one place.

### Must do
- Setup checklist for **owners only**.
- Callbacks-due-today card when `callback_calendar` is granted, showing at most 4, each with
  initials avatar, customer-local time and timezone, and an overdue flag. Empty → "No callbacks are
  due today" (a real, correct empty state).
- Tile grid from `visibleDashboardTiles(availableFeatures, role)`, filtered by feature **and** role.
- Tiles come from the registry. **Do not hard-code a tile in the page.** The registry is the
  documented extension point — "modules register data here; the dashboard renderer does not change".
- **"Owed to you" (`book.owed`, LA-4.6; owner and bookkeeper, `discrepancy_report`).** It is the
  activation figure and opens `/app/discrepancies`. Its value is the page's total to the cent
  (`statementMoney` over the open and disputed findings: one read, no recompute). Its caption is the
  number of items, and its detail is the split ("4 never paid, 14 paid short, …"). It never shows a
  $0 that nothing checked:
  - "—" with "import a statement" before any statement stands;
  - "—" with "review your statement" while statements stand but none is reviewed and nothing was
    found;
  - "$0.00" only when reviewed statements agree with the contract.
- **Setup checklist, statement step:** "Upload a carrier statement" opens `/app/statements?import=1`
  (the import dialog) and is done once any non-voided statement stands, whatever the onboarding
  state.

### Fix while you are here — D-10 and D-11, both Sev A/B
The registry has **two** tiles and both are owner-only. Every non-owner gets an empty grid and this:

> Your workspace is waiting for its first feature — Ask your account owner to activate a workspace
> feature.

which is false for a producer on a 20-feature plan, and sends them to their owner for a problem the
owner cannot fix. Correct the empty state, and register tiles for the roles that have work (inbound
depth for producers/assistants, dialer queue and scorecard for setters, commissions for
bookkeepers). See **D-10**.

Separately, all five checklist steps point at `/app/settings` — a ten-tab page. Add `?tab=` support
and deep-link each step. See **D-11**.

### Controls
| Control | Destination |
|---|---|
| Checklist step ×5 | `/app/settings` — **should be `?tab=…`** (D-11) |
| "Open calendar →" | `/app/callbacks` |
| Callback row "Open" | `/app/callbacks` |
| Tile action | `tile.path` |

### Layout
`max-w-6xl`, `space-y-6`. `h1` "Dashboard" + "Your next steps, in one place." Then checklist
(owner), then callbacks card, then "Your workspace" tile grid at `lg:grid-cols-2`.

Checklist: horizontal progress with `n/5`, steps as rows with a state glyph. Tiles are feature
cards — 12px radius, 24–32px padding, icon in a tinted square, title, one line, one action.
Hover raises the sanctioned shadow only. **No tile gets an orange fill**; the accent is the icon
and the action link.

### Must not
- Show a metric the page did not load. `—`, never `0`.
- Render the "ask your owner" copy when the entitlement grants features.
- Put more than four callbacks in the card — it is a prompt, not the calendar.
- Add a chart. There is no dashboard analytics endpoint; a chart here would be invented.

---

## 2. Agent Floor — `/app/floor`  · LA-1

**Files:** `app/app/(shell)/floor/page.tsx` (11), `components/app/agent-floor.tsx` (338)
**Mockup:** `10-agent-floor.png` — authoritative. The generated set also has a dark variant that matches the real sidebar IA.
**Gate:** `inbound_transfers` · `owner`, `producer`, `assistant` · read-only when suspended/paused
**Data:** `GET/POST /api/app/agent-floor`, `POST /api/app/inbound/claim`, `POST /api/app/inbound/handoff`

**Purpose:** run the inbound day from one live view — who is waiting, who is on a call, who is free.

### Must do
- Four live counters: agents available (of on-shift), in queue (with average wait), transfers
  pending, calls handled this hour.
- Agent roster with status, current activity, call time, and a per-row action (Monitor when on a
  call, Assign when available).
- Transfer queue with position, product/intent, wait time, source, and Pick up / Details.
- Own availability control: Available / Wrap-up / Offline. `POST /api/app/agent-floor`.
- Claim → `router.push("/app/inbound/<workItemId>/verification")`. Claiming is race-safe
  server-side; the UI must not pretend to win optimistically.
- Handoffs waiting for me, with Accept → same verification route.
- Nudge team, idempotency-keyed.
- Callbacks due, each linking to `/app/leads/<leadId>`.
- **Its own loading and error screens**, both already built: "Opening your workspace" progress card
  and "We couldn't open your Agent Floor" with Try again. Keep both — this page is opened at the
  start of a shift and a blank screen reads as an outage.

### Fix while you are here
- **D-03, Sev A:** "View all" beside Available team → `/app/team`, which **404s**. Point at the team
  tab in settings, or remove it. Note it renders for producers and assistants who cannot open
  `/app/settings` at all, so removal may be the honest fix.
- **D-12:** "Listen in" is `toast.info("Listen-in is available when a supervisor joins the live
  call.")` and nothing else. Either implement, or make it a disabled control that states the
  condition — the `void-invoice-dialog` pattern.

### Controls
| Control | Destination / effect |
|---|---|
| Available / Wrap-up / Offline | `POST /api/app/agent-floor` |
| Pick up / Claim | `POST /api/app/inbound/claim` → `/app/inbound/:id/verification` |
| Accept handoff | `POST /api/app/inbound/handoff` → same |
| Nudge | `POST /api/app/agent-floor` (action `nudge`) |
| Monitor / Listen in | **toast only** — D-12 |
| View all (team) | `/app/team` — **404, D-03** |
| Callback row | `/app/leads/:leadId` |
| Open dialer | `/app/dialer` |
| View all callbacks | `/app/callbacks` |

### Layout
Full-bleed operations view, wider than the standard page — this is a wall display as much as a
page. Header: `h1` "Agent Floor" + a live pulse chip + the date/time. Four metric cards, each with
a tinted icon tile and a chevron into its detail. Then a two-column split: left = tabbed table
(Agents / Transfer queue / Live calls / Recent activity); right = the transfer queue rail with
numbered position chips, wait timers and per-item Pick up.

Wait time is the one number that should draw the eye: `tabular-nums`, and the only place a warning
colour is earned when it crosses the SLA. Status dots pair colour with a word, always.

### Must not
- Poll so aggressively it becomes the latency problem. This shell already carries ~530 ms of
  preamble; see `docs/qa/LA-2-RELEASE-GATES.md`.
- Let a claim appear to succeed before the server confirms. Two agents will click the same row.
- Hide the queue behind a tab. It is the reason the page exists.
- Use red for "Offline". Offline is a choice, not an error.

---

## 3. Inbound transfers — `/app/inbound`  · LA-1

**Files:** `app/app/(shell)/inbound/page.tsx` (11), `components/app/transfer-inbox.tsx` (162)
**Mockup:** `12-agent-inbound-transfers.png` — authoritative
**Gate:** `inbound_transfers` · `owner`, `producer`, `assistant` · read-only when suspended/paused
**Data:** `GET /api/app/inbound?<filters>`, `POST /api/app/inbound/claim`, `POST /api/app/inbound/handoff`. Realtime channel via `realtimeTopic`.

**Purpose:** see incoming transfers with their screening signals and claim one without a race.

**Performance note:** this page is the product's latency canary. It was 903 ms against a 1,000 ms
budget until `requireFeature` was parallelised; it now runs ~530–610 ms at a measured 131 ms
database round trip. **Do not add a sequential server read to this route.** Any new data joins the
existing `Promise.all`.

### Must do
- Table of waiting transfers: customer, age, state, product line, partner, status, owner, wait time.
- Screening state per row — `DNC clear` / `Warning` / `Needs review` / `Pending` — plus a duplicate
  flag and preflight status with match details when present.
- Filters: partner, product, state, claimed user. Reset filters clears all.
- Claim, race-safe. On success → `/app/inbound/<id>/verification`.
- "Handoffs waiting for you" section with Accept.
- Realtime claim broadcast so a row claimed elsewhere updates without a refresh.
- Row → detail side panel with customer facts, screening, preflight, and a link to
  `/app/leads/<leadId>`.
- Error state with Try again (exists — keep it).

### Controls
| Control | Destination / effect |
|---|---|
| Row | opens detail panel |
| Claim (row or panel) | `POST /api/app/inbound/claim` → `/app/inbound/:id/verification` |
| Accept handoff | `POST /api/app/inbound/handoff` |
| Reset filters | clears filter state |
| Clear selected transfer (×) | closes panel |
| Customer name in panel | `/app/leads/:leadId` |
| Try again | re-fetch |

### Layout
`max-w-7xl`. Header + a summary strip (waiting, claimed, needs review, average wait). Filter bar on
`--portal-group`. Dense table; screening is a chip, not a word in a cell. Detail panel is a right
rail ≥ 1280px, a sheet below.

**The Age column is a person's age in years, not a duration.** Three of the generated mockups
iterate on exactly this confusion (`68m` vs `68`). Age renders as a bare number or `68 yrs`; wait
time is the one that carries `m`/`s`. Never let them look alike — they sit two columns apart.

### Must not
- Render "No transfers waiting" when the fetch failed.
- Let claim be double-clickable.
- Sort by anything but wait time by default. Longest-waiting first is the operational contract.
- Show a screening chip as colour alone.

---

## 4. Verification — `/app/inbound/[workItemId]/verification`  · LA-1

**Files:** `app/app/(shell)/inbound/[workItemId]/verification/page.tsx` (12), `components/app/verification-panel.tsx` (137)
**Mockup:** `14-agent-inbound-verification.png` — authoritative
**Gate:** `inbound_transfers` · `owner`, `producer`, `assistant` · `canHandoff` only when role is `assistant`
**Data:** `GET /api/app/inbound/verification?work_item_id=…`, `POST` same; `GET/POST /api/app/inbound/handoff`, `POST /api/app/agent-floor`

**Purpose:** confirm every required application field on the live call, field by field.

### Must do
- Render the field list from the template. Each field: value, editor, and a state of
  confirmed / corrected / outstanding.
- Save correction and Mark outstanding, per field, persisted immediately. A dropped call must not
  lose the work.
- Live progress ("Verification progress") — the assistant hands off mid-form and the licensed agent
  needs to see how far it got before accepting.
- Call context panel.
- Change history.
- **Handoff offer only for assistants** (`canHandoff`). The toast says it plainly: "Handoff offered;
  the licensed agent can see verification progress before accepting."
- Nudge team.
- "Record call outcome" → `/app/inbound/<id>/disposition`.
- Back to `/app/inbound`.
- Read-only disables every editor but keeps the values visible.

### Controls
| Control | Destination / effect |
|---|---|
| Save correction | `POST …/verification` (`corrected`) |
| Mark outstanding | `POST …/verification` (`outstanding`) |
| Offer handoff | `POST …/handoff` (assistant only) |
| Nudge team | `POST /api/app/agent-floor` |
| Record call outcome | `/app/inbound/:id/disposition` |
| Back to inbound | `/app/inbound` |
| Try again | re-fetch |

### Layout
Two columns ≥ 1280px: field list left (the work), context + progress + history right. The field
list is a vertical stack of rows, each with label, editor, state chip and its two actions — not a
table; the editors vary by field type.

This screen is used **while talking to a customer**. Optimise for glanceability over density: 16px
body minimum, generous row height, the next outstanding field visually obvious. Progress is a
count and a bar ("7 of 8 checks passed"), always both.

### Must not
- Batch saves behind one Save button. The call can drop at any moment.
- Let a corrected field look identical to a confirmed one.
- Show the handoff control to a producer or owner — `canHandoff` is assistant-only by design.
- Block on a field the template marks optional.

---

## 5. Disposition — `/app/inbound/[workItemId]/disposition`  · LA-1

**Files:** `app/app/(shell)/inbound/[workItemId]/disposition/page.tsx` (12), `components/app/disposition-wizard.tsx` (125)
**Mockup:** `13-agent-inbound-disposition.png` — authoritative
**Gate:** `inbound_transfers` · **`owner`, `producer` only** — an assistant verifies but does not dispose
**Data:** `GET /api/app/inbound/disposition?work_item_id=…`, `POST` same

**Purpose:** record exactly one structured outcome per call, by walking a decision tree.

### Must do
- Step through the configured tree. Each answer determines the next question — never show them all
  at once.
- "Walked path" summary of answers so far, each editable. `beginEdit(sequence)` re-enters at that
  step; later answers that no longer apply must be discarded, not silently kept.
- "Next action preview" — what recording this will cause (callback scheduled, lead recycled, deal
  created). This is the screen's most valuable element: it makes an irreversible classification
  legible before it is committed.
- Callback details sub-form when the outcome needs a time, in the **customer's** timezone.
- Call summary.
- On save → `router.push("/app/deal-flow?focus_lead_id=<id>")` with the toast "Call outcome
  recorded — opening Daily deal flow". The hand-off is part of the flow; keep it.
- Back to verification.

### Controls
| Control | Destination / effect |
|---|---|
| Answer option | advances the tree |
| Edit / Edit an earlier answer | `beginEdit(n)` |
| Save (final) | `POST …/disposition` → `/app/deal-flow?focus_lead_id=:id` |
| Back to verification | `/app/inbound/:id/verification` |

### Layout
Single column, `max-w-3xl` — a wizard, not a workspace. Stepper at the top with
`aria-label="Disposition progress"`. Current question large (24/600); options as full-width
selectable rows with generous hit areas, one visibly selected. Walked path is a compact numbered
list in a `--portal-group` panel. Next-action preview sits directly above the final action so the
consequence and the commit are in the same glance.

**Note for the visual pass:** two of the generated mockups for this screen drifted to **blue**
steppers and blue radios. That is wrong. The accent is `#ff5900`.

### Must not
- Allow two dispositions for one work item.
- Keep answers below an edited step without re-asking.
- Hide the next-action preview behind a disclosure.
- Let the wizard be abandoned silently — either persist a draft or warn on navigate-away.

---

## 6. Partner chat (agent side) — `/app/partner-chat`  · LA-1

**Files:** `app/app/(shell)/partner-chat/page.tsx` (11), `components/app/partner-chat-workspace.tsx` (89)
**Mockup:** `20-agent-partner-chat.png` — authoritative
**Gate:** `inbound_transfers` · `owner`, `producer`
**Data:** `GET/POST/PATCH /api/app/partner-chat`

**Purpose:** one partner-only channel carrying both human conversation and automatic lead updates.

### Must do
- Three panes: conversation list, thread, details.
- **Automatic updates are visually distinct and marked "cannot be edited."** They are a record of
  fact (lead received, transfer claimed, stage changed); a system event that looks like a typed
  message destroys the audit value. The mockups tint them and label them — keep both.
- Send message; attachments with name and size.
- Start a new conversation.
- Archive / status via `PATCH`.
- Details pane: partner, channel type, linked lead count, message count, members, shared files.
- Empty states for no conversation selected and no messages yet.

### Fix while you are here — D-12, Sev B
**Five controls on this page do nothing at all:** `Details`, `⋯ More conversation actions`,
`⌄ Details panel`, and both `View all` buttons (Members, Shared files). The conversation
notification block is also inert — a `defaultChecked` checkbox with no state and a frequency
`<select>` with no `onChange`, so choosing "Mute conversation" stores nothing. Real notification
preferences are in `AgentAlertCenter` (`/api/app/notifications`) and they work.

Wire or delete, each one. Then delete the inert notification block and link to the alert centre.

### Controls
| Control | Destination / effect |
|---|---|
| Conversation row | selects thread |
| Send message | `POST /api/app/partner-chat` |
| New conversation | opens composer |
| Create | `POST …` |
| Attach files | local until send |
| Details · ⋯ · ⌄ · View all ×2 | **nothing — D-12** |
| Notify checkbox / frequency | **nothing — D-12** |

### Layout
Three-column ≥ 1280px (list 280–320 · thread flexible · details 320–360). Below 1280 the details
pane collapses to a disclosure; below 768 the list becomes a horizontally scrolling strip above the
thread.

Automatic update: full-width tinted block, its own icon, a "cannot be edited" caption, and
structured key–value content. Human message: avatar, name, org, time, then a bubble on
`--portal-group`. Own messages are **not** orange — orange is the send button.

### Must not
- Let an automatic update be styled as, or mistaken for, a typed message.
- Allow editing a system event.
- Leave a `⋯` that opens nothing.
- Ship an inert notification control beside a working one.

---

## 7. Dialer — `/app/dialer`  · LA-2

**Files:** `app/app/(shell)/dialer/page.tsx` (13), `components/app/dialer-workspace.tsx` (475)
**Mockup:** `08-agent-dialer-workspace.png` — authoritative; the generated set adds a two-screen queue → active-call composite
**Gate:** `outbound_dialing` · **`owner`, `producer` only** · read-only respected
**Data:** `POST /api/app/dialer/next`, `GET /api/app/dialer/panel?lead_id=…`, `GET /api/app/dialer/search?q=…&limit=40`, `POST /api/app/dialer/attempt/:id/click`, `…/disclosure`, `…/disposition`, `GET /api/app/leads?limit=100`, `GET /api/app/appointments`

**Purpose:** serve the next lead, place a compliant call, record what happened.

### Compliance — do not touch this
Screening is enforced **server-side** inside `POST /api/app/dialer/attempt/:id/click`. The client
shows the state and then asks the server, which re-checks immediately before dialing. The
"Eligibility & compliance" card's own caption says so: "Server checks repeat immediately before
dialing." When blocked, the error surfaces as "Dialing was blocked by the compliance checks".

**Never let the UI dial from client-side state.** `window.location.href = "tel:…"` happens only
after the server returns OK. The disclosure step is a separate recorded call
(`…/disclosure`) — it exists so a read disclosure is evidence, not a checkbox.

### Must do
- Serve next lead from the scored queue; also allow search (min 2 characters, with a clear error
  when shorter) and selection from the list.
- Lead panel: name, phone with copy, customer local time, calling-window state (open/closed with
  the window), lead id, attempt number, campaign, vendor, source.
- Eligibility card: overall allow/block with reason, consent on file, DNC status, tenant
  suppression, customer local time and timezone.
- Contact history: date, attempt number, result, notes, agent.
- Suggested script with rebuttals, editable, **versioned** — "New script version saved. It applies
  to the next lead." A live edit must not retroactively change what was said on past calls.
- Disposition set: Contacted / No answer / Callback / Not interested / Application.
- Callback scheduling in the customer's timezone.
- Book an appointment.
- Start application — "Everything collected so far is saved — a dropped call resumes here."
  Preserve that guarantee.
- Auto-advance toggle and a note for the next agent.
- Back to queue.

### Fix while you are here — D-14
`components/app/dialer-preflight.tsx` is a complete, tested ad-hoc number checker
(`POST /api/app/dial/preflight`, three verification suites) with **no route**. It is the natural
companion to this page — a panel above the queue for checking a number you were handed before a
lead exists. Give it a home here or delete it; do not leave it orphaned.

### Controls
| Control | Destination / effect |
|---|---|
| Serve next lead | `POST /api/app/dialer/next` |
| Search | `GET /api/app/dialer/search` |
| Click to call | `POST …/attempt/:id/click` → `tel:` **only on OK** |
| Read disclosure | `POST …/attempt/:id/disclosure` |
| Disposition option | `POST …/attempt/:id/disposition` |
| Book appointment | `GET /api/app/appointments` then book |
| Start application | opens application, saving progress |
| Save new version (script) | versioned save |
| Lead name | `/app/leads/:id` |
| Back to queue | clears the active lead |

### Layout
Three zones. **Left:** priority queue — count, priority filters (All/High/Med/Low), search,
campaign/vendor/lead-type/calling-window filters, "Show only callable now", then the list with
priority chip and in-window state. **Centre:** the lead — name, facts, the single orange
**Click to call**, then tabs (Contact history / Lead details / Notes / Compliance). **Right or
below:** eligibility, script, disposition, next-lead action.

On an active call the centre becomes the call panel: timer, Hold / Mute / Keypad / End call (End is
the only red control in the product's core flow), previous attempts, disposition, callback, notes,
then Save outcome + Next lead.

Calling-window state is the second most important signal after eligibility: a chip with a clock, the
window in the customer's local time, and unmistakable open/closed wording.

### Must not
- Dial without the server's OK.
- Let a script edit alter historical calls.
- Put more than one orange control in the call panel — End call is red, Next lead is orange, Click
  to call is gone while a call is live.
- Auto-advance without the user having enabled it.
- Show a disposition set that differs from the tenant's configured dispositions.

---

## 8. List import — `/app/import`  · LA-2

**Files:** `app/app/(shell)/import/page.tsx` (11), `components/app/lead-import-workspace.tsx` (323)
**Mockup:** `11-agent-import-leads.png` — authoritative; generated set adds a 5-step upload→commit composite
**Gate:** `lead_import` · `owner`, `producer`, **`assistant`** — no money on this screen
**Data:** `GET /api/app/leads/import`, `PUT /api/app/leads/import/mappings`, then `/app/import/review/<batchId>`

**Purpose:** get a vendor CSV into the pipeline, mapped, validated and attributed.

### Must do
- Vendor and campaign selection **before** upload. `campaign_id` travels with the lead forever;
  this is where it is decided. Offer "New campaign" inline so the flow is not broken by a detour.
- File picker + drag-and-drop, with the limit stated (100 MB).
- CSV preview.
- Column mapping with required fields flagged, sample values shown, and a saved-mapping memory per
  vendor ("Vendor mapping saved").
- Validation summary before commit.
- Import checklist alongside — the six preconditions.
- Plan usage, so the reader knows if this import will exceed a limit.
- Available stages and expected fields.
- Recent imports with date, file, vendor, campaign, totals, status.
- On staging → `router.push("/app/import/review/<batchId>")`.
- **The browser-storage error is real and must stay:** "This browser will not hold the file between
  pages. Check that site data is enabled." The review step is a separate route, so the file has to
  survive the navigation.

### Controls
| Control | Destination / effect |
|---|---|
| Choose file / drop | local, then parse |
| Replace | clears the chosen file |
| Vendor / Campaign select | sets attribution |
| New campaign | inline create |
| Save mapping | `PUT /api/app/leads/import/mappings` |
| Continue to review | `/app/import/review/:batchId` |
| View all imports | history |

### Layout
Numbered stepper across the top: Upload file → Map columns → Validate & scrub → Review → Commit.
The stepper is the page's spine; each step is a route or a state, and completed steps get a filled
check.

Upload step: dropzone left (dashed border, `--portal-group` fill, cloud glyph), checklist right.
Mapping step: a table of CSV column → mapped field → required → sample value. Recent imports
below, as a dense table.

### Must not
- Allow upload before vendor and campaign are chosen — attribution cannot be added later (see the
  open question in § 10).
- Commit from this screen. Review is a separate route on purpose: a file with 900 duplicates is not
  a decision made in one sitting.
- Say "temporarily unavailable" for a permanent fault. See `00-FOUNDATION.md` § 6.3.
- Silently drop rows that fail validation — they are counted and listed.

---

## 9. Import review — `/app/import/review/[batchId]`  · LA-2

**Files:** `app/app/(shell)/import/review/[batchId]/page.tsx` (81), `components/app/import-review-workspace.tsx` (188), `components/app/import-review-bridge.tsx` (65)
**Mockup:** the generated LA-2 composite (right panel) — no curated file
**Gate:** `lead_import` · `owner`, `producer`, `assistant`
**Data:** `loadPreflight(tenantId, batchId)`, `importBatchState(tenantId, batchId)` server-side

**Purpose:** the last moment anyone can check what is about to enter the pipeline.

A route, not a step, so it survives a refresh and can be linked to. **The batch id is not a
capability** — the plan is loaded tenant-scoped, so another tenant's id returns 404.

### Must do
- Four outcome counts with percentages: Accepted, Duplicates, Suppressed (DNC/TCPA), Invalid.
- Mapped columns recap with sample values.
- Validation and scrub results, each with a "View list" into the affected rows.
- Cost allocation: cost per accepted lead and estimated total.
- Accepted-rows preview (first 10) including the generated lead ids.
- **Campaign name, not a uuid.** The page loads it specifically so the reader can confirm
  attribution — `campaign_id` is permanent.
- Commit, once, idempotently. "The import could not be confirmed. You can retry safely." must stay
  true.
- On success → `/app/leads` with the imported count.
- Start over → `/app/import`.
- **Already-committed is its own state, not a 404.** The page distinguishes "never staged or not
  yours" (404) from "already imported" (a proper page saying the leads are in the pipeline and this
  step is finished). Keep that distinction — a 404 for a finished import reads as data loss.
- The bridge handles a lost in-browser file: "Upload the file again" → `/app/import`.

### Controls
| Control | Destination / effect |
|---|---|
| Commit import | commit → `/app/leads` |
| Start over | `/app/import` |
| View list (per issue) | filtered row list |
| Edit (cost / campaign) | back to the relevant step |
| Download preview | CSV of the preview |
| Upload the file again | `/app/import` |
| Import another list (committed state) | `/app/import` |

### Layout
Same stepper, step 4 active. File summary strip (filename, rows, size, vendor, campaign, cost per
lead) then the four count cards — Accepted green, Duplicates warning, Suppressed neutral-blue,
Invalid danger, each with its percentage. Two columns: mapped columns left, validation results
right. Preview table below. Commit is the single orange action, bottom-right, with Back beside it.

The four counts must **sum visibly** to the file's row count. An operator's first question is
"where did the other 1,489 go", and the layout should answer it without arithmetic.

### Must not
- Commit without the reader having seen the counts.
- Show a campaign uuid.
- Let a double-click double-import.
- 404 a committed batch.

---

## 10. Vendors & campaigns — `/app/campaigns`  · LA-2

**Files:** `app/app/(shell)/campaigns/page.tsx` (16), `components/app/campaign-workspace.tsx` (417)
**Mockup:** NONE curated. Generated set: the LA-2 vendor/campaign composite.
**Gate:** `outbound_dialing` · **`owner`, `producer` only — this screen shows money**
**Data:** `GET /api/app/vendors`, `POST /api/app/vendors`, `GET /api/app/campaigns`, `PATCH /api/app/campaigns/:id`
**Menu icon:** `store` — **missing from the ICONS map, renders a blank circle (D-05)**

**Purpose:** who you buy leads from, what each batch cost, and what a dialable lead really costs.

### Must do
- Vendor list and create (name, contact).
- Campaign list and create: name, vendor, spend, record count, mixing weight, status.
- Validation with specific messages, already correct: "Enter a valid spend", "Enter a whole number
  of records", "Mixing weight must be 1 or more".
- A new campaign is created as a **draft**: "created as a draft. Activate it when the list is
  scrubbed." Keep that — activation is a deliberate act.
- `PATCH` to activate/pause.
- Show `cost_per_record_cents` and `effective_cost_per_record_cents`. **These are generated columns
  on `tenant_campaigns`. Never re-derive money in the client or in a fallback path.**
- **The schema-gap fallback:** when the view is missing, both routes fall back to base tables and
  return `pending: SchemaGapNotice`, and the page renders `.portal-campaigns-pending`. The fallback
  deliberately re-derives **no money**. Keep both the fallback and the notice.
- `loadError` state: a failed load shows an error, **not** "No vendors yet". This page is the origin
  of that rule — it rendered the empty state for an HTTP 500 and the screenshot went to the product
  owner.
- `count()` renders `—` for an unmeasured value, never `0`.

### Fix while you are here
- **D-05:** add `Store` to the sidebar `ICONS` map.

### Open question — needs a product decision, blocks work
There is no way to attach a campaign to leads **after** import. Attribution is set at upload
(§ 8) and `campaign_id` is permanent. If post-import attachment is wanted, someone must decide
whether re-attaching **backdates cost** — if it does, every True CPA figure for the old campaign
changes retroactively. Do not build it until that is answered.

### Controls
| Control | Destination / effect |
|---|---|
| New vendor → Save | `POST /api/app/vendors` |
| New campaign → Save | campaign create |
| Cancel | closes the inline form |
| Activate / Pause | `PATCH /api/app/campaigns/:id` |

**Note what is absent:** no vendor edit, no vendor delete, no campaign delete. Records of spend are
not deletable by design. Do not add a delete button; add an archive if the owner asks.

### Layout
`max-w-7xl`. Summary strip: vendors, active campaigns, spend this period, effective cost per
dialable lead. Two panels: vendors (compact list, inline create) and campaigns (table — name,
vendor, status, records, spend, cost/record, effective cost/record, weight, actions).

Money columns right-aligned, `tabular-nums`, and `effective_cost_per_record_cents` gets a tooltip
explaining it is cost per *dialable* lead after suppression — the difference between the two
columns is the whole value of the screen. Draft campaigns are visibly draft (outline chip), and the
Activate action lives on the row.

### Must not
- Render an empty state for an error. Ever. Not on this page.
- Compute a cost in the client.
- Show money to an assistant, setter or bookkeeper.
- Offer a delete for a campaign with spend.

---

## 11. Lead recycling — `/app/nurture`  · LA-2

**Files:** `app/app/(shell)/nurture/page.tsx` (5), `components/app/nurture-workspace.tsx` (161)
**Mockup:** `19-agent-lead-recycling.png` — authoritative
**Gate:** `outbound_dialing` · `owner`, `producer`
**Data:** `GET /api/app/nurture`, `POST /api/app/nurture`

**Purpose:** put aged leads back into the queue, with caps and **fresh** suppression screening.

### Must do
- Nurture campaign list with rules: age threshold, cadence, cap, status.
- Save a recycle rule ("Recycle rule saved").
- **"What will happen" preview before committing.** Re-screening is the point: a lead clear six
  months ago may be on the DNC list today.
- Report the outcome honestly and in three parts: `"{cleared} cleared, {blocked} blocked, {failed}
  failed screening"`. Blocked and failed are different — blocked means suppressed, failed means the
  screening call did not complete. Do not collapse them.
- Nurture summary.

### Controls
| Control | Destination / effect |
|---|---|
| Save (per campaign) | `POST /api/app/nurture` |
| Run / Reactivate | `POST …` then the three-part result |

### Layout
`max-w-6xl`. Summary strip (in nurture, eligible today, recycled this month, blocked). Campaign
cards, each with its rule fields inline and its own Save. "What will happen" is a
`--portal-group` block inside the card, above that Save — consequence adjacent to commit, as on the
disposition wizard.

### Must not
- Recycle without re-screening.
- Report a single total that hides blocked and failed.
- Exceed a configured cap because the UI let someone type past it.

---

## 12. Lead assignment — `/app/assignments`  · LA-2

**Files:** `app/app/(shell)/assignments/page.tsx` (11), `components/app/assignment-workspace.tsx` (116)
**Mockup:** `05-agent-lead-assignment.png` — authoritative; generated set adds a rule-builder + routing-preview composite
**Gate:** `outbound_dialing` · `owner`, `producer`, `assistant`, **`setter`** — setters work the pool; `canManage` is owner/producer only
**Data:** `GET /api/app/assignments`, `POST`, `PUT`, `PATCH` on the same path

**Purpose:** route each lead to an agent who may legally and practically work it.

### Must do
- Rule builder: ordered conditions on campaign, state, language, product, licensing, agent capacity,
  priority, and a fallback. **Rules evaluate top to bottom** — the order is the logic, so it must be
  visible and reorderable.
- Routing preview against sample leads before publishing. This is the safety feature: a bad rule
  silently starves a queue.
- Agent capacity panel.
- Household owner rest days ("Rest-day rule updated") — the same household is not called by two
  agents in the same window.
- Reassignment target for inactive agents.
- "Assign next eligible lead" pool action.
- **`canManage` splits the page:** a setter sees the pool action and their own assignments; only
  owner/producer edits rules. Render the rules read-only for a setter rather than hiding them —
  knowing why you got a lead is useful.

### Controls
| Control | Destination / effect |
|---|---|
| Save (rule) | `POST` — "Rule saved. It applies to the next assignment." |
| Save rest days | rest-day rule update |
| Assign next eligible lead | `POST` pool action |
| Test with sample leads | routing preview |
| Reassignment target | sets the inactive-agent fallback |

### Layout
Two columns ≥ 1280px: rule builder left, routing preview right. Each rule row is
`[n] [field] [operator] [value(s)] [×]`, numbered, with a drag handle. Values are removable chips.
"Add condition" is a ghost row at the end. Preview is a table (lead, campaign, state, product,
assigned to, matched rule) with a success summary beneath ("5 of 5 leads routed successfully").

Publish is the single orange action and must state its scope — rules apply to the **next**
assignment, not retroactively.

### Must not
- Hide rule order.
- Publish without a preview having been available.
- Let a rule route a lead to an agent unlicensed for that state — licensing is a condition, not a
  preference.
- Show the same action label for "save this rule" and "publish all rules".

---

## 13. Queue scoring — `/app/scoring`  · LA-2

**Files:** `app/app/(shell)/scoring/page.tsx` (15), `components/app/scoring-workspace.tsx` (136)
**Mockup:** NONE — design from foundation
**Gate:** `outbound_dialing` · **`owner`, `producer` only** — vendor contact rate is a signal, and the weights order a setter's own queue
**Data:** `GET /api/app/scoring`, save via the same service
**Menu icon:** `brain` — **missing from the ICONS map, renders a blank circle (D-05)**

**Purpose:** decide the order leads are served in, and show whether it beats the plain order.

### Must do
- Enable/disable toggle (`aria-label="Enable queue scoring"`).
- Seven weights, editable.
- **The DEFAULT badge must mean something.** `saveScoringSettings` compares each submitted weight
  against `default_scoring_weights()` and stores **only the differences**, deleting an override set
  back to default. Before that fix, saving one weight marked all seven as overridden and the badge
  was meaningless. Render DEFAULT vs OVERRIDDEN per weight, and a reset-to-default per weight.
- **"Is it working?"** — the honest comparison against the unscored order. If the answer is "not
  measurably", say so. A scoring screen that only ever praises itself is not worth having.
- Save applies to the **next** lead served, and the toast says exactly that.

### Fix while you are here
- **D-05:** add `Brain` to the sidebar `ICONS` map.

### Controls
| Control | Destination / effect |
|---|---|
| Enable toggle | local until save |
| Weight input ×7 | local until save |
| Reset to default (per weight) | clears the override |
| Save | "Queue scoring saved. It applies to the next lead served." |

### Layout
`max-w-5xl`, single column. Enable card at the top: the toggle, one line on what scoring does, and
the current state. Weights as a list of rows — name, one-line meaning, input, DEFAULT/OVERRIDDEN
chip, reset. "Is it working?" is a panel comparing scored vs unscored contact rate over a stated
window, with the sample size. **Always show the sample size**; a 3-point lift on 40 calls is noise
and the reader must be able to see that.

### Must not
- Mark a weight overridden when it equals the default.
- Apply a weight change retroactively to an already-served queue.
- Present the comparison without its window and sample size.
- Let both Save and Enable be orange.

---

## 14. Activity & scorecard — `/app/activity`  · LA-2

**Files:** `app/app/(shell)/activity/page.tsx` (2), `components/app/activity-log-workspace.tsx` (45)
**Mockup:** `03-agent-activity-scorecard.png` — authoritative; generated set adds an Activity/Scorecard/Data-integrity tabbed composite
**Gate:** `outbound_dialing` · `owner`, `producer`, **`setter`** — **PAGE GATE IS MISSING (D-06)**
**Data:** `GET /api/app/activity?<filters>`, `GET /api/app/scorecard?days=30`

**Purpose:** what each agent did, and how it turned out.

### Fix first — D-06, Sev A
This is the only page in the shell with no `guardPage`. Data is safe (both APIs enforce), but an
unentitled or wrong-role reader gets full page chrome, error toasts and permanently empty panels
instead of a gate notice. Add the preamble in **D-06** before any visual work.

### Must do
- Served-lead activity table with filters: agent, campaign, disposition, date range. Server-side
  pagination with Previous / Next and the range shown.
- Export CSV — `format=csv` on the same endpoint, `Content-Disposition` attachment.
- Agent scorecard from `/api/app/scorecard?days=30`.
- Setter outcomes, and the setter roster.
- Fresh vs recycled performance — the comparison that justifies § 11.
- **Scope follows role, decided server-side.** A setter sees their own rows and no roster; an owner
  sees the team. `hasTenantPermission(role, "scorecard.view.all")` decides. Do not add a client-side
  "all agents" toggle.
- Refresh.

### Controls
| Control | Destination / effect |
|---|---|
| Apply filters | re-fetch |
| Export CSV | `GET …?format=csv` |
| Previous / Next | paginate |
| Refresh | re-fetch |
| Served lead activity anchor | `#served-lead-activity` |

### Layout
`max-w-7xl`. Tabs: Activity · Scorecard · Data integrity. Filter bar on `--portal-group`. Metric
strip (leads served, dials, contacts, callbacks, appointments, applications, contact rate, setter
performance) each with a period-over-period delta — and the delta needs its comparison window
named, not just an arrow.

Table is dense, `tabular-nums` on every numeric column. Pagination shows "Showing 1–50 of 421".
Data-integrity alerts are a list with counts and a "View all (7)".

### Must not
- Show a delta without its comparison period.
- Let a setter see a colleague's rows, or add a UI control that requests them.
- Export more than the filter selected.
- Render the page for an unentitled reader (D-06).

---

## 15. True CPA — `/app/true-cpa`

**Files:** `app/app/(shell)/true-cpa/page.tsx` (16), `components/app/true-cpa-workspace.tsx` (83)
**Mockup:** `25-agent-true-cpa.png` — authoritative
**Gate:** `true_cpa` · `owner`, `producer`, `bookkeeper`
**Data:** `GET /api/app/true-cpa?<filters>`, `GET /api/app/true-cpa/leads?<filters>`

**Purpose:** what each vendor and campaign actually costs through an issued policy.

### Must do
- Filters: from, to, vendor, campaign, product.
- Metric strip: net spend, leads received, applications, issued policies, True CPA.
- Vendor/campaign table: leads, contact rate, undialable rate, applications, issued, net spend,
  True CPA, claim acceptance, lineage.
- Row → lead drill-down panel (`/api/app/true-cpa/leads`), each lead linking to `/app/leads/<id>`.
- Contact rate by time slot, and the attempts-to-contact curve with incremental rate per attempt.
- Export CSV.
- **The methodology line must stay:** "computed live from your linked data. Missing True CPA means
  no issued policy event is attributed to that vendor and campaign, **not zero cost**." That
  sentence prevents the single worst misreading available on this page.
- The drill-down states it is operational only: no phone, SSN, banking or policy number is exported.
- "No talk-time metric is used" — say it, because its absence is otherwise read as a bug.

### Fix while you are here
- **D-01:** the eyebrow is `25 / Analytics`. It should be `Insight`.

### Controls
| Control | Destination / effect |
|---|---|
| Apply filters | re-fetch |
| Row | drill-down panel |
| Lead row → View in leads | `/app/leads/:leadId` |
| Export CSV | download |
| Refresh | re-fetch |
| Close (×) | closes the panel |

### Layout
`max-w-7xl`. Filter bar ends in the orange Apply. Five metric cards. Main table with the selected
row carrying a 3px orange left border and a tint. Two analysis panels below, side by side.
Drill-down is a right rail.

True CPA is the hero number: largest value in the strip. Claim acceptance is a percentage with a
health colour. Lineage is a chip (`Linked` / `Review`) — an unlinked row is a data problem, not a
zero.

### Must not
- Render a missing True CPA as `$0.00`. `—`, with the methodology note.
- Include PII in the export.
- Add a talk-time column.
- Show cost to a setter or assistant.

---

## 16. Vendor returns — `/app/vendor-returns`

**Files:** `app/app/(shell)/vendor-returns/page.tsx` (31), `components/app/vendor-returns-workspace.tsx` (78)
**Mockup:** NONE — design from foundation, sibling of § 15
**Gate:** `true_cpa` · `owner`, `producer`, `bookkeeper`
**Data:** `GET /api/app/vendor-returns`, `POST /api/app/vendor-returns/claims`, `PATCH /api/app/vendor-returns/claims/:id`, evidence CSV at `/api/app/vendor-returns/claims/:id`

**Purpose:** build evidence-backed return claims and reconcile vendor credits.

### Must do
- Claim packages list with vendor, period, claimed amount, credited amount, status.
- Create a claim.
- Mark submitted (`PATCH`).
- **Evidence CSV per claim.** A return claim without evidence is a request; with it, it is a
  position. This is the page's reason to exist.
- Credit ledger — claimed vs credited, with the difference. An unreconciled gap is the number the
  reader is looking for.
- Refresh.
- Preserve source history: reconciling must not overwrite what was originally claimed.

### Fix while you are here
- **D-01:** eyebrow is `25 / Vendor economics` (and 25 is already used by § 15). Should be `Insight`.

### Controls
| Control | Destination / effect |
|---|---|
| New claim → Save | `POST …/claims` |
| Mark submitted | `PATCH …/claims/:id` |
| Evidence CSV | `GET …/claims/:id` (download) |
| Refresh | re-fetch |

### Layout
`max-w-7xl`. Strip: open claims, claimed total, credited total, outstanding. Claim table with a
status chip and a per-row Evidence CSV. Expanding a row shows the evidence rows that back it.
Claimed and credited sit adjacent with the variance in a third column, `tabular-nums` — never make
the reader subtract.

### Must not
- Let a claim be submitted without evidence.
- Overwrite the original claimed amount on reconciliation.
- Show a credited figure the vendor has not confirmed.

---

## 17. Daily deal flow — `/app/deal-flow`

**Files:** `app/app/(shell)/deal-flow/page.tsx` (13), `components/app/deal-flow-workspace.tsx` (129)
**Mockup:** `07-agent-daily-deal-flow.png` — authoritative. The generated set contains **three header concepts (A/B/C)** for the date range — see `06-MOCKUP-INDEX.md`; concept C (single combined range control) is the recommendation.
**Gate:** `daily_deal_flow` · `owner`, `producer`
**Data:** `GET /api/app/deal-flow?<filters>`, `POST/PATCH /api/app/deal-flow/:id`. Accepts `?focus_lead_id=` — the disposition wizard sends the reader here.

**Purpose:** every deal worked today, with the written numbers the agent confirmed.

### Must do
- Date range with Apply and Today. Validate: both dates required, From ≤ To, with specific messages
  (both already correct).
- Filters: status, agent, search.
- Production table: date, lead id, campaign, vendor, state, status, owner, next action.
- Row → selected-case panel with the submission timeline.
- Add deal update (manual entry) and Edit record.
- **Money accepts dollars and cents with a precise error:** "Money values must use dollars and
  cents, for example 71.40". Keep the example in the message.
- Export CSV — a real `<a href>` with a `Download` icon. **This is the pattern; copy it elsewhere
  (see D-18).**
- `focus_lead_id` scrolls to and selects that row. Arriving from a disposition and not finding the
  deal is the failure this parameter prevents.
- Partner production summary.

### Fix while you are here
- **D-12:** the `⋯` "More deal actions" button in the selected-case panel has no handler and no
  menu. Wire or remove.

### Controls
| Control | Destination / effect |
|---|---|
| From / To + Apply | re-fetch |
| Today | resets the range |
| Export | `<a href={csvHref}>` download |
| Add deal update | opens the manual form |
| Save deal update | `POST` |
| Edit record → Save | `PATCH …/:id` |
| Row | selected-case panel |
| ⋯ More deal actions | **nothing — D-12** |

### Layout
`max-w-7xl`. Header carries the date range — use **concept C**: one combined
`Sep 13, 2026 – Sep 18, 2026` control with a calendar glyph and a chevron, then Apply, then a
divider, then Export and Add deal update. Two separate date inputs (concepts A and B) cost twice
the width and read as two unrelated fields.

Four metric cards. Two columns: production table left, selected case + timeline right. Timeline is
a vertical rail with a dot per event, timestamp and actor.

### Must not
- Accept a money value without validating the format.
- Default to a range wider than today — the page is called *daily* deal flow.
- Ignore `focus_lead_id`.
- Use two date inputs where one range control does the job.

---

## 18. Callback calendar — `/app/callbacks`

**Files:** `app/app/(shell)/callbacks/page.tsx` (9), `components/app/callback-calendar.tsx` (312)
**Mockup:** `06-agent-callback-calendar.png` — authoritative. Two near-identical generated variants differ only in whether Reschedule is orange or white: **white.** Reschedule is not the primary action.
**Gate:** `callback_calendar` · roles per menu (`owner`, `producer`, `assistant`) — this page uses `UpgradePrompt` rather than `FeatureGateNotice`; read-only when suspended/paused
**Data:** `GET /api/app/callbacks`, `GET /api/app/callbacks?callback_id=…&include_history=true`

**Purpose:** keep callback commitments in the **customer's** timezone.

### Must do
- Day / Week / Month views with a month grid and day markers.
- **Every time shown in the customer's timezone, with the agent's local time alongside.** The page
  subtitle promises it; a callback missed because of a timezone is the failure this page exists to
  prevent.
- Overdue section, counted and prominent, with how overdue each is.
- Detail panel per callback with history.
- Complete and Cancel actions.
- Reschedule.
- Direct `tel:` and `mailto:` links on the callback.
- Lead link → `/app/leads/<leadId>`.
- Read-only disables Schedule callback but keeps it visible with an explanation.
- Legend for Scheduled / Overdue / Completed.

### Controls
| Control | Destination / effect |
|---|---|
| Day / Week / Month | view switch |
| Date cell | selects the day |
| Callback row | detail panel |
| Complete | `onAction("complete")` |
| Cancel | `onAction("cancel")` |
| Reschedule | opens the reschedule form |
| Phone / Email | `tel:` / `mailto:` |
| Lead name | `/app/leads/:leadId` |
| Schedule callback | `/app/leads` (pick a lead first) — disabled when read-only |
| Close (×) | closes the panel |

### Layout
`max-w-7xl`. Eyebrow `Sell`. Two columns: calendar left (month grid, 44px minimum cells, the
selected day ringed in orange, a coloured dot per state), queue right. The **Overdue block sits
above** the upcoming list, in a warning-tinted panel with its count in the heading.

Each callback row: customer, phone, scheduled time in customer tz with the agent-local equivalent
directly beneath in `--portal-muted`, then the actions. Two timezones on one row is the hardest
part of this layout — label them, never leave the reader guessing which is which.

### Must not
- Show only one timezone.
- Make Reschedule orange. Complete is the primary outcome.
- Hide overdue callbacks inside the calendar grid.
- Let "Schedule callback" imply a callback can be created without a lead.

---

## 19. Lead workspace — `/app/leads`

**Files:** `app/app/(shell)/leads/page.tsx` (9), `components/app/lead-workspace.tsx` (81)
**Mockup:** `16-agent-lead-workspace.png` — authoritative. Three generated variants differ only in the create-button label; use **"Add lead"**.
**Gate:** `book_of_business` (no role gate on this page)
**Data:** `GET /api/app/leads`, `GET/POST /api/app/leads/:id`, `PATCH /api/app/leads/:id`, `POST /api/app/leads`, `GET/PUT /api/app/leads/draft`, `POST /api/app/templates/assignment`, export at `/api/app/leads/export`

**Purpose:** capture, filter and move leads through the tenant's own pipeline template.

### Must do
- **Board and Table views, both.** Board for stage movement, table for scanning and export. Remember
  the choice.
- Board: a column per template stage with counts; drag to move (`PATCH`), "Lead moved".
- Table: sortable, paginated, with the range and total shown.
- Search + expandable filters.
- Add lead against the template's fields.
- **Draft autosave** via `GET/PUT /api/app/leads/draft` — a half-typed lead survives a reload.
- Row/card → preview panel with Submission and Timeline tabs, then a link into `/app/leads/<id>`.
- Export CSV honouring the active filters.
- Template assignment (`POST /api/app/templates/assignment`) for owners — "Template updated".
- Error state with Try again.

### Controls
| Control | Destination / effect |
|---|---|
| Board / Table | view switch |
| Search / Filters / Reset | re-fetch |
| Add lead → Save | `POST /api/app/leads` |
| Drag card | `PATCH /api/app/leads/:id` |
| View | preview panel |
| Submission / Timeline | tab switch |
| Lead name | `/app/leads/:id` |
| Export CSV | `/api/app/leads/export?<filters>` |

### Layout
`max-w-7xl`. Header with the view toggle (segmented, left) and Add lead (orange, right). Summary
strip. Filter bar.

Board: horizontally scrolling columns, min 280px each, header with stage name + count, cards
carrying name, product, source, age and a chevron. A stage colour band on the column header only —
not on every card.

Table: dense, one primary row action, `⋯` for the rest.

Preview panel: "Form as submitted" is a read-only key–value block that must look
unmistakably read-only — it is the partner's exact submission and must never appear editable.

### Must not
- Drop a stage because the template changed. Unknown stages get a visible "unmapped" column.
- Let "Form as submitted" look editable.
- Lose a draft on reload.
- Export beyond the active filter.

---

## 20. Lead detail — `/app/leads/[id]`

**Files:** `app/app/(shell)/leads/[id]/page.tsx` (11), `components/app/lead-detail-workspace.tsx` (116)
**Mockup:** `17-agent-lead-detail.png` — authoritative
**Gate:** `book_of_business` · `owner`, `producer`, `assistant`
**Data:** `GET /api/app/leads/:id`, `PATCH`/`DELETE /api/app/leads/:id/notes`, `POST /api/app/leads/:id/reopen`, `GET /api/app/notes/search?q=…`, `POST /api/app/inbound/handoff`, `POST /api/app/agent-floor`

**Purpose:** one lead, its whole history, and every action available on it right now.

### Must do
- Header: name, screening badge (blocked / warning / clear), queue status, partner, product,
  submitted-at. Screening warnings render as a visible warning row, not a chip alone.
- **Actions driven by `data.actions`, not by the client's guess.** The server returns `canClaim`,
  `canAcceptHandoff`, `canHandoff`, `canDisposition`; render exactly those. This is the rule that
  keeps the page and the API from disagreeing.
- Claim, Accept handoff, Hand off (with a licensed-agent select and the error "Choose a licensed
  agent before offering the handoff"), Nudge team.
- Verification link only when the current user owns the work item.
- Disposition link when permitted.
- Reopen in queue.
- Notes: add, edit, delete, change visibility, and search across notes.
- Field confirmation history and outbound attempt history.
- Back to `/app/leads`.

### Controls
| Control | Destination / effect |
|---|---|
| Claim | `POST /api/app/inbound/claim` |
| Accept handoff | `POST …/handoff` (`accept`) |
| Hand off | `POST …/handoff` (`offer`) |
| Nudge team | `POST /api/app/agent-floor` |
| Verification | `/app/inbound/:queueId/verification` |
| Disposition | `/app/inbound/:queueId/disposition` |
| Reopen in queue | `POST /api/app/leads/:id/reopen` |
| Note save / edit / delete / visibility | notes endpoints |
| Search notes | `GET /api/app/notes/search` |
| Back to leads | `/app/leads` |

### Layout
`max-w-7xl`. Back link, then name + badges, then the action row — which can hold six controls, so
keep one primary (Claim, when available) and the rest outline, with the handoff select immediately
before its button.

Body in two columns: left = tabbed detail (Lead detail / Attempts / Notes / Callbacks / Nurture /
Reactivation); right = contact profile, screening status, source & cost lineage, recent notes,
quick actions.

Source & cost lineage is the panel that answers "where did this lead come from and what did it
cost" — vendor, campaign, sub-campaign, source, cost, cost date. Show cost only to roles entitled
to it; an assistant on this page must not see it.

### Must not
- Render an action the server did not permit.
- Show cost to a role the money boundary excludes.
- Let a note's visibility change without confirmation.
- Bury the screening warning.

---

## 21. Duplicate check — `/app/duplicates`

**Files:** `app/app/(shell)/duplicates/page.tsx` (9), `components/app/contact-workspace.tsx` (105)
**Mockup:** `09-agent-contacts-duplicates.png` — authoritative
**Gate:** `duplicate_detection` (no role gate)
**Data:** `GET /api/app/contacts`, `POST /api/app/contacts`, `POST /api/app/contacts/import`, `POST /api/app/contacts/merge`, `POST /api/app/contacts/merge/undo`, export at `/api/app/contacts/export`

**Purpose:** find probable household duplicates before paying for the same person twice.

### Must do
- Contact directory with search.
- Add contact; import contacts.
- **Duplicate review with a genuine side-by-side.** The reader chooses per field which value
  survives — that is what `choices` carries.
- Keep existing / Keep new, both directions (`reverseChoices` handles the mirror).
- **Merges are reversible and must say so:** "Contacts merged; the original records remain
  recoverable", and Undo merge → "Merge undone; both original contacts are restored". This pair is
  what makes merging safe to do at speed. Never weaken it.
- Recent merges list with Undo.
- Custom contact fields.
- Export CSV.

### Controls
| Control | Destination / effect |
|---|---|
| Search | `GET /api/app/contacts?q=` |
| Add contact | `POST /api/app/contacts` |
| Import | `POST …/import` |
| Keep existing | `POST …/merge` |
| Keep new | `POST …/merge` with reversed choices |
| Undo merge | `POST …/merge/undo` |
| Add field | custom field save |
| Export CSV | `/api/app/contacts/export` |

### Layout
`max-w-7xl`. Review panel first when a duplicate is pending — it is the reason the reader is here.
Two columns of the same field set, with differing fields highlighted and matching ones dimmed. A
radio per differing field. The two Keep buttons sit under their own column so the choice is
spatial, not read from a label.

Directory below, dense, with a duplicate-suspected chip. Recent merges is a compact list with Undo
and a relative timestamp.

### Must not
- Auto-merge on a score.
- Hide which fields differ.
- Make a merge irreversible, or imply it is when it is not.
- Merge across households without saying so.

---

## 22. Policies — `/app/policies`

> Rewritten 2026-10-06 (LA-4.11) to match the built page. The 2026-09-18 prompt described guidance
> cards and a "Ready for your first policy?" strip, which UI-CONSISTENCY §3 removed.

**Files:** `app/app/(shell)/policies/page.tsx`, `components/app/policies-workspace.tsx`

**Mockup:** `22-agent-policies.png`, read through [UI-CONSISTENCY.md](UI-CONSISTENCY.md), which wins where they differ.

**Gate:**
- feature `book_of_business`;
- owner, producer and bookkeeper.
- Read-only: Add and Import are disabled, with one warning line. Download template stays.

**Data:** `GET` / `POST` / `PATCH /api/app/policies`. A create, import or edit recomputes the discrepancies after the response (LA-4.5).

**Purpose:** the book of business. Every other money screen multiplies it by the carrier library.

### Must do
- **`PageHeader` "Policies".** Its actions are Download CSV template, Add policy, and Import policies (primary, last).
- **One `StatStrip`:**
  - Active policies (across N carriers);
  - Annual premium (in force);
  - Carriers (with an active policy);
  - Renewals due (next 30 days; warning tone when any).
- **One `TableCard`:**
  - search and the status filter in its `DataToolbar`;
  - the insured's name links to `/app/policies/[id]` (§23e);
  - `Pager` in the footer.
- **States:**
  - loading is `SectionLoading`;
  - an error is `ErrorState` with Try again, never "No policies yet";
  - empty is `EmptyState` "No policies yet · Import a carrier file or add a policy by hand."
- **Import** reads a CSV against the template and shows its errors before anything is saved. **Add** is one form.
- The lapse date of a lapsed or cancelled policy is `status_changed_at` (LA-4.7), which only a change of status moves.

### Must not
- Show `$0` annual premium when the fetch failed.
- Offer a delete. A policy is a record.
- Put explanatory cards around the table.

---

## 23. Commission ledger — `/app/ledger`

> Rewritten 2026-10-06 (LA-4.11). The 2026-09-18 prompt said "this page has no data source" and
> kept Import statement disabled. Since LA-0.7 and LA-4 it is the comparison the whole module rests on.

**Files:** `app/app/(shell)/ledger/page.tsx`, `components/app/ledger-statement-sections.tsx`

**Mockup:** `18-agent-commission-ledger.png`, read through [UI-CONSISTENCY.md](UI-CONSISTENCY.md).

**Gate:**
- feature `commission_ledger`;
- owner, producer (their own policies only) and bookkeeper;
- read-only: one warning line, and every view stays readable.

**Data:** `GET /api/app/ledger`, which returns entries, totals, gaps, `policiesRead`, and the statement ledger with its reconciliation.

**Purpose:** trace each commission from the policy or the statement to the amount recorded, in two halves that are never mixed:
- **Reported:** accepted statement lines.
- **Expected:** the book times the carrier library's schedules and advance rules.

### Must do
- **`PageHeader` "Commission ledger".** Statements and Import statement appear as actions while the ledger is empty.
- **One `StatStrip` over REPORTED money only.** "Nothing is recorded automatically without a source":
  - Entries (from N statements);
  - Gross commission;
  - Advances;
  - Chargebacks (danger tone when any).
- **One-line status rows when they apply:**
  - read-only;
  - import blocked (with the reason);
  - "N statement lines are waiting for someone to accept a match · Review in Statements".
- **Tabs, one at a time:**
  - **Expected against reported:** per policy, Agrees / Paid short / Paid over / No expected figure, within the $1 tolerance;
  - **Reported by carriers:** each accepted line, with who accepted it and how it was matched;
  - **Expected from your book:** each computed entry, with its schedule rate.
- **Gaps.** A policy the library cannot price is listed with its reason, never guessed at.
- **The book is read whole,** paged past PostgREST's 1,000-row cap (LA-4.7, `readPaged`).

### Must not
- Invent a commission figure, or count an expected entry as recorded.
- Mix reported and expected money in one figure.
- Show `$0` when the honest answer is "could not be read".

---

## 23a. Statements and the import — `/app/statements` · LA-4.1–4.3

> Added 2026-10-06. LA-4 built carrier statement ingestion, so §23's "ingestion does not exist"
> is out of date. §23 is rewritten when the ledger is next touched.

**Files:**
- `app/app/(shell)/statements/page.tsx`
- `components/app/statements-table.tsx`, `unmatched-lines-table.tsx`
- `components/app/statement-import.tsx` (the dialog)
- `components/app/book-of-business-views.tsx` (`ViewTabs`)

**Mockup:** NONE — design from [UI-CONSISTENCY.md](UI-CONSISTENCY.md) and [BRAND.md](BRAND.md).

**Gate:**
- feature `statement_ingestion`;
- roles owner and bookkeeper (`statements.view`); others get `RoleGateNotice`;
- read-only: every list stays readable, and Import is disabled with "Importing is paused while the account is read-only."

**Data:**
- `GET /api/app/statements`
- `POST /api/app/statements/preview` (JSON, writes nothing)
- `POST /api/app/statements` (multipart: the file itself)
- `GET /api/app/statements/[id]/file` (60-second link)
- `GET`/`POST /api/app/statements/unmatched`

**Purpose:** get a carrier's statement in, exactly as the carrier sent it, and show what still waits for a person.

### Must do
- **List.** Every statement, newest first. Voided ones stay listed, marked voided. A statement is never deleted.
- **Two views:**
  - "Statements"
  - "Unmatched lines" (`?view=unmatched`), the queue across all statements

  Both are `ViewTabs` with counts, on one row with the page actions (Commission ledger, Import statement), as on the Agent Floor. When there are no statements, the actions sit in the `PageHeader`.
- **One `StatStrip`:**
  - Statements (footnote: N voided)
  - To review
  - Lines waiting
  - Accepted (posted to the ledger)
- **Import dialog, three steps:**
  1. File, carrier, period.
     - CSV, Excel (.xlsx) or PDF, up to 4 MB.
     - The file is checked by name and first bytes, and an unreadable one gets a sentence the person can act on.
     - For Excel, show the sheet that will be read: the first visible one.
     - The browser hashes the original file (SHA-256) here.
  2. Columns.
     - Use the carrier's remembered mapping if it fits; otherwise guess from the headers.
     - Policy number and amount are required. Premium and rate are optional.
  3. Preview.
     - The `StatStrip` (Lines, Proposed matches, No match yet, Could not read) and the first 25 lines, unreadable ones first.
     - A file already imported for this carrier and period, by the original file's hash, shows the duplicate notice and disables Import.
- **PDF.** Steps 2 and 3 are skipped. The PDF is stored and opens on the statement for typing its lines (LA-4.2). No AI reads it.
- **Import sends the file itself.** The server keeps the original byte for byte, reads it the same way, and opens the statement's review screen.
- **Failures:** a file that cannot be stored means nothing is imported, and the person is told to try again. A failed import leaves no statement and no orphaned file.
- **`?import=1`** opens the dialog. The dashboard checklist links here.

### Controls
| Control | Destination / effect |
|---|---|
| Statements / Unmatched lines tabs | `/app/statements`, `/app/statements?view=unmatched` |
| Commission ledger | `/app/ledger` |
| Import statement | opens the dialog · disabled with reason when read-only or before the migration |
| Next: columns / Preview / Back | dialog steps; Preview calls `statements/preview` |
| Import N line(s) for review | `POST /api/app/statements` → `/app/statements/[id]` |
| Store PDF and enter its lines | `POST /api/app/statements` (PDF) → `/app/statements/[id]` |
| Statement row | `/app/statements/[id]` |
| Include N left unmatched (unmatched view) | `ToolbarCheckbox`, off by default; shown when any standing statement has lines left unmatched |
| Re-match N (unmatched view) | `POST /api/app/statements/unmatched` `{ action: "rematch", include_left_unmatched? }` · write |
| Search / filters / Refresh | inside each `TableCard`'s `DataToolbar` |

### Layout
- `PageHeader` (one title, one sentence), then the tabs-and-actions row, then the `StatStrip`, then one `TableCard` with its `DataToolbar` and `Pager`.
- A blocked state (read-only, migration pending) is one warning line, not a card.
- In the dialog, every select is `toolbarControl` (36px). Mapping hints are field hints, not paragraphs.

### Must not
- Parse a PDF, or send it to any provider.
- Store anything but the bytes the person chose. The download must equal the upload.
- Write a statement row when the file was not stored.
- Hash the CSV text of an Excel file for the duplicate check. The import hashes the original bytes, so the preview must too.
- Post anything to the ledger on import. Lines post only when a person accepts a match.
- Offer a delete. Void with a reason instead.

---

## 23b. One statement: PDF entry and review — `/app/statements/[id]` · LA-4.2–4.3

> Added 2026-10-06, completed with LA-4.3 the same day: PDF entry (LA-4.2), then name matching,
> re-match and re-process (LA-4.3).

**Files:**
- `app/app/(shell)/statements/[id]/page.tsx`
- `components/app/statement-manual-entry.tsx` (the PDF beside the entry grid, and "Original file")
- `components/app/statement-review.tsx` (lines, decisions, re-process, void)

**Mockup:** NONE — design from [UI-CONSISTENCY.md](UI-CONSISTENCY.md) and [BRAND.md](BRAND.md).

**Gate:**
- feature `statement_ingestion`;
- roles owner and bookkeeper; others get `RoleGateNotice`;
- an id from another workspace is `notFound()`.

**Read-only:**
- the statement, its lines and its PDF stay readable;
- the PDF entry grid is **not shown**, only one warning line;
- review decisions are disabled with their reason.

**Data:**
- `GET /api/app/statements/[id]`
- `GET /api/app/statements/[id]/file` (60-second link, inline for the viewer, `?download=1` to save)
- `POST /api/app/statements/[id]/lines`:
  - `add_manual_lines`;
  - `{ decisions }`;
  - `rematch`
- `POST /api/app/statements/[id]` (`reprocess`, `void`)

**Purpose:** turn one carrier statement into lines a person has accepted, matched by hand or set aside. For a PDF, a person first types the lines in.

### Must do
- **Header.** One `PageHeader`:
  - the title is "Carrier · period";
  - the description reads: file name · kind (CSV / Excel, sheet "…" / PDF) · imported date and by whom · line count, or "lines not entered yet";
  - the actions are "Original file" (only when the original was kept), then Re-process and Void.
- **A PDF waiting for its lines** (`awaiting_entry`):
  - Two columns at `xl` that scroll on their own: the carrier's PDF in a viewer (60-second link, `SectionLoading` while it opens, the error sentence if it cannot), and the entry grid in a `TableCard`.
  - Grid columns: #, Policy number, Insured, Amount, Kind ("From the sign" or a kind), Date, Remove.
  - The footer reads "N lines entered", then Clear (asks first), Add line, and "Record N line(s) for review".
  - Each line is checked as it is typed, by the same rules the server uses. The first problem disables Record, and its sentence is the button's title and one warning line under the grid.
  - **Typed lines are read exactly like a file's lines:** one shared reader (`readStatementLine`) and the same matcher, so a typed statement reviews like an imported one.
  - **Typed lines are kept as a draft in this browser** until they are recorded, so leaving the page loses nothing. A failed record keeps the draft. A successful one clears it.
  - Recording sends all lines once and moves the statement to review.
  - A statement that is not waiting for lines answers 409 with "This statement is not waiting for its lines to be entered."
- **Review** (every other state):
  - one `StatStrip`: Lines, Waiting, Accepted, Set aside;
  - the lines `TableCard`, with view tabs (All lines, Waiting for a person, Accepted, Left unmatched, Could not read) and per-line Accept / Reject / Match… / Leave unmatched.
- **Name matching (LA-4.3).**
  - A line whose policy number matches nothing is proposed by insured name, with this statement's carrier only, when exactly one policy has that name. When several do, the amount breaks the tie: the one policy whose expected ledger entry is within $1.
  - It is always a proposal, never accepted automatically. Its note reads "Insured name and carrier match (…)" or "Insured name, carrier and amount match (…)" and ends "Check before accepting".
- **Re-match (LA-4.3, option c, decided 2026-10-06).**
  - "Re-match N" proposes matches again for the waiting lines, against the book as it is now.
  - When the statement has lines left unmatched on purpose, a `ToolbarCheckbox` "Include N left unmatched" sits just before the button. It is off by default, and ticking it adds those lines to N.
  - With nothing waiting and the box clear, the button reads "Re-match 0", disabled, with the reason as its title.
  - A policy a person already turned down for a line is never proposed for it again. The database enforces this too.
- **Re-process (LA-4.3).**
  - Re-reads the stored original with the same or new column choices.
  - The new statement links back to this one, and this one is voided and kept, in one transaction.
  - Offered only for a CSV or Excel statement whose original was kept.
- **Voided:** one error line saying who voided it, when, and why. Its lines no longer post.
- **Re-processed:** one status line linking to the earlier, voided import.

### Controls
| Control | Destination / effect |
|---|---|
| ← Statements | `/app/statements` |
| Original file | 60-second download link, saved under the carrier's file name |
| Add line / Remove line / Clear | local grid only (Clear asks first) |
| Record N line(s) for review | `POST statements/[id]/lines` `add_manual_lines` · write · disabled while a line has a problem |
| Accept / Reject / Match… / Leave unmatched | `POST statements/[id]/lines` `{ decisions }` · write |
| Include N left unmatched | toggles whether Re-match takes the set-aside lines too · off by default |
| Re-match N | `POST statements/[id]/lines` `{ action: "rematch", include_left_unmatched? }` · write · disabled at 0 |
| Re-process statement | `POST statements/[id]` `reprocess` · write (LA-4.3) |
| Void statement | `POST statements/[id]` `void` with a reason · write · confirm step "Keep it" |

### Layout
- A back link, then `PageHeader`, then optional one-line status or alert rows, then either the entry columns or (`StatStrip` + lines `TableCard`).
- No explanatory paragraph under the grid. The kind and date rules are the column headers' titles.
- Controls are 36px; row buttons are `size="sm"`.

### Must not
- Read, parse or send the PDF anywhere. Only the person reads it.
- Show the entry grid to a read-only account, even disabled.
- Read typed lines with different rules from a file's lines.
- Lose typed lines on navigation or on a failed record.
- Post anything to the ledger when lines are recorded. They are proposals until accepted.

---

## 23c. Discrepancies and the dispute letter — `/app/discrepancies`, `/app/discrepancies/letter` · LA-4.4–4.5

> Added 2026-10-06.

**Files:**
- `app/app/(shell)/discrepancies/page.tsx`
- `components/app/discrepancies-workspace.tsx`
- `app/app/discrepancies/letter/page.tsx` (outside the shell, so it prints as a letter)
- `components/app/dispute-letter-actions.tsx`

**Mockup:** NONE — design from [UI-CONSISTENCY.md](UI-CONSISTENCY.md) and [BRAND.md](BRAND.md).

**Gate:**
- feature `discrepancy_report`;
- roles owner and bookkeeper (`statements.view`). An assistant or producer sees `RoleGateNotice`, and the API answers 403.

**Read-only:**
- reads the page and every finding;
- opens and prints letters;
- cannot change a status, so the decision buttons and "mark disputed" are not offered.

**Data:**
- `GET /api/app/discrepancies` (list and total)
- `PATCH /api/app/discrepancies` (one decision on several findings · write)
- `GET`/`PATCH /api/app/discrepancies/[id]`
- `POST /api/app/discrepancies/letter` (records a printed letter; reading, so read-only may)

**Purpose:** "You appear to be owed $X". Every dollar traces to what the contract expects against what the carrier reported, and each one can be worked to an end.

### Must do
- **The page only reads (user decision 2026-10-06, option a).** Opening it, or `GET` on the list, never recomputes or writes. The findings are recomputed after each change to their facts:
  - statement import, decisions, void and typed lines;
  - creating, editing or lapsing a policy;
  - a contract level, commission schedule or advance rule.

  Those happen after the response (`after()`), so they never slow the change.
- **One `StatStrip` "Owed to you":**
  - You appear to be owed (open + disputed);
  - Never paid;
  - Short or wrong rate;
  - Chargebacks.
- **One `TableCard`:**
  - the `DataToolbar` holds search, kind, carrier and status filters, the actions, and Refresh;
  - rows are selectable, except cleared ones;
  - row decisions are Resolved / Write off, or Reopen.
- **Status:**
  - open → disputed → resolved, or written off;
  - "No longer applies" (cleared) is the refresh's alone.
  - A resolved or written-off finding reopens by itself only when the carrier owes more than when it was decided (LA-4.4).
- **Detail dialog:**
  - expected / received / owed;
  - the arithmetic sentence;
  - the kind's meaning;
  - the note;
  - the status, and its **History** (every change, newest first, with who; "when a statement changed" for the refresh's).
- **Dispute letter (`Dispute letter (N)`).**
  - It needs the selection to be one carrier's. Otherwise the button is disabled with the reason.
  - It opens the letter in a new tab.
- **The letter** lists exactly `letterItems`: the selected findings for that carrier that still apply.
  - It shows the agency (name, address, NPN), the date, and the recipient.
  - The recipient is editable. It starts "<Carrier> / Commissions Department", prints as written, and is remembered per carrier on that computer, because the carrier library holds no commissions address.
  - "Re:" carries the writing number.
  - The table has policy, insured, problem with its arithmetic, period, expected, paid and owed.
  - **The total is the sum of the rows shown.**
  - It ends with the sender's signature block.
- **Print** records the letter in the audit log once per print, not on opening or reloading.
- For an account that can decide, Print also offers "Mark the N open findings as disputed", on by default. Disputed, resolved and written-off findings are left alone. If the record fails, it still prints and says so.
- **The letter prints black on white** whatever the screen theme. Its controls are `print:hidden`.

### Controls
| Control | Destination / effect |
|---|---|
| Statements | `/app/statements` |
| Search / Kind / Carrier / Status / Refresh | in the `DataToolbar` (Refresh re-reads) |
| Row checkbox | selects for the letter or bulk dispute |
| Mark disputed (selection) | `PATCH /api/app/discrepancies` `{ ids, status: "disputed" }` · write |
| Dispute letter (N) | `/app/discrepancies/letter?carrier=…&ids=…` in a new tab · disabled with reason unless one carrier |
| Resolved / Write off / Reopen | `PATCH /api/app/discrepancies` `{ ids: [id], status }` · write |
| Open (row) | the detail dialog |
| Letter · To | editable recipient, remembered per carrier in this browser |
| Letter · Mark … as disputed | `ToolbarCheckbox`, writers only, on by default |
| Letter · Print | `POST /api/app/discrepancies/letter`, then the PATCH when ticked, then `window.print()` |

### Layout
- `PageHeader` (one title, one sentence, Statements), then the `StatStrip`, then the `TableCard`.
- The letter is a single 768px column with `text-sm` and relaxed leading. Its table uses `text-sm`, with `text-xs` for the arithmetic under each problem. There are no `text-[Npx]` sizes.

### Must not
- Recompute or write when the page, the list or a letter is opened.
- Offer a person "cleared".
- Put two carriers on one letter, or a cleared finding on any letter.
- Show a total that is not the sum of the letter's rows.
- Email the letter. It is printed, or saved as PDF from the print dialog.

---

## 23d. Persistency — `/app/persistency` · LA-4.8

> Added 2026-10-06.

**Files:**
- `app/app/(shell)/persistency/page.tsx`
- `components/app/persistency-tables.tsx` (`PersistencyTable`)
- `components/app/book-views.tsx` (`TabbedSections`)

**Mockup:** NONE — design from [UI-CONSISTENCY.md](UI-CONSISTENCY.md).

**Gate:**
- feature `cohort_persistency`;
- owner, producer (their own book only, as the ledger scopes it) and bookkeeper. Others get `RoleGateNotice`.
- Reading only, so read-only changes nothing here.

**Data:** `GET /api/app/persistency`.

**Purpose:** of the policies old enough to judge, how many were still in force at months 3, 6, 9 and 13. Month 9 leads, against the 65% line carriers judge an agent by.

### Must do
- **`StatStrip`:**
  - Month 9 first, with the alive/eligible count and "carriers look for 65%"; red below it, green above;
  - then months 3, 6 and 13.
- **Three breakdowns, one at a time** (`TabbedSections` with counts):
  - **By issue cohort:** one row per quarter issued ("2026 Q1"), newest first;
  - **By carrier;**
  - **By lead source.**

  Every issued policy is in exactly one row of each.
- **Each breakdown is a `PersistencyTable`:**
  - `TableCard`;
  - `DataToolbar` with search, then Clear, then Refresh;
  - the shared `Pager`, with the footer suffix "a rate needs 5 policies old enough to count".
- **A cell:**
  - shows the rate, with alive/eligible beside it;
  - shows **"—" alone** when fewer than 5 policies are old enough, or none are yet;
  - always carries its counts and the reason in its title and `aria-label`.
  - A month-9 rate under 65% is red.
- **Lead source:**
  - comes from the issued-policy record (vendor, else campaign), joined by the policy number normalised the way statement matching normalises it;
  - otherwise "Unattributed".
- **If the lead-source tables cannot be read,** one warning line says so ("…every policy shows as Unattributed. Refresh to try again."). A table that does not exist yet is honestly empty.
- **No issued policies:** one `EmptyState` saying when the first figure appears.

### Must not
- Show a percentage, or a count beside the dash, for a cell under 5 policies.
- Count a policy too young for the month as alive, or count a pending one at all.
- Let a read error pass for "Unattributed".
- Call a client function from the server page. The shared formatter `persistencyPct` lives in `lib/persistency/compute.ts`.

---

## 23e. One policy's money — `/app/policies/[id]` · LA-4.9

> Added 2026-10-06. This replaces 06-MOCKUP-INDEX's "Policy detail does not exist": it is built,
> linked from the insured's name on Policies.

**Files:** `app/app/(shell)/policies/[id]/page.tsx`

**Mockup:** NONE — design from [UI-CONSISTENCY.md](UI-CONSISTENCY.md).

**Gate:**
- feature `book_of_business`;
- owner, producer (only a policy they recorded) and bookkeeper. An assistant gets `RoleGateNotice`, so no money is shown.
- Another workspace's id, or a malformed one, is `notFound()`.
- The Open discrepancies tab needs `discrepancy_report` and owner or bookkeeper.

**Purpose:** everything about one policy's money on one page, with the same figures the ledger has for it.

### Must do
- A back link "← Policies".
- **One `PageHeader`:**
  - title "Insured · policy number";
  - description: carrier · product · premium a year · issued date · lead source ("Unattributed", or "unavailable right now" when it could not be read);
  - the status chip as its action.
- **One `StatStrip`:**
  - Advance received (expected beside it);
  - Earned to date (charged back beside it);
  - Carrier paid (its accepted line count; warning tone when short);
  - Chargeback exposure (until the window ends, and the clawback type).
- **Tabs, one at a time:**
  - **Open discrepancies,** first when there are any, because they are the one thing to act on, with a link to Discrepancies;
  - **What your contract expects:** each ledger entry with date, kind, rate and amount;
  - **What the carrier reported:** each accepted line, linked to its statement.
- **The figures are `computeLedger([this policy])`**, the ledger page's own function and library. They equal that policy's rows on the ledger (checked live: $1,192.80 earned, $198.80 paid from 2 lines, $994.00 open short-paid).
- **Every read is this policy's own:**
  - `getPolicyStatementLines`;
  - `listDiscrepancies({ policyId })`;
  - `leadSourceOf`, which reads the issued-record candidates for this number, then one vendor or campaign.

  So the page costs the same in any size of book.
- **Failures:**
  - a discrepancy read that fails is one warning line ("…could not be loaded just now"), never "no discrepancy";
  - a contract gap (no schedule) is one warning line naming what to fix in Settings.

### Must not
- Read the whole tenant's ledger, findings or lead sources for one policy.
- Show money to an assistant, or another producer's policy to a producer.
- Offer edits here. The policy is edited on Policies, and findings are worked on Discrepancies.

---

## 24. Appointments & licences — `/app/appointments`

**Files:** `app/app/(shell)/appointments/page.tsx` (30), `components/app/appointment-vault-settings.tsx` (752)
**Mockup:** `04-agent-appointments-licences.png` — authoritative
**Gate:** `appointment_vault` · `owner`, `producer` · `canEdit` = **owner AND full access**
**Data:** `GET /api/app/appointment-vault`

**Purpose:** carrier appointments, state licences, E&O cover and continuing education in one place.

### Must do
- Readiness summary — can this agent legally write this product in this state today.
- Carrier appointments grid by carrier × state.
- State licences with expiry.
- E&O insurance with coverage and expiry.
- Continuing education with credits and deadline.
- **"Connect a carrier first"** when no carrier exists — a correct precondition state, not an empty
  table.
- Multi-select with a Clear action; "Select at least one carrier and state" when the selection is
  empty.
- `canEdit` is stricter than the page gate: a producer reads, only an owner with full access edits.

### Controls
| Control | Destination / effect |
|---|---|
| Carrier/state selection | local |
| Clear | empties the selection |
| Save (per section) | vault update |
| Connect a carrier | `/app/settings` carrier library |

### Layout
`max-w-7xl`. Readiness panel first — the answer to "am I clear to sell", as a status, not a table.
Then four sections as cards: appointments, licences, E&O, CE.

Appointments are a matrix (carriers as rows, states as columns) with a state glyph per cell;
matrices get unreadable past ~12 columns, so paginate states or group by region. **Anything expiring
inside 60 days is a warning, anything expired is danger, and both appear in the readiness panel** —
not only in their own section.

### Must not
- Present an expired licence as merely "inactive".
- Let a producer edit.
- Show a carrier/state cell as clear when the underlying appointment is pending.
- Bury an expiry inside a table when it blocks selling.

---

## 25. Lapse risk — `/app/lapse-risk`

**File:** `app/app/(shell)/lapse-risk/page.tsx` (47) — inline
**Mockup:** `15-agent-lapse-risk.png` — authoritative
**Gate:** `chargeback_radar` · `owner`, `producer`
**Data:** none yet.

**Purpose:** policies most likely to lapse in the next 30 days.

This page exists partly to demonstrate the route guard: `chargeback_radar` is granted by one plan
only, so a tenant without it gets an upgrade prompt rather than a broken screen. It is currently a
correct, honest empty state and nothing more.

### Must do
- Keep the empty state honest: "Nothing at risk right now", and explain that scored policies will
  appear most-urgent-first.
- When scoring exists: a ranked table with the policy, the customer, the risk signal, the reason,
  premium at risk and commission exposure — and **the reason is mandatory.** A risk score without a
  reason is not actionable.
- Keep the role gate detail naming commission exposure as the reason for it.

### Layout
`max-w-3xl` while empty; `max-w-7xl` once it is a table. Do not build the wide layout before the
data exists.

### Must not
- Show a risk score without its reason.
- Rank by premium when the page claims to rank by urgency.
- Fabricate a sample row to make the page look finished.

---

## 26. Partners (records) — `/app/publishers`

**Files:** `app/app/(shell)/publishers/page.tsx` (11), `components/app/partners-workspace.tsx` (1,573)
**Sub-components:** `PartnerUsersPanel` (678), `PartnerFormStudio` (1,189), `PartnerMarketAccessPanel` (261)
**Mockup:** `23-agent-partner-records.png` — authoritative
**Gate:** `publisher_records` · **`owner`, `bookkeeper` only** · `canManageProductConfig` = owner
**Data:** `GET /api/app/partners`, `GET /api/app/partners/:id/products`, `GET /api/app/products`, plus the studio and users endpoints
**Nav label:** "Partners" (the route keeps `publishers` for link stability)

**Purpose:** manage publishers, marketing companies and affiliates without losing their history.

The largest component in the codebase. Treat the detail panel as a small app.

### Must do
- Directory with search and filters by type and status.
- Add partner.
- Detail panel with tabs: Overview, Contact, Team, Products, Forms, Notes, Commercial terms,
  Activity — with overflow behind a "More" dropdown, which is the existing and correct pattern.
- Commercial terms with rate validation ("Enter a valid non-negative rate").
- Product access: enable for the business, then approve the subset this partner may submit. Two
  steps, and the UI must make the dependency obvious.
- Team management via `PartnerUsersPanel`.
- Form studio via `PartnerFormStudio` — versioned publish ("Published revision N. New partner forms
  use it immediately"), restore inherited defaults, reusable templates, and **phone is required for
  screening and cannot be deleted.** That last rule is a compliance constraint; enforce it in the UI
  as well as the API.
- Market access via `PartnerMarketAccessPanel`.
- **Offboarding requires typing `OFFBOARD` exactly**, and the record survives: "Records and users
  remain visible for audit and reporting purposes. No data is ever permanently deleted." Keep both
  the confirmation and the promise.
- `detailOnly` mode for `/app/publishers/:id` with Back to partners.

### Fix while you are here — four defects on this one page
- **D-04, Sev A:** the Activity tab links to `/app/audit-log`, which **404s**.
- **D-08, Sev A:** the Products tab heading is literally **"Products Ray sells"**. A hard-coded first
  name, shown to every tenant. → "Products you sell".
- **D-09:** Export shows `toast.info("Export is coming next…")` and nothing else.
- **D-18:** that Export uses an `ExternalLink` icon for a download. Use `Download`, and copy
  `deal-flow`'s `<a href>` pattern.

Also: **do not revive `components/app/partner-hierarchy.tsx`** to build the mockup's "Publisher
hierarchy" panel. It is an unwired shell whose Save button saves nothing (**D-15**). Build against
`PartnerUsersPanel`'s endpoints instead.

### Controls
| Control | Destination / effect |
|---|---|
| Search / type / status filters | re-fetch |
| Add partner | create dialog |
| Row | detail panel |
| Tabs / More | tab switch |
| Save terms | terms update |
| Product toggles | `/api/app/partners/:id/products` |
| Publish (form studio) | versioned publish |
| Restore inherited | resets to defaults |
| Save template / Apply template | presets |
| Offboard | typed `OFFBOARD` confirmation |
| Export | **toast only — D-09** |
| View in audit log | **404 — D-04** |
| Back to partners | `/app/publishers` |

### Layout
`max-w-7xl`, master–detail. Directory left (or full width when nothing is selected), detail right.
Summary strip: active partners, portal users, active campaigns, needs review.

Detail panel header: avatar, name, status chip, type, one-line description, then Edit and `⋯`.
Tabs beneath. The form studio inside a tab needs `compact` mode — it is a 1,189-line component and
must not fight the panel for width.

### Must not
- Permanently delete a partner or their history.
- Allow a lead form without a phone field.
- Approve a product for a partner that the business has not enabled.
- Leave a heading with a person's name in it.

---

## 27. Partner detail — `/app/publishers/[id]`

**File:** `app/app/(shell)/publishers/[id]/page.tsx` (38)
**Mockup:** same as § 26
**Gate:** identical to § 26
**Purpose:** the same workspace, opened directly on one partner, for linking and bookmarking.

Renders `PartnersWorkspace` with `initialSelectedId` and `detailOnly`.

### Must do
- Open with that partner selected and the directory hidden.
- Back to partners → `/app/publishers`.
- An unknown or other-tenant id must not render another tenant's partner. Gate and scope are the
  same as § 26 — do not relax them because an id was supplied.

### Must not
- Diverge visually from the detail panel in § 26. Same component, same design.
- Treat the id as proof of anything.

---

## 28. Partner quality — `/app/partner-quality`

**Files:** `app/app/(shell)/partner-quality/page.tsx` (11), `components/app/partner-quality-workspace.tsx` (154)
**Mockup:** `21-agent-partner-quality.png` — authoritative
**Gate:** `partner_quality` · `owner`, `producer`, `bookkeeper`
**Data:** `GET /api/app/partner-quality?<filters>`, `GET /api/app/partner-quality/leads?<filters>`

**Purpose:** compare partner lead quality and conversion **without cost data**.

That exclusion is the page's reason to exist: quality can be reviewed by roles and in contexts where
spend must not appear. **Never add a cost column.** If cost is wanted, that page is `/app/true-cpa`.

### Must do
- Date filters with Apply.
- Partner comparison table: leads sent, submitted, screening outcomes, conversion.
- Screening quality breakdown.
- Disposition mix per partner.
- Drill-down into the underlying leads by metric (sent, submitted, a specific disposition), each
  lead linking to `/app/leads/<id>`.
- Per-member breakdown where a partner has several submitting users.

### Controls
| Control | Destination / effect |
|---|---|
| Apply dates | re-fetch |
| Review leads / metric cell | drill-down |
| Lead row | `/app/leads/:leadId` |
| Close | closes the drill-down |
| Try again | re-fetch |

### Layout
`max-w-7xl`. Filter bar, comparison table, then two analysis panels (screening quality, disposition
mix). Drill-down as a right rail or sheet.

Every metric cell that can be drilled must **look** interactive — underline on hover, a cursor
change, and a real `<button>`. A table where some numbers are clickable and none look it is the
most common discoverability failure in this codebase.

### Must not
- Show cost, spend, CPA, or anything from which cost can be derived.
- Rank partners by volume when the page is about quality.
- Present a conversion rate without its denominator.

---

## 29. Settings — `/app/settings`

**Files:** `app/app/(shell)/settings/page.tsx` (56), `components/app/agent-settings-tabs.tsx` (74) and its ten tab components
**Mockup:** `24-agent-settings.png` — authoritative
**Gate:** `book_of_business` · **`owner` only**
**Data:** `getTeamSnapshot()`, `outboundLimitSnapshot()` server-side; each tab loads its own

**Purpose:** everything an owner configures.

Ten tabs: Agency profile · Carrier library · States & licences · Team & access · Queue & SLA ·
Pipelines · Dispositions · Form templates · Alerts *(disabled — managed from the alert centre)* ·
Billing *(disabled — managed by your account administrator)*.

### Must do
- Owner-only, with the role notice for everyone else.
- The two disabled tabs keep their `disabled` reason strings and remain visible. A tab that vanishes
  for some readers makes the product feel unstable; a visible tab that says where the setting lives
  is a signpost.
- Every tab states its scope and that changes are effective-dated and audited.
- "Owner only" badge plus "Changes are effective-dated and audited" in the header.
- Carrier library: contracts, products, commission schedules, advance rules, with a configuration
  health panel.
- Team & access: owners, licensed agents, setters, assistants and their boundaries, with the outbound
  limit snapshot.
- Save and Discard per tab, and **nothing is live until saved** — say so in the footer bar.

### Fix while you are here
- **D-01:** eyebrow is `24 / Licensed agent`. Should be `Settings`.
- **D-11:** add `?tab=` support so `AgentSettingsTabs` can open on a named tab. Five dashboard
  checklist steps and at least one agent-floor link need it.

### Controls
| Control | Destination / effect |
|---|---|
| Tab | switches panel (should sync to `?tab=`) |
| Save (per tab) | that tab's endpoint |
| Discard | reverts local edits |
| Alerts / Billing tabs | disabled, with the reason |

### Layout
`max-w-7xl`. Header with the owner badge. **Left vertical tab rail** (not a horizontal strip — ten
items wrap badly), active item with an orange left border and tint. Panel right. A sticky footer bar
carries Discard + Save and the "nothing is live until saved" line.

Configuration health lives in a right rail inside the relevant tab, listing issues as rows with a
chevron into the thing that needs fixing.

### Must not
- Let a tab save silently on blur — this screen is effective-dated and audited.
- Hide the disabled tabs.
- Render for a non-owner.
- Use a horizontal tab strip for ten tabs.

---

## 30. Unbuilt destinations — `/app/[section]`

**Files:** `app/app/(shell)/[section]/page.tsx` (64), `components/app/coming-soon.tsx` (83)
**Mockup:** `02-agent-dynamic-section.png` — authoritative
**Gate:** per the matched menu item

**One page serving 24 menu destinations** — every item in `lib/menu/definition.ts` without
`built: true`: Statements, Discrepancies, Quoting, Applications, Draft dates, Payment repair,
Win-back, Persistency, Payout runs, Partner portal, Profit & loss, Tax summaries, TCPA/DNC, Consent
locker, Litigation packet, and the rest.

A static route always wins over a dynamic one, so the built screens are untouched.

### The decision order is the design — do not reorder it
```
not in the menu at all    → notFound()          it is not a page
in the menu, not granted  → FeatureGateNotice    tell them about their plan
granted, wrong role       → RoleGateNotice
granted but unbuilt       → ComingSoon           tell them about our roadmap
```
Entitlement is checked **before** build status on purpose: a customer without the plan should learn
about their plan, not about what we have not finished building for a feature they do not have.

### Must do
- `built: true` reaching this file is a bug — it calls `notFound()`. Keep that assertion.
- `ComingSoon` must keep all three of its properties:
  1. **No date.** We do not have one, and a missed date is worse than no date.
  2. **"Your plan includes this. Nothing to buy and nothing to switch on."** The reassurance that
     matters — this is not something they lost or must buy.
  3. **Somewhere else to go** — up to three granted, built destinations, preferring the same menu
     section. A dead end that apologises is still a dead end.
- Use the item's `blurb` when present; the generic line otherwise.

### Layout
`max-w-5xl` centred card. Hammer glyph in a tinted medallion, section eyebrow, `<label> is on the
way` at 40/600, the blurb at 20/400. Reassurance block with a green check on a tinted surface.
"In the meantime" list of link-arrow rows with a chevron that nudges right on hover — the Brex
`button-link-arrow` pattern, not blue underlined links.

### Must not
- Give a date, or a quarter, or "soon".
- Show an upgrade prompt for something the plan already includes.
- Render with no onward links.
- Let it 404.

---

## 31–32. Route aliases

| Route | File | Behaviour |
|---|---|---|
| `/app/vendors` | `app/app/(shell)/vendors/page.tsx` (5) | `redirect("/app/campaigns")` |
| `/app/scorecard` | `app/app/(shell)/scorecard/page.tsx` (5) | `redirect("/app/activity")` |

Neither appears in the menu. They exist so older links and bookmarks keep working.

### Must do
Stay server redirects. Keep them when renaming either target — that is their entire purpose.

### Must not
Render anything. Do not add an interstitial. Do not delete them without checking for external
links, including in `docs/qa/`.

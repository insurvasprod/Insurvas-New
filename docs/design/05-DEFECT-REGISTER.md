# 05 · Defect register

Nineteen defects, found by reading every page against the design contract on 2026-09-18.

**Eighteen are fixed.** One needs a product decision and is described at the bottom.

Legend — **Sev**: `A` user-visible and misleading · `B` user-visible and confusing · `C` internal
quality, invisible today.

| # | Sev | Defect | Status |
|---|---|---|---|
| D-01 | A | Mockup file numbers shipped as UI copy (6 screens) | **Fixed** — derived from the menu |
| D-02 | A | Internal ticket IDs shipped as UI copy (5 places) | **Fixed** — rewritten |
| D-03 | A | Dead link → 404 (`/app/team`) | **Fixed** — points at the team tab, owner only |
| D-04 | A | Dead link → 404 (`/app/audit-log`) | **Fixed** — removed, copy corrected |
| D-05 | B | Two menu icons fell back to a generic circle | **Fixed** — `Store`, `Brain` added |
| D-06 | A | `/app/activity` had no page gate | **Fixed** — guard added |
| D-07 | B | Dark mode missed three partner auth pages | **Fixed** — one CSS selector |
| D-08 | A | A person's first name hard-coded into a heading | **Fixed** |
| D-09 | B | "Export" only showed a "coming next" toast | **Fixed** — implemented |
| D-10 | A | Dashboard empty for every role but owner, blaming the plan | **Fixed** — 9 tiles added, copy split |
| D-11 | B | All five checklist steps landed on the same 10-tab page | **Fixed** — deep-linked |
| D-12 | B | Nine controls had no handler | **Fixed** — 3 wired, 6 removed |
| D-13 | C | Six components were never imported | **Fixed** — 5 deleted, 1 wired |
| D-14 | B | A built, tested DNC checker had no route | **Fixed** — mounted on the dialer |
| D-15 | C | An unused component held a Save button that saved nothing | **Fixed** — deleted |
| D-16 | B | Two parallel signup systems | **Open — needs your decision** |
| D-17 | C | Mockup 34 cited an orphaned component | **Fixed** — manifest corrected |
| D-18 | B | `ExternalLink` icon on a download action | **Fixed** — `Download`, as a real link |
| D-19 | B | Configuration placeholder shipped ticket language | **Fixed** — rewritten |

## How they stay fixed

`lib/design/contract.test.mjs` runs under `npm test`, reads source text only, and needs no database.
Eleven tests hold the invariants: no dead internal link, no menu icon without a glyph, no gated page
without its guard, no eyebrow that is a mockup number, no ticket ID in user-visible copy, both
portal roots reached by dark mode, no control without a handler, no orphaned component, the money
boundary on `/app/campaigns` and `/app/scoring`, ComingSoon's three promises, and the derived
eyebrow.

Each test carries a `KNOWN` list, now empty. The assertion fails in **both** directions: a new
violation fails, and so does a `KNOWN` entry that is no longer true — which means a detector that
silently stops matching is caught by its own list going missing.

That two-way check earned its place immediately: it found two instances of D-01 that a manual grep
had missed.

---

## D-01 · Mockup file numbers shipped as UI copy — Sev A — **Fixed**

Six screens rendered an eyebrow that was the *filename index* of its mockup in
`docs/uiux-mockups/brex/`. A customer saw "25 / Analytics" and had no idea what 25 counted. Two
pages shared the number 25.

| File | Was | Now |
|---|---|---|
| `app/app/(shell)/policies/page.tsx` | `22 / Licensed agent` | `Book of Business` |
| `app/app/(shell)/settings/page.tsx` | `24 / Licensed agent` | `Settings` |
| `app/app/(shell)/true-cpa/page.tsx` | `25 / Analytics` | `Insight` |
| `app/app/(shell)/vendor-returns/page.tsx` | `25 / Vendor economics` | `Insight` |
| `components/app/agent-floor.tsx` | `10 / OPERATIONS` | `Leads` |
| `components/app/nurture-workspace.tsx` | `19 / Licensed agent` | `Leads` |

**Fix.** `sectionForPath()` in `lib/menu/definition.ts` derives the eyebrow from the section the
menu already assigns every destination. None of those six strings is typed into a page any more.

The other 32 hand-written eyebrows were not numbers but were still six competing taxonomies. They
are not all converted — converting them is page-by-page work carried in the page prompts — but the
helper and the guard mean no new one can be a number.

**Guarded.** "no page eyebrow is a bare number" and "sectionForPath resolves every built agent
destination to its menu section".

**Verified.** `/app/policies` → "Book of Business", `/app/true-cpa` → "Insight",
`/app/floor` → "Leads", `/app/settings` → "Settings", in the browser.

---

## D-02 · Internal ticket IDs shipped as UI copy — Sev A — **Fixed**

All five described capability that already existed, so the copy was internal *and* out of date: the
plans page promised pricing "lands in SA-2.4" while `plan-version-editor.tsx` edits prices today.

| File | Now reads |
|---|---|
| `app/admin/(protected)/page.tsx` | "Platform administration. Start with the workspace you need below." |
| `app/admin/(protected)/plans/page.tsx` | "What the business sells. Each plan is versioned, and existing subscribers keep the version they bought." |
| `app/admin/(protected)/users/page.tsx` | "Every user across every tenant. Search, filter, and manage account status." |
| `app/admin/(protected)/tenants/page.tsx` | "Every customer account on the platform, with its owner, plan, and onboarding state." |
| `components/admin/plan-dialog.tsx` | "Public plans appear on the pricing page." |

**Guarded.** "no user-visible copy contains an internal ticket id". It reads attribute strings and
JSX text only, so the vocabulary stays allowed in code comments, where it belongs.

---

## D-03 · Dead link → 404 — Sev A — **Fixed**

`agent-floor.tsx` — "View all" beside **Available team** pointed at `/app/team`. No such route and
no such menu key, so it fell to the `[section]` catch-all and returned a framework 404 inside the
shell.

**Fix.** The roster lives on the team tab of Settings, which is **owner-only** — so for a producer
or buffer assistant there was never a fuller list to open. The link now renders only for an owner,
pointing at `/app/settings#team-access`; everyone else gets the count in the panel heading and no
dead end. `AgentFloor` takes a `role` prop for this.

**Verified.** 0 links to `/app/team`, 1 to `/app/settings#team-access`.

---

## D-04 · Dead link → 404 — Sev A — **Fixed**

`partners-workspace.tsx` — the partner **Activity** tab linked to `/app/audit-log`, which is not a
route.

**Fix.** There is no agent-facing audit-log viewer; the events are recorded, the screen does not
exist. Naming something that cannot be opened is the defect, so the copy now says the history is
kept and available to the account administrator, and the link goes to the lead workspace, which is
real.

**Verified.** 0 links to `/app/audit-log`.

---

## D-05 · Two menu icons fell back to a generic circle — Sev B — **Fixed**

`lib/menu/definition.ts` named 36 icons; `agent-sidebar.tsx`'s `ICONS` map had 36 keys — but not the
same 36. `iconFor()` returns `Circle` for an unknown name, so the sidebar drew a featureless dot for
**Vendors & campaigns** (`store`) and **Queue scoring** (`brain`) — both LA-2 screens, the ones most
often demonstrated.

**Fix.** `Store` and `Brain` imported and added to the map.

**Guarded.** "every menu icon resolves to a real icon in the agent sidebar". This class of bug
recurs whenever a menu item is added.

**Verified.** `lucide-store` and `lucide-brain` render; zero generic circles across all 12 nav links.

---

## D-06 · `/app/activity` had no page gate — Sev A — **Fixed**

Two lines, rendering `<ActivityLogWorkspace />` with no `guardPage` — the only page in the shell
without one. No data leaked: `/api/app/activity` and `/api/app/scorecard` both enforce. What broke
was the experience — full page chrome, then error toasts and permanently empty panels, where every
other gated page shows a notice.

**Fix.** The standard preamble, with the roles the two routes already enforce
(`owner`, `producer`, `setter`).

**Guarded.** "every shell page whose menu item requires a feature calls guardPage". The same test
asserts Dashboard stays *ungated*, which it is by design.

---

## D-07 · Dark mode missed three partner auth pages — Sev B — **Fixed**

The dark portal tokens were declared as `.dark .portal-agent`. The partner shell works because its
layout sets both classes — but partner login, set-password and accept-invite set `portal-partner`
alone and kept the light tokens. A partner with dark mode on got a full-brightness page at sign-in
and a dark workspace one click later.

**Fix.** One selector: `.dark :is(.portal-agent, .portal-partner)`. Fixed in the CSS rather than by
adding a class to three pages, so the next page that forgets is still covered.

**Guarded.** "dark mode covers both portal roots".

**Verified.** On `/partner/login`, whose root is `portal-partner portal-partner-login-page` with no
`portal-agent`, `--portal-canvas` now resolves to `#101215` and `--portal-ink` to `#f4f5f6`.

---

## D-08 · A person's first name hard-coded into a heading — Sev A — **Fixed**

`partners-workspace.tsx` rendered **"Products Ray sells"** on the Products tab of every partner's
detail panel, for every tenant. "Ray" was a literal that survived from a draft.

**Fix.** "Products you sell". Not the partner's name — the section is about what the *business* has
enabled; the partner-specific subset is the sibling heading "Approved for this partner".

---

## D-09 · "Export" only showed a toast — Sev B — **Fixed**

The Export button beside "Add partner" fired
`toast.info("Export is coming next…")` and nothing else.

**Fix.** Implemented. New `GET /api/app/partners/export` with `lib/partners/csv.ts`, gated on the
same feature and roles as the directory it exports — an export a wider audience can reach than the
screen is a way around the screen's gate. The CSV carries the directory's own columns plus the
active commercial term, and uses the leading-quote guard from `lib/contacts/csv.ts`, because a value
beginning `=`, `+`, `-` or `@` executes as a formula when a finance team opens it in Excel and
partner names are attacker-influenced text.

Registered in `AGENT_API_POLICIES` and in the money-boundary classification, both of which have
their own guards.

**Verified.** HTTP 200, `text/csv; charset=utf-8`, `attachment; filename=partners.csv`, correct
header row and real data.

---

## D-10 · The dashboard was empty for every role but owner, and blamed the plan — Sev A — **Fixed**

`lib/dashboard/tiles.ts` registered **two** tiles and both were `required_roles: ["owner"]`, so
`visibleDashboardTiles()` returned `[]` for a producer, setter, assistant or bookkeeper and the page
fell through to:

> Your workspace is waiting for its first feature — Ask your account owner to activate a workspace
> feature.

False for a producer on a twenty-feature plan, and it sent them to their owner for a problem the
owner could not fix.

**Fix, both halves.**

1. **Nine tiles added**, covering every role that has work: inbound and floor for
   owner/producer/assistant; dialer for owner/producer; assignments including setters; activity
   including setters; callbacks, leads; policies and ledger for bookkeepers. Each carries its own
   feature and roles, so the entitlement model is unchanged — a tile is only shown to someone who
   could already open the page. Every path is a built screen.
2. **The empty state now splits by cause.** No features granted keeps the "ask your owner" copy. A
   granted entitlement with no tile for this role says so honestly and points at the sidebar.

`dashboard-tile.tsx`'s icon map was extended to match, keyed by the same names the menu uses.

**Verified.** 11 tiles render for an owner on a full entitlement, where 2 did before.

---

## D-11 · All five checklist steps landed on the same 10-tab page — Sev B — **Fixed**

Every step in `lib/dashboard/checklist.ts` pointed at `/app/settings`, which renders ten tabs. The
reader clicked a specific instruction and was dropped at the top of a page to find it themselves.

**Fix.** `AgentSettingsTabs` already selected a tab from the URL hash, so the destination was the
only thing wrong:

```
Add your carriers          → /app/settings#carrier-library
Upload a carrier statement → /app/ledger
Confirm your appointments  → /app/settings#states-licences
Add your lead sources      → /app/publishers
Connect your phone number  → /app/settings#agency-profile
```

The two setup tiles were deep-linked the same way.

**Verified.** `/app/settings#states-licences` selects "States & licences".

**Deliberate and unchanged:** `setupChecklistForState` still reports 0/5 or 5/5 and never a middle
value, because per-step completion is not persisted. A fabricated 3/5 would be worse. Leave it until
per-step timestamps exist.

---

## D-12 · Nine controls had no handler — Sev B — **Fixed**

| Control | Resolution |
|---|---|
| `Details` (agent chat) | **Wired** — toggles the details pane |
| `⌄` Details panel (agent chat) | **Wired** — closes it |
| `Details` (partner chat) | **Wired** |
| `⌄` Details panel (partner chat) | **Wired** |
| `⋯` More conversation actions | Removed — no actions were ever defined |
| `View all` ×2 (Members, Shared files) | Removed — no fuller list exists |
| `Conversation members` (partner chat) | Removed — the list is already in the pane |
| `⋯` More deal actions (deal flow) | Removed — Edit record sits beside it and works |

The inert notification block — a `defaultChecked` checkbox and a frequency `<select>` with no
handler, so "Mute conversation" stored nothing — was replaced with a line pointing at the alert
centre, which is where preferences actually live and which works.

Closing the pane needed one CSS rule: without it the grid keeps its third track and the thread stops
short of the right edge, which reads as a rendering fault rather than a closed panel.

One further control was flagged by the guard and turned out to work: the deal-flow row button had no
`onClick` of its own and relied on the `<tr>` handler bubbling. It now carries the action itself —
the focusable element should own what it does.

**Guarded.** "no button is rendered without a handler, a form, or an explanation". Dropdown triggers
(`asChild` on the parent) and disabled controls are excluded. The sanctioned pattern for an
unavailable action is `components/admin/void-invoice-dialog.tsx`: disabled, with the reason printed
directly beneath it.

**Verified.** Closing Details removes the aside and reflows the grid `272px 487px 320px` →
`272px 807px`; reopening restores it; `aria-expanded` tracks.

---

## D-13 · Six components were never imported — Sev C — **Fixed**

| Component | Resolution |
|---|---|
| `components/app/dialer-preflight.tsx` | **Wired** — see D-14 |
| `components/app/partner-hierarchy.tsx` | Deleted — see D-15 |
| `components/app/partner-directory.tsx` | Deleted — only `partner-hierarchy` used its type |
| `components/app/tenant-signup-form.tsx` | Deleted — superseded by `tenant-auth-workspace.tsx` |
| `components/app/usage-bar.tsx` | Deleted |
| `components/ui/separator.tsx` | Deleted |

`partner-directory.tsx` was not in the original count: the orphan detector saw it as used because
`partner-hierarchy.tsx` imported its type. Removing one exposed the other.

The two untracked files were copied to the session scratchpad before deletion, since git could not
have recovered them.

**Guarded.** "no component is orphaned".

---

## D-14 · A built, tested DNC checker had no route — Sev B — **Fixed**

`dialer-preflight.tsx` was a complete working screen — enter a number, `POST
/api/app/dial/preflight`, show the result — whose endpoint is covered by three verification suites
testing auth, hostile input and fail-closed behaviour. **Nothing in the product rendered it.**

To be precise about the compliance position: this was never a hole. Screening on a served lead is
enforced server-side inside `POST /api/app/dialer/attempt/:id/click`, which re-checks immediately
before the `tel:` handoff. What was missing was the *ad-hoc* lookup — checking a number you were
handed before a lead exists.

**Fix.** A `compact` prop (the convention `PartnerFormStudio` and `PartnerMarketAccessPanel` already
use) drops its page heading, and it is mounted on `/app/dialer` in a disclosure, collapsed by
default — the queue is the job and this is the exception. Same feature and roles as the workspace
above it.

**Verified.** Present on `/app/dialer`, collapsed by default.

---

## D-15 · An unused component held a Save button that saved nothing — Sev C — **Fixed**

`partner-hierarchy.tsx` was never imported, so no user could reach it. It is recorded because the
"Publisher hierarchy" panel it drew appears in mockup `23-agent-partner-records.png`, and someone
would eventually have wired it up. As it stood it would have shipped:

- **"Save configuration"** whose entire handler was `setConfigTarget(null)` — it closed the panel and
  performed no fetch. Every change silently discarded.
- Four `role="tab"` buttons with hard-coded `aria-selected` and no `onClick`.
- Five checkboxes using `defaultChecked` with no state.

**Fix.** Deleted. The working equivalents already exist and are wired: `PartnerUsersPanel`,
`PartnerFormStudio` (with real publish and revision handling) and `PartnerMarketAccessPanel`. If the
hierarchy *view* is wanted, build it against those — do not revive this shell.

---

## D-17 · Mockup 34 cited an orphaned component — Sev C — **Fixed**

`docs/uiux-mockups/brex/README.md` row 34 cited `tenant-signup-form.tsx`, now deleted. The row now
cites `tenant-auth-workspace.tsx` and is marked "Check before use", and the manifest gained a
**Known mismatches with the live product** section covering this plus three others found while
reading: the ledger mockup showing a disabled button as active, the dashboard mockup showing partial
checklist progress that the code deliberately does not report, and the invented sidebars.

---

## D-18 · Wrong icon for a download action — Sev B — **Fixed**

`ExternalLink` means "this leaves the app"; an export is a download.

**Fix.** `Download`, on a real `<a href … download>` rather than a button with a handler — which
gives the browser's own download behaviour, middle-click and right-click → Save as, for free. Same
pattern as `deal-flow-workspace.tsx`, which already got this right.

---

## D-19 · Configuration placeholder shipped ticket language — Sev B — **Fixed**

`ConfigurationPlaceholder` rendered, to an administrator: "Section reserved for {owner}", "will be
implemented by its ticket", and "without changing the Configuration Center shell" — the last naming
a hub that `lib/adminNav/build.ts` says has been removed.

**Fix.** Rewritten for the reader: what is not configured, that nothing would read a setting saved
here, and that access is already restricted. The decision behind the screen was right and is
unchanged — where no provider has been chosen, say so rather than show a form that saves settings
nothing reads. Only the words are different.

---

## D-16 · Two parallel signup systems — Sev B — **NEEDS YOUR DECISION**

Two live, fully-built paths create a workspace. They share no code, no API and no visual identity.

| | Public path | Portal path |
|---|---|---|
| Route | `/signup` | `/app/signup` |
| Component | `components/public/signup-form.tsx` (278 lines) | `components/app/tenant-auth-workspace.tsx` (132) |
| API | `POST /api/public/signup` | `POST /api/app/signup` |
| Chrome | `SiteHeader` — navy `--brand-800` | Brex orange split-shell |
| Identity | **blue** | **orange** |
| Reached from | `/pricing` CTA and the header's "Start free trial" | direct URL only |

Every public entry point leads to the blue one. The orange one — which the approved mockup designs,
and which matches the rest of the product — is unreachable unless the URL is typed.

**I have not fixed this, deliberately.** The fix is to delete one of them, and which one survives is
a commercial question, not a design one: the blue path owns your live funnel today, the orange path
owns your design direction. Deleting the wrong one breaks signups; keeping both keeps the
duplication. That is your call, not mine.

**Tell me which, and it is a short change:** redirect the loser's route to the winner, delete its
component and API route, and update the pricing CTA.

Worth knowing before you decide: `/pricing` and `/legal/*` are the only remaining blue-identity
customer-facing pages, so retiring the blue signup makes the public surface nearly uniform.

# 06 · Mockup index

Which image is authoritative for which route, and which to ignore.

> **Rules beat images (UX-1, 2026-10-03).** A mockup decides a page's content and arrangement. Where it
> shows an eyebrow, a metric-card grid, a blue accent outside the admin console, a filter card above a table or a control taller
> than 36px, [`UI-CONSISTENCY.md`](UI-CONSISTENCY.md) wins.

There are **two** mockup collections and they do not agree with each other.

| Set | Location | Count | Status |
|---|---|---:|---|
| **Curated** | `docs/uiux-mockups/brex/` | 44 PNG + `README.md` | **Authoritative.** Named by route, with a manifest. |
| **Generated** | `.codex/generated_images/01a0a6e0-…/` | 96 PNG | Exploration. Hash filenames, no manifest, many variants and dead ends. |

Every one of the 96 generated images was opened and read for this index.

---

## 1. Use the curated set first

`docs/uiux-mockups/brex/README.md` maps 45 rows to routes with source evidence, and states the
shared rules: 1440×1024, Inter, `#FCFCFD` canvas, `#FFFFFF` surfaces, `#F6F7F9` grouped panels,
`#E6E8EB` borders, `#15191E` ink, `#FF5900` for **one** primary action and the active nav signal,
8px controls, 12px panels, 8px rhythm.

It also carries the sentence that should govern how all of this is used:

> A mockup illustrates proposed UX. It is not proof that the route is implemented or legally
> approved.

### Coverage — and the gap

| Surface | Routes | Curated mockups | Gap |
|---|---:|---:|---:|
| Agent app (`/app/*`) | 32 | 25 | **7** |
| Partner portal (`/partner/*`) | 10 | 9 | **1** |
| Public / auth | 17 | 10 | **7** |
| **Admin (`/admin/*`)** | **34** | **0** | **34** |
| **Total** | **93** | **44** | **49** |

**More than half of the product has no mockup**, and the entire admin surface has none. That is the
real design workload, and it is why [`04-ADMIN.md`](04-ADMIN.md) specifies from the foundation
rather than from an image.

### Routes with no curated mockup

Agent: `/app/campaigns`, `/app/scoring`, `/app/vendor-returns`, `/app/publishers/[id]`,
`/app/import/review/[batchId]`, `/app/vendors`, `/app/scorecard`.
Partner: `/partner/team-review` (manifest row 45 cites an "Approved Team Review mockup" that is not
in the folder; the generated set has one — see § 4).
Public: `/`, `/pricing`, `/signup`, `/legal/[type]`, `/affiliate/[slug]`, `/maintenance`,
`/verification-failed`.
Admin: all 34.

### One manifest row to correct

Row 34 cites `components/app/tenant-signup-form.tsx` as source evidence for `34-agent-signup.png`.
That component is **orphaned** — nothing imports it. The live `/app/signup` renders
`tenant-auth-workspace.tsx`, which has a different structure. See defect **D-17**.

---

## 2. The generated set: what is in it

Four kinds of image, and only the first is directly useful.

### (a) Faithful renderings of real screens — use these
Where a generated image matches a curated mockup, it is usually a higher-fidelity or later pass.
The best of them are more faithful to the real product contract than the curated file:

| Screen | Why it is worth using |
|---|---|
| **Dashboard** | Matches the live page exactly: "Your next steps, in one place.", "Get set up", "Callbacks due today / Follow up with these prospects and clients.", "Open calendar →", "Your workspace / Quick access to the tools you use most." |
| **Lead assignment** | Carries the real contract as its subtitle: "Rules run top to bottom. Licensing and capacity are enforced inside the assignment transaction." |
| **Coming soon** (`/app/[section]`) | Reproduces the component's three rules exactly — no date, "Your plan includes this. Nothing to buy and nothing to switch on.", and an "In the meantime" list. |
| **Callback calendar** | The best solution to the two-timezone problem: customer time, agent time, and the delta (`+3h`) as a third line. Adopt this. |
| **Duplicate check** | Field-by-field comparison with a per-field radio, plus "Merge can be undone for 30 days." |
| **Lead recycling** | The "What will happen" three-step preview (Eligible → Screening → Estimated clear) with "This action cannot be undone." |
| **Inbound transfers** | "Claiming is atomic and connects you to this customer immediately. Once claimed, it's removed from other agents' inboxes." |
| **Verification** | "Your progress is saved automatically — if the call drops, you can resume from where you left off." |

### (b) A/B variants of one screen — pick one and discard the rest
Several screens exist in two or three near-identical versions differing in one detail:

| Screen | The difference | Take |
|---|---|---|
| Lead workspace | Header button reads "Add lead" vs "New lead" | **"Add lead"** |
| Callback calendar | Reschedule is orange vs white | **White.** Complete is the primary outcome |
| Inbound transfers | Age column shows `68m`, `68m`, then `68` | **`68`** — Age is years, wait time is minutes (see below) |
| Partner pipeline / submit lead | Dates anchored 2024 vs 2026 | **2026** |
| Partner settings / messages | Two different shells | see § 3 |
| Daily deal flow | **Three header concepts A/B/C** for the date range | **C** — one combined range control |

**The Age/wait-time iteration is worth understanding, not just resolving.** Three passes were spent
on it because `68m` in an Age column next to `9m` in a Wait column is genuinely ambiguous. The final
answer — Age as a bare number, wait time always carrying its unit — is recorded in
[`02-AGENT-APP.md` § 3](02-AGENT-APP.md).

### (c) Screens for routes that do not exist — **do not implement from these**

**Eleven LA-3 screens.** There is no LA-3 module: no route, no component, no API, no menu entry, no
feature key. These are a future product, not a redesign:

Applications (list) · Application detail · Underwriting interview · Quote capture ·
Pre-submission QA · Requirements · Sales performance · Sales settings · Underwriting templates ·
Quotation templates · Disclosure library · Carrier field sets and maps · Carrier portal register

Several are genuinely strong — the carrier portal register opens with "Your credentials are never
stored in INSURVAS", and the field-mapping screen carries "Never guess. Only map when confident /
Fill, never submit." Keep them for when LA-3 is scoped. **Building them now would add an entire
unbuilt module to a product that already has 24 unbuilt menu destinations.**

**Plus net-new agent screens with no route:** a **Policy detail** page (`/app/policies/[id]` does
not exist — only the list does), and a Partners sub-navigation (`Partner directory` /
`Partner performance` / `Partner quality`) that does not match the real menu.

### (d) Early explorations with invented navigation — ignore
The 2026-09-15 and early 09-16 batches predate alignment with the real IA. See § 3.

---

## 3. The navigation problem — read this before implementing any mockup

**The generated set contains more than twenty distinct sidebar structures.** Counting only the
agent app, the images variously show:

```
Dashboard · Leads · Policies · Clients · Tasks · Commissions · Reports · Agency Tools · Settings
Home · Inbound transfers · Leads · My clients · Policies · Quoting · Appointments · Documents · …
Home · Leads · Policies · Commission ledger · Appointments · Settings
Home · Daily deal flow · Prospects · Applications · Clients · Commissions · Resources · Settings
Dashboard · Contacts · Appointments · Policies · Carriers · Marketing · Reports · Settings
Home · Campaigns · Leads · Activity · Reports · Team · Settings
Home · Leads · Lead assignment · Agents · Licensing · Reports · Settings
Dashboard · Leads · Dialer · Deal flow · Policies · Callbacks · Contacts
Home · Leads · Inbound · My pipeline · Policies · Customers · Commissions · Analytics · Settings
Dashboard · Leads · Clients · Applications · Policies · Commissions · Reports · Library · Settings
Dashboard · Clients · Policies · Lapse risk · Renewals · Commissions · Reports · Messages · …
…and more than a dozen others
```

**None of these is the product's navigation.** The real IA is built by
`buildAgentMenu(effectiveFeatures, role)` from `lib/menu/definition.ts` and grouped by
`components/app/agent-sidebar.tsx` into:

```
Home
LA-1 · Inbound operations      [Enabled | Not included | Role restricted]
LA-2 · Outbound acquisition    [Enabled | Not included | Role restricted]
─────
Business  ▸ Book of Business · Leads · Sell · Retention · Insight · Partners · Accounting · Compliance
Partners
Settings
[Plan access card]
```

This is not cosmetic. The sidebar is **entitlement-aware** — it is enforcement point 1 of 3 — and a
flat seven-item nav cannot express "Not included" or "Role restricted" or the plan-access card. A
mockup's sidebar is scenery; the menu definition is the contract.

### The three images that get it right

The 2026-09-17 dark-mode trio is the only set matching the real IA — LA-1 and LA-2 module
disclosures, the Business group, and the Plan access card. **Take the sidebar from these and the
page content from whichever mockup is authoritative for that route.**

They are also the only dark-mode explorations in either collection, and dark mode is a shipped
feature (`ThemeToggle` sits in the sidebar footer). Everything else is light-only.

### The partner portal has the same problem, smaller
Three shells appear: a left sidebar (matches `partner-sidebar.tsx` — **correct**), a top
horizontal nav, and a top nav with a dark "Partner access · Active" strip above it. Use the
**sidebar**. The status strip is a good idea and already exists as the workspace bar inside the
real layout.

---

## 4. Other conflicts to resolve before implementing

**Logo.** At least seven marks appear: a plain `INSURVAS` wordmark, an orange diamond, an orange
`//`, an orange `▰`, a green shield, an orange shield, and an orange mountain glyph. The product
currently ships a `Building2` lucide icon in the sidebar and a plain wordmark on auth pages.
**Pick one mark and apply it everywhere** — this is a five-minute decision that removes a visible
inconsistency from every screen.

**Accent colour drift.** The disposition-wizard images use **blue** steppers and a blue selected
radio. Some lead-workspace cards use blue, purple and green stage dots. The rule is one accent:
`#ff5900`. Stage colours may be categorical, but interactive state is always orange.

**Date anchors.** Images variously use 2024, Apr 2025, and Sep 2026. The curated set's anchor is
2026-09-16. Use 2026 — a demo with 2024 dates reads as stale.

**The ledger mockup enables a button the product cannot support.** It shows **Import statement** and
**Ledger settings** as active controls. Carrier statement ingestion does not exist, and the live
page correctly renders those buttons `disabled` with the explanation "Carrier statement ingestion
is not available yet". **Implementing this mockup literally would ship an enabled button with no
backend.** See [`02-AGENT-APP.md` § 23](02-AGENT-APP.md).

**The dashboard mockup shows partial checklist progress** ("2 of 4 complete"). The live
`setupChecklistForState` deliberately reports only 0/5 or 5/5, because per-step completion is not
persisted and a fabricated 3/5 would be a lie. Do not implement the partial bar until per-step
timestamps exist. See defect **D-11**.

**Mockup eyebrows are the source of defect D-01.** Several generated images render their own file
index as the page eyebrow — `07 / LICENSED AGENT`, `09 / CONTACTS`, `10 / OPERATIONS`,
`11 / LICENSED AGENT`, `15 / RETENTION`, `19 / LICENSED AGENT`. **Six** of these strings were copied
verbatim into production code. **The eyebrow is the menu section, never a number** — and
`lib/design/contract.test.mjs` now enforces it, so a mockup implemented literally will fail the
build rather than ship.

---

## 5. Recommended working order

1. Read [`00-FOUNDATION.md`](00-FOUNDATION.md).
2. Find the route's entry in `01`–`04`.
3. Open the curated mockup named there, if one exists.
4. Take the **sidebar and shell** from the 2026-09-17 dark trio, never from the page mockup.
5. Take the **page content** from the mockup, minus anything in § 4 above.
6. Check the entry's **Controls** table against what the mockup shows. Where they disagree, the
   Controls table wins — it was extracted from source.
7. Check [`05-DEFECT-REGISTER.md`](05-DEFECT-REGISTER.md) for anything filed against that page.

**Where no mockup exists** — all of admin, most of public — design from the foundation. The Brex
spec in `brex.design.md` covers the marketing mode, and `00-FOUNDATION.md` § 5 gives the workspace
skeleton. Do not invent a new layout system for those pages; the product already has one.

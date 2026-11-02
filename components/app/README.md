# components/app

Screens and parts of the agent app (`/app/*`): workspaces, panels, forms, settings and the
sign-up funnel frames.

**Rules:** [UI-CONSISTENCY.md](../../docs/design/UI-CONSISTENCY.md) §2 header, §4/§4a figures,
§6/§6a lists and filters, §8 layout, §10 people and companies, §11 overlays, §12 status colours,
§14 numbers. The auth and sign-up frames here (`app-auth-frame.tsx`, `funnel-frame.tsx`,
`auth-card.tsx`, `tenant-auth-workspace.tsx`) follow §13.
**Visual reference:** [foundation-v3/mockup.html](../../docs/design/foundation-v3/mockup.html).

Use the shared parts in [`components/ui`](../ui/README.md): `PageHeader`, the stat card,
`TableCard` + `DataToolbar`, `DetailPanel`, `Dialog`, `Button`.

Do not: hand-roll a table, a KPI card, a pager, a filter row or a side panel; add avatars or
initials for clients, leads or carriers; put explanatory cards on a page.

## The agency dashboard (2026-11-02)

`agency/agency-dashboard.tsx` — `/app/agency`, owner, admin, manager and bookkeeper, on an
agency-typed plan. Redesigned 1–2 Nov; the reasoning is in
[`tasks/agency-dashboard-redesign/`](../../tasks/agency-dashboard-redesign/SPEC.md).

**It is the agency module's front door, not its analytics.** The depth already exists and is
good: [`book-scorecards.tsx`](book-scorecards.tsx) owns persistency, chargeback ratios and true
cost per sale; `/app/producer-scorecards` owns per-producer profitability; `/app/hierarchy` owns
overrides. This page answers one question — *which of my producers is making me money* — and
every figure on it is a door into the page that owns the detail. **Do not move book-scorecards
onto it**; a dashboard that tries to be the analytics makes both worse.

- **Four cards, chosen to answer that question**: Written, Your override, At risk, Needs you.
  Seats came off on 2 Nov — administrative, changes twice a year, and it was taking a quarter of
  the headline space; it is the quiet line under the title now with the agency's name.
- **The arithmetic is pure and lives in
  [`lib/agency/dashboardCore.ts`](../../lib/agency/dashboardCore.ts)** with its own tests —
  `periodChange`, `standing`, `moneySplit`. Change it there, never in the component. Every null
  `periodChange` returns is a case where a percentage would look like a fact and not be one
  (growth from zero, a sign flip, a comparison that has not arrived).
- **The previous period is a second, lazy read** of the same endpoint, started after first paint
  and never blocking the strip. A comparison that fails is silent: no pills, no banner.
- **No API change was needed.** `chargebackCents`, `leadSpendCents` and `m13` were already on the
  wire — the route returns `readDashboard` unchanged and the client simply had not typed them.
- **An agency with no producers hides the chart row**; an agency whose producers wrote nothing
  this month keeps it, because "nobody wrote anything" is the finding. `isNew` is that test.

Check a change on `/design/agency` (busy, quiet, empty, error; owner and manager) at 1536×826,
1366×657 and 375 wide. The entrance animation (`m-stagger`) stalls while the browser pane is
backgrounded, so a screenshot taken then catches it mid-fade and `innerText` returns nothing —
count elements or read computed styles instead of believing an empty-looking result.

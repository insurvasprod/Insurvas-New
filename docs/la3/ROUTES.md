# LA-3 routes

Every page and API route LA-3 adds or changes. Status: **approved** 2026-09-28. Extension grants
last **60 minutes** (decision 1).

Conventions, from the repo:

- **API guard:** `requireFeatureRole(featureKey, roles, { write })` from
  `lib/tenantAuth/requireFeatureRole.ts` (maintenance → kill switch → entitlement → read-only →
  role). Every route is registered in `lib/entitlements/agentApiPolicy.ts`.
- **Page guard:** `guardPage(featureKey)`, then `FeatureGateNotice` / `RoleGateNotice`.
- **Zod:** strict schemas in a shared `lib/<domain>/schemas.ts` (the pattern used by
  `lib/templates/schemas.ts` and `lib/carriers/schemas.ts`), not inline in the route.
- **Roles:** `SELL` = `owner, producer` (matches the Sell menu, and decision 5). `SETTINGS` =
  `owner`. Setters are refused by `start_application_from_lead` already.
- **Menu:** each new agent page is an item in `lib/menu/definition.ts`; flipping `built: true` on
  `sell.quoting`, `sell.applications`, `sell.draft-dates` makes the static route replace the
  `[section]` coming-soon screen.

---

## 1. Agent pages (`app/app/(shell)/…`)

| Route | Step | Flag | Roles | Menu | Status |
|---|---|---|---|---|---|
| `/app/applications` | 1 | `applications` | SELL | `sell.applications` → `built: true` | **new** |
| `/app/applications/[caseId]` | 1 → 22 | `applications` | SELL | (detail, no item) | **new** — the workspace |
| `/app/applications/[caseId]/quotes/print` | 6 | `quoting` | SELL | — | **new**, outside the shell, no motion classes |
| `/app/applications/[caseId]/copy-assist` | 13 | `applications` | SELL | — | **new**, pop-out window |
| `/app/quoting` | 6 | `quoting` | SELL | `sell.quoting` → `built: true` | **new** |
| `/app/draft-dates` | 8 | `draft_date_optimizer` | SELL | `sell.draft-dates` → `built: true` | **new** |
| `/app/pending` | 18 | `applications` | SELL | new item `sell.pending` "Pending cases" | **new** |
| `/app/sales-performance` | 24 | `sales_report` | owner, producer, bookkeeper | new item `insight.sales-performance` | **new** |
| `/app/settings` (Sales group) | 16 | per section | SETTINGS | existing | **adjust** — `lib/settings/sections.ts` gains a `Sales` group |
| `/app/leads/[id]` | 1, 15, 22 | existing | existing | existing | **adjust** — Start / Continue application, Case tab, Add spouse |
| `/app/dialer` | 1 | existing | existing | existing | **adjust** — "They are interested" lands on the workspace instead of `/app/leads/{id}` |
| `/app/inbound/[workItemId]/verification` | 1 | existing | existing | existing | **adjust** — "Continue to underwriting" |
| `/app/leads` (board) | 17 | existing | existing | existing | **adjust** — reconcile hint |
| `/app/dashboard` | 11, 18, 19 | existing | existing | existing | **adjust** — three cards, shown only when the flag is granted |
| `/app/deal-flow` | 11 | existing | existing | existing | **adjust** — row written from the attempt |
| `/app/appointments` | 4 | existing | existing | existing | **adjust** — upline, notes, writing number shown |
| `/app/policies` | 11, 15 | existing | existing | existing | **adjust** — application no. and policy no.; re-run draft date |
| `/app/callbacks`, `/app/calendar` | 18 | existing | existing | existing | **adjust** — requirement chases link back |

### Workspace steps (`/app/applications/[caseId]`)

One route; the step is a query param so the QA deep links work:
`?attempt=2&insured=primary&step=payment#pay.routing_number`.

| `step` | Task | Step it lands in |
|---|---|---|
| `verify` | reuses `VerificationPanel` (LA-1.11) | 1 |
| `interview` | 3.2 (+ 3.3 panel later) | 3 |
| `quote` | 3.4, 3.5, 3.6 strip | 5, 6, 4 |
| `application` | 3.7 | 1 |
| `beneficiaries` | 3.8 | 7 |
| `payment` | 3.19 + 3.9 | 1, 8 |
| `disclosures` | 3.10 | 9 |
| `review` | 3.11 | 10 |
| `submit` | 3.12 button, 3.14, 3.15 modal, 3.20 status, 3.22 Open portal | 11–14, 20, 21 |
| `after` | 3.18, 3.26, outcome | 15, 18, 19 |
| `timeline` | 3.16 | 15 |

---

## 2. Agent API (`app/api/app/…`)

| Method + route | Step | Zod schema (`lib/applications/schemas.ts` unless noted) | Flag | Roles | Write |
|---|---|---|---|---|---|
| `POST /applications/start` | 1 | `startApplicationSchema {work_item_id, product_line?}` | `applications` | SELL | yes |
| `GET /applications` | 1 | `listApplicationsQuery {status?, carrier_id?, missing_reference?, cursor?}` | `applications` | SELL | no |
| `GET /applications/[caseId]` | 1 | — (path uuid) | `applications` | SELL | no |
| `PATCH /applications/[id]/values` | 1 | `patchValuesSchema {values: [{field_key, value}]}` — rejects sensitive keys | `applications` | SELL | yes |
| `PUT /applications/[id]/sensitive` | 1 | `putSensitiveSchema {field_key, value}` | `applications` | SELL | yes |
| `POST /applications/[id]/reveal` | 1 | `revealFieldSchema {field_key}` | `applications` | **owner, producer** (decision 5) | no |
| `PUT /applications/[id]/payment` | 1 | `paymentMethodSchema` (discriminated union on `method`, no CVV key — `.strict()`) | `applications` | SELL | yes |
| `POST /applications/[id]/transition` | 1, 10, 15 | `transitionSchema {to, outcome?, reason_code?, reason_text?}` | `applications` | SELL | yes |
| `GET/PUT /applications/interview/[caseId]` | 3 | `lib/underwriting/schemas.ts` `interviewAnswersSchema` | `applications` | SELL | yes |
| `PUT /applications/interview/[caseId]/medications` | 3 | `medicationsSchema` | `applications` | SELL | yes |
| `GET /medications/suggest?q=` | 3 | `medicationSuggestQuery` | `applications` | SELL | no |
| `GET/POST /quotes` , `PATCH /quotes/[id]` | 6 | `lib/quotes/schemas.ts` `quoteSchema`, `quoteStatusSchema` | `quoting` | SELL | yes |
| `POST /quotes/[id]/select` | 6 | — | `quoting` | SELL | yes |
| `GET /quotes/payout?case_id=` | 4 | `payoutQuery` | `quoting` | SELL | no |
| `PUT /applications/[id]/beneficiaries` | 7 | `beneficiariesSchema` | `applications` | SELL | yes |
| `POST /draft-dates/recommend` | 8 | `lib/draftDates/schemas.ts` `recommendSchema` | `draft_date_optimizer` | SELL | no |
| `PUT /applications/[id]/draft-day` | 8 | `draftDaySchema {day, override_reason?}` | `draft_date_optimizer` | SELL | yes |
| `PATCH /applications/[id]/disclosures/[disclosureId]` | 9 | `disclosureAckSchema` | `applications` | SELL | yes |
| `GET /applications/[id]/qa` | 10 | — | `applications` | SELL | no |
| `POST /applications/[id]/submissions` | 11 | `submissionSchema` | `applications` | SELL | yes |
| `POST /applications/[id]/submissions/[sid]/confirmation` | 11 | multipart, mime + size checked | `applications` | SELL | yes |
| `GET /applications/[id]/submissions/[sid]/confirmation` | 11 | — returns a 60-second signed URL | `applications` | SELL | no |
| `PATCH /applications/[id]/submissions/[sid]` | 11 | `submissionReferenceSchema` (adds `policy_number`) | `applications` | SELL | yes |
| `POST /extension/grant` | 12 | `lib/extension/schemas.ts` `grantSchema {application_id, carrier_id}` | `carrier_extension` | SELL | yes |
| `POST /extension/grants/revoke` | 12 | `revokeSchema {grant_id? , all?}` | `carrier_extension` | SELL (all = owner) | yes |
| `GET /extension/fields` | 12 | bearer JWT, Origin must equal `carrier_origin` — no session | `carrier_extension` | token | no |
| `GET /extension/fields/[key]` | 12 | bearer JWT, one sensitive field, writes access log | `carrier_extension` | token | no |
| `PUT /applications/[id]/copy-ticks` | 13 | `copyTickSchema` | `applications` | SELL | yes |
| `GET/POST /field-maps`, `PATCH /field-maps/[id]`, `POST /field-maps/[id]/publish` | 14 | `lib/fieldMaps/schemas.ts` | `carrier_extension` | owner | yes |
| `POST /extension/map-miss` | 14 | bearer JWT, `mapMissSchema` | `carrier_extension` | token | yes |
| `POST /applications/[id]/next-attempt` | 15 | `nextAttemptSchema {quote_id?}` | `applications` | SELL | yes |
| `POST /applications/cases/[caseId]/close` | 15 | `closeCaseSchema {reason_code, reason_text?}` | `applications` | SELL | yes |
| `GET/PUT /settings/sales` | 16 | `lib/salesSettings/schema.ts` | `applications` | SETTINGS | yes |
| `GET/PUT /settings/sales/stage-map` | 17 | `stageMapSchema` | `applications` | SETTINGS | yes |
| `POST /leads/[id]/reconcile-stage` | 17 | — | `applications` | SELL | yes |
| `GET /pending`, `POST/PATCH /applications/[id]/requirements[/rid]`, `POST …/[rid]/chase` | 18 | `lib/requirements/schemas.ts` | `applications` | SELL | yes |
| `POST /applications/[id]/counteroffers`, `POST …/[cid]/respond` | 19 | `counterofferSchema`, `counterofferResponseSchema` | `applications` | SELL | yes |
| `GET /applications/[id]/welcome-pack`, `POST …/send` | 20 | `welcomePackSendSchema` | `applications` | SELL | yes |
| `GET/POST/PATCH /carrier-portals` | 21 | `lib/carrierPortals/schemas.ts` — no password key | `applications` | owner, producer | yes |
| `POST /applications/cases/[caseId]/spouse` | 22 | `addSpouseSchema` | `applications` | SELL | yes |
| `POST /applications/[id]/values/detach` | 22 | `detachSchema {field_key}` | `applications` | SELL | yes |
| `GET /reports/sales` (+ `?format=csv`) | 24 | `lib/salesReport/schemas.ts` `salesReportQuery` | `sales_report` | owner, producer, bookkeeper | no |
| `POST /ai/suggest` | 25 | **blocked on decision 4** | `ai_assistant` | SELL | — |

**Existing routes left exactly as they are:** `POST /outbound/application` and its
`reveal` (the dialer's current path, `outbound_dialing`), `/inbound/verification` and its
`reveal` (`inbound_transfers`, still allows `assistant`). `POST /applications/start` calls the
same `startApplicationFromLead` service, so there is one path into a case (rule: build it once);
the old outbound route is kept for compatibility and can be pointed at the same page in Step 1.

---

## 3. Admin pages (`app/admin/(protected)/…`)

Guarded like the existing admin pages; roles per `lib/templates/permissions.ts`
(`super_admin`, `platform_config`).

| Route | Step | Status | What changes |
|---|---|---|---|
| `/admin/products` | 5, 23 | **adjust** | carrier products: tiers, ages, faces, band, payment methods; term fields |
| `/admin/carriers` | 5 | **adjust** | portal origin, reference pattern, billing descriptor |
| `/admin/templates` | 2, 5 | **adjust** | `kind` filter; underwriting, quotation and application-field-set kinds |
| `/admin/state-disclosures` | 9 | **adjust** | second tab for application disclosures (separate table) |
| `/admin/features` | 1 | **adjust** | the three new flags appear from the catalog, no code change expected |
| `/admin/field-maps` | 14 | **new** | platform-default maps, review queue, needs-review list |

Admin API follows the existing admin routes under `app/api/admin/…` for each of the above.

---

## 4. Not a page

| Surface | Step |
|---|---|
| Browser extension package (`extension/`) — side panel: Fill, copy-assist, capture modal, Highlight on page | 26 |
| pg_cron: counteroffer expiry, requirement ageing, report refresh | 19, 18, 24 |

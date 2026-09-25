# 04 · Admin (`/admin/*`)

34 pages. Platform administration — the surface your staff use to run the SaaS.

Read [`00-FOUNDATION.md`](00-FOUNDATION.md) first.

> **No mockup exists for any page in this file.** The 44 curated mockups and the 96 generated
> images cover the agent app and partner portal only. Every page here is designed from the
> foundation. That makes this the largest block of genuinely new design work in the project.

---

## The admin identity

Admin is **blue** — `:root` tokens, `--color-blue` `#0070cc`, navy `--brand-800` sidebar. It is not
a portal root and gets none of the orange tokens. This is deliberate: the operator surface and the
customer product should not be mistaken for one another, least of all in a screenshot.

Everything in `00-FOUNDATION.md` applies except the accent colour. The single-primary-action rule,
the six states, the table system, the type scale and the accessibility floor are unchanged. Where
the foundation says `--portal-primary`, read `--color-blue`; where it says `--portal-group`, read
`--color-row-bg`.

## The page pattern — every admin page uses it

```tsx
const admin = await getCurrentAdmin();
if (!admin) redirect("/admin/login");
if (!<permission>(admin.role)) redirect("/admin");
const data = await fetch…();
return (
  <div className="mx-auto max-w-6xl space-y-6">
    <AdminPageHeader title="…" subtitle="…" />
    <SomeTable initial…={data} />
  </div>
);
```

**A role that cannot open a page never sees a link to it** — `buildAdminNav` omits it. A visible
link to a 403 is worse than no link. Keep that invariant: if you add a page, add its nav entry
behind the same permission the page checks.

## Roles

`super_admin` · `billing_admin` · `support_agent`, plus per-section access via
`canAccessConfigurationSection`. Notable boundaries, all deliberate:

- A `support_agent` cannot open **any** invoice screen.
- Live payment-provider credentials are `super_admin` only — a `billing_admin` sees Invoices and
  Coupons but not Setup.
- Naming a feature and switching it off for every paying customer **do not share a permission**:
  `canToggle` on `/admin/features` is `super_admin` only.
- A refund above the threshold needs a second admin, and you cannot approve one you raised.
- `/admin/audit-log` shows a non-super-admin **only their own actions**, and the subtitle changes
  to say so.

## Sidebar labels intentionally differ from page headings

Documented in `lib/adminNav/build.ts`. The route keeps its original name so links survive; the label
and heading say what the screen is for.

| Route | Nav label & heading |
|---|---|
| `/admin/compliance-sources` | Compliance |
| `/admin/payments` | Setup |
| `/admin/system` | Maintenance |

Keep both. Do not "fix" the mismatch by renaming routes.

## Fix across this whole surface

**D-02, Sev A — internal ticket IDs in customer-visible copy.** Five instances, all in this file's
pages. Replacements are given inline below.

**D-19, Sev B — `ConfigurationPlaceholder` ships internal language.** It currently renders
"Section reserved for {owner}", "will be implemented by its ticket", and "without changing the
Configuration Center shell" — referencing a hub the code comments say has been removed. Rewrite it
as an operator-facing notice: what the section will control, that the permission boundary is
already enforced, and no ticket vocabulary. Used by `/admin/email` today.

---

# Authentication

## 1. Admin sign-in — `/admin/login`

**File:** `app/admin/login/page.tsx` (150)
**Gate:** none
**Data:** `POST /api/admin/auth/login`, `POST /api/admin/auth/verify-2fa`

**Purpose:** get platform staff in, with a second factor.

### Must do
- Email + password, then a **2FA step** as a distinct state — not a field revealed on the same
  form. The two requests are separate and the UI should mirror that.
- One generic failure message. Never reveal whether the address exists or which factor failed.
- On success → `/admin`.
- Cross-link to `/app/login`, for the same reason the partner portal has one.
- This page must keep working during maintenance — staff need in while customers are out.

### Controls
| Control | Destination / effect |
|---|---|
| Sign in | `POST /api/admin/auth/login` → 2FA step |
| Verify | `POST /api/admin/auth/verify-2fa` → `/admin` |
| Back to agent sign-in | `/app/login` |

### Layout
Centred card, `max-w-md`, on `--color-page-bg`. Title "Insurvas Super Admin" — deliberately not
the customer wordmark; staff should be able to tell at a glance which door they are at. No split
shell, no marketing story panel. This is a utility screen.

2FA step: replace the form, keep the heading, show the address being verified, a single code input
(`inputMode="numeric"`, `autocomplete="one-time-code"`), and a way back.

### Must not
- Reveal which factor failed.
- Offer "remember this device" without a real implementation.
- Share visual identity with the customer login so closely that a screenshot is ambiguous.

---

# Dashboard

## 2. Admin dashboard — `/admin`

**File:** `app/admin/(protected)/page.tsx` (150)
**Gate:** any admin
**Data:** `admin_users` (role, is_active)

**Purpose:** orient a staff member and route them into the right workspace.

### Fix first — D-02
Subtitle is `"Super admin foundation — SA-0.1."`
→ **"Platform administration. Start with the workspace you need below."**

### Must do
- Four tiles: total admins, active, your role, last login (or "First login").
- Admins by role, as counted badges.
- **"Start here"** — the three-step orientation, as `<details>` disclosures, first one open:
  1. Establish who and what is active → Tenants, Users
  2. Configure what customers can buy → Plans, Features, Products
  3. Verify changes and platform health → Audit log, Maintenance, Compliance

  This is the most useful thing on the page — it teaches the order of operations to someone who
  opens the admin panel twice a month. Keep it, and keep it above the fold.

### Controls
| Control | Destination |
|---|---|
| Tenants / Users | `/admin/tenants`, `/admin/users` |
| Plans / Features / Products | `/admin/plans`, `/admin/features`, `/admin/products` |
| Audit log / Maintenance / Compliance | `/admin/audit-log`, `/admin/system`, `/admin/compliance-sources` |

### Layout
`max-w-5xl`. Four stat cards, then role badges, then the Start-here card. Links inside the
disclosures are blue link-arrow rows.

**Consider promoting genuine platform health** into the tiles — tenants, active subscriptions,
failed logins today, mismatched invoices — since counting admins is the least useful fact available
and every one of those numbers already exists on another page.

### Must not
- Show a metric this page cannot load.
- Ship a ticket ID (D-02).
- Turn the orientation disclosures into a carousel.

---

# Customers

## 3. Tenants — `/admin/tenants`

**File:** `app/admin/(protected)/tenants/page.tsx` (39) · `components/admin/tenants-table.tsx` (179)
**Gate:** `canViewTenants`
**Data:** `tenants` + owner join; `GET /api/admin/tenants`

**Purpose:** every customer account on the platform.

### Fix first — D-02
Subtitle is `"Every customer account on the platform. Suspend/reactivate and billing land in later tickets."`
→ **"Every customer account on the platform, with its owner, plan and onboarding state."**

### Must do
- Table: name, status, plan code, onboarding state, created, suspended-at, owner (name + email).
- Row → `/admin/tenants/<id>`.
- Search and status filter.
- Create tenant (`CreateTenantDialog`).
- Suspended tenants are visibly distinct and keep their `suspended_at` visible.

### Layout
`max-w-6xl`. Status is a chip; onboarding state is a second, quieter chip — they are different
axes and must not look like one field. Owner renders as name over email in one cell.

### Must not
- Delete a tenant.
- Hide suspended tenants by default without saying the filter is on.
- Show a plan code where a plan name is available.

---

## 4. Tenant detail — `/admin/tenants/[id]`

**File:** `app/admin/(protected)/tenants/[id]/page.tsx` (156) · `SubscriptionPanel` (540), `TenantUsagePanel` (120), `AddonsPanel` (167)
**Gate:** `canViewTenants`

**Purpose:** everything about one customer, and the actions available on them.

### Must do
- Header: name, status, created, owner; Back to tenants.
- **Subscription panel** — current plan and version, cycle, status, queued changes. Assign a plan,
  Change plan (with apply-now vs at-renewal), Cancel. Every one of these moves money; each needs a
  confirm step naming the effective date.
- Usage panel against plan limits.
- Add-ons attached.
- Tenant users.

### Layout
`max-w-6xl`. Header strip, then subscription as the first and widest card — it is why anyone opens
this page. Usage as a set of meters where the limit is always shown beside the usage; a bar without
its denominator is decoration.

Queued changes get their own block stating what changes and when. "Cancel" is the only destructive
control here and is `variant="outline"` with a danger-tinted confirm, never a red button in the
header.

### Must not
- Change a plan without stating the effective date and the proration.
- Show a limit meter without its limit.
- Let Assign and Change look like the same action.

---

## 5. Users — `/admin/users`

**File:** `app/admin/(protected)/users/page.tsx` (47) · `components/admin/users-table.tsx` (546)
**Gate:** `canViewUsers`; **create is `super_admin` only** (`canCreate`)
**Data:** `fetchUsersPage`, `fetchUserStats`, `fetchPlanCodes`, tenants, plans; `GET /api/admin/users`, `GET /api/admin/users/stats`, `POST /api/admin/users/:id/{activate,deactivate,suspend,unsuspend,resend-invite,send-reset}`

**Purpose:** every user across every tenant.

### Fix first — D-02
Subtitle is `"Every user on the platform, across all tenants. Editing and lifecycle actions land in SA-1.2 – 1.4."`
→ **"Every user across every tenant. Search, filter, and manage account status."**
(The lifecycle actions it says are pending are implemented — the copy is also simply wrong.)

### Must do
- Stat strip from `/api/admin/users/stats`.
- Server-side paginated table with filters (tenant, plan, status, role) and search.
- Row → `/admin/users/<id>`.
- Lifecycle actions: activate, deactivate, suspend, unsuspend — each `POST` to its own endpoint,
  each with a confirm.
- **Suspend requires a reason** (`SuspendUserDialog`), and the placeholder shows the expected
  shape: "Non-payment — invoice INV-2026-08-0412 unpaid 45 days". Keep that quality of example; it
  teaches the standard.
- Resend invite → "New invitation issued for <email>".
- Send reset → "Password reset link issued for <email>".
- **The reset flow issues a link; it never displays a password.** `InviteLinkPanel` shows the link
  with a Done action. Never render a credential.
- Create user, `super_admin` only.

### Layout
`max-w-7xl`. Stat strip, filter bar, dense table. One primary row action (View) plus `⋯` for
lifecycle. Status chips distinguish invited / active / suspended / deactivated — four states need
four visibly different chips, not three colours and a shrug.

### Must not
- Display or email a password.
- Suspend without a reason.
- Show create to a non-super-admin.
- Paginate client-side — `fetchUsersPage` is server-side and the dataset is platform-wide.

---

## 6. User detail — `/admin/users/[id]`

**File:** `app/admin/(protected)/users/[id]/page.tsx` (58) · `UserDetailSummary` (94), `LoginActivityTable` (89)
**Gate:** `canViewUsers`

**Purpose:** one user, their tenant membership, and their sign-in history.

### Must do
- Summary: name, email, status, role, tenant, created, last login.
- Login activity for this user.
- The same lifecycle actions as § 5, with the same confirmations.
- Back to users.

### Layout
`max-w-5xl`. Summary card, then login activity table. Failed attempts visibly distinct from
successes — this page is opened during an incident.

### Must not
- Show another tenant's data alongside.
- Offer an action the list page does not.

---

# Billing

## 7. Billing workspace — `/admin/billing`

**File:** `app/admin/(protected)/billing/page.tsx` (41) · `BillingTabs` (39)
**Gate:** `canViewInvoices`

**Purpose:** one door into the four billing screens.

### Must do
- `BillingTabs` across the top — the shared nav for Invoices, Coupons, Refunds & credits, Revenue.
  It also appears on each of those pages; keep it consistent.
- Four destination cards with one line each.

### Layout
`max-w-6xl`, `sm:grid-cols-2`. Cards are link-arrow cards: title, one line, "Open <x> →", hover
border in `--color-blue`.

### Must not
Become a dashboard. It is a hub; the numbers live on the pages it links to. If it grows metrics,
merge it into `/admin/invoices` instead of duplicating them.

---

## 8. Subscriptions — `/admin/subscriptions`

**File:** `app/admin/(protected)/subscriptions/page.tsx` (29) · `SubscriptionsTable` (164)
**Gate:** `canManageSubscriptions`

**Purpose:** who is on what, and what is queued to change.

### Must do
- Table: tenant, plan + version, cycle, status, current period, queued change.
- Filter by status and plan.
- **Assign and cancel are deliberately not here** — the subtitle says so: "Assign and cancel from a
  tenant's page." Keep that. A destructive money action belongs next to the customer it affects,
  not in a list where the wrong row is one mis-click away.

### Layout
`max-w-6xl`. Plan renders as name + version chip — version matters, because existing subscribers
stay on their version when a plan is re-published. A queued change gets its own column with the
effective date, not a footnote.

### Must not
- Add assign/cancel to this table.
- Hide the plan version.
- Show a cancelled subscription as active because the period has not ended — those are different
  facts and both belong.

---

## 9. Trials — `/admin/trials`

**File:** `app/admin/(protected)/trials/page.tsx` (90) · `TrialsTable` (211)
**Gate:** `canManageSubscriptions`

**Purpose:** trials in flight, and what separates the ones that convert.

### Must do
- Trial list with tenant, plan, started, ends, days remaining, activation signals.
- **"What separates the trials that convert"** — keep this analysis block. It is the difference
  between a list and a tool.
- Sort by days remaining by default; a trial ending tomorrow is the actionable row.

### Layout
`max-w-7xl`. Days-remaining is the hero column: `tabular-nums`, warning-tinted under 3 days.
Activation signals as small state chips (imported leads · invited team · connected carrier) so the
reason a trial is stalling is legible without opening the tenant.

### Must not
- Show a trial that has already converted without marking it.
- Present the conversion analysis without its sample size.

---

## 10. Invoices — `/admin/invoices`

**File:** `app/admin/(protected)/invoices/page.tsx` (72) · `InvoicesTable` (184), `CustomInvoiceDialog` (174)
**Gate:** `canViewInvoices` — **a `support_agent` cannot open this at all**

**Purpose:** what we billed, and whether it matches what was charged.

### Must do
- Four tiles: invoiced this month, collected this month, **mismatched**, overdue.
- **The mismatched tile carries a hint and an alert state.** The page's own comment explains why it
  is the important one: outstanding and overdue are structurally near-zero because the provider
  collects before we hear, so "we billed a different amount to the one the customer was charged" is
  the number that actually carries information. Design the tile accordingly — it is the page's
  headline, not the third of four.
- Invoice table with status filter and tenant filter.
- Row → `/admin/invoices/<id>`.
- Raise a custom invoice.

### Layout
`max-w-7xl`. Put Mismatched first or make it visually dominant when non-zero: alert border, the
hint as a caption, and a filter link into the mismatched rows. Money right-aligned,
`tabular-nums`.

### Must not
- Present all four tiles with equal weight when one of them is the signal.
- Render a money value without its currency.
- Let a `support_agent` reach this page.

---

## 11. Invoice detail — `/admin/invoices/[id]`

**File:** `app/admin/(protected)/invoices/[id]/page.tsx` (254) · `MarkPaidDialog` (113), `VoidInvoiceDialog` (104), `RefundDialog` (153)
**Gate:** `canViewInvoices`

**Purpose:** one invoice, its lines, and what the provider says happened.

### Must do
- Header: number, tenant, status, dates, totals.
- Line items.
- **Provider activity** — the record of what the provider reported. When our number and theirs
  disagree, this is where the disagreement is visible.
- Mark paid (with amount and reference — the placeholder `FT26081400123` shows the expected shape).
- Void, with reason.
- Refund → raises a credit note (§ 13), which may need a second approver.
- Print view link.

### The pattern to copy — `VoidInvoiceDialog`
When voiding is not allowed, the button is `disabled` **and the refusal reason is printed directly
beneath it**. That is the correct treatment for every unavailable action in this product; it is
cited in `00-FOUNDATION.md` and in defect **D-12**. Preserve it exactly.

### Layout
`max-w-5xl`. Header strip, line-item table, totals right-aligned, provider activity as a timeline.
Actions in the header, one primary at most; void and refund are outline with danger-tinted
confirms.

### Must not
- Allow an edit to an issued invoice. Void and re-raise.
- Hide the provider's version when it disagrees with ours.
- Make refund a one-click action.

---

## 12. Invoice print — `/admin/invoices/[id]/print`

**File:** `app/admin/(protected)/invoices/[id]/print/page.tsx` (129)
**Gate:** `canViewInvoices`

**Purpose:** a clean printable/PDF-able invoice.

### Must do
- Its own minimal chrome: no sidebar, no nav. The `data-print-hide` attribute already exists on
  shell elements — use it.
- Everything a document needs: issuer, tenant, number, dates, lines, totals, payment terms.
- A visible Back link that does not print.
- `@media print`: no backgrounds, black on white, no shadows, sensible page breaks, no orphaned
  table headers.

### Layout
`max-w-3xl`, document proportions, serif-free. "Insurvas" as the `h1` — this is the one page where
the wordmark is the document header rather than navigation.

### Must not
- Inherit the admin sidebar.
- Use a token colour that prints as grey mush.
- Paginate a table across a page break without repeating the header.

---

## 13. Refunds & credits — `/admin/credit-notes`

**File:** `app/admin/(protected)/credit-notes/page.tsx` (84) · `CreditNotesTable` (163)
**Gate:** `canViewInvoices`

**Purpose:** refunds, their approvals, and what the provider actually did.

**The best-designed page in the admin surface.** Three conditional alert cards, each explaining a
distinct money-state and what to do. Treat it as the reference for every other operational page.

### Must do
Keep all three alert cards, with their reasoning intact:

1. **Pending approval** — "No money moves until a second admin approves. You cannot approve one you
   raised yourself."
2. **Failed at the provider** — "The credit note is kept in `failed` so the attempt is on record.
   Investigate before retrying — the money may or may not have moved."
3. **Awaiting local reconciliation** — "The provider may already have accepted the refund. Retry
   reconciliation to check the same idempotent request; do not raise a second credit note."

That third card prevents a double refund. It is worth more than the rest of the page.

- Subtitle states the approval threshold from settings, not a literal.
- Table with status and reconciliation state as **two separate columns** — they are different
  facts.
- `currentAdminId` enforces the self-approval block in the UI as well as the API.

### Layout
`max-w-7xl`. Alert cards stack above the table, only when non-zero, in the order above (approval
first — it is the one a human must act on). Each has a border tint matching severity and a filter
link into the matching rows.

### Must not
- Collapse status and reconciliation state into one column.
- Let an admin approve their own request.
- Drop any of the three cards to save space.
- Retry a provider call without the idempotency warning.

---

## 14. Coupons — `/admin/coupons`

**File:** `app/admin/(protected)/coupons/page.tsx` (25) · `CouponsTable` (292)
**Gate:** `canManageCoupons`

**Purpose:** price breaks that apply **at the payment provider**, so the customer is actually
charged less.

That subtitle is doing real work — it distinguishes a coupon from a local discount display. Keep it.

### Must do
- Table: code, discount, restrictions, redemptions used / max, expiry, status.
- Create and edit, with `WELCOME50`-style placeholders.
- Plan restrictions.
- Redemption cap; `∞` for unlimited (the placeholder already does this).
- Deactivate rather than delete where redemptions exist.
- `BillingTabs`.

### Layout
`max-w-7xl`. Code in monospace. Redemptions as `used / max` in one cell, with a bar only when a cap
exists. Expired and exhausted coupons are visibly spent but not hidden — they are history.

### Must not
- Delete a redeemed coupon.
- Show a discount without saying whether it is percentage or fixed.
- Let an expiry be set in the past without a warning.

---

## 15. Offers & discounts — `/admin/offers`

**File:** `app/admin/(protected)/offers/page.tsx` (30) · `OffersTable` (307)
**Gate:** `canAccessConfigurationSection(role, "offers")`

**Purpose:** the campaign layer over coupons — promotions and automatic discount rules.

Filed beside Coupons on purpose: same subject, different permission.

### Must do
- Offer list with rule, target (plan or subscription), window, cap, status.
- Create and edit with plan and subscription pickers; cancelled subscriptions are excluded from the
  picker already — keep that filter.
- Maximum redemptions.
- Make the relationship to coupons explicit in the UI, since the two pages are adjacent and easily
  confused.

### Layout
`max-w-7xl`. Active window as a date range in one cell. An offer that is scheduled but not yet live
gets a distinct chip from one that is running — "scheduled" and "active" are the two states an
operator most needs to tell apart at a glance.

### Must not
- Let an offer and a coupon silently stack without showing the combined effect.
- Target a cancelled subscription.

---

## 16. Credits & limits — `/admin/credits-limits`

**File:** `app/admin/(protected)/credits-limits/page.tsx` (29) · `CreditLimitsPanel` (266)
**Gate:** `canAccessConfigurationSection(role, "credits-limits")`

**Purpose:** credit packs, default limits, meters, and who is about to exceed one.

### Must do
- Credit packs with pricing; add a pack.
- Default limits per meter, `Unlimited` as a real value (the placeholder already shows it).
- **Usage monitor** — tenants approaching or over a limit. This is the part with operational value;
  the rest is configuration.
- Grant credits to a tenant, with a reason.

### Layout
`max-w-7xl`. Usage monitor **first** — configuration is read rarely, the monitor is read often.
Rows sorted by proximity to limit, with a bar showing usage against limit and the overage called
out. Packs and defaults below.

### Must not
- Show a usage bar without its limit.
- Grant credits without a recorded reason.
- Bury the monitor under the configuration.

---

## 17. Revenue — `/admin/revenue`

**File:** `app/admin/(protected)/revenue/page.tsx` (208) — all inline
**Gate:** `canViewInvoices`

**Purpose:** contracted revenue, collections, churn and plan mix.

### Must do
- **MRR movement** — new, expansion, contraction, churn, net. A waterfall, and every component
  labelled; a single MRR number without its movement is not management information.
- **Customers & churn.**
- **Activation funnel · last 90 days** — keep the window in the heading. A funnel without its
  window is meaningless.
- Plan mix.
- Every figure derived from real data. This page will be screenshotted into a board deck; a
  fabricated number here is the most expensive kind.

### Layout
`max-w-7xl`. Three labelled sections (`h2` each), as today. Charts single-series where possible,
blue, restrained — no chart junk, no 3D, no dual axes. Every chart states its period and its
source metric.

### Must not
- Show a percentage without its base.
- Mix ARR and MRR in one view without labelling both.
- Present a funnel stage whose definition is not stated somewhere on the page.

---

## 18. Payment setup — `/admin/payments`

**File:** `app/admin/(protected)/payments/page.tsx` (26) · `PaymentStatusPanel` (166), `PaymentProviderPanel` (220), `BillingModePanel` (70)
**Gate:** `canAccessConfigurationSection(role, "payments")` — **stricter than the rest of Billing; live credentials are `super_admin`**

**Purpose:** payment provider, mode, keys, and payment health.

### Must do
- Provider status and health.
- Provider selection and configuration.
- Billing mode (test vs live) — **the single most dangerous control in the admin surface.** It must
  be unmistakable which mode is active, everywhere, and switching it must require explicit
  confirmation naming the consequence.
- **Never render a secret.** Show presence, last four, and last-updated. There is a
  `Visa •••• 4242` placeholder in the provider panel showing the intended treatment.
- Test connection (`POST /api/admin/payments/test-connection`) with a clear pass/fail.

### Layout
`max-w-5xl`. Status panel first, with a prominent **mode banner** — test mode gets a persistent
warning-tinted strip across the top of the page. Keys are masked rows with a "Last updated" caption
and a Replace action; there is no reveal.

### Must not
- Display a secret key, ever, even partially beyond last-four.
- Let the mode switch be a plain toggle without confirmation.
- Show test-mode data without the mode banner visible.

---

# Catalog

## 19. Plans — `/admin/plans`

**File:** `app/admin/(protected)/plans/page.tsx` (29) · `PlansTable` (274), `PlanDialog` (204)
**Gate:** `canManagePlans`
**Data:** `GET /api/admin/plans`, `POST /api/admin/plans/:id/new-version`, `DELETE /api/admin/plans/:id`

**Purpose:** what the business sells.

### Fix first — D-02, two instances
Subtitle is `"What the business sells. Pricing lands in SA-2.4 and the feature picker in SA-2.3."`
→ **"What the business sells. Each plan is versioned; existing subscribers keep the version they bought."**
(Both promised things exist — `PlanVersionEditor` edits pricing and grants features.)

Also `components/admin/plan-dialog.tsx:190`: "Public plans appear on the pricing page (SA-5.1)."
→ **"Public plans appear on the pricing page."**

### Must do
- Table: name, code, version, type, price, public flag, archived.
- New plan; edit → `/admin/plans/<id>/edit`.
- **Publish a new version**, with the guarantee stated in the toast and before the action:
  "v{n} published — existing subscribers stay on v{previous}". Versioning is the whole model and
  the UI must make it impossible to publish one by accident.
- Show/hide archived.
- Delete only where no subscriber exists.

### Layout
`max-w-7xl`. Version as a chip beside the name. Archived rows dimmed and behind the toggle, with
the toggle's state obvious. "New version" is a distinct, confirmed action — never adjacent to
"Save" in the same visual weight.

### Must not
- Mutate a published version. Publish a new one.
- Delete a plan with subscribers.
- Let "Save" and "Publish new version" look alike.

---

## 20. Plan version editor — `/admin/plans/[id]/edit`

**File:** `app/admin/(protected)/plans/[id]/edit/page.tsx` (47) · `PlanVersionEditor` (372)
**Gate:** `canManagePlans`
**Data:** `PUT/POST /api/admin/plans/:id/version`

**Purpose:** compose a plan version — price, limits, features.

### Must do
- Three sections, as today: **Pricing**, **Capacity limits**, **Agent will see**.
- Pricing per cycle; a null price means that cycle is not sold (`Not offered` placeholder) — zero is
  a price, and a free plan is still buyable. Do not conflate them.
- Capacity limits (publishers, marketing partners, affiliates, buffer seats, …).
- Feature grants grouped by module, toggled per group.
- **"Agent will see"** — a live preview of the resulting menu. This is the feature that makes the
  page trustworthy: it shows the consequence of a grant in the product's own vocabulary.
- Save (draft) vs **Publish** as two clearly different actions, and publish states the subscriber
  count: "Published v{n} — the {count} existing subscriber(s) keep v{previous}".

### Layout
`max-w-7xl`. Two columns: editor left, "Agent will see" preview right, sticky. The preview mirrors
the agent sidebar's grouping so the operator sees what the customer will see.

Subscriber count appears **next to the publish button**, not only in the toast — the number of
people affected belongs beside the button that affects them.

### Must not
- Publish without stating the subscriber count first.
- Treat a null price as zero.
- Let the preview drift from `buildAgentMenu` — it must call the same function.

---

## 21. Add-ons — `/admin/addons`

**File:** `app/admin/(protected)/addons/page.tsx` (36) · `AddonsTable` (127), `AddonDialog` (189)
**Gate:** `canManagePlans` — add-ons are priced product, so they follow the plan rule

**Purpose:** extras sold on top of a plan, granting features and credits through the same
entitlement path.

### Must do
- Table: name, code, price, granted features, granted meters, attachable plans.
- Create/edit with feature and meter pickers (archived features excluded).
- Meter quantities.
- Make the entitlement path explicit — an add-on grants exactly as a plan does, and an operator
  debugging "why does this tenant have X" needs to see both sources.

### Layout
`max-w-6xl`. Granted features and meters as chip lists, truncated with a count. Price formatted with
currency.

### Must not
- Offer an archived feature.
- Hide which plans an add-on can attach to.

---

## 22. Features — `/admin/features`

**File:** `app/admin/(protected)/features/page.tsx` (60) · `FeaturesSection` (97), `FeatureCatalog` (248), `FeatureSwitchesPanel` (265), `FeatureDialog` (158)
**Gate:** `canAccessConfigurationSection(role, "features")`; **`canToggle` is `super_admin` only**

**Purpose:** everything a subscription can switch on, and the switches that turn one off for
everyone.

One route, two tabs — this replaced two separate Features screens that were free to drift.

### Must do
- **Catalog tab:** features grouped by module, searchable, filterable, with archive/restore and
  create.
- **Switches tab:** a kill switch per non-archived feature, with a customer-visible notice and an
  internal reason. The placeholders show the intended quality: *"Dialing is unavailable while we
  switch DNC providers."* and *"DNC vendor outage, incident #412"*. Keep both fields — one is what
  the customer reads, one is what the next admin reads.
- Archived features are excluded from switches: a kill switch on an already-unavailable feature is
  a control that changes nothing.
- **`canToggle` is separate from catalog access.** Naming a feature and taking it away from every
  paying customer are not the same act. A non-super-admin sees the switches read-only.
- An active kill switch must be unmissable — on this page and in the admin shell.

### Layout
`max-w-7xl`. Tabs. Catalog as module-grouped sections. Switches as rows: feature, module, state,
notice, reason, save. **A live kill switch gets a warning-tinted row and a count at the top of the
page** — "2 features are switched off platform-wide" is something an admin must see without
scrolling.

### Must not
- Let a switch be flipped without a customer-visible notice.
- Show switches as editable to a non-super-admin.
- Archive a feature that a live plan grants without warning.

---

## 23. Products — `/admin/products`

**File:** `app/admin/(protected)/products/page.tsx` (24) · `ProductsTable` (75), `ProductDialog` (97)
**Gate:** `canAccessConfigurationSection(role, "products")`

**Purpose:** the insurance product catalog shared by the platform.

### Must do
- Table: name, code, category, description, sort order, archived.
- Create/edit; code immutable after creation (already enforced via `disabled`).
- Archive/restore rather than delete.
- Sort order is meaningful — it drives presentation downstream. Make it editable and visible.

### Layout
`max-w-6xl`. Code in monospace. Archived shown with a chip, dimmed. `⋯` for Edit / Archive /
Restore.

### Must not
- Change a product code after creation.
- Delete a product referenced by a template or a partner approval.

---

## 24. Carriers — `/admin/carriers`

**File:** `app/admin/(protected)/carriers/page.tsx` (16) · `CarriersTable` (21), `CarrierDialog` (38)
**Gate:** `canAccessConfigurationSection(role, "carriers")`

**Purpose:** the platform carrier library agents use to configure their contracts.

The smallest components in the admin surface (21 and 38 lines) — this screen has room to grow.

### Must do
- Table: code, name, active, sort order, created, updated.
- Create/edit; activate/deactivate.
- Make the downstream consequence visible: this library is what an agent picks from in
  `/app/settings` → Carrier library. Deactivating a carrier affects live tenants, so say so.

### Layout
`max-w-6xl`. Simple table. Consider adding a usage count per carrier ("in use by 12 tenants") —
without it, deactivation is a blind action.

### Must not
- Delete a carrier that tenants have appointments against.
- Deactivate without indicating the impact.

---

## 25. Templates — `/admin/templates`

**File:** `app/admin/(protected)/templates/page.tsx` (25) · `TemplatesTable` (67), `TemplateEditorDialog` (170)
**Gate:** `canAccessConfigurationSection(role, "templates")`

**Purpose:** lead fields, pipelines, application forms and reusable question sets, per product.

### Must do
- Table by product, with the template type and version.
- Editor for fields, stages and questions.
- Versioning, with the same guarantee as plans: **in-progress work keeps the version it started
  with.** State it in the UI.
- Products picker from the live catalog.

### Layout
`max-w-7xl`. Grouped by product. The editor is a dialog today; if it grows, promote it to a route —
a field/stage editor inside a modal becomes unusable past ~15 fields.

### Must not
- Change a published template in place.
- Remove a field a live pipeline depends on without a warning naming the dependents.

---

# Monitoring

## 26. Login activity — `/admin/activity`

**File:** `app/admin/(protected)/activity/page.tsx` (56) · `ActivityFeed` (91), `LoginActivityTable` (89)
**Gate:** `canViewUsers`

**Purpose:** every sign-in attempt across the platform, tenant users and admins alike.

### Must do
- Four tiles: logins today, logins this week, failed today, **"Signed in last 15 min"**.
- **Keep that fourth label exactly.** The code comment is explicit: it is "deliberately not called
  'online now' — we only know when someone logged in, not whether they're still using the app."
  That precision is the difference between a metric and a guess. Do not rename it.
- Paginated feed with outcome filter, actor filter, IP and user agent.
- Failed attempts visually distinct.

### Layout
`max-w-7xl`. Four tiles, then the feed. Failed rows get a danger-tinted left border, not a red
background — a wall of red is unreadable during the incident you built this for.

### Must not
- Rename the 15-minute tile to imply presence.
- Show a password or a token in the event detail.
- Default the filter to successes only.

---

## 27. Audit log — `/admin/audit-log`

**File:** `app/admin/(protected)/audit-log/page.tsx` (61) · `AuditLogTable` (247)
**Gate:** any admin — **but a non-super-admin sees only their own actions**

**Purpose:** every recorded admin action. Append-only.

### Must do
- **The subtitle changes with role**, and already does: super admin sees "Every recorded admin
  action, platform-wide. Append-only."; everyone else sees "Your own recorded actions.
  Append-only." Keep the difference — a support agent must not believe they are seeing everything.
- The actor filter renders only for `super_admin`; for everyone else it would be a control with one
  possible value.
- Table: timestamp, actor, action, target, reason, IP, user agent, metadata.
- Server-side pagination.
- **Append-only, and the UI must say so.** No edit, no delete, no exceptions.

### Layout
`max-w-6xl`. Dense, monospace for ids and IPs. Metadata behind a per-row expander — it is JSON and
must not widen the table. Timestamps absolute with a relative hint, never relative alone; an audit
trail reading "3 hours ago" is useless in a dispute.

### Must not
- Offer any mutation.
- Show another admin's actions to a non-super-admin.
- Use relative time as the only timestamp.

---

# Platform

## 28. Compliance — `/admin/compliance-sources`

**File:** `app/admin/(protected)/compliance-sources/page.tsx` (26) · `ComplianceVendorsTable` (90)
**Gate:** `canAccessConfigurationSection(role, "compliance-sources")`
**Nav label & heading:** "Compliance" (route keeps its name)

**Purpose:** TCPA and Do Not Call vendors, and their availability.

**The highest-stakes configuration page in the product.** `/api/app/dial/preflight` is
**fail-closed**: with no enabled DNC vendor it returns 503 `dnc_unavailable` and blocks dialing
platform-wide. What is configured here decides whether every tenant can make a call.

### Must do
- Vendor table: name, type (`dnc_scrub` and others), enabled, availability/health.
- Register and edit a vendor.
- Enable/disable.
- **State the consequence on the page**: with no enabled DNC vendor, dialing is blocked for
  everyone. An operator disabling the last one must be told before, not after.
- Show health, not just configuration. A vendor that is enabled but unreachable is the dangerous
  state, and it looks identical to a healthy one unless the page distinguishes them.

### Layout
`max-w-6xl`. A status banner at the top answering the only question that matters: **is dialing
currently possible?** Then the vendor table. Disabling the last enabled DNC vendor requires a
typed confirmation naming the effect.

### Must not
- Allow the last DNC vendor to be disabled without an explicit, consequence-naming confirmation.
- Present "enabled" as equivalent to "working".
- Store a vendor credential in a readable field.

---

## 29. Mail setup — `/admin/email`

**File:** `app/admin/(protected)/email/page.tsx` (27) · `ConfigurationPlaceholder` (25)
**Gate:** `canAccessConfigurationSection(role, "email")`
**Nav label & heading:** "Mail Setup"

**Purpose:** mail server, sender identity, templates — **not yet built.**

The page is honest: no provider or transport has been chosen, so it says so rather than showing a
form that saves settings nothing reads. That decision is correct and should stand.

### Fix first — D-19
`ConfigurationPlaceholder` currently renders internal language: "Section reserved for {owner}",
"will be implemented by its ticket", "without changing the Configuration Center shell" — the last
referencing a hub that has been removed.

Rewrite for an operator:
> **Mail setup is not configured yet.** No mail provider has been selected, so Insurvas does not
> send email from this environment. This screen will configure the mail server, sender identity and
> templates. Access is already restricted to the roles that will manage it.

### Must not
- Show a form that saves values nothing reads.
- Reference a ticket, an owner, or a removed hub.
- Imply email is working.

---

## 30. Maintenance — `/admin/system`

**File:** `app/admin/(protected)/system/page.tsx` (26) · `SystemSettingsPanel` (194)
**Gate:** `canAccessConfigurationSection(role, "system")`
**Nav label & heading:** "Maintenance"

**Purpose:** maintenance mode and platform announcements.

### Must do
- Three levels — off, `read_only`, `locked` — and **the difference must be unmistakable**, because
  they do very different things:
  - `read_only` — writes refused with `maintenance_read_only` (503); reading continues.
  - `locked` — the agent shell redirects every customer to `/maintenance`.
- Customer-visible message and optional scheduled end. Both surface to customers; label them as
  such.
- Announcements: create, schedule, target, expire. They render in the agent shell's
  `AnnouncementStrip`.
- **Enabling `locked` requires explicit confirmation naming the effect** — it signs every customer
  out of the product.
- Current state visible without scrolling, and echoed in the admin shell while active.

### Layout
`max-w-6xl`. Current-state banner first, colour-coded by level, with the message preview exactly as
a customer will see it. Level selector as three radio cards each describing its effect in a
sentence — not a dropdown. A dropdown makes "read only" and "locked" one keystroke apart.

### Must not
- Let `locked` be a single click.
- Save a maintenance message without previewing it.
- Hide the active state below the fold.

---

## 31. Advanced — `/admin/advanced`

**File:** `app/admin/(protected)/advanced/page.tsx` (33) · `SettingsForm` (189), `LoginProtectionPanel` (118)
**Gate:** `canAccessConfigurationSection(role, "advanced")`; login protection is `super_admin` only

**Purpose:** raw platform settings for values without a more specific home.

The canonical home for the settings store — `/admin/settings` redirects here.

### Must do
- Every setting with its key, value, **overridden vs default**, and last-updated.
- Reset-to-default per setting. An override you cannot undo is a trap.
- Login protection panel for `super_admin` (rate limits, lockouts).
- Say plainly that these are raw values and take effect immediately.

> **Uncommitted change to decide:** `SIGNUP_PER_IP.max` was changed from 5 to 10 and is not
> committed. Someone must decide before this ships. It is a real abuse-control threshold.

### Layout
`max-w-5xl`. Settings as rows: key (monospace), description, value input, DEFAULT/OVERRIDDEN chip,
reset. Group by area if the list grows past ~20. Login protection in its own bordered card, clearly
super-admin-only.

### Must not
- Present a raw key without a description.
- Let an override be indistinguishable from a default.
- Show login protection to a non-super-admin.

---

## 32. Admin users — `/admin/admins`

**File:** `app/admin/(protected)/admins/page.tsx` (25) · `AdminUsersTable` (235), `CreateAdminDialog` (174)
**Gate:** **`super_admin` only**

**Purpose:** create and manage platform staff accounts.

### Must do
- Table: email, name, role, active, last login, created.
- Create admin with a role.
- Activate/deactivate.
- **An admin cannot deactivate themselves** — `currentAdminId` is passed for exactly this. Enforce
  it in the UI and the API; locking the last super admin out of the platform is unrecoverable.
- Role changes are audited and must be confirmed.

### Layout
`max-w-6xl`. Role as a chip with its label from `ADMIN_ROLE_LABELS`. The current admin's own row is
marked "You" and its destructive actions are disabled with the reason.

### Must not
- Let an admin deactivate their own account.
- Allow the last active super admin to be deactivated.
- Display a password.

---

## 33. Legal — `/admin/legal`

**File:** `app/admin/(protected)/legal/page.tsx` (59) · `LegalScreen` (407)
**Gate:** any admin — **readable by every role on purpose:** an acceptance record is what a support
agent needs in a dispute

**Purpose:** author legal documents, publish versions, and look up who accepted what.

### Must do
- Document list by type, with versions.
- Markdown editor (`# Terms of Service` placeholder) with a change summary
  ("Clarified the refund policy and added a data retention period." — keep that quality of example).
- Draft vs published; a draft renders the draft warning on `/legal/[type]`.
- **Publish a new version — this is what forces every user through `/app/accept-terms`.** The UI
  must say so before publishing. It is the single action in the admin surface that interrupts every
  customer simultaneously.
- **Acceptance lookup by user** (the `user@example.com` placeholder), returning who accepted which
  version and when.
- Every published version stays retrievable at `/legal/<type>?v=<n>`.

### Layout
`max-w-7xl`. Two columns: document list and version history left, editor/preview right. Publish is
a confirmed action stating the consequence: "Every user will be required to accept this before
using the product." Acceptance lookup as its own card with a search field and a result table.

### Must not
- Edit a published version in place.
- Publish without the interruption warning.
- Delete a version anyone accepted.
- Restrict acceptance lookup to super admins — support needs it.

---

## 34. Settings alias — `/admin/settings`

**File:** `app/admin/(protected)/settings/page.tsx` (6)

`redirect("/admin/advanced")`. Not in the nav; exists so older links and bookmarks work.

### Must do
Stay a server redirect. Keep it if `/admin/advanced` is ever renamed.

### Must not
Render anything, or reappear in the nav — `Advanced` is the one canonical entry.

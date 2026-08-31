# Insurvas SA Bugs and Release Findings

Last reviewed: 2026-08-30  
Scope: SA-5.1 through SA-5.4, current repository, and live Supabase schema  
Status: Module 5 is feature-built, but it is not ready for public production traffic.

## Release blockers

### 1. ✅ FIXED 2026-08-30 — P0 — Checkout return URL grants access without Whop confirmation

**Resolution.** The return handler now asks Whop whether a membership exists for this tenant before granting anything (`lib/checkout/verify.ts`), failing closed on an unmapped plan, a provider outage or a malformed answer. The webhook remains the second signed path. The verification previously ASSERTED the unsafe behaviour, so it passed while the hole was open; it now asserts the opposite and separately proves a genuine customer still completes.

**Evidence**

- `app/app/checkout/return/page.tsx:17-35`
- `lib/checkout/complete.ts:35-78`
- `supabase/migrations/20260830030000_sa_5_2_checkout.sql:67-88`

A signed-in onboarding user can start a checkout and then visit `/app/checkout/return` directly. The return handler creates a trial subscription from the local plan selection without confirming that Whop checkout succeeded or that a payment method was captured.

The verification script currently visits the return URL directly and expects activation, so the passing test confirms this unsafe trust boundary.

**Required fix**

- Prefer signed `membership.activated`/payment webhooks as the authority that creates the subscription.
- Alternatively, query Whop from the return handler and verify the checkout or membership before granting access.
- While waiting for a webhook, show a processing screen and poll a server endpoint.
- Add a negative test proving direct navigation cannot activate a tenant.

### 2. ✅ FIXED 2026-08-30 — P1 — A validated coupon is not applied to Whop checkout

**Resolution, and a correction to the original diagnosis.** The required fix said "pass the corresponding whop_promo_code_id using Whop's supported checkout field". No such field exists: `POST /checkout_configurations` accepts no promo code, and `promoCode` is available only on Whop's embedded checkout element. The false promise was removed instead — the endpoint returns `mustEnterAtCheckout` and the UI tells the buyer to type the code, which works because the promo is created at Whop with the same string. A guaranteed discount requires moving to embedded checkout; recorded as a decision, not done quietly.

**Evidence**

- `lib/checkout/start.ts:110-167`
- `lib/payments/whop/provider.ts:48-70`

The checkout validates the coupon locally and includes `insurvas_coupon_id` as metadata, but the Whop checkout configuration receives no promo-code identifier. Metadata does not reduce the amount charged.

**Required fix**

- Pass the corresponding `whop_promo_code_id` using Whop's supported checkout field or flow.
- Confirm the discounted total using a real sandbox checkout.
- Add a test that inspects the provider request, not merely local coupon validation.

### 3. P1 — Signup and required legal acceptance are not atomic

**Evidence**

- `app/api/public/signup/route.ts:61-105`
- `lib/legal/acceptance.ts:21-45`

The user, tenant, owner membership, signup selection, and verification token are created before legal acceptance is recorded. If acceptance recording fails, the endpoint returns an error but leaves the account behind. A retry then fails because the email already exists.

`buildVerificationUrl()` also runs after account creation. Missing `NEXT_PUBLIC_APP_URL` can therefore cause another half-created-account failure.

**Required fix**

- Validate all required environment configuration before creating records.
- Move required legal acceptance into the `self_serve_signup` database transaction, or implement a safe compensating rollback.
- Add a failure-path test proving that an acceptance failure creates no user, tenant, or owner membership.

### 4. ✅ FIXED 2026-08-30 — P1 — Trial reminder emails are never delivered and failed delivery is treated as sent

**Resolution.** SA-4.11 part 1 wired the Google SMTP transport; the job now records the real delivery result and `email_log` carries the failure reason.

**Evidence**

- `scripts/send-trial-reminders.mjs:8-10`
- `scripts/send-trial-reminders.mjs:80-105`

The job logs reminder content, hardcodes `delivered = false`, and inserts the reminder row. The unique constraint then prevents the reminder from being attempted again for that trial end date.

**Required fix**

- Connect the real email transport.
- Record a reminder as sent only after delivery succeeds, or store attempts separately from successful delivery.
- Add retry limits and failure visibility.
- Verify day-10 and day-13 delivery end to end.

### 5. P1 — Trial actions can leave Whop and Supabase inconsistent

**Evidence**

- `lib/trials/actions.ts:45-80`
- `lib/trials/actions.ts:139-162`
- `lib/subscriptions/access.ts:40-52`

Extension and cancellation update Whop first and Supabase second. If Whop succeeds and the database operation fails, the two systems disagree.

Cancellation pauses the Whop membership but immediately marks the local subscription `cancelled`. Local access becomes `none`, while the provider membership remains paused rather than formally cancelled.

**Required fix**

- Define the exact cancellation outcome: immediate cancellation or cancel at period/trial end.
- Use the matching Whop operation and local status (`cancelling` when access should continue).
- Add reconciliation or compensation for provider-success/database-failure cases.
- Test extension and cancellation against a real Whop sandbox trial membership.

## Significant correctness issues

### 6. P2 — Trial duration is hardcoded to 14 days

**Evidence**

- `lib/checkout/constants.ts:9`
- `lib/payments/whop/planMapping.ts:91`
- `lib/checkout/complete.ts:62-68`

The pricing API reads `trial_days` from the selected plan, but Whop plan creation and local subscription creation always use `TRIAL_DAYS = 14`.

The live public plan currently also has 14 days, so there is no present mismatch. An admin changing the plan's trial duration could make the pricing page advertise one duration while checkout grants another.

**Required fix**

- Load `plan_prices.trial_days` for the selected plan version.
- Pass the same value to Whop and subscription creation.
- Include trial duration in Whop-plan drift checks.

### 7. P2 — Multiple open checkout sessions can accumulate

**Evidence**

- `lib/checkout/start.ts:117-162`
- `supabase/migrations/20260830030000_sa_5_2_checkout.sql:7-25`

Starting checkout with a coupon can create a new open session without abandoning an earlier session. There is no database constraint enforcing one open checkout per tenant. Later `.maybeSingle()` reads can fail once multiple rows exist, and an older full-price checkout may remain usable.

**Required fix**

- Add a partial unique index for one open checkout per tenant, or atomically abandon the previous open session.
- Handle query errors instead of treating them as no session.
- Test changing, removing, and reapplying a coupon during checkout.

## Existing incomplete Module 5 work

These items were already documented in `docs/backlog.md`:

- **#4:** no production email transport.
- **#8:** most browser verification remains incomplete.
- **#9:** no CI pipeline runs the checks automatically.
- **#29 / #56:** migration history and repository schema are incomplete or mismatched.
- **#50:** public-schema function privileges need a complete security audit.
- **#52:** setup-step completion is not recorded; trial reporting uses last login as a substitute.
- **#53:** provider-side trial extension/cancellation is unverified against a real membership.
- **#54:** Terms and Privacy Policy are draft copy and require legal review.
- **#55:** `verify:legal` permanently advances the DPA version sequence.

## Live Supabase observations

- The Module 5 tables and core RPC functions exist.
- Current live data has zero checkout sessions, business profiles, and trial subscriptions.
- Terms v1 and Privacy v1 are still marked as drafts.
- The legal verification process has created 25 DPA versions.
- Repository migration timestamps do not consistently match the versions recorded in `supabase_migrations.schema_migrations`.
- Supabase security advisors also report several `SECURITY DEFINER` functions callable by `anon` or `authenticated`. These originate outside Module 5 but are platform release blockers and overlap backlog #50.

## Verification completed during the review

- `npm test`: **168/168 passed**.
- `npx tsc --noEmit`: **passed**.
- `npm run lint`: **passed**.
- Clean `npm run build`: **passed**, producing 69 routes.
- The first build encountered a corrupted generated `.next/dev/types/routes.d.ts`; deleting only the generated `.next` cache and rebuilding resolved it.
- No Whop purchase or full browser signup journey was rerun during this review.

## Module 5 ticket assessment

| Ticket | Assessment |
| --- | --- |
| SA-5.1 | Pricing, signup, verification, business profile, disposable-email protection, and onboarding gates exist. Signup transaction hardening remains required. |
| SA-5.2 | Hosted Whop checkout and webhook integration exist. The return-page bypass and unapplied coupon block release. |
| SA-5.3 | Trial UI, statistics, reminders, and admin actions exist. Real setup progress, email delivery, and provider-side verification remain incomplete. |
| SA-5.4 | Versioned append-only legal acceptance is strong. Production launch remains blocked by draft legal copy and the non-atomic signup acceptance path. |

## Recommended repair order

1. Close the checkout return-page activation bypass.
2. Make signup plus required legal acceptance atomic.
3. Apply coupons to the actual Whop checkout and verify the charged amount.
4. Connect email delivery and correct reminder retry semantics.
5. Make trial extension and cancellation recoverable across Whop and Supabase.
6. Replace hardcoded trial duration with the selected plan value.
7. Enforce one open checkout per tenant.
8. Run the complete browser and Whop sandbox journey before merging or deploying Module 5.

---

# Module 3 Audit — Billing, Payments, and Revenue

Last reviewed: 2026-08-30  
Scope: SA-3.1 through SA-3.9, current repository, live Supabase schema, and read-only production data checks  
Status: Module 3 has substantial working foundations, but the billing ledger and revenue dashboard are not yet safe to treat as production-grade financial records.

The original dummy-provider language in the older tickets was treated as superseded by the product decision to use Whop. SA-3.5 is intentionally cancelled because Whop owns payment retries and dunning.

## Release blockers and correctness defects

### M3-1. P1 — A webhook can return HTTP 200 without being marked processed

**Evidence**

- `lib/payments/whop/store.ts:108-127`
- `app/api/webhooks/whop/route.ts:65-96`

`markProcessed()` and `markFailed()` await Supabase updates but never inspect their returned errors. If business processing succeeds and the `processed_at` update fails, the route still returns success to Whop. Whop then has no reason to retry, while the local event remains unfinished. Failure-attempt updates can be silently lost for the same reason.

**Required fix**

- Throw when either webhook-state update returns an error.
- Make attempt increments atomic in SQL.
- Add a failure-injection test proving a failed `processed_at` write returns a retryable response.

### M3-2. P1 — A successful Whop payment can be acknowledged without an invoice

**Evidence**

- `lib/invoices/generate.ts:41-80`
- `app/api/webhooks/whop/route.ts:71-89`

Invoice generation returns `null` when tenant resolution, payment ID, plan metadata, plan lookup, or price lookup is missing. The webhook handler treats that as success, continues subscription processing, marks the event processed, and returns HTTP 200. This is useful for dashboard test events, but unsafe for a real subscribed `payment.succeeded` event because collected money can disappear from the local invoice ledger.

**Required fix**

- Explicitly identify test events instead of treating every unresolved payment as normal.
- Quarantine or retry real payment events that cannot produce an invoice.
- Store a durable non-invoiced reason and alert billing operations.

### M3-3. P1 — Coupon usage and invoice creation are not one transaction

**Evidence**

- `lib/invoices/generate.ts:129-163`

The invoice RPC commits first. Coupon-period consumption runs afterward and its failure is only logged. On webhook retry, the idempotent invoice already exists, so `row.created` is false and the coupon is never consumed. A limited-period coupon can therefore remain active longer than intended.

**Required fix**

- Create the invoice and consume the coupon period in one database transaction/RPC.
- Make the idempotency key cover both effects.
- Add a test that fails coupon consumption once and proves retry reaches one correct final state.

### M3-4. P1 — Manual payment settlement is non-atomic and activates unrelated subscriptions

**Evidence**

- `app/api/admin/invoices/[id]/mark-paid/route.ts:46-108`

The invoice query does not load `subscription_id`. After settlement, the route activates every subscription belonging to the tenant, including when the custom invoice was intentionally unlinked. Payment insert, invoice settlement, subscription activation, entitlement refresh, and audit logging are separate operations, and several update errors are ignored. A partial failure can leave a recorded payment with an unpaid invoice; retrying with the same bank reference is then rejected.

The route also accepts more than the outstanding balance. The live database currently contains invoice `INV-2026-08-0001` with a total of 9,900 cents and successful payments of 19,800 cents. The extra 9,900 cents was not converted to tenant credit.

**Required fix**

- Move manual settlement into one database transaction.
- Activate only the invoice's linked subscription, and only when that link exists.
- Reject overpayment or intentionally convert the excess to an auditable credit balance.
- Return failures when invoice/subscription updates do not succeed.

### M3-5. P1 — Admin coupon application ignores plan and billing-cycle restrictions

**Evidence**

- `lib/coupons/service.ts:99-112`
- Live function `public.admin_apply_coupon`

The live RPC checks activity, expiry, redemption capacity, and whether another coupon is active. It does not check `restricted_to_plan_ids` or the coupon's `billing_cycle`. An admin can therefore attach a plan-specific or monthly-only coupon to an incompatible subscription. Current live data has no incompatible attachment, but the function permits one.

**Required fix**

- Enforce both restrictions inside `admin_apply_coupon` while locking the coupon and subscription rows.
- Return distinct failure codes for plan and cycle mismatches.
- Add RPC tests for allowed and rejected combinations.

### M3-6. P1 — Refund and credit execution can report a state that did not happen

**Evidence**

- `lib/credits/service.ts:194-249`
- `lib/credits/service.ts:306-315`

After Whop accepts a refund, the local update to `succeeded` is not checked. A successful money movement can therefore remain locally `processing` or later be marked `failed`. For account credit, the `adjust_tenant_credit` RPC error is ignored and the credit note is marked succeeded anyway. The future free-days path also calls Whop first and ignores failure when deducting the local balance, allowing repeat redemption after a partial failure.

**Required fix**

- Check every database result after an external money or membership change.
- Store a provider-success/local-reconciliation-required state instead of falsely reporting failure or success.
- Add a retry/reconciliation job keyed by the credit-note ID.
- Make credit deduction atomic and idempotent.

### M3-7. P1 — Rebuilding historical revenue rewrites history using current subscription state

**Evidence**

- Live function `public.compute_metrics_for_date`

The snapshot function asks whether a subscription's current `status` is active or trialing while computing an older date. A subscription that was active on a historical date but is cancelled today is excluded when that old date is rebuilt. A trial that later converted also disappears from its historical trial count. The function similarly uses the subscription's current plan and billing cycle, so plan changes can rewrite earlier MRR and plan mix.

**Required fix**

- Introduce an append-only subscription-status/plan timeline or derive metrics from dated billing events.
- Compute each date from state effective on that date, not columns holding today's state.
- Add historical tests for activation, conversion, upgrade, downgrade, and cancellation followed by rebuild.

### M3-8. P1 — The revenue reconciliation “gap” compares unrelated quantities

**Evidence**

- `app/admin/(protected)/revenue/page.tsx:33-41`

The dashboard subtracts new MRR from all cash collected in the last 30 days. Renewals are collected cash but are not new MRR, so a healthy recurring customer creates a false gap every month. Quarterly/yearly cash receipts further increase the distortion.

The same page still says provider checkout does not create a local subscription (`app/admin/(protected)/revenue/page.tsx:69-81`), although SA-5.2 added local subscription creation. That warning is now stale and can send an operator toward the wrong diagnosis.

**Required fix**

- Reconcile each provider payment to its invoice and expected charge, not to new MRR.
- Present contracted MRR movement separately from cash collection.
- Replace the stale checkout warning with concrete orphan-payment and missing-subscription counts.

## Important incomplete or unsafe behavior

### M3-9. P2 — “Every provider call is logged” is not true

**Evidence**

- `lib/payments/logging.ts:66-176`
- `lib/payments/registry.ts:21-35,81-89`
- Direct raw-provider use in `lib/coupons/service.ts`, `lib/invoices/custom.ts`, `lib/credits/service.ts`, `lib/payments/whop/planMapping.ts`, and `lib/checkout/start.ts`

The logging decorator covers only the shared `PaymentProvider` methods. Whop-specific operations such as plan creation, promo-code creation, custom invoice creation, refundability checks, pauses/resumes, and free-day grants use `buildProvider("whop")` directly and bypass it. Live `provider_calls` contains only three connection-test lookups and no real checkout, invoice, coupon, or refund operation.

**Required fix**

- Put all outbound Whop operations behind one logged client boundary.
- Store safe allowlisted request/response fields for every operation.
- Add tests that assert each public provider method creates exactly one log record.

### M3-10. P2 — Cross-tenant financial relationships are not enforced

**Evidence**

- `app/api/admin/invoices/custom/route.ts:10-48`
- Live functions `public.create_custom_invoice` and `public.request_credit_note`
- Live foreign-key definitions for `invoices` and `credit_notes`

The custom-invoice API accepts a tenant and any valid subscription ID; neither the route nor the RPC verifies that the subscription belongs to that tenant. Credit-note creation similarly does not prove that the invoice belongs to the supplied tenant. Independent foreign keys keep each ID valid but do not enforce the relationship between them.

Current live data has zero cross-tenant invoice, payment, or credit-note mismatches, so this is a permitted corruption path rather than an existing corruption.

**Required fix**

- Derive `tenant_id` from the selected subscription/invoice wherever possible.
- Otherwise reject mismatches inside the transaction.
- Add database tests that deliberately pass IDs from two tenants.

### M3-11. P2 — Free-day conversion always uses the monthly price

**Evidence**

- `lib/credits/service.ts:267-301`

The subscription query omits `billing_cycle`, and the price query always reads `price_monthly_cents`. Quarterly and yearly members can receive the wrong number of free days. The function is not yet wired into automatic credit consumption, but it must be corrected before that path is enabled.

**Required fix**

- Select the subscription billing cycle and use its matching price.
- Pin conversion behavior for monthly, quarterly, and yearly plans with tests.

### M3-12. P2 — The acquisition funnel uses obsolete proxies

**Evidence**

- `lib/metrics/queries.ts:70-115`

“Verified email” counts accepted admin invitations. SA-5.1 self-serve users verify through the verification flow and are therefore omitted. “Active at day 30” checks the subscription's status today for tenants older than 30 days, not its status on day 30. The profile and setup stages are still explicitly unmeasured.

**Required fix**

- Count the real verified-email timestamp/status used by self-serve signup.
- Measure day-30 state from an event history or dated snapshot.
- Feed business-profile completion and setup-step completion into the funnel.

## Previously known Module 3 gaps

The following remain tracked in `docs/backlog.md` and were confirmed by this review:

- **#4:** invoice receipts, reminders, and other operational email are not delivered.
- **#8:** browser-level billing verification is incomplete.
- **#9:** no CI pipeline runs billing checks automatically.
- **#38:** invoice immutability is incomplete because invoice rows can still be deleted.
- **#39:** tenant/date invoice filters exist in the API but not in the invoice-list UI.
- **#42 / #43:** there is no coupon-attachment UI, and applying a coupon to an existing Whop membership is unverified.
- **#44:** add-ons, overages, proration, and waivers do not automatically create invoice lines.
- **#45 / #49:** a real Whop refund has not been verified, and failed refunds do not alert an operator.
- **#46:** tenant credits are not automatically applied to future billing.
- **#48:** the revenue dashboard's two-second target at 500 tenants is unverified.
- **#50:** public-schema RPC execution privileges require a complete security hardening pass.
- **#51:** expansion/contraction and parts of the acquisition funnel are not measured.
- **#56:** most Module 3 schema and functions exist only in the live database; the repository does not contain a complete reproducible migration history.

## Live Supabase observations

- Five Whop webhook records exist: three `payment.succeeded` and two `membership.activated`; all are marked processed with no recorded processing error.
- Two invoices exist and both are paid, unlinked to a subscription, and retained after test cleanup.
- One invoice is reconciled as mismatched.
- One invoice is overpaid by 9,900 cents: total 9,900, successful payments 19,800.
- There are currently zero subscriptions, zero cross-tenant financial relationships, zero incompatible active coupon attachments, and zero credit notes stuck in `processing`.
- Fifteen daily metric snapshots exist for 2026-08-16 through 2026-08-30. The latest snapshot records 44,700 cents collected while MRR and active customers are zero.
- `provider_calls` contains only three `GET /payments/pmt_connection_test_does_not_exist` records.
- `tenant_credits` does have a non-negative balance constraint. The risk is ignored RPC failure and split external/local operations, not an absent balance constraint.

## Verification completed during this review

- Read every SA-3 ticket in the Notion “Insurvas Sprint” database.
- `npm test`: **169/169 passed**.
- `npx tsc --noEmit`: **passed**.
- `npm run lint`: **passed**.
- Live Supabase checks were read-only; this audit created, changed, or deleted no production rows.
- A full build was not rerun because the standing workflow batches builds rather than repeating them for review-only work.
- No real Whop purchase, refund, custom-invoice payment, browser journey, or email delivery was performed during this audit.

## Module 3 ticket assessment

| Ticket | Notion status | Audit assessment |
| --- | --- | --- |
| [SA-3.1](https://app.notion.com/p/a5e75c44dafd83d79cbd01f8394ccb4d) | Completed | Whop adapter and signed webhook foundation exist. The “every provider call logged” criterion is not met, and webhook final-state writes are not durable. |
| [SA-3.2](https://app.notion.com/p/ef075c44dafd836fbc5a01758549f201) | Completed | Idempotent payment-based invoices and reconciliation exist. Real payments can still be acknowledged without an invoice; add-on/overage lines and receipt email remain absent. |
| [SA-3.3](https://app.notion.com/p/f5675c44dafd82d2be0001a7c845c942) | Completed | Invoice list/detail and payment history exist. UI filtering, immutability, and production browser verification remain incomplete. |
| [SA-3.4](https://app.notion.com/p/75075c44dafd83e5a46b015b0479caba) | Completed | Provider-event state mapping and manual settlement exist. Manual settlement is non-atomic and activates by tenant instead of linked invoice subscription; proration remains unwired. |
| [SA-3.5](https://app.notion.com/p/31275c44dafd82eaa79e01aeae79bd76) | Cancelled | Intentionally not built because Whop owns retries and dunning. This is a product decision, not a defect. |
| [SA-3.6](https://app.notion.com/p/35875c44dafd82b795d20151ae3b6552) | Completed | Coupon catalog and local application exist. Admin application does not enforce plan/cycle restrictions, provider-side existing-membership application is unverified, and period consumption is not atomic with invoicing. |
| [SA-3.7](https://app.notion.com/p/cb375c44dafd82cc9621810397848fe3) | Completed | Custom invoice creation and optional Whop pay link exist. Cross-tenant subscription linking is permitted, provider state persistence is unchecked, and overdue email delivery is absent. |
| [SA-3.8](https://app.notion.com/p/3c875c44dafd810998ddfd5295e59102) | Completed | Approval rules, refundability checks, and credit notes exist. Real refunds are unverified; external/local failure recovery and automatic credit consumption are incomplete. |
| [SA-3.9](https://app.notion.com/p/3c875c44dafd8161b362ca0397211a4b) | Completed | Daily snapshots and dashboard UI exist. Historical rebuilds are mutable, the reconciliation gap is invalid, expansion/contraction is absent, and funnel metrics are stale. |

## Recommended Module 3 repair order

1. Make webhook completion durable and quarantine paid events that cannot produce invoices.
2. Replace manual payment settlement with one transactional RPC; repair the existing overpaid invoice explicitly.
3. Make invoice creation and coupon-period consumption atomic, and enforce coupon plan/cycle restrictions.
4. Add recoverable refund/credit state transitions and reconcile external provider success separately from local persistence.
5. Introduce subscription history and rebuild revenue snapshots from state effective on each date.
6. Replace the invalid cash-versus-new-MRR gap and stale revenue warning.
7. Route every Whop operation through one logged provider boundary.
8. Enforce cross-tenant financial relationships in database transactions.
9. Complete add-on, overage, proration, credit, invoice-email, filter, and funnel wiring already tracked in the backlog.
10. Run a full Whop sandbox and browser matrix before treating Module 3 as release-ready.

---

# Module 2 Audit — Catalog, Plans, Subscriptions, Metering, and Entitlements

Last reviewed: 2026-08-30  
Scope: SA-2.1 through SA-2.8, current repository, live Supabase schema/functions, and read-only production data checks  
Status: The core data model is thoughtful and most happy paths exist, but several server-side bypasses and versioning defects can silently grant unlimited or stale access.

## Release blockers and correctness defects

### M2-1. P1 — Publishing a plan version drops limits, meters, and available add-ons

**Evidence**

- Live function `public.admin_create_plan_version`
- Live function `public.admin_save_plan_version`

When a live plan is edited, the new version copies the plan row, feature grants, and prices. It does not copy `plan_limits`, `plan_meters`, or `plan_available_addons`. The save function then replaces only features and prices. Future subscribers assigned to the new version therefore lose the one-seat limit, all metered allowances, and the add-ons the previous version offered.

Existing subscribers correctly remain grandfathered on the old version, but the newly published version is incomplete and effectively much less restricted.

**Required fix**

- Copy every version-owned relation inside `admin_create_plan_version`.
- Add a database test comparing features, prices, limits, meters, and available add-ons before and after a version bump.
- Backfill any already-created versions before allowing assignment.

### M2-2. P1 — Entitlement rebuild failure is deliberately reported as success

**Evidence**

- `lib/entitlements/rebuild.ts:24-55`
- Callers in the plan, subscription, add-on, checkout, trial, and provider-event paths

`rebuildEntitlement()` catches refresh failure, logs it, and resolves successfully. Admin routes then return success even though the cached entitlement may still grant removed features or deny newly purchased ones. This directly contradicts the SA-2.7 requirement that assignment rebuild entitlement before the API returns and the SA-2.8 one-second update requirement.

This is also a security issue: a downgrade, suspension, cancellation, or add-on removal can commit while the old access remains cached.

**Required fix**

- Make the subscription mutation and entitlement refresh one transaction where possible.
- Otherwise return a reconciliation-required response and enqueue a durable retry instead of silently succeeding.
- Alert when cache version/computed time lags the source subscription state.

### M2-3. P1 — Add-on meter credits are ignored by enforcement and the usage screen

**Evidence**

- Live function `public.resolve_tenant_entitlement`
- Live function `public.check_meter_capacity`
- `lib/metering/queries.ts:67-118`

The entitlement resolver correctly stacks plan and add-on meter credits. Capacity enforcement reads only `plan_meters`, so a plan with 1,000 minutes plus a 500-minute add-on is still blocked at 1,000. If the meter exists only on the add-on, enforcement returns `not_metered` and treats it as unlimited rather than enforcing the add-on allowance. The tenant usage panel also builds rows only from plan meters, so add-on credits are not visible there.

**Required fix**

- Make `check_meter_capacity` consume the same merged allowance returned by the entitlement resolver.
- Make the usage screen read the merged meter set.
- Add tests for plan-only, add-on-only, stacked, unlimited, and detached-add-on cases.

### M2-4. P1 — An add-on can be detached through the wrong subscription URL

**Evidence**

- `app/api/admin/subscriptions/[id]/addons/route.ts:90-128`
- Live function `public.admin_detach_addon`

The route loads subscription A from the URL but passes only the attachment ID to the RPC. The RPC detaches whichever row owns that ID without checking its subscription. A request to subscription A can therefore detach an add-on from subscription B, audit the action against A, and rebuild A's entitlement. Subscription B keeps a stale cache containing the removed feature or credits.

**Required fix**

- Pass and verify both subscription ID and attachment ID in the RPC.
- Return the affected tenant from the transaction and rebuild that tenant only.
- Add a two-tenant negative test.

### M2-5. P1 — Crafted subscription actions can revive cancelled or suspended access

**Evidence**

- `app/api/admin/subscriptions/[id]/route.ts:20-157`
- Live functions `public.admin_change_subscription_plan` and `public.admin_cancel_subscription`

The UI hides actions that do not make sense, but the server does not enforce the transition graph. `resume` directly sets any subscription to `active`; it can revive a cancelled or suspended subscription. `pause` can rewrite a cancelled subscription to paused. A non-immediate cancel can turn an already-cancelled row into `cancelling`, which restores full entitlement until rollover. Plan changes also do not reject cancelled subscriptions.

**Required fix**

- Put allowed state transitions in one locked database function.
- Require an explicit recovery/reactivation action rather than using `resume` as a universal status setter.
- Add negative API tests for every invalid transition.

### M2-6. P1 — Archived plans remain assignable through crafted API calls

**Evidence**

- `app/api/admin/subscriptions/route.ts:33-72`
- `app/api/admin/subscriptions/[id]/route.ts:42-83`
- Live functions `public.admin_assign_subscription` and `public.admin_change_subscription_plan`

The picker hides archived plans, but neither assignment nor plan-change RPC checks `plans.is_archived`. An authorized admin or compromised admin session can submit an archived plan ID directly and create or queue a subscription on a product the business retired.

**Required fix**

- Reject archived target plans inside both locked RPCs.
- Re-check the target version and offered cycle in the same transaction.
- Add direct API tests instead of relying on picker behavior.

### M2-7. P1 — A newly created individual plan has unlimited seats and no meter configuration path

**Evidence**

- `app/api/admin/plans/route.ts:24-61`
- No write route or editor for `plan_limits` or `plan_meters`
- `components/admin/tenant-usage-panel.tsx`

Creating an individual plan inserts only the `plans` row. The ticket says an individual plan always has one seat, but no `plan_limits` row is created. The UI has no control for limits or meter allowances, so a new plan remains unlimited until someone edits Supabase manually. This also means the “create plans without a deploy” workflow is incomplete for any plan that should meter usage.

**Required fix**

- Create `max_seats = 1` atomically for every individual plan.
- Add limits and meter allowances to the version editor and version-save transaction.
- Validate that sellable plans have an intentional limit/meter configuration.

## Important incomplete or unsafe behavior

### M2-8. P2 — Meter enforcement fails open for no subscription and unconfigured meters

**Evidence**

- Live function `public.check_meter_capacity`
- `lib/metering/enforce.ts:16-86`

The capacity function returns `allowed = true` when the tenant has no subscription and when the selected plan has no row for the meter. A feature guard may prevent some calls, but metering itself is not a safe authorization boundary. In addition, `consumeMeter` performs capacity check and usage recording as separate statements, so concurrent requests can overshoot a hard cap; this second issue is already backlog #23.

**Required fix**

- Return denied for no subscription.
- Decide explicitly whether a missing allowance means unlimited or configuration error; do not infer unlimited silently.
- Combine strict-cap check and record in one transaction when a hard cap must be exact.

### M2-9. P2 — “Add a feature without a deploy” is not true with the current architecture

**Evidence**

- `app/api/admin/features/route.ts:22-73`
- `lib/menu/definition.ts`
- `scripts/check-feature-keys.mjs`

The admin can insert a new feature row, but the agent menu and `requireFeature()` calls are static source code. The new feature has no menu node, no route, and no guard until a deploy; `check:features` immediately reports drift/failure for the menu. The catalog operation works, but the product capability does not.

**Required fix**

- Clarify the requirement: either adding only catalog metadata is deploy-free, or navigation/route metadata must also become data-driven.
- Prevent assigning a feature that has no implemented route/guard, or mark catalog entries as `implemented` separately from `active`.

### M2-10. P2 — The exact-plan entitlement verifier derives its expectation from the system under test

**Evidence**

- `scripts/verify-entitlements.mjs:35-80`

The script labels its test “exact feature list,” but reads the expected list from `plan_features` and checks that the entitlement resolver returns the same rows. It cannot detect that Plan B is missing a required feature or includes the wrong one. It also does not assert that all three seeded plans were found, so a missing plan can reduce the loop without failing.

**Required fix**

- Pin explicit expected feature arrays for Plan A, B, and C in a reviewed fixture.
- Assert exactly three expected plan codes and versions exist.
- Keep a separate resolver-consistency test for database-to-entitlement wiring.

### M2-11. P2 — Cached entitlement usage becomes stale after every usage event

**Evidence**

- Live function `public.refresh_tenant_entitlement`
- Live function `public.record_usage`
- `lib/entitlements/get.ts:14-43`

The cached entitlement embeds each meter's `used` quantity. Recording usage updates `usage_totals` but does not refresh or invalidate `tenant_entitlements`; normal reads continue returning the stale JSON until some unrelated plan, add-on, subscription, or period event rebuilds it. Server-side capacity checks use live totals, so blocking remains correct for plan meters, but agent-facing usage from the entitlement object is stale.

**Required fix**

- Either remove volatile usage from the cached entitlement and query it separately, or atomically update/invalidate the cached meter after recording usage.

### M2-12. P2 — Plan creation and deletion rely on UI-only product-family rules

**Evidence**

- `lib/plans/constants.ts:23-27`
- `lib/plans/schemas.ts:5-13`
- `app/api/admin/plans/[id]/route.ts:78-126`

The UI disables agency and management types, but the POST schema accepts all four types, allowing unbuilt plan types through a crafted request. Deletion checks only whether the selected version has a subscription; a newer, unsubscribed version can be deleted even when an older version of the same plan code has historical subscribers, despite the ticket's “ever had a subscriber” archive rule.

**Required fix**

- Enforce currently buildable plan types on the server.
- Treat delete/archive policy at the plan-family (`code`) level, not only one version row.

## Previously known Module 2 gaps

The following remain tracked in `docs/backlog.md` and were confirmed:

- **#6:** the Users list still reads the obsolete `tenants.plan_code` instead of the subscription plan.
- **#20:** removing an archived feature requires temporarily unarchiving it.
- **#22:** no real agent feature currently consumes a meter.
- **#23:** hard-cap check and usage recording are not atomic.
- **#24:** billing-period rollover exists but has no scheduler.
- **#26:** the add-on catalog UI is read-only; CRUD is not implemented.
- **#27 / #44:** add-on pricing does not produce invoice lines.
- **#28:** API guard coverage is only 2 of 27 feature keys.
- **#29 / #56:** the Module 2 schema is not reproducible from repository migrations.
- **#50:** control-plane RPCs still grant execution to `PUBLIC`, `anon`, and `authenticated`.

## Live Supabase observations

- The catalog contains 27 active features, exactly matching the 27 static menu keys.
- Three plan families exist—Plan A, B, and C—all at version 1 and all typed `individual`.
- Their feature counts are 3, 8, and 15. All currently have `max_seats = 1` and six configured meters.
- Four active add-ons exist. Plan A offers none; Plans B and C each offer all four.
- There are currently zero subscriptions, active add-on attachments, usage events, usage totals, or entitlement cache rows.
- Because no subscription or usage data exists now, the audit could verify schema behavior and current catalog consistency but not production-state grandfathering or meter totals.
- Current rows have no archived-plan subscription, incompatible cycle, invalid add-on attachment, or usage-total drift.

## Verification completed during this review

- Read all eight SA-2 tickets in the Notion “Insurvas Sprint” database.
- `npm run check:features`: catalog/menu consistency passed; guard coverage reported **2/27 (7%)** as TODO.
- Inspected live functions, constraints, indexes, ACLs, catalog rows, plan configuration, and consistency counts through read-only SQL.
- No Supabase rows were created, changed, or deleted.
- The mutating integration scripts were inspected but not rerun against production.
- The full unit/static suite will be run once after the Module 1 audit; no repeated full build was run.

## Module 2 ticket assessment

| Ticket | Notion status | Audit assessment |
| --- | --- | --- |
| [SA-2.1](https://app.notion.com/p/c2b75c44dafd8220925101cb74600e19) | Completed | Catalog CRUD, grouping, archive behavior, and menu consistency exist. Deploy-free implementation of a genuinely new feature is not achieved, and guard coverage remains 2/27. |
| [SA-2.2](https://app.notion.com/p/92675c44dafd83279130015e930f12fe) | Completed | Plan CRUD and row-per-version grandfathering exist. Version creation drops limits/meters/add-ons, archived assignment is possible, and family-level deletion/buildable-type rules are UI-only. |
| [SA-2.3](https://app.notion.com/p/23875c44dafd82078e39813ff4969741) | Completed | Picker, module grouping, affected count, zero-feature rejection, and shared menu preview exist. Cache-refresh failures can leave the actual agent result stale. |
| [SA-2.4](https://app.notion.com/p/98d75c44dafd82b3819e014f5fe38874) | Completed | Integer-cent multi-cycle pricing and versioned grandfathering exist. Limits/meters are not copied with price-triggered versions, and server-side archived-plan checks are absent. |
| [SA-2.5](https://app.notion.com/p/6db75c44dafd8226a7840163ad949330) | Completed | Event idempotency, append-only intent, totals rebuild, period-aware rows, and hard-cap logic exist. New-plan configuration, fail-open cases, atomic consumption, and real callers remain incomplete. |
| [SA-2.6](https://app.notion.com/p/7f575c44dafd836e8cb081c1e8a2acdb) | Completed | Attach/detach and entitlement feature union exist. CRUD is read-only, detach is cross-subscription unsafe, meter credits are not enforced/displayed correctly, and invoice lines are absent. |
| [SA-2.7](https://app.notion.com/p/6f275c44dafd82b0a69601ddac089042) | Completed | Assignment, immediate/queued change, cancel, pause/resume, list filters, and audit calls exist. Invalid state transitions and archived plans can bypass the UI, and entitlement refresh success is not guaranteed. |
| [SA-2.8](https://app.notion.com/p/40175c44dafd8200acf101c2705cae51) | Completed | Shared menu, route/API guards, cached resolver, add-on union, read-only access, and upgrade prompt exist. Only 2/27 APIs are guarded, refresh failures are swallowed, add-on metering diverges from the resolver, and the exact-list verifier is not actually pinned. |

## Recommended Module 2 repair order

1. Fix plan-version cloning to include limits, meters, and available add-ons.
2. Make entitlement refresh transactional or durably retryable; never silently acknowledge stale access.
3. Make add-on meter enforcement and usage display use the same merged allowance as entitlements.
4. Lock subscription state transitions and reject archived plan assignment/change server-side.
5. Bind add-on detach to the subscription and tenant named by the route.
6. Add limits/meter editing and atomically seed the one-seat rule for individual plans.
7. Define fail-closed meter semantics and make strict hard-cap consumption atomic.
8. Replace the self-derived entitlement expectation with reviewed Plan A/B/C fixtures.
9. Resolve the deploy-free feature-catalog contradiction and complete API guard coverage as agent features ship.
10. Run the full subscription/add-on/meter browser and staging integration matrix before release.

# Module 1 Audit — Users, Roles, Lifecycle, Invitations, and Login Activity

**Reviewed:** 2026-08-30  
**Sources:** [SA-1.1](https://app.notion.com/p/3a075c44dafd8391aaf501803087a0d0), [SA-1.2](https://app.notion.com/p/be975c44dafd83019e5c813da32e390d), [SA-1.3](https://app.notion.com/p/fc875c44dafd83f89ced81dbc6ea2d4c), [SA-1.4](https://app.notion.com/p/c0675c44dafd83698cf381820afa50a7), and [SA-1.5](https://app.notion.com/p/bf675c44dafd82d0957b817294a6d6a1) in the Notion “Insurvas Sprint” database; current repository; read-only live Supabase inspection.

## Executive assessment

Module 1 has the right product shape: a server-paginated users grid, atomic basic user creation, hashed invitation tokens, role changes resolved live on every request, lifecycle controls, and append-only login history. The present production rows are internally consistent.

It is not release-ready yet. The largest risks sit at transaction boundaries rather than in the visible UI: password and email tokens are consumed after the account mutation, edit-user can partially succeed while returning an error, activation bypasses seat limits, and lifecycle changes do not truly revoke an existing session. The claimed “last owner” concurrency protection is also incomplete.

## Release-blocking findings

### M1-1. ✅ FIXED — P1 — Password invitation and reset links are not consumed atomically

**Resolution.** `consume_user_password_token` locks the token before checking it; wired in `app/api/app/auth/set-password/route.ts`.

**Fixed 2026-08-30.** `consume_user_password_token` now locks, re-validates, mutates, consumes,
and accepts the membership in one transaction. A live two-request race produced exactly one
winner; the losing request could not change the winning password.

**Evidence**

- `app/api/app/auth/set-password/route.ts:60-81`

The route first reads a still-valid token, then updates `users.password_hash`, and only afterward marks the token accepted. The token-burn and membership-acceptance writes are unchecked. Two concurrent submissions can both pass validation and race to set different passwords; the last write wins. If the token-burn write fails, a successfully used link remains reusable until expiry.

**Required fix**

- Replace the sequence with one locked database function that validates purpose/expiry/unused state, sets the password, marks the token accepted, and sets `tenant_users.accepted_at` in one transaction.
- Make the update conditional on `accepted_at is null` and return one explicit consumed/invalid result.
- Add concurrent redemption and forced-failure tests.

### M1-2. ✅ FIXED — P1 — Email-confirmation tokens have the same replay window

**Resolution.** `consume_user_email_change_token`, wired in `app/api/app/auth/confirm-email/route.ts`.

**Fixed 2026-08-30.** `consume_user_email_change_token` now performs the unique-email update and
token consumption in one locked transaction. A duplicate address rolls back without burning the
token, and a live two-request race produced exactly one winner.

**Evidence**

- `app/api/app/auth/confirm-email/route.ts:45-82`

Availability is checked, the user's email is changed, and the token is burned in separate statements. The final token update is unchecked. A concurrent replay can pass the initial check twice, and a failed burn leaves a genuine old link capable of changing the address again later.

**Required fix**

- Atomically lock and consume the email-change token while checking the unique address and updating the user.
- Return a conflict without changing either the user or token when the address is no longer available.

### M1-3. ⚠️ FIX EXISTS BUT IS NOT WIRED — P1 — Edit User can commit changes and then return an error

**Status.** `admin_update_user_with_email_change` was added by migration `20260830161407` and has NO caller: `app/api/admin/users/[id]/route.ts` still calls the old `admin_update_user`. The fix is written; connecting it is a small change and the bug is still live until it is.

**Evidence**

- `app/api/admin/users/[id]/route.ts:40-125`

`admin_update_user` commits name, phone, and role before the route checks whether the requested email is already taken. If that later check returns a clash, the HTTP response is `409`, but the earlier changes are already saved and audited. Deleting and inserting an email-change token are also unchecked, so the route can return a link that was never stored.

**Required fix**

- Validate and create the pending email change in the same transaction as the profile/role update, or split email change into a distinct endpoint with a distinct response.
- Check every database result and never return a token URL unless its hash committed.

### M1-4. P1 — Lifecycle changes do not revoke the existing session

**Evidence**

- `lib/users/setStatus.ts:12-69`
- `lib/tenantAuth/session.ts:7-42`
- `lib/tenantAuth/requireTenant.ts:30-58`

Live status lookup correctly blocks an inactive or suspended account on its next request. However, the signed 12-hour cookie remains valid. If the account is reactivated during that window, the old cookie works again without a new login. That does not satisfy SA-1.4's explicit requirement that every state change kills existing sessions immediately.

**Required fix**

- Add a per-user session version or `sessions_revoked_after` timestamp to the signed session contract and check it on every request.
- Advance it atomically on activate, deactivate, suspend, and unsuspend.
- Test deactivate→activate and suspend→unsuspend with the pre-change cookie.

### M1-5. P1 — Reactivating a user bypasses the tenant seat limit

**Evidence**

- `lib/users/setStatus.ts:43-55`
- Live `public.admin_create_user` checks seats only during creation.

Deactivation frees a counted seat. An admin can deactivate user A, create user B at the plan limit, and reactivate A. The activation path performs a direct status update with no lock or `tenant_seats_used` check, so the tenant exceeds its licensed seats.

**Required fix**

- Move activation into a locked database function that checks the current plan limit and active-seat count in the same transaction.
- Return the same clear seat-limit conflict used by Create User.

### M1-6. P1 — A tenant can be created with no owner, and concurrent demotions can remove every owner

**Evidence**

- `components/admin/create-user-dialog.tsx:29-31` defaults the new user to `producer`.
- `lib/users/schemas.ts:7-21` permits every role for a new tenant.
- Live `public.admin_create_user` inserts the requested role unchanged.
- Live `public.admin_update_user` locks only the membership being changed before counting owners.

The first path can create a brand-new tenant whose only member is not an owner. In the second path, two existing owners can be demoted concurrently: each transaction locks a different row, each can observe two owners, and both can pass. The function comment claims its row lock prevents this, but it does not serialize changes at the tenant level.

**Required fix**

- Force the first member of every newly created tenant to `owner` in the database.
- Serialize owner-role changes by locking the tenant row (or using a tenant-scoped advisory lock) before counting and updating.
- Add zero-owner and concurrent-two-owner tests.

### M1-7. P1 — User status transition rules exist only in the buttons

**Evidence**

- `lib/users/setStatus.ts:22-69`
- `app/api/admin/users/[id]/{activate,deactivate,suspend,unsuspend}/route.ts`

The shared server function rejects only deleted and already-equal states. A crafted `activate` request can bypass the intended unsuspend action, `unsuspend` can activate an inactive account, and inactive accounts can be suspended without a defined transition. That weakens reason/audit semantics and makes the lifecycle state machine depend on UI visibility.

**Required fix**

- Define allowed source→target transitions and action names inside one locked RPC.
- Reject every invalid transition server-side and test the full transition matrix.

## Important incomplete or unsafe behavior

### M1-8. P2 — Reissuing a token destroys the old token before the new one exists

**Evidence**

- `app/api/admin/users/[id]/resend-invite/route.ts:36-55`
- `app/api/admin/users/[id]/send-reset/route.ts:39-62`
- `app/api/admin/users/[id]/route.ts:92-112`

All three flows delete pending rows before inserting the replacement. If insertion fails, the customer loses the previous valid link and receives no new one. Resend Invite is broader: it deletes every unaccepted token for the user without filtering `purpose`, so it can erase a pending password reset or email change too.

**Required fix**

- Replace tokens atomically, scoped by `(user_id, purpose)`.
- Preserve the old valid token unless the replacement commits.

### M1-9. P2 — Module 1 email links still trust the request Host as a fallback

**Evidence**

- `app/api/admin/users/route.ts:87`
- `app/api/admin/users/[id]/route.ts:111`
- `app/api/admin/users/[id]/resend-invite/route.ts:54`
- `app/api/admin/users/[id]/send-reset/route.ts:61`

SA-5.1 already removed this pattern from public verification links, but Module 1 still uses `NEXT_PUBLIC_APP_URL || request.nextUrl.origin`. If the canonical URL is absent or misconfigured, a forged Host can produce a genuine invitation/reset email pointing at an attacker-controlled origin.

**Required fix**

- Reuse the strict canonical-origin helper from signup and refuse link issuance before mutating tokens when configuration is missing.

### M1-10. P2 — Login activity writes can fail silently

**Evidence**

- `lib/loginEvents/record.ts:25-42`
- `app/api/app/auth/login/route.ts:95-97`
- `app/api/admin/auth/login/route.ts:57-66`

Supabase returns ordinary insert/update failures as `{ error }`; it does not throw them. `recordLoginEvent` ignores that returned error, so its `catch` does not report normal database failures. Successful login also ignores errors updating `last_login_at`. Authentication may correctly continue, but SA-1.5 observability can silently become incomplete.

**Required fix**

- Inspect returned errors, emit a durable alert/metric, and define a retry or dead-letter path without turning logging into an authentication dependency.
- Add a test that forces the log write to fail and proves both login continuity and visible operational failure.

## Previously known Module 1 gaps

The following remain tracked in `docs/backlog.md` and were reconfirmed:

- **#1:** Create Tenant still asks the admin to type an owner password, contradicting SA-1.2.
- **#3:** Create User has no plan selector, so it cannot attach an active subscription as the ticket specifies.
- **#4:** invitation/reset/email-change delivery is still a logging stub; only copyable links work.
- **#6:** Users list and detail read obsolete `tenants.plan_code` instead of the subscription plan.
- **#7:** the 5,000-user and 50,000-login-row performance criteria remain unverified.
- **#8:** invitation, email-change, role-change, lifecycle, and seat-limit browser round trips remain unverified.
- **#9:** no CI runs the acceptance and isolation checks.
- **#14:** Delete User remains intentionally descoped by the product owner, so its two delete criteria are not counted as defects.
- **#29 / #56:** most Module 1 database schema and functions are not reproducible from repository migrations.
- **#50:** public-schema RPC execution remains broader than intended.

## Live Supabase observations

- One user exists and is `active`; one tenant exists and has exactly one owner.
- There are no zero-owner tenants, orphan memberships, or users belonging to multiple tenants.
- There are no invitation, reset, or email-change rows at present.
- `login_events` contains 18 rows: 7 successes and 11 failures. For users with successful events, `users.last_login_at` matches the latest success.
- Search-supporting trigram indexes exist on name/email, lifecycle and date indexes exist, and login activity has `(user_id, ts)`, `(admin_id, ts)`, and `ts` indexes.
- `admin_user_list` still joins the Plan field from `tenants.plan_code`, confirming backlog #6 against the live view.
- No current row violates the owner/membership rules; the findings above concern permitted future states and race/failure paths.

## Verification completed during this review

- Read all five SA-1 tickets in the Notion “Insurvas Sprint” database.
- Inspected the current user, invitation, lifecycle, tenant-session, and login-event implementation.
- Inspected live views, functions, constraints, indexes, and consistency counts through read-only SQL.
- No Supabase rows were created, changed, or deleted.
- There is no dedicated Module 1 integration verifier in `package.json`; only the broader tenant-isolation script exists.
- The repository-wide unit/static checks were deferred to the final combined pass below, avoiding repeated full builds.

## Module 1 ticket assessment

| Ticket | Notion status | Audit assessment |
| --- | --- | --- |
| [SA-1.1](https://app.notion.com/p/3a075c44dafd8391aaf501803087a0d0) | Completed | Server pagination, search, filters, counts, export, indexes, and CRM-style grid exist. Plan data comes from the dead tenant column and the 5,000-row target was never measured. |
| [SA-1.2](https://app.notion.com/p/be975c44dafd83019e5c813da32e390d) | Completed | Basic creation is atomic, duplicate email rolls back, tokens are hashed, and admins do not set passwords in this flow. New tenants can have no owner, plan assignment/email delivery are absent, and token redemption is non-atomic. |
| [SA-1.3](https://app.notion.com/p/fc875c44dafd83f89ced81dbc6ea2d4c) | Completed | Profile/role edit, confirmation-before-email-change, audit diffs, and live role resolution exist. Edit can partially commit, token issuance/confirmation is non-atomic, and last-owner concurrency is unsafe. |
| [SA-1.4](https://app.notion.com/p/c0675c44dafd83698cf381820afa50a7) | Completed with product-approved scope change | Active/inactive/suspended controls, reason capture, login blocking, seat counting, and audits exist. Sessions are blocked but not revoked, activation bypasses seat limits, and transition rules are UI-only. Delete remains intentionally out of scope. |
| [SA-1.5](https://app.notion.com/p/bf675c44dafd82d0957b817294a6d6a1) | Completed | Success/failure events, filters, stats, IP/agent metadata, pagination, and indexes exist. Ordinary database write failures are silently ignored and the 50,000-row criterion is unverified. |

## Recommended Module 1 repair order

1. Make password/reset and email-change redemption single-use atomic transactions.
2. Make edit-user and replacement-token issuance atomic, with every database result checked.
3. Add true session revocation/versioning for every lifecycle transition.
4. Enforce seat limits during activation and put the lifecycle transition graph in the database.
5. Enforce one owner at tenant creation and serialize owner demotions by tenant.
6. Require the canonical application URL for every customer-facing link.
7. Repoint the Users screen to `subscriptions → plans` and remove the obsolete plan column.
8. Make login-event failures operationally visible without blocking login.
9. Add a Module 1 integration suite covering concurrency, failure injection, and real browser round trips.
10. Load-test the list/activity endpoints before release.

---

# Module 4 review — PR #8 (`module-4`)

Reviewed: 2026-08-30 · Reviewer: senior code review + QA pass
Scope: SA-4.1 through SA-4.12 (SA-4.11 On Hold), reviewed against the Notion acceptance criteria
Basis: `origin/module-4` at 212 files / +20,676, and the merged tree on `main`

**Overall.** The module is well built and, in places, better than the spec asked for. The DNC path
fails closed at every branch, the kill switch is consulted before the entitlement and reasons out
loud about why, credentials are AES-256-GCM at rest and never leave the server, RLS scopes the new
tenant tables, and the schema-dump baseline plus `.github/workflows/ci.yml` close two long-standing
backlog items. The findings below are specific defects, not a verdict on the module.

Three of them concern money and one concerns a compliance gate. Numbering continues the sequence
above.

## Release blockers

### 11. ✅ FIXED 2026-08-30 — P1 — Buying a credit pack bills the customer and grants no credits

**Resolution.** `purchase_credit_pack` raises the invoice and writes the grant in one transaction, so the customer cannot be billed without receiving the credits. The verification now reads capacity before and after the purchase rather than only checking the invoice line.

**Ticket:** SA-4.9 · *"Buying a credit pack adds a line to that tenant's next invoice"*

**Evidence**

- `lib/creditsLimits/service.ts:132-167` — `purchaseCreditPack`
- `lib/creditsLimits/service.ts:108-115` — `grantCredits`, the only writer of `credit_grants`
- `scripts/verify-credits-limits.mjs:112-116`

`purchaseCreditPack` looks up the pack, raises a custom invoice for `price_cents × quantity`, and
returns. It **never inserts a `credit_grants` row.** Nothing else does either — a repository-wide
search finds exactly one writer of that table, the manual-grant path, and no trigger or function
that creates a grant from an invoice or an invoice line.

The function even computes the right number and throws it away:

```ts
return { ...result, packName: pack.name, meterKey: pack.meter_key,
         packQuantity: pack.quantity * input.quantity };   // nothing consumes packQuantity
```

`packQuantity` has no consumer anywhere in the repository.

Every other part of the credit system is correct — `check_meter_capacity` and
`resolve_tenant_entitlement` both add `credit_grants` into the allowance — which is what makes this
specifically a missing write rather than a broken design. A customer buys "5,000 TCPA checks —
$45", is invoiced $45, and their balance does not move.

**Why QA missed it:** the verification asserts the *invoice line* and nothing else:

```js
check("buying a pack creates its invoice line",
      purchaseResponse.status === 201 && invoiceLine?.amount_cents === 1250);
```

It never re-reads capacity after the purchase, so it passes with the bug present. This is the same
class of problem as a test that greps rendered HTML for a string that also appears in the source:
the assertion is narrower than the sentence describing it.

**Required fix**

- Insert a `credit_grants` row inside the same transaction that raises the invoice line, so a
  customer can never be billed without receiving the credits.
- Extend the verification to read capacity before and after the purchase and assert it rose by
  `pack.quantity × quantity` — the same shape as the existing manual-grant assertion.

## High

### 12. ✅ FIXED 2026-08-30 — P2 — A manual credit grant does not refresh the cached entitlement

**Resolution.** Both the grant route and the purchase path rebuild the entitlement, and the verification asserts the CACHED blob rather than `check_meter_capacity`.

**Ticket:** SA-4.9 · *"Granting credits by hand increases the tenant's available balance
**immediately** and appears on the usage monitor"*

**Evidence**

- `app/api/admin/credits-limits/grants/route.ts` — no entitlement rebuild
- `lib/entitlements/get.ts:12-29` — reads the cached `tenant_entitlements.entitlement`
- `app/app/(shell)/dashboard/page.tsx:33` — `Object.entries(entitlement.meters)`

Two different readers disagree after a grant:

| Reader | Source | Sees the grant? |
|---|---|---|
| `check_meter_capacity` (enforcement) | live SQL | **yes** |
| `admin_usage_monitor` (admin screen) | live SQL | **yes** |
| `entitlement.meters` (the agent's own dashboard) | cached row | **no** |

So the credits are genuinely usable — enforcement is correct — but the tenant looking at their own
"THIS PERIOD" panel still sees the old allowance until something unrelated rebuilds the cache. Half
the criterion passes and the half the customer actually looks at does not.

Every other writer that changes an allowance calls `rebuildEntitlement` (SA-2.8 added it for
exactly this reason); the grant path is the one that does not.

**Required fix**

- Call `rebuildEntitlement(tenantId, …)` after a successful grant, as the subscription and plan
  paths already do.
- Assert the *cached* entitlement — not just `check_meter_capacity` — in the verification.

### 13. P2 — A credit pack raises a new invoice immediately instead of a line on the next one

**Ticket:** SA-4.9 · *"adds a line to that tenant's **next** invoice"*

**Evidence**

- `lib/creditsLimits/service.ts:153` — `createCustomInvoice({ … })`
- `supabase/migrations/0017_period_billing.sql` — `pending_charges`

The purchase raises a separate custom invoice on the spot. On a tenant in automatic billing mode
that is an extra charge mid-cycle rather than an extra line on the next bill, which is a different
commercial promise from the one the ticket makes and the one a customer buying a top-up expects.

The mechanism the ticket describes was built in this same PR: `pending_charges` exists precisely to
hold a charge until the next period billing run picks it up. It simply is not used here.

**Required fix**

- Queue the pack into `pending_charges` and let the period billing run bill it, or
- get an explicit product decision that top-ups bill immediately, and change the ticket to match.
  Either is defensible; silently doing the opposite of the written criterion is not.

### 14. P2 — Maintenance `read_only` does not stop several tenant writes, including starting a checkout

**Ticket:** SA-4.12 · *"`read_only` mode returns a clear, human message on writes — not a 500"*

**Evidence**

- `lib/entitlements/requireFeature.ts:36-51` — the only place maintenance is enforced
- Merged tree: ten tenant write routes do not call `requireFeature`

The maintenance gate lives inside `requireFeature`, so any write reached through `requireTenant`
alone bypasses it. On `module-4` alone this was nearly harmless — announcement dismissal and the
auth flows, which arguably *should* keep working. After the merge with SA-5 it is not:

```
app/api/app/checkout/start/route.ts          ← opens a real Whop checkout
app/api/app/checkout/coupon/route.ts
app/api/app/onboarding/business-profile/route.ts
app/api/app/onboarding/verification/route.ts
app/api/app/legal/accept/route.ts
app/api/app/announcements/[id]/dismiss/route.ts
```

During a `read_only` window a customer can still start a checkout and be charged. That is the exact
case the mode exists to prevent.

Note this is an interaction the merge exposed rather than a defect the SA-4 author introduced — the
SA-5 routes did not exist on their branch.

**Required fix**

- Move the maintenance check into `requireTenant`, so every tenant-authenticated route inherits it,
  and let the small number of routes that must keep working during maintenance (login, logout,
  email confirmation, password set) opt out explicitly.
- Add a verification that asserts a `read_only` window blocks a checkout start with a 503 and a
  human message.

## Medium

### 15. P3 — A scheduled maintenance window shows the banner from the moment it is saved

**Ticket:** SA-4.12 · *"a scheduled window raises the banner automatically and clears it
automatically"*

**Evidence**

- `lib/system/service.ts:80` — `const beforeWindow = Boolean(start && now < start);`

Any future `scheduled_start` puts the platform into `banner_only` immediately, with no lead-time
bound. Scheduling a window three weeks out shows every customer a maintenance banner for three
weeks, which trains them to ignore it — and the banner is the mechanism that is supposed to work
when it matters.

The auto-clear half is correct: `now >= end` returns `off`.

**Required fix**

- Bound the lead-in (a configurable "warn from N hours before", defaulting to something like 24h),
  or make the banner's copy state the future date explicitly so a distant window reads as an
  advance notice rather than a current condition.

### 16. P3 — The offer redemption counter never decrements, and a lowered offer cap is advisory

**Ticket:** SA-4.4 · *"The redemption cap is enforced at apply time, not at invoice time"*

**Evidence**

- `supabase/migrations/0002_offers.sql:55-73` — `increment_offer_redemption`, AFTER INSERT only
- `supabase/migrations/0002_offers.sql:114` — `and (o.max_redemptions is null or o.redeemed_count < o.max_redemptions)`

The real cap is safe: `createOffer` mirrors the offer's cap onto the linked coupon, `updateOffer`
refuses to raise it, and `admin_apply_coupon` enforces the coupon cap atomically. That is a good
design and the criterion is substantially met.

Two smaller edges remain:

1. There is no AFTER DELETE trigger on `subscription_coupons`, so removing an offer coupon from a
   subscription leaves `redeemed_count` inflated. The number shown as "redemptions" on the offer
   list drifts upward and never comes back.
2. `updateOffer` may *lower* `max_redemptions` below the coupon's. Past that point the only check
   is the non-atomic `redeemed_count < max_redemptions` in the loop, so two concurrent assignments
   can both pass it and exceed the lowered campaign cap — though never the coupon cap.

**Required fix**

- Decrement on `subscription_coupons` delete, or derive the displayed count with `count(*)` instead
  of maintaining a denormalised counter.
- If a lowered campaign cap is meant to be binding, enforce it in the same locked statement as the
  coupon cap rather than in the selection query.

## QA findings — assertions narrower than the criteria they cite

These are not product defects; they are reasons the suite reported green while defects were
present. Recorded because the same pattern hid finding 11.

1. **`verify-credits-limits.mjs:116`** — "buying a pack creates its invoice line" checks only the
   invoice line, while the criterion it stands for is about the customer receiving credits. Passes
   with finding 11 present.
2. **`verify-credits-limits.mjs:105`** — "grant increases available capacity immediately" reads
   `check_meter_capacity` only. The cached entitlement, which is what the agent actually sees, is
   never asserted. Passes with finding 12 present.
3. **SA-4.8's fallback criterion** — *"simulating a failure on the primary routes the call to the
   secondary and logs the fallback"* is covered by `lib/compliance/fallback.test.mjs` against an
   injected callback. That is a fair unit test of the loop, but no test drives two real registered
   vendors through `runWithComplianceFallback`, so the database-backed ordering and the
   `provider_calls` fallback row are unproven together.
4. **SA-4.9's 500-tenant performance criterion** — the script does create 500 tenants, which is
   more than most suites bother with. It asserts completion, not a time bound, so "without timing
   out" is verified only against the default timeout of whatever machine ran it.

## What I checked and found correct

Recorded so a re-review does not repeat the work:

- **SA-4.8 fail-closed dialing.** `performDncDialPreflight` calls `assertDncVendorAvailable` first,
  then scrubs through the ordered fallback; an unparseable vendor payload throws rather than
  defaulting to allow; the route maps every failure to 503 with `blocked: true`; phone numbers are
  masked before they reach `provider_calls`. Every branch I could find fails closed.
- **SA-4.8 credential handling.** AES-256-GCM with a random IV and auth tag, `credentials_enc`
  excluded from every select that feeds an API response, `credentials_present` boolean exposed
  instead.
- **SA-4.10 ordering.** Kill switch is evaluated before the entitlement, with a distinct
  `feature_unavailable` code so a paying customer is not sent to an upgrade page for something they
  already bought. The 30s TTL against a 60s criterion is documented and correct, including the
  reasoning that per-process invalidation cannot bound staleness on serverless.
- **SA-4.9 allowance arithmetic.** Grants are added into both `check_meter_capacity` and
  `resolve_tenant_entitlement`; plan-owned allowances correctly take precedence over platform
  defaults.
- **Route authorisation.** Every new admin API route carries `requireAdminRole`; every new tenant
  route carries `requireFeature` or `requireTenant`. The only unguarded routes are deliberately
  public (`/api/maintenance` returns level and message only).
- **Tenant isolation on templates.** `tenant_templates` and its child tables have RLS policies
  scoped to `app.tenant_id`, and the app routes pass `auth.context.tenantId` rather than anything
  client-supplied.
- **CI now exists** (`.github/workflows/ci.yml`), which closes backlog #9.

# components/admin/billing

Admin › Billing as one area (admin round 1, 2026-11-17; board
[billing-r2.html](../../../docs/design/admin-r1/billing-r2.html)). Every page wraps its content in
`BillingPage` (the shared StepFrame with the Billing rail; steps in `lib/adminBilling/steps.ts`). File
prefixes name the page: ws (Workspace), subs, trials, failed, inv, refund, recon, coupon, offer, credits,
rev, provider.

**Rules:** [UI-CONSISTENCY.md](../../../docs/design/UI-CONSISTENCY.md) and
[BRAND.md](../../../docs/design/BRAND.md). Compose from [`components/ui`](../../ui/README.md): one-line
tables, a status line instead of notice cards, records in a right sheet, filters in the address.

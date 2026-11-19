# components/admin/dashboard

The admin dashboard (admin round 1, 2026-11-17; board
[dashboard-combined.html](../../../docs/design/admin-r1/dashboard-combined.html)): Overview graphs first,
then one tab per thing an admin watches (Needs you, Money, Customers, Platform health, Security & staff).
Which role gets which tab: `lib/adminDashboard/tabs.ts`.

**Rules:** [UI-CONSISTENCY.md](../../../docs/design/UI-CONSISTENCY.md) and
[BRAND.md](../../../docs/design/BRAND.md). Compose from [`components/ui`](../../ui/README.md): one-line
tables, a status line instead of notice cards, records in a right sheet, filters in the address.

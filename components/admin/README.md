# components/admin

Screens and parts of the admin console (`/admin/*`).

**Rules:** [UI-CONSISTENCY.md](../../docs/design/UI-CONSISTENCY.md), with the admin accent from
[BRAND.md](../../docs/design/BRAND.md): the same colours, shell and spacing as the apps with a blue
accent, set only in `app/admin/admin-plane.css`. Lists §6/§6a, overlays §11, status §12,
numbers §14.
**Visual reference:** [foundation-v3/mockup.html](../../docs/design/foundation-v3/mockup.html).

Use the shared parts in [`components/ui`](../ui/README.md). Admin dialogs follow the §11 sizes and
button labels.

Do not: name a colour here (the accent comes from tokens), or add admin-only tables, pagers or
stat tiles (`board-stat-tile.tsx` moves to the stat card in `foundation-rollout`).

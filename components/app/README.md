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

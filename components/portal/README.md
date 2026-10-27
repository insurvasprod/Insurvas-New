# components/portal

Chrome shared by the agent and partner portals: the navigation rail, page transitions and
`PortalAuthSplitShell`, the split layout behind every sign-in and sign-up screen.

**Rules:** [UI-CONSISTENCY.md](../../docs/design/UI-CONSISTENCY.md) §1 chrome and §13 auth pages.
**Visual reference:** [foundation-v3/mockup.html](../../docs/design/foundation-v3/mockup.html).

`PortalAuthSplitShell` is the one auth layout. The `auth-shell` module
([capability map](../../docs/design/foundation-v3/CAPABILITY-MAP.md)) makes every auth page use it
the same way.

Do not: add a second auth layout, a page-level strip or ribbon, or per-page variants of the rail.

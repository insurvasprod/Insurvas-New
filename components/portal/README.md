# components/portal

Chrome shared by the agent and partner portals: the navigation rail, page transitions, and the
auth layout behind every sign-in and sign-up screen.

**Rules:** [UI-CONSISTENCY.md](../../docs/design/UI-CONSISTENCY.md) §1 chrome and §13 auth pages.
**Visual reference:** [foundation-v3/mockup.html](../../docs/design/foundation-v3/mockup.html), and
every auth combination on `/design/auth` (development only).

| Piece | File | Use |
|---|---|---|
| `AuthLayout` | `auth-layout.tsx` | Every sign-in and sign-up screen. Props: `plane`, `width`, `steps`, `back`, `story`. |
| `AuthSteps`, `AuthBack`, `AuthHeading`, `AuthStory` | `auth-layout.tsx` | The step bar, the back link, the one heading, the one brand panel |
| `AuthField`, `AuthInput`, `AuthSubmit`, `AuthSecondary`, `AuthAlert`, `authLabel`, `authControl` | `auth-controls.tsx` | 44px fields and buttons, one alert |
| `PortalAuthSplitShell` | `portal-auth-split-shell.tsx` | Rendered by `AuthLayout` only |

Do not: render `PortalAuthSplitShell` directly, draw an `<h1>`, stepper or alert box on an auth
screen, or add a second auth layout (`lib/design/authShell.test.mjs` fails if you do).

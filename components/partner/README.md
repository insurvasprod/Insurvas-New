# components/partner

Screens and parts of the partner portal (`/partner/*`), including its sign-in and invite frames.

**Rules:** [UI-CONSISTENCY.md](../../docs/design/UI-CONSISTENCY.md): the same rules as the agent
app (§2, §4/§4a, §6/§6a, §8, §10, §11, §12, §14). The auth screens here (`partner-auth-frame.tsx`,
`partner-login-form.tsx`, the invite and set-password forms) follow §13.
**Visual reference:** [foundation-v3/mockup.html](../../docs/design/foundation-v3/mockup.html).

Use the shared parts in [`components/ui`](../ui/README.md). The partner portal is not a separate
design system: it differs only in its menu and story copy.

Do not: introduce partner-only colours, controls or table styles.

# app/app

Routes of the agent app: the signed-in shell under `(shell)`, plus sign-in, the sign-up funnel
(verify email, onboarding, checkout, welcome) and account recovery pages.

**Rules:** [UI-CONSISTENCY.md](../../docs/design/UI-CONSISTENCY.md). Every page is a header (§2),
then figures (§4/§4a), then lists (§6/§6a), laid out as in §8. Auth and funnel routes follow §13.
Gates are not a design choice: see the three rules in
[docs/design/README.md](../../docs/design/README.md).
**Visual reference:** [foundation-v3/mockup.html](../../docs/design/foundation-v3/mockup.html).

Page building blocks live in [`components/ui`](../../components/ui/README.md) and
[`components/app`](../../components/app/README.md).

Do not: widen a feature gate to fill a page, render an error as an empty state, or build a page
layout here instead of composing the shared components.

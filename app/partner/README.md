# app/partner

Routes of the partner portal: the signed-in portal under `(portal)`, plus login, invite and
set-password.

The workspace pages are Overview (`/partner`), Submit lead, Pipeline, **Deal flow** and Messages;
Statements, Team review and Team access sit under Organization and are partner-admin only.
`deal-flow` is the newest (1 Nov): one day of what the agency did with this partner's leads, read
from [`lib/partnerDealFlow`](../../lib/partnerDealFlow) and drawn by
[`partner-deal-flow.tsx`](../../components/partner/partner-deal-flow.tsx). It decides no access of
its own — the rule is [`lib/partnerLeads/scope.ts`](../../lib/partnerLeads/scope.ts)', the same one
Pipeline uses.

**Rules:** [UI-CONSISTENCY.md](../../docs/design/UI-CONSISTENCY.md), the same as the agent app.
Auth routes follow §13.
**Visual reference:** [foundation-v3/mockup.html](../../docs/design/foundation-v3/mockup.html).

Building blocks: [`components/ui`](../../components/ui/README.md) and
[`components/partner`](../../components/partner/README.md).

Do not: widen a gate, or add partner-only layouts or styles.

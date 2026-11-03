# Claude QA artifact inventory

Reviewed 2026-09-14 as part of the continuous gap-remediation audit. The current authoritative QA
material is under `docs/qa` in the active repository. The older Claude-generated material found in
the adjacent legacy checkout is retained as historical evidence only and is not treated as a current
route or task contract.

## Current repository artifacts reviewed

- `docs/qa/BASELINE-PLAN.md`
- `docs/qa/MASTER-GAP-BLOCKER-REGISTER.md`
- `docs/qa/SA-0.1-SA-5.5-QA-AUDIT.md`
- `docs/qa/LA-0.1-0.6-QA-AUDIT.md`
- `docs/qa/LA-1-QA-AUDIT.md`
- `docs/qa/LA-2-QA-AUDIT.md`
- `docs/qa/LA-2-COMPLETION-CHECKLIST.md`
- `docs/qa/LA-2.16-2.17-IMPLEMENTATION-REVIEW.md`
- `docs/qa/LA-2.18-2.19-IMPLEMENTATION-REVIEW.md`
- `docs/qa/LA-2.20-2.21-IMPLEMENTATION-REVIEW.md`
- `docs/qa/LA-2.22-2.23-IMPLEMENTATION-REVIEW.md`
- `docs/qa/LA-2.24-2.25-IMPLEMENTATION-REVIEW.md`

These artifacts identify the outstanding SA, LA-0, LA-1, LA-2, database, RLS, provider, browser,
performance, legal, and retention gaps. Their classifications are consolidated in the master
register; no historical `Completed` label was promoted to acceptance.

## Adjacent historical artifacts

The legacy checkout contains `.qa` and `.qa-tmp` reports, including role-landing, system, and public
UI audits. Those reports were checked for recurring findings and route assumptions. They describe
older `/dashboard/{role}` pages and older application state, so they remain useful as historical
regression context but cannot override the active repository's App Router routes.

## Current remediation finding

The Claude QA checklist previously described the dialer surface as missing. The active repository now
contains a real `/app/dialer` page and `DialerWorkspace` implementation. The corrected assessment is:

- server-side calling-window, suppression, DNC, disclosure, local-time, consent, and call-history
  controls are implemented locally;
- the dial action waits for the server gate before opening `tel:`;
- the general LA-1.12 disposition workflow is live-verified through the tenant-scoped workflow,
  including idempotency, suppression, audit, and cross-tenant denial; the separate LA-2.9 existing-
  dial atomic close-out migration still requires live promotion;
- selection-reason rendering and authenticated desktop/mobile browser evidence remain open.

This correction updates `MASTER-GAP-BLOCKER-REGISTER.md` and `LA-2-COMPLETION-CHECKLIST.md`.

## Current live reconciliation — 2026-09-14

The latest read-only reconciliation supersedes older counts embedded in historical Claude reports:

- `verify:rpc-contract`: 165/165 application-called RPCs are present.
- `check:tenant-access`: 127/127 declared tenant-access checks are correct.
- `check:triggers`: 86/86 declared triggers are present.
- `verify:la1-security`: focused security checks pass; broader advisor review and authenticated RLS
  evidence remain separate acceptance gates.
- `verify:dispositions`: the live tenant-scoped disposition flow passes its focused checks,
  including configuration, wizard progression, idempotency, suppression, audit, and isolation.
- The live `public.import_agent_lead_batch(uuid,uuid,jsonb)` function still references the absent
  `public.users.tenant_id` column. The reviewed additive repair is
  `20260914193000_la_2_2_import_actor_membership_fix.sql`; it is not promoted because the current
  verification role has no DDL authority. LA-2.2 therefore remains **Database-misaligned**.
- `check:collisions` reports 11 repository/live shape incompatibilities involving invoices, partners,
  pipelines, stages, audit log, tenants, invitations, users, partner users, SLA events, and
  disposition flows. These require explicit adapters or an authorized migration decision; no
  speculative schema rewrite was applied.
- The current local regression baseline is `npm.cmd test` = 504 passing tests. This replaces the
  older 500/499-test figures in earlier QA snapshots; historical results remain historical.

# LA-1 completion and QA prompt

Continue and finish the complete INSURVAS LA-1 module in the repository:

`C:\Users\Victus\OneDrive\Documents\ChatGPT\Insurvas-git\Insurvas-New`

Act as the implementation owner, senior functional reviewer, code reviewer, database/RLS reviewer,
security reviewer, UI/UX reviewer, accessibility reviewer, performance reviewer, and manual QA owner.
Complete LA-1.1 through LA-1.25 against the current task definitions, in-scope requirements, and exact
acceptance criteria. Do not claim a task is complete because code exists or a planning board says
Completed. A task is complete only when its required implementation and evidence are both present.

## Authoritative sources

Read and reconcile these before changing code:

- `docs/qa/LA-1-QA-AUDIT.md`
- `docs/qa/MASTER-GAP-BLOCKER-REGISTER.md`
- `docs/architecture/task-traceability.md`
- the current LA-1 task definitions, scope, dependencies, decisions, routes, APIs, services,
  migrations, RPCs, triggers, policies, tests, and generated database types

## LA-1 scope

Cover every criterion for:

- partner lifecycle, partner users, products, approvals, and subscriptions;
- dynamic forms, conditional fields, previews, and partner rendering;
- TCPA/DNC screening and fail-closed behavior;
- partner submissions, intake, affiliate links, pipelines, and stages;
- transfer inbox, atomic claiming, SLA timing, and cross-agent isolation;
- verification, buffer handoff, deal flow, and Agent Floor;
- partner chat, notifications, alerts, and browser notification behavior;
- partner lead pipeline and partner-quality reporting;
- lead workspace, notes, callbacks, unclaimed-lead SLA, and existing-customer preflight.

## Required review loop

For every LA-1.1–LA-1.25 task:

1. Reconcile each acceptance criterion with its route, UI, API/server action, service, migration,
   RLS policy, RPC, audit/outbox behavior, and test.
2. Run the narrowest focused verifier and record the exact result.
3. Inspect the live Supabase schema, columns, constraints, indexes, functions, grants, and policies.
4. Verify tenant isolation for reads and writes, role restrictions, entitlement checks, idempotency,
   concurrency, append-only records, audit logging, and safe error responses.
5. Run the authenticated browser workflow with the supplied existing accounts when the route requires
   it. Test desktop and mobile layouts, navigation, forms, conditional rendering, empty/loading/error/
   retry/unauthorized states, keyboard focus, labels, readable copy, confirmations, and feedback.
6. Fix every safe local defect found, add or improve regression coverage, and rerun the affected gate.
7. Recheck the whole module after fixes. Preserve unrelated working-tree changes.

## Required verification

Run all LA-1 focused scripts listed in `package.json`, including partner lifecycle/users/products,
dynamic forms, screening, submission, intake, affiliate links, pipelines, transfer inbox, verification,
dispositions, deal flow, buffer handoff, Agent Floor, partner chat, partner lead pipeline,
partner-quality, subscription limits, lead workspace, lead notes, callbacks, unclaimed SLA,
existing-customer preflight, and agent alerts. Also run:

```powershell
npm test -- --runInBand
npm run typecheck
npm run lint
npm run build
npm run db:check
npm run verify:la1
npm run verify:la1-security
npm run verify:rpc-contract
npm run check:tenant-access
npm run check:triggers
npm run check:features
```

Use a larger Node heap for the build when required by the repository environment. Separate application
failures from remote latency, shared-server contention, browser-harness limitations, missing MFA,
provider credentials, legal approval, deployment-like testing, and unresolved product decisions.

## Safety boundaries

- Use the existing authorized demo accounts; never print or retain passwords or MFA codes.
- Let the user enter MFA codes themselves.
- Do not accept draft Terms, Privacy, TCPA, or state-law text as legal approval.
- Do not invent provider delivery, telephony, email, browser-notification, or production evidence.
- Do not reset, broadly delete, or overwrite shared Supabase data.
- Reviewed additive migrations may be applied only to Supabase project `iiimdgizjwnihpyrukbu` when
  their exact impact is understood and they are safe, scoped, and required.
- If DDL, legal, provider, browser-permission, MFA, or deployment authority is required, retain the
  exact criterion as open and document the owner and next action.

## Status rules

Use only: `Complete`, `Partial`, `Browser-unverified`, `Database-misaligned`, `Blocked`, `Deferred`,
`Cancelled`, or `N/A`.

Do not close a criterion without the evidence required by that criterion. Keep genuine external
boundaries visible instead of weakening assertions or marking them complete.

## Required deliverables

Update:

- `docs/qa/LA-1-QA-AUDIT.md`
- `docs/qa/MASTER-GAP-BLOCKER-REGISTER.md`
- `docs/architecture/task-traceability.md`

Report a criterion-by-criterion LA-1.1–LA-1.25 matrix, functional/code/database-security/UI-UX/
accessibility/performance review results, all commands and outcomes, changed files and migrations,
manual browser evidence, exact remaining blockers, owner/action required, and the next safe step.

Continue until every safe in-scope defect is fixed and re-proven. Stop only at a genuine external,
legal, provider, MFA/browser-permission, DDL-authority, deployment, or product-decision boundary, and
state that boundary precisely.

# INSURVAS master QA-gap remediation prompt

Use this prompt for the continuing INSURVAS remediation run in the active repository:

`C:\Users\Victus\OneDrive\Documents\ChatGPT\Insurvas-git\Insurvas-New`

## Objective

Act as the senior QA engineer, software architect, security reviewer, database reviewer, UX reviewer,
and remediation owner for INSURVAS. Reconcile every known failed, partial, blocked,
browser-unverified, database-misaligned, deferred, cancelled, and undefined item from the current QA
record. Inspect the current repository and the Claude-generated QA material for Module 1, LA-1, and
LA-2. Fix every verified safe defect immediately and keep progressing in strict dependency order until
only genuine external, legal, provider, deployment, database-authority, or user-decision blockers
remain.

Do not stop because a task is marked Completed in Notion or because code exists. Do not report a task as
accepted without implementation, automated evidence, live database evidence, and authenticated browser
evidence where the criterion requires it.

## Authoritative inputs

Read and reconcile:

- `docs/qa/BASELINE-PLAN.md`
- `docs/qa/MASTER-GAP-BLOCKER-REGISTER.md`
- `docs/qa/SA-0.1-SA-5.5-QA-AUDIT.md`
- `docs/qa/LA-0.1-0.6-QA-AUDIT.md`
- `docs/qa/LA-1-QA-AUDIT.md`
- `docs/qa/LA-2-QA-AUDIT.md`
- `docs/qa/LA-2-COMPLETION-CHECKLIST.md`
- `docs/qa/CLAUDE-QA-ARTIFACT-INVENTORY.md`
- all task-specific implementation reviews under `docs/qa`
- current Notion goals, scope, dependencies, product decisions, and acceptance criteria
- current repository routes, services, migrations, tests, package scripts, and generated schema evidence

The master gap register is the consolidated queue, but it must be corrected when current repository or
live evidence disproves an older finding. Historical Claude and legacy `.qa`/`.qa-tmp` reports are
regression context only; they do not override current routes or requirements.

## Safety and environment rules

- Work only in the repository above.
- Preserve all existing dirty-tree changes; never reset, checkout, clone, or overwrite them.
- Use the existing `.env.local` and the existing Supabase project only.
- Never create a new Supabase project.
- Never reset, broadly delete, rename, or overwrite shared records.
- Use only disposable, clearly namespaced QA fixtures.
- Deactivate disposable fixtures after verification instead of broadly deleting shared data.
- Never print, commit, or repeat passwords, OTPs, API keys, service-role keys, SMTP credentials, or provider secrets.
- Never put a service-role credential in browser code or use it as a substitute for authenticated RLS proof.
- Do not apply a migration unless its exact impact is understood and it is additive, reversible, and required.
- If the current database role lacks DDL authority, document the migration as local-reviewed and stop
  claiming live schema proof; do not weaken the application with a non-atomic fallback.
- Keep real payments, email delivery, telephony, carrier, tax, and production integrations disabled.
- Do not accept draft legal terms or perform other consequential account actions without explicit user approval;
  record the browser blocker instead.

## Task order

Work in consecutive batches of two or three tasks. Complete and classify one batch before beginning the
next. Do not skip, merge, invent, or silently reorder tasks.

1. Reconcile and remediate all open SA-0.1 through SA-0.4 foundation and RLS gaps.
2. Revalidate and remediate SA-1.1 through SA-1.5 user administration.
3. Revalidate and remediate SA-2.1 through SA-2.8 pricing, usage, add-ons, subscriptions, and entitlement enforcement.
4. Revalidate and remediate SA-3.1 through SA-3.9, excluding cancelled SA-3.5.
5. Revalidate and remediate SA-4.1 through SA-4.12 configuration and operational controls.
6. Revalidate SA-5.1 through SA-5.4. Mark SA-5.5 `N/A` if no authoritative task exists; never invent it.
7. Reconcile the Claude Module 1/LA-1 material and remediate LA-0 and LA-1 in task order.
8. Audit LA-2.1 onward using `LA-2-COMPLETION-CHECKLIST.md`; implement safe missing screens and contracts,
   and stop at the documented LA-2.5 synchronization boundary when later-project comparison is required.

## Review and remediation loop for every task

For each task:

1. Read the Notion goal, scope, dependencies, decisions, and acceptance criteria.
2. Locate the route, component, server action/API, domain service, migration, policy, tests, and documentation.
3. Build a criterion-by-criterion checklist with implementation and evidence references.
4. Run the narrowest focused verifier and record exact pass/fail output.
5. Inspect the live Supabase contract: tables, columns, constraints, indexes, functions, grants, and RLS.
6. Run namespaced live fixtures for authentication, tenant scope, transactions, idempotency, audit, and outbox behavior.
7. Exercise the authenticated browser workflow for the required role on desktop, tablet, and mobile widths.
8. Check navigation continuity, controls, loading, empty, validation, denied, failure, and retry states.
9. Check keyboard accessibility, readable contrast, focus order, responsive overflow, and understandable copy.
10. Fix only defects proven by the current evidence; keep fixes scoped, additive, and reversible.
11. Re-run the complete task gate after each fix.
12. Update the traceability and architecture evidence before starting the next task.

## Mandatory technical checks

Verify server-side authentication, role permissions, tenant and partner membership scope, entitlement
and kill-switch checks, transaction boundaries, idempotency, audit events, outbox events, safe error
responses, and secret isolation. Verify cross-tenant `SELECT`, `INSERT`, `UPDATE`, and `DELETE` denial
for every tenant-owned surface. Verify append-only audit and financial records. Verify that navigation,
loaders, route handlers, server actions, and API responses agree about access.

Run the relevant focused package scripts and then the baseline:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd run check:features
```

Also run task-specific scripts already listed in `package.json`, including the SA, LA-0, LA-1, LA-2,
security, RPC, grant, trigger, billing, compliance, and performance verifiers. Separate true product
failures from remote latency, missing DDL authority, provider configuration, legal approval, and
browser-harness limitations.

## Required classification

Classify every task exactly as one of:

- `Pass`
- `Partial`
- `Blocked`
- `Browser-unverified`
- `Database-misaligned`
- `Deferred`
- `Cancelled`
- `N/A`

`Pass` requires frontend, backend, database/RLS, automated, live Supabase, and authenticated browser
evidence appropriate to the task. If any required evidence is missing, retain the narrower incomplete
classification and state precisely what is missing.

## Required outputs

Keep these files current with factual evidence:

- `docs/qa/MASTER-GAP-BLOCKER-REGISTER.md`
- `docs/qa/SA-0.1-SA-5.5-QA-AUDIT.md`
- `docs/qa/LA-0.1-0.6-QA-AUDIT.md`
- `docs/qa/LA-1-QA-AUDIT.md`
- `docs/qa/LA-2-QA-AUDIT.md`
- `docs/qa/LA-2-COMPLETION-CHECKLIST.md`
- `docs/architecture/task-traceability.md`
- `docs/architecture/database.md`
- `docs/architecture/security.md`
- `docs/architecture/supabase-inventory.md`

For each completed batch, report:

```text
Batch:
Tasks reviewed:
Tasks passed:
Tasks needing fixes:
Tasks blocked:
Database findings:
Security/RLS findings:
Frontend and UX findings:
Automated test results:
Authenticated browser evidence:
Remaining limitations:
Exact next task:
```

Maintain a separate list of all open gaps with an ID, task, severity, exact evidence, current
classification, safe remediation, external owner if any, and re-test command. Do not collapse multiple
independent failures into one vague item. Do not call the overall project complete while any open item
has missing evidence or a reproducible defect.

## Current known queue to preserve until re-proven

The current register already contains the full SA-0.1–SA-5.5, LA-0, LA-1, database, and LA-2 queue.
Important categories that must remain visible until closed include:

- live Supabase schema, grant, policy, function, trigger, and DDL-authority drift;
- missing atomic usage/screening RPCs and stale security-definer functions;
- incomplete authenticated role/session, MFA, tenant-isolation, and mobile browser evidence;
- user-admin lifecycle, owner-preservation, invitation, reset, and scale gaps;
- plan/version, add-on, usage, subscription, billing, refund, coupon, revenue, and checkout gaps;
- settings, offers, templates, compliance, credits, email, legal, maintenance, and signup gaps;
- LA-0 commission/ledger and live contact-model gaps;
- LA-1 conditional form preview, screening/rejected-submission accounting, browser notifications,
  partner-quality browser evidence, and SLA/SA-6 dependency gaps;
- LA-2 import/scrub, calling-window UI, dialer eligibility/local-time/consent/selection-reason,
  callback/reminder, roster/scorecard/close-out, vendor/provider, performance, storage, legal-statute,
  and task-definition gaps.

The current dialer correction is also part of the queue: `/app/dialer` now has server-backed eligibility,
local time, consent, disclosure, history, and gated click behavior. Its disposition flow uses the reviewed
additive `complete_existing_dial_disposition` contract and fails closed until that RPC is live. Selection
reason rendering and authenticated browser evidence remain open.

Continue until every item is either fixed and re-proven or explicitly retained as a genuine external,
legal, provider, deployment, DDL-authority, or user-decision blocker with an owner and next action.

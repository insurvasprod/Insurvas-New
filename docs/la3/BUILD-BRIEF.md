# LA-3 build brief — for everyone wiring an LA-3 screen to real data

The Design phase is done: every screen exists and reads typed fixtures. The Build phase makes each
one read and write the real database through the API. Read `docs/la3/DESIGN-BRIEF.md` (the UI rules
still bind), `docs/la3/STATUS-MODEL.md` (statuses) and `docs/la3/SCHEMA-PLAN.md` (tables — plus the
actual SQL in `supabase/migrations/20260926100*_la_3_*.sql`, which is the truth where they differ).

## Server-side patterns (copy them; do not invent new ones)

| Need | Use |
|---|---|
| DB access | `db()` from `lib/applications/db.ts` (loose service client). **Every query carries `.eq("tenant_id", tenantId)`** — the service client bypasses RLS. Platform rows: `.or(\`tenant_id.is.null,tenant_id.eq.${tenantId}\`)`. |
| Missing tables (migration not applied yet) | `isMissingSchema(error)` → throw `SchemaPendingError("…")`; reads of optional tables return `[]` |
| Errors | throw `ApplicationError(code, message, status)`; routes return `failure(error)` from `lib/applications/http.ts` |
| Route shape | `actorFor(request, featureKey, { write })` → `body(request, zodSchema)` → service → `NextResponse.json`. Model: `app/api/app/applications/attempts/[id]/values/route.ts` |
| Zod | strict schemas in `lib/applications/schemas.ts` style (put NEW schemas in your own `lib/applications/<domain>Schemas.ts`) |
| Sensitive values | encrypt with `encryptSensitive`/`decryptSensitive` (`lib/applications/crypto.ts`); reveal writes `tenant_sensitive_access_log` + `audit()` first (see `revealField` in `lib/applications/mutations.ts`) |
| Status changes | only through the `application_transition` RPC (see `transition()` in mutations.ts). Never `update … set status` on `tenant_applications`. |
| Audit | `audit({ actorType: "tenant", actorId, action, targetType, targetId, metadata, request })`. The action must be in `lib/audit/actions.ts`. |
| Client → API | the workspace uses `useWorkspace().actions` (`components/app/applications/workspace/context.tsx`); list pages fetch their route with `cache: "no-store"` and show `SectionLoading` / `ErrorState` |
| Server page data | pages may call the service directly (see `app/app/(shell)/applications/[caseId]/page.tsx`): SchemaPending → `<SetupPending title=… />`; not found → `notFound()`; `?preview=sample` + non-production → fixtures |

Roles for everything in the Sell area: `owner`, `producer`. Feature flags: `applications` for the
workflow (including the in-workspace quote and draft-day saves), `quoting` for the standalone Quotes
list, `draft_date_optimizer` for the standalone calculator, `sales_report`, `carrier_extension`.

## Shared files — do NOT edit (others are working beside you)

`lib/entitlements/agentApiPolicy.ts`, `lib/audit/actions.ts`, `lib/menu/definition.ts`,
`lib/settings/sections.ts`, `components/app/agent-settings-tabs.tsx`, `lib/applications/{constants,types,db,http,crypto,service,mutations,schemas,qa}.ts`,
`components/app/applications/workspace/context.tsx`, `components/app/applications/parts.tsx`, migrations.

Put new server logic in NEW files (`lib/applications/<domain>.ts`). In your report, list exactly:
the `agentApiPolicy` lines to add, the audit actions to add (key + label), and anything you needed
from a shared file (I will make the change).

## Rules that are easy to get wrong

- Money is integer cents end to end; no float; `parseDollarsToCents` from `lib/money.ts` on input.
- Nothing is deleted or overwritten that the spec says is kept: discarded quotes, declined attempts,
  counteroffers, submissions, confirmation files, acknowledged disclosures.
- A failed save keeps what was typed on screen and says so (a one-line error), never silently drops it.
- Sensitive values never appear in a list payload, a log line, or a bulk extension payload.
- Keep the fixtures working behind `sample` (the design preview must still render at `?preview=sample`).

## Checks before you report

From PowerShell (Bash cannot find node):

```
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.la3check.json
node node_modules/eslint/bin/eslint.js <every file you created or changed>
node --experimental-strip-types --test <any test file you added>
```

`tsconfig.la3check.json` skips the dev server's half-written `.next` types. Check `$LASTEXITCODE`.
Do not run `npm run build` (it clobbers the running dev server's `.next`), do not start a dev server,
do not commit.

# Insurvas — Super Admin

Control plane for the Insurvas platform. Built against the `SA-x.y` tickets in the Notion
"Insurvas Sprint" database.

Next.js 16 (App Router) · Tailwind v4 · shadcn/ui · Supabase (Postgres).

## The two planes

The split that shapes the whole codebase:

| | Control plane | Tenant plane |
|---|---|---|
| Route prefix | `/admin` | `/app` |
| Who | Insurvas staff | Customers |
| Identity table | `admin_users` | `users` + `tenant_users` |
| Session cookie | `insurvas_admin_session` | `insurvas_tenant_session` |
| Signing secret | `ADMIN_SESSION_SECRET` | `TENANT_SESSION_SECRET` |
| Gate | `requireAdminRole()` | `requireTenant()` |

Separate cookies **and separate signing secrets**, so one session type can never be forged into
the other. Neither uses Supabase Auth.

Both gates resolve role and account state from the database on every request rather than trusting
the token, so deactivating or demoting someone takes effect on their next request instead of at
token expiry.

## Status

**M0 (SA-0.1 – 0.3)** and **M1 (SA-1.1 – 1.5)** are code-complete: admin auth with mandatory TOTP
2FA, the multi-tenant data model with row-level security, an append-only audit log, and the full
user lifecycle (list, create-by-invite, edit, suspend, login activity).

See [`docs/backlog.md`](docs/backlog.md) for everything deliberately deferred, descoped or left
unverified — including what has and hasn't been checked in a browser.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run seed:super-admin     # prints a QR code — 2FA is mandatory
npm run dev
```

`/` redirects to `/admin/login`.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm run seed:super-admin` | Creates the first `super_admin`. No-op if any admin exists. |
| `npm run reset:totp -- <email>` | New TOTP secret for an admin who lost their authenticator |
| `npm run verify:tenant-isolation` | Provisions two tenants and proves, at the Postgres level, that neither can see the other's rows. Cleans up after itself. |

## Notes for anyone picking this up

- **Row-level security is real, not application-layer filtering.** Tenant-plane reads go through
  the `tenant_app` Postgres role (`TENANT_DB_URL`), which does *not* bypass RLS. The service-role
  client is used only where there is no tenant scope yet — login, and the admin panel.
- **Tenant scope comes only from the session**, never from a request parameter.
- **The audit log is append-only at the database level.** `UPDATE`, `DELETE` and `TRUNCATE` are
  revoked from every role the app connects as, including `service_role`.
- **Email isn't wired up yet.** `lib/email/sendInvitationEmail.ts` logs and returns
  `delivered: false`; the admin UI shows a copyable link instead. SA-4.11 replaces those function
  bodies — no callers change.

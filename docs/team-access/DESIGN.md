# Custom team access — design (proposal, 2026-10-20)

**Status:** approved 2026-10-20 and built (Notion AG-1.13; LA-0.2 and LA-8.6 amended). The code is uncommitted.
Migration `20261020500000_team_access_extra_roles.sql` has been rehearsed and is awaiting apply. The add-on is created
inactive at price 0; the owner sets its price in SA-2.

**As built.** A gate acts as the member's main role when that role is allowed. Otherwise it acts as the widest extra
role it allows (producer, bookkeeper, retention, assistant, setter): `actingRole` in `lib/tenantAuth/teamAccess.ts`
and `tenant_member_acting_role` in SQL. Everything after the gate then runs as for a single-role member.

## The problem

Agencies staff differently. One agency has a person per job; another has one person doing two or three (a producer
who also does the books; an assistant who also sets appointments). Today a member holds exactly one role, so the
second agency cannot model its people.

## The decision: roles stay the building block — a member can hold several, and the owner can hide pages

| | Today | With the add-on |
|---|---|---|
| Roles per member | exactly one | **one main role + any extra roles** |
| What a member can do | what that role can do | **the union** of their roles |
| Which pages a member sees | every page their role allows | the same, **minus pages the owner hides** for them |
| Saved combinations | — | **presets** ("Producer + books", "Assistant + setter"), picked at invite |
| Where it is managed | Settings › Team | **Settings › Team, in the app** (not the admin console): every member and pending invite on one screen |

Why not "tick any permission for any person": the app checks roles in ~750 places (347 API routes, 75 pages, 256
direct comparisons) and in 73 database migrations. Free-form permissions would mean rewriting all of them, and every
miss is a person seeing money or another producer's clients. Combining existing roles reuses every check that is
already tested — including the AG-0.5 isolation gate — so the flexibility is new but the safety is not.

## Rules (guardrails)

1. **Roles are still defined once** (LA-0.2 / AG-0.2's matrix). The add-on combines them; it never invents a permission.
2. **Extra roles are working roles only**: producer, assistant, bookkeeper, setter, retention. Owner and the agency
   admin/manager titles are never "extra" — they stay the main role, so every "is this the owner?" check is unchanged.
3. **Hiding only removes.** Hiding a page takes it out of the menu and the page answers with a notice. Giving more
   access is done by adding a role, never by un-hiding something the roles do not allow.
4. **Money is called out.** When a combination can see money (e.g. assistant + bookkeeper), the screen says so in one
   line before saving: "This person will see commissions and pay."
5. **Visibility follows the widest role** (AG-0.4): a producer who is also the bookkeeper sees the whole agency's
   money, because the bookkeeper does. The screen shows what each combination can see.
6. **Billing stays the billing owner's.** An admin can set roles and views for others but cannot grant billing, and
   cannot change their own access.
7. **One person is one seat**, however many roles they hold (AG-0.6 bands unchanged).
8. **Every change is audited** (LA-8.8): who changed whose roles or views, from what to what.

## Without the add-on

Exactly today's behaviour: one role per member, no hidden pages. The add-on is a feature key (`custom_team_access`)
sold through SA-2's add-on catalogue; the Super Admin turns it on per plan or per tenant.

## The screen (Settings › Team)

One list: active members and pending invitations together.

| Column | |
|---|---|
| Person | name, email, invited / active / suspended |
| Main role | the role today |
| Extra roles | chips; add or remove |
| View | "Standard" or a preset name, or "Custom · 3 pages hidden" |
| Seat | holds a seat or not |
| Actions | edit access, resend or revoke an invite, deactivate |

**Edit access** opens a panel: main role, extra roles, then the pages grouped by menu section with a checkbox each
(only pages their roles allow are listed; unticking hides it). A summary at the top states what this person can see —
money or not, whose rows (own / their reports / assigned producers / everyone).

**Invite** uses the same panel, so a person arrives with the right access on day one.

**Presets** — the owner saves a combination under a name and picks it when inviting.

## Build phases

1. **Foundation (security first)** — `tenant_users.extra_roles` and `hidden_pages`; the session carries every role;
   the shared gates (`requireFeatureRole`, `requireTenant`, `guardPage`, the menu) accept any of the member's roles;
   the 75 page gates move to one helper; the database role checks that a combined role would hit are patched through
   one SQL helper; AG-0.4 visibility takes the widest role. The isolation gate and its live check run with combined
   roles before anything ships.
2. **The Team screen** — member + invite list, the access panel, presets, the money warning, audit rows.
3. **The add-on** — feature key, SA-2 catalogue entry, gating, Notion spec, live end-to-end check.

## Notion amendments this needs (owner decision)

- LA-0.2 "Out of scope: Custom roles or per-permission toggles" → custom *combinations of existing roles* and
  per-member page hiding are in scope as an add-on; free-form permissions stay out.
- LA-8.6 → Team & seats also sets extra roles, hidden pages and presets; still defines no permission.
- New task (AG-2.1 or LA-8.9) holding this design.

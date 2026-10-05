# LA-8: Agency tier

**Plan:** `agency`, displayed as **Agency**: $799/month + $79 per producer seat, and $29 per assistant seat. See the [roadmap](../roadmap/ROADMAP.md).

**Phase gate:**
- A 3-producer agency runs on one tenant, with overrides and splits paid correctly.
- Each producer sees only their own book and commissions.
- Assistants never see money.

**Today:**
- `BUILDABLE_PLAN_TYPES = ["individual"]` (`lib/plans/constants.ts`).
- Every plan has `max_seats: 1`, and the `agency` feature module has no features.
- The roles `owner`, `producer`, `assistant`, `bookkeeper` and `setter` exist (`lib/tenantAuth/roles.ts`), as do seat counting (`lib/tenantTeam/seats.ts`) and the invite seat check (backlog 200).
- There is no hierarchy, no splits, and no assistant-seat price.

**The data model was designed for this from day one:** `tenant_users` is a join table with a role, and every table carries `tenant_id`.

**Status of this file:** written from the product docs; re-verify paths at the start of the phase.

---

## LA-8.1: Agency plan and seat pricing

**Scope:**
- Allow the `agency` plan type in the plan builder.
- Seed an Agency plan version: Advanced features plus the agency module, `max_seats` set, and per-seat prices for producer and assistant.
- Seat add and remove goes through Whop quantity, mirrored in the entitlement.

**Acceptance:**
- Adding a seat beyond the paid quantity is refused with an upgrade path.
- The entitlement JSON carries the seat limits per role.
- Individual plans are unchanged.

## LA-8.2: Producers and hierarchy

**Scope:**
- A producer tree inside one tenant: upline and downline, with an effective date.
- The Team settings section becomes data-driven under the UX phase.

**Acceptance:**
- A producer sees their own and their downline's book, never a sibling's.
- Moving a producer in the tree takes effect on a date, and history is kept.
- Tested with tenant A / tenant B and sibling-isolation tests.

## LA-8.3: Overrides and commission splits

**Scope:**
- **Overrides:** the upline earns the difference between contract levels.
- **Splits:** a policy shared by percentage between producers.
- Both feed the money spine (LA-7.1) and the ledger.

**Acceptance:**
- For any policy, the split shares and the override amounts add up to the carrier commission, to the cent.
- Statements reconcile per producer.

## LA-8.4: Team QA and dashboards

**Scope:** the owner sees per-producer:
- production;
- persistency (LA-4.8);
- lapse risk (LA-5);
- NIGO rate;
- application QA outcomes (from the LA-3.11 frozen verdicts).

**Acceptance:**
- Producers see only themselves.
- Assistants see counts but no dollar amounts.
- Figures equal the per-producer module totals.

## LA-8.5: Assistant seats

**Scope:**
- A cheaper seat type for virtual assistants: data entry, leads, calendar, callbacks.
- Money is hidden everywhere: this is already enforced by role; this task adds the pricing and seat accounting.

**Acceptance:**
- An assistant seat counts against the assistant quantity, not the producer quantity.
- The money-routes test covers every new route.

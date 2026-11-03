-- LA-2.7 · the cadence unique key does not do what it says.
--
-- `tenant_cadence_rules` declares:
--
--     unique (tenant_id, campaign_id, attempt_number, disposition_scope)
--
-- which reads as "one rule per attempt per scope". It is not, because Postgres treats NULLs in a
-- unique index as distinct from each other. A tenant-default rule carries NULL in `campaign_id`
-- and a catch-all rule carries NULL in `disposition_scope`, so the most common row in the table —
-- "attempt 1, every campaign, every outcome" — can be inserted any number of times and the
-- constraint is satisfied every time.
--
-- Verified against the live project on 2026-09-23: inserting the identical row twice was accepted.
--
-- The damage is quiet rather than loud. `schedule_next_attempt` resolves the rule with
--
--     order by (r.campaign_id is not null) desc, (r.disposition_scope is not null) desc
--     limit 1
--
-- and duplicates tie on both keys, so the delay for that attempt becomes whichever row the planner
-- happens to return. The cadence is not wrong; it is undecided, and it can decide differently on
-- two identical leads.
--
-- `nulls not distinct` (Postgres 15+) makes the declared key mean what it reads as. The API route
-- at app/api/app/cadence/route.ts refuses duplicates before they are sent, and keeps doing so —
-- it can name the attempt in a message, which a constraint violation cannot — but until this runs
-- it is the only thing standing between the scheduler and an ambiguous cadence, and anything that
-- writes this table without going through it can still produce one.

alter table public.tenant_cadence_rules
  drop constraint if exists tenant_cadence_rules_tenant_id_campaign_id_attempt_number_dis_key;

-- Any duplicates already stored have to go before the stricter key can be created. The newest row
-- for each (tenant, campaign, attempt, disposition) is kept: a duplicate is almost always someone
-- re-adding a rule they could not see, so the later one is the one they meant.
delete from public.tenant_cadence_rules a
 using public.tenant_cadence_rules b
 where a.tenant_id = b.tenant_id
   and a.campaign_id is not distinct from b.campaign_id
   and a.attempt_number = b.attempt_number
   and a.disposition_scope is not distinct from b.disposition_scope
   and (a.created_at, a.id) < (b.created_at, b.id);

alter table public.tenant_cadence_rules
  add constraint tenant_cadence_rules_one_rule_per_attempt
  unique nulls not distinct (tenant_id, campaign_id, attempt_number, disposition_scope);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_cadence_rules'::regclass
       and conname = 'tenant_cadence_rules_one_rule_per_attempt'
  ) then
    raise exception 'the cadence uniqueness constraint was not created';
  end if;
end;
$$;

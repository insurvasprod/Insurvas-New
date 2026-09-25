-- SA-2.2: keep the compatibility plan model's individual seat invariant live.
--
-- The original trigger was created before plan_limits existed in the shared project, so the
-- function survived but the trigger did not. Recreate both additively and backfill only missing
-- defaults. Existing explicit limits are preserved.

create or replace function public.seed_individual_plan_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.plan_type = 'individual' then
    insert into public.plan_limits (plan_id, max_seats)
    values (new.id, 1)
    on conflict (plan_id) do nothing;
  end if;
  return new;
end;
$$;

revoke execute on function public.seed_individual_plan_defaults() from public;

drop trigger if exists plans_individual_defaults on public.plans;

create trigger plans_individual_defaults
after insert on public.plans
for each row
execute function public.seed_individual_plan_defaults();

insert into public.plan_limits (plan_id, max_seats)
select p.id, 1
from public.plans p
where p.plan_type = 'individual'
on conflict (plan_id) do nothing;

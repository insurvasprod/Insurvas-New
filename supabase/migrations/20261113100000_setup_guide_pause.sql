-- Guided setup, round 3 (owner 2026-11-13): Ready to sell's steps are required and have no Skip, only Pause.
-- Where a person paused (the step and the move inside it) is kept on their own walkthrough row, so Get set up
-- and the step's page offer Resume on any device, not only in the browser that paused.
--
-- Two nullable columns on public.tenant_setup_guide; null = nothing paused. Written only by /api/app/setup
-- (service role, filtered by the session's tenant and user), like the rest of the row. No grant changes:
-- service_role keeps select, insert, update from 20261022100000.
--
-- Rollback:
--   alter table public.tenant_setup_guide drop constraint if exists tenant_setup_guide_pause_valid;
--   alter table public.tenant_setup_guide drop column if exists paused_move, drop column if exists paused_step;

alter table public.tenant_setup_guide
  add column if not exists paused_step text,
  add column if not exists paused_move smallint;

alter table public.tenant_setup_guide drop constraint if exists tenant_setup_guide_pause_valid;
alter table public.tenant_setup_guide add constraint tenant_setup_guide_pause_valid check (
  (paused_step is null and paused_move is null)
  or (paused_step ~ '^[a-z0-9-]{1,40}$' and paused_move between 0 and 49)
);

do $check$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tenant_setup_guide' and column_name in ('paused_step', 'paused_move')
    group by table_name having count(*) = 2
  ) then
    raise exception 'tenant_setup_guide: pause columns missing';
  end if;
  if has_table_privilege('service_role', 'public.tenant_setup_guide', 'delete') then
    raise exception 'tenant_setup_guide: service_role can still delete';
  end if;
end;
$check$;

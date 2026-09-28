-- LA-2.5-5 — "Speed to lead (arrival -> first dial)": first_dial_at is the first Dial CLICK.
--
-- serve_next_lead and serve_lead_by_id stamped agent_leads.first_dial_at when a lead was SERVED, so
-- every reader of it (tenant_vendor_speed_to_lead, tenant_speed_to_lead, the outbound speed rollups,
-- outbound_cost_analysis) measured arrival → served, and a lead served but never dialled counted as
-- dialled. 20260925709720 measured the campaign view from the attempts' dial_clicked_at instead;
-- this makes the column itself mean what its name says, for every reader.
--
--   · the two serve functions stop stamping it (the one line is removed in place);
--   · a trigger on tenant_call_attempts sets it to the lead's FIRST dial_clicked_at, when that click
--     is recorded (markDialClicked stamps dial_clicked_at only after every dial gate passed). The
--     first click overwrites a serve-time stamp left by the old code, so a lead dialled from now on
--     is exact; values already written for leads never dialled since are left alone (no backfill:
--     an agent_leads UPDATE fires the touch trigger on every row it touches).
--
-- The app's refused-lead handback (lib/dialerScripts/service.ts returnRefusedLead) already treats
-- "never dialled" as attempts_made = 0, so it is correct before and after this file.

set local lock_timeout = '5s';

-- ── the stamp moves to the click ─────────────────────────────────────────────────────────────
create or replace function public.tenant_call_attempts_first_dial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- Only the moment a click is first recorded on this attempt.
  if tg_op = 'UPDATE' and old.dial_clicked_at is not null then return null; end if;
  update public.agent_leads l
     set first_dial_at = new.dial_clicked_at
   where l.id = new.lead_id
     and l.tenant_id = new.tenant_id
     and l.first_dial_at is distinct from new.dial_clicked_at
     -- the lead's first click, not a later one
     and not exists (select 1 from public.tenant_call_attempts a
                      where a.tenant_id = new.tenant_id and a.lead_id = new.lead_id and a.id <> new.id
                        and a.dial_clicked_at is not null and a.dial_clicked_at <= new.dial_clicked_at);
  return null;
end;
$function$;

-- CREATE OR REPLACE, not DROP + CREATE: DROP TRIGGER takes ACCESS EXCLUSIVE on a busy table.
create or replace trigger tenant_call_attempts_first_dial
  after insert or update of dial_clicked_at on public.tenant_call_attempts
  for each row
  when (new.dial_clicked_at is not null)
  execute function public.tenant_call_attempts_first_dial();

-- ── the serve functions stop stamping it ─────────────────────────────────────────────────────
do $patch$
declare
  v_sig text;
  v_src text;
  v_new text;
begin
  foreach v_sig in array array['public.serve_next_lead(uuid,uuid)', 'public.serve_lead_by_id(uuid,uuid,uuid)'] loop
    select replace(pg_get_functiondef(v_sig::regprocedure), E'\r\n', E'\n') into v_src;
    if v_src not like '%first_dial_at = coalesce(l.first_dial_at, v_now)%' then
      raise notice '% no longer stamps first_dial_at; nothing to do', v_sig;
      continue;
    end if;
    v_new := replace(
      v_src,
      E'         first_dial_at = coalesce(l.first_dial_at, v_now),\n',
      E'         -- [711500] first_dial_at is the first Dial click (trigger on tenant_call_attempts), not the serve.\n'
    );
    if v_new = v_src then
      raise exception '%: the first_dial_at line this patch anchors on was not found', v_sig;
    end if;
    execute v_new;
    raise notice '% no longer stamps first_dial_at at serve', v_sig;
  end loop;
end;
$patch$;

-- ── Nothing else changed ─────────────────────────────────────────────────────────────────────
do $check$
declare
  v_serve text := replace(pg_get_functiondef('public.serve_next_lead(uuid,uuid)'::regprocedure), E'\r\n', E'\n');
  v_byid text := replace(pg_get_functiondef('public.serve_lead_by_id(uuid,uuid,uuid)'::regprocedure), E'\r\n', E'\n');
begin
  if v_serve like '%first_dial_at = coalesce%' or v_byid like '%first_dial_at = coalesce%' then
    raise exception '711500 check: a serve function still stamps first_dial_at';
  end if;
  if v_serve not like '%lead_state = ''working''%' or v_byid not like '%lead_state = ''working''%' then
    raise exception '711500 check: a serve function lost its working-state update';
  end if;
  if v_serve not like '%serve_eligible%' or v_serve not like '%agent_can_take_pool_lead%' or v_serve not like '%tenant_scoring_decisions%' then
    raise exception '711500 check: serve_next_lead lost part of 711400';
  end if;
  if v_byid not like '%[711400]%' then raise exception '711500 check: serve_lead_by_id lost its 711400 tier rule'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'tenant_call_attempts_first_dial') then
    raise exception '711500 check: the first-dial trigger is missing';
  end if;
end;
$check$;

-- LA-4.20 (Notion sprint) · traceability: every figure back to the row of the file it came from.
--
-- The chain already exists as keys — policy_current → policy_snapshot → raw_rows → file_registry,
-- and commission_entry → raw_rows → file_registry. What this adds is the check that it holds:
--
--   trace_problems(tenant)   every figure an LA-4 screen shows that does NOT resolve to a source row,
--                            with the screen, the figure and why. One definition, used twice:
--                              · the Discrepancies screen withholds any item listed here (an
--                                unverifiable accusation is worse than silence);
--                              · the scheduled health check counts and records them.
--   trace_health_check       one row per run: figures checked, figures untraceable, and the detail
--                            (per screen, plus the first fifty problems). Internal: no agency reads it.
--   run_trace_health_check() the run (pg_cron, daily 07:45 UTC).
--
-- What is checked:
--   Policies       a current row whose snapshot has no raw row, or whose raw row or file is gone.
--   Ledger         a commission line whose raw row or file is gone.
--   Rate card      an expected figure without the rate-card row (and band) it was priced from.
--   Discrepancies  an open item whose reported lines are not all in the ledger (or that has none
--                  when its kind needs some), whose rate-card row is gone, whose policy is not in
--                  the book, or (account items) whose carrier statement is not on file.
-- Scorecards, the call list and the summary are computed from these same rows, so they inherit it.
--
-- Additive. Requires 20261008100000..20261008280000.
--
-- Rollback:
--   select cron.unschedule('la4-trace-health-daily');
--   drop function if exists public.run_trace_health_check();
--   drop function if exists public.trace_problems(uuid);
--   drop table if exists public.trace_health_check;

create table if not exists public.trace_health_check (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  figures_checked bigint not null,
  figures_untraceable bigint not null,
  detail jsonb not null default '{}'::jsonb,
  constraint trace_health_check_counts check (figures_checked >= 0 and figures_untraceable >= 0 and figures_untraceable <= figures_checked)
);
create index if not exists trace_health_check_run_idx on public.trace_health_check (run_at desc);

create or replace function public.trace_problems(p_tenant_id uuid default null)
returns table (tenant_id uuid, screen text, figure text, subject text, reason text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Policies: the current row's snapshot, its raw row, its file.
  select pc.tenant_id, 'policies', 'status and premium', pc.carrier_id::text || ':' || pc.policy_number,
         case when s.raw_row_id is null then 'its snapshot names no raw row'
              when not exists (select 1 from public.raw_rows r where r.id = s.raw_row_id and r.file_id = s.file_id and r.tenant_id = s.tenant_id) then 'its raw row is gone'
              else 'its file is gone' end
    from public.policy_current pc
    join public.policy_snapshot s on s.id = pc.snapshot_id
   where (p_tenant_id is null or pc.tenant_id = p_tenant_id)
     and (s.raw_row_id is null
          or not exists (select 1 from public.raw_rows r where r.id = s.raw_row_id and r.file_id = s.file_id and r.tenant_id = s.tenant_id)
          or not exists (select 1 from public.file_registry f where f.id = s.file_id))
  union all
  -- Ledger: every commission line, to its raw row and file.
  select e.tenant_id, 'ledger', e.entry_type || ' ' || e.amount_cents::text, e.id::text,
         case when not exists (select 1 from public.file_registry f where f.id = e.file_id) then 'its file is gone' else 'its raw row is gone' end
    from public.commission_entry e
   where (p_tenant_id is null or e.tenant_id = p_tenant_id)
     and (not exists (select 1 from public.raw_rows r where r.id = e.raw_row_id and r.file_id = e.file_id and r.tenant_id = e.tenant_id)
          or not exists (select 1 from public.file_registry f where f.id = e.file_id))
  union all
  -- Rate card: an expected figure, to the schedule row (and band) that priced it.
  select x.tenant_id, 'rate_card', 'expected ' || x.expected_amount_cents::text, x.carrier_id::text || ':' || x.policy_number || ':' || x.policy_year::text,
         case when x.schedule_id is null then 'it names no rate-card row'
              when not exists (select 1 from public.commission_schedules cs where cs.id = x.schedule_id) then 'its rate-card row is gone'
              else 'its age band is gone' end
    from public.expected_commission x
   where (p_tenant_id is null or x.tenant_id = p_tenant_id)
     and x.expected_amount_cents is not null
     and (x.schedule_id is null
          or not exists (select 1 from public.commission_schedules cs where cs.id = x.schedule_id)
          or (x.band_id is not null and not exists (select 1 from public.commission_schedule_band b where b.id = x.band_id)))
  union all
  -- Discrepancies: both sides.
  select d.tenant_id, 'discrepancies', d.discrepancy_type || ' ' || coalesce(d.policy_number, 'account'), d.id::text,
         case
           when exists (select 1 from unnest(coalesce(d.reported_entry_ids, '{}'::uuid[])) as id(v)
                         where not exists (select 1 from public.commission_entry e where e.id = id.v and e.tenant_id = d.tenant_id))
             then 'a reported line is not in the ledger'
           when d.discrepancy_type in ('mis_rated', 'duplicate_chargeback', 'unexpected_chargeback', 'missing_chargeback') and coalesce(cardinality(d.reported_entry_ids), 0) = 0
             then 'it names no ledger line'
           when d.discrepancy_type in ('short_paid', 'over_paid') and coalesce(d.reported_amount_cents, 0) <> 0 and coalesce(cardinality(d.reported_entry_ids), 0) = 0
             then 'its paid amount names no ledger line'
           when d.expected_source ? 'schedule_id' and not exists (select 1 from public.commission_schedules cs where cs.id::text = d.expected_source->>'schedule_id')
             then 'its rate-card row is gone'
           when d.discrepancy_type in ('held_building_up', 'debit_balance_growing')
             then 'its carrier statement is not on file'
           else 'its policy is not in the book'
         end
    from public.commission_discrepancy d
   where (p_tenant_id is null or d.tenant_id = p_tenant_id)
     and d.status in ('open', 'disputed')
     and (
       exists (select 1 from unnest(coalesce(d.reported_entry_ids, '{}'::uuid[])) as id(v)
                where not exists (select 1 from public.commission_entry e where e.id = id.v and e.tenant_id = d.tenant_id))
       or (d.discrepancy_type in ('mis_rated', 'duplicate_chargeback', 'unexpected_chargeback', 'missing_chargeback') and coalesce(cardinality(d.reported_entry_ids), 0) = 0)
       or (d.discrepancy_type in ('short_paid', 'over_paid') and coalesce(d.reported_amount_cents, 0) <> 0 and coalesce(cardinality(d.reported_entry_ids), 0) = 0)
       or (d.expected_source ? 'schedule_id' and not exists (select 1 from public.commission_schedules cs where cs.id::text = d.expected_source->>'schedule_id'))
       or (d.discrepancy_type in ('held_building_up', 'debit_balance_growing')
           and not exists (select 1 from public.carrier_account_statement st where st.tenant_id = d.tenant_id and st.carrier_id = d.carrier_id
                            and st.statement_date::text = d.evidence->>'statement_date'))
       or (d.discrepancy_type not in ('held_building_up', 'debit_balance_growing') and d.policy_number is not null
           and not exists (select 1 from public.policy_current pc where pc.tenant_id = d.tenant_id and pc.carrier_id = d.carrier_id and pc.policy_number = d.policy_number)
           and not exists (select 1 from public.commission_entry e where e.tenant_id = d.tenant_id and e.carrier_id = d.carrier_id and e.policy_number = d.policy_number))
     );
$$;

create or replace function public.run_trace_health_check()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_checked bigint;
  v_untraceable bigint;
  v_detail jsonb;
begin
  select (select count(*) from public.policy_current)
       + (select count(*) from public.commission_entry)
       + (select count(*) from public.expected_commission where expected_amount_cents is not null)
       + (select count(*) from public.commission_discrepancy where status in ('open', 'disputed'))
    into v_checked;
  with problems as (select * from public.trace_problems(null))
  select count(*),
         jsonb_build_object(
           'by_screen', coalesce((select jsonb_object_agg(screen, n) from (select screen, count(*) as n from problems group by screen) s), '{}'::jsonb),
           'problems', coalesce((select jsonb_agg(jsonb_build_object('tenant_id', p.tenant_id, 'screen', p.screen, 'figure', p.figure, 'subject', p.subject, 'reason', p.reason)) from (select * from problems order by screen, subject limit 50) p), '[]'::jsonb))
    into v_untraceable, v_detail
    from problems;
  insert into public.trace_health_check (figures_checked, figures_untraceable, detail) values (v_checked, v_untraceable, v_detail);
  return jsonb_build_object('checked', v_checked, 'untraceable', v_untraceable) || v_detail;
end;
$$;

-- ─── access ─────────────────────────────────────────────────────────────────────────────────────
alter table public.trace_health_check enable row level security;
revoke all on public.trace_health_check from public, anon, authenticated, tenant_app;
revoke update, delete, truncate on public.trace_health_check from service_role;
grant select, insert on public.trace_health_check to service_role;
revoke all on function public.trace_problems(uuid) from public, anon, authenticated;
revoke all on function public.run_trace_health_check() from public, anon, authenticated;
grant execute on function public.trace_problems(uuid) to service_role;
grant execute on function public.run_trace_health_check() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('la4-trace-health-daily', '45 7 * * *', $cron$select public.run_trace_health_check()$cron$);
    exception when others then
      raise notice '20261008290000: the daily trace health check could not be scheduled (%).', sqlerrm;
    end;
  end if;
end $$;

-- Run it the way the job will. It reports, it doesn't refuse: an untraceable figure is a defect to
-- fix, not a reason to leave the check uninstalled.
do $$
declare
  v jsonb;
begin
  v := public.run_trace_health_check();
  if v ? 'untraceable' is not true then
    raise exception '20261008290000: the trace health check did not report';
  end if;
  raise notice '20261008290000: % figures checked, % untraceable.', v->>'checked', v->>'untraceable';
  if has_table_privilege('service_role', 'public.trace_health_check', 'DELETE') or has_table_privilege('tenant_app', 'public.trace_health_check', 'SELECT') then
    raise exception '20261008290000: the health check is internal and append-only';
  end if;
end $$;

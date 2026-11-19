-- Pre-counted figures (speed pass 2026-11-18).
--
-- Some pages recount an agency's whole book on every open: the campaign funnel counts every lead's
-- dial, contact and quote (0.7–4.3 s on the demo agency's 15,649 leads), the vendor cards run the
-- all-time scorecard (2–4 s), and the returns summary and undialable rates scan every import.
-- The figures move a few times an hour, so counting them on every open is wasted work.
--
-- This file keeps each figure ready in `tenant_precount`, as the JSON the app already reads:
--   * precount_get(tenant, key, args) returns the saved figure. A figure missing, or older than
--     p_max_age_seconds, is worked out there and then, saved and returned (the first open of the day
--     pays what every open paid before).
--   * precount_refresh_due(), run by pg_cron every minute, re-counts only figures someone read
--     recently: every minute while read in the last 30 minutes, every 15 minutes while read in the
--     last day, never otherwise. It stops after 25 seconds, so a busy minute cannot pile up.
--   * precount_forget(tenant, keys) drops figures after a write that changes them, so the next open
--     counts live instead of showing the old number.
-- Which figures may be kept is fixed in precount_compute: a key it does not know is refused.
-- Nothing reads the table directly: only these functions, as the service role.

create table if not exists public.tenant_precount (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null,
  args jsonb not null default '{}'::jsonb,
  payload jsonb not null,
  computed_at timestamptz not null default now(),
  read_at timestamptz not null default now(),
  compute_ms integer,
  primary key (tenant_id, key, args)
);

create index if not exists tenant_precount_due on public.tenant_precount (read_at desc, computed_at);

alter table public.tenant_precount enable row level security;
revoke all on table public.tenant_precount from public, anon, authenticated, tenant_app;
revoke insert, update, delete, truncate on table public.tenant_precount from service_role;
grant select on table public.tenant_precount to service_role;

-- The one place that knows how each figure is counted. Each branch calls the existing function the app
-- calls today, with the same arguments, so the saved figure is the live figure at computed_at.
create or replace function public.precount_compute(p_tenant_id uuid, p_key text, p_args jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_out jsonb;
begin
  if p_key = 'campaign_funnel' then
    select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) into v_out
      from public.tenant_campaign_funnel(p_tenant_id) f;
  elsif p_key = 'vendor_returns_summary' then
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_out
      from public.vendor_returns_candidates_summary(
        p_tenant_id,
        nullif(p_args ->> 'vendor_id', '')::uuid,
        nullif(p_args ->> 'campaign_id', '')::uuid) r;
  elsif p_key = 'vendor_undialable_rates' then
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_out
      from public.vendor_undialable_rates(p_tenant_id, nullif(p_args ->> 'vendor_id', '')::uuid) r;
  elsif p_key = 'vendor_scorecard_report' then
    v_out := to_jsonb(public.tenant_vendor_scorecard_report(
      p_tenant_id,
      nullif(p_args ->> 'from', '')::date,
      nullif(p_args ->> 'to', '')::date,
      nullif(p_args ->> 'vendor_id', '')::uuid,
      nullif(p_args ->> 'campaign_id', '')::uuid,
      nullif(p_args ->> 'product_code', ''),
      nullif(p_args ->> 'persist_days', '')::integer));
  else
    raise exception 'precount: unknown figure %', p_key using errcode = '22023';
  end if;
  return v_out;
end;
$function$;

create or replace function public.precount_get(
  p_tenant_id uuid,
  p_key text,
  p_args jsonb default '{}'::jsonb,
  p_max_age_seconds integer default 900
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $function$
declare
  v_args jsonb := coalesce(p_args, '{}'::jsonb);
  v_row public.tenant_precount%rowtype;
  v_started timestamptz;
  v_payload jsonb;
begin
  if p_tenant_id is null then
    raise exception 'precount: tenant is required' using errcode = '22023';
  end if;

  select * into v_row from public.tenant_precount t
   where t.tenant_id = p_tenant_id and t.key = p_key and t.args = v_args;

  if found and v_row.computed_at > now() - make_interval(secs => greatest(coalesce(p_max_age_seconds, 900), 0)) then
    -- Mark it read at most every five minutes: the refresh job only needs to know it is in use.
    if v_row.read_at < now() - interval '5 minutes' then
      update public.tenant_precount t set read_at = now()
       where t.tenant_id = p_tenant_id and t.key = p_key and t.args = v_args;
    end if;
    return v_row.payload;
  end if;

  v_started := clock_timestamp();
  v_payload := public.precount_compute(p_tenant_id, p_key, v_args);
  insert into public.tenant_precount as t (tenant_id, key, args, payload, computed_at, read_at, compute_ms)
  values (p_tenant_id, p_key, v_args, v_payload, now(), now(),
          (extract(epoch from clock_timestamp() - v_started) * 1000)::integer)
  on conflict (tenant_id, key, args) do update
     set payload = excluded.payload, computed_at = excluded.computed_at,
         read_at = excluded.read_at, compute_ms = excluded.compute_ms;
  return v_payload;
end;
$function$;

create or replace function public.precount_forget(p_tenant_id uuid, p_keys text[])
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_count integer;
begin
  delete from public.tenant_precount t
   where t.tenant_id = p_tenant_id and t.key = any(coalesce(p_keys, '{}'::text[]));
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

create or replace function public.precount_refresh_due()
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $function$
declare
  v_job_started timestamptz := clock_timestamp();
  v_started timestamptz;
  v_due record;
  v_done integer := 0;
begin
  -- Figures nobody has opened for a week are dropped; the next open counts them live.
  delete from public.tenant_precount where read_at < now() - interval '7 days';

  for v_due in
    select t.tenant_id, t.key, t.args
      from public.tenant_precount t
     where (t.read_at > now() - interval '30 minutes' and t.computed_at < now() - interval '55 seconds')
        or (t.read_at > now() - interval '1 day' and t.computed_at < now() - interval '15 minutes')
     order by t.computed_at
     limit 200
  loop
    exit when clock_timestamp() - v_job_started > interval '25 seconds';
    v_started := clock_timestamp();
    begin
      update public.tenant_precount t
         set payload = public.precount_compute(v_due.tenant_id, v_due.key, v_due.args),
             computed_at = now(),
             compute_ms = (extract(epoch from clock_timestamp() - v_started) * 1000)::integer
       where t.tenant_id = v_due.tenant_id and t.key = v_due.key and t.args = v_due.args;
      v_done := v_done + 1;
    exception when others then
      -- One agency's failing figure must not stop the others. It stays as it was, and the next
      -- open past p_max_age_seconds counts it live, where the error reaches the page.
      raise warning 'precount_refresh_due: % % failed: %', v_due.tenant_id, v_due.key, sqlerrm;
    end;
  end loop;
  return v_done;
end;
$function$;

revoke all on function public.precount_compute(uuid, text, jsonb) from public, anon, authenticated, tenant_app, service_role;
revoke all on function public.precount_get(uuid, text, jsonb, integer) from public, anon, authenticated, tenant_app;
revoke all on function public.precount_forget(uuid, text[]) from public, anon, authenticated, tenant_app;
revoke all on function public.precount_refresh_due() from public, anon, authenticated, tenant_app, service_role;
grant execute on function public.precount_get(uuid, text, jsonb, integer) to service_role;
grant execute on function public.precount_forget(uuid, text[]) to service_role;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '20261118100000: pg_cron is not enabled; figures are counted on open and never refreshed ahead.';
    return;
  end if;
  begin
    perform cron.schedule('precount-refresh', '* * * * *', $job$select public.precount_refresh_due()$job$);
  exception when others then
    raise notice '20261118100000: precount-refresh could not be scheduled (%).', sqlerrm;
  end;
end $$;

-- ── proof ──────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_live jsonb;
  v_kept jsonb;
  v_again jsonb;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20261118100000: proof skipped, % cannot create in public', current_user;
    return;
  end if;

  if has_table_privilege('service_role', 'public.tenant_precount', 'insert')
     or has_table_privilege('service_role', 'public.tenant_precount', 'update')
     or has_table_privilege('service_role', 'public.tenant_precount', 'delete')
     or has_table_privilege('tenant_app', 'public.tenant_precount', 'select') then
    raise exception 'tenant_precount must be written only through its functions';
  end if;
  if has_function_privilege('tenant_app', 'public.precount_get(uuid, text, jsonb, integer)', 'execute')
     or has_function_privilege('anon', 'public.precount_get(uuid, text, jsonb, integer)', 'execute')
     or has_function_privilege('service_role', 'public.precount_compute(uuid, text, jsonb)', 'execute') then
    raise exception 'a precount function is callable outside the service role';
  end if;

  -- The busiest agency with outbound leads: each kept figure equals the live one, and a second read
  -- returns the saved copy. All of it is rolled back.
  select l.tenant_id into v_tenant from agent_leads l where l.campaign_id is not null
   group by l.tenant_id order by count(*) desc limit 1;
  if v_tenant is null then
    raise notice '20261118100000: no outbound leads anywhere, comparison skipped';
    return;
  end if;

  begin
    select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) into v_live from public.tenant_campaign_funnel(v_tenant) f;
    v_kept := public.precount_get(v_tenant, 'campaign_funnel');
    if v_kept is distinct from v_live then
      raise exception 'the kept campaign funnel differs from the live one';
    end if;
    v_again := public.precount_get(v_tenant, 'campaign_funnel');
    if v_again is distinct from v_kept
       or (select count(*) from public.tenant_precount where tenant_id = v_tenant and key = 'campaign_funnel') <> 1 then
      raise exception 'a second read did not return the one saved campaign funnel';
    end if;

    perform public.precount_get(v_tenant, 'vendor_returns_summary');
    perform public.precount_get(v_tenant, 'vendor_undialable_rates');
    perform public.precount_get(v_tenant, 'vendor_scorecard_report',
      jsonb_build_object('from', '2000-01-01', 'to', current_date::text, 'persist_days', 60));

    update public.tenant_precount set computed_at = now() - interval '2 minutes' where tenant_id = v_tenant;
    if public.precount_refresh_due() < 1 then
      raise exception 'the refresh job re-counted nothing that was due';
    end if;
    if public.precount_forget(v_tenant, array['campaign_funnel']) <> 1 then
      raise exception 'forget did not drop the campaign funnel';
    end if;

    begin
      perform public.precount_get(v_tenant, 'no_such_figure');
      raise exception 'an unknown figure was not refused';
    exception when sqlstate '22023' then null;
    end;

    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
end $$;

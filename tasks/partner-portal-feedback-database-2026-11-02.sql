-- Partner portal feedback database changes for 2026-11-02.
-- Run this complete script in the target Supabase SQL Editor, or apply the four migration files in filename order with Supabase CLI.
-- Requires the existing Insurvas schema and roles used by this repository.

-- Migration 20261102180000_partner_pipeline_selector.sql
-- Partner pipeline selector: expose an agency's live pipeline configuration while keeping every
-- lead, count and facet inside the signed-in publisher/admin team's partner scope.
begin;

drop function if exists public.partner_lead_pipeline_page(uuid, uuid, date, date, uuid, text, uuid, text, text, integer, integer);
drop function if exists public.partner_lead_pipeline_page(uuid, uuid, date, date, uuid, text, uuid, text, text, integer, integer, uuid, uuid);

create or replace function public.partner_lead_pipeline_page(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_date_from date default null::date,
  p_date_to date default null::date,
  p_closer_id uuid default null::uuid,
  p_product text default null::text,
  p_stage_id uuid default null::uuid,
  p_outcome text default null::text,
  p_timezone text default 'UTC'::text,
  p_limit integer default 250,
  p_offset integer default 0,
  p_pipeline_id uuid default null::uuid,
  p_visible_submitter_ids uuid[] default null::uuid[]
)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
set work_mem to '16MB'
set jit to 'off'
set max_parallel_workers_per_gather to '0'
as $function$
  with filtered as materialized (
    select q.id, q.lead_id, q.queued_at, q.updated_at, q.product_line, q.stage_id, q.stage_key, q.pipeline_id,
      q.disposition, q.status, q.sla_partner_notified_at,
      l.created_at as submitted_at, l.created_by as submitted_by_id
    from public.lead_queue q join public.agent_leads l on l.id=q.lead_id and l.tenant_id=q.tenant_id
    where q.tenant_id=p_tenant_id and q.partner_id=p_partner_id
      and (p_pipeline_id is null or q.pipeline_id=p_pipeline_id)
      and (p_date_from is null or q.queued_at >= p_date_from::timestamptz)
      and (p_date_to is null or q.queued_at < (p_date_to + 1)::timestamptz)
      and l.created_by = any(coalesce(p_visible_submitter_ids, array[]::uuid[]))
      and (p_closer_id is null or l.created_by=p_closer_id)
      and (p_product is null or q.product_line=p_product)
      and (p_stage_id is null or q.stage_id=p_stage_id)
      and (p_outcome is null or q.disposition=p_outcome)
  ), available_pipeline_ids as (
    select pipeline.id as pipeline_id
    from public.tenant_pipelines pipeline
    where pipeline.tenant_id=p_tenant_id and pipeline.status='live'
  ), available_pipelines as (
    select pipeline.id, pipeline.name
    from public.tenant_pipelines pipeline
    join available_pipeline_ids available on available.pipeline_id=pipeline.id
    where pipeline.tenant_id=p_tenant_id
  ), page_keys as (
    select * from filtered order by queued_at desc, id desc
    limit least(greatest(coalesce(p_limit,250),1),5000) offset greatest(coalesce(p_offset,0),0)
  ), page as (
    select k.*, coalesce(u.name, 'Partner closer') as submitted_by_name,
      coalesce(nullif(btrim(l.values->>'full_name'), ''), nullif(btrim(concat_ws(' ', l.values->>'first_name', l.values->>'last_name')), ''), nullif(btrim(l.values->>'name'), ''), 'Unnamed lead') as customer
    from page_keys k join public.agent_leads l on l.id=k.lead_id
    left join public.users u on u.id=k.submitted_by_id
  ), stage_rows as (
    select coalesce(stage_id::text, stage_key) as stage_id, coalesce(pipeline_id::text,'default') as pipeline_id,
      coalesce(stage_key,'New') as stage_name, count(*)::integer as lead_count
    from filtered group by coalesce(stage_id::text, stage_key), coalesce(pipeline_id::text,'default'), coalesce(stage_key,'New')
  ), totals as (
    select count(*)::integer as total,
      (count(*) filter (where submitted_at::date = current_date))::integer as submitted_today,
      (count(*) filter (where status in ('claimed','buffer_active','handed_pending','la_active')))::integer as claimed,
      (count(*) filter (where status not in ('completed','dropped')))::integer as still_open,
      min(queued_at) filter (where status in ('unclaimed','claimed','buffer_active','handed_pending','la_active')) as oldest_open_at
    from filtered
  ), page_size as (select count(*)::integer as n from page_keys)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_array(lead_id, id, customer, submitted_at, updated_at, product_line,
      coalesce(stage_id::text, stage_key), coalesce(stage_key,'New'), 'open', disposition, disposition, null,
      submitted_by_id, submitted_by_name, status,
      (sla_partner_notified_at is not null and status in ('unclaimed','expired'))) order by queued_at desc, id desc) from page), '[]'::jsonb),
    'stages', coalesce((select jsonb_agg(jsonb_build_array(stage_id,pipeline_id,'Default pipeline',stage_name,0,'open','#64748b',false,lead_count)) from stage_rows), '[]'::jsonb),
    'pipelines', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name) from available_pipelines), '[]'::jsonb),
    'closers', coalesce((select jsonb_agg(jsonb_build_array(c.submitted_by_id, coalesce(u.name, 'Partner closer'))) from (select distinct submitted_by_id from filtered where submitted_by_id is not null) c left join public.users u on u.id=c.submitted_by_id), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(product_line) from (select distinct product_line from filtered) p), '[]'::jsonb),
    'outcomes', coalesce((select jsonb_agg(jsonb_build_array(disposition, disposition)) from (select distinct disposition from filtered where disposition is not null) o), '[]'::jsonb),
    'total', totals.total,
    'next_offset', case when greatest(coalesce(p_offset,0),0)+page_size.n<totals.total then greatest(coalesce(p_offset,0),0)+page_size.n else null end,
    'counters', jsonb_build_object(
      'submittedToday', totals.submitted_today,
      'claimed', totals.claimed,
      'converted', 0,
      'stillOpen', totals.still_open
    ),
    'oldest_open_at', totals.oldest_open_at,
    'submitted_recent', coalesce((select jsonb_agg(jsonb_build_array(b.bucket, b.n) order by b.bucket) from (
      select floor(extract(epoch from submitted_at) / 900)::bigint as bucket, count(*)::integer as n
      from filtered where submitted_at >= now() - interval '26 hours' group by 1) b), '[]'::jsonb)
  ) from totals, page_size;
$function$;

revoke all on function public.partner_lead_pipeline_page(uuid, uuid, date, date, uuid, text, uuid, text, text, integer, integer, uuid, uuid[]) from public, anon, authenticated, tenant_app;
grant execute on function public.partner_lead_pipeline_page(uuid, uuid, date, date, uuid, text, uuid, text, text, integer, integer, uuid, uuid[]) to service_role;

do $$
declare
  v_sig regprocedure := 'public.partner_lead_pipeline_page(uuid,uuid,date,date,uuid,text,uuid,text,text,integer,integer,uuid,uuid[])'::regprocedure;
  v_body text;
begin
  v_body := replace(pg_get_functiondef(v_sig), E'\r\n', E'\n');
  if position('p_pipeline_id' in v_body) = 0 or position('available_pipelines' in v_body) = 0 or position('p_visible_submitter_ids' in v_body) = 0 then
    raise exception '20261102180000: partner pipeline selection is missing';
  end if;
  if has_function_privilege('anon', v_sig, 'execute') or has_function_privilege('authenticated', v_sig, 'execute') then
    raise exception '20261102180000: the pipeline read model is callable by a public role';
  end if;
end
$$;

do $$
declare v_body text := lower(pg_get_functiondef('public.partner_lead_pipeline_page(uuid,uuid,date,date,uuid,text,uuid,text,text,integer,integer,uuid,uuid[])'::regprocedure));
begin
  if position('q.partner_id=p_partner_id' in v_body)=0 or position('l.created_by = any' in v_body)=0 or position('pipeline.tenant_id=p_tenant_id and pipeline.status=''live''' in v_body)=0 then
    raise exception '20261102180000: partner, submitter, or pipeline tenant scope is missing';
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;

-- Migration 20261102190000_partner_form_draft_pause_context.sql
-- Partner drafts persist the context from an intentional in-app pause.
alter table public.form_drafts
  add column if not exists pause_reason text,
  add column if not exists pause_notes text;

-- Drafts are recoverable work and must not disappear when a publisher starts several applications.
-- Keep the per-user advisory lock to serialize creation while removing the arbitrary 25-row cap.
create or replace function public.save_partner_form_draft_slot(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_user_id uuid,
  p_product_code text,
  p_tenant_template_id uuid,
  p_definition_version integer,
  p_profile_id uuid,
  p_profile_revision integer,
  p_payload jsonb,
  p_draft_id uuid default null
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  v_saved uuid;
begin
  if p_partner_id is null then raise exception 'partner_required'; end if;
  if p_profile_id is not null and not exists (
    select 1 from public.partner_submission_profiles p
    where p.id = p_profile_id and p.tenant_id = p_tenant_id
      and p.partner_id = p_partner_id and p.product_code = p_product_code
  ) then raise exception 'invalid_partner_submission_profile'; end if;
  if p_profile_id is not null and p_profile_revision is null then raise exception 'profile_revision_required'; end if;
  if p_profile_id is not null and not exists (
    select 1 from public.partner_submission_profile_revisions r
    where r.profile_id = p_profile_id and r.revision = p_profile_revision
  ) then raise exception 'invalid_partner_submission_profile_revision'; end if;

  if p_draft_id is not null then
    update public.form_drafts d
       set tenant_template_id = p_tenant_template_id,
           definition_version = p_definition_version,
           partner_submission_profile_id = p_profile_id,
           partner_submission_profile_revision = p_profile_revision,
           payload = p_payload,
           updated_at = now()
     where d.id = p_draft_id and d.tenant_id = p_tenant_id
       and d.partner_id = p_partner_id and d.user_id = p_user_id
       and d.product_code = p_product_code
    returning d.id into v_saved;
    if v_saved is null then raise exception 'form_draft_not_found'; end if;
    return v_saved;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('form_drafts:' || p_user_id::text, 0));
  insert into public.form_drafts (
    tenant_id, partner_id, user_id, product_code, tenant_template_id,
    definition_version, partner_submission_profile_id,
    partner_submission_profile_revision, payload, is_multi
  ) values (
    p_tenant_id, p_partner_id, p_user_id, p_product_code, p_tenant_template_id,
    p_definition_version, p_profile_id, p_profile_revision, p_payload, true
  ) returning id into v_saved;
  return v_saved;
end;
$$;

revoke all on function public.save_partner_form_draft_slot(uuid, uuid, uuid, text, uuid, integer, uuid, integer, jsonb, uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function public.save_partner_form_draft_slot(uuid, uuid, uuid, text, uuid, integer, uuid, integer, jsonb, uuid)
  to service_role;

-- Migration 20261102200000_partner_pipeline_language.sql
-- Add the customer language to partner pipeline rows without changing row scope or prior positions.
begin;
create or replace function public.partner_lead_pipeline_page(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_date_from date default null::date,
  p_date_to date default null::date,
  p_closer_id uuid default null::uuid,
  p_product text default null::text,
  p_stage_id uuid default null::uuid,
  p_outcome text default null::text,
  p_timezone text default 'UTC'::text,
  p_limit integer default 250,
  p_offset integer default 0,
  p_pipeline_id uuid default null::uuid,
  p_visible_submitter_ids uuid[] default null::uuid[]
)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
set work_mem to '16MB'
set jit to 'off'
set max_parallel_workers_per_gather to '0'
as $function$
  with filtered as materialized (
    select q.id, q.lead_id, q.queued_at, q.updated_at, q.product_line, q.stage_id, q.stage_key, q.pipeline_id,
      q.disposition, q.status, q.sla_partner_notified_at,
      l.created_at as submitted_at, l.created_by as submitted_by_id
    from public.lead_queue q join public.agent_leads l on l.id=q.lead_id and l.tenant_id=q.tenant_id
    where q.tenant_id=p_tenant_id and q.partner_id=p_partner_id
      and (p_pipeline_id is null or q.pipeline_id=p_pipeline_id)
      and (p_date_from is null or q.queued_at >= p_date_from::timestamptz)
      and (p_date_to is null or q.queued_at < (p_date_to + 1)::timestamptz)
      and l.created_by = any(coalesce(p_visible_submitter_ids, array[]::uuid[]))
      and (p_closer_id is null or l.created_by=p_closer_id)
      and (p_product is null or q.product_line=p_product)
      and (p_stage_id is null or q.stage_id=p_stage_id)
      and (p_outcome is null or q.disposition=p_outcome)
  ), available_pipeline_ids as (
    select pipeline.id as pipeline_id
    from public.tenant_pipelines pipeline
    where pipeline.tenant_id=p_tenant_id and pipeline.status='live'
  ), available_pipelines as (
    select pipeline.id, pipeline.name
    from public.tenant_pipelines pipeline
    join available_pipeline_ids available on available.pipeline_id=pipeline.id
    where pipeline.tenant_id=p_tenant_id
  ), page_keys as (
    select * from filtered order by queued_at desc, id desc
    limit least(greatest(coalesce(p_limit,250),1),5000) offset greatest(coalesce(p_offset,0),0)
  ), page as (
    select k.*, coalesce(u.name, 'Partner closer') as submitted_by_name,
      coalesce(nullif(btrim(l.values->>'full_name'), ''), nullif(btrim(concat_ws(' ', l.values->>'first_name', l.values->>'last_name')), ''), nullif(btrim(l.values->>'name'), ''), 'Unnamed lead') as customer,
      coalesce(nullif(btrim(l.values->>'preferred_language'), ''), nullif(btrim(l.values->>'language'), ''), nullif(btrim(l.values->>'preferredLanguage'), '')) as customer_language
    from page_keys k join public.agent_leads l on l.id=k.lead_id
    left join public.users u on u.id=k.submitted_by_id
  ), stage_rows as (
    select coalesce(stage_id::text, stage_key) as stage_id, coalesce(pipeline_id::text,'default') as pipeline_id,
      coalesce(stage_key,'New') as stage_name, count(*)::integer as lead_count
    from filtered group by coalesce(stage_id::text, stage_key), coalesce(pipeline_id::text,'default'), coalesce(stage_key,'New')
  ), totals as (
    select count(*)::integer as total,
      (count(*) filter (where submitted_at::date = current_date))::integer as submitted_today,
      (count(*) filter (where status in ('claimed','buffer_active','handed_pending','la_active')))::integer as claimed,
      (count(*) filter (where status not in ('completed','dropped')))::integer as still_open,
      min(queued_at) filter (where status in ('unclaimed','claimed','buffer_active','handed_pending','la_active')) as oldest_open_at
    from filtered
  ), page_size as (select count(*)::integer as n from page_keys)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_array(lead_id, id, customer, submitted_at, updated_at, product_line,
      coalesce(stage_id::text, stage_key), coalesce(stage_key,'New'), 'open', disposition, disposition, null,
      submitted_by_id, submitted_by_name, status,
      (sla_partner_notified_at is not null and status in ('unclaimed','expired')), customer_language) order by queued_at desc, id desc) from page), '[]'::jsonb),
    'stages', coalesce((select jsonb_agg(jsonb_build_array(stage_id,pipeline_id,'Default pipeline',stage_name,0,'open','#64748b',false,lead_count)) from stage_rows), '[]'::jsonb),
    'pipelines', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name) from available_pipelines), '[]'::jsonb),
    'closers', coalesce((select jsonb_agg(jsonb_build_array(c.submitted_by_id, coalesce(u.name, 'Partner closer'))) from (select distinct submitted_by_id from filtered where submitted_by_id is not null) c left join public.users u on u.id=c.submitted_by_id), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(product_line) from (select distinct product_line from filtered) p), '[]'::jsonb),
    'outcomes', coalesce((select jsonb_agg(jsonb_build_array(disposition, disposition)) from (select distinct disposition from filtered where disposition is not null) o), '[]'::jsonb),
    'total', totals.total,
    'next_offset', case when greatest(coalesce(p_offset,0),0)+page_size.n<totals.total then greatest(coalesce(p_offset,0),0)+page_size.n else null end,
    'counters', jsonb_build_object(
      'submittedToday', totals.submitted_today,
      'claimed', totals.claimed,
      'converted', 0,
      'stillOpen', totals.still_open
    ),
    'oldest_open_at', totals.oldest_open_at,
    'submitted_recent', coalesce((select jsonb_agg(jsonb_build_array(b.bucket, b.n) order by b.bucket) from (
      select floor(extract(epoch from submitted_at) / 900)::bigint as bucket, count(*)::integer as n
      from filtered where submitted_at >= now() - interval '26 hours' group by 1) b), '[]'::jsonb)
  ) from totals, page_size;
$function$;

revoke all on function public.partner_lead_pipeline_page(uuid,uuid,date,date,uuid,text,uuid,text,text,integer,integer,uuid,uuid[]) from public, anon, authenticated, tenant_app;
grant execute on function public.partner_lead_pipeline_page(uuid,uuid,date,date,uuid,text,uuid,text,text,integer,integer,uuid,uuid[]) to service_role;

do $$
declare
  v_sig regprocedure := 'public.partner_lead_pipeline_page(uuid,uuid,date,date,uuid,text,uuid,text,text,integer,integer,uuid,uuid[])'::regprocedure;
  v_body text := lower(pg_get_functiondef(v_sig));
begin
  if position('customer_language' in v_body) = 0
    or position('p_visible_submitter_ids' in v_body) = 0
    or position('q.partner_id=p_partner_id' in v_body) = 0 then
    raise exception '20261102200000: customer language projection or partner scope is missing';
  end if;
  if has_function_privilege('anon', v_sig, 'execute')
    or has_function_privilege('authenticated', v_sig, 'execute') then
    raise exception '20261102200000: the pipeline read model is callable by a public role';
  end if;
end
$$;

notify pgrst, 'reload schema';
commit;

-- Source: supabase/migrations/20261102210000_partner_draft_screening_resume.sql
-- Keep the partner-safe result of the phone-entry screen with its draft so Resume can reopen
-- the in-progress form without repeating the number-entry screen. Submission still evaluates
-- the transfer gate again at the authoritative submit step.
alter table public.form_drafts
  add column if not exists screening_result_id uuid,
  add column if not exists screening_submission_id uuid,
  add column if not exists screening_snapshot jsonb;

comment on column public.form_drafts.screening_result_id is
  'Pointer to the completed phone screening result for this draft; verified against its saved phone before resume.';
comment on column public.form_drafts.screening_submission_id is
  'Retry key used by the number-entry screen and matching final submit gate.';
comment on column public.form_drafts.screening_snapshot is
  'Partner-safe response from phone-entry screening. Contains no phone number or vendor/list detail.';

notify pgrst, 'reload schema';

-- Keep inbound outcomes on the same tenant-owned pipeline as the lead.
-- The later tenant seed did not recreate stage mappings, so dispositions silently
-- fell back to the current stage. This restores defaults and preserves owner overrides.

alter table public.stage_dispositions
  drop constraint if exists stage_dispositions_tenant_id_stage_id_key;

create or replace function public.set_stage_disposition(
  p_tenant_id uuid, p_stage_id uuid, p_disposition_key text
)
returns public.stage_dispositions
language plpgsql security definer set search_path = public
as $$
declare result public.stage_dispositions;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  if not exists (
    select 1 from public.tenant_pipeline_stages s
    join public.tenant_pipelines p on p.id = s.pipeline_id
    where s.id = p_stage_id and p.tenant_id = p_tenant_id and not s.is_archived
  ) then raise exception 'stage_not_found'; end if;
  delete from public.stage_dispositions
   where tenant_id = p_tenant_id and disposition_key = p_disposition_key;
  insert into public.stage_dispositions (tenant_id, stage_id, disposition_key)
  values (p_tenant_id, p_stage_id, p_disposition_key)
  returning * into result;
  return result;
end;
$$;

revoke all on function public.set_stage_disposition(uuid, uuid, text)
  from public, anon, authenticated, tenant_app;
grant execute on function public.set_stage_disposition(uuid, uuid, text) to service_role;

create or replace function public.seed_default_pipeline_dispositions(p_tenant_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.stage_dispositions (tenant_id, stage_id, disposition_key)
  select p_tenant_id, s.id, mapping.disposition_key
  from public.tenant_pipelines p
  join public.tenant_pipeline_stages s on s.pipeline_id = p.id
  join (values
    ('Incomplete Transfer', 'no_payment_method'),
    ('Incomplete Transfer', 'call_dropped'),
    ('Returned to Partner - DQ', 'did_not_qualify'),
    ('Returned to Partner - DQ', 'do_not_call'),
    ('Did Not Qualify', 'not_interested'),
    ('Needs Callback', 'callback_scheduled'),
    ('Pending Approval', 'sent_to_underwriting'),
    ('Submitted', 'application_submitted')
  ) as mapping(stage_name, disposition_key) on mapping.stage_name = s.name
  where p.tenant_id = p_tenant_id and p.partner_type = 'publisher'::public.partner_type
    and p.is_default and not s.is_archived
  on conflict (tenant_id, disposition_key) do nothing;
end;
$$;

revoke all on function public.seed_default_pipeline_dispositions(uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function public.seed_default_pipeline_dispositions(uuid) to service_role;

-- Imported CSV leads are the only records in New Transfer. Partner portal submissions
-- use Partner Submitted and still enter the inbound queue.
create or replace function public.seed_default_pipelines(p_tenant_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare pipeline_row record;
begin
  insert into public.tenant_pipelines (tenant_id, name, partner_type, is_default)
  values
    (p_tenant_id, 'Publisher transfers', 'publisher'::public.partner_type, true),
    (p_tenant_id, 'Marketing leads', 'marketing'::public.partner_type, true),
    (p_tenant_id, 'Affiliate referrals', 'affiliate'::public.partner_type, true)
  on conflict (tenant_id, partner_type, name) do update set is_default = true, updated_at = now();
  for pipeline_row in select id, partner_type from public.tenant_pipelines
    where tenant_id = p_tenant_id and is_default loop
    if pipeline_row.partner_type = 'publisher'::public.partner_type then
      insert into public.tenant_pipeline_stages (pipeline_id, name, position, stage_type, color) values
        (pipeline_row.id, 'New Transfer', 0, 'open', '#2563eb'),
        (pipeline_row.id, 'Incomplete Transfer', 1, 'open', '#64748b'),
        (pipeline_row.id, 'Returned to Partner - DQ', 2, 'lost', '#dc2626'),
        (pipeline_row.id, 'Previously Sold', 3, 'lost', '#9333ea'),
        (pipeline_row.id, 'Did Not Qualify', 4, 'lost', '#dc2626'),
        (pipeline_row.id, 'Needs Callback', 5, 'open', '#d97706'),
        (pipeline_row.id, 'Application Withdrawn', 6, 'lost', '#dc2626'),
        (pipeline_row.id, 'Declined Underwriting', 7, 'lost', '#b91c1c'),
        (pipeline_row.id, 'Pending Approval', 8, 'open', '#0891b2'),
        (pipeline_row.id, 'Submitted', 9, 'won', '#16a34a')
      on conflict (pipeline_id, name) do nothing;
      insert into public.tenant_pipeline_stages (pipeline_id, name, position, stage_type, color)
      select pipeline_row.id, 'Partner Submitted', coalesce(max(position), -1) + 1, 'open', '#0ea5e9'
      from public.tenant_pipeline_stages existing
      where existing.pipeline_id = pipeline_row.id
        and not exists (
          select 1 from public.tenant_pipeline_stages candidate
          where candidate.pipeline_id = pipeline_row.id and candidate.name = 'Partner Submitted'
        );
    elsif pipeline_row.partner_type = 'marketing'::public.partner_type then
      insert into public.tenant_pipeline_stages (pipeline_id, name, position, stage_type, color) values
        (pipeline_row.id, 'Form Lead', 0, 'open', '#2563eb'),
        (pipeline_row.id, 'Call Lead', 1, 'open', '#0891b2'),
        (pipeline_row.id, 'No Pickup - Needs Connection', 2, 'open', '#64748b'),
        (pipeline_row.id, 'Pickup - Needs Callback', 3, 'open', '#d97706'),
        (pipeline_row.id, 'Qualified - Needs Conversion', 4, 'open', '#7c3aed'),
        (pipeline_row.id, 'Disqualified - Do Not Call', 5, 'lost', '#dc2626'),
        (pipeline_row.id, 'Converted', 6, 'won', '#16a34a')
      on conflict (pipeline_id, name) do nothing;
    else
      insert into public.tenant_pipeline_stages (pipeline_id, name, position, stage_type, color) values
        (pipeline_row.id, 'Referred', 0, 'open', '#2563eb'),
        (pipeline_row.id, 'Contacted', 1, 'open', '#0891b2'),
        (pipeline_row.id, 'Qualified', 2, 'open', '#7c3aed'),
        (pipeline_row.id, 'Submitted', 3, 'won', '#16a34a'),
        (pipeline_row.id, 'Not Interested', 4, 'lost', '#dc2626')
      on conflict (pipeline_id, name) do nothing;
    end if;
  end loop;
  perform public.seed_default_pipeline_dispositions(p_tenant_id);
end;
$$;

revoke all on function public.seed_default_pipelines(uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function public.seed_default_pipelines(uuid) to service_role;

do $$
declare tenant_row record;
begin
  for tenant_row in select id from public.tenants loop
    perform public.seed_default_pipelines(tenant_row.id);
  end loop;
end;
$$;

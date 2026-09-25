-- LA-2.20 · lead recycling, nurture, and one-person/many-sources attribution.
--
-- A recycle is a new serving opportunity, not a new person. Attempt rows are never deleted; the
-- lead's serving counter resets while the immutable attempt history remains the audit trail.

create table if not exists public.tenant_lead_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  campaign_id uuid not null references public.tenant_campaigns(id) on delete restrict,
  source_type text not null default 'import' check (source_type in ('import', 'partner', 'affiliate', 'recycle')),
  cost_cents integer not null default 0 check (cost_cents >= 0),
  source_key text,
  created_at timestamptz not null default now(),
  unique (tenant_id, lead_id, campaign_id)
);

create index if not exists tenant_lead_sources_campaign_idx
  on public.tenant_lead_sources (tenant_id, campaign_id, created_at desc);
create index if not exists tenant_lead_sources_lead_idx
  on public.tenant_lead_sources (tenant_id, lead_id, created_at desc);

alter table public.agent_leads
  add column if not exists recycle_count integer not null default 0,
  add column if not exists nurture_entered_at timestamptz,
  add column if not exists last_reactivated_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agent_leads_recycle_count_check') then
    alter table public.agent_leads add constraint agent_leads_recycle_count_check check (recycle_count >= 0);
  end if;
end $$;

create table if not exists public.tenant_campaign_recycle_rules (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid primary key references public.tenant_campaigns(id) on delete cascade,
  wait_days integer not null default 180 check (wait_days between 1 and 3650),
  allowed_dispositions text[] not null default array['no_answer', 'voicemail']::text[],
  max_recycles integer not null default 3 check (max_recycles between 0 and 100),
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_nurture_reactivations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  campaign_id uuid not null references public.tenant_campaigns(id) on delete cascade,
  recycle_number integer not null check (recycle_number > 0),
  status text not null default 'pending' check (status in ('pending', 'cleared', 'blocked', 'failed')),
  screening_result_id uuid references public.screening_results(id) on delete set null,
  screening_outcome text,
  reason text,
  reactivated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (lead_id, recycle_number)
);

create index if not exists tenant_nurture_reactivations_campaign_idx
  on public.tenant_nurture_reactivations (tenant_id, campaign_id, reactivated_at desc);
create index if not exists tenant_nurture_reactivations_lead_idx
  on public.tenant_nurture_reactivations (tenant_id, lead_id, reactivated_at desc);

create or replace function public.stamp_lead_nurture_entry()
returns trigger language plpgsql security invoker set search_path = public as $function$
begin
  if new.lead_state = 'exhausted' and (tg_op = 'INSERT' or old.lead_state <> 'exhausted') then
    new.nurture_entered_at := coalesce(new.nurture_entered_at, now());
  elsif new.lead_state <> 'exhausted' and old is not null and old.lead_state = 'exhausted'
        and new.lead_state <> 'nurture' then
    new.nurture_entered_at := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists agent_leads_nurture_entry on public.agent_leads;
create trigger agent_leads_nurture_entry before insert or update of lead_state on public.agent_leads
for each row execute function public.stamp_lead_nurture_entry();

-- Existing exhausted rows were created before the timestamp existed. Their last update is the only
-- honest lower bound; it prevents them from being reactivated immediately by a new default rule.
update public.agent_leads
   set nurture_entered_at = coalesce(nurture_entered_at, updated_at, created_at)
 where lead_state = 'exhausted' and nurture_entered_at is null;

-- First-party imports can call this function for either a new person or an existing phone. It is
-- deliberately keyed by phone only: a phone is the stable identity available in the current lead
-- template, while names and email addresses can change. A duplicate becomes a source row, never a
-- second lead.
create or replace function public.import_agent_lead_source(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_campaign_id uuid,
  p_source_type text default 'import',
  p_cost_cents integer default 0,
  p_source_key text default null
)
returns uuid
language plpgsql security definer set search_path = public as $function$
declare v_id uuid;
begin
  if p_source_type not in ('import', 'partner', 'affiliate', 'recycle') then raise exception 'SOURCE_TYPE_INVALID'; end if;
  if p_cost_cents < 0 then raise exception 'SOURCE_COST_INVALID'; end if;
  insert into tenant_lead_sources (tenant_id, lead_id, campaign_id, source_type, cost_cents, source_key)
  values (p_tenant_id, p_lead_id, p_campaign_id, p_source_type, p_cost_cents, p_source_key)
  on conflict (tenant_id, lead_id, campaign_id) do update
    set cost_cents = greatest(tenant_lead_sources.cost_cents, excluded.cost_cents),
        source_key = coalesce(tenant_lead_sources.source_key, excluded.source_key)
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.upsert_campaign_recycle_rule(
  p_tenant_id uuid, p_campaign_id uuid, p_wait_days integer,
  p_allowed_dispositions text[], p_max_recycles integer, p_updated_by uuid
)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare v_row tenant_campaign_recycle_rules%rowtype;
begin
  if not exists (select 1 from tenant_campaigns where id = p_campaign_id and tenant_id = p_tenant_id) then raise exception 'CAMPAIGN_NOT_FOUND'; end if;
  if p_wait_days < 1 or p_wait_days > 3650 or p_max_recycles < 0 or p_max_recycles > 100 then raise exception 'RECYCLE_RULE_INVALID'; end if;
  if p_allowed_dispositions is null or cardinality(p_allowed_dispositions) = 0 or 'do_not_call' = any(p_allowed_dispositions) then raise exception 'RECYCLE_DISPOSITION_INVALID'; end if;
  insert into tenant_campaign_recycle_rules (tenant_id, campaign_id, wait_days, allowed_dispositions, max_recycles, updated_by)
  values (p_tenant_id, p_campaign_id, p_wait_days, p_allowed_dispositions, p_max_recycles, p_updated_by)
  on conflict (campaign_id) do update set wait_days = excluded.wait_days, allowed_dispositions = excluded.allowed_dispositions,
    max_recycles = excluded.max_recycles, updated_by = excluded.updated_by, updated_at = now()
  returning * into v_row;
  return to_jsonb(v_row);
end;
$function$;

-- The explicit operation named by the product contract. It puts candidates back into the lowest
-- nurture tier and sets the campaign to scrubbing. The service must finish the fresh screening
-- before the campaign is allowed to serve again.
create or replace function public.reactivate_nurture(p_tenant_id uuid, p_campaign_id uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_rule tenant_campaign_recycle_rules%rowtype;
  v_count integer := 0;
  v_ids uuid[] := array[]::uuid[];
  v_reactivation_ids uuid[] := array[]::uuid[];
  v_reactivation_id uuid;
  r record;
begin
  if not exists (select 1 from tenant_campaigns where id = p_campaign_id and tenant_id = p_tenant_id) then raise exception 'CAMPAIGN_NOT_FOUND'; end if;
  select * into v_rule from tenant_campaign_recycle_rules where tenant_id = p_tenant_id and campaign_id = p_campaign_id;
  if not found then
    v_rule.tenant_id := p_tenant_id; v_rule.campaign_id := p_campaign_id; v_rule.wait_days := 180;
    v_rule.allowed_dispositions := array['no_answer', 'voicemail']::text[]; v_rule.max_recycles := 3;
  end if;

  update tenant_campaigns set scrub_status = 'scrubbing', scrub_error = null where id = p_campaign_id and tenant_id = p_tenant_id;
  for r in
    select l.id, coalesce(l.recycle_count, 0) + 1 as recycle_number,
           (select ca.disposition from tenant_call_attempts ca where ca.tenant_id = p_tenant_id and ca.lead_id = l.id order by ca.attempted_at desc limit 1) as last_disposition
      from agent_leads l
     where l.tenant_id = p_tenant_id and l.campaign_id = p_campaign_id
       and l.lead_state in ('exhausted', 'nurture')
       and coalesce(l.nurture_entered_at, l.updated_at, l.created_at) <= now() - make_interval(days => v_rule.wait_days)
       and coalesce(l.recycle_count, 0) < v_rule.max_recycles
       and coalesce((select ca.disposition from tenant_call_attempts ca where ca.tenant_id = p_tenant_id and ca.lead_id = l.id order by ca.attempted_at desc limit 1), '') = any(v_rule.allowed_dispositions)
       and coalesce(l.screening_outcome, '') not in ('dnc', 'tcpa_litigator')
       and not (select s.suppressed from is_phone_suppressed(p_tenant_id, coalesce(l.values->>'phone', l.values->>'phone_number')) s)
     for update
  loop
    update agent_leads set recycle_count = r.recycle_number, lead_state = 'nurture', attempts_made = 0,
      next_dial_after = now(), next_preferred_slot = null, last_reactivated_at = now(), nurture_entered_at = now(), updated_at = now()
     where id = r.id and tenant_id = p_tenant_id;
    insert into tenant_nurture_reactivations (tenant_id, lead_id, campaign_id, recycle_number, reason)
    values (p_tenant_id, r.id, p_campaign_id, r.recycle_number, 'Explicit nurture reactivation; fresh suppression screening required')
    returning id into v_reactivation_id;
    v_count := v_count + 1; v_ids := array_append(v_ids, r.id);
    v_reactivation_ids := array_append(v_reactivation_ids, v_reactivation_id);
  end loop;
  if v_count = 0 then
    update tenant_campaigns set scrub_status = 'scrubbed', scrubbed_at = now(), scrub_error = null
     where id = p_campaign_id and tenant_id = p_tenant_id;
  end if;
  return jsonb_build_object('campaign_id', p_campaign_id, 'queued', v_count, 'lead_ids', to_jsonb(v_ids), 'reactivation_ids', to_jsonb(v_reactivation_ids), 'scrub_status', case when v_count = 0 then 'scrubbed' else 'scrubbing' end);
end;
$function$;

create or replace function public.complete_nurture_reactivation(
  p_tenant_id uuid, p_reactivation_id uuid, p_status text, p_result_id uuid,
  p_outcome text, p_reason text
)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare v_row tenant_nurture_reactivations%rowtype; v_campaign uuid;
begin
  if p_status not in ('cleared', 'blocked', 'failed') then raise exception 'REACTIVATION_STATUS_INVALID'; end if;
  update tenant_nurture_reactivations set status = p_status, screening_result_id = p_result_id,
    screening_outcome = p_outcome, reason = left(p_reason, 500), completed_at = now()
   where id = p_reactivation_id and tenant_id = p_tenant_id and status = 'pending'
  returning * into v_row;
  if not found then raise exception 'REACTIVATION_NOT_FOUND'; end if;
  v_campaign := v_row.campaign_id;
  if p_status = 'failed' then
    update tenant_campaigns set scrub_status = 'failed', scrub_error = left(p_reason, 500) where id = v_campaign and tenant_id = p_tenant_id;
  elsif not exists (select 1 from tenant_nurture_reactivations where tenant_id = p_tenant_id and campaign_id = v_campaign and status = 'pending')
    and not exists (select 1 from tenant_nurture_reactivations where tenant_id = p_tenant_id and campaign_id = v_campaign and status = 'failed') then
    update tenant_campaigns set scrub_status = 'scrubbed', scrubbed_at = now(), scrub_error = null where id = v_campaign and tenant_id = p_tenant_id;
  end if;
  return to_jsonb(v_row);
end;
$function$;

create or replace function public.tenant_nurture_campaigns(p_tenant_id uuid)
returns jsonb language sql stable security definer set search_path = public as $function$
select coalesce(jsonb_agg(jsonb_build_object(
  'campaign_id', c.id, 'campaign_name', c.name, 'status', c.status, 'scrub_status', c.scrub_status,
  'rule', jsonb_build_object('wait_days', coalesce(r.wait_days, 180), 'allowed_dispositions', coalesce(r.allowed_dispositions, array['no_answer','voicemail']::text[]), 'max_recycles', coalesce(r.max_recycles, 3)),
  'eligible_count', (select count(*) from agent_leads l where l.tenant_id = p_tenant_id and l.campaign_id = c.id and l.lead_state in ('exhausted','nurture')),
  'reactivated_count', (select count(*) from tenant_nurture_reactivations n where n.tenant_id = p_tenant_id and n.campaign_id = c.id and n.status = 'cleared')
) order by c.name), '[]'::jsonb)
from tenant_campaigns c left join tenant_campaign_recycle_rules r on r.campaign_id = c.id
where c.tenant_id = p_tenant_id;
$function$;

create or replace function public.lead_attempt_history(p_tenant_id uuid, p_lead_id uuid)
returns jsonb language sql stable security definer set search_path = public as $function$
select coalesce(jsonb_agg(jsonb_build_object('id', ca.id, 'attempt_number', ca.attempt_number, 'slot', ca.slot,
  'attempted_at', ca.attempted_at, 'disposition', ca.disposition, 'agent_id', ca.agent_id,
  'dial_clicked_at', ca.dial_clicked_at) order by ca.attempted_at), '[]'::jsonb)
from tenant_call_attempts ca where ca.tenant_id = p_tenant_id and ca.lead_id = p_lead_id;
$function$;

-- Seed source history for campaign-attributed leads created before this migration.
insert into tenant_lead_sources (tenant_id, lead_id, campaign_id, source_type, cost_cents)
select l.tenant_id, l.id, l.campaign_id, 'import', round(coalesce(c.cost_per_record_cents, 0))::integer
  from agent_leads l join tenant_campaigns c on c.id = l.campaign_id
 where l.campaign_id is not null
on conflict (tenant_id, lead_id, campaign_id) do nothing;

alter table public.tenant_lead_sources enable row level security;
alter table public.tenant_campaign_recycle_rules enable row level security;
alter table public.tenant_nurture_reactivations enable row level security;
create policy tenant_lead_sources_scoped on public.tenant_lead_sources for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
create policy tenant_campaign_recycle_rules_scoped on public.tenant_campaign_recycle_rules for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
create policy tenant_nurture_reactivations_scoped on public.tenant_nurture_reactivations for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.tenant_lead_sources, public.tenant_campaign_recycle_rules, public.tenant_nurture_reactivations from anon, authenticated, public;
grant select, insert, update on public.tenant_lead_sources, public.tenant_campaign_recycle_rules to tenant_app;
grant select on public.tenant_nurture_reactivations to tenant_app;
grant select, insert, update on public.tenant_lead_sources, public.tenant_campaign_recycle_rules, public.tenant_nurture_reactivations to service_role;
revoke all on function public.import_agent_lead_source(uuid, uuid, uuid, text, integer, text) from public, anon, authenticated, tenant_app;
grant execute on function public.import_agent_lead_source(uuid, uuid, uuid, text, integer, text) to service_role;
revoke all on function public.upsert_campaign_recycle_rule(uuid, uuid, integer, text[], integer, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.upsert_campaign_recycle_rule(uuid, uuid, integer, text[], integer, uuid) to service_role;
revoke all on function public.reactivate_nurture(uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.reactivate_nurture(uuid, uuid, uuid) to service_role;
revoke all on function public.complete_nurture_reactivation(uuid, uuid, text, uuid, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.complete_nurture_reactivation(uuid, uuid, text, uuid, text, text) to service_role;
revoke all on function public.tenant_nurture_campaigns(uuid) from public, anon, authenticated;
grant execute on function public.tenant_nurture_campaigns(uuid) to tenant_app, service_role;
revoke all on function public.lead_attempt_history(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.lead_attempt_history(uuid, uuid) to service_role;

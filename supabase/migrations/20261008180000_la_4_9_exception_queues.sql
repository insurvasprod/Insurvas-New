-- LA-4.9 (Notion sprint) · the three exception queues and role-based ownership.
--
--   queue 1  no_deal_flow   a carrier policy we hold no record of. A PROVISIONAL contact is made from
--                           the carrier's own name, DOB and address (contacts.provisional, shown as
--                           such everywhere until confirmed) and one item goes to the writing agent.
--   queue 2  no_policy      a logged sale (deal_flow, application_submitted) that no carrier file has
--                           heard of N days on (default 5). Only raised once we hold that carrier's
--                           policy file dated at least N days after the sale — without the file we
--                           cannot know. Escalates past a second threshold (default 10 days).
--   queue 3  multi_policy   "are these policies one person?" — only when the system is not sure. An
--                           exact first name, last name and date of birth resolves silently.
--
-- Ownership: queue_assignment_rule per agency, defaults built in (a solo agent configures nothing).
--   owner_role  writing_agent → the policy's or the sale's agent;  operations → a bookkeeper;
--               retention → a producer;  admin → an owner.
-- NO ITEM WITHOUT AN OWNER: assigned_to_user_id is NOT NULL, and a role with nobody in it falls back
-- to the agency's owner (queue_owner). Items are written only by the functions below; the app roles
-- cannot insert or update them directly.
--
-- "Never submitted" (queue 2) closes the sale's open application case as `abandoned` with the
-- reason, so the LA-2.17 funnel's "applied" step stops counting it — the honest number.
--
-- Additive. Requires 20261008170000 (policy_match).
--
-- Rollback:
--   select cron.unschedule('la4-exception-queues-daily');
--   drop function if exists public.sweep_exception_queues(date), public.close_case_never_submitted(uuid, uuid, uuid, text),
--     public.reassign_queue_item(uuid, uuid, text), public.resolve_queue_item(uuid, uuid, uuid, text, text, text, jsonb),
--     public.open_queue_item(uuid, text, text, text, uuid, uuid, text, uuid, uuid, uuid, jsonb, uuid, date),
--     public.queue_owner(uuid, text, uuid);
--   drop table if exists public.queue_item, public.queue_assignment_rule;
--   alter table public.contacts drop column if exists provisional, drop column if exists provisional_source,
--     drop column if exists provisional_confirmed_at, drop column if exists provisional_confirmed_by;

-- ─── provisional contacts ───────────────────────────────────────────────────────────────────────
alter table public.contacts add column if not exists provisional boolean not null default false;
alter table public.contacts add column if not exists provisional_source jsonb;
alter table public.contacts add column if not exists provisional_confirmed_at timestamptz;
alter table public.contacts add column if not exists provisional_confirmed_by uuid references public.users(id) on delete set null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_provisional_source') then
    alter table public.contacts add constraint contacts_provisional_source check (not provisional or jsonb_typeof(provisional_source) = 'object');
  end if;
end $$;
create index if not exists contacts_provisional_idx on public.contacts (tenant_id) where provisional;
create index if not exists contacts_provisional_confirmed_by_idx on public.contacts (provisional_confirmed_by) where provisional_confirmed_by is not null;
create index if not exists contacts_identity_idx on public.contacts (tenant_id, name_search, dob) where merged_into_id is null;

-- ─── two more ways a policy link is made (LA-4.8's table) ──────────────────────────────────────
--   no_match        nothing matched: the policy is linked to the PROVISIONAL contact made for it;
--   identity_exact  an existing client with the exact same first name, last name and date of birth
--                   (the silent multi-policy case). Both are ladder step 3, with no confidence.
alter table public.policy_match drop constraint if exists policy_match_method;
alter table public.policy_match add constraint policy_match_method check (method in ('policy_number_exact', 'submission_record', 'ai_review', 'human', 'import', 'no_match', 'identity_exact'));
alter table public.policy_match drop constraint if exists policy_match_automatic_is_step_3;
alter table public.policy_match add constraint policy_match_automatic_is_step_3 check (method not in ('no_match', 'identity_exact') or (ladder_step = 3 and confidence is null and contact_id is not null));

-- ─── ownership rules ────────────────────────────────────────────────────────────────────────────
create table if not exists public.queue_assignment_rule (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  queue_type text not null,
  owner_role text not null,
  open_after_days integer,
  escalate_after_days integer,
  escalate_to_role text,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint queue_assignment_rule_type check (queue_type in ('no_deal_flow', 'no_policy', 'multi_policy', 'unmapped_status', 'orphan_commission', 'file_failed')),
  constraint queue_assignment_rule_role check (owner_role in ('writing_agent', 'operations', 'retention', 'admin') and (escalate_to_role is null or escalate_to_role in ('writing_agent', 'operations', 'retention', 'admin'))),
  constraint queue_assignment_rule_days check ((open_after_days is null or open_after_days between 1 and 120) and (escalate_after_days is null or escalate_after_days between 1 and 365)),
  constraint queue_assignment_rule_key unique (tenant_id, queue_type)
);
create index if not exists queue_assignment_rule_updated_by_idx on public.queue_assignment_rule (updated_by) where updated_by is not null;

-- ─── the items ──────────────────────────────────────────────────────────────────────────────────
create table if not exists public.queue_item (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  queue_type text not null,
  subject_type text not null,
  subject_id uuid,
  subject_key text not null,
  carrier_id uuid references public.carriers(id) on delete restrict,
  policy_number text,
  deal_id uuid references public.deal_flow(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  related_contact_id uuid references public.contacts(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  assigned_to_user_id uuid not null references public.users(id) on delete restrict,
  assigned_role text not null,
  age_from date not null default current_date,
  status text not null default 'open',
  resolution text,
  resolution_note text,
  resolution_ref jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  escalated_at timestamptz,
  constraint queue_item_type check (queue_type in ('no_deal_flow', 'no_policy', 'multi_policy', 'unmapped_status', 'orphan_commission', 'file_failed')),
  constraint queue_item_status check (status in ('open', 'resolved', 'dismissed')),
  constraint queue_item_role check (assigned_role in ('writing_agent', 'operations', 'retention', 'admin')),
  constraint queue_item_closed check ((status = 'open') = (resolved_at is null) and (status = 'open' or resolution is not null)),
  constraint queue_item_payload check (jsonb_typeof(payload) = 'object'),
  constraint queue_item_note check (resolution_note is null or char_length(resolution_note) <= 2000)
);
-- One open item per subject per queue, and a closed one is not reopened by the sweep.
create unique index if not exists queue_item_open_key on public.queue_item (tenant_id, queue_type, subject_key) where status = 'open';
create index if not exists queue_item_subject_idx on public.queue_item (tenant_id, queue_type, subject_key);
create index if not exists queue_item_owner_idx on public.queue_item (tenant_id, assigned_to_user_id, status);
create index if not exists queue_item_queue_idx on public.queue_item (tenant_id, status, queue_type, age_from);
create index if not exists queue_item_carrier_idx on public.queue_item (carrier_id) where carrier_id is not null;
create index if not exists queue_item_deal_idx on public.queue_item (deal_id) where deal_id is not null;
create index if not exists queue_item_contact_idx on public.queue_item (contact_id) where contact_id is not null;
create index if not exists queue_item_related_contact_idx on public.queue_item (related_contact_id) where related_contact_id is not null;
create index if not exists queue_item_assignee_idx on public.queue_item (assigned_to_user_id);
create index if not exists queue_item_resolved_by_idx on public.queue_item (resolved_by) where resolved_by is not null;

-- ─── owner resolution: never null ───────────────────────────────────────────────────────────────
create or replace function public.queue_owner(p_tenant_id uuid, p_queue_type text, p_writing_agent uuid default null)
returns table (user_id uuid, role text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_user uuid;
begin
  select r.owner_role into v_role from public.queue_assignment_rule r where r.tenant_id = p_tenant_id and r.queue_type = p_queue_type;
  v_role := coalesce(v_role, case p_queue_type when 'multi_policy' then 'operations' when 'orphan_commission' then 'operations' when 'file_failed' then 'operations' when 'unmapped_status' then 'operations' else 'writing_agent' end);
  if v_role = 'writing_agent' then
    select tu.user_id into v_user from public.tenant_users tu join public.users u on u.id = tu.user_id
     -- A writing agent who can open the queue screen (it carries premiums: owner or producer).
     where tu.tenant_id = p_tenant_id and tu.user_id = p_writing_agent and u.status = 'active' and tu.role::text in ('owner', 'producer');
  else
    select tu.user_id into v_user from public.tenant_users tu join public.users u on u.id = tu.user_id
     where tu.tenant_id = p_tenant_id and u.status = 'active'
       and tu.role::text = case v_role when 'operations' then 'bookkeeper' when 'retention' then 'producer' else 'owner' end
     order by tu.accepted_at nulls last, tu.invited_at nulls last, tu.user_id limit 1;
  end if;
  if v_user is null then
    -- Nobody in that role (or the agent is unknown): the agency's owner, never nobody.
    select tu.user_id into v_user from public.tenant_users tu join public.users u on u.id = tu.user_id
     where tu.tenant_id = p_tenant_id and tu.role::text = 'owner' and u.status = 'active'
     order by tu.accepted_at nulls last, tu.invited_at nulls last, tu.user_id limit 1;
    v_role := 'admin';
  end if;
  if v_user is null then
    raise exception 'queue_owner: agency % has no active owner to own a queue item', p_tenant_id using errcode = 'P0001';
  end if;
  return query select v_user, v_role;
end;
$$;

create or replace function public.open_queue_item(
  p_tenant_id uuid, p_queue_type text, p_subject_key text, p_subject_type text, p_subject_id uuid,
  p_carrier_id uuid, p_policy_number text, p_deal_id uuid, p_contact_id uuid, p_related_contact_id uuid,
  p_payload jsonb, p_writing_agent uuid default null, p_age_from date default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_owner record;
begin
  select id into v_id from public.queue_item where tenant_id = p_tenant_id and queue_type = p_queue_type and subject_key = p_subject_key and status = 'open';
  if v_id is not null then
    update public.queue_item set payload = coalesce(p_payload, payload), updated_at = now() where id = v_id;
    return v_id;
  end if;
  select * into v_owner from public.queue_owner(p_tenant_id, p_queue_type, p_writing_agent);
  insert into public.queue_item (tenant_id, queue_type, subject_type, subject_id, subject_key, carrier_id, policy_number, deal_id, contact_id, related_contact_id, payload, assigned_to_user_id, assigned_role, age_from)
  values (p_tenant_id, p_queue_type, p_subject_type, p_subject_id, p_subject_key, p_carrier_id, p_policy_number, p_deal_id, p_contact_id, p_related_contact_id, coalesce(p_payload, '{}'::jsonb), v_owner.user_id, v_owner.role, coalesce(p_age_from, current_date))
  on conflict (tenant_id, queue_type, subject_key) where status = 'open' do update set updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- Records who closed it and how. p_user null = the system (an automatic resolution).
create or replace function public.resolve_queue_item(p_tenant_id uuid, p_item_id uuid, p_user_id uuid, p_status text, p_resolution text, p_note text default null, p_ref jsonb default null)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('resolved', 'dismissed') then
    raise exception 'resolve_queue_item: status must be resolved or dismissed' using errcode = '22023';
  end if;
  update public.queue_item set status = p_status, resolution = p_resolution, resolution_note = p_note, resolution_ref = p_ref,
         resolved_by = p_user_id, resolved_at = now(), updated_at = now()
   where id = p_item_id and tenant_id = p_tenant_id and status = 'open';
  return found;
end;
$$;

-- "Not mine": hand it to a role's owner (the fallback rule still applies).
create or replace function public.reassign_queue_item(p_tenant_id uuid, p_item_id uuid, p_role text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text;
  v_user uuid;
  v_role text;
begin
  select queue_type into v_type from public.queue_item where id = p_item_id and tenant_id = p_tenant_id and status = 'open';
  if v_type is null then
    raise exception 'reassign_queue_item: no open item' using errcode = 'P0001';
  end if;
  if p_role = 'admin' then
    select o.user_id, o.role into v_user, v_role from public.queue_owner(p_tenant_id, '__admin__', null) o;
  else
    select tu.user_id into v_user from public.tenant_users tu join public.users u on u.id = tu.user_id
     where tu.tenant_id = p_tenant_id and u.status = 'active' and tu.role::text = case p_role when 'operations' then 'bookkeeper' when 'retention' then 'producer' else 'owner' end
     order by tu.accepted_at nulls last, tu.user_id limit 1;
    v_role := p_role;
    if v_user is null then
      select o.user_id, o.role into v_user, v_role from public.queue_owner(p_tenant_id, '__admin__', null) o;
    end if;
  end if;
  update public.queue_item set assigned_to_user_id = v_user, assigned_role = v_role, updated_at = now() where id = p_item_id;
  return v_user;
end;
$$;

-- Queue 2's "never submitted": the sale's open case becomes abandoned with the reason (LA-2.17 funnel).
create or replace function public.close_case_never_submitted(p_tenant_id uuid, p_case_id uuid, p_user_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.tenant_application_cases
     set status = 'abandoned', outcome_reason_code = 'never_submitted', outcome_reason_text = p_reason, closed_by = p_user_id, closed_at = now(), updated_at = now()
   where id = p_case_id and tenant_id = p_tenant_id and status = 'open';
  return found;
end;
$$;

-- ─── the daily sweep: queue 2, escalation, and items the data has since answered ─────────────────
create or replace function public.sweep_exception_queues(p_as_of date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_as_of date := coalesce(p_as_of, current_date);
  v_opened integer := 0;
  v_escalated integer := 0;
  v_closed integer := 0;
  s record;
begin
  -- Queue 2: a sale, N days on, for a carrier whose policy file from N days after the sale we hold,
  -- with no link to it. A closed item is never reopened.
  for s in
    with sales as (
      select d.id, d.tenant_id, d.lead_id, d.worked_by, d.local_date, d.insured_name, d.carrier, d.monthly_premium_cents, d.face_amount_cents, c.id as carrier_id, c.name as carrier_name,
             coalesce((select r.open_after_days from public.queue_assignment_rule r where r.tenant_id = d.tenant_id and r.queue_type = 'no_policy'), 5) as open_after
        from public.deal_flow d
        join public.carriers c on lower(btrim(d.carrier)) in (lower(btrim(c.name)), lower(btrim(coalesce(c.code, ''))))
       where d.call_result = 'application_submitted' and d.status = 'completed'
    )
    select x.* from sales x
     where x.local_date <= v_as_of - x.open_after
       and exists (select 1 from public.file_registry f where f.tenant_id = x.tenant_id and f.carrier_id = x.carrier_id and f.file_type = 'policies'
                    and f.status = 'parsed' and f.file_date >= x.local_date + x.open_after)
       and not exists (select 1 from public.policy_match pm where pm.tenant_id = x.tenant_id and pm.superseded_by_id is null
                        and ((pm.matched_to_type = 'deal_flow' and pm.matched_to_id = x.id)
                          or (pm.matched_to_type = 'application' and pm.matched_to_id in (select a.id from public.tenant_applications a where a.tenant_id = x.tenant_id and a.lead_id = x.lead_id))))
       and not exists (select 1 from public.queue_item q where q.tenant_id = x.tenant_id and q.queue_type = 'no_policy' and q.subject_key = 'deal:' || x.id::text)
  loop
    perform public.open_queue_item(s.tenant_id, 'no_policy', 'deal:' || s.id::text, 'deal_flow', s.id, s.carrier_id, null, s.id, null, null,
      jsonb_build_object('insured_name', s.insured_name, 'carrier_name', s.carrier_name, 'deal_date', s.local_date, 'monthly_premium_cents', s.monthly_premium_cents, 'face_amount_cents', s.face_amount_cents),
      s.worked_by, s.local_date);
    v_opened := v_opened + 1;
  end loop;

  -- Answered since: a sale now linked to a policy; a no-record policy now linked to a deal or application.
  for s in
    select q.id, q.tenant_id from public.queue_item q
     where q.status = 'open' and (
       (q.queue_type = 'no_policy' and exists (select 1 from public.policy_match pm where pm.tenant_id = q.tenant_id and pm.superseded_by_id is null
          and ((pm.matched_to_type = 'deal_flow' and pm.matched_to_id = q.deal_id)
            or (pm.matched_to_type = 'application' and pm.matched_to_id in (select a.id from public.tenant_applications a join public.deal_flow d on d.lead_id = a.lead_id where d.id = q.deal_id)))))
       or (q.queue_type = 'no_deal_flow' and exists (select 1 from public.policy_match pm where pm.tenant_id = q.tenant_id and pm.carrier_id = q.carrier_id and pm.policy_number = q.policy_number
          and pm.superseded_by_id is null and pm.matched_to_type in ('deal_flow', 'application')))
     )
  loop
    perform public.resolve_queue_item(s.tenant_id, s.id, null, 'resolved', 'auto_linked', 'A policy link answered it.', null);
    v_closed := v_closed + 1;
  end loop;

  -- Escalation past the second threshold (default 10 days for queue 2; others only when configured).
  for s in
    select q.id, q.tenant_id, r.escalate_to_role from public.queue_item q
      left join public.queue_assignment_rule r on r.tenant_id = q.tenant_id and r.queue_type = q.queue_type
     where q.status = 'open' and q.escalated_at is null
       and coalesce(r.escalate_after_days, case q.queue_type when 'no_policy' then 10 end) is not null
       and v_as_of - q.age_from >= coalesce(r.escalate_after_days, case q.queue_type when 'no_policy' then 10 end)
  loop
    update public.queue_item set escalated_at = now(), updated_at = now() where id = s.id;
    if s.escalate_to_role is not null then
      perform public.reassign_queue_item(s.tenant_id, s.id, s.escalate_to_role);
    end if;
    v_escalated := v_escalated + 1;
  end loop;

  return jsonb_build_object('opened', v_opened, 'closed', v_closed, 'escalated', v_escalated);
end;
$$;

-- ─── access ─────────────────────────────────────────────────────────────────────────────────────
alter table public.queue_assignment_rule enable row level security;
alter table public.queue_item enable row level security;
drop policy if exists queue_assignment_rule_read on public.queue_assignment_rule;
create policy queue_assignment_rule_read on public.queue_assignment_rule for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists queue_item_read on public.queue_item;
create policy queue_item_read on public.queue_item for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.queue_assignment_rule, public.queue_item from public, anon, authenticated;
-- Supabase grants service_role everything on a new table: take back what only the functions may do.
revoke insert, update, delete, truncate on public.queue_item from service_role, tenant_app;
revoke truncate on public.queue_assignment_rule from service_role, tenant_app;
grant select on public.queue_item to service_role, tenant_app;
grant select, insert, update, delete on public.queue_assignment_rule to service_role;
grant select on public.queue_assignment_rule to tenant_app;
do $$
declare
  f text;
begin
  foreach f in array array['public.queue_owner(uuid, text, uuid)', 'public.open_queue_item(uuid, text, text, text, uuid, uuid, text, uuid, uuid, uuid, jsonb, uuid, date)',
    'public.resolve_queue_item(uuid, uuid, uuid, text, text, text, jsonb)', 'public.reassign_queue_item(uuid, uuid, text)',
    'public.close_case_never_submitted(uuid, uuid, uuid, text)', 'public.sweep_exception_queues(date)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('la4-exception-queues-daily', '30 6 * * *', $cron$select public.sweep_exception_queues()$cron$);
    exception when others then
      raise notice '20261008180000: the daily sweep could not be scheduled (%).', sqlerrm;
    end;
  else
    raise notice '20261008180000: pg_cron is not installed; run sweep_exception_queues() from another scheduler.';
  end if;
end $$;

-- Run the sweep the way the job will (a job that fails at 06:30 fails silently), then check.
do $$
declare
  v jsonb;
  v_missing integer;
begin
  v := public.sweep_exception_queues();
  if v ? 'opened' is not true then
    raise exception '20261008180000: the sweep did not report';
  end if;
  if has_table_privilege('service_role', 'public.queue_item', 'INSERT') or has_table_privilege('service_role', 'public.queue_item', 'UPDATE') or has_table_privilege('service_role', 'public.queue_item', 'DELETE') then
    raise exception '20261008180000: queue items must be written only by their functions (service_role still has insert=%, update=%, delete=%)',
      has_table_privilege('service_role', 'public.queue_item', 'INSERT'), has_table_privilege('service_role', 'public.queue_item', 'UPDATE'), has_table_privilege('service_role', 'public.queue_item', 'DELETE');
  end if;
  -- Every agency with users can own an item.
  select count(*) into v_missing from public.tenants t
   where exists (select 1 from public.tenant_users tu where tu.tenant_id = t.id)
     and not exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = t.id and tu.role::text = 'owner' and u.status = 'active');
  if v_missing > 0 then
    raise notice '20261008180000: % agencies have no active owner; their queue items would be refused, not left unowned.', v_missing;
  end if;
end $$;

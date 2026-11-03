-- Settings › Inbound transfers (Module 1 simplified, redesign 2026-10-25; Inbound A chosen by the owner).
--
-- The waiting-time ladder already has its own table (tenant_queue_sla_settings, LA-1.23). What the
-- section adds, and where each one is honoured:
--
--   alert_new_transfer          agents (owner, producer, assistant) get the "new lead waiting" alert
--                               (lib/agentTemplates/intake.ts)
--   email_owners_on_escalation  the escalation email to every active owner at the escalate rung
--                               (lib/queueSla/service.ts); the in-app escalation alert stays on
--   handoff_timeout_seconds     how long a buffer agent's handoff offer waits for the licensed agent
--                               (offer_buffer_handoff already accepts 5–300 s; it was always 30)
--   licensed_only               Take next and the claim card offer a licensed agent (owner, producer)
--                               only callers in a state they hold a live licence for. A buffer agent
--                               (assistant) is unlicensed by design and is not filtered. A caller with
--                               no state on file is offered as before: there is nothing to check.
--   skip_on_break               an agent whose presence is "on break" or "off" is not handed one
--
-- No row means the defaults, which are exactly today's behaviour.

create table if not exists public.tenant_inbound_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  alert_new_transfer boolean not null default true,
  email_owners_on_escalation boolean not null default true,
  handoff_timeout_seconds integer not null default 30,
  licensed_only boolean not null default false,
  skip_on_break boolean not null default false,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_inbound_settings_handoff_timeout check (handoff_timeout_seconds between 5 and 300)
);

alter table public.tenant_inbound_settings enable row level security;

drop policy if exists tenant_inbound_settings_scoped on public.tenant_inbound_settings;
create policy tenant_inbound_settings_scoped on public.tenant_inbound_settings
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_inbound_settings from anon, authenticated, public;
grant select on public.tenant_inbound_settings to tenant_app;
-- Writes go through update_tenant_inbound_settings only (owner check + audit row).
revoke insert, update, delete, truncate on public.tenant_inbound_settings from service_role;
grant select on public.tenant_inbound_settings to service_role;

create or replace function public.update_tenant_inbound_settings(
  p_tenant_id uuid, p_actor uuid,
  p_alert_new_transfer boolean, p_email_owners_on_escalation boolean,
  p_handoff_timeout_seconds integer, p_licensed_only boolean, p_skip_on_break boolean
)
returns public.tenant_inbound_settings
language plpgsql security definer set search_path = public, pg_catalog as $$
declare result public.tenant_inbound_settings;
begin
  if not exists (
    select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id
    where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and tu.role = 'owner'
      and tu.accepted_at is not null and u.status = 'active'
  ) then raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED'; end if;
  if p_alert_new_transfer is null or p_email_owners_on_escalation is null or p_licensed_only is null
     or p_skip_on_break is null or p_handoff_timeout_seconds is null
     or p_handoff_timeout_seconds < 5 or p_handoff_timeout_seconds > 300 then
    raise exception using errcode = '22023', message = 'INVALID_INBOUND_SETTINGS';
  end if;
  insert into public.tenant_inbound_settings
    (tenant_id, alert_new_transfer, email_owners_on_escalation, handoff_timeout_seconds, licensed_only, skip_on_break, updated_by, updated_at)
  values (p_tenant_id, p_alert_new_transfer, p_email_owners_on_escalation, p_handoff_timeout_seconds, p_licensed_only, p_skip_on_break, p_actor, now())
  on conflict (tenant_id) do update set
    alert_new_transfer = excluded.alert_new_transfer,
    email_owners_on_escalation = excluded.email_owners_on_escalation,
    handoff_timeout_seconds = excluded.handoff_timeout_seconds,
    licensed_only = excluded.licensed_only,
    skip_on_break = excluded.skip_on_break,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning * into result;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, 'tenant.inbound_settings_updated', 'tenant_inbound_settings', p_tenant_id::text,
    jsonb_build_object('alert_new_transfer', p_alert_new_transfer, 'email_owners_on_escalation', p_email_owners_on_escalation,
      'handoff_timeout_seconds', p_handoff_timeout_seconds, 'licensed_only', p_licensed_only, 'skip_on_break', p_skip_on_break));
  return result;
end;
$$;

revoke execute on function public.update_tenant_inbound_settings(uuid, uuid, boolean, boolean, integer, boolean, boolean) from public, anon, authenticated;
grant execute on function public.update_tenant_inbound_settings(uuid, uuid, boolean, boolean, integer, boolean, boolean) to service_role;

-- claim_next_transfer, as 20260925709860 left it, plus the two settings above. The filters, the
-- language rule, the order (longest waiting first) and the hand-off to claim_transfer_lead are
-- unchanged; only the two new refusals and the licence filter are added.
create or replace function public.claim_next_transfer(
  p_tenant_id uuid, p_user_id uuid, p_owner_role text,
  p_partner_id uuid default null, p_product_line text default null,
  p_state text default null, p_screening_outcome text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_work_item_id uuid;
  v_language text;
  v_licensed_only boolean := false;
  v_skip_on_break boolean := false;
  v_check_licence boolean;
  v_unlicensed_state text;
begin
  select coalesce(s.licensed_only, false), coalesce(s.skip_on_break, false)
    into v_licensed_only, v_skip_on_break
    from public.tenant_inbound_settings s
   where s.tenant_id = p_tenant_id;
  v_licensed_only := coalesce(v_licensed_only, false);
  v_skip_on_break := coalesce(v_skip_on_break, false);
  -- Buffer agents (assistant) are unlicensed by design: they qualify and hand on.
  v_check_licence := v_licensed_only and p_owner_role in ('owner', 'producer');

  if v_skip_on_break and exists (
    select 1 from public.agent_presence ap
     where ap.tenant_id = p_tenant_id and ap.user_id = p_user_id and ap.status in ('on_break', 'off')
  ) then
    raise exception using errcode = 'P0001', message = 'AGENT_ON_BREAK';
  end if;

  select q.id into v_work_item_id
    from public.lead_queue q
    join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
   where q.tenant_id = p_tenant_id
     and q.partner_id is not null
     and q.status = 'unclaimed'
     and (p_partner_id is null or q.partner_id = p_partner_id)
     and (p_product_line is null or q.product_line = p_product_line)
     and (p_state is null or coalesce(nullif(btrim(l.values->>'state'), ''), nullif(btrim(l.values->>'state_code'), ''), nullif(btrim(l.values->>'primary_state'), ''), nullif(btrim(l.carrier_state), '')) = p_state)
     and (p_screening_outcome is null or coalesce(q.screening_outcome, l.screening_outcome, 'not_checked') = p_screening_outcome)
     -- LA-1.14-10: never hand this agent a caller they cannot talk to.
     and public.agent_speaks_language(p_tenant_id, p_user_id, public.lead_language_key(l.values))
     -- Settings › Inbound: only callers in a state this agent holds a live licence for.
     and (not v_check_licence or public.inbound_agent_licensed_for(p_tenant_id, p_user_id,
          coalesce(nullif(btrim(l.values->>'state'), ''), nullif(btrim(l.values->>'state_code'), ''), nullif(btrim(l.values->>'primary_state'), ''), nullif(btrim(l.carrier_state), ''))))
   order by q.queued_at asc, q.id asc
   limit 1
   for update of q skip locked;

  if v_work_item_id is null then
    -- Say why when the only callers waiting asked for a language this agent does not list.
    select public.lead_language_key(l.values) into v_language
      from public.lead_queue q
      join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
     where q.tenant_id = p_tenant_id
       and q.partner_id is not null
       and q.status = 'unclaimed'
       and (p_partner_id is null or q.partner_id = p_partner_id)
       and (p_product_line is null or q.product_line = p_product_line)
       and (p_state is null or coalesce(nullif(btrim(l.values->>'state'), ''), nullif(btrim(l.values->>'state_code'), ''), nullif(btrim(l.values->>'primary_state'), ''), nullif(btrim(l.carrier_state), '')) = p_state)
       and (p_screening_outcome is null or coalesce(q.screening_outcome, l.screening_outcome, 'not_checked') = p_screening_outcome)
     order by q.queued_at asc, q.id asc
     limit 1;
    if v_language is not null then
      raise exception using errcode = 'P0001', message = 'LANGUAGE_NOT_SPOKEN', detail = v_language;
    end if;
    -- And when the callers waiting are all in states this agent is not licensed in.
    if v_check_licence then
      select upper(coalesce(nullif(btrim(l.values->>'state'), ''), nullif(btrim(l.values->>'state_code'), ''), nullif(btrim(l.values->>'primary_state'), ''), nullif(btrim(l.carrier_state), '')))
        into v_unlicensed_state
        from public.lead_queue q
        join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
       where q.tenant_id = p_tenant_id
         and q.partner_id is not null
         and q.status = 'unclaimed'
         and (p_partner_id is null or q.partner_id = p_partner_id)
         and (p_product_line is null or q.product_line = p_product_line)
         and (p_screening_outcome is null or coalesce(q.screening_outcome, l.screening_outcome, 'not_checked') = p_screening_outcome)
       order by q.queued_at asc, q.id asc
       limit 1;
      if v_unlicensed_state is not null then
        raise exception using errcode = 'P0001', message = 'NOT_LICENSED_FOR_WAITING', detail = v_unlicensed_state;
      end if;
    end if;
    raise exception using errcode = 'P0002', message = 'NO_TRANSFER_WAITING';
  end if;

  -- The row is locked by this transaction, so claim_transfer_lead's own FOR UPDATE re-reads it
  -- without waiting, and its status check still refuses anything that is no longer unclaimed.
  return public.claim_transfer_lead(p_tenant_id, v_work_item_id, p_user_id, p_owner_role);
end;
$$;

-- A live licence: the state is on the agent's list and not past its expiry. A caller with no state
-- passes (there is nothing to check against).
create or replace function public.inbound_agent_licensed_for(p_tenant_id uuid, p_user_id uuid, p_state text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select p_state is null
      or exists (
        select 1 from public.tenant_user_licensed_states s
         where s.tenant_id = p_tenant_id
           and s.user_id = p_user_id
           and s.state = upper(btrim(p_state))
           and (s.expires_on is null or s.expires_on >= current_date)
      )
$$;

revoke execute on function public.inbound_agent_licensed_for(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.inbound_agent_licensed_for(uuid, uuid, text) to service_role;

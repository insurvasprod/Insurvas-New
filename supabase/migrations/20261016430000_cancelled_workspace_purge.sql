-- Deleting a cancelled agency's workspace, on request (2026-10-16).
--
-- The terms (tos-v2 §9), the privacy notice and the DPA (§8) promise that an agency which has
-- cancelled can ask for its remaining data to be deleted, and that it will be, except records
-- Insurvas must keep (billing and legal acceptance). Nothing could do it: ~60 tables refuse deletes
-- outright (append-only ledgers, immutable carrier rows, the permanent do-not-call list) and the
-- postgres role cannot switch triggers off. This adds one narrow, audited way through:
--
--   tenant_purge_run             one row per purge: who asked, why, and what was deleted. While it
--                                is 'running' it names the database connection doing the purge.
--   tenant_purge_active(row)     true only inside that connection's purge, and only for a row of the
--                                agency being purged (or a row with no tenant id, which a purge only
--                                reaches by cascading from that agency's own rows).
--   every delete-time trigger    gains one first line: during that purge, let the delete through and
--                                skip its side effects (a tombstone, an audit copy or a credit
--                                adjustment written mid-purge would re-create agency rows or touch
--                                the kept billing records). Outside a purge nothing changes.
--                                Not touched: the platform's own billing, audit and admin guards.
--   purge_tenant_workspace(...)  refuses unless the subscription is cancelled, no legal hold is
--                                active and the operator typed the agency's exact name; deletes the
--                                agency's rows from every table with a tenant_id except the kept
--                                billing records (17 tables), in as many passes as the foreign keys
--                                need; then proves nothing is left, or rolls the whole thing back.
--                                Staff and partner accounts that belonged only to this agency are
--                                anonymised (they stay as rows: audit and billing records point at
--                                them). Uploaded files are removed by the app, which owns Storage.
--   cancelled_workspaces_due()   agencies past their read-only window and not yet purged, for the
--                                admin console. Nothing is deleted automatically.
--
-- Function bodies are the live definitions (read 2026-10-16) plus that one line each.
-- Rollback: drop function public.purge_tenant_workspace(uuid, uuid, text, text),
-- public.cancelled_workspaces_due(), public.tenant_purge_active(jsonb) after restoring the 46
-- trigger functions from their previous migrations (each keeps its body minus the inserted block);
-- tenant_purge_run can stay as the record of past purges.

create table if not exists public.tenant_purge_run (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  requested_by uuid,
  reason text not null check (char_length(btrim(reason)) between 10 and 1000),
  status text not null default 'running' check (status in ('running', 'done')),
  backend_pid integer not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  results jsonb not null default '{}'::jsonb
);
create unique index if not exists tenant_purge_run_one_running on public.tenant_purge_run (tenant_id) where status = 'running';
create index if not exists tenant_purge_run_tenant_idx on public.tenant_purge_run (tenant_id, started_at desc);
alter table public.tenant_purge_run enable row level security;
revoke all on public.tenant_purge_run from public, anon, authenticated, tenant_app;
grant select on public.tenant_purge_run to service_role;
revoke insert, update, delete, truncate on public.tenant_purge_run from service_role;

create or replace function public.tenant_purge_active(p_row jsonb)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.tenant_purge_run r
     where r.status = 'running' and r.backend_pid = pg_backend_pid()
       and (p_row->>'tenant_id' is null or r.tenant_id::text = p_row->>'tenant_id'))
$$;
-- Every trigger calls it, as whichever role deleted; it can only ever say "not in a purge" to them.
grant execute on function public.tenant_purge_active(jsonb) to public;

-- private.record_lead_note_tombstone(): lead_notes
CREATE OR REPLACE FUNCTION private.record_lead_note_tombstone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  lead_partner_id uuid;
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  select partner_id into lead_partner_id
  from public.leads
  where id = old.lead_id and organization_id = old.organization_id;
  if old.organization_id is not null then
    insert into public.lead_note_tombstones (
      organization_id, lead_id, note_id, body, visibility, partner_id, deleted_by
    ) values (
      old.organization_id, old.lead_id, old.id, left(coalesce(old.body, ''), 4000),
      coalesce(old.visibility, 'internal'), lead_partner_id, auth.uid()
    );
  end if;
  return old;
end;
$function$;

-- update_verification_progress(): verification_items
CREATE OR REPLACE FUNCTION public.update_verification_progress()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare sid uuid;
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  sid := case when tg_op = 'DELETE' then old.session_id else new.session_id end;
  update public.tenant_verification_sessions set
    verified_fields = (select count(*)::int from public.verification_items where session_id = sid and is_verified),
    total_fields = (select count(*)::int from public.verification_items where session_id = sid),
    progress_percentage = case when (select count(*) from public.verification_items where session_id = sid) = 0 then 0 else floor(100.0 * (select count(*) from public.verification_items where session_id = sid and is_verified) / (select count(*) from public.verification_items where session_id = sid))::int end,
    updated_at = now() where id = sid;
  return coalesce(new, old);
end;
$function$;

-- private.audit_daily_deal_flow_change(): daily_deal_flow
CREATE OR REPLACE FUNCTION private.audit_daily_deal_flow_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_before jsonb;
  v_after jsonb;
  v_changed text[];
  v_row_id uuid;
  v_org_id uuid;
  v_operation text;
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  v_operation := lower(tg_op);
  if tg_op = 'INSERT' then
    v_after := to_jsonb(new);
    v_row_id := new.id;
    v_org_id := new.organization_id;
    select coalesce(array_agg(key order by key), '{}'::text[])
      into v_changed
    from jsonb_object_keys(v_after) as fields(key)
    where key not in ('id', 'created_at', 'updated_at');
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    v_row_id := new.id;
    v_org_id := new.organization_id;
    select coalesce(array_agg(key order by key), '{}'::text[])
      into v_changed
    from jsonb_object_keys(v_after) as fields(key)
    where key not in ('updated_at')
      and (v_before -> key) is distinct from (v_after -> key);
    if coalesce(array_length(v_changed, 1), 0) = 0 then
      return new;
    end if;
  else
    v_before := to_jsonb(old);
    v_row_id := old.id;
    v_org_id := old.organization_id;
    select coalesce(array_agg(key order by key), '{}'::text[])
      into v_changed
    from jsonb_object_keys(v_before) as fields(key)
    where key not in ('id', 'created_at', 'updated_at');
  end if;

  insert into public.daily_deal_flow_audit (
    daily_deal_flow_id, organization_id, actor_user_id, operation,
    changed_columns, before_row, after_row
  ) values (
    v_row_id, v_org_id, auth.uid(), v_operation,
    v_changed, v_before, v_after
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

-- private.audit_lead_note_write(): lead_notes
CREATE OR REPLACE FUNCTION private.audit_lead_note_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  note_row public.lead_notes;
  action_name text;
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then note_row := old; else note_row := new; end if;
  action_name := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'edited' else 'deleted' end;
  if note_row.organization_id is not null then
    insert into public.audit_logs (
      organization_id, actor_user_id, action, entity_type, entity_id, summary, metadata
    ) values (
      note_row.organization_id, auth.uid(), 'lead.note.' || action_name, 'lead_note',
      note_row.id::text, 'Lead note ' || action_name,
      jsonb_build_object('leadId', note_row.lead_id, 'visibility', note_row.visibility)
    );
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$function$;

-- broadcast_la_1_15_floor_change(): active_calls, agent_floor_nudges, agent_presence, buffer_handoffs, lead_queue
CREATE OR REPLACE FUNCTION public.broadcast_la_1_15_floor_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  floor_tenant_id uuid;
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  floor_tenant_id := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  perform realtime.send(
    jsonb_build_object('tenant_id', floor_tenant_id),
    'floor_changed',
    'agent-floor:' || floor_tenant_id::text,
    false
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

-- prevent_suppression_removal(): tenant_suppression_list
CREATE OR REPLACE FUNCTION public.prevent_suppression_removal()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  raise exception 'suppression_permanent: a suppressed number cannot be removed (%). Suppression is permanent by design; if this is genuinely wrong, it takes a migration.', old.phone_digits
    using errcode = 'check_violation';
end;
$function$;

-- apply_lead_claim_credit_delta(): lead_claims
CREATE OR REPLACE FUNCTION public.apply_lead_claim_credit_delta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_delta integer;
  v_campaign uuid;
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'INSERT' then
    v_delta := new.amount_credited_cents;
    v_campaign := new.campaign_id;
  elsif tg_op = 'UPDATE' then
    v_delta := new.amount_credited_cents - old.amount_credited_cents;
    v_campaign := new.campaign_id;
  else
    v_delta := -old.amount_credited_cents;
    v_campaign := old.campaign_id;
  end if;
  if v_delta <> 0 then
    update tenant_campaigns
       set credits_received_cents = credits_received_cents + v_delta,
           updated_at = now()
     where id = v_campaign and tenant_id = coalesce(new.tenant_id, old.tenant_id);
    if not found then raise exception 'LEAD_CLAIM_CAMPAIGN_NOT_FOUND'; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

-- refresh_assignment_capacity_trigger(): lead_queue
CREATE OR REPLACE FUNCTION public.refresh_assignment_capacity_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' and old.owner_user_id is not null then
    perform public.refresh_agent_capacity_for_user(old.tenant_id, old.owner_user_id);
  end if;
  if tg_op <> 'DELETE' and new.owner_user_id is not null then
    perform public.refresh_agent_capacity_for_user(new.tenant_id, new.owner_user_id);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

-- prevent_internal_dnc_removal(): tenant_do_not_call
CREATE OR REPLACE FUNCTION public.prevent_internal_dnc_removal()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'suppression_permanent: % cannot be removed from the do-not-call list. A do-not-call request is permanent by design; if this is genuinely wrong, it takes a migration.', old.phone_digits
      using errcode = 'check_violation';
  end if;

  -- Re-suppressing an already suppressed number is fine, and so is correcting the note or the lead
  -- it came from. Only the transition that makes a suppressed number dialable again is refused.
  if old.is_active and not new.is_active then
    raise exception 'suppression_permanent: % cannot be reactivated for dialing. A do-not-call request is permanent by design.', old.phone_digits
      using errcode = 'check_violation';
  end if;

  if new.phone_digits is distinct from old.phone_digits
     or new.tenant_id is distinct from old.tenant_id then
    raise exception 'suppression_permanent: the number or owner of a do-not-call entry cannot be changed (%). Add a new entry instead.', old.phone_digits
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

-- sales_templates_guard_published(): sales_templates
CREATE OR REPLACE FUNCTION public.sales_templates_guard_published()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'SALES_TEMPLATE_PUBLISHED_IMMUTABLE: % v% is %, it cannot be deleted', old.name, old.version, old.status;
    end if;
    return old;
  end if;

  if old.status in ('published', 'retired') then
    if new.definition is distinct from old.definition
       or (new.tenant_id, new.kind, new.product_code, new.carrier_id, new.version, new.name, new.published_at)
          is distinct from (old.tenant_id, old.kind, old.product_code, old.carrier_id, old.version, old.name, old.published_at) then
      raise exception 'SALES_TEMPLATE_PUBLISHED_IMMUTABLE: % v% is %; edit a new version instead', old.name, old.version, old.status;
    end if;
    if new.status is distinct from old.status and not (old.status = 'published' and new.status = 'retired') then
      raise exception 'SALES_TEMPLATE_PUBLISHED_IMMUTABLE: % v% cannot go from % to %', old.name, old.version, old.status, new.status;
    end if;
  end if;
  return new;
end;
$function$;

-- carrier_field_map_guard(): carrier_field_map
CREATE OR REPLACE FUNCTION public.carrier_field_map_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_unverified text;
  v_frozen boolean;
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'published' then
      raise exception 'CARRIER_FIELD_MAP_PUBLISH_ON_INSERT: insert the map as a draft, add its entries, then publish it';
    end if;
    return new;
  end if;

  v_frozen := old.status in ('published', 'retired') or (old.status = 'needs_review' and old.approved_at is not null);

  if tg_op = 'DELETE' then
    if v_frozen then
      raise exception 'CARRIER_FIELD_MAP_PUBLISHED_IMMUTABLE: map v% has been published and cannot be deleted', old.version;
    end if;
    return old;
  end if;

  if v_frozen then
    if (new.tenant_id, new.carrier_id, new.carrier_product_id, new.version, new.origin, new.created_by,
        new.approved_by, new.approved_by_admin, new.approved_at, new.proposal_source)
       is distinct from
       (old.tenant_id, old.carrier_id, old.carrier_product_id, old.version, old.origin, old.created_by,
        old.approved_by, old.approved_by_admin, old.approved_at, old.proposal_source) then
      raise exception 'CARRIER_FIELD_MAP_PUBLISHED_IMMUTABLE: map v% has been published; edit a new version instead', old.version;
    end if;
    if new.status is distinct from old.status
       and not ((old.status = 'published' and new.status in ('needs_review', 'retired'))
             or (old.status = 'needs_review' and new.status in ('published', 'retired'))) then
      raise exception 'CARRIER_FIELD_MAP_PUBLISHED_IMMUTABLE: map v% cannot go from % to %', old.version, old.status, new.status;
    end if;
    return new;
  end if;

  if new.status = 'published' and old.status is distinct from 'published' then
    select string_agg(distinct e.field_key, ', ' order by e.field_key) into v_unverified
      from public.carrier_field_map_entry e
      join public.carrier_field_map_step s on s.id = e.step_id
     where s.map_id = new.id
       and e.field_key in ('insured.ssn', 'pay.routing_number', 'pay.account_number', 'pay.card_number')
       and not e.verified;
    if v_unverified is not null then
      raise exception 'CARRIER_FIELD_MAP_SENSITIVE_UNVERIFIED: verify % before publishing', v_unverified;
    end if;
  end if;
  return new;
end;
$function$;

-- carrier_field_map_child_guard(): carrier_field_map_entry, carrier_field_map_step
CREATE OR REPLACE FUNCTION public.carrier_field_map_child_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_map_ids uuid[];
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_table_name = 'carrier_field_map_step' then
    v_map_ids := array_remove(array[
      case when tg_op <> 'INSERT' then old.map_id end,
      case when tg_op <> 'DELETE' then new.map_id end], null);
  else
    select array_agg(s.map_id) into v_map_ids
      from public.carrier_field_map_step s
     where s.id in (case when tg_op <> 'INSERT' then old.step_id end,
                    case when tg_op <> 'DELETE' then new.step_id end);
  end if;

  if exists (select 1 from public.carrier_field_map m
              where m.id = any (coalesce(v_map_ids, '{}'::uuid[]))
                and (m.status in ('published', 'retired') or (m.status = 'needs_review' and m.approved_at is not null))) then
    raise exception 'CARRIER_FIELD_MAP_PUBLISHED_IMMUTABLE: this map has been published; edit a new version instead';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

-- application_disclosures_guard(): application_disclosures
CREATE OR REPLACE FUNCTION public.application_disclosures_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft'
       and (old.tenant_id is null or exists (select 1 from public.tenants t where t.id = old.tenant_id)) then
      raise exception 'DISCLOSURE_PUBLISHED_IMMUTABLE: % v% is %, it cannot be deleted', old.code, old.version, old.status;
    end if;
    return old;
  end if;

  if old.status in ('published', 'retired') then
    -- created_by is left out: a deleted user sets it null, and that is not an edit of the text.
    if (new.tenant_id, new.code, new.title, new.body_markdown, new.attachment_path, new.states, new.carrier_ids, new.version)
       is distinct from
       (old.tenant_id, old.code, old.title, old.body_markdown, old.attachment_path, old.states, old.carrier_ids, old.version) then
      raise exception 'DISCLOSURE_PUBLISHED_IMMUTABLE: % v% is %; edit a new version instead', old.code, old.version, old.status;
    end if;
    if new.status is distinct from old.status and not (old.status = 'published' and new.status = 'retired') then
      raise exception 'DISCLOSURE_PUBLISHED_IMMUTABLE: % v% cannot go from % to %', old.code, old.version, old.status, new.status;
    end if;
  end if;
  return new;
end;
$function$;

-- application_disclosure_rules_guard(): application_disclosure_rules
CREATE OR REPLACE FUNCTION public.application_disclosure_rules_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if exists (select 1 from public.application_disclosures d
              where d.id in (case when tg_op <> 'INSERT' then old.disclosure_id end,
                             case when tg_op <> 'DELETE' then new.disclosure_id end)
                and d.status in ('published', 'retired')) then
    raise exception 'DISCLOSURE_PUBLISHED_IMMUTABLE: the rules of a published disclosure cannot change; edit a new version instead';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

-- raw_rows_immutable(): raw_rows
CREATE OR REPLACE FUNCTION public.raw_rows_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  -- LA-6.5: a consumer deletion may erase the person's identifiers from a row's payload. Nothing
  -- else about the row may change, and a row is still never removed.
  if tg_op = 'UPDATE' and coalesce(current_setting('app.data_subject_deletion', true), '') <> ''
     and (to_jsonb(new) - 'payload') = (to_jsonb(old) - 'payload') then
    return new;
  end if;
  raise exception 'Raw rows are never changed or removed; register a corrected file instead.' using errcode = 'P0001';
end;
$function$;

-- carrier_layout_map_guard(): carrier_layout_map
CREATE OR REPLACE FUNCTION public.carrier_layout_map_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_type text;
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'INSERT' then
    if new.status in ('published', 'retired') then
      raise exception 'A layout map is published from a draft, never inserted published.' using errcode = 'P0001';
    end if;
    select file_type into v_type from public.carrier_layout_map
     where layout_key = new.layout_key and coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(new.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
     limit 1;
    if v_type is not null and v_type <> new.file_type then
      raise exception 'Every version of layout % reads % files.', new.layout_key, v_type using errcode = 'P0001';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status in ('published', 'retired') then
      raise exception 'A published layout map is never deleted; retire it.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status in ('published', 'retired') then
    if new.tenant_id is distinct from old.tenant_id or new.layout_key is distinct from old.layout_key
       or new.name is distinct from old.name or new.file_type is distinct from old.file_type
       or new.version is distinct from old.version or new.header_row_index is distinct from old.header_row_index
       or new.sheet_name is distinct from old.sheet_name or new.row_count_swing_pct is distinct from old.row_count_swing_pct
       or new.total_row_column is distinct from old.total_row_column or new.total_row_value is distinct from old.total_row_value
       or new.pdf_layout is distinct from old.pdf_layout
       or new.proposal_source is distinct from old.proposal_source or new.created_by is distinct from old.created_by
       or new.created_by_admin is distinct from old.created_by_admin or new.approved_by is distinct from old.approved_by
       or new.approved_by_admin is distinct from old.approved_by_admin or new.approved_at is distinct from old.approved_at then
      raise exception 'A published layout map cannot be edited; start version % instead.', old.version + 1 using errcode = 'P0001';
    end if;
    if new.status is distinct from old.status and not (old.status = 'published' and new.status = 'retired') then
      raise exception 'A published layout map can only be retired.' using errcode = 'P0001';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

-- carrier_layout_map_entry_guard(): carrier_layout_map_entry
CREATE OR REPLACE FUNCTION public.carrier_layout_map_entry_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_status text;
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  select status into v_status from public.carrier_layout_map where id = coalesce(new.map_id, old.map_id);
  -- A map being deleted (a draft) takes its entries with it; its row is already gone here.
  if v_status in ('published', 'retired') then
    raise exception 'A published layout map''s columns cannot change; start a new version.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.map_id is distinct from old.map_id then
    raise exception 'An entry stays on its map.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$function$;

-- carrier_status_map_guard(): carrier_status_map
CREATE OR REPLACE FUNCTION public.carrier_status_map_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    if old.approved_at is not null then
      raise exception 'An approved status mapping is never removed.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.approved_at is not null then
    raise exception 'An approved status mapping cannot change.' using errcode = 'P0001';
  end if;
  if new.carrier_id is distinct from old.carrier_id or new.file_type is distinct from old.file_type
     or new.carrier_status_raw is distinct from old.carrier_status_raw then
    raise exception 'A status mapping keeps the carrier word it was made for.' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

-- carrier_retention_rule_guard(): carrier_retention_rule
CREATE OR REPLACE FUNCTION public.carrier_retention_rule_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A carrier rule is never removed; add a new one from a date, or clear the override.' using errcode = 'P0001';
  end if;
  if old.verified_at is null and new.verified_at is not null
     and (to_jsonb(new) - 'verified_by' - 'verified_by_admin' - 'verified_at') = (to_jsonb(old) - 'verified_by' - 'verified_by_admin' - 'verified_at') then
    return new;
  end if;
  raise exception 'A carrier rule is never edited; add a new one from a date.' using errcode = 'P0001';
end;
$function$;

-- policy_match_guard(): policy_match
CREATE OR REPLACE FUNCTION public.policy_match_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A policy link is never removed; correct it with a new link.' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - 'superseded_by_id' - 'confirmed_by' - 'confirmed_at') = (to_jsonb(old) - 'superseded_by_id' - 'confirmed_by' - 'confirmed_at')
     and (old.superseded_by_id is null or new.superseded_by_id is not distinct from old.superseded_by_id)
     and (old.confirmed_at is null or (new.confirmed_at is not distinct from old.confirmed_at and new.confirmed_by is not distinct from old.confirmed_by)) then
    return new;
  end if;
  raise exception 'A policy link is never edited; correct it with a new link.' using errcode = 'P0001';
end;
$function$;

-- commission_entry_guard(): commission_entry
CREATE OR REPLACE FUNCTION public.commission_entry_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  raise exception 'A commission entry is never changed or removed; write a reversal instead.' using errcode = 'P0001';
end;
$function$;

-- expected_commission_guard(): expected_commission
CREATE OR REPLACE FUNCTION public.expected_commission_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_free text[] := array['commission_trigger', 'trigger_occurred_on', 'overdue_from', 'computed_at'];
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'An expected commission row is never removed.' using errcode = 'P0001';
  end if;
  if old.expected_advance_cents is null then
    v_free := v_free || array['advance_months', 'advance_pct_bp', 'expected_advance_cents'];
  end if;
  if old.confidence <> 'no_rate_card' and (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free) then
    raise exception 'An expected commission figure is never rewritten; a rate change applies to later rows.' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

-- commission_dispute_guard(): commission_dispute
CREATE OR REPLACE FUNCTION public.commission_dispute_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'A dispute that was sent is kept.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status <> 'draft' and (new.letter_body is distinct from old.letter_body or new.discrepancy_ids is distinct from old.discrepancy_ids
     or new.total_cents is distinct from old.total_cents or new.carrier_id is distinct from old.carrier_id) then
    raise exception 'A sent dispute letter never changes; draft a new one.' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

-- retention_action_guard(): retention_action
CREATE OR REPLACE FUNCTION public.retention_action_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A logged retention call is never removed.' using errcode = 'P0001';
  end if;
  if (new.tenant_id, new.carrier_id, new.policy_number, new.reason, new.outcome, new.note, new.acted_by, new.acted_at, new.board_snapshot_date, new.board_state)
     is distinct from (old.tenant_id, old.carrier_id, old.policy_number, old.reason, old.outcome, old.note, old.acted_by, old.acted_at, old.board_snapshot_date, old.board_state) then
    raise exception 'A logged retention call never changes; log another.' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

-- commission_account_entry_guard(): commission_account_entry
CREATE OR REPLACE FUNCTION public.commission_account_entry_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  raise exception 'An account entry is never changed or removed; write a reversal instead.' using errcode = 'P0001';
end;
$function$;

-- risk_weight_set_guard(): risk_weight_set
CREATE OR REPLACE FUNCTION public.risk_weight_set_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  raise exception 'A weight set is never edited or removed; save a new version.' using errcode = 'P0001';
end;
$function$;

-- save_attempt_guard(): save_attempt
CREATE OR REPLACE FUNCTION public.save_attempt_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A save attempt is never removed.' using errcode = 'P0001';
  end if;
  -- The one move allowed: LA-5.4 linking the servicing request a fix started.
  if (to_jsonb(new) - 'servicing_request_id') is distinct from (to_jsonb(old) - 'servicing_request_id')
     or (old.servicing_request_id is not null and new.servicing_request_id is distinct from old.servicing_request_id) then
    raise exception 'A save attempt never changes; log another.' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

-- servicing_request_guard(): servicing_request
CREATE OR REPLACE FUNCTION public.servicing_request_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_verifier boolean := coalesce(current_setting('app.servicing_verifier', true), '') = 'on';
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A servicing request is never removed; cancel it.' using errcode = 'P0001';
  end if;
  if (new.tenant_id, new.carrier_id, new.policy_number, new.request_type, new.origin, new.save_attempt_id, new.requested_by, new.created_at)
     is distinct from (old.tenant_id, old.carrier_id, old.policy_number, old.request_type, old.origin, old.save_attempt_id, old.requested_by, old.created_at) then
    raise exception 'What a servicing request is for never changes; open another.' using errcode = 'P0001';
  end if;
  if old.status <> 'draft' and (new.field_changes_json, new.target_draft_day) is distinct from (old.field_changes_json, old.target_draft_day) then
    raise exception 'The change asked for is fixed once it is sent; cancel and open another.' using errcode = 'P0001';
  end if;
  if (new.verified_at, new.verified_snapshot_date, new.failed_at, new.failure_reason, new.unprovable_fields, new.checked_snapshot_date)
     is distinct from (old.verified_at, old.verified_snapshot_date, old.failed_at, old.failure_reason, old.unprovable_fields, old.checked_snapshot_date)
     and not v_verifier then
    raise exception 'Only the carrier file decides whether a change happened.' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status then
    if new.status in ('verified_in_file', 'failed') then
      if not v_verifier or old.status not in ('submitted', 'awaiting_carrier', 'confirmed_by_carrier') then
        raise exception 'Only the carrier file decides whether a change happened.' using errcode = 'P0001';
      end if;
    elsif not (
      (old.status = 'draft' and new.status in ('submitted', 'cancelled'))
      or (old.status = 'submitted' and new.status in ('awaiting_carrier', 'confirmed_by_carrier', 'cancelled'))
      or (old.status = 'awaiting_carrier' and new.status in ('confirmed_by_carrier', 'cancelled'))
      or (old.status = 'confirmed_by_carrier' and new.status = 'cancelled')
    ) then
      raise exception 'A servicing request cannot go from % to %.', old.status, new.status using errcode = 'P0001';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

-- conversion_attempt_guard(): conversion_attempt
CREATE OR REPLACE FUNCTION public.conversion_attempt_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A logged conversion call is never removed.' using errcode = 'P0001';
  end if;
  raise exception 'A logged conversion call never changes; log another.' using errcode = 'P0001';
end;
$function$;

-- reinstatement_case_guard(): reinstatement_case
CREATE OR REPLACE FUNCTION public.reinstatement_case_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_sync boolean := coalesce(current_setting('app.reinstatement_sync', true), '') = 'on';
  v_open text[] := array['identified', 'contacted', 'client_agreed', 'submitted'];
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A reinstatement case is never removed.' using errcode = 'P0001';
  end if;
  if (new.tenant_id, new.carrier_id, new.policy_number, new.lapsed_on, new.window_days, new.deadline, new.created_at)
     is distinct from (old.tenant_id, old.carrier_id, old.policy_number, old.lapsed_on, old.window_days, old.deadline, old.created_at) then
    raise exception 'A case''s policy, lapse date and deadline never change.' using errcode = 'P0001';
  end if;
  if new.alerted_days is distinct from old.alerted_days and not v_sync then
    raise exception 'Only the daily check records its alerts.' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status then
    if not (old.status = any (v_open)) then
      raise exception 'A % case is closed.', old.status using errcode = 'P0001';
    end if;
    if new.status in ('reinstated', 'expired') then
      if not v_sync then
        raise exception 'Only the carrier file says a policy is reinstated, and only the calendar says a window closed.' using errcode = 'P0001';
      end if;
    elsif new.status in ('declined_by_client', 'declined_by_carrier') then
      null;
    elsif array_position(v_open, new.status) is null or array_position(v_open, new.status) < array_position(v_open, old.status) then
      raise exception 'A reinstatement case cannot go from % to %.', old.status, new.status using errcode = 'P0001';
    end if;
  elsif not (old.status = any (v_open)) and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') and not v_sync then
    raise exception 'A % case is closed.', old.status using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

-- winback_candidate_guard(): winback_candidate
CREATE OR REPLACE FUNCTION public.winback_candidate_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_sync boolean := coalesce(current_setting('app.winback_sync', true), '') = 'on';
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    -- LA-6.6: a retention run past the candidate's retention period may remove it.
    if coalesce(current_setting('app.retention_purge', true), '') = 'on' then
      return old;
    end if;
    raise exception 'A win-back candidate is never removed.' using errcode = 'P0001';
  end if;
  if (new.tenant_id, new.carrier_id, new.source_policy_number, new.lapsed_on, new.created_at)
     is distinct from (old.tenant_id, old.carrier_id, old.source_policy_number, old.lapsed_on, old.created_at) then
    raise exception 'A candidate''s policy and lapse never change.' using errcode = 'P0001';
  end if;
  if old.winback_band = 'never' and new.winback_band <> 'never' then
    raise exception 'A client who must not be called stays that way.' using errcode = 'P0001';
  end if;
  if new.released_to_nurture_at is not null and old.released_to_nurture_at is null then
    if new.winback_band = 'never' then
      raise exception 'A never-call candidate cannot be released.' using errcode = 'P0001';
    end if;
    if new.eligible_from is null or new.eligible_from > current_date then
      raise exception 'Not before the cooling-off ends (%).', new.eligible_from using errcode = 'P0001';
    end if;
  end if;
  if old.released_to_nurture_at is not null and (to_jsonb(new) - 'updated_at' - 'released_lead_id' - 'campaign_id') is distinct from (to_jsonb(old) - 'updated_at' - 'released_lead_id' - 'campaign_id') then
    raise exception 'A released candidate is history.' using errcode = 'P0001';
  end if;
  if (new.lapse_reason_category, new.reason_source, new.reason_inferred, new.winback_band, new.eligible_from)
     is distinct from (old.lapse_reason_category, old.reason_source, old.reason_inferred, old.winback_band, old.eligible_from)
     and not v_sync then
    raise exception 'Only the win-back check classifies a candidate.' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

-- compliance_index_sync(): complaint, screening_audit, tenant_call_attempts, tenant_campaign_scrub_rejections, tenant_consent_artefacts, tenant_dial_dnc_checks, tenant_do_not_call, tenant_suppression_list, transfer_verdict
CREATE OR REPLACE FUNCTION public.compliance_index_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    delete from public.compliance_index
     where tenant_id = old.tenant_id and source_table = tg_table_name and source_id = old.id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.compliance_index
    select * from public.compliance_index_source s
     where s.tenant_id = new.tenant_id and s.source_table = tg_table_name and s.source_id = new.id
    on conflict do nothing;
  end if;
  return null;
end $function$;

-- compliance_index_sync_disclosure(): tenant_application_disclosures
CREATE OR REPLACE FUNCTION public.compliance_index_sync_disclosure()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    delete from public.compliance_index
     where tenant_id = old.tenant_id and source_table = 'tenant_application_disclosures'
       and source_id = old.application_id and source_sub_id = old.disclosure_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.compliance_index
    select * from public.compliance_index_source s
     where s.tenant_id = new.tenant_id and s.source_table = 'tenant_application_disclosures'
       and s.source_id = new.application_id and s.source_sub_id = new.disclosure_id
    on conflict do nothing;
  end if;
  return null;
end $function$;

-- cost_entry_guard(): cost_entry
CREATE OR REPLACE FUNCTION public.cost_entry_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A cost entry is never removed; write a reversing entry instead.' using errcode = 'P0001';
  end if;
  -- The one permitted change: recording when the money left. Once, and nothing else.
  if old.paid_on is null and new.paid_on is not null
     and (to_jsonb(new) - 'paid_on') = (to_jsonb(old) - 'paid_on') then
    return new;
  end if;
  raise exception 'A cost entry is never changed; write a reversing entry instead.' using errcode = 'P0001';
end;
$function$;

-- vendor_invoice_guard(): vendor_invoice
CREATE OR REPLACE FUNCTION public.vendor_invoice_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_writer boolean := coalesce(current_setting('app.vendor_invoice_writer', true), '') = 'on';
  v_ok boolean;
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'An invoice is never removed; void it instead.' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status then
    v_ok := (old.status, new.status) in (('draft', 'received'), ('received', 'disputed'), ('disputed', 'received'), ('received', 'draft'))
         or (v_writer and (old.status, new.status) in (('draft', 'approved'), ('received', 'approved'), ('disputed', 'approved'), ('approved', 'paid'),
                                                         ('draft', 'void'), ('received', 'void'), ('disputed', 'void'), ('approved', 'void'), ('paid', 'void')));
    if not v_ok then
      raise exception 'An invoice cannot go from % to %.', old.status, new.status using errcode = 'P0001';
    end if;
  end if;
  if old.status in ('approved', 'paid', 'void') and (
       new.vendor_id is distinct from old.vendor_id or new.partner_id is distinct from old.partner_id
    or new.invoice_number is distinct from old.invoice_number or new.invoice_date is distinct from old.invoice_date
    or new.period_start is distinct from old.period_start or new.period_end is distinct from old.period_end
    or new.subtotal_cents is distinct from old.subtotal_cents or new.tax_cents is distinct from old.tax_cents
    or new.total_cents is distinct from old.total_cents or new.comparison_json is distinct from old.comparison_json
    or new.difference_cents is distinct from old.difference_cents or new.flagged is distinct from old.flagged
    or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at
    or new.tenant_id is distinct from old.tenant_id) then
    raise exception 'An approved invoice is history: void it and enter it again.' using errcode = 'P0001';
  end if;
  if old.status = 'void' and new.status = 'void' and (new.voided_at is distinct from old.voided_at or new.void_reason is distinct from old.void_reason) then
    raise exception 'A voided invoice stays as it was voided.' using errcode = 'P0001';
  end if;
  if (new.paid_on is distinct from old.paid_on or new.paid_method is distinct from old.paid_method or new.payment_reference is distinct from old.payment_reference)
     and not (v_writer and old.status = 'approved' and new.status = 'paid') then
    raise exception 'Payment is recorded by marking the invoice paid.' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

-- vendor_invoice_line_guard(): vendor_invoice_line
CREATE OR REPLACE FUNCTION public.vendor_invoice_line_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_status text;
  v_tenant uuid;
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  select i.status, i.tenant_id into v_status, v_tenant from public.vendor_invoice i where i.id = coalesce(new.invoice_id, old.invoice_id);
  if v_status is null or v_status not in ('draft', 'received', 'disputed') then
    raise exception 'The lines of an approved or voided invoice are history.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id then
    raise exception 'A line stays on its invoice.' using errcode = 'P0001';
  end if;
  if tg_op <> 'DELETE' then
    if new.tenant_id is distinct from v_tenant then
      raise exception 'A line belongs to its invoice''s agency.' using errcode = 'P0001';
    end if;
    if new.campaign_id is not null and not exists (select 1 from public.tenant_campaigns c where c.id = new.campaign_id and c.tenant_id = v_tenant) then
      raise exception 'Campaign % is not in this agency.', new.campaign_id using errcode = 'P0001';
    end if;
    return new;
  end if;
  return old;
end;
$function$;

-- expense_guard(): expense
CREATE OR REPLACE FUNCTION public.expense_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_writer boolean := coalesce(current_setting('app.expense_writer', true), '') = 'on';
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'An expense is never removed: void it, or end a recurring one.' using errcode = 'P0001';
  end if;
  if new.tenant_id is distinct from old.tenant_id or new.parent_expense_id is distinct from old.parent_expense_id then
    raise exception 'An expense stays with its agency and its template.' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'unconfirmed' and new.status = 'void')
         or (v_writer and (old.status, new.status) in (('unconfirmed', 'confirmed'), ('confirmed', 'void')))) then
      raise exception 'An expense cannot go from % to %.', old.status, new.status using errcode = 'P0001';
    end if;
  end if;
  -- Booked or voided: the money, the date and what it was are history. Its classification
  -- (acquisition or overhead, tax bucket) and its receipt may still be set.
  if old.status in ('confirmed', 'void') and (
       new.category is distinct from old.category or new.vendor_name is distinct from old.vendor_name
    or new.description is distinct from old.description or new.amount_cents is distinct from old.amount_cents
    or new.incurred_on is distinct from old.incurred_on or new.recurrence is distinct from old.recurrence
    or new.confirmed_at is distinct from old.confirmed_at or new.confirmed_by is distinct from old.confirmed_by) then
    raise exception 'A confirmed expense is history: void it and enter it again.' using errcode = 'P0001';
  end if;
  if old.status = 'void' and new.status = 'void' and (new.voided_at is distinct from old.voided_at or new.void_reason is distinct from old.void_reason) then
    raise exception 'A voided expense stays as it was voided.' using errcode = 'P0001';
  end if;
  if (new.paid_on is distinct from old.paid_on or new.paid_method is distinct from old.paid_method or new.payment_reference is distinct from old.payment_reference)
     and not v_writer then
    raise exception 'Payment is recorded by marking the expense paid.' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

-- payout_run_guard(): payout_run
CREATE OR REPLACE FUNCTION public.payout_run_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_writer boolean := coalesce(current_setting('app.payout_writer', true), '') = 'on';
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A payout run is never removed; void it instead.' using errcode = 'P0001';
  end if;
  if not v_writer then
    raise exception 'A payout run changes only through its own actions (build, dispute, publish, paid, void).' using errcode = 'P0001';
  end if;
  if old.status <> 'draft' and (new.gross_cents, new.deductions_cents, new.disputed_cents, new.net_cents, new.terms_snapshot_json, new.period_start, new.period_end, new.partner_id)
       is distinct from (old.gross_cents, old.deductions_cents, old.disputed_cents, old.net_cents, old.terms_snapshot_json, old.period_start, old.period_end, old.partner_id) then
    raise exception 'A published run is history: void it and build it again.' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

-- payout_run_item_guard(): payout_run_item
CREATE OR REPLACE FUNCTION public.payout_run_item_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if coalesce(current_setting('app.payout_writer', true), '') <> 'on' then
    raise exception 'Payout items are written by the run, never by hand.' using errcode = 'P0001';
  end if;
  if (select r.status from public.payout_run r where r.id = coalesce(new.run_id, old.run_id)) <> 'draft' then
    raise exception 'The items of a published run are history.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$function$;

-- payout_dispute_guard(): payout_dispute
CREATE OR REPLACE FUNCTION public.payout_dispute_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A dispute never silently disappears: resolve it accepted or upheld.' using errcode = 'P0001';
  end if;
  if coalesce(current_setting('app.payout_writer', true), '') <> 'on' then
    raise exception 'Disputes are raised and resolved through their own actions.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and old.status <> 'open' and (new.status, new.resolution_note, new.resolved_by, new.resolved_at) is distinct from (old.status, old.resolution_note, old.resolved_by, old.resolved_at)
     and not (old.status = 'accepted' and old.carried_to_run_id is null and new.status = 'void') then
    raise exception 'A resolved dispute stays resolved.' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

-- producer_immutable_guard(): producer_ledger_entry, producer_split
CREATE OR REPLACE FUNCTION public.producer_immutable_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  raise exception '% is never changed or removed: a split changes with a new effective date; a correction is an adjustment.', tg_table_name using errcode = 'P0001';
end;
$function$;

-- producer_run_guard(): producer_payout_run
CREATE OR REPLACE FUNCTION public.producer_run_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A producer payout run is never removed; void it instead.' using errcode = 'P0001';
  end if;
  if coalesce(current_setting('app.producer_writer', true), '') <> 'on' then
    raise exception 'A producer payout run changes only through its own actions.' using errcode = 'P0001';
  end if;
  if old.status <> 'draft' and (new.balance_before_cents, new.earned_cents, new.clawed_back_cents, new.withheld_cents, new.net_cents, new.period_start, new.period_end)
       is distinct from (old.balance_before_cents, old.earned_cents, old.clawed_back_cents, old.withheld_cents, old.net_cents, old.period_start, old.period_end) then
    raise exception 'A published run is history: void it and build it again.' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

-- bank_transaction_guard(): bank_transaction
CREATE OR REPLACE FUNCTION public.bank_transaction_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A bank line is never removed; mark it ignored with a reason.' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - 'match_status' - 'ignored_reason') <> (to_jsonb(old) - 'match_status' - 'ignored_reason') then
    raise exception 'A bank line is kept as the bank wrote it.' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

-- deposit_match_guard(): deposit_match
CREATE OR REPLACE FUNCTION public.deposit_match_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_txn bigint;
  v_stmt bigint;
  v_txn_applied bigint;
  v_stmt_applied bigint;
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    if old.confirmed_by is not null and coalesce(current_setting('app.deposit_writer', true), '') <> 'on' then
      raise exception 'A confirmed match is removed only through its own action.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.confirmed_by is not null then
    raise exception 'A confirmed match is not edited; remove it and match again.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and (new.bank_transaction_id, new.carrier_account_statement_id, new.amount_applied_cents, new.tenant_id)
       is distinct from (old.bank_transaction_id, old.carrier_account_statement_id, old.amount_applied_cents, old.tenant_id) then
    raise exception 'A suggestion is confirmed or removed, not edited.' using errcode = 'P0001';
  end if;
  if new.confirmed_by is not null then
    select t.amount_cents into v_txn from public.bank_transaction t where t.id = new.bank_transaction_id and t.tenant_id = new.tenant_id;
    select s.amount_paid_cents into v_stmt from public.carrier_account_statement s where s.id = new.carrier_account_statement_id and s.tenant_id = new.tenant_id;
    if v_txn is null or v_stmt is null then
      raise exception 'Both the deposit and the statement must be in this agency.' using errcode = 'P0001';
    end if;
    select coalesce(sum(amount_applied_cents), 0) into v_txn_applied from public.deposit_match where bank_transaction_id = new.bank_transaction_id and confirmed_by is not null and id <> new.id;
    select coalesce(sum(amount_applied_cents), 0) into v_stmt_applied from public.deposit_match where carrier_account_statement_id = new.carrier_account_statement_id and confirmed_by is not null and id <> new.id;
    if v_txn_applied + new.amount_applied_cents > v_txn then
      raise exception 'That applies more than the deposit holds.' using errcode = 'P0001';
    end if;
    if v_stmt_applied + new.amount_applied_cents > v_stmt then
      raise exception 'That applies more than the statement says was paid.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$function$;

-- user_security_event_guard(): user_security_event
CREATE OR REPLACE FUNCTION public.user_security_event_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  raise exception 'user_security_event is append-only' using errcode = '42501';
end;
$function$;

-- settings_audit_is_append_only(): settings_audit
CREATE OR REPLACE FUNCTION public.settings_audit_is_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  raise exception 'The settings audit log is read-only: rows are never changed or removed.' using errcode = 'P0001';
end;
$function$;

create or replace function public.purge_tenant_workspace(p_tenant_id uuid, p_actor uuid, p_reason text, p_confirm_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_name text;
  v_keep text[] := array['subscriptions', 'invoices', 'platform_invoices', 'credit_notes', 'payments', 'pending_charges', 'credit_grants', 'billing_waivers', 'tenant_comps', 'tenant_credits', 'usage_events', 'usage_totals', 'checkout_sessions', 'signup_selections', 'webhook_events', 'payment_providers', 'tenant_entitlements', 'tenant_purge_run'];
  v_all text[];
  v_todo text[];
  v_left text[];
  t text;
  n bigint;
  v_pass integer := 0;
  v_progress boolean;
  v_counts jsonb := '{}'::jsonb;
  v_users uuid[];
  v_anon integer := 0;
  v_anon_ids uuid[] := '{}';
  v_run uuid;
  v_result jsonb;
begin
  select name into v_name from public.tenants where id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'TENANT_NOT_FOUND'; end if;
  if p_confirm_name is distinct from v_name then raise exception using errcode = '22023', message = 'CONFIRMATION_MISMATCH'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception using errcode = '22023', message = 'REASON_REQUIRED'; end if;
  if exists (select 1 from public.subscriptions s where s.tenant_id = p_tenant_id and s.status is distinct from 'cancelled') then
    raise exception using errcode = 'P0001', message = 'SUBSCRIPTION_NOT_CANCELLED';
  end if;
  if exists (select 1 from public.legal_hold h where h.tenant_id = p_tenant_id and h.released_at is null) then
    raise exception using errcode = 'P0001', message = 'LEGAL_HOLD_ACTIVE';
  end if;

  insert into public.tenant_purge_run (tenant_id, requested_by, reason, backend_pid)
  values (p_tenant_id, p_actor, btrim(p_reason), pg_backend_pid()) returning id into v_run;

  select coalesce(array_agg(distinct u), '{}') into v_users from (
    select tu.user_id u from public.tenant_users tu where tu.tenant_id = p_tenant_id
    union select pu.user_id from public.partner_users pu where pu.tenant_id = p_tenant_id) x;

  select coalesce(array_agg(c.relname::text order by c.relname::text), '{}') into v_all
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
   where ns.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
     and c.relname <> 'tenants' and c.relname::text <> all (v_keep);

  -- Delete, retrying what a foreign key still holds, until nothing moves.
  v_todo := v_all;
  loop
    v_pass := v_pass + 1;
    v_progress := false;
    v_left := '{}';
    foreach t in array v_todo loop
      begin
        execute format('delete from public.%I where tenant_id = $1', t) using p_tenant_id;
        get diagnostics n = row_count;
        if n > 0 then
          v_progress := true;
          v_counts := v_counts || jsonb_build_object(t, coalesce((v_counts->>t)::bigint, 0) + n);
        end if;
      exception when foreign_key_violation or restrict_violation then
        v_left := v_left || t;
      end;
    end loop;
    exit when cardinality(v_left) = 0 or v_pass >= 20 or (not v_progress and v_pass > 1);
    v_todo := v_left;
  end loop;

  -- Nothing of the agency may be left outside the kept records.
  foreach t in array v_all loop
    execute format('select count(*) from public.%I where tenant_id = $1', t) into n using p_tenant_id;
    if n > 0 then
      raise exception using errcode = 'P0001', message = format('PURGE_INCOMPLETE: %s row(s) left in %s', n, t);
    end if;
  end loop;

  -- People who only worked here: their accounts stay as rows (billing and audit point at them), emptied.
  with gone as (
    update public.users u
       set name = 'Deleted user', full_name = 'Deleted user', display_name = 'Deleted user',
           email = 'deleted-' || u.id::text || '@deleted.invalid', phone = null, avatar_url = null, avatar_path = null,
           password_hash = null, licensed_name = null, calendly_url = null, calendly_tech_url = null,
           recruiter_reply_email = null, recruiter_from_email = null, recruiter_smtp_password = null,
           status = 'deleted', active = false, deleted_at = now(), session_version = coalesce(u.session_version, 0) + 1
     where u.id = any (v_users)
       and not exists (select 1 from public.tenant_users tu where tu.user_id = u.id)
       and not exists (select 1 from public.partner_users pu where pu.user_id = u.id)
    returning u.id)
  select count(*), coalesce(array_agg(id), '{}') into v_anon, v_anon_ids from gone;

  v_result := jsonb_build_object('purgeId', v_run, 'deleted', v_counts, 'passes', v_pass, 'accountsAnonymised', v_anon, 'anonymisedUserIds', to_jsonb(v_anon_ids), 'kept', to_jsonb(v_keep));
  update public.tenant_purge_run set status = 'done', finished_at = now(), results = v_result where id = v_run;
  return v_result;
end;
$$;
revoke all on function public.purge_tenant_workspace(uuid, uuid, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.purge_tenant_workspace(uuid, uuid, text, text) to service_role;

create or replace function public.cancelled_workspaces_due()
returns table (tenant_id uuid, name text, cancelled_at timestamptz, readable_until timestamptz)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select t.id, t.name, s.cancelled_at, s.cancelled_at + make_interval(days => public.cancelled_retention_days())
    from public.tenants t
    join lateral (select max(x.cancelled_at) cancelled_at from public.subscriptions x where x.tenant_id = t.id) s on true
   where s.cancelled_at is not null
     and not exists (select 1 from public.subscriptions x where x.tenant_id = t.id and x.status is distinct from 'cancelled')
     and s.cancelled_at + make_interval(days => public.cancelled_retention_days()) < now()
     and not exists (select 1 from public.tenant_purge_run r where r.tenant_id = t.id and r.status = 'done')
   order by s.cancelled_at
$$;
revoke all on function public.cancelled_workspaces_due() from public, anon, authenticated, tenant_app;
grant execute on function public.cancelled_workspaces_due() to service_role;

-- Delete-time triggers that a migration applied before this one added (this file was written from
-- the live catalog of 2026-10-16): the same line, added to their live definition now, so a purge
-- never stops at a newer guard. Each one is named in a notice.
do $$
declare
  r record;
  v_def text;
  v_pos integer;
  v_line constant text := E'  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).\n  if tg_op = ''DELETE'' and tg_level = ''ROW'' then\n    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;\n  end if;\n';
begin
  for r in
    select distinct p.oid, p.oid::regprocedure::text as sig
      from pg_trigger tg join pg_class cl on cl.oid = tg.tgrelid join pg_namespace n on n.oid = cl.relnamespace
      join pg_proc p on p.oid = tg.tgfoid join pg_language l on l.oid = p.prolang
     where n.nspname = 'public' and not tg.tgisinternal and (tg.tgtype & 8) = 8 and (tg.tgtype & 1) = 1 and not cl.relispartition
       and l.lanname = 'plpgsql'
       and p.prosrc not like '%public.tenant_purge_active(to_jsonb(old))%'
       and p.oid::regprocedure::text not in ('private.refresh_invoice_total()', 'private.guard_platform_generated_invoice_immutability()', 'private.guard_platform_generated_invoice_line_immutability()', 'private.guard_platform_refund_approval()', 'private.guard_platform_credit_note_immutability()', 'prevent_platform_audit_mutation()', 'prevent_credit_note_mutation()', 'prevent_issued_invoice_mutation()', 'prevent_issued_invoice_line_mutation()', 'admin_users_serialize_super_admin_changes()', 'admin_users_keep_an_active_super_admin()', 'stamp_calling_window_rules_feed()')
  loop
    v_def := replace(pg_get_functiondef(r.oid), E'\r\n', E'\n');
    v_pos := regexp_instr(v_def, E'\n[ \t]*begin[ \t]*\n', 1, 1, 1, 'i');
    if v_pos = 0 then raise exception 'cannot add the purge line to %', r.sig; end if;
    execute substr(v_def, 1, v_pos - 1) || v_line || substr(v_def, v_pos);
    raise notice 'purge line added to % (a guard newer than this file)', r.sig;
  end loop;
end $$;
do $$
declare v_missing text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_missing
    from pg_trigger tg join pg_class cl on cl.oid = tg.tgrelid join pg_namespace n on n.oid = cl.relnamespace
    join pg_proc p on p.oid = tg.tgfoid
   where n.nspname = 'public' and not tg.tgisinternal and (tg.tgtype & 8) = 8 and not cl.relispartition
     and p.prosrc not like '%public.tenant_purge_active(to_jsonb(old))%'
     and p.oid::regprocedure::text not in ('private.refresh_invoice_total()', 'private.guard_platform_generated_invoice_immutability()', 'private.guard_platform_generated_invoice_line_immutability()', 'private.guard_platform_refund_approval()', 'private.guard_platform_credit_note_immutability()', 'prevent_platform_audit_mutation()', 'prevent_credit_note_mutation()', 'prevent_issued_invoice_mutation()', 'prevent_issued_invoice_line_mutation()', 'admin_users_serialize_super_admin_changes()', 'admin_users_keep_an_active_super_admin()', 'stamp_calling_window_rules_feed()');
  if v_missing is not null then raise exception 'delete-time triggers without the purge line: %', v_missing; end if;
  if to_regprocedure('public.purge_tenant_workspace(uuid,uuid,text,text)') is null then raise exception 'purge_tenant_workspace is missing'; end if;
  if has_function_privilege('tenant_app', 'public.purge_tenant_workspace(uuid,uuid,text,text)', 'execute') then
    raise exception 'tenant_app can run a workspace purge';
  end if;
end $$;

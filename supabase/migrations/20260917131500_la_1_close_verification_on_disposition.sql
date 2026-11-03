-- LA-1: close the server-backed verification session when the call ends.
-- This is a follow-up to the chat-resilience disposition function so already-applied
-- environments receive the same session lifecycle fix as clean installs.

create or replace function public.complete_disposition(
  p_tenant_id uuid, p_work_item_id uuid, p_user_id uuid, p_walk_id uuid, p_disposition_key text, p_callback_subtype text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_item public.lead_queue;
  v_walk public.disposition_walks;
  v_disposition public.dispositions;
  v_stage_id uuid;
  v_note text;
  v_phone text;
  v_customer text;
  v_partner_id uuid;
  v_status text;
  v_dnc_added boolean := false;
  v_partner_card_error text;
begin
  select q.* into v_item
    from public.lead_queue q
   where q.id = p_work_item_id
     and q.tenant_id = p_tenant_id
     and q.owner_user_id = p_user_id
     and q.status in ('claimed', 'completed', 'dropped')
   for update;
  if not found then raise exception 'DISPOSITION_OWNER_REQUIRED'; end if;

  select w.* into v_walk
    from public.disposition_walks w
   where w.id = p_walk_id
     and w.tenant_id = p_tenant_id
     and w.work_item_id = p_work_item_id
   for update;
  if not found then raise exception 'DISPOSITION_WALK_NOT_FOUND'; end if;
  if v_walk.current_node_id is not null then raise exception 'DISPOSITION_WALK_INCOMPLETE'; end if;

  select d.* into v_disposition
    from public.dispositions d
   where d.tenant_id = p_tenant_id
     and d.disposition_key = p_disposition_key
     and d.is_active;
  if not found then raise exception 'DISPOSITION_NOT_FOUND'; end if;

  if v_walk.status = 'completed' and v_walk.final_disposition_key = v_disposition.disposition_key then
    return jsonb_build_object(
      'work_item_id', v_item.id,
      'lead_id', v_item.lead_id,
      'status', v_item.status,
      'disposition_key', v_disposition.disposition_key,
      'label', v_disposition.label,
      'stage_id', v_item.stage_id,
      'note', v_walk.composed_note,
      'dnc_added', exists (
        select 1 from public.tenant_do_not_call d
         where d.tenant_id = p_tenant_id and d.lead_id = v_item.lead_id and d.is_active
      ),
      'already_completed', true
    );
  end if;

  if p_callback_subtype is not null and char_length(btrim(p_callback_subtype)) > 120 then
    raise exception 'CALLBACK_SUBTYPE_INVALID';
  end if;

  select string_agg(nullif(btrim(s.note_fragment), ''), ' ' order by s.sequence)
    into v_note
    from public.disposition_walk_steps s
   where s.walk_id = v_walk.id;
  select l.values->>'phone',
         coalesce(
           nullif(btrim(l.values->>'full_name'), ''),
           nullif(btrim(concat_ws(' ', l.values->>'first_name', l.values->>'last_name')), ''),
           'Customer'
         )
    into v_phone, v_customer
    from public.agent_leads l
   where l.id = v_item.lead_id and l.tenant_id = p_tenant_id
   for update;

  select sd.stage_id into v_stage_id
    from public.stage_dispositions sd
    join public.tenant_pipeline_stages ps on ps.id = sd.stage_id
   where sd.tenant_id = p_tenant_id
     and sd.disposition_key = p_disposition_key
     and ps.pipeline_id = v_item.pipeline_id
     and not ps.is_archived
   limit 1;
  v_stage_id := coalesce(v_stage_id, v_item.stage_id);
  v_status := v_disposition.closes_as;

  update public.agent_leads
     set stage_id = v_stage_id,
         callback_subtype = case
           when p_disposition_key = 'callback_scheduled' then nullif(btrim(p_callback_subtype), '')
           else null
         end,
         updated_at = now()
   where id = v_item.lead_id and tenant_id = p_tenant_id;
  update public.lead_queue
     set status = v_status,
         disposition = v_disposition.disposition_key,
         disposition_at = now(),
         disposition_by = p_user_id,
         stage_id = v_stage_id,
         updated_at = now()
   where id = v_item.id and tenant_id = p_tenant_id;
  update public.active_calls
     set ended_at = coalesce(ended_at, now()), updated_at = now()
   where work_item_id = v_item.id and tenant_id = p_tenant_id and ended_at is null;
  update public.tenant_verification_sessions
     set status = 'closed',
         ended_at = coalesce(ended_at, now()),
         completed_at = coalesce(completed_at, now()),
         updated_at = now(),
         last_actor_id = p_user_id
   where work_item_id = v_item.id
     and tenant_id = p_tenant_id
     and ended_at is null;
  update public.deal_flow
     set status = case when v_status = 'dropped' then 'dropped' else 'completed' end,
         call_result = v_disposition.disposition_key,
         notes = nullif(v_note, ''),
         disposition_at = now(),
         disposition_by = p_user_id,
         pipeline_id = v_item.pipeline_id,
         stage_id = v_stage_id,
         updated_at = now()
   where lead_id = v_item.lead_id and tenant_id = p_tenant_id;
  select partner_id into v_partner_id
    from public.lead_queue
   where id = v_item.id and tenant_id = p_tenant_id;

  if v_partner_id is not null then
    begin
      insert into public.partner_messages (tenant_id, partner_id, work_item_id, message, created_by)
      values (p_tenant_id, v_partner_id, v_item.id, v_customer || ': ' || v_disposition.label, p_user_id);
    exception when others then
      v_partner_card_error := sqlerrm;
    end;
  end if;

  if p_disposition_key = 'do_not_call' then
    v_phone := right(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), 10);
    if v_phone !~ '^[0-9]{10}$' then raise exception 'DO_NOT_CALL_PHONE_REQUIRED'; end if;
    insert into public.tenant_do_not_call (tenant_id, phone_digits, lead_id, added_by)
    values (p_tenant_id, v_phone, v_item.lead_id, p_user_id)
    on conflict (tenant_id, phone_digits) where is_active
    do update set lead_id = excluded.lead_id, added_by = excluded.added_by, updated_at = now();
    v_dnc_added := true;
  end if;

  update public.disposition_walks
     set status = 'completed',
         completed_at = now(),
         final_disposition_key = v_disposition.disposition_key,
         composed_note = nullif(v_note, ''),
         current_node_id = null,
         user_id = p_user_id,
         updated_at = now()
   where id = v_walk.id;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values (
    'tenant', p_user_id, 'tenant.dispositioned', 'lead_queue', v_item.id::text,
    jsonb_build_object(
      'leadId', v_item.lead_id,
      'dispositionKey', v_disposition.disposition_key,
      'status', v_status,
      'stageId', v_stage_id,
      'dncAdded', v_dnc_added,
      'partnerCardPosted', v_partner_card_error is null
    )
  );

  if v_partner_card_error is not null then
    begin
      insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
      values (
        'tenant', p_user_id, 'tenant.disposition_partner_card_failed', 'lead_queue', v_item.id::text,
        jsonb_build_object('leadId', v_item.lead_id, 'partnerId', v_partner_id, 'error', v_partner_card_error)
      );
    exception when others then
      null;
    end;
  end if;

  return jsonb_build_object(
    'work_item_id', v_item.id,
    'lead_id', v_item.lead_id,
    'status', v_status,
    'disposition_key', v_disposition.disposition_key,
    'label', v_disposition.label,
    'stage_id', v_stage_id,
    'note', v_note,
    'dnc_added', v_dnc_added,
    'already_completed', false,
    'partner_card_posted', v_partner_card_error is null
  );
end;
$$;

revoke all on function public.complete_disposition(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.complete_disposition(uuid, uuid, uuid, uuid, text, text) to service_role;

-- LA-3.18 — a carrier requirement books a callback that links back to it.
--
-- tenant_callbacks has exactly one creator today, complete_disposition_with_callback(), and it only
-- works as the outcome of a claimed dial (it completes the disposition too). A requirement chase is
-- not a dial outcome, so this is the second creator: the same validation (timezone, future time,
-- active assignee, note length), the same history row and the same audit action, and it writes the
-- new callback's id onto the requirement (callback_id, set-null FK from 20260926101100).
--
--   la3_requirement_callback(tenant, requirement, actor, local time, customer timezone, note)
--       -> (callback_id, scheduled_at_utc)
--
-- The callback sits on the case's work item (tenant_application_cases.work_item_id), or the lead's
-- newest one when the case has none. tenant_callbacks_replace_open_one (20260925708500) already
-- cancels any other open callback on the lead with a 'replaced' history row, so booking here never
-- trips tenant_callbacks_active_work_item_idx.
--
-- Down:
--   drop function public.la3_requirement_callback(uuid, uuid, uuid, timestamp without time zone, text, text);

create or replace function public.la3_requirement_callback(
  p_tenant_id uuid,
  p_requirement_id uuid,
  p_actor uuid,
  p_callback_local timestamp without time zone,
  p_customer_timezone text,
  p_note text default null
)
returns table(callback_id uuid, scheduled_at_utc timestamptz)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
#variable_conflict use_column
declare
  r record;
  v_case record;
  v_work_item uuid;
  v_scheduled_at timestamptz;
  v_callback public.tenant_callbacks;
  v_note text;
begin
  select q.id, q.application_id, q.status, q.kind, a.case_id, a.lead_id
    into r
    from tenant_application_requirements q
    join tenant_applications a on a.id = q.application_id and a.tenant_id = q.tenant_id
   where q.id = p_requirement_id and q.tenant_id = p_tenant_id
   for update of q;
  if not found then raise exception 'REQUIREMENT_NOT_FOUND'; end if;
  if r.status not in ('open', 'in_progress') then raise exception 'REQUIREMENT_CLOSED'; end if;

  if p_callback_local is null then raise exception 'CALLBACK_DATE_REQUIRED'; end if;
  if not exists (select 1 from pg_timezone_names where name = btrim(coalesce(p_customer_timezone, ''))) then
    raise exception 'CALLBACK_TIMEZONE_INVALID';
  end if;
  v_scheduled_at := p_callback_local at time zone btrim(p_customer_timezone);
  if v_scheduled_at <= now() then raise exception 'CALLBACK_DATE_PAST'; end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 1000 then raise exception 'CALLBACK_NOTE_INVALID'; end if;
  if not exists (
    select 1 from tenant_users tu join users u on u.id = tu.user_id
     where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and tu.accepted_at is not null and u.status = 'active'
  ) then raise exception 'CALLBACK_ASSIGNEE_INVALID'; end if;

  select c.work_item_id into v_case from tenant_application_cases c where c.id = r.case_id and c.tenant_id = p_tenant_id;
  v_work_item := v_case.work_item_id;
  if v_work_item is null then
    select lq.id into v_work_item from lead_queue lq
     where lq.tenant_id = p_tenant_id and lq.lead_id = r.lead_id
     order by lq.created_at desc limit 1;
  end if;
  if v_work_item is null then raise exception 'REQUIREMENT_CALLBACK_NO_WORK_ITEM'; end if;

  insert into tenant_callbacks (tenant_id, lead_id, work_item_id, scheduled_at_utc, customer_timezone, assigned_to, note, status, created_by)
  values (p_tenant_id, r.lead_id, v_work_item, v_scheduled_at, btrim(p_customer_timezone), p_actor, v_note, 'scheduled', p_actor)
  returning * into v_callback;

  insert into callback_history (tenant_id, callback_id, lead_id, actor_user_id, action, new_scheduled_at_utc, new_status, note)
  values (p_tenant_id, v_callback.id, r.lead_id, p_actor, 'scheduled', v_callback.scheduled_at_utc, v_callback.status, v_callback.note);

  update tenant_application_requirements q
     set callback_id = v_callback.id, last_chased_at = now(), chase_count = q.chase_count + 1
   where q.id = r.id;

  insert into audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, 'tenant.callback_scheduled', 'callback', v_callback.id::text,
          jsonb_build_object('leadId', r.lead_id, 'workItemId', v_work_item, 'scheduledAtUtc', v_callback.scheduled_at_utc,
                             'customerTimezone', v_callback.customer_timezone, 'requirementId', r.id, 'applicationId', r.application_id));

  return query select v_callback.id, v_callback.scheduled_at_utc;
end;
$function$;

revoke all on function public.la3_requirement_callback(uuid, uuid, uuid, timestamp without time zone, text, text) from public, anon, authenticated;
grant execute on function public.la3_requirement_callback(uuid, uuid, uuid, timestamp without time zone, text, text) to service_role;

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'la3_requirement_callback' and prosecdef) then
    raise exception '20260926102200: la3_requirement_callback is missing or not security definer';
  end if;
  if has_function_privilege('tenant_app', 'public.la3_requirement_callback(uuid, uuid, uuid, timestamp without time zone, text, text)', 'execute') then
    raise exception '20260926102200: la3_requirement_callback is callable by tenant_app';
  end if;
end $$;

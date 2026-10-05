-- LA-3.26 — counteroffers: the effective dates the delta view compares, and the expiry sweep.
--
--   tenant_application_counteroffers  +2 columns  applied_effective_on, offered_effective_on — the
--                                                 policy date the client applied for and the one the
--                                                 carrier offered, read off the carrier's notice
--   la3_expire_counteroffers()        NEW         every pending_client offer past expires_at →
--                                                 counteroffer 'expired', its waiting-on-client
--                                                 requirement 'expired', and the attempt closed as
--                                                 offer_expired through application_transition()
--
-- The function is callable by service_role only and is not scheduled here (no pg_cron job): the
-- app or a later step runs it. It never deletes a counteroffer (DELETE is revoked on the table).
--
-- Down:
--   drop function public.la3_expire_counteroffers();
--   alter table public.tenant_application_counteroffers drop column applied_effective_on, drop column offered_effective_on;

alter table public.tenant_application_counteroffers
  add column if not exists applied_effective_on date,
  add column if not exists offered_effective_on date;

create or replace function public.la3_expire_counteroffers()
returns table(counteroffer_id uuid, application_id uuid)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
#variable_conflict use_column
declare
  o record;
begin
  for o in
    select c.id, c.tenant_id, c.application_id, c.requirement_id
      from tenant_application_counteroffers c
      join tenant_applications a on a.id = c.application_id and a.tenant_id = c.tenant_id
     where c.status = 'pending_client'
       and c.expires_at is not null
       and c.expires_at < now()
       and a.status = 'counteroffer_pending'
     order by c.expires_at
     for update of c skip locked
  loop
    update tenant_application_counteroffers set status = 'expired' where id = o.id;
    if o.requirement_id is not null then
      update tenant_application_requirements set status = 'expired' where id = o.requirement_id and status in ('open', 'in_progress');
    end if;
    -- The system closes it: no actor, the outcome says why (STATUS-MODEL §3, offer_expired).
    perform public.application_transition(o.tenant_id, o.application_id, null, 'closed', 'offer_expired', null, null);
    insert into audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
    values ('system', null, 'tenant.application_transitioned', 'tenant_application', o.application_id::text,
            jsonb_build_object('tenantId', o.tenant_id, 'to', 'closed', 'outcome', 'offer_expired', 'counterofferId', o.id));
    counteroffer_id := o.id;
    application_id := o.application_id;
    return next;
  end loop;
end;
$function$;

revoke all on function public.la3_expire_counteroffers() from public, anon, authenticated;
grant execute on function public.la3_expire_counteroffers() to service_role;

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'tenant_application_counteroffers'
         and column_name in ('applied_effective_on', 'offered_effective_on')) <> 2 then
    raise exception '20260926102210: the counteroffer effective-date columns are missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'la3_expire_counteroffers' and prosecdef) then
    raise exception '20260926102210: la3_expire_counteroffers is missing or not security definer';
  end if;
  if has_function_privilege('tenant_app', 'public.la3_expire_counteroffers()', 'execute') then
    raise exception '20260926102210: la3_expire_counteroffers is callable by tenant_app';
  end if;
  if position('delete' in lower((select prosrc from pg_proc where proname = 'la3_expire_counteroffers' limit 1))) > 0 then
    raise exception '20260926102210: la3_expire_counteroffers deletes something';
  end if;
end $$;

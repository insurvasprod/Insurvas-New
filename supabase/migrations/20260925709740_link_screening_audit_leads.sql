-- ---------------------------------------------------------------------------
-- LA-2.3-9 · a screening check made before its lead existed is linked to the lead in one statement
--
-- Imports, partner submits and real-time posts screen a number before the lead row exists, so
-- screening_audit.lead_id was always null. lib/compliance/screening.ts now returns the audit row's
-- id with each decision, and the caller links it once the lead is inserted. An import can commit
-- thousands of leads, so the links go in as one jsonb array: [{"audit_id": …, "lead_id": …}, …].
--
-- Only rows of this tenant, only rows not already linked, only to a lead of this tenant. Returns
-- how many rows it linked. Before this file the app falls back to one update per link (capped).
-- ---------------------------------------------------------------------------

create or replace function public.link_screening_audit_leads(p_tenant_id uuid, p_links jsonb)
returns integer
language sql
volatile
security definer
set search_path = public, pg_catalog
as $function$
  with links as (
    select distinct on (l.audit_id) l.audit_id, l.lead_id
      from jsonb_to_recordset(coalesce(p_links, '[]'::jsonb)) as l(audit_id uuid, lead_id uuid)
     where l.audit_id is not null and l.lead_id is not null
  ),
  linked as (
    update public.screening_audit a
       set lead_id = links.lead_id
      from links
     where a.tenant_id = p_tenant_id
       and a.id = links.audit_id
       and a.lead_id is null
       and exists (select 1 from public.agent_leads x where x.id = links.lead_id and x.tenant_id = p_tenant_id)
    returning 1
  )
  select count(*)::integer from linked;
$function$;

revoke all on function public.link_screening_audit_leads(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.link_screening_audit_leads(uuid, jsonb) to service_role;

do $$
declare
  v_n integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709740: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  -- A link to a lead of another tenant, or to nothing, links nothing.
  select public.link_screening_audit_leads(gen_random_uuid(), jsonb_build_array(jsonb_build_object('audit_id', gen_random_uuid(), 'lead_id', gen_random_uuid()))) into v_n;
  if v_n <> 0 then raise exception '20260925709740: a link for an unknown tenant changed % row(s)', v_n; end if;
  select public.link_screening_audit_leads(gen_random_uuid(), '[]'::jsonb) into v_n;
  if v_n <> 0 then raise exception '20260925709740: an empty link list changed % row(s)', v_n; end if;
  raise notice '20260925709740: screening checks can be linked to their leads in bulk';
end $$;

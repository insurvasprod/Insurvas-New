-- ---------------------------------------------------------------------------
-- Dialer · every stored suppression list is re-checked at the dial, one row per list
--
-- The dial gate (getDialerEligibility → is_tenant_phone_suppressed, 20260924340000) read ONLY the
-- agency's own list, tenant_do_not_call. The scrub results — TCPA litigator, federal DNC, state DNC
-- and invalid numbers, stored in tenant_suppression_list by the import scrub and the campaign
-- scrub — stopped a lead from being SERVED (is_phone_suppressed, in serve_next_lead) but were never
-- asked again when the agent dialled, so a lead opened another way (the search path, or a lead that
-- was served before its number was scrubbed) reached the dial with a litigator hit on file.
--
-- User decision (2026-09-25): the dial re-checks every stored list, and a hit refuses the dial with
-- the list named. tenant_phone_suppression_hits returns one row per list the number is on, so the
-- dialer can both refuse by name and show the stack. No vendor is called: these are the stored
-- results (the live per-dial litigator lookup was declined — it costs a fee per dial).
--
-- Same number normalisation as is_phone_suppressed / is_tenant_phone_suppressed: digits only, a
-- leading 1 dropped from eleven digits.
--
-- Read-only (STABLE). Additive: a new function, nothing else changes.
-- ---------------------------------------------------------------------------

create or replace function public.tenant_phone_suppression_hits(p_tenant_id uuid, p_phone text)
returns table(list_type text, reason text, source text, added_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  with d as (
    select case when length(x.digits) = 11 and left(x.digits, 1) = '1' then right(x.digits, 10) else x.digits end as digits
      from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as digits) x
  )
  select t.list_type, t.reason, t.source, t.added_at
    from (
      select 'internal'::text as list_type, dnc.reason, 'disposition'::text as source, dnc.created_at as added_at
        from public.tenant_do_not_call dnc, d
       where dnc.tenant_id = p_tenant_id and dnc.is_active and dnc.phone_digits = d.digits
      union all
      select s.list_type, s.reason, s.source, s.added_at
        from public.tenant_suppression_list s, d
       where s.tenant_id = p_tenant_id and s.phone_digits = d.digits
    ) t
   order by case t.list_type when 'tcpa_litigator' then 0 when 'federal_dnc' then 1 when 'state_dnc' then 2 when 'internal' then 3 else 4 end,
            t.added_at;
$function$;

revoke all on function public.tenant_phone_suppression_hits(uuid, text) from public, anon, authenticated;
grant execute on function public.tenant_phone_suppression_hits(uuid, text) to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_row record;
  v_n integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925700200: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  -- Every number the serving gate refuses is a hit here too, for both tables.
  select s.tenant_id, s.phone_digits, s.list_type into v_row from public.tenant_suppression_list s limit 1;
  if v_row.tenant_id is not null then
    select count(*) into v_n from public.tenant_phone_suppression_hits(v_row.tenant_id, '+1' || v_row.phone_digits) h where h.list_type = v_row.list_type;
    if v_n <> 1 then raise exception 'tenant_phone_suppression_hits misses a % scrub hit', v_row.list_type; end if;
  end if;
  select t.tenant_id, t.phone_digits into v_row from public.tenant_do_not_call t where t.is_active limit 1;
  if v_row.tenant_id is not null then
    select count(*) into v_n from public.tenant_phone_suppression_hits(v_row.tenant_id, v_row.phone_digits) h where h.list_type = 'internal';
    if v_n < 1 then raise exception 'tenant_phone_suppression_hits misses the agency''s own list'; end if;
  end if;
  select count(*) into v_n from public.tenant_phone_suppression_hits(gen_random_uuid(), '5555550100');
  if v_n <> 0 then raise exception 'tenant_phone_suppression_hits reports a hit for an unknown tenant'; end if;
  if not has_function_privilege('tenant_app', 'public.tenant_phone_suppression_hits(uuid, text)', 'execute') then
    raise exception 'tenant_app cannot execute tenant_phone_suppression_hits';
  end if;
  raise notice '20260925700200: the dial can re-check every stored suppression list';
end $$;

-- ---------------------------------------------------------------------------
-- The agency's own do-not-call list answers for a number however it is written.
--
-- tenant_do_not_call stores ten digits (every row, measured 2026-09-24). is_tenant_phone_suppressed
-- compared its argument to that exactly, and three callers hand it whatever normalizeDialPhone
-- returns — `+15551234567` or `15551234567` when the lead's number was stored with its country code:
--
--   lib/dialerScripts/service.ts   the dial gate (getDialerEligibility, before markDialClicked)
--   lib/compliance/service.ts      performDncDialPreflight (Check a number)
--   lib/compliance/screening.ts    partner lead screening
--
-- so a number on the list was reported clear whenever it arrived with a leading 1. Serving was never
-- affected: serve_next_lead reads is_phone_suppressed, which already strips the prefix. This makes the
-- two agree, in the database, so every caller is covered at once and none can drift again.
--
-- Same signature and return type, so `create or replace` keeps every grant.
-- ---------------------------------------------------------------------------

create or replace function public.is_tenant_phone_suppressed(p_tenant_id uuid, p_phone_digits text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with d as (
    select regexp_replace(coalesce(p_phone_digits, ''), '[^0-9]', '', 'g') as digits
  )
  select exists (
    select 1
      from public.tenant_do_not_call t, d
     where t.tenant_id = p_tenant_id
       and t.is_active
       and t.phone_digits = case when length(d.digits) = 11 and left(d.digits, 1) = '1'
                                 then right(d.digits, 10) else d.digits end
  );
$function$;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.is_tenant_phone_suppressed(uuid, text)'::regprocedure) into v_def;
  if v_def !~ 'right\(d\.digits, 10\)' then
    raise exception 'is_tenant_phone_suppressed does not strip the country code';
  end if;
  if not has_function_privilege('tenant_app', 'public.is_tenant_phone_suppressed(uuid, text)', 'execute')
     and not has_function_privilege('service_role', 'public.is_tenant_phone_suppressed(uuid, text)', 'execute') then
    raise exception 'is_tenant_phone_suppressed lost its grants';
  end if;
  raise notice 'the agency do-not-call list now matches +1 / 1-prefixed numbers';
end $$;

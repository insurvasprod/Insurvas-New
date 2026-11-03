-- Remove the client-role surface this application never uses.
--
-- Two findings, and they are not equally serious. Recorded here because the Supabase advisor reports
-- them the other way round and the more dangerous one reads as the quieter number.
--
-- 1. THIRTEEN TABLES carry full grants to anon and authenticated while having RLS enabled and no
--    policy. The advisor counts 86 policy-less RLS tables; 73 of those hold no client grant at all
--    and are unreachable, so the real list is these thirteen. Even here, RLS-with-no-policy already
--    denies SELECT, INSERT, UPDATE and DELETE to a role that is not the owner and lacks BYPASSRLS,
--    so this is defence in depth rather than an open door -- with one exception that is not:
--
--      TRUNCATE IS NOT SUBJECT TO ROW-LEVEL SECURITY.
--
--    RLS filters rows for DML. It does not apply to TRUNCATE, which is a table-level operation
--    gated only by the TRUNCATE privilege. anon currently holds TRUNCATE on payments, credit_notes,
--    invoice_counters, webhook_events and tenant_credits among others. No route reaches it through
--    PostgREST, which exposes no TRUNCATE verb, so this is not remotely exploitable today -- but it
--    is a grant that RLS does not cover, on financial tables, held by the anonymous role.
--
-- 2. FORTY-FOUR SECURITY DEFINER functions are executable by anon or authenticated. This is the one
--    that actually grants access: a SECURITY DEFINER function runs with its owner's privileges and
--    bypasses RLS by design, so an executable one hands the caller whatever it does, policies or no
--    policies. Four of them are named admin_*.
--
--    Twelve of the forty-four are declared by this repository or called by this application. Those
--    are revoked below. The other thirty-two are organizations-era outbound and seat functions that
--    this repository neither declares nor calls; revoking them blind could break the other product,
--    so they are listed in docs/backlog.md instead. Same rule as every other cross-lineage change
--    here: this application's surface moves, the other product's does not.
--
-- Safe to apply. Nothing in this repository connects as anon or authenticated: there is no browser
-- Supabase client, and NEXT_PUBLIC_SUPABASE_ANON_KEY is not set in the environment at all. Every
-- connection is service_role through the service client, or tenant_app for direct RLS-scoped reads,
-- and neither role is touched here.

-- 1. The thirteen tables.
revoke all on public.coupons              from anon, authenticated;
revoke all on public.credit_notes         from anon, authenticated;
revoke all on public.invoice_counters     from anon, authenticated;
revoke all on public.metrics_daily        from anon, authenticated;
revoke all on public.payments             from anon, authenticated;
revoke all on public.provider_settings    from anon, authenticated;
revoke all on public.subscription_coupons from anon, authenticated;
revoke all on public.template_fields      from anon, authenticated;
revoke all on public.template_forms       from anon, authenticated;
revoke all on public.template_stages      from anon, authenticated;
revoke all on public.tenant_credits       from anon, authenticated;
revoke all on public.webhook_events       from anon, authenticated;
revoke all on public.whop_plans           from anon, authenticated;

-- 2. The twelve functions this application owns. Looped by name so every overload is covered without
-- restating signatures that would drift the moment one changes.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and p.proname = any (array[
         'admin_apply_tenant_template',
         'admin_duplicate_template',
         'admin_save_template',
         'admin_update_tenant_template',
         'apply_auto_offer_to_subscription',
         'cancel_callback',
         'claim_callback_reminders',
         'complete_callback',
         'get_platform_maintenance_state',
         'increment_offer_redemption',
         'reopen_expired_lead',
         'reschedule_callback'
       ])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
    execute format('grant execute on function %s to service_role', fn.sig);
  end loop;
end;
$$;

-- Assert the outcome rather than trusting the loop, for the same reason 20260912320000 does: a
-- statement that silently affects nothing is how most of this week's defects survived.
do $$
declare
  still_open integer;
begin
  select count(*) into still_open
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and p.proname like 'admin\_%'
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE'));

  if still_open > 0 then
    raise exception '% admin_* SECURITY DEFINER function(s) remain client-executable', still_open;
  end if;
end;
$$;

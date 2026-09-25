-- Cross-cutting security repair discovered by the live database review.
-- Keep the public function contracts unchanged; only make the execution namespace deterministic.

alter function public.render_disposition_note(text, text, text, text, text, text)
  set search_path = pg_catalog;

-- All table/function references in this function are schema-qualified. Putting pg_catalog first
-- prevents an object in public from shadowing a built-in while retaining the function's existing
-- behavior. This is intentionally separate from the earlier repair so promotion can be verified
-- independently of the offer precedence change.
alter function public.apply_auto_offer_to_subscription(uuid)
  set search_path = pg_catalog, public;

do $$
declare
  v_config text;
begin
  select coalesce(array_to_string(p.proconfig, ','), '')
    into v_config
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'render_disposition_note'
   limit 1;
  if v_config !~ 'search_path=pg_catalog' then
    raise exception 'render_disposition_note search path was not pinned';
  end if;

  select coalesce(array_to_string(p.proconfig, ','), '')
    into v_config
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'apply_auto_offer_to_subscription'
   limit 1;
  if v_config !~ 'search_path=pg_catalog, public' then
    raise exception 'apply_auto_offer_to_subscription search path was not pinned';
  end if;
end $$;

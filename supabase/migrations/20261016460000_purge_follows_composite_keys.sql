-- Workspace purge: keys of any width (2026-10-16).
--
-- Third live run (20261016450000): Isolation Test A purged; B-advance and B-pro stopped on
-- partner_market_access_profiles. Their revision items point at a revision by two columns
-- (profile_id, revision), and 450000 followed single-column keys only, so the items, then the
-- revisions, then the profiles could not go. Both child steps now build the join from every column
-- of the key. Everything else is 20261016450000's body.
-- Rollback: re-run purge_tenant_workspace from 20261016450000.

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
  v_errors jsonb := '{}'::jsonb;
  fk record;
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
    -- Rows with no tenant_id that RESTRICT such a row, one level further (a revision's items). Keys of
    -- any width: revision items point at a revision by (profile_id, revision).
    for fk in
      select c2.relname::text as child2, c1.relname::text as child1, gp.relname::text as grand,
             (select string_agg(format('x.%I = y.%I', ca.attname, pa.attname), ' and ' order by k.ord)
                 from unnest(k2.conkey, k2.confkey) with ordinality as k(ck, pk, ord)
                 join pg_attribute ca on ca.attrelid = k2.conrelid and ca.attnum = k.ck
                 join pg_attribute pa on pa.attrelid = k2.confrelid and pa.attnum = k.pk) as cond2,
             (select string_agg(format('y.%I = z.%I', ca.attname, pa.attname), ' and ' order by k.ord)
                 from unnest(k1.conkey, k1.confkey) with ordinality as k(ck, pk, ord)
                 join pg_attribute ca on ca.attrelid = k1.conrelid and ca.attnum = k.ck
                 join pg_attribute pa on pa.attrelid = k1.confrelid and pa.attnum = k.pk) as cond1
        from pg_constraint k2
        join pg_class c2 on c2.oid = k2.conrelid
        join pg_namespace n2 on n2.oid = c2.relnamespace
        join pg_class c1 on c1.oid = k2.confrelid
        join pg_constraint k1 on k1.conrelid = c1.oid and k1.contype = 'f'
        join pg_class gp on gp.oid = k1.confrelid
       where k2.contype = 'f' and k2.confdeltype in ('r', 'a')
         and n2.nspname = 'public' and not c2.relispartition
         and not exists (select 1 from pg_attribute x where x.attrelid = c2.oid and x.attname = 'tenant_id' and not x.attisdropped)
         and not exists (select 1 from pg_attribute x where x.attrelid = c1.oid and x.attname = 'tenant_id' and not x.attisdropped)
         and gp.relname::text = any (v_all)
    loop
      begin
        execute format('delete from public.%I x using public.%I y, public.%I z where %s and %s and z.tenant_id = $1',
                       fk.child2, fk.child1, fk.grand, fk.cond2, fk.cond1) using p_tenant_id;
        get diagnostics n = row_count;
        if n > 0 then
          v_progress := true;
          v_counts := v_counts || jsonb_build_object(fk.child2, coalesce((v_counts->>fk.child2)::bigint, 0) + n);
        end if;
      exception when others then
        v_errors := v_errors || jsonb_build_object(fk.child2, sqlerrm);
      end;
    end loop;
    -- Rows with no tenant_id of their own that RESTRICT one of this agency's rows (a market-access
    -- revision, a partner's terms, a legacy intake row): they belong to it through that row, so they
    -- go first. Keys of any width; a failure is recorded and retried.
    for fk in
      select ch.relname::text as child, pa_t.relname::text as parent,
             (select string_agg(format('c.%I = p.%I', ca.attname, pa.attname), ' and ' order by k.ord)
                 from unnest(con.conkey, con.confkey) with ordinality as k(ck, pk, ord)
                 join pg_attribute ca on ca.attrelid = con.conrelid and ca.attnum = k.ck
                 join pg_attribute pa on pa.attrelid = con.confrelid and pa.attnum = k.pk) as cond
        from pg_constraint con
        join pg_class ch on ch.oid = con.conrelid
        join pg_namespace chn on chn.oid = ch.relnamespace
        join pg_class pa_t on pa_t.oid = con.confrelid
       where con.contype = 'f' and con.confdeltype in ('r', 'a')
         and chn.nspname = 'public' and not ch.relispartition
         and not exists (select 1 from pg_attribute x where x.attrelid = ch.oid and x.attname = 'tenant_id' and not x.attisdropped)
         and pa_t.relname::text = any (v_all)
    loop
      begin
        execute format('delete from public.%I c using public.%I p where %s and p.tenant_id = $1', fk.child, fk.parent, fk.cond) using p_tenant_id;
        get diagnostics n = row_count;
        if n > 0 then
          v_progress := true;
          v_counts := v_counts || jsonb_build_object(fk.child, coalesce((v_counts->>fk.child)::bigint, 0) + n);
        end if;
      exception when others then
        v_errors := v_errors || jsonb_build_object(fk.child, sqlerrm);
      end;
    end loop;
    foreach t in array v_todo loop
      begin
        execute format('delete from public.%I where tenant_id = $1', t) using p_tenant_id;
        get diagnostics n = row_count;
        if n > 0 then
          v_progress := true;
          v_counts := v_counts || jsonb_build_object(t, coalesce((v_counts->>t)::bigint, 0) + n);
        end if;
      -- Any refusal, not only a foreign key: deleting a parent can make the database blank a link in a
      -- guarded table (a policy link, a transfer verdict, a win-back) whose guard refuses the update.
      -- Those rows go later in the same pass, so the parent is simply tried again. A cancelled
      -- statement (a timeout) is never caught here: it stops the purge, and nothing is deleted.
      exception when others then
        v_left := v_left || t;
        v_errors := v_errors || jsonb_build_object(t, sqlerrm);
      end;
    end loop;
    exit when cardinality(v_left) = 0 or v_pass >= 20 or (not v_progress and v_pass > 1);
    v_todo := v_left;
  end loop;

  -- Nothing of the agency may be left outside the kept records.
  foreach t in array v_all loop
    execute format('select count(*) from public.%I where tenant_id = $1', t) into n using p_tenant_id;
    if n > 0 then
      raise exception using errcode = 'P0001', message = format('PURGE_INCOMPLETE: %s row(s) left in %s (%s)', n, t, coalesce(v_errors->>t, 'no error recorded'));
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

do $$
begin
  if (select prosrc from pg_proc where oid = 'public.purge_tenant_workspace(uuid,uuid,text,text)'::regprocedure) not like '%unnest(k2.conkey, k2.confkey) with ordinality%' then
    raise exception 'purge_tenant_workspace still follows single-column keys only';
  end if;
end $$;

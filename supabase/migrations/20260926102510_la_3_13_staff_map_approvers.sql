-- LA-3.13 — staff can verify and publish the platform field maps.
--
-- 20260926100800 made the approver columns reference public.users, which holds agency people only.
-- Staff are public.admin_users, so the admin console could edit a platform map but never verify an
-- entry or publish it (lib/extension/maps.ts refused with FIELD_MAP_STAFF_APPROVER_PENDING). In short:
--
--   carrier_field_map.approved_by_admin        NEW    uuid → admin_users; the staff approver
--   carrier_field_map_entry.verified_by_admin  NEW    uuid → admin_users; the staff verifier
--   carrier_field_map_published_approved       CHECK  approved_by OR approved_by_admin, and approved_at
--   carrier_field_map_entry_verified_by        CHECK  verified needs verified_by OR verified_by_admin
--   carrier_field_map_guard()                  FUNC   same signature; approved_by_admin is frozen with
--                                                     approved_by once a map is published
--
-- Both columns are `on delete restrict`: who approved a published map is a record of fact, and the
-- CHECKs above would refuse the null a `set null` would write anyway. Staff are deactivated, never
-- deleted (nothing in lib/ deletes an admin_users row).
--
-- Down (only while no row has either new column set):
--   restore both CHECKs and carrier_field_map_guard() from 20260926100800;
--   alter table public.carrier_field_map drop column approved_by_admin;
--   alter table public.carrier_field_map_entry drop column verified_by_admin;

-- ── 1 · columns ─────────────────────────────────────────────────────────────
alter table public.carrier_field_map
  add column if not exists approved_by_admin uuid references public.admin_users(id) on delete restrict;
alter table public.carrier_field_map_entry
  add column if not exists verified_by_admin uuid references public.admin_users(id) on delete restrict;

create index if not exists carrier_field_map_approved_by_admin_idx
  on public.carrier_field_map (approved_by_admin) where approved_by_admin is not null;
create index if not exists carrier_field_map_entry_verified_by_admin_idx
  on public.carrier_field_map_entry (verified_by_admin) where verified_by_admin is not null;
-- 20260926100800 indexed verified_by but not approved_by.
create index if not exists carrier_field_map_approved_by_idx
  on public.carrier_field_map (approved_by) where approved_by is not null;

-- ── 2 · either approver satisfies the CHECKs ────────────────────────────────
alter table public.carrier_field_map
  drop constraint if exists carrier_field_map_published_approved,
  add constraint carrier_field_map_published_approved
    check (status <> 'published' or ((approved_by is not null or approved_by_admin is not null) and approved_at is not null));

alter table public.carrier_field_map_entry
  drop constraint if exists carrier_field_map_entry_verified_by,
  add constraint carrier_field_map_entry_verified_by
    check (not verified or verified_by is not null or verified_by_admin is not null);

-- ── 3 · the publish guard, approved_by_admin frozen like approved_by ────────
--
-- Identical to 20260926100800's except the frozen tuple, which now carries approved_by_admin.
create or replace function public.carrier_field_map_guard()
returns trigger language plpgsql as $function$
declare
  v_unverified text;
  v_frozen boolean;
begin
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

-- ── 4 · checks ──────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public'
         and ((table_name = 'carrier_field_map' and column_name = 'approved_by_admin')
           or (table_name = 'carrier_field_map_entry' and column_name = 'verified_by_admin'))) <> 2 then
    raise exception '20260926102510: a staff approver column is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'carrier_field_map_published_approved'
                  and pg_get_constraintdef(oid) like '%approved_by_admin%') then
    raise exception '20260926102510: a published map still needs an agency approver';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'carrier_field_map_entry_verified_by'
                  and pg_get_constraintdef(oid) like '%verified_by_admin%') then
    raise exception '20260926102510: a verified entry still needs an agency verifier';
  end if;
  if position('approved_by_admin' in (select prosrc from pg_proc where proname = 'carrier_field_map_guard' limit 1)) = 0
     or position('insured.ssn' in (select prosrc from pg_proc where proname = 'carrier_field_map_guard' limit 1)) = 0 then
    raise exception '20260926102510: the publish guard does not freeze the staff approver, or lost the SSN rule';
  end if;
end $$;

-- A staff member verifies and publishes a platform map; the unverified-SSN rule still holds and the
-- staff approver is frozen once published. Everything the probe writes is undone by the sentinel.
do $$
declare
  v_carrier uuid := (select id from public.carriers order by created_at limit 1);
  v_admin uuid := (select id from public.admin_users order by created_at limit 1);
  v_other uuid := (select id from public.admin_users order by created_at offset 1 limit 1);
  v_map uuid;
  v_step uuid;
begin
  if v_carrier is null or v_admin is null then
    raise notice '20260926102510: no carrier or staff member to probe the staff approver with; skipped';
    return;
  end if;
  begin
    insert into public.carrier_field_map (tenant_id, carrier_id, version, status)
    values (null, v_carrier, 999998, 'draft') returning id into v_map;
    insert into public.carrier_field_map_step (map_id, page_key, url_pattern)
    values (v_map, 'probe', '/probe') returning id into v_step;
    insert into public.carrier_field_map_entry (step_id, field_key, selector, input_kind)
    values (v_step, 'insured.ssn', '#ssn', 'masked');

    begin
      update public.carrier_field_map set status = 'published', approved_by_admin = v_admin, approved_at = now() where id = v_map;
      raise exception '20260926102510: a map with an unverified SSN entry was published by staff';
    exception when others then
      if sqlerrm not like 'CARRIER_FIELD_MAP_SENSITIVE_UNVERIFIED%' then raise; end if;
    end;

    update public.carrier_field_map_entry set verified = true, verified_by_admin = v_admin where step_id = v_step;
    update public.carrier_field_map set status = 'published', approved_by_admin = v_admin, approved_at = now() where id = v_map;

    begin
      update public.carrier_field_map set approved_by_admin = coalesce(v_other, v_admin), approved_at = now() - interval '1 day' where id = v_map;
      raise exception '20260926102510: the staff approver of a published map was changed';
    exception when others then
      if sqlerrm not like 'CARRIER_FIELD_MAP_PUBLISHED_IMMUTABLE%' then raise; end if;
    end;

    raise exception 'la3_probe_rollback';
  exception when others then
    if sqlerrm <> 'la3_probe_rollback' then raise; end if;
  end;
end $$;

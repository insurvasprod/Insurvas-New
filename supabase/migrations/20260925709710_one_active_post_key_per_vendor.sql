-- ---------------------------------------------------------------------------
-- LA-2.5-2 · one posting key per vendor, rotatable
--
-- Spec: "One key per vendor, rotatable, rate-limited without dropping legitimate posts."
-- Found: a second key could be minted for a vendor that already held one (201), so a vendor could
-- hold any number of working keys.
--
-- Chosen per the spec: a vendor holds ONE active key. Minting a second is refused (the app answers
-- 409 and says to rotate). Rotation is the way to a new key, and it is atomic here: the vendor's
-- active key is retired and the new one inserted in one transaction, carrying the field map, its
-- notes and the campaign binding. Retired keys stay as rows (their posts are counted against them).
--
--   1. Any vendor that already holds more than one active key keeps the one used most recently
--      (then the newest), and the others are retired with rotated_at stamped. A notice says how many.
--   2. tenant_vendor_post_keys_one_active_per_vendor: a unique partial index, so no race between two
--      mints can leave two active keys.
--   3. rotate_vendor_post_key(): the atomic rotation the app calls (lib/leadPost/keys.ts). Before
--      this file the app keeps its old mint-then-retire order, which is only safe without the index.
-- ---------------------------------------------------------------------------

do $$
declare v_retired integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709710: dedupe skipped, % cannot write here', current_user;
    return;
  end if;
  with ranked as (
    select k.id,
           row_number() over (partition by k.tenant_id, k.vendor_id
                              order by k.last_used_at desc nulls last, k.created_at desc, k.id) as rn
      from public.tenant_vendor_post_keys k
     where k.is_active
  )
  update public.tenant_vendor_post_keys k
     set is_active = false, rotated_at = coalesce(k.rotated_at, now())
    from ranked r
   where r.id = k.id and r.rn > 1;
  get diagnostics v_retired = row_count;
  raise notice '20260925709710: % extra active key(s) retired, one active key per vendor kept', v_retired;
end $$;

create unique index if not exists tenant_vendor_post_keys_one_active_per_vendor
  on public.tenant_vendor_post_keys (tenant_id, vendor_id) where is_active;

create or replace function public.rotate_vendor_post_key(
  p_tenant_id uuid,
  p_key_id uuid,
  p_key_hash text,
  p_key_prefix text,
  p_actor uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_vendor uuid;
  v_map jsonb;
  v_notes jsonb;
  v_campaign uuid;
  v_id uuid;
begin
  select k.vendor_id, k.field_map, k.field_notes, k.campaign_id
    into v_vendor, v_map, v_notes, v_campaign
    from public.tenant_vendor_post_keys k
   where k.id = p_key_id and k.tenant_id = p_tenant_id
   for update;
  if v_vendor is null then
    raise exception 'post_key_not_found: that posting key is not on this workspace' using errcode = 'no_data_found';
  end if;
  if p_key_hash is null or length(p_key_hash) < 32 or p_key_prefix is null or length(p_key_prefix) = 0 then
    raise exception 'post_key_invalid: a new key hash and prefix are required' using errcode = 'check_violation';
  end if;

  -- Every active key the vendor holds is retired, not only the one named, so a rotation always
  -- leaves exactly one.
  update public.tenant_vendor_post_keys
     set is_active = false, rotated_at = now()
   where tenant_id = p_tenant_id and vendor_id = v_vendor and is_active;

  insert into public.tenant_vendor_post_keys
    (tenant_id, vendor_id, key_hash, key_prefix, field_map, field_notes, campaign_id, is_active, created_by)
  values
    (p_tenant_id, v_vendor, p_key_hash, p_key_prefix, coalesce(v_map, '{}'::jsonb), coalesce(v_notes, '{}'::jsonb), v_campaign, true, p_actor)
  returning id into v_id;
  return v_id;
end;
$function$;

revoke all on function public.rotate_vendor_post_key(uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.rotate_vendor_post_key(uuid, uuid, text, text, uuid) to service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_key record;
  v_new uuid;
  v_n integer;
  v_failed text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709710: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if exists (select 1 from public.tenant_vendor_post_keys where is_active group by tenant_id, vendor_id having count(*) > 1) then
    raise exception 'a vendor still holds more than one active posting key';
  end if;

  select k.id, k.tenant_id, k.vendor_id, k.field_map into v_key from public.tenant_vendor_post_keys k where k.is_active limit 1;
  if v_key.id is null then
    raise notice '20260925709710: no active key to rotate, rotation check skipped';
    return;
  end if;
  begin
    -- A second active key for the vendor is refused by the index.
    begin
      insert into public.tenant_vendor_post_keys (tenant_id, vendor_id, key_hash, key_prefix, field_map, is_active)
      values (v_key.tenant_id, v_key.vendor_id, md5('fix-s-a') || md5('fix-s-b'), 'selfchk', '{}'::jsonb, true);
      raise exception 'a second active key was accepted';
    exception when unique_violation then null;
    end;
    v_new := public.rotate_vendor_post_key(v_key.tenant_id, v_key.id, md5('fix-s-c') || md5('fix-s-d'), 'selfchk', null);
    select count(*) into v_n from public.tenant_vendor_post_keys where tenant_id = v_key.tenant_id and vendor_id = v_key.vendor_id and is_active;
    if v_n <> 1 then raise exception 'rotation left % active keys', v_n; end if;
    if not exists (select 1 from public.tenant_vendor_post_keys where id = v_new and is_active and field_map = v_key.field_map) then
      raise exception 'rotation did not carry the field map to an active new key';
    end if;
    if exists (select 1 from public.tenant_vendor_post_keys where id = v_key.id and (is_active or rotated_at is null)) then
      raise exception 'rotation did not retire the old key';
    end if;
    raise exception 'fix_s_709710_rollback';
  exception when raise_exception then
    get stacked diagnostics v_failed = message_text;
    if v_failed <> 'fix_s_709710_rollback' then raise exception '20260925709710 check failed: %', v_failed; end if;
  end;
  raise notice '20260925709710: one active key per vendor, rotation is atomic';
end $$;

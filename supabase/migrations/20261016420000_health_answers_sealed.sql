-- Health answers sealed field by field (2026-10-16).
--
-- Interview answers and their notes, medications, the amendment history and the submission's health
-- snapshot were stored in plain text (the privacy draft and the DPA both said so). The app now seals
-- each one with the same AES-256-GCM, per-agency key as SSNs (lib/applications/healthSealCore.ts):
-- one `sealed` column per table plus its `key_version`, and the plain columns left null on a sealed
-- row. The key lives only on the app server, so the database cannot seal; it only makes room:
--
--   tenant_uw_answers         + sealed, key_version   a sealed row has no plain value or notes
--   tenant_uw_answer_changes  + sealed, key_version   a sealed row has no plain old/new value
--   tenant_medications        + sealed, key_version   name may be null, but only on a sealed row
--   tenant_application_submissions.health_snapshot    unchanged column; a sealed one is
--                                                      {"sealed": "...", "key_version": 1}
--   seal_uw_answer_change(id, sealed, key_version)    the amendment history is append-only (no
--       UPDATE for anyone), so rows written before sealing are sealed through this one narrow door:
--       it only fills an empty `sealed`, and clears the plain values in the same statement.
--
-- Rows written before this are sealed by the super-admin action POST /api/admin/system/seal-health-data,
-- run on the production server (its key). Until then they read as before.
-- Rollback: drop function public.seal_uw_answer_change(uuid, text, smallint); drop the three
-- *_sealed_clears_plain checks and tenant_medications_name_or_sealed; restore
-- tenant_medications_name_check and `name set not null` (only once no sealed medication is left);
-- drop the sealed/key_version columns.

alter table public.tenant_uw_answers add column if not exists sealed text, add column if not exists key_version smallint;
alter table public.tenant_uw_answer_changes add column if not exists sealed text, add column if not exists key_version smallint;
alter table public.tenant_medications add column if not exists sealed text, add column if not exists key_version smallint;

alter table public.tenant_medications alter column name drop not null;
alter table public.tenant_medications drop constraint if exists tenant_medications_name_check;
alter table public.tenant_medications add constraint tenant_medications_name_check
  check (name is null or char_length(btrim(name)) between 1 and 200);

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.tenant_medications'::regclass and conname = 'tenant_medications_name_or_sealed') then
    alter table public.tenant_medications add constraint tenant_medications_name_or_sealed check (name is not null or sealed is not null);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.tenant_uw_answers'::regclass and conname = 'tenant_uw_answers_sealed_clears_plain') then
    alter table public.tenant_uw_answers add constraint tenant_uw_answers_sealed_clears_plain
      check (sealed is null or (value is null and notes is null and key_version is not null));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.tenant_uw_answer_changes'::regclass and conname = 'tenant_uw_answer_changes_sealed_clears_plain') then
    alter table public.tenant_uw_answer_changes add constraint tenant_uw_answer_changes_sealed_clears_plain
      check (sealed is null or (old_value is null and new_value is null and key_version is not null));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.tenant_medications'::regclass and conname = 'tenant_medications_sealed_clears_plain') then
    alter table public.tenant_medications add constraint tenant_medications_sealed_clears_plain
      check (sealed is null or (name is null and dose is null and since is null and prescribed_for is null and notes is null and key_version is not null));
  end if;
end $$;

create or replace function public.seal_uw_answer_change(p_id uuid, p_sealed text, p_key_version smallint)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_sealed is null or p_sealed !~ '^a1\.' or p_key_version is null then
    raise exception using errcode = '22023', message = 'SEALED_VALUE_REQUIRED';
  end if;
  update public.tenant_uw_answer_changes
     set sealed = p_sealed, key_version = p_key_version, old_value = null, new_value = null
   where id = p_id and sealed is null;
  return found;
end;
$$;
revoke all on function public.seal_uw_answer_change(uuid, text, smallint) from public, anon, authenticated, tenant_app;
grant execute on function public.seal_uw_answer_change(uuid, text, smallint) to service_role;

do $$
begin
  if (select count(*) from information_schema.columns where table_schema = 'public' and column_name in ('sealed', 'key_version')
        and table_name in ('tenant_uw_answers', 'tenant_uw_answer_changes', 'tenant_medications')) <> 6 then
    raise exception 'a sealed / key_version column is missing';
  end if;
  if (select count(*) from pg_constraint where conname in ('tenant_uw_answers_sealed_clears_plain', 'tenant_uw_answer_changes_sealed_clears_plain',
        'tenant_medications_sealed_clears_plain', 'tenant_medications_name_or_sealed')) <> 4 then
    raise exception 'a sealing check is missing';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'tenant_uw_answer_changes'
               and grantee in ('service_role', 'tenant_app') and privilege_type in ('UPDATE', 'DELETE')) then
    raise exception 'the amendment history is no longer append-only';
  end if;
end $$;

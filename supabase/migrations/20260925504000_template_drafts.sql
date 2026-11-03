-- Template drafts (admin Templates page, board p-adm-templates).
--
-- The board splits templates into Published, Draft and Archived. Today a template has one flag,
-- is_active: true means tenants can pick it, false means they cannot. "Not offered" covers two
-- different things that the page must tell apart:
--
--   Draft     never offered to tenants yet — being built
--   Archived  was offered, then withdrawn
--
-- published_at records the first moment a template was offered. It is stamped by a trigger, not by
-- the application, so every path that makes a template active — admin_save_template (create), the
-- restore/publish PATCH — stamps it without each one having to remember. Once set it is never
-- cleared: archiving a published template keeps it "Archived", not "Draft".
--
-- Backfill: every template that exists before this column was created with is_active = true
-- (admin_save_template defaults to true, admin_duplicate_template always inserted true), so each one
-- was published at created_at, including the ones archived since. The backfill runs only in the
-- same statement block that adds the column, so re-running this file never marks a real draft as
-- published.
--
-- Duplicates start as drafts (owner decision, 2026-09-25). admin_duplicate_template used to insert
-- the copy active, so a copy was offered to every agency the moment it was made. It is redefined
-- below from its latest definition (20260902140000_la_1_4_duplicate_metadata_ambiguity_fix) with
-- one change — the copy is inserted is_active = false, published_at null — and the same signature,
-- return type and grants (0006 + 20260912360000: service_role only).
--
-- Nothing else changes: no row other than the new column is written, and tenant copies
-- (tenant_templates) are untouched.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'templates' and column_name = 'published_at'
  ) then
    alter table public.templates add column published_at timestamptz;
    update public.templates set published_at = created_at where published_at is null;
    comment on column public.templates.published_at is
      'First time the template was offered to tenants (is_active became true). Null = draft, never offered.';
  end if;
end;
$$;

create or replace function public.stamp_template_published_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_active and new.published_at is null then
    new.published_at := now();
  end if;
  if tg_op = 'UPDATE' and old.published_at is not null and new.published_at is null then
    -- A template that was offered once stays "was offered": archiving is not un-publishing.
    new.published_at := old.published_at;
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_template_published_at() from public;

drop trigger if exists templates_stamp_published_at on public.templates;
create trigger templates_stamp_published_at
  before insert or update on public.templates
  for each row execute function public.stamp_template_published_at();

-- Same signature and return type as the live function, so create or replace is enough (no drop).
create or replace function public.admin_duplicate_template(p_template_id uuid, p_name text, p_created_by uuid default null)
returns table(template_id uuid, version integer)
language plpgsql security definer set search_path = public
as $$
declare source_row public.templates%rowtype; new_template_id uuid;
begin
  select * into source_row from public.templates where id = p_template_id;
  if not found then raise exception 'template_not_found'; end if;
  -- The copy is a draft: hidden from agencies until an admin publishes it.
  insert into public.templates (name, product_code, version, description, is_active, published_at, created_by)
  values (p_name, source_row.product_code, 1, source_row.description, false, null, coalesce(p_created_by, source_row.created_by)) returning id into new_template_id;
  insert into public.template_fields (template_id, version, field_key, label, type, is_required, options, sort_order, help_text, validation)
  select new_template_id, 1, f.field_key, f.label, f.type, f.is_required, f.options, f.sort_order, f.help_text, f.validation
  from public.template_fields f
  where f.template_id = p_template_id and f.version = source_row.version;
  insert into public.template_stages (template_id, version, stage_key, label, stage_type, color, sort_order)
  select new_template_id, 1, s.stage_key, s.label, s.stage_type, s.color, s.sort_order
  from public.template_stages s
  where s.template_id = p_template_id and s.version = source_row.version;
  insert into public.template_forms (template_id, version, form_definition)
  select new_template_id, 1, tf.form_definition
  from public.template_forms tf
  where tf.template_id = p_template_id and tf.version = source_row.version;
  template_id := new_template_id; version := 1; return next;
end;
$$;

revoke all on function public.admin_duplicate_template(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_duplicate_template(uuid, text, uuid) to service_role;

do $$
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925504000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'templates' and column_name = 'published_at'
  ) then
    raise exception 'templates.published_at is missing';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.templates'::regclass and tgname = 'templates_stamp_published_at' and not tgisinternal
  ) then
    raise exception 'templates_stamp_published_at trigger is missing';
  end if;

  if exists (select 1 from public.templates where is_active and published_at is null) then
    raise exception 'an active template has no published_at';
  end if;

  if pg_get_functiondef('public.admin_duplicate_template(uuid,text,uuid)'::regprocedure) !~ 'is_active, published_at, created_by\)\s*values \(p_name, source_row\.product_code, 1, source_row\.description, false, null' then
    raise exception 'admin_duplicate_template does not insert the copy as a draft';
  end if;

  if has_function_privilege('anon', 'public.admin_duplicate_template(uuid,text,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.admin_duplicate_template(uuid,text,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.admin_duplicate_template(uuid,text,uuid)', 'EXECUTE') then
    raise exception 'admin_duplicate_template grants drifted (service_role only)';
  end if;

  raise notice '20260925504000: template drafts in place (published_at + stamp trigger, duplicates start as drafts)';
end;
$$;

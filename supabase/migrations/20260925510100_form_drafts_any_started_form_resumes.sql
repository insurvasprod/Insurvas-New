-- LA-1.6-5: the partner portal keeps a list of drafts, and any started form can be resumed.
--
-- QA 2026-09-25 (Design 1): form_drafts allowed one draft per user per product
-- (form_drafts_owner_product_idx on tenant_id, user_id, product_code, owner_key), so a second form
-- for the same product overwrote the first, and a draft for another product came back only by
-- picking that product.
--
-- 1. form_drafts.is_multi marks a draft saved by the draft-list portal. Those rows are addressed by
--    id, so a partner user can hold several for one product. Existing rows stay false.
-- 2. The one-per-product unique index now covers only the legacy rows (where not is_multi). The two
--    existing save functions are restated from their latest definitions (save_form_draft:
--    20260902130000; save_partner_form_draft: 20260916100000) with the matching conflict target
--    `on conflict (...) where not is_multi`; nothing else in them changes, and create or replace
--    keeps their grants. The agent-side form (save_form_draft, partner_id null) keeps one draft per
--    product, as before.
-- 3. save_partner_form_draft_slot(..., p_draft_id) inserts a new draft (p_draft_id null) or updates
--    that user's own draft by id. At most 25 drafts per partner user.
--
-- The app works before this is applied: it falls back to save_partner_form_draft, which keeps the
-- old one-draft-per-product behaviour, and the list simply has one row per product.

alter table public.form_drafts add column if not exists is_multi boolean not null default false;

create or replace function public.save_form_draft(
  p_tenant_id uuid, p_partner_id uuid, p_user_id uuid, p_product_code text,
  p_tenant_template_id uuid, p_definition_version integer, p_payload jsonb
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare draft_id uuid;
begin
  insert into public.form_drafts (tenant_id, partner_id, user_id, product_code, tenant_template_id, definition_version, payload)
  values (p_tenant_id, p_partner_id, p_user_id, p_product_code, p_tenant_template_id, p_definition_version, p_payload)
  on conflict (tenant_id, user_id, product_code, owner_key) where not is_multi do update set
    tenant_template_id = excluded.tenant_template_id,
    definition_version = excluded.definition_version,
    payload = excluded.payload,
    updated_at = now()
  returning id into draft_id;
  return draft_id;
end;
$$;

create or replace function public.save_partner_form_draft(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_user_id uuid,
  p_product_code text,
  p_tenant_template_id uuid,
  p_definition_version integer,
  p_profile_id uuid,
  p_profile_revision integer,
  p_payload jsonb
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  draft_id uuid;
begin
  if p_partner_id is null then raise exception 'partner_required'; end if;
  if p_profile_id is not null and not exists (
    select 1 from public.partner_submission_profiles p
    where p.id = p_profile_id
      and p.tenant_id = p_tenant_id
      and p.partner_id = p_partner_id
      and p.product_code = p_product_code
  ) then raise exception 'invalid_partner_submission_profile'; end if;
  if p_profile_id is not null and p_profile_revision is null then raise exception 'profile_revision_required'; end if;
  if p_profile_id is not null and not exists (
    select 1 from public.partner_submission_profile_revisions r
    where r.profile_id = p_profile_id and r.revision = p_profile_revision
  ) then raise exception 'invalid_partner_submission_profile_revision'; end if;

  insert into public.form_drafts (
    tenant_id, partner_id, user_id, product_code, tenant_template_id, definition_version,
    partner_submission_profile_id, partner_submission_profile_revision, payload
  ) values (
    p_tenant_id, p_partner_id, p_user_id, p_product_code, p_tenant_template_id, p_definition_version,
    p_profile_id, p_profile_revision, p_payload
  )
  on conflict (tenant_id, user_id, product_code, owner_key) where not is_multi do update set
    tenant_template_id = excluded.tenant_template_id,
    definition_version = excluded.definition_version,
    partner_submission_profile_id = excluded.partner_submission_profile_id,
    partner_submission_profile_revision = excluded.partner_submission_profile_revision,
    payload = excluded.payload,
    updated_at = now()
  returning id into draft_id;
  return draft_id;
end;
$$;

create unique index if not exists form_drafts_owner_product_single_idx
  on public.form_drafts (tenant_id, user_id, product_code, owner_key)
  where not is_multi;
drop index if exists public.form_drafts_owner_product_idx;
create index if not exists form_drafts_owner_list_idx
  on public.form_drafts (tenant_id, user_id, owner_key, updated_at desc);

create or replace function public.save_partner_form_draft_slot(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_user_id uuid,
  p_product_code text,
  p_tenant_template_id uuid,
  p_definition_version integer,
  p_profile_id uuid,
  p_profile_revision integer,
  p_payload jsonb,
  p_draft_id uuid default null
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  v_saved uuid;
  v_open integer;
begin
  if p_partner_id is null then raise exception 'partner_required'; end if;
  if p_profile_id is not null and not exists (
    select 1 from public.partner_submission_profiles p
    where p.id = p_profile_id
      and p.tenant_id = p_tenant_id
      and p.partner_id = p_partner_id
      and p.product_code = p_product_code
  ) then raise exception 'invalid_partner_submission_profile'; end if;
  if p_profile_id is not null and p_profile_revision is null then raise exception 'profile_revision_required'; end if;
  if p_profile_id is not null and not exists (
    select 1 from public.partner_submission_profile_revisions r
    where r.profile_id = p_profile_id and r.revision = p_profile_revision
  ) then raise exception 'invalid_partner_submission_profile_revision'; end if;

  if p_draft_id is not null then
    update public.form_drafts d
       set tenant_template_id = p_tenant_template_id,
           definition_version = p_definition_version,
           partner_submission_profile_id = p_profile_id,
           partner_submission_profile_revision = p_profile_revision,
           payload = p_payload,
           updated_at = now()
     where d.id = p_draft_id
       and d.tenant_id = p_tenant_id
       and d.partner_id = p_partner_id
       and d.user_id = p_user_id
       and d.product_code = p_product_code
    returning d.id into v_saved;
    if v_saved is null then raise exception 'form_draft_not_found'; end if;
    return v_saved;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('form_drafts:' || p_user_id::text, 0));
  select count(*)::integer into v_open
    from public.form_drafts d
   where d.tenant_id = p_tenant_id and d.partner_id = p_partner_id and d.user_id = p_user_id;
  if v_open >= 25 then raise exception 'form_draft_limit_reached'; end if;

  insert into public.form_drafts (
    tenant_id, partner_id, user_id, product_code, tenant_template_id, definition_version,
    partner_submission_profile_id, partner_submission_profile_revision, payload, is_multi
  ) values (
    p_tenant_id, p_partner_id, p_user_id, p_product_code, p_tenant_template_id, p_definition_version,
    p_profile_id, p_profile_revision, p_payload, true
  )
  returning id into v_saved;
  return v_saved;
end;
$$;

revoke all on function public.save_partner_form_draft_slot(uuid, uuid, uuid, text, uuid, integer, uuid, integer, jsonb, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.save_partner_form_draft_slot(uuid, uuid, uuid, text, uuid, integer, uuid, integer, jsonb, uuid) to service_role;

do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925510100: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'form_drafts_owner_product_idx') then
    raise exception 'form_drafts still allows only one draft per product';
  end if;
  if not exists (
    select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
     where c.relname = 'form_drafts_owner_product_single_idx' and i.indisunique and i.indpred is not null
  ) then
    raise exception 'the legacy one-per-product index is missing or not partial';
  end if;
  if exists (
    select 1 from pg_proc
     where pronamespace = 'public'::regnamespace and proname in ('save_form_draft', 'save_partner_form_draft')
       and position('where not is_multi' in prosrc) = 0
  ) then
    raise exception 'a legacy draft save still targets the dropped index';
  end if;
  if to_regprocedure('public.save_partner_form_draft_slot(uuid,uuid,uuid,text,uuid,integer,uuid,integer,jsonb,uuid)') is null then
    raise exception 'save_partner_form_draft_slot is missing';
  end if;
  -- Run both paths once and roll them back: a PL/pgSQL body only resolves its names when it runs.
  begin
    perform public.save_partner_form_draft_slot(d.tenant_id, d.partner_id, d.user_id, d.product_code, d.tenant_template_id, d.definition_version, null, null, '{}'::jsonb, null)
       from public.form_drafts d where d.partner_id is not null limit 1;
    perform public.save_partner_form_draft(d.tenant_id, d.partner_id, d.user_id, d.product_code, d.tenant_template_id, d.definition_version, null, null, d.payload)
       from public.form_drafts d where d.partner_id is not null and not d.is_multi limit 1;
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
end $$;

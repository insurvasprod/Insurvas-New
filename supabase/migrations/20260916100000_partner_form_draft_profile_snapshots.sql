-- Preserve the exact partner form profile used by a draft. New profile revisions affect
-- new forms, while an in-progress draft remains resumable against the revision it started with.
alter table public.form_drafts
  add column if not exists partner_submission_profile_id uuid references public.partner_submission_profiles(id) on delete restrict,
  add column if not exists partner_submission_profile_revision integer;

create index if not exists form_drafts_partner_profile_idx
  on public.form_drafts (tenant_id, partner_id, user_id, product_code, partner_submission_profile_id, partner_submission_profile_revision)
  where partner_submission_profile_id is not null;

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
  on conflict (tenant_id, user_id, product_code, owner_key) do update set
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

revoke all on function public.save_partner_form_draft(uuid, uuid, uuid, text, uuid, integer, uuid, integer, jsonb) from public, anon, authenticated, tenant_app;
grant execute on function public.save_partner_form_draft(uuid, uuid, uuid, text, uuid, integer, uuid, integer, jsonb) to service_role;

-- Publish the profile header and immutable revision in one transaction so a failed revision
-- insert can never leave current_revision pointing at a missing row.
create or replace function public.save_partner_submission_profile_revision(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_subject_user_id uuid,
  p_scope text,
  p_product_code text,
  p_fields jsonb,
  p_verification_fields jsonb,
  p_source_template_revision integer,
  p_created_by uuid
)
returns table(profile_id uuid, revision integer)
language plpgsql security definer set search_path = public
as $$
begin
  if jsonb_typeof(coalesce(p_fields, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_verification_fields, '[]'::jsonb)) <> 'array' then
    raise exception 'profile_fields_must_be_arrays';
  end if;
  return query
  with profile as (
    insert into public.partner_submission_profiles (tenant_id, partner_id, product_code, subject_user_id, scope, current_revision, created_by)
    values (p_tenant_id, p_partner_id, p_product_code, p_subject_user_id, p_scope, 1, p_created_by)
    on conflict (tenant_id, partner_id, product_code, subject_user_id, scope)
    do update set current_revision = public.partner_submission_profiles.current_revision + 1, updated_at = now()
    returning id, current_revision
  ), revision as (
    insert into public.partner_submission_profile_revisions (profile_id, revision, fields, verification_fields, source_template_revision, created_by)
    select id, current_revision, p_fields, p_verification_fields, p_source_template_revision, p_created_by from profile
    returning profile_id, revision
  ) select profile_id, revision from revision;
end;
$$;

revoke all on function public.save_partner_submission_profile_revision(uuid, uuid, uuid, text, text, jsonb, jsonb, integer, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.save_partner_submission_profile_revision(uuid, uuid, uuid, text, text, jsonb, jsonb, integer, uuid) to service_role;

-- The profile revision RPC returns table columns named profile_id and revision. Qualify the
-- final CTE projection so PostgreSQL does not confuse those columns with the output variables.
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
  if jsonb_typeof(coalesce(p_fields, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_verification_fields, '[]'::jsonb)) <> 'array' then
    raise exception 'profile_fields_must_be_arrays';
  end if;

  return query
  with profile as (
    insert into public.partner_submission_profiles (
      tenant_id,
      partner_id,
      product_code,
      subject_user_id,
      scope,
      current_revision,
      created_by
    )
    values (
      p_tenant_id,
      p_partner_id,
      p_product_code,
      p_subject_user_id,
      p_scope,
      1,
      p_created_by
    )
    on conflict (tenant_id, partner_id, product_code, subject_user_id, scope)
    do update set
      current_revision = public.partner_submission_profiles.current_revision + 1,
      updated_at = now()
    returning id, current_revision
  ), revision_row as (
    insert into public.partner_submission_profile_revisions (
      profile_id,
      revision,
      fields,
      verification_fields,
      source_template_revision,
      created_by
    )
    select
      profile.id,
      profile.current_revision,
      p_fields,
      p_verification_fields,
      p_source_template_revision,
      p_created_by
    from profile
    returning partner_submission_profile_revisions.profile_id,
      partner_submission_profile_revisions.revision
  )
  select revision_row.profile_id, revision_row.revision
  from revision_row;
end;
$$;

revoke all on function public.save_partner_submission_profile_revision(uuid, uuid, uuid, text, text, jsonb, jsonb, integer, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.save_partner_submission_profile_revision(uuid, uuid, uuid, text, text, jsonb, jsonb, integer, uuid) to service_role;

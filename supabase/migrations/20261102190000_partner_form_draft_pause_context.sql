-- Partner drafts persist the context from an intentional in-app pause.
alter table public.form_drafts
  add column if not exists pause_reason text,
  add column if not exists pause_notes text;

-- Drafts are recoverable work and must not disappear when a publisher starts several applications.
-- Keep the per-user advisory lock to serialize creation while removing the arbitrary 25-row cap.
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
begin
  if p_partner_id is null then raise exception 'partner_required'; end if;
  if p_profile_id is not null and not exists (
    select 1 from public.partner_submission_profiles p
    where p.id = p_profile_id and p.tenant_id = p_tenant_id
      and p.partner_id = p_partner_id and p.product_code = p_product_code
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
     where d.id = p_draft_id and d.tenant_id = p_tenant_id
       and d.partner_id = p_partner_id and d.user_id = p_user_id
       and d.product_code = p_product_code
    returning d.id into v_saved;
    if v_saved is null then raise exception 'form_draft_not_found'; end if;
    return v_saved;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('form_drafts:' || p_user_id::text, 0));
  insert into public.form_drafts (
    tenant_id, partner_id, user_id, product_code, tenant_template_id,
    definition_version, partner_submission_profile_id,
    partner_submission_profile_revision, payload, is_multi
  ) values (
    p_tenant_id, p_partner_id, p_user_id, p_product_code, p_tenant_template_id,
    p_definition_version, p_profile_id, p_profile_revision, p_payload, true
  ) returning id into v_saved;
  return v_saved;
end;
$$;

revoke all on function public.save_partner_form_draft_slot(uuid, uuid, uuid, text, uuid, integer, uuid, integer, jsonb, uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function public.save_partner_form_draft_slot(uuid, uuid, uuid, text, uuid, integer, uuid, integer, jsonb, uuid)
  to service_role;

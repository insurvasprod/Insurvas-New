-- Settings › Disclosures (owner, 2026-10-30): an agency can delete one of its own documents, not only
-- retire it, as long as no application has ever carried it.
--
-- 20260926102500 froze published and retired versions: only a draft could be deleted. The point of
-- that freeze is that an application keeps the exact wording it was given. A version no application
-- has ever carried (no tenant_application_disclosures row, in any status) protects nothing, so it may
-- go; one that any application carries still cannot, and is retired instead. The foreign key from
-- tenant_application_disclosures is ON DELETE RESTRICT, so the database refuses that case too.
--
-- Restated from the latest definition (20261016430000, which added the workspace-purge pass-through);
-- only the DELETE branch changes. Insurvas rows (tenant_id null) stay undeletable from here. Rules go
-- with their version through the ON DELETE CASCADE, which application_disclosure_rules_guard lets
-- through because the parent row is already gone.
--
-- Down: restate application_disclosures_guard() from 20261016430000.

CREATE OR REPLACE FUNCTION public.application_disclosures_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft'
       and (old.tenant_id is null or exists (select 1 from public.tenants t where t.id = old.tenant_id))
       and (old.tenant_id is null
            or exists (select 1 from public.tenant_application_disclosures a where a.disclosure_id = old.id)) then
      raise exception 'DISCLOSURE_PUBLISHED_IMMUTABLE: % v% is % and applications carry it, it cannot be deleted', old.code, old.version, old.status;
    end if;
    return old;
  end if;

  if old.status in ('published', 'retired') then
    -- created_by is left out: a deleted user sets it null, and that is not an edit of the text.
    if (new.tenant_id, new.code, new.title, new.body_markdown, new.attachment_path, new.states, new.carrier_ids, new.version)
       is distinct from
       (old.tenant_id, old.code, old.title, old.body_markdown, old.attachment_path, old.states, old.carrier_ids, old.version) then
      raise exception 'DISCLOSURE_PUBLISHED_IMMUTABLE: % v% is %; edit a new version instead', old.code, old.version, old.status;
    end if;
    if new.status is distinct from old.status and not (old.status = 'published' and new.status = 'retired') then
      raise exception 'DISCLOSURE_PUBLISHED_IMMUTABLE: % v% cannot go from % to %', old.code, old.version, old.status, new.status;
    end if;
  end if;
  return new;
end;
$function$;

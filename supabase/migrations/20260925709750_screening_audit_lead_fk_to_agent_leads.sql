-- ---------------------------------------------------------------------------
-- LA-2.3-9 · screening_audit.lead_id points at agent_leads, the leads screening is actually about
--
-- Found 2026-09-29, live: linking a check to its lead failed with 23503, "Key (lead_id)=(…) is not
-- present in table "leads"". The column's foreign key still names the legacy organization-plane
-- `leads` table. 20260913120000 repointed the NOT NULL lead_id columns at agent_leads and left
-- this nullable one, because nothing wrote it then ("latent: never written, so never fires").
-- lib/compliance/screening.ts writes it now (re-scrub, recycle, dial preflight) and links it after
-- a partner submit, an import or a real-time post.
--
-- Until this file is applied the app writes the audit row without the link (it retries without
-- lead_id on 23503), so screening never fails over it.
--
-- Any lead_id that names no agent_leads row is cleared first (none were written before 2026-09-29).
-- The new key is added NOT VALID and then validated, so the table is not locked for a full check.
-- ---------------------------------------------------------------------------

set local lock_timeout = '5s';

alter table public.screening_audit drop constraint if exists screening_audit_lead_id_fkey;

update public.screening_audit a
   set lead_id = null
 where a.lead_id is not null
   and not exists (select 1 from public.agent_leads l where l.id = a.lead_id);

alter table public.screening_audit
  add constraint screening_audit_lead_id_fkey
  foreign key (lead_id) references public.agent_leads(id) on delete set null not valid;

alter table public.screening_audit validate constraint screening_audit_lead_id_fkey;

do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709750: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.screening_audit'::regclass and conname = 'screening_audit_lead_id_fkey'
                    and confrelid = 'public.agent_leads'::regclass and convalidated) then
    raise exception '20260925709750: screening_audit.lead_id does not reference agent_leads';
  end if;
  raise notice '20260925709750: screening_audit.lead_id references agent_leads';
end $$;

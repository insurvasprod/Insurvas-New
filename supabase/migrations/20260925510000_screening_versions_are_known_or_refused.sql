-- LA-1.5-10: a screening result is versioned on the lead, and an unknown version is refused.
--
-- QA 2026-09-25 (Design 1): agent_leads.screening_version accepted 99 (reverted) and nothing read the
-- version back. The application now refuses to store or replay a version it does not know
-- (lib/compliance/screeningCore.ts KNOWN_SCREENING_VERSIONS, createPartnerLead) and the lead
-- workspace shows an unknown version as "not trusted" instead of as a result. This makes the
-- database refuse it too, for writers that do not go through that code.
--
-- The known set is {1}. A future version 2 adds itself here in the same migration that teaches the
-- application to read it. Checked live before writing: no agent_leads row and no screening_results
-- row has a version other than 1, so both constraints validate.

alter table public.agent_leads drop constraint if exists agent_leads_screening_version_known;
alter table public.agent_leads add constraint agent_leads_screening_version_known
  check (screening_version is null or screening_version in (1)) not valid;
alter table public.agent_leads validate constraint agent_leads_screening_version_known;

alter table public.screening_results drop constraint if exists screening_results_version_known;
alter table public.screening_results add constraint screening_results_version_known
  check (version in (1)) not valid;
alter table public.screening_results validate constraint screening_results_version_known;

do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925510000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.agent_leads'::regclass and conname = 'agent_leads_screening_version_known' and convalidated
  ) then
    raise exception 'agent_leads still accepts an unknown screening version';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.screening_results'::regclass and conname = 'screening_results_version_known' and convalidated
  ) then
    raise exception 'screening_results still accepts an unknown version';
  end if;
  -- The effect, not just the name: version 99 is refused.
  begin
    update public.agent_leads set screening_version = 99
     where id = (select id from public.agent_leads where screening_version is not null limit 1);
    if found then raise exception 'agent_leads accepted screening_version 99'; end if;
  exception when check_violation then null;
  end;
end $$;

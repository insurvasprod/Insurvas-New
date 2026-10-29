-- Supabase advisor · duplicate_index. The safe three of twelve.
--
-- The 2026-09-18 advisor run reported 12 duplicate-index warnings. Reproduced exactly by comparing
-- `pg_get_indexdef` with the index name normalised out — 12 sets, 6.4 MB in total, so this is a
-- write-amplification and maintenance cost rather than a correctness one. That matters for how much
-- risk is worth taking to fix it.
--
-- Only three are dropped here. All three come from ONE migration,
-- `20260911100000_live_runtime_compatibility.sql`, which was a bridge: it created tables and indexes
-- `if not exists` to make a drifted live database match the declarations. Each of the three has a
-- canonical partner that is declared independently and more than once, so the bridge copy is pure
-- residue:
--
--   agent_leads_partner_submission_compat_idx   →  agent_leads_partner_submission_idx     (declared 2x)
--   lead_queue_tenant_status_compat_idx         →  lead_queue_tenant_status_queued_idx    (declared 2x)
--   partner_channels_direct_compat_idx          →  partner_channels_direct_key_idx        (declared 2x)
--
-- Each is a plain index backing no constraint — confirmed against `pg_constraint.conindid` — so the
-- drop cannot remove a uniqueness guarantee by accident. The unique ones among them are duplicates
-- of a unique partner, so the guarantee survives in the index that stays.
--
-- ── THE OTHER NINE ARE DELIBERATELY LEFT ALONE ──────────────────────────────
--
-- Not an oversight, and not laziness. Two reasons, and the first one is disqualifying:
--
-- `public.leads` cannot be cleaned up at all. Both members of its pair are load-bearing:
--
--   leads_submission_id_key          backs UNIQUE CONSTRAINT leads_submission_id_key
--   leads_submission_id_unique_idx   is the index FOREIGN KEY verification_sessions_submission_id_fkey
--                                    depends on
--
-- Dropping either one either removes a uniqueness guarantee or breaks a foreign key. This pair needs
-- a constraint-level change, not an index drop, and that is a schema decision with a data-integrity
-- consequence rather than a tidy-up.
--
-- The remaining eight sit on `users`, `subscriptions`, `subscription_addons`, `organization_addons`,
-- `outbound_call_attempts`, `tenant_call_attempts` and `tenant_consent_artefacts`. In each pair both
-- members are plain indexes and either could go — which is exactly the problem: the choice is
-- arbitrary from the catalog's point of view, three of those tables carry billing state, and this
-- environment has no database rights to test a drop before it reaches production. Several are also
-- undeclared in any migration, so dropping one silently changes a live schema that no file describes.
--
-- The analysis is recorded in `docs/qa/LA-2-RELEASE-GATES.md` with the exact pairs and sizes, for
-- the database owner to decide. Four megabytes is not worth an untested drop on a subscriptions
-- table.
--
-- Safe to run twice: `drop index if exists`.

begin;

-- Checked BEFORE anything is dropped: the canonical partner has to exist. Dropping the bridge copy
-- and leaving the table with no index at all would turn a maintenance warning into a sequential
-- scan on the hot serving path, which is far worse than the duplicate it fixes.
do $$
declare
  v_missing text[] := '{}';
  v_pair text[];
begin
  foreach v_pair slice 1 in array array[
    array['agent_leads', 'agent_leads_partner_submission_idx'],
    array['lead_queue', 'lead_queue_tenant_status_queued_idx'],
    array['partner_channels', 'partner_channels_direct_key_idx']
  ] loop
    if not exists (
      select 1 from pg_class i
        join pg_namespace n on n.oid = i.relnamespace
       where n.nspname = 'public' and i.relname = v_pair[2] and i.relkind = 'i'
    ) then
      v_missing := v_missing || (v_pair[1] || ' has no ' || v_pair[2]);
    end if;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception 'refusing to drop a duplicate index while its canonical partner is absent: %',
      array_to_string(v_missing, '; ');
  end if;
end $$;

drop index if exists public.agent_leads_partner_submission_compat_idx;
drop index if exists public.lead_queue_tenant_status_compat_idx;
drop index if exists public.partner_channels_direct_compat_idx;

commit;

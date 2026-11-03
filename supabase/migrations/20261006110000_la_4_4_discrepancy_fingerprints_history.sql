-- LA-4.4 · discrepancies keep their identity month to month, can come back when they get worse, and
-- keep every status change.
--
-- 1. History. `history` (jsonb array) holds every status change: {from, to, by, at, note}. A
--    trigger appends to it whenever the status (or a person's decision time) changes, by a person
--    or by the refresh (`by` null). The trigger always starts from the stored history, so it can
--    only grow. Existing rows get a reconstructed start: found (open) at first_seen_at, then their
--    current status at status_changed_at when they have one.
--
-- 2. Fingerprints v2 (lib/discrepancies/compute.ts). v1 keyed never_paid and both chargeback kinds
--    by policy alone, so a finding resolved once hid the same kind on that policy forever; and
--    keyed short_paid / mis_rated by EVERY period reported, so each new statement replaced the
--    finding and a dispute was lost. v2 anchors each finding where its problem started:
--
--      never_paid             never_paid|<policy>|issue:<effective date>
--      short_paid, mis_rated  <kind>|<policy>|from:<period_start>
--      duplicate_chargeback   duplicate_chargeback|<policy>|from:<period_start>
--      unexpected_chargeback  unexpected_chargeback|<policy>|<period_start>~<period_end>
--
--    The stored rows are re-keyed here, so the next refresh finds them. When two v1 rows map to
--    one v2 key (a short_paid that was replaced month after month), the one still being worked
--    keeps the key (open or disputed first, then decided, then the newest); the others stay as
--    they are, cleared history. The identity guard is suspended for the re-key only.
--
--    The app reads `history` to know this ran: until then it keeps computing v1 fingerprints, so
--    nothing churns in between.
--
-- Rollback: the re-key cannot be reversed row by row (v1 keys are not stored). To return to v1:
--   drop trigger if exists tenant_commission_discrepancies_history on public.tenant_commission_discrepancies;
--   drop function if exists public.record_commission_discrepancy_history();
--   alter table public.tenant_commission_discrepancies drop column if exists history;
--   then the next v1 refresh clears the v2-keyed rows and opens v1-keyed ones.

-- ── 1. history ──────────────────────────────────────────────────────────────
alter table public.tenant_commission_discrepancies
  add column if not exists history jsonb not null default '[]'::jsonb;

alter table public.tenant_commission_discrepancies drop constraint if exists tenant_commission_discrepancies_history;
alter table public.tenant_commission_discrepancies add constraint tenant_commission_discrepancies_history
  check (jsonb_typeof(history) = 'array');

update public.tenant_commission_discrepancies
   set history = jsonb_build_array(jsonb_build_object('from', null, 'to', 'open', 'by', null, 'at', first_seen_at, 'note', null))
              || case
                   when status <> 'open' and status_changed_at is not null
                     then jsonb_build_array(jsonb_build_object('from', 'open', 'to', status, 'by', status_changed_by, 'at', status_changed_at, 'note', note))
                   else '[]'::jsonb
                 end
 where history = '[]'::jsonb;

create or replace function public.record_commission_discrepancy_history()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.history := jsonb_build_array(jsonb_build_object(
      'from', null, 'to', new.status, 'by', new.status_changed_by,
      'at', coalesce(new.status_changed_at, new.first_seen_at, now()), 'note', null));
    return new;
  end if;
  -- Append-only: whatever the caller sent, history continues from what is stored.
  new.history := old.history;
  if new.status is distinct from old.status or new.status_changed_at is distinct from old.status_changed_at then
    new.history := old.history || jsonb_build_array(jsonb_build_object(
      'from', old.status, 'to', new.status, 'by', new.status_changed_by,
      'at', coalesce(new.status_changed_at, now()),
      'note', case when new.note is distinct from old.note then new.note else null end));
  end if;
  return new;
end;
$$;

drop trigger if exists tenant_commission_discrepancies_history on public.tenant_commission_discrepancies;
create trigger tenant_commission_discrepancies_history
  before insert or update on public.tenant_commission_discrepancies
  for each row execute function public.record_commission_discrepancy_history();

-- ── 2. re-key v1 fingerprints to v2 ─────────────────────────────────────────
alter table public.tenant_commission_discrepancies disable trigger tenant_commission_discrepancies_guard;

with mapped as (
  select
    d.id,
    d.tenant_id,
    case d.kind
      when 'never_paid' then 'never_paid|' || d.policy_id::text || '|issue:' || p.effective_date::text
      when 'unexpected_chargeback' then 'unexpected_chargeback|' || d.policy_id::text || '|' || d.period_start::text || '~' || d.period_end::text
      else d.kind || '|' || d.policy_id::text || '|from:' || d.period_start::text
    end as fingerprint,
    d.status,
    d.last_seen_at
  from public.tenant_commission_discrepancies d
  join public.tenant_policies p on p.id = d.policy_id and p.tenant_id = d.tenant_id
  where d.fingerprint not like '%|issue:%'
    and d.fingerprint not like '%|from:%'
    and not (d.kind = 'unexpected_chargeback' and d.fingerprint ~ '\|\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}$')
    and (d.kind = 'never_paid' or (d.period_start is not null and (d.kind <> 'unexpected_chargeback' or d.period_end is not null)))
),
ranked as (
  select m.*,
         row_number() over (
           partition by m.tenant_id, m.fingerprint
           order by (m.status in ('open', 'disputed')) desc, (m.status in ('resolved', 'written_off')) desc, m.last_seen_at desc, m.id
         ) as rank
  from mapped m
)
update public.tenant_commission_discrepancies d
   set fingerprint = r.fingerprint
  from ranked r
 where d.id = r.id
   and r.rank = 1
   and not exists (
     select 1 from public.tenant_commission_discrepancies taken
      where taken.tenant_id = r.tenant_id and taken.fingerprint = r.fingerprint and taken.id <> r.id
   );

alter table public.tenant_commission_discrepancies enable trigger tenant_commission_discrepancies_guard;

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenant_commission_discrepancies' and column_name = 'history') then
    raise exception '20261006110000: tenant_commission_discrepancies.history is missing';
  end if;
  if exists (select 1 from public.tenant_commission_discrepancies where jsonb_array_length(history) = 0) then
    raise exception '20261006110000: a discrepancy has no history';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tenant_commission_discrepancies_history' and not tgisinternal) then
    raise exception '20261006110000: the history trigger is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tenant_commission_discrepancies_guard' and tgenabled = 'O') then
    raise exception '20261006110000: the identity guard is not enabled again';
  end if;
  -- Every finding still being worked carries a v2 key.
  if exists (
    select 1 from public.tenant_commission_discrepancies
     where status in ('open', 'disputed')
       and fingerprint not like '%|issue:%'
       and fingerprint not like '%|from:%'
       and not (kind = 'unexpected_chargeback' and fingerprint ~ '\|\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}$')
  ) then
    raise exception '20261006110000: an open or disputed discrepancy still has a v1 fingerprint';
  end if;
end;
$$;

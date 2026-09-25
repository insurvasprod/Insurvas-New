-- /app/lapse-risk: the signals that put a policy at risk.
--
-- The board is explicit that "a risk score without a reason is not actionable, so no policy will
-- ever appear here without one". Nothing supplied a reason until now: no carrier or payment feed
-- reports a missed draft, so the page could only ever be empty. This is the reason, recorded by a
-- person today (source 'manual') and by a feed later (source 'feed', de-duplicated on source_ref).
--
-- One row per signal. A policy is at risk while it has at least one OPEN signal (resolved_at null).
-- A signal is resolved, never deleted: resolution says how it ended, resolved_by who ended it. The
-- only way a row disappears is its tenant being deleted.
--
-- Same arrangement as tenant_policies (20260917120000): written by the service role after the API
-- has checked the caller's feature, role and producer scope; the tenant plane may read its own
-- tenant's rows. Additive and idempotent.

create table if not exists public.tenant_policy_lapse_signals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  policy_id uuid not null references public.tenant_policies(id) on delete cascade,
  kind text not null,
  occurred_on date not null,
  note text,
  source text not null default 'manual',
  -- A feed's own id for the event, so re-delivering the same file cannot record it twice.
  source_ref text,
  recorded_by uuid references public.users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  resolution text,
  resolution_note text,
  constraint tenant_policy_lapse_signals_kind check (kind in ('missed_draft', 'returned_payment', 'service_call', 'other')),
  constraint tenant_policy_lapse_signals_source check (source in ('manual', 'feed')),
  constraint tenant_policy_lapse_signals_note_length check (note is null or char_length(btrim(note)) between 1 and 1000),
  -- "Other" is only a reason if someone writes it down.
  constraint tenant_policy_lapse_signals_other_needs_note check (kind <> 'other' or (note is not null and char_length(btrim(note)) >= 3)),
  constraint tenant_policy_lapse_signals_occurred_sane check (occurred_on >= date '2000-01-01'),
  -- policy_cancelled is written only by the tenant_policies trigger below, never offered by the UI.
  constraint tenant_policy_lapse_signals_resolution check (resolution is null or resolution in ('payment_received', 'policy_reinstated', 'policy_lapsed', 'false_alarm', 'policy_cancelled')),
  constraint tenant_policy_lapse_signals_resolved_together check ((resolved_at is null) = (resolution is null)),
  constraint tenant_policy_lapse_signals_resolution_note_length check (resolution_note is null or char_length(btrim(resolution_note)) between 1 and 1000),
  -- A feed re-delivering the same event cannot record it twice. Manual rows carry no source_ref, and
  -- NULLs never collide in a unique constraint, so this binds feed rows only.
  constraint tenant_policy_lapse_signals_feed_ref unique (tenant_id, source, source_ref)
);

create index if not exists tenant_policy_lapse_signals_open_idx
  on public.tenant_policy_lapse_signals (tenant_id, policy_id) where resolved_at is null;
create index if not exists tenant_policy_lapse_signals_policy_idx on public.tenant_policy_lapse_signals (policy_id);
create index if not exists tenant_policy_lapse_signals_recorded_by_idx on public.tenant_policy_lapse_signals (recorded_by);
create index if not exists tenant_policy_lapse_signals_resolved_by_idx on public.tenant_policy_lapse_signals (resolved_by);

alter table public.tenant_policy_lapse_signals enable row level security;
revoke all on public.tenant_policy_lapse_signals from public, anon, authenticated;
-- No delete, for anyone: a signal is resolved, not removed. The tenant cascade still works, because
-- referential actions run as the table owner.
revoke delete on public.tenant_policy_lapse_signals from service_role;
grant select, insert, update on public.tenant_policy_lapse_signals to service_role;
grant select on public.tenant_policy_lapse_signals to tenant_app;
drop policy if exists tenant_policy_lapse_signals_read on public.tenant_policy_lapse_signals;
create policy tenant_policy_lapse_signals_read on public.tenant_policy_lapse_signals
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

-- ── what may change, and what never does ─────────────────────────────────
-- A signal is a record of what happened. Its facts are fixed once written; the only transition is
-- open → resolved, once. The ON DELETE SET NULL on the two user columns is the one exception.
create or replace function public.guard_tenant_policy_lapse_signal()
returns trigger language plpgsql set search_path = public as $$
declare
  v_policy record;
begin
  if tg_op = 'INSERT' then
    select tenant_id, status into v_policy from public.tenant_policies where id = new.policy_id;
    if not found or v_policy.tenant_id <> new.tenant_id then
      raise exception 'policy % does not belong to tenant %', new.policy_id, new.tenant_id using errcode = '23503';
    end if;
    if v_policy.status not in ('active', 'pending') then
      raise exception 'a % policy cannot be put at risk', v_policy.status using errcode = '23514';
    end if;
    if new.resolved_at is not null then
      raise exception 'a signal is recorded open' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.tenant_id <> old.tenant_id or new.policy_id <> old.policy_id or new.kind <> old.kind
     or new.occurred_on <> old.occurred_on or new.note is distinct from old.note or new.source <> old.source
     or new.source_ref is distinct from old.source_ref or new.recorded_at <> old.recorded_at
     or (new.recorded_by is distinct from old.recorded_by and new.recorded_by is not null) then
    raise exception 'a lapse signal''s facts cannot be changed' using errcode = '23514';
  end if;
  if old.resolved_at is not null and (
       new.resolved_at is distinct from old.resolved_at or new.resolution is distinct from old.resolution
       or new.resolution_note is distinct from old.resolution_note
       or (new.resolved_by is distinct from old.resolved_by and new.resolved_by is not null)) then
    raise exception 'a resolved lapse signal is final' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists tenant_policy_lapse_signals_guard on public.tenant_policy_lapse_signals;
create trigger tenant_policy_lapse_signals_guard
  before insert or update on public.tenant_policy_lapse_signals
  for each row execute function public.guard_tenant_policy_lapse_signal();

-- ── a policy that ends closes its signals ────────────────────────────────
-- However a policy comes to be lapsed or cancelled (the policies page, an import, the resolve path
-- below), it is no longer "at risk": it happened. Its open signals are closed with the matching
-- resolution and no resolver, which reads as "closed by the policy's own status change".
create or replace function public.close_lapse_signals_on_policy_end()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('lapsed', 'cancelled') and old.status is distinct from new.status then
    update public.tenant_policy_lapse_signals
       set resolved_at = now(),
           resolution = case when new.status = 'lapsed' then 'policy_lapsed' else 'policy_cancelled' end
     where tenant_id = new.tenant_id and policy_id = new.id and resolved_at is null;
  end if;
  return new;
end;
$$;
revoke all on function public.close_lapse_signals_on_policy_end() from public, anon, authenticated;

drop trigger if exists tenant_policies_close_lapse_signals on public.tenant_policies;
create trigger tenant_policies_close_lapse_signals
  after update of status on public.tenant_policies
  for each row execute function public.close_lapse_signals_on_policy_end();

-- ── resolving, in one transaction ────────────────────────────────────────
-- Resolves every open signal on one policy and, for policy_lapsed, marks the policy lapsed in the
-- same transaction — so the commission ledger (lib/ledger) sees the lapse and posts its chargeback,
-- and a failure half-way cannot leave a lapsed policy with open signals or the reverse. The signals
-- are resolved FIRST so they carry the resolver; the status trigger then finds none left open.
create or replace function public.resolve_policy_lapse_signals(
  p_tenant_id uuid,
  p_policy_id uuid,
  p_resolution text,
  p_actor uuid,
  p_note text default null
) returns table (resolved_count integer, policy_status text)
language plpgsql set search_path = public as $$
declare
  v_status text;
  v_count integer;
begin
  if p_resolution not in ('payment_received', 'policy_reinstated', 'policy_lapsed', 'false_alarm') then
    raise exception 'unknown resolution %', p_resolution using errcode = '22023';
  end if;

  select p.status into v_status from public.tenant_policies p
   where p.id = p_policy_id and p.tenant_id = p_tenant_id
   for update;
  if not found then
    raise exception 'policy not found' using errcode = 'P0002';
  end if;

  update public.tenant_policy_lapse_signals s
     set resolved_at = now(), resolved_by = p_actor, resolution = p_resolution, resolution_note = nullif(btrim(p_note), '')
   where s.tenant_id = p_tenant_id and s.policy_id = p_policy_id and s.resolved_at is null;
  get diagnostics v_count = row_count;

  if v_count > 0 and p_resolution = 'policy_lapsed' and v_status in ('active', 'pending') then
    update public.tenant_policies set status = 'lapsed' where id = p_policy_id and tenant_id = p_tenant_id;
    v_status := 'lapsed';
  end if;

  return query select v_count, v_status;
end;
$$;
revoke all on function public.resolve_policy_lapse_signals(uuid, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_policy_lapse_signals(uuid, uuid, text, uuid, text) to service_role;

-- ── asserted against whatever this database holds ─────────────────────────
do $$
begin
  if to_regclass('public.tenant_policy_lapse_signals') is null then
    raise exception 'tenant_policy_lapse_signals is missing';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'tenant_policy_lapse_signals' and c.relrowsecurity
  ) then
    raise exception 'tenant_policy_lapse_signals has row level security switched off';
  end if;
  if has_table_privilege('tenant_app', 'public.tenant_policy_lapse_signals', 'insert')
     or has_table_privilege('tenant_app', 'public.tenant_policy_lapse_signals', 'update')
     or has_table_privilege('tenant_app', 'public.tenant_policy_lapse_signals', 'delete') then
    raise exception 'the tenant plane can write lapse signals';
  end if;
  if has_table_privilege('service_role', 'public.tenant_policy_lapse_signals', 'delete') then
    raise exception 'lapse signals can be deleted; they must only ever be resolved';
  end if;
  if not has_table_privilege('tenant_app', 'public.tenant_policy_lapse_signals', 'select') then
    raise exception 'the tenant plane cannot read lapse signals';
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'tenant_policy_lapse_signals' and policyname = 'tenant_policy_lapse_signals_read'
  ) then
    raise exception 'tenant_policy_lapse_signals_read policy is missing';
  end if;
  if to_regprocedure('public.resolve_policy_lapse_signals(uuid, uuid, text, uuid, text)') is null then
    raise exception 'resolve_policy_lapse_signals is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tenant_policies_close_lapse_signals' and not tgisinternal) then
    raise exception 'tenant_policies_close_lapse_signals trigger is missing';
  end if;
end $$;

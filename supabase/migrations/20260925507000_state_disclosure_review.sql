-- State disclosures: propose, review, publish.
--
-- `state_disclosures` is read by the dialer before every call (lib/dialerScripts/service.ts): the
-- newest row for (state, product_code) whose effective_from has arrived is the wording the agent
-- must read. Any row written there is therefore live on its date, with no second pair of eyes.
--
-- This migration adds a holding table in front of it. Staff propose wording here; a DIFFERENT
-- admin approves it (or, when no other eligible admin is active, its author with a written
-- attestation), and only the approval writes into state_disclosures, in one transaction. The
-- dialer, its read, and confirm_call_disclosure are untouched, and no existing row is changed.
--
-- Nothing here writes disclosure wording. The table starts empty.

create table if not exists public.state_disclosure_proposals (
  id uuid primary key default gen_random_uuid(),
  product_code text not null check (product_code ~ '^[a-z0-9_]{1,80}$'),
  states text[] not null check (
    cardinality(states) between 1 and 51
    and array_to_string(states, ',') ~ '^[A-Z]{2}(,[A-Z]{2})*$'
  ),
  required_text text not null check (char_length(btrim(required_text)) between 1 and 8000),
  effective_from date not null,
  note text check (note is null or char_length(note) <= 2000),
  source text not null default 'editor' check (source in ('editor', 'import')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  -- Admins are deactivated rather than deleted, but a delete must not be blocked by history.
  proposed_by uuid references public.admin_users(id) on delete set null,
  proposed_at timestamptz not null default now(),
  reviewed_by uuid references public.admin_users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 2000),
  published_ids uuid[] not null default '{}',
  -- Written by an author who approved their own proposal because no other active admin could
  -- (see approve_state_disclosure_proposal). Null for every ordinary, second-admin approval.
  self_approval_attestation text check (
    self_approval_attestation is null or char_length(btrim(self_approval_attestation)) between 10 and 500
  ),
  constraint state_disclosure_proposals_review_shape check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null)
    or (status <> 'pending' and reviewed_at is not null)
  ),
  -- Four eyes: whoever proposed the wording cannot be the one who approves it, unless they were the
  -- only eligible admin and left a written attestation.
  constraint state_disclosure_proposals_four_eyes check (
    status <> 'approved'
    or proposed_by is null
    or reviewed_by is distinct from proposed_by
    or self_approval_attestation is not null
  )
);

create index if not exists state_disclosure_proposals_status_idx
  on public.state_disclosure_proposals (status, proposed_at desc);
create index if not exists state_disclosure_proposals_product_idx
  on public.state_disclosure_proposals (product_code, effective_from);
create index if not exists state_disclosure_proposals_proposed_by_idx
  on public.state_disclosure_proposals (proposed_by);
create index if not exists state_disclosure_proposals_reviewed_by_idx
  on public.state_disclosure_proposals (reviewed_by);

alter table public.state_disclosure_proposals enable row level security;

-- Staff-console data only: no tenant ever reads a proposal, so there is no tenant_app policy and
-- no grant beyond service_role. No DELETE either: a proposal is part of the record.
revoke all on public.state_disclosure_proposals from anon, authenticated, public, tenant_app;
grant select, insert, update on public.state_disclosure_proposals to service_role;

-- Approve one pending proposal and publish it, atomically.
--
-- Refuses (and writes nothing) when: the proposal is not pending; the reviewer is not an active
-- admin; the reviewer is the proposer while another active super_admin or platform_config admin
-- exists; the effective date is not in the future (UTC), so a new version can never cover a call
-- already placed today; the text still carries the seed's placeholder marker; or a version for the
-- same state, product and date already exists (the unique key would otherwise turn this into an
-- overwrite of wording that may already be on record).
--
-- Self-approval: a platform with a single eligible admin must not be locked out of ever publishing.
-- When no OTHER active super_admin / platform_config admin exists, the proposer may approve their
-- own proposal, but only with a 10-500 character written attestation, stored on the proposal.
create or replace function public.approve_state_disclosure_proposal(
  p_proposal_id uuid,
  p_reviewer uuid,
  p_review_note text default null,
  p_attestation text default null
)
returns public.state_disclosure_proposals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.state_disclosure_proposals;
  v_today date := (now() at time zone 'utc')::date;
  v_conflicts text;
  v_ids uuid[];
  v_attestation text := nullif(btrim(coalesce(p_attestation, '')), '');
  v_self boolean;
begin
  select * into v_row from public.state_disclosure_proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'PROPOSAL_NOT_FOUND';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'PROPOSAL_NOT_PENDING';
  end if;
  if p_reviewer is null
     or not exists (select 1 from public.admin_users a where a.id = p_reviewer and a.is_active) then
    raise exception 'REVIEWER_NOT_ACTIVE';
  end if;
  v_self := v_row.proposed_by is not null and v_row.proposed_by = p_reviewer;
  if v_self then
    if exists (
      select 1 from public.admin_users a
       where a.id <> p_reviewer
         and a.is_active
         and a.role::text in ('super_admin', 'platform_config')
    ) then
      raise exception 'REVIEWER_IS_PROPOSER';
    end if;
    if v_attestation is null or char_length(v_attestation) not between 10 and 500 then
      raise exception 'ATTESTATION_REQUIRED';
    end if;
  else
    -- Only a self-approval carries an attestation.
    v_attestation := null;
  end if;
  if v_row.effective_from <= v_today then
    raise exception 'EFFECTIVE_DATE_NOT_IN_FUTURE';
  end if;
  if ltrim(v_row.required_text) like '[PLACEHOLDER%' then
    raise exception 'PLACEHOLDER_TEXT';
  end if;

  select string_agg(d.state, ',' order by d.state) into v_conflicts
    from public.state_disclosures d
   where d.product_code = v_row.product_code
     and d.state = any (v_row.states)
     and d.effective_from = v_row.effective_from;
  if v_conflicts is not null then
    raise exception 'VERSION_EXISTS:%', v_conflicts;
  end if;

  with inserted as (
    insert into public.state_disclosures (state, product_code, required_text, effective_from)
    select distinct s, v_row.product_code, v_row.required_text, v_row.effective_from
      from unnest(v_row.states) as s
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_ids from inserted;

  update public.state_disclosure_proposals
     set status = 'approved',
         reviewed_by = p_reviewer,
         reviewed_at = now(),
         review_note = nullif(btrim(coalesce(p_review_note, '')), ''),
         published_ids = v_ids,
         self_approval_attestation = v_attestation
   where id = p_proposal_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.approve_state_disclosure_proposal(uuid, uuid, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.approve_state_disclosure_proposal(uuid, uuid, text, text) to service_role;

-- Whether this admin may approve their own proposals: true only when no OTHER active super_admin
-- or platform_config admin exists. The review screen asks this rather than deciding it itself.
create or replace function public.state_disclosure_self_approval_allowed(p_admin uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (
    select 1 from public.admin_users a
     where a.id <> p_admin
       and a.is_active
       and a.role::text in ('super_admin', 'platform_config')
  );
$$;

revoke all on function public.state_disclosure_self_approval_allowed(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.state_disclosure_self_approval_allowed(uuid) to service_role;

-- Assertions ----------------------------------------------------------------------------------------

do $$
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925507000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regclass('public.state_disclosure_proposals') is null then
    raise exception '20260925507000: state_disclosure_proposals is missing';
  end if;
  if not exists (
    select 1 from pg_class c where c.oid = 'public.state_disclosure_proposals'::regclass and c.relrowsecurity
  ) then
    raise exception '20260925507000: RLS is not enabled on state_disclosure_proposals';
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'state_disclosure_proposals_four_eyes'
       and conrelid = 'public.state_disclosure_proposals'::regclass
  ) then
    raise exception '20260925507000: the four-eyes constraint is missing';
  end if;
  if to_regprocedure('public.approve_state_disclosure_proposal(uuid, uuid, text, text)') is null then
    raise exception '20260925507000: approve_state_disclosure_proposal is missing';
  end if;
  if has_function_privilege('authenticated', 'public.approve_state_disclosure_proposal(uuid, uuid, text, text)', 'EXECUTE') then
    raise exception '20260925507000: approve_state_disclosure_proposal is executable by authenticated';
  end if;
  if to_regprocedure('public.state_disclosure_self_approval_allowed(uuid)') is null then
    raise exception '20260925507000: state_disclosure_self_approval_allowed is missing';
  end if;
  if pg_get_functiondef('public.approve_state_disclosure_proposal(uuid, uuid, text, text)'::regprocedure) !~ 'ATTESTATION_REQUIRED' then
    raise exception '20260925507000: self-approval does not require an attestation';
  end if;

  raise notice '20260925507000: disclosure wording now goes through a second admin before the dialer sees it';
end;
$$;

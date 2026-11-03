-- LA-4 bucket door, round 2 (2026-10-09) · New business files create policies.
--
-- A carrier's new-business file lists applications not issued yet ("Pending Issue", "Incomplete").
-- Each line becomes a snapshot like a policy file's, so the application is a policy in the book
-- from the day the carrier first reports it, and its issue is a change like any other (submitted →
-- active sets issued_on in policy_current).
--
-- One snapshot per policy per day stays the rule. An application that is issued shows up in both
-- files for a while; on the same day THE POLICY FILE WINS, whichever arrives first:
--   · a new-business file adds no snapshot for a policy the day's policy file already has;
--   · a policy file marks the day's new-business snapshot of the same policy superseded (kept,
--     with its file and row, like a reissued file's).
-- Reading the new-business file again rebuilds its own snapshots under the same rule.
--
-- replace_file_snapshots is otherwise exactly as in 20261008140000.
-- Rollback: re-run the replace_file_snapshots definition from 20261008140000 (new-business
-- snapshots already written stay, and are rebuilt by nothing).

create or replace function public.replace_file_snapshots(p_tenant_id uuid, p_file_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_file public.file_registry%rowtype;
  v_superseded boolean;
  v_changed integer;
  v_policies text[];
begin
  select * into v_file from public.file_registry where id = p_file_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'That file is not in this workspace.' using errcode = 'P0002'; end if;
  if v_file.file_type not in ('policies', 'new_business') or v_file.raw_extracted_at is null or v_file.carrier_id is null or v_file.file_date is null then
    raise exception 'Snapshots come from a policy or new-business file whose raw rows are sealed.' using errcode = 'P0001';
  end if;
  v_superseded := v_file.superseded_by_file_id is not null;

  -- A reissue: the replaced file's snapshots for that day stop being the current ones.
  update public.policy_snapshot s set superseded = true
   where s.tenant_id = p_tenant_id and s.carrier_id = v_file.carrier_id and s.snapshot_date = v_file.file_date and not s.superseded
     and s.file_id in (select f.id from public.file_registry f where f.tenant_id = p_tenant_id and f.carrier_id = v_file.carrier_id
                        and f.file_type = v_file.file_type and f.file_date = v_file.file_date and f.superseded_by_file_id is not null);

  -- The policy file wins the day: the same policies' new-business snapshots of that day step aside.
  if v_file.file_type = 'policies' and not v_superseded then
    update public.policy_snapshot s set superseded = true
     where s.tenant_id = p_tenant_id and s.carrier_id = v_file.carrier_id and s.snapshot_date = v_file.file_date and not s.superseded
       and s.file_id in (select f.id from public.file_registry f where f.tenant_id = p_tenant_id and f.carrier_id = v_file.carrier_id
                          and f.file_type = 'new_business' and f.file_date = v_file.file_date)
       and s.policy_number in (select r.policy_number from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(policy_number text));
  end if;

  create temp table if not exists pg_temp.la46_old (policy_number text, content_hash text) on commit drop;
  truncate pg_temp.la46_old;
  insert into pg_temp.la46_old select policy_number, content_hash from public.policy_snapshot where file_id = p_file_id;
  delete from public.policy_snapshot where file_id = p_file_id;

  insert into public.policy_snapshot (tenant_id, agency_id, carrier_id, policy_number, snapshot_date, file_id, raw_row_id,
    carrier_status_raw, status_normalized, paid_to_date, effective_date, issue_date, application_date, termination_date,
    premium_cents, premium_mode, payment_method, face_amount_cents, product_code, product_tier, agent_identifier, extra, superseded, content_hash)
  select p_tenant_id, v_file.agency_id, v_file.carrier_id, r.policy_number, v_file.file_date, p_file_id, r.raw_row_id,
    r.carrier_status_raw, r.status_normalized, r.paid_to_date, r.effective_date, r.issue_date, r.application_date, r.termination_date,
    r.premium_cents, r.premium_mode, r.payment_method, r.face_amount_cents, r.product_code, r.product_tier, r.agent_identifier,
    coalesce(r.extra, '{}'::jsonb), v_superseded, r.content_hash
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
    policy_number text, raw_row_id uuid, carrier_status_raw text, status_normalized text, paid_to_date date, effective_date date,
    issue_date date, application_date date, termination_date date, premium_cents bigint, premium_mode text, payment_method text,
    face_amount_cents bigint, product_code text, product_tier text, agent_identifier text, extra jsonb, content_hash text)
  -- A new-business line adds nothing on a day the policy file already lists the policy.
  where v_file.file_type = 'policies' or v_superseded or not exists (
    select 1 from public.policy_snapshot s join public.file_registry f on f.id = s.file_id
     where s.tenant_id = p_tenant_id and s.carrier_id = v_file.carrier_id and s.policy_number = r.policy_number
       and s.snapshot_date = v_file.file_date and not s.superseded and f.file_type = 'policies');

  select count(*) into v_changed from (
    (select policy_number, content_hash from public.policy_snapshot where file_id = p_file_id except select * from pg_temp.la46_old)
    union all
    (select * from pg_temp.la46_old except select policy_number, content_hash from public.policy_snapshot where file_id = p_file_id)
  ) d;
  select coalesce(array_agg(distinct p), '{}') into v_policies from (
    select policy_number p from public.policy_snapshot where file_id = p_file_id union select policy_number from pg_temp.la46_old
  ) x;
  return jsonb_build_object('changed', v_changed, 'policies', to_jsonb(v_policies), 'carrier_id', v_file.carrier_id);
end;
$$;
revoke all on function public.replace_file_snapshots(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_file_snapshots(uuid, uuid, jsonb) to service_role;

-- ─── self-check ────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if position('''new_business''' in pg_get_functiondef('public.replace_file_snapshots(uuid, uuid, jsonb)'::regprocedure)) = 0 then
    raise exception '20261009140000: replace_file_snapshots still refuses new-business files';
  end if;
  if has_function_privilege('authenticated', 'public.replace_file_snapshots(uuid, uuid, jsonb)', 'execute') then
    raise exception '20261009140000: replace_file_snapshots is open to signed-in users';
  end if;
end $$;

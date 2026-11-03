-- Book of Business › Statements: importing a statement, and a person deciding its lines.
--
-- Both are one transaction each, because both write several tables and a half-written result is a
-- ledger that disagrees with its own source:
--
--   import_commission_statement        the statement, every line (verbatim), the exact-match
--                                      PROPOSALS the application computed (policy number + carrier;
--                                      lib/ledger/statementMatch.ts), and the carrier's remembered
--                                      column mapping. Nothing posts: a proposal is not a match
--                                      until a person accepts it.
--   decide_commission_statement_lines  a batch of accept / reject / match (by hand) / leave
--                                      unmatched, with the person recorded on each, and the
--                                      statement's review status recomputed.
--
-- Duplicate detection is the partial unique index from 20260924260000: a second import of the same
-- file for the same carrier and period raises unique_violation (23505), which the API answers with
-- a refusal naming the first import.
--
-- Called by the service role only, after the API has checked the caller. Security invoker: the
-- functions run with the service role's own rights, and every row they touch is pinned to
-- p_tenant_id. Requires 20260924260000.

create or replace function public.import_commission_statement(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_carrier_id uuid,
  p_period_start date,
  p_period_end date,
  p_original_filename text,
  p_file_sha256 text,
  p_headers jsonb,
  p_mapping jsonb,
  p_lines jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_statement_id uuid;
  v_count integer;
  v_foreign integer;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'The statement lines must be a list' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_lines);
  if v_count = 0 then
    raise exception 'The statement has no lines' using errcode = '22023';
  end if;
  if v_count > 10000 then
    raise exception 'A statement can hold at most 10,000 lines' using errcode = '22023';
  end if;
  if not exists (select 1 from public.carriers where id = p_carrier_id) then
    raise exception 'Choose a carrier from the carrier library' using errcode = '22023';
  end if;

  -- A proposal may only name a policy in this tenant's book.
  select count(*) into v_foreign
    from jsonb_array_elements(p_lines) e
   where nullif(e->>'proposed_policy_id', '') is not null
     and not exists (
       select 1 from public.tenant_policies p
        where p.id = (e->>'proposed_policy_id')::uuid and p.tenant_id = p_tenant_id
     );
  if v_foreign > 0 then
    raise exception 'A proposed match names a policy outside this workspace' using errcode = '22023';
  end if;

  insert into public.tenant_commission_statements (
    tenant_id, carrier_id, period_start, period_end, original_filename, file_sha256,
    headers, column_mapping, row_count, status, uploaded_by
  )
  values (
    p_tenant_id, p_carrier_id, p_period_start, p_period_end, btrim(p_original_filename), lower(p_file_sha256),
    coalesce(p_headers, '[]'::jsonb), coalesce(p_mapping, '{}'::jsonb), v_count,
    case when exists (select 1 from jsonb_array_elements(p_lines) e where nullif(e->>'parse_error', '') is null)
         then 'review' else 'reviewed' end,
    p_actor_user_id
  )
  returning id into v_statement_id;

  insert into public.tenant_commission_statement_lines (
    tenant_id, statement_id, line_number, raw, policy_number, insured_name, amount_cents, kind,
    line_date, parse_error, review_status
  )
  select
    p_tenant_id,
    v_statement_id,
    (e->>'line_number')::integer,
    coalesce(e->'raw', '{}'::jsonb),
    nullif(btrim(e->>'policy_number'), ''),
    nullif(btrim(e->>'insured_name'), ''),
    (e->>'amount_cents')::bigint,
    nullif(e->>'kind', ''),
    nullif(e->>'line_date', '')::date,
    nullif(e->>'parse_error', ''),
    case
      when nullif(e->>'parse_error', '') is not null then 'error'
      when nullif(e->>'proposed_policy_id', '') is not null then 'proposed'
      else 'unmatched'
    end
  from jsonb_array_elements(p_lines) e;

  insert into public.tenant_commission_statement_matches (tenant_id, line_id, policy_id, method, status)
  select p_tenant_id, l.id, (e->>'proposed_policy_id')::uuid, 'exact', 'proposed'
    from jsonb_array_elements(p_lines) e
    join public.tenant_commission_statement_lines l
      on l.statement_id = v_statement_id and l.line_number = (e->>'line_number')::integer
   where nullif(e->>'proposed_policy_id', '') is not null
     and nullif(e->>'parse_error', '') is null;

  insert into public.tenant_statement_column_mappings (tenant_id, carrier_id, mapping, updated_by, updated_at)
  values (p_tenant_id, p_carrier_id, coalesce(p_mapping, '{}'::jsonb), p_actor_user_id, now())
  on conflict (tenant_id, carrier_id)
  do update set mapping = excluded.mapping, updated_by = excluded.updated_by, updated_at = now();

  return v_statement_id;
end;
$$;

create or replace function public.decide_commission_statement_lines(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_statement_id uuid,
  p_decisions jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_statement public.tenant_commission_statements%rowtype;
  v_line public.tenant_commission_statement_lines%rowtype;
  v_match public.tenant_commission_statement_matches%rowtype;
  v_decision jsonb;
  v_action text;
  v_policy uuid;
  v_accepted integer := 0;
  v_rejected integer := 0;
  v_matched integer := 0;
  v_left integer := 0;
  v_status text;
  v_log jsonb := '[]'::jsonb;
begin
  if p_decisions is null or jsonb_typeof(p_decisions) <> 'array' or jsonb_array_length(p_decisions) = 0 then
    raise exception 'Choose at least one line' using errcode = '22023';
  end if;
  if jsonb_array_length(p_decisions) > 10000 then
    raise exception 'Too many lines in one decision' using errcode = '22023';
  end if;

  select * into v_statement
    from public.tenant_commission_statements
   where id = p_statement_id and tenant_id = p_tenant_id
   for update;
  if not found then
    raise exception 'That statement is not in this workspace' using errcode = 'P0002';
  end if;
  if v_statement.status = 'voided' then
    raise exception 'This statement was voided; its lines can no longer be matched' using errcode = '55000';
  end if;

  for v_decision in select value from jsonb_array_elements(p_decisions) loop
    v_action := v_decision->>'action';

    select * into v_line
      from public.tenant_commission_statement_lines
     where id = nullif(v_decision->>'line_id', '')::uuid
       and statement_id = p_statement_id
       and tenant_id = p_tenant_id
     for update;
    if not found then
      raise exception 'A line is not part of this statement' using errcode = '22023';
    end if;
    if v_line.review_status = 'error' then
      raise exception 'Row % could not be read, so it cannot be matched', v_line.line_number using errcode = '22023';
    end if;
    if v_line.review_status = 'accepted' then
      raise exception 'Row % is already accepted; void the statement to correct it', v_line.line_number using errcode = '55000';
    end if;

    v_match := null;
    v_policy := null;
    select * into v_match
      from public.tenant_commission_statement_matches
     where line_id = v_line.id and tenant_id = p_tenant_id and status = 'proposed'
     for update;

    if v_action = 'accept' then
      if v_match.id is null then
        raise exception 'Row % has no proposed match to accept', v_line.line_number using errcode = '22023';
      end if;
      update public.tenant_commission_statement_matches
         set status = 'accepted', accepted_by = p_actor_user_id, accepted_at = now()
       where id = v_match.id;
      update public.tenant_commission_statement_lines
         set review_status = 'accepted', reviewed_by = p_actor_user_id, reviewed_at = now()
       where id = v_line.id;
      v_accepted := v_accepted + 1;

    elsif v_action = 'reject' then
      if v_match.id is null then
        raise exception 'Row % has no proposed match to reject', v_line.line_number using errcode = '22023';
      end if;
      update public.tenant_commission_statement_matches
         set status = 'rejected', rejected_by = p_actor_user_id, rejected_at = now()
       where id = v_match.id;
      update public.tenant_commission_statement_lines
         set review_status = 'unmatched', reviewed_by = p_actor_user_id, reviewed_at = now()
       where id = v_line.id;
      v_rejected := v_rejected + 1;

    elsif v_action = 'match' then
      v_policy := nullif(v_decision->>'policy_id', '')::uuid;
      if v_policy is null or not exists (
        select 1 from public.tenant_policies where id = v_policy and tenant_id = p_tenant_id
      ) then
        raise exception 'Row %: choose a policy from this workspace''s book', v_line.line_number using errcode = '22023';
      end if;
      if v_match.id is not null and v_match.policy_id = v_policy then
        -- Choosing the proposed policy by hand is accepting the proposal.
        update public.tenant_commission_statement_matches
           set status = 'accepted', accepted_by = p_actor_user_id, accepted_at = now()
         where id = v_match.id;
      else
        if v_match.id is not null then
          update public.tenant_commission_statement_matches
             set status = 'rejected', rejected_by = p_actor_user_id, rejected_at = now()
           where id = v_match.id;
        end if;
        insert into public.tenant_commission_statement_matches (
          tenant_id, line_id, policy_id, method, status, proposed_by, proposed_at, accepted_by, accepted_at
        )
        values (p_tenant_id, v_line.id, v_policy, 'manual', 'accepted', p_actor_user_id, now(), p_actor_user_id, now());
      end if;
      update public.tenant_commission_statement_lines
         set review_status = 'accepted', reviewed_by = p_actor_user_id, reviewed_at = now()
       where id = v_line.id;
      v_matched := v_matched + 1;

    elsif v_action = 'leave_unmatched' then
      if v_match.id is not null then
        update public.tenant_commission_statement_matches
           set status = 'rejected', rejected_by = p_actor_user_id, rejected_at = now()
         where id = v_match.id;
      end if;
      update public.tenant_commission_statement_lines
         set review_status = 'left_unmatched', reviewed_by = p_actor_user_id, reviewed_at = now()
       where id = v_line.id;
      v_left := v_left + 1;

    else
      raise exception 'Unknown decision %', coalesce(v_action, '(none)') using errcode = '22023';
    end if;

    -- What was decided, line by line, for the caller's audit rows: the policy chosen (match), or
    -- the proposal accepted / rejected / set aside.
    v_log := v_log || jsonb_build_array(jsonb_build_object(
      'line_id', v_line.id,
      'line_number', v_line.line_number,
      'action', v_action,
      'policy_id', case when v_action = 'match' then v_policy else v_match.policy_id end,
      'proposed_policy_id', v_match.policy_id
    ));
  end loop;

  v_status := case
    when exists (
      select 1 from public.tenant_commission_statement_lines
       where statement_id = p_statement_id and review_status in ('proposed', 'unmatched')
    ) then 'review'
    else 'reviewed'
  end;
  update public.tenant_commission_statements set status = v_status where id = p_statement_id and status <> v_status;

  return jsonb_build_object(
    'accepted', v_accepted,
    'rejected', v_rejected,
    'matched', v_matched,
    'left_unmatched', v_left,
    'status', v_status,
    'lines', v_log
  );
end;
$$;

revoke all on function public.import_commission_statement(uuid, uuid, uuid, date, date, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.decide_commission_statement_lines(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_commission_statement(uuid, uuid, uuid, date, date, text, text, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.decide_commission_statement_lines(uuid, uuid, uuid, jsonb) to service_role;

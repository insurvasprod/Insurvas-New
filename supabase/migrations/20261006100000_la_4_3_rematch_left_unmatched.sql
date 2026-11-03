-- LA-4.3 · re-matching may include lines a person left unmatched, when they ask for it.
--
-- Until now rematch_commission_statement_lines only ever re-proposed lines still `unmatched`; a line
-- a person set aside on purpose (`left_unmatched`) was skipped. The person now chooses: "Re-match"
-- keeps that behaviour, and ticking "also the lines I left unmatched" re-proposes those too
-- (user decision 2026-10-06, option c). It is still only a proposal: a person accepts each match.
--
-- Leaving a line unmatched rejected its proposal (decide_commission_statement_lines), and the
-- caller never proposes a rejected (line, policy) pair again, so a set-aside line can only come back
-- with a DIFFERENT policy than the one already turned down.
--
-- The 3-argument function is replaced by one with a 4th argument defaulting to false, so a call
-- with three arguments behaves exactly as before. Dropping the old signature first keeps the call
-- unambiguous.
--
-- Rollback:
--   drop function if exists public.rematch_commission_statement_lines(uuid, uuid, jsonb, boolean);
--   then re-run the rematch_commission_statement_lines block of 20261002100000.

drop function if exists public.rematch_commission_statement_lines(uuid, uuid, jsonb);

create or replace function public.rematch_commission_statement_lines(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_proposals jsonb,
  p_include_left_unmatched boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_proposal jsonb;
  v_line public.tenant_commission_statement_lines%rowtype;
  v_policy uuid;
  v_written integer := 0;
  v_statements uuid[] := '{}';
  v_log jsonb := '[]'::jsonb;
begin
  if p_proposals is null or jsonb_typeof(p_proposals) <> 'array' then
    raise exception 'The proposals must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_proposals) > 10000 then
    raise exception 'Too many lines in one re-match' using errcode = '22023';
  end if;

  for v_proposal in select value from jsonb_array_elements(p_proposals) loop
    select l.* into v_line
      from public.tenant_commission_statement_lines l
      join public.tenant_commission_statements s on s.id = l.statement_id and s.tenant_id = l.tenant_id
     where l.id = nullif(v_proposal->>'line_id', '')::uuid
       and l.tenant_id = p_tenant_id
       and (l.review_status = 'unmatched' or (coalesce(p_include_left_unmatched, false) and l.review_status = 'left_unmatched'))
       and s.status <> 'voided'
     for update of l;
    -- A line someone decided in the meantime is skipped, not an error.
    if not found then
      continue;
    end if;
    v_policy := nullif(v_proposal->>'policy_id', '')::uuid;
    if v_policy is null or not exists (select 1 from public.tenant_policies where id = v_policy and tenant_id = p_tenant_id) then
      raise exception 'A proposed match names a policy outside this workspace' using errcode = '22023';
    end if;
    -- A pairing a person rejected is never proposed again, whatever the caller sends.
    if exists (
      select 1 from public.tenant_commission_statement_matches m
       where m.tenant_id = p_tenant_id and m.line_id = v_line.id and m.policy_id = v_policy and m.status = 'rejected'
    ) then
      continue;
    end if;

    insert into public.tenant_commission_statement_matches (tenant_id, line_id, policy_id, method, status, proposed_by)
    values (p_tenant_id, v_line.id, v_policy, case when v_proposal->>'method' = 'name' then 'name' else 'exact' end, 'proposed', p_actor_user_id);
    update public.tenant_commission_statement_lines set review_status = 'proposed' where id = v_line.id;

    v_written := v_written + 1;
    if not v_line.statement_id = any (v_statements) then
      v_statements := v_statements || v_line.statement_id;
    end if;
    v_log := v_log || jsonb_build_array(jsonb_build_object(
      'line_id', v_line.id, 'statement_id', v_line.statement_id, 'line_number', v_line.line_number,
      'policy_id', v_policy, 'method', coalesce(v_proposal->>'method', 'exact'), 'was', v_line.review_status));
  end loop;

  update public.tenant_commission_statements
     set status = 'review'
   where tenant_id = p_tenant_id and id = any (v_statements) and status = 'reviewed';

  return jsonb_build_object('proposed', v_written, 'statements', coalesce(array_length(v_statements, 1), 0), 'lines', v_log);
end;
$$;

revoke all on function public.rematch_commission_statement_lines(uuid, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.rematch_commission_statement_lines(uuid, uuid, jsonb, boolean) to service_role;

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'rematch_commission_statement_lines' and p.pronargs = 3) then
    raise exception '20261006100000: the 3-argument rematch_commission_statement_lines is still there';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'rematch_commission_statement_lines' and p.pronargs = 4 and p.pronargdefaults = 1) then
    raise exception '20261006100000: rematch_commission_statement_lines(uuid, uuid, jsonb, boolean default false) is missing';
  end if;
  if not has_function_privilege('service_role', 'public.rematch_commission_statement_lines(uuid, uuid, jsonb, boolean)', 'execute') then
    raise exception '20261006100000: service_role cannot run rematch_commission_statement_lines';
  end if;
  if has_function_privilege('anon', 'public.rematch_commission_statement_lines(uuid, uuid, jsonb, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.rematch_commission_statement_lines(uuid, uuid, jsonb, boolean)', 'execute') then
    raise exception '20261006100000: rematch_commission_statement_lines is executable by anon or authenticated';
  end if;
  if position('left_unmatched' in pg_get_functiondef('public.rematch_commission_statement_lines(uuid, uuid, jsonb, boolean)'::regprocedure)) = 0 then
    raise exception '20261006100000: rematch_commission_statement_lines does not know left_unmatched lines';
  end if;
end;
$$;

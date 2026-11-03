-- Settings › States & licences: one save, one statement.
--
-- 20260924110000 added licence type and lines, E&O per-claim and aggregate limits, and CE ethics
-- credits. The application wrote them in two steps: the LA-0.5 RPC for the original columns, then a
-- separate UPDATE for the new ones. A failure between the two left a licence saved with its old type,
-- or an E&O policy with its new expiry and its old limits — a half-save the screen reported as an
-- error while the first half stood.
--
-- These three functions write the whole record in one INSERT … ON CONFLICT. `p_details` carries only
-- the new fields the caller sent: a key that is absent keeps what is stored (a JSON null clears it),
-- which is the "undefined means keep" rule the API already had. The original RPCs are unchanged, so
-- anything still calling them keeps working.
--
-- lib/appointments/service.ts calls these first and falls back to the two-step path only when they
-- are missing (this file not applied yet).
--
-- Additive and idempotent. Requires 20260924110000 (the columns).

create or replace function public.save_license_with_details(
  p_tenant_id uuid,
  p_state text,
  p_license_number text,
  p_expires_at date,
  p_details jsonb default '{}'::jsonb
)
returns public.licenses
language plpgsql
security invoker
set search_path = public
as $$
declare
  v public.licenses;
  d jsonb := coalesce(p_details, '{}'::jsonb);
  v_lines text[] := case when d ? 'lines_of_authority' and jsonb_typeof(d->'lines_of_authority') = 'array'
                         then array(select jsonb_array_elements_text(d->'lines_of_authority')) else '{}'::text[] end;
begin
  insert into public.licenses as l (tenant_id, state, license_number, expires_at, licence_type, lines_of_authority)
  values (p_tenant_id, upper(trim(p_state)), trim(p_license_number), p_expires_at, d->>'licence_type', v_lines)
  on conflict (tenant_id, state) do update set
    license_number = excluded.license_number,
    expires_at = excluded.expires_at,
    licence_type = case when d ? 'licence_type' then excluded.licence_type else l.licence_type end,
    lines_of_authority = case when d ? 'lines_of_authority' then excluded.lines_of_authority else l.lines_of_authority end
  returning * into v;
  return v;
end;
$$;

create or replace function public.save_eo_policy_with_limits(
  p_tenant_id uuid,
  p_carrier text,
  p_policy_number text,
  p_expires_at date,
  p_coverage_amount_cents bigint,
  p_details jsonb default '{}'::jsonb
)
returns public.eo_policies
language plpgsql
security invoker
set search_path = public
as $$
declare
  v public.eo_policies;
  d jsonb := coalesce(p_details, '{}'::jsonb);
begin
  insert into public.eo_policies as e (tenant_id, carrier, policy_number, expires_at, coverage_amount_cents, per_claim_cents, aggregate_cents)
  values (p_tenant_id, trim(p_carrier), trim(p_policy_number), p_expires_at, p_coverage_amount_cents,
          (d->>'per_claim_cents')::bigint, (d->>'aggregate_cents')::bigint)
  on conflict (tenant_id, policy_number) do update set
    carrier = excluded.carrier,
    expires_at = excluded.expires_at,
    coverage_amount_cents = excluded.coverage_amount_cents,
    per_claim_cents = case when d ? 'per_claim_cents' then excluded.per_claim_cents else e.per_claim_cents end,
    aggregate_cents = case when d ? 'aggregate_cents' then excluded.aggregate_cents else e.aggregate_cents end
  returning * into v;
  return v;
end;
$$;

create or replace function public.save_ce_record_with_ethics(
  p_tenant_id uuid,
  p_state text,
  p_credits_required integer,
  p_credits_completed integer,
  p_deadline date,
  p_details jsonb default '{}'::jsonb
)
returns public.ce_records
language plpgsql
security invoker
set search_path = public
as $$
declare
  v public.ce_records;
  d jsonb := coalesce(p_details, '{}'::jsonb);
begin
  insert into public.ce_records as c (tenant_id, state, credits_required, credits_completed, deadline, ethics_required, ethics_completed)
  values (p_tenant_id, upper(trim(p_state)), p_credits_required, p_credits_completed, p_deadline,
          (d->>'ethics_required')::integer, (d->>'ethics_completed')::integer)
  on conflict (tenant_id, state) do update set
    credits_required = excluded.credits_required,
    credits_completed = excluded.credits_completed,
    deadline = excluded.deadline,
    ethics_required = case when d ? 'ethics_required' then excluded.ethics_required else c.ethics_required end,
    ethics_completed = case when d ? 'ethics_completed' then excluded.ethics_completed else c.ethics_completed end
  returning * into v;
  return v;
end;
$$;

revoke all on function public.save_license_with_details(uuid, text, text, date, jsonb) from public, anon, authenticated;
revoke all on function public.save_eo_policy_with_limits(uuid, text, text, date, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.save_ce_record_with_ethics(uuid, text, integer, integer, date, jsonb) from public, anon, authenticated;
grant execute on function public.save_license_with_details(uuid, text, text, date, jsonb) to service_role;
grant execute on function public.save_eo_policy_with_limits(uuid, text, text, date, bigint, jsonb) to service_role;
grant execute on function public.save_ce_record_with_ethics(uuid, text, integer, integer, date, jsonb) to service_role;

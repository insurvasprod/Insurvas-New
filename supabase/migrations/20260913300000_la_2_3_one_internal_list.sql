-- ---------------------------------------------------------------------------
-- LA-2.3 corrective · one store per concern
--
-- 20260913290000 created `tenant_suppression_list` with an `internal` list type, on the strength of
-- LA-2.3's page saying *"'Do not call' currently writes to no list"* and a grep of
-- lib/dispositions/service.ts that found nothing.
--
-- Both were wrong, and the grep is the instructive part: the logic is not in the service, it is in
-- the `complete_disposition` RPC, and the table is called `tenant_do_not_call` — a name that
-- contains neither "dnc" nor "suppress", which is what my search was looking for. LA-1.12 built it
-- and it holds 3 live rows:
--
--   if p_disposition_key = 'do_not_call' then
--     ...
--     insert into public.tenant_do_not_call (tenant_id, phone_digits, lead_id, added_by) ...
--
-- So the first half of criterion 3 — "'do not call' adds the number" — has been built since LA-1.12.
-- Shipping `tenant_suppression_list.internal` alongside it would have left two internal do-not-call
-- lists that disagree the first time anyone writes to the newer one, and the dialer would consult
-- whichever the author of the day remembered.
--
-- The split that actually earns two tables:
--
--   tenant_do_not_call        the tenant's OWN internal list. Already wired, already populated,
--                             written by the disposition path. Untouched here.
--
--   tenant_suppression_list   the four list types that table cannot express — tcpa_litigator,
--                             federal_dnc, state_dnc, invalid. Sourced from vendors, not from an
--                             agent's judgement.
--
-- `is_phone_suppressed` now reads BOTH, because a caller asking "may I dial this" must not get a
-- clear answer from one store while the other says no.
-- ---------------------------------------------------------------------------

-- ── retire the duplicate internal list ─────────────────────────────────────
--
-- The permanence trigger refuses deletes, including the two rows 20260913290000's own assertions
-- left behind. Dropping it for the length of this statement is the "it takes a migration" escape
-- hatch that trigger's error message describes, used here for exactly the reason it names.
drop trigger if exists tenant_suppression_list_permanent on public.tenant_suppression_list;

do $$
declare v_moved integer := 0;
begin
  -- Anything already filed as `internal` belongs in the real internal list. There should only be
  -- the self-check rows, but moving rather than deleting is the safe direction: this runs against
  -- a live database and a suppressed number silently dropped is the one mistake this whole task
  -- exists to prevent.
  insert into public.tenant_do_not_call (tenant_id, phone_digits, reason, added_by)
  select s.tenant_id, s.phone_digits, s.reason, s.added_by
    from public.tenant_suppression_list s
   where s.list_type = 'internal'
  on conflict do nothing;

  get diagnostics v_moved = row_count;
  delete from public.tenant_suppression_list where list_type = 'internal';
  raise notice 'moved % internal suppression row(s) into tenant_do_not_call', v_moved;
end $$;

alter table public.tenant_suppression_list drop constraint if exists tenant_suppression_list_list_type_check;
alter table public.tenant_suppression_list
  add constraint tenant_suppression_list_list_type_check
  check (list_type in ('tcpa_litigator', 'federal_dnc', 'state_dnc', 'invalid'));

create trigger tenant_suppression_list_permanent
  before delete or update of phone_digits, list_type, tenant_id on public.tenant_suppression_list
  for each row execute function public.prevent_suppression_removal();

-- ── suppress_phone routes `internal` to the list that already exists ───────
create or replace function public.suppress_phone(
  p_tenant_id uuid,
  p_phone text,
  p_list_type text,
  p_reason text,
  p_source text,
  p_added_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_digits text;
  v_id uuid;
begin
  v_digits := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if length(v_digits) = 11 and left(v_digits, 1) = '1' then
    v_digits := right(v_digits, 10);
  end if;
  if length(v_digits) <> 10 then
    raise exception 'not_a_us_phone: % could not be normalised to ten digits', p_phone
      using errcode = 'check_violation';
  end if;

  -- The tenant's own list has one home, and it is the one the disposition path already writes.
  if p_list_type = 'internal' then
    insert into tenant_do_not_call (tenant_id, phone_digits, reason, added_by)
    values (p_tenant_id, v_digits, p_reason, p_added_by)
    on conflict (tenant_id, phone_digits) where is_active
      do update set reason = tenant_do_not_call.reason, updated_at = now()
    returning id into v_id;
    return v_id;
  end if;

  insert into tenant_suppression_list (tenant_id, phone_digits, list_type, reason, source, added_by)
  values (p_tenant_id, v_digits, p_list_type, p_reason, p_source, p_added_by)
  on conflict (tenant_id, phone_digits, list_type) do update
    set reason = tenant_suppression_list.reason
  returning id into v_id;

  return v_id;
end;
$function$;

-- ── one answer, over both stores ───────────────────────────────────────────
create or replace function public.is_phone_suppressed(p_tenant_id uuid, p_phone text)
returns table(suppressed boolean, list_type text, reason text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_digits text;
begin
  v_digits := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if length(v_digits) = 11 and left(v_digits, 1) = '1' then
    v_digits := right(v_digits, 10);
  end if;

  return query
    select true, hit.list_type, hit.reason
      from (
        select s.list_type, s.reason
          from tenant_suppression_list s
         where s.tenant_id = p_tenant_id and s.phone_digits = v_digits
        union all
        select 'internal', d.reason
          from tenant_do_not_call d
         where d.tenant_id = p_tenant_id and d.phone_digits = v_digits and d.is_active
      ) hit
     -- Worst news first: a litigator hit is never overridable, so it must not be hidden behind an
     -- internal note that merely says somebody asked not to be called.
     order by case hit.list_type
                when 'tcpa_litigator' then 0
                when 'internal' then 1
                when 'federal_dnc' then 2
                when 'state_dnc' then 3
                else 4
              end
     limit 1;

  if not found then
    return query select false, null::text, null::text;
  end if;
end;
$function$;

revoke all on function public.is_phone_suppressed(uuid, text) from public, anon, authenticated;
grant execute on function public.is_phone_suppressed(uuid, text) to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_hit record;
begin
  select id into v_tenant from public.tenants order by created_at limit 1;
  if v_tenant is null then
    raise notice 'no tenant exists, so the reconciliation assertions were skipped';
    return;
  end if;

  -- There is exactly one internal list, and it is not this table.
  if exists (select 1 from public.tenant_suppression_list where list_type = 'internal') then
    raise exception 'an internal row survived in tenant_suppression_list';
  end if;

  -- An internal suppression goes to tenant_do_not_call and is still found.
  perform public.suppress_phone(v_tenant, '602-555-0177', 'internal', 'Reconciliation self-check', 'manual', null);
  if not exists (select 1 from public.tenant_do_not_call
                  where tenant_id = v_tenant and phone_digits = '6025550177' and is_active) then
    raise exception 'an internal suppression did not reach tenant_do_not_call';
  end if;

  select * into v_hit from public.is_phone_suppressed(v_tenant, '(602) 555-0177');
  if not v_hit.suppressed or v_hit.list_type <> 'internal' then
    raise exception 'the unified lookup missed a number in tenant_do_not_call (got %)', v_hit.list_type;
  end if;

  -- A litigator hit still outranks an internal one, now that they live in different tables.
  perform public.suppress_phone(v_tenant, '6025550177', 'tcpa_litigator', 'Known litigator', 'vendor', null);
  select * into v_hit from public.is_phone_suppressed(v_tenant, '6025550177');
  if v_hit.list_type <> 'tcpa_litigator' then
    raise exception 'a litigator hit was outranked by an internal one across the two tables (got %)', v_hit.list_type;
  end if;

  -- A number in neither store is clear.
  select * into v_hit from public.is_phone_suppressed(v_tenant, '6025558888');
  if v_hit.suppressed then
    raise exception 'a number in neither store reported as suppressed';
  end if;

  -- Clean up what can be cleaned: the do-not-call row deactivates, the litigator row is permanent
  -- by design and stays.
  update public.tenant_do_not_call set is_active = false
   where tenant_id = v_tenant and phone_digits = '6025550177' and reason = 'Reconciliation self-check';
end $$;

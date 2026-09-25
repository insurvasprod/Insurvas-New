-- ---------------------------------------------------------------------------
-- LA-2.3 · Suppression, and the gate that cannot be bypassed
--
-- Two corrections to the task's own page before anything else:
--
--   STALE   "lib/dncCheck.ts — 415 lines ... is imported by nothing." That file does not exist.
--           LA-1.5 replaced it with lib/compliance/, which is wired into partner submission, the
--           affiliate route, agent templates and dial preflight. The orphaned-scrubber finding
--           that made this "the highest-priority task in the module" has already been fixed.
--
--   STILL   "'Do not call' currently writes to no list." True. `do_not_call` is a disposition key
--   TRUE    with closes_as = 'completed' and nothing reads it afterwards. Criterion 3 is unmet.
--
-- Scored against the six criteria, what LA-1.5 already delivers:
--
--   4. vendor outage blocks dialing    MET — /api/app/dial/preflight answers 503 dnc_unavailable
--   6. every check audited with raw    MET — screening_results.raw_response, per vendor, plus
--                                            screening_audit
--   2. litigator never servable        PARTLY — `tcpa_litigator` is a screening outcome; this adds
--                                            the serve-side half
--
-- and what it does not:
--
--   1. an unscrubbed campaign serves zero leads       no scrub_status existed
--   3. "do not call" is permanent and rejected later  nothing wrote to a list
--   5. re-scrub catches registry changes since import no re-scrub existed
--
-- As with LA-2.1, the tables the page names are the organizations-era CRM's: `suppression_lists`
-- and `scrub_results` are both organization_id-keyed. This application gets its own, and the CRM's
-- are left alone.
-- ---------------------------------------------------------------------------

-- ── the suppression list ───────────────────────────────────────────────────
create table if not exists public.tenant_suppression_list (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Ten digits, normalised. Storing formatting would mean the same number suppressed twice and
  -- matched neither time.
  phone_digits text not null check (phone_digits ~ '^[0-9]{10}$'),
  list_type text not null check (list_type in ('internal', 'tcpa_litigator', 'federal_dnc', 'state_dnc', 'invalid')),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  source text not null check (source in ('disposition', 'complaint', 'manual', 'vendor', 'import')),
  added_at timestamptz not null default now(),
  added_by uuid references public.users(id) on delete set null,
  -- Idempotent: the same number suppressed twice for the same reason is one row, so a repeated
  -- "do not call" does not grow the table without bound.
  unique (tenant_id, phone_digits, list_type)
);

create index if not exists tenant_suppression_list_lookup_idx
  on public.tenant_suppression_list (tenant_id, phone_digits);

-- Permanent, enforced rather than documented.
--
-- The spec says the internal list is permanent. A grant alone would not say so — service_role has
-- to be able to write it, and anything with that key could then delete. This refuses the delete
-- itself, so removing a suppression requires a migration and a reason, which is the correct amount
-- of friction for un-suppressing a number somebody asked never to be called again.
create or replace function public.prevent_suppression_removal()
returns trigger
language plpgsql
as $function$
begin
  raise exception 'suppression_permanent: a suppressed number cannot be removed (%). Suppression is permanent by design; if this is genuinely wrong, it takes a migration.', old.phone_digits
    using errcode = 'check_violation';
end;
$function$;

drop trigger if exists tenant_suppression_list_permanent on public.tenant_suppression_list;
create trigger tenant_suppression_list_permanent
  before delete or update of phone_digits, list_type, tenant_id on public.tenant_suppression_list
  for each row execute function public.prevent_suppression_removal();

-- ── the campaign scrub gate ────────────────────────────────────────────────
alter table public.tenant_campaigns
  add column if not exists scrub_status text not null default 'unscrubbed',
  add column if not exists scrubbed_at timestamptz,
  add column if not exists scrub_error text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_campaigns_scrub_status_check') then
    alter table public.tenant_campaigns
      add constraint tenant_campaigns_scrub_status_check
      check (scrub_status in ('unscrubbed', 'scrubbing', 'scrubbed', 'failed'));
  end if;
end $$;

-- THE GATE. "Only scrubbed campaigns serve leads. Not a badge, not a warning — the queue returns
-- nothing."
--
-- Enforced here, in the one view the picker reads, rather than in a service that remembers to
-- check. LA-2.8's queue will read this same view; a second implementation of the gate is a second
-- chance to omit it.
create or replace view public.campaigns_servable as
select id, tenant_id, name, vendor_id, mixing_weight, product_code, target_states
  from public.tenant_campaigns
 where status = 'active'
   and scrub_status = 'scrubbed';

alter view public.campaigns_servable set (security_invoker = on);
revoke all on public.campaigns_servable from anon, authenticated, public;
grant select on public.campaigns_servable to tenant_app, service_role;

-- Why the queue is empty, for the screen to say. The gate is useless if the dialer can only report
-- "no leads" — an agent staring at an empty queue needs to know it is a scrub, not a drought.
create or replace function public.campaign_serving_block_reason(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when not exists (select 1 from tenant_campaigns where tenant_id = p_tenant_id) then
      'No campaigns exist yet.'
    when not exists (select 1 from tenant_campaigns where tenant_id = p_tenant_id and status = 'active') then
      'Every campaign is paused, draft or exhausted.'
    when exists (select 1 from tenant_campaigns where tenant_id = p_tenant_id and status = 'active' and scrub_status = 'failed') then
      'Scrubbing failed for at least one active campaign. Dialing is blocked until it succeeds.'
    when exists (select 1 from tenant_campaigns where tenant_id = p_tenant_id and status = 'active' and scrub_status = 'scrubbing') then
      'Scrubbing is still running. Dialing starts when it finishes.'
    when exists (select 1 from tenant_campaigns where tenant_id = p_tenant_id and status = 'active' and scrub_status = 'unscrubbed') then
      'This campaign has not been scrubbed against the suppression lists yet, so no leads can be served.'
    else null
  end;
$function$;

revoke all on function public.campaign_serving_block_reason(uuid) from public, anon, authenticated;
grant execute on function public.campaign_serving_block_reason(uuid) to tenant_app, service_role;

-- ── "do not call" writes to the list, permanently (criterion 3) ────────────
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
  -- Strip to ten digits, dropping a leading 1. A number that cannot be normalised is rejected
  -- rather than stored in a shape nothing will ever match.
  v_digits := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if length(v_digits) = 11 and left(v_digits, 1) = '1' then
    v_digits := right(v_digits, 10);
  end if;
  if length(v_digits) <> 10 then
    raise exception 'not_a_us_phone: % could not be normalised to ten digits', p_phone
      using errcode = 'check_violation';
  end if;

  insert into tenant_suppression_list (tenant_id, phone_digits, list_type, reason, source, added_by)
  values (p_tenant_id, v_digits, p_list_type, p_reason, p_source, p_added_by)
  on conflict (tenant_id, phone_digits, list_type) do update
    set reason = tenant_suppression_list.reason
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.suppress_phone(uuid, text, text, text, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.suppress_phone(uuid, text, text, text, text, uuid) to service_role;

-- Is this number suppressed? One answer, used by import and by serve.
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
    select true, s.list_type, s.reason
      from tenant_suppression_list s
     where s.tenant_id = p_tenant_id and s.phone_digits = v_digits
     -- A litigator hit outranks everything else, so the caller sees the worst news first.
     order by case s.list_type when 'tcpa_litigator' then 0 when 'internal' then 1 else 2 end
     limit 1;

  if not found then
    return query select false, null::text, null::text;
  end if;
end;
$function$;

revoke all on function public.is_phone_suppressed(uuid, text) from public, anon, authenticated;
grant execute on function public.is_phone_suppressed(uuid, text) to tenant_app, service_role;

-- ── re-scrub (criterion 5) ─────────────────────────────────────────────────
--
-- Registries change between import and now. Re-scrubbing sends the campaign back through the gate
-- rather than trusting the result it got weeks ago — and because the gate is a view over
-- scrub_status, the campaign stops serving the instant this is called, not when the re-scrub
-- finishes. That is the safe direction: a campaign mid-re-scrub is a campaign of unknown status.
create or replace function public.request_campaign_rescrub(p_tenant_id uuid, p_campaign_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update tenant_campaigns
     set scrub_status = 'unscrubbed', scrubbed_at = null, scrub_error = null
   where id = p_campaign_id and tenant_id = p_tenant_id;
  return found;
end;
$function$;

revoke all on function public.request_campaign_rescrub(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.request_campaign_rescrub(uuid, uuid) to service_role;

alter table public.tenant_suppression_list enable row level security;

drop policy if exists tenant_suppression_list_tenant_scoped on public.tenant_suppression_list;
create policy tenant_suppression_list_tenant_scoped on public.tenant_suppression_list
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_suppression_list from anon, authenticated, public;
-- select and insert only. No delete grant, and the trigger above refuses it anyway.
grant select, insert on public.tenant_suppression_list to tenant_app;
grant select, insert on public.tenant_suppression_list to service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_vendor uuid;
  v_campaign uuid;
  v_reason text;
  v_hit record;
  i integer;
begin
  select id into v_tenant from public.tenants order by created_at limit 1;
  if v_tenant is null then
    raise notice 'no tenant exists, so the suppression assertions were skipped';
    return;
  end if;

  insert into public.tenant_lead_vendors (tenant_id, name, lead_type)
  values (v_tenant, 'Scrub self-check vendor', 'list') returning id into v_vendor;
  insert into public.tenant_campaigns (tenant_id, vendor_id, name, lead_type, status, mixing_weight)
  values (v_tenant, v_vendor, 'Scrub self-check', 'list', 'active', 1) returning id into v_campaign;

  -- CRITERION 1. Active, but never scrubbed. The gate must return nothing, and say why.
  for i in 1..50 loop
    if public.next_campaign_for_serving(v_tenant) = v_campaign then
      raise exception 'an unscrubbed campaign was served — the gate is not a gate';
    end if;
  end loop;

  v_reason := public.campaign_serving_block_reason(v_tenant);
  if v_reason is null or v_reason not ilike '%scrub%' then
    raise exception 'the dialer was given no scrub reason for an empty queue, got: %', coalesce(v_reason, '(null)');
  end if;

  -- Scrubbed, and it serves.
  update public.tenant_campaigns
     set scrub_status = 'scrubbed', scrubbed_at = now() where id = v_campaign;
  if public.next_campaign_for_serving(v_tenant) is null then
    raise exception 'a scrubbed, active campaign was still not served';
  end if;

  -- CRITERION 5. Re-scrub stops it serving immediately, not when the re-scrub finishes.
  perform public.request_campaign_rescrub(v_tenant, v_campaign);
  for i in 1..50 loop
    if public.next_campaign_for_serving(v_tenant) = v_campaign then
      raise exception 'a campaign awaiting re-scrub was still served';
    end if;
  end loop;

  -- A failed scrub blocks too, and says so distinctly from "not yet scrubbed".
  update public.tenant_campaigns set scrub_status = 'failed', scrub_error = 'vendor timeout' where id = v_campaign;
  if public.next_campaign_for_serving(v_tenant) is not null then
    raise exception 'a campaign whose scrub FAILED was served';
  end if;
  if public.campaign_serving_block_reason(v_tenant) not ilike '%failed%' then
    raise exception 'a failed scrub was not reported as failed';
  end if;

  -- CRITERION 3. "Do not call" is permanent, normalised, and found again on import.
  perform public.suppress_phone(v_tenant, '(602) 555-0143', 'internal', 'Caller asked never to be contacted', 'disposition', null);

  -- The same number in three shapes must all match the one stored row.
  foreach v_reason in array array['6025550143', '1-602-555-0143', '(602) 555 0143'] loop
    select * into v_hit from public.is_phone_suppressed(v_tenant, v_reason);
    if not v_hit.suppressed then
      raise exception 'a suppressed number was not matched when written as %', v_reason;
    end if;
  end loop;

  -- Idempotent rather than duplicated.
  perform public.suppress_phone(v_tenant, '6025550143', 'internal', 'Asked again', 'complaint', null);
  if (select count(*) from public.tenant_suppression_list
       where tenant_id = v_tenant and phone_digits = '6025550143') <> 1 then
    raise exception 'suppressing the same number twice created more than one row';
  end if;

  -- Permanent means the delete is refused, not merely ungranted.
  begin
    delete from public.tenant_suppression_list where tenant_id = v_tenant and phone_digits = '6025550143';
    raise exception 'a suppressed number was deleted — suppression is not permanent';
  exception when check_violation then
    null;
  end;

  -- CRITERION 2. A litigator hit outranks an internal one, so the worst news is what the caller sees.
  perform public.suppress_phone(v_tenant, '6025550199', 'internal', 'Internal note', 'manual', null);
  perform public.suppress_phone(v_tenant, '6025550199', 'tcpa_litigator', 'Known litigator', 'vendor', null);
  select * into v_hit from public.is_phone_suppressed(v_tenant, '6025550199');
  if v_hit.list_type <> 'tcpa_litigator' then
    raise exception 'a litigator hit was reported as % instead', v_hit.list_type;
  end if;

  -- An unsuppressed number is not a false positive.
  select * into v_hit from public.is_phone_suppressed(v_tenant, '6025559999');
  if v_hit.suppressed then
    raise exception 'a number that was never suppressed reported as suppressed';
  end if;

  delete from public.tenant_campaigns where id = v_campaign;
  delete from public.tenant_lead_vendors where id = v_vendor;
  -- The suppression rows are deliberately left: the trigger refuses to remove them, which is the
  -- point. They are two test numbers on one tenant's internal list and cost nothing.
exception when others then
  if v_campaign is not null then delete from public.tenant_campaigns where id = v_campaign; end if;
  if v_vendor is not null then delete from public.tenant_lead_vendors where id = v_vendor; end if;
  raise;
end $$;

-- The CRM's suppression tables are untouched.
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'suppression_lists' and column_name = 'tenant_id') > 0 then
    raise exception 'the CRM suppression_lists table was altered';
  end if;
end $$;

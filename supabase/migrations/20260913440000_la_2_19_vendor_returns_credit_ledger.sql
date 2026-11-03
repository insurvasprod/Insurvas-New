-- ---------------------------------------------------------------------------
-- LA-2.19 · Vendor returns and credit ledger
--
-- A return is a prepared evidence package, not an automatic vendor submission. The claim is drafted
-- from scrub/disposition evidence, can be exported, and only a recorded vendor outcome changes the
-- campaign's credits. That keeps accounting honest while still making the one-click claim practical.
-- ---------------------------------------------------------------------------

create table if not exists public.lead_claims (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid not null references public.tenant_campaigns(id) on delete restrict,
  vendor_id uuid not null references public.tenant_lead_vendors(id) on delete restrict,
  reason text not null default 'mixed' check (reason in ('mixed', 'wrong_number', 'disconnected', 'dnc', 'tcpa_litigator', 'invalid_phone')),
  lead_count integer not null default 0 check (lead_count >= 0),
  amount_claimed_cents integer not null default 0 check (amount_claimed_cents >= 0),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'accepted', 'rejected', 'partial')),
  submitted_at timestamptz,
  resolved_at timestamptz,
  amount_credited_cents integer not null default 0 check (amount_credited_cents >= 0 and amount_credited_cents <= amount_claimed_cents),
  replacement_leads_count integer not null default 0 check (replacement_leads_count >= 0),
  rejection_reason text,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_claims_tenant_status_check check (status = 'draft' or submitted_at is not null),
  constraint lead_claims_resolved_status_check check (status not in ('accepted', 'rejected', 'partial') or resolved_at is not null),
  constraint lead_claims_rejection_reason_check check (status <> 'rejected' or nullif(btrim(coalesce(rejection_reason, '')), '') is not null),
  constraint lead_claims_outcome_check check (
    (status in ('accepted', 'partial') and amount_credited_cents > 0)
    or status not in ('accepted', 'partial')
  )
);

create table if not exists public.lead_claim_items (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.lead_claims(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  reason text not null check (reason in ('wrong_number', 'disconnected', 'dnc', 'tcpa_litigator', 'invalid_phone')),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz not null default now(),
  unique (claim_id, lead_id)
);

create index if not exists lead_claims_scorecard_idx
  on public.lead_claims (tenant_id, campaign_id, status, created_at desc);
create index if not exists lead_claim_items_lead_idx
  on public.lead_claim_items (tenant_id, lead_id);

create or replace function public.enforce_lead_claim_tenant()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_campaign_tenant uuid;
  v_campaign_vendor uuid;
  v_vendor_tenant uuid;
begin
  select tenant_id, vendor_id into v_campaign_tenant, v_campaign_vendor
    from tenant_campaigns where id = new.campaign_id;
  select tenant_id into v_vendor_tenant from tenant_lead_vendors where id = new.vendor_id;
  if v_campaign_tenant is distinct from new.tenant_id or v_vendor_tenant is distinct from new.tenant_id
     or v_campaign_vendor is distinct from new.vendor_id then
    raise exception 'LEAD_CLAIM_TENANT_MISMATCH';
  end if;
  if tg_op = 'UPDATE' and (old.campaign_id is distinct from new.campaign_id or old.vendor_id is distinct from new.vendor_id) then
    raise exception 'LEAD_CLAIM_ATTRIBUTION_IMMUTABLE';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists lead_claims_tenant_guard on public.lead_claims;
create trigger lead_claims_tenant_guard
  before insert or update on public.lead_claims
  for each row execute function public.enforce_lead_claim_tenant();

create or replace function public.enforce_lead_claim_item_tenant()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_claim_tenant uuid;
  v_claim_campaign uuid;
  v_claim_vendor uuid;
  v_lead_tenant uuid;
  v_lead_campaign uuid;
  v_campaign_vendor uuid;
begin
  select tenant_id, campaign_id, vendor_id into v_claim_tenant, v_claim_campaign, v_claim_vendor
    from lead_claims where id = new.claim_id;
  select tenant_id, campaign_id into v_lead_tenant, v_lead_campaign
    from agent_leads where id = new.lead_id;
  select vendor_id into v_campaign_vendor from tenant_campaigns where id = v_claim_campaign;
  if v_claim_tenant is null or v_lead_tenant is distinct from new.tenant_id
     or v_claim_tenant is distinct from new.tenant_id
     or v_lead_campaign is distinct from v_claim_campaign
     or v_campaign_vendor is distinct from v_claim_vendor then
    raise exception 'LEAD_CLAIM_ITEM_TENANT_MISMATCH';
  end if;
  if tg_op = 'UPDATE' and (old.claim_id is distinct from new.claim_id or old.lead_id is distinct from new.lead_id or old.tenant_id is distinct from new.tenant_id) then
    raise exception 'LEAD_CLAIM_ITEM_ATTRIBUTION_IMMUTABLE';
  end if;
  return new;
end;
$function$;

drop trigger if exists lead_claim_items_tenant_guard on public.lead_claim_items;
create trigger lead_claim_items_tenant_guard
  before insert or update on public.lead_claim_items
  for each row execute function public.enforce_lead_claim_item_tenant();

create or replace function public.apply_lead_claim_credit_delta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_delta integer;
  v_campaign uuid;
begin
  if tg_op = 'INSERT' then
    v_delta := new.amount_credited_cents;
    v_campaign := new.campaign_id;
  elsif tg_op = 'UPDATE' then
    v_delta := new.amount_credited_cents - old.amount_credited_cents;
    v_campaign := new.campaign_id;
  else
    v_delta := -old.amount_credited_cents;
    v_campaign := old.campaign_id;
  end if;
  if v_delta <> 0 then
    update tenant_campaigns
       set credits_received_cents = credits_received_cents + v_delta,
           updated_at = now()
     where id = v_campaign and tenant_id = coalesce(new.tenant_id, old.tenant_id);
    if not found then raise exception 'LEAD_CLAIM_CAMPAIGN_NOT_FOUND'; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

drop trigger if exists lead_claims_credit_delta on public.lead_claims;
create trigger lead_claims_credit_delta
  after insert or update of amount_credited_cents or delete on public.lead_claims
  for each row execute function public.apply_lead_claim_credit_delta();

create or replace function public.enforce_lead_claim_status()
returns trigger
language plpgsql
as $function$
begin
  if tg_op = 'UPDATE' then
    if old.status in ('accepted', 'rejected', 'partial') then
      raise exception 'LEAD_CLAIM_OUTCOME_IMMUTABLE';
    end if;
    if old.status = 'draft' and new.status not in ('draft', 'submitted') then
      raise exception 'LEAD_CLAIM_MUST_BE_SUBMITTED_FIRST';
    end if;
    if old.status = 'submitted' and new.status not in ('submitted', 'accepted', 'rejected', 'partial') then
      raise exception 'LEAD_CLAIM_INVALID_STATUS_TRANSITION';
    end if;
  end if;
  if new.status = 'submitted' and new.submitted_at is null then new.submitted_at := now(); end if;
  if new.status in ('accepted', 'rejected', 'partial') and new.resolved_at is null then new.resolved_at := now(); end if;
  if new.status = 'rejected' and nullif(btrim(coalesce(new.rejection_reason, '')), '') is null then
    raise exception 'LEAD_CLAIM_REJECTION_REASON_REQUIRED';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists lead_claims_status_guard on public.lead_claims;
create trigger lead_claims_status_guard
  before update on public.lead_claims
  for each row execute function public.enforce_lead_claim_status();

create or replace function public.vendor_claimable_leads(
  p_tenant_id uuid,
  p_campaign_id uuid default null
)
returns table(
  lead_id uuid,
  campaign_id uuid,
  vendor_id uuid,
  campaign_name text,
  vendor_name text,
  lead_created_at timestamptz,
  reason text,
  source_type text,
  source_id uuid,
  evidence jsonb,
  claimable_until timestamptz,
  days_remaining integer,
  claimable boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with candidates as (
    select l.id as lead_id, l.campaign_id, c.vendor_id, c.name as campaign_name, v.name as vendor_name,
           l.created_at as lead_created_at,
            case coalesce(sr.outcome, l.screening_outcome) when 'dnc' then 'dnc' when 'tcpa_litigator' then 'tcpa_litigator' else 'invalid_phone' end as reason,
           'scrub'::text as source_type, l.screening_result_id as source_id,
           jsonb_build_object('source', 'scrub', 'lead_id', l.id, 'lead_created_at', l.created_at,
              'phone', coalesce(l.values->>'phone', l.values->>'phone_number', l.values->>'primary_phone'), 'state', l.values->>'state', 'screening_outcome', coalesce(sr.outcome, l.screening_outcome),
             'screening_result_id', l.screening_result_id, 'screening_checked_at', l.screening_checked_at,
             'screening_version', l.screening_version) as evidence,
           l.created_at + make_interval(days => v.return_window_days) as claimable_until,
           1 as priority
       from agent_leads l
       left join screening_results sr on sr.id = l.screening_result_id and sr.tenant_id = l.tenant_id
      join tenant_campaigns c on c.id = l.campaign_id and c.tenant_id = l.tenant_id
      join tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = l.tenant_id
     where l.tenant_id = p_tenant_id
       and (p_campaign_id is null or l.campaign_id = p_campaign_id)
       and coalesce(sr.outcome, l.screening_outcome) in ('dnc', 'tcpa_litigator', 'invalid_phone')
    union all
    select l.id, l.campaign_id, c.vendor_id, c.name, v.name, l.created_at,
           a.disposition, 'disposition', a.id,
           jsonb_build_object('source', 'disposition', 'lead_id', l.id, 'lead_created_at', l.created_at,
              'phone', coalesce(l.values->>'phone', l.values->>'phone_number', l.values->>'primary_phone'), 'state', l.values->>'state', 'disposition', a.disposition,
             'attempt_id', a.id, 'attempted_at', a.attempted_at, 'dial_clicked_at', a.dial_clicked_at,
             'attempt_number', a.attempt_number) as evidence,
           l.created_at + make_interval(days => v.return_window_days), 2
      from agent_leads l
      join tenant_campaigns c on c.id = l.campaign_id and c.tenant_id = l.tenant_id
      join tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = l.tenant_id
      join lateral (
        select a.* from tenant_call_attempts a
         where a.tenant_id = l.tenant_id and a.lead_id = l.id
           and a.disposition in ('wrong_number', 'disconnected')
         order by a.attempted_at desc, a.id desc limit 1
      ) a on true
     where l.tenant_id = p_tenant_id
       and (p_campaign_id is null or l.campaign_id = p_campaign_id)
  ),
  one_per_lead as (
    select distinct on (lead_id) * from candidates
     where not exists (
       select 1 from lead_claim_items i join lead_claims cl on cl.id = i.claim_id
        where i.tenant_id = p_tenant_id and i.lead_id = candidates.lead_id
     )
     order by lead_id, priority, claimable_until desc
  )
  select lead_id, campaign_id, vendor_id, campaign_name, vendor_name, lead_created_at, reason,
         source_type, source_id, evidence, claimable_until,
         greatest(0, floor(extract(epoch from (claimable_until - now())) / 86400))::integer as days_remaining,
         claimable_until > now() as claimable
    from one_per_lead
   order by claimable_until asc, lead_created_at asc;
$function$;

create or replace function public.create_vendor_return_claim(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_created_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_vendor uuid;
  v_claim uuid;
  v_rate numeric;
  v_lead_count integer;
  v_amount integer;
begin
  select vendor_id, total_spend_cents::numeric / nullif(records_purchased, 0)
    into v_vendor, v_rate from tenant_campaigns where id = p_campaign_id and tenant_id = p_tenant_id;
  if not found then raise exception 'LEAD_CLAIM_CAMPAIGN_NOT_FOUND'; end if;
  if v_rate is null then raise exception 'LEAD_CLAIM_CAMPAIGN_HAS_NO_UNIT_COST'; end if;

  select count(*)::integer, round(sum(v_rate))::integer
    into v_lead_count, v_amount
    from vendor_claimable_leads(p_tenant_id, p_campaign_id)
   where claimable;
  if v_lead_count = 0 then raise exception 'LEAD_CLAIM_NO_CLAIMABLE_LEADS'; end if;

  insert into lead_claims (tenant_id, campaign_id, vendor_id, reason, lead_count, amount_claimed_cents, created_by)
  select p_tenant_id, p_campaign_id, v_vendor,
         case when count(distinct reason) = 1 then min(reason) else 'mixed' end,
         v_lead_count, v_amount, p_created_by
    from vendor_claimable_leads(p_tenant_id, p_campaign_id)
   where claimable
  returning id into v_claim;

  insert into lead_claim_items (claim_id, tenant_id, lead_id, reason, evidence)
  select v_claim, p_tenant_id, lead_id, reason, evidence
    from vendor_claimable_leads(p_tenant_id, p_campaign_id)
   where claimable;
  return v_claim;
end;
$function$;

create or replace function public.vendor_returns_report(
  p_tenant_id uuid,
  p_campaign_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'claimable', coalesce((select jsonb_agg(to_jsonb(x) order by x.claimable_until, x.lead_created_at) from vendor_claimable_leads(p_tenant_id, p_campaign_id) x), '[]'::jsonb),
    'claims', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from lead_claims c where c.tenant_id = p_tenant_id and (p_campaign_id is null or c.campaign_id = p_campaign_id)), '[]'::jsonb)
  );
$function$;

create or replace function public.vendor_return_claim_detail(
  p_tenant_id uuid,
  p_claim_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'claim', to_jsonb(c),
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at, i.lead_id) from lead_claim_items i where i.claim_id = c.id and i.tenant_id = p_tenant_id), '[]'::jsonb)
  )
    from lead_claims c
   where c.id = p_claim_id and c.tenant_id = p_tenant_id;
$function$;

create or replace function public.update_vendor_return_claim(
  p_tenant_id uuid,
  p_claim_id uuid,
  p_action text,
  p_status text default null,
  p_amount_credited_cents integer default 0,
  p_replacement_leads_count integer default 0,
  p_rejection_reason text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_claim lead_claims;
begin
  select * into v_claim from lead_claims where id = p_claim_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'LEAD_CLAIM_NOT_FOUND'; end if;
  if p_action = 'submit' then
    if v_claim.status <> 'draft' then raise exception 'LEAD_CLAIM_NOT_DRAFT'; end if;
    update lead_claims set status = 'submitted', submitted_at = coalesce(submitted_at, now()), updated_at = now() where id = p_claim_id;
  elsif p_action = 'resolve' then
    if v_claim.status <> 'submitted' then raise exception 'LEAD_CLAIM_NOT_SUBMITTED'; end if;
    if p_status not in ('accepted', 'rejected', 'partial') then raise exception 'LEAD_CLAIM_INVALID_OUTCOME'; end if;
    if p_amount_credited_cents < 0 or p_amount_credited_cents > v_claim.amount_claimed_cents then raise exception 'LEAD_CLAIM_CREDIT_OUT_OF_RANGE'; end if;
    if p_status = 'accepted' and p_amount_credited_cents <> v_claim.amount_claimed_cents then raise exception 'LEAD_CLAIM_ACCEPTED_AMOUNT_MUST_MATCH'; end if;
    if p_status = 'rejected' and nullif(btrim(coalesce(p_rejection_reason, '')), '') is null then raise exception 'LEAD_CLAIM_REJECTION_REASON_REQUIRED'; end if;
    if p_status = 'partial' and (p_amount_credited_cents <= 0 or p_amount_credited_cents >= v_claim.amount_claimed_cents) then raise exception 'LEAD_CLAIM_PARTIAL_AMOUNT_REQUIRED'; end if;
    update lead_claims set status = p_status, amount_credited_cents = p_amount_credited_cents,
      replacement_leads_count = greatest(0, p_replacement_leads_count), rejection_reason = nullif(btrim(p_rejection_reason), ''),
      notes = nullif(btrim(p_notes), ''), resolved_at = now(), updated_at = now() where id = p_claim_id;
  else
    raise exception 'LEAD_CLAIM_UNKNOWN_ACTION';
  end if;
  return (select to_jsonb(c) from lead_claims c where c.id = p_claim_id);
end;
$function$;

create or replace function public.vendor_return_metrics(
  p_tenant_id uuid,
  p_from_date date default null,
  p_to_date date default null,
  p_vendor_id uuid default null,
  p_campaign_id uuid default null,
  p_product_code text default null
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with campaigns as (
    select c.id campaign_id, c.vendor_id, c.name campaign_name, v.name vendor_name
      from tenant_campaigns c join tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = c.tenant_id
     where c.tenant_id = p_tenant_id and (p_vendor_id is null or c.vendor_id = p_vendor_id)
       and (p_campaign_id is null or c.id = p_campaign_id)
       and (p_product_code is null or c.product_code = p_product_code or exists (select 1 from agent_leads lp where lp.tenant_id = p_tenant_id and lp.campaign_id = c.id and lp.product_line = p_product_code))
  ),
  lead_stats as (
    select c.campaign_id,
      count(distinct l.id)::integer as total_leads,
       count(distinct l.id) filter (where coalesce(sr.outcome, l.screening_outcome) in ('dnc', 'tcpa_litigator', 'invalid_phone') or exists (select 1 from tenant_call_attempts a where a.tenant_id = l.tenant_id and a.lead_id = l.id and a.disposition in ('wrong_number', 'disconnected')))::integer as undialable_leads
       from campaigns c left join agent_leads l on l.tenant_id = p_tenant_id and l.campaign_id = c.campaign_id
       and (p_from_date is null or l.created_at >= p_from_date::timestamptz)
       and (p_to_date is null or l.created_at < (p_to_date + 1)::timestamptz)
       and (p_product_code is null or l.product_line = p_product_code)
       left join screening_results sr on sr.id = l.screening_result_id and sr.tenant_id = l.tenant_id
     group by c.campaign_id
  ),
  claim_stats as (
    select c.campaign_id,
      count(distinct c.id) filter (where c.status <> 'draft')::integer as claim_count,
      coalesce(sum(c.amount_claimed_cents) filter (where c.status <> 'draft'), 0)::integer as amount_claimed_cents,
      coalesce(sum(c.amount_credited_cents) filter (where c.status in ('accepted', 'partial')), 0)::integer as amount_credited_cents
      from lead_claims c
      join campaigns cp on cp.campaign_id = c.campaign_id
     where c.tenant_id = p_tenant_id and (p_vendor_id is null or c.vendor_id = p_vendor_id)
       and (p_campaign_id is null or c.campaign_id = p_campaign_id)
       and (p_from_date is null or c.created_at >= p_from_date::timestamptz)
       and (p_to_date is null or c.created_at < (p_to_date + 1)::timestamptz)
     group by c.campaign_id
  )
  select jsonb_build_object(
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'campaign_id', c.campaign_id, 'vendor_id', c.vendor_id, 'campaign_name', c.campaign_name, 'vendor_name', c.vendor_name,
      'undialable_leads', coalesce(s.undialable_leads, 0),
      'undialable_rate_percent', round(100.0 * coalesce(s.undialable_leads, 0) / nullif(s.total_leads, 0), 2),
      'claim_count', coalesce(k.claim_count, 0), 'amount_claimed_cents', coalesce(k.amount_claimed_cents, 0),
      'amount_credited_cents', coalesce(k.amount_credited_cents, 0),
      'claim_acceptance_rate_percent', round(100.0 * coalesce(k.amount_credited_cents, 0) / nullif(k.amount_claimed_cents, 0), 2)
    ) order by c.vendor_name, c.campaign_name), '[]'::jsonb)
  )
    from campaigns c left join lead_stats s on s.campaign_id = c.campaign_id
    left join claim_stats k on k.campaign_id = c.campaign_id;
$function$;

revoke all on public.lead_claims from anon, authenticated, public;
revoke all on public.lead_claim_items from anon, authenticated, public;
grant select, insert, update on public.lead_claims to service_role;
grant select, insert on public.lead_claim_items to service_role;
alter table public.lead_claims enable row level security;
alter table public.lead_claim_items enable row level security;

revoke all on function public.vendor_claimable_leads(uuid, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.create_vendor_return_claim(uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.vendor_returns_report(uuid, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.vendor_return_claim_detail(uuid, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.update_vendor_return_claim(uuid, uuid, text, text, integer, integer, text, text) from public, anon, authenticated, tenant_app;
revoke all on function public.vendor_return_metrics(uuid, date, date, uuid, uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.vendor_claimable_leads(uuid, uuid) to service_role;
grant execute on function public.create_vendor_return_claim(uuid, uuid, uuid) to service_role;
grant execute on function public.vendor_returns_report(uuid, uuid) to service_role;
grant execute on function public.vendor_return_claim_detail(uuid, uuid) to service_role;
grant execute on function public.update_vendor_return_claim(uuid, uuid, text, text, integer, integer, text, text) to service_role;
grant execute on function public.vendor_return_metrics(uuid, date, date, uuid, uuid, text) to service_role;

do $$
begin
  if to_regclass('public.lead_claims') is null or to_regclass('public.lead_claim_items') is null then
    raise exception 'LA-2.19 claim ledger tables did not land';
  end if;
end $$;

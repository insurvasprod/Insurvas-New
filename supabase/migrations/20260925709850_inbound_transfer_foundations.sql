-- Inbound transfers, part 1 of 4: the columns and helpers the other three files build on.
--
--   LA-1.10-2   The inbox row's age. Partner forms collect date_of_birth, not age, so every partner
--               lead showed an age of "—". lead_values_age() reads values.age when a form recorded
--               one (Design 1's intake now derives it for new submissions) and otherwise works it out
--               from the date of birth, for every lead already in the queue.
--   LA-1.10-8   A dropped call can go back in the queue (requeued_at, requeue_count) and
--   LA-1.11-6   a re-claim resumes the same verification session (file 709860).
--   LA-1.14-9   A buffer who stays on the call after the handoff ends that involvement on its own
--               (buffer_ended_at), which is a different act from giving the transfer back.
--   LA-1.14-10  A caller who asked for another language: language_key(), lead_language_key() and
--               agent_speaks_language() are the one reading of "who can take this call".
--   LA-1.13-2   deal_flow.buffer_agent, and initial_quote composed from carrier, face and premium.
--   LA-1.12-10  tenant_lead_stage_events accepts 'inbound' as a source. Restated from the live
--               definition and including 'dialer', which Design 3's 20260925711300 adds, so the two
--               files can be applied in either order.

-- ── columns ─────────────────────────────────────────────────────────────────
alter table public.lead_queue
  add column if not exists buffer_ended_at timestamptz,
  add column if not exists requeued_at timestamptz,
  add column if not exists requeue_count integer not null default 0;

alter table public.deal_flow
  add column if not exists buffer_agent uuid references public.users(id) on delete set null;

create index if not exists deal_flow_buffer_agent_idx
  on public.deal_flow (tenant_id, buffer_agent) where buffer_agent is not null;

-- ── stage history sources ───────────────────────────────────────────────────
alter table public.tenant_lead_stage_events
  drop constraint if exists tenant_lead_stage_events_source_check,
  add constraint tenant_lead_stage_events_source_check
    check (source = any (array['board', 'table', 'list', 'lead_detail', 'owner_fix', 'dialer', 'inbound'])) not valid;
alter table public.tenant_lead_stage_events validate constraint tenant_lead_stage_events_source_check;

-- ── age ─────────────────────────────────────────────────────────────────────
-- Whole years on p_on. Accepts YYYY-MM-DD (the date field's stored form, optionally with a time)
-- and MM/DD/YYYY. Anything else, a date in the future, or past 130 years reads as unknown (null),
-- never as an error that would take the whole inbox down.
create or replace function public.lead_values_age(p_values jsonb, p_on date default current_date)
returns text
language plpgsql
stable
set search_path = pg_catalog
as $function$
declare
  v_raw text;
  v_dob date;
  v_years integer;
begin
  if p_values is null or jsonb_typeof(p_values) <> 'object' then return null; end if;
  v_raw := nullif(btrim(coalesce(p_values->>'age', '')), '');
  if v_raw is not null then return v_raw; end if;
  v_raw := nullif(btrim(coalesce(p_values->>'date_of_birth', p_values->>'dob', p_values->>'birth_date', '')), '');
  if v_raw is null then return null; end if;
  begin
    if v_raw ~ '^\d{4}-\d{2}-\d{2}' then
      v_dob := make_date(substr(v_raw, 1, 4)::integer, substr(v_raw, 6, 2)::integer, substr(v_raw, 9, 2)::integer);
    elsif v_raw ~ '^\d{1,2}/\d{1,2}/\d{4}$' then
      v_dob := make_date(split_part(v_raw, '/', 3)::integer, split_part(v_raw, '/', 1)::integer, split_part(v_raw, '/', 2)::integer);
    else
      return null;
    end if;
  exception when others then
    return null;
  end;
  if v_dob > p_on then return null; end if;
  v_years := extract(year from age(p_on, v_dob))::integer;
  if v_years > 130 then return null; end if;
  return v_years::text;
end;
$function$;

-- ── language ────────────────────────────────────────────────────────────────
-- One spelling for a language, whichever way it was written: 'Spanish', 'spanish', 'es', 'es-MX'
-- all read 'spanish'. The same code list the Agent Floor uses. Null when nothing is recorded.
create or replace function public.language_key(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select case
    when s.v is null or s.v = '' then null
    when s.v ~ '^[a-z]{2,3}([-_][a-z0-9]{2,8})?$' then coalesce((
      select m.name
        from (values ('es', 'spanish'), ('en', 'english'), ('fr', 'french'), ('pt', 'portuguese'), ('zh', 'chinese'),
                     ('vi', 'vietnamese'), ('ko', 'korean'), ('tl', 'tagalog'), ('ar', 'arabic'), ('ru', 'russian'),
                     ('ht', 'haitian creole')) as m(code, name)
       where m.code = split_part(split_part(s.v, '-', 1), '_', 1)
    ), s.v)
    else s.v
  end
  from (select lower(btrim(p_value)) as v) s
$function$;

-- The language the caller asked for, from the lead's own values. English, or nothing recorded,
-- needs no pairing and reads as null.
create or replace function public.lead_language_key(p_values jsonb)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $function$
  select nullif(public.language_key(coalesce(
    nullif(btrim(p_values->>'language'), ''),
    nullif(btrim(p_values->>'preferred_language'), ''),
    nullif(btrim(p_values->>'language_code'), '')
  )), 'english')
$function$;

-- Whether this member can take a call in that language. Everybody speaks English. Otherwise the
-- language must be on their capacity row (agent_capacity.languages, Settings > Team & access).
create or replace function public.agent_speaks_language(p_tenant_id uuid, p_user_id uuid, p_language_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  select p_language_key is null
      or p_language_key = 'english'
      or exists (
        select 1
          from public.agent_capacity c
          cross join lateral unnest(coalesce(c.languages, '{}'::text[])) as spoken(language)
         where c.tenant_id = p_tenant_id
           and c.user_id = p_user_id
           and public.language_key(spoken.language) = p_language_key
      )
$function$;

revoke all on function public.agent_speaks_language(uuid, uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.agent_speaks_language(uuid, uuid, text) to service_role;

-- ── the composed initial quote ──────────────────────────────────────────────
-- "Carrier · $25,000 face · $48.50/mo", from whichever of the three are known. Null when none is.
create or replace function public.compose_initial_quote(p_carrier text, p_face_amount_cents bigint, p_monthly_premium_cents bigint)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select nullif(concat_ws(' · ',
    nullif(btrim(p_carrier), ''),
    case when p_face_amount_cents is not null and p_face_amount_cents > 0
         then '$' || to_char(p_face_amount_cents / 100.0, 'FM999,999,999,990') || ' face' end,
    case when p_monthly_premium_cents is not null and p_monthly_premium_cents > 0
         then '$' || to_char(p_monthly_premium_cents / 100.0, 'FM999,999,990.00') || '/mo' end
  ), '')
$function$;

-- A cents amount from a lead value: template currency fields store integer cents.
create or replace function public.lead_value_cents(p_values jsonb, p_keys text[])
returns bigint
language sql
immutable
set search_path = pg_catalog
as $function$
  select (
    select round(btrim(p_values->>k)::numeric)::bigint
      from unnest(p_keys) with ordinality as keys(k, n)
     where coalesce(btrim(p_values->>k), '') ~ '^[0-9]+(\.[0-9]+)?$'
     order by n
     limit 1
  )
$function$;

-- The three parts come from the deal row itself (an agent recording the application), or, on a new
-- row that has none of them, from the partner's submission. A quote composed only from the
-- submission replaces the partner's own quote text only when it carries the price, so a face amount
-- alone never overwrites "$50.72/mo · 100k 20-yr term". On an edit, only a change to carrier, face
-- or premium recomposes it, so an agent who types their own initial quote keeps it. When nothing is
-- known the given text stays.
create or replace function public.deal_flow_compose_initial_quote()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_values jsonb;
  v_carrier text;
  v_face bigint;
  v_premium bigint;
  v_composed text;
begin
  if tg_op = 'UPDATE'
     and new.carrier is not distinct from old.carrier
     and new.face_amount_cents is not distinct from old.face_amount_cents
     and new.monthly_premium_cents is not distinct from old.monthly_premium_cents then
    return new;
  end if;
  v_composed := public.compose_initial_quote(new.carrier, new.face_amount_cents, new.monthly_premium_cents);
  if v_composed is null and tg_op = 'INSERT' then
    select l.values into v_values from public.agent_leads l where l.id = new.lead_id and l.tenant_id = new.tenant_id;
    if v_values is not null and jsonb_typeof(v_values) = 'object' then
      v_carrier := nullif(btrim(coalesce(v_values->>'carrier', v_values->>'quoted_carrier', v_values->>'preferred_carrier', '')), '');
      v_face := public.lead_value_cents(v_values, array['face_amount_cents', 'face_amount', 'coverage_amount']);
      v_premium := public.lead_value_cents(v_values, array['monthly_premium_cents', 'monthly_premium', 'quoted_premium', 'premium']);
      if v_premium is not null or nullif(btrim(coalesce(new.initial_quote, '')), '') is null then
        v_composed := public.compose_initial_quote(v_carrier, v_face, v_premium);
      end if;
    end if;
  end if;
  if v_composed is not null then new.initial_quote := left(v_composed, 1000); end if;
  return new;
end;
$function$;

revoke all on function public.lead_values_age(jsonb, date) from public, anon, authenticated;
revoke all on function public.language_key(text) from public, anon, authenticated;
revoke all on function public.lead_language_key(jsonb) from public, anon, authenticated;
revoke all on function public.compose_initial_quote(text, bigint, bigint) from public, anon, authenticated;
revoke all on function public.lead_value_cents(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.deal_flow_compose_initial_quote() from public, anon, authenticated, tenant_app;
grant execute on function public.lead_values_age(jsonb, date) to service_role, tenant_app;
grant execute on function public.language_key(text) to service_role, tenant_app;
grant execute on function public.lead_language_key(jsonb) to service_role, tenant_app;
grant execute on function public.compose_initial_quote(text, bigint, bigint) to service_role, tenant_app;
grant execute on function public.lead_value_cents(jsonb, text[]) to service_role, tenant_app;

drop trigger if exists deal_flow_compose_initial_quote on public.deal_flow;
create trigger deal_flow_compose_initial_quote
  before insert or update of carrier, face_amount_cents, monthly_premium_cents on public.deal_flow
  for each row execute function public.deal_flow_compose_initial_quote();

-- ── the inbox, with an age for every lead ───────────────────────────────────
-- Restated from the live definition (20260924250000). One change: the age column.
create or replace function public.list_transfer_inbox(p_tenant_id uuid, p_status text default 'unclaimed'::text, p_partner_id uuid default null::uuid, p_product_line text default null::text, p_state text default null::text, p_screening_outcome text default null::text, p_claimed_by uuid default null::uuid)
returns table(id uuid, lead_id uuid, partner_id uuid, partner_name text, product_line text, status text, owner_user_id uuid, owner_name text, claimed_at timestamp with time zone, queued_at timestamp with time zone, wait_seconds integer, customer text, age text, state text, screening_outcome text, screening_warning text, duplicate_warning boolean, preflight_status text, preflight_result jsonb)
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select newest.* from (
    select q.id as id, q.lead_id as lead_id, q.partner_id as partner_id, coalesce(p.name, 'Unassigned partner') as partner_name, q.product_line as product_line,
      q.status as status, coalesce(q.owner_user_id, q.claimed_by) as owner_user_id, u.name as owner_name, q.claimed_at as claimed_at, q.queued_at as queued_at,
      greatest(0, floor(extract(epoch from (now() - q.queued_at)))::integer) as wait_seconds,
      coalesce(nullif(btrim(l.values->>'full_name'), ''), nullif(btrim(l.values->>'name'), ''),
        nullif(btrim(concat_ws(' ', l.values->>'first_name', l.values->>'last_name')), ''), 'Unnamed customer') as customer,
      -- LA-1.10-2: the recorded age, else worked out from the date of birth.
      coalesce(public.lead_values_age(l.values), '—') as age,
      coalesce(nullif(btrim(l.values->>'state'), ''), nullif(btrim(l.values->>'state_code'), ''), nullif(btrim(l.values->>'primary_state'), ''), nullif(btrim(l.carrier_state), ''), '—') as state,
      coalesce(nullif(btrim(q.screening_outcome), ''), nullif(btrim(l.screening_outcome), ''), 'not_checked') as screening_outcome,
      coalesce(q.screening_warning, l.screening_warning) as screening_warning,
      coalesce((l.values->>'duplicate_warning')::boolean, false) as duplicate_warning, l.preflight_status as preflight_status, l.preflight_result as preflight_result
    from public.lead_queue q
    join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
    left join public.partners p on p.id = q.partner_id and p.tenant_id = q.tenant_id
    left join public.users u on u.id = coalesce(q.owner_user_id, q.claimed_by)
    where q.tenant_id = p_tenant_id
      -- Inbound transfers only: a dialer lead is served by the dialer, not claimed from the inbox.
      and q.partner_id is not null
      and (p_status = 'all'
        -- Everything still being worked: waiting, or with an agent. Terminal history is not.
        or (p_status = 'open' and q.status in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active'))
        -- "Claimed" in the inbox means with an agent, at whichever stage: a buffer assistant, a
        -- handoff in flight, or the licensed agent. Only the first of those is status 'claimed'.
        or (p_status = 'claimed' and q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active'))
        or q.status = p_status)
      and (p_partner_id is null or q.partner_id = p_partner_id)
      and (p_product_line is null or q.product_line = p_product_line)
      and (p_claimed_by is null or coalesce(q.owner_user_id, q.claimed_by) = p_claimed_by)
      and (p_state is null or coalesce(nullif(btrim(l.values->>'state'), ''), nullif(btrim(l.values->>'state_code'), ''), nullif(btrim(l.values->>'primary_state'), ''), nullif(btrim(l.carrier_state), '')) = p_state)
      and (p_screening_outcome is null or coalesce(q.screening_outcome, l.screening_outcome, 'not_checked') = p_screening_outcome)
    -- The newest 500, so a transfer that just arrived is never the one cut. The bundle's
    -- truncated flag reads this same 500.
    order by q.queued_at desc limit 500
  ) newest
  order by newest.queued_at asc
$function$;

revoke all on function public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid) to service_role;

-- ── backfills ───────────────────────────────────────────────────────────────
-- Guarded so the migration checker's role (no rights on these tables' new columns) skips them.
do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709850: backfills skipped, % cannot create in public', current_user;
    return;
  end if;
  -- A buffer on a finished transfer is not still on a call.
  update public.lead_queue
     set buffer_ended_at = coalesce(updated_at, now())
   where buffer_user_id is not null
     and buffer_ended_at is null
     and status not in ('buffer_active', 'handed_pending', 'la_active');
  -- The buffer assistant who took each transfer, from the work item that still names them.
  update public.deal_flow d
     set buffer_agent = q.buffer_user_id
    from public.lead_queue q
   where q.lead_id = d.lead_id
     and q.tenant_id = d.tenant_id
     and q.buffer_user_id is not null
     and d.buffer_agent is null
     and exists (select 1 from public.users u where u.id = q.buffer_user_id);
  -- Deals whose agent already recorded carrier, face or premium get the composed quote now.
  update public.deal_flow
     set initial_quote = left(public.compose_initial_quote(carrier, face_amount_cents, monthly_premium_cents), 1000)
   where public.compose_initial_quote(carrier, face_amount_cents, monthly_premium_cents) is not null
     and initial_quote is distinct from left(public.compose_initial_quote(carrier, face_amount_cents, monthly_premium_cents), 1000);
end $$;

-- ── assertions ──────────────────────────────────────────────────────────────
do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709850: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if public.lead_values_age('{"date_of_birth":"1960-04-02"}'::jsonb, date '2026-09-25') is distinct from '66' then
    raise exception '20260925709850: age is not worked out from a date of birth';
  end if;
  if public.lead_values_age('{"date_of_birth":"04/02/1960"}'::jsonb, date '2026-04-01') is distinct from '65' then
    raise exception '20260925709850: a US-format date of birth is not read, or the birthday is counted early';
  end if;
  if public.lead_values_age('{"date_of_birth":"1960-02-31"}'::jsonb) is not null
     or public.lead_values_age('{"age":"71","date_of_birth":"1960-04-02"}'::jsonb) is distinct from '71' then
    raise exception '20260925709850: a bad date is not unknown, or a recorded age is not preferred';
  end if;
  if public.lead_language_key('{"language":"Spanish"}'::jsonb) is distinct from 'spanish'
     or public.lead_language_key('{"language":"es-MX"}'::jsonb) is distinct from 'spanish'
     or public.lead_language_key('{"language":"English"}'::jsonb) is not null
     or public.lead_language_key('{}'::jsonb) is not null then
    raise exception '20260925709850: lead languages are not read the one way';
  end if;
  if public.compose_initial_quote('Mutual of Omaha', 2500000, 4850) is distinct from 'Mutual of Omaha · $25,000 face · $48.50/mo'
     or public.compose_initial_quote(null, null, null) is not null then
    raise exception '20260925709850: the initial quote is not composed from carrier, face and premium';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_lead_stage_events_source_check'
                  and pg_get_constraintdef(oid) like '%inbound%' and pg_get_constraintdef(oid) like '%dialer%') then
    raise exception '20260925709850: stage history does not accept inbound and dialer';
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'list_transfer_inbox'
                  and position('public.lead_values_age(l.values)' in prosrc) > 0) then
    raise exception '20260925709850: the inbox does not work out age';
  end if;
  if has_function_privilege('anon', 'public.agent_speaks_language(uuid, uuid, text)', 'execute') then
    raise exception '20260925709850: agent_speaks_language is callable from the browser';
  end if;
  -- Coverage: LA-1.10-2, LA-1.13-2 (columns), LA-1.12-10 (source), LA-1.14-9 and LA-1.14-10 (helpers).
end $$;

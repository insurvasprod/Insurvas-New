-- Inbound transfers, part 1 of 3: the columns and helpers the other two files build on.
-- Apply in order: 709850, then 709860, then 709870. Each file checks the one before it.
--
--   LA-1.10-2   The inbox row's age. Partner forms collect date_of_birth, not age, so every partner
--               lead showed an age of "—". lead_values_age() reads values.age when a form recorded
--               one and otherwise works it out from the date of birth, for every lead already in the
--               queue.
--   LA-1.10-8   A dropped call can go back in the queue (requeued_at, requeue_count) and
--   LA-1.11-6   a re-claim resumes the same verification session (file 709860).
--   LA-1.14-9   A buffer who stays on the call after the handoff ends that involvement on its own
--               (buffer_ended_at), which is a different act from giving the transfer back.
--   LA-1.14-10  A caller who asked for another language: language_key(), lead_language_key() and
--               agent_speaks_language() are the one reading of "who can take this call".
--   LA-1.13-2   deal_flow.buffer_agent, and an initial quote composed from carrier, face and premium
--               when nobody gave one.
--   LA-1.12-10  tenant_lead_stage_events accepts 'inbound' as a source.
--
-- Reconciled against the live database on 2026-09-29 (read-only catalog reads):
--   * The stage-history source check is NOT restated from a fixed list any more. Live it already
--     allows 'inbound' (20260926000100) and 'application_sync' (LA-3, 20260926101000), the earlier
--     draft restated it without 'application_sync', which would have failed validation on the first
--     LA-3 sync row, or dropped LA-3's source. The block below only ever ADDS values, keeping every
--     value the live check has.
--   * list_transfer_inbox is restated from its live body (20260924250000), the one change is age.
--   * The initial-quote trigger never replaces a quote somebody gave (a partner's text, or an agent's
--     typed quote on a manual deal). It fills the blank. The backfill likewise only fills blanks.
--   * lead_value_cents reads whole cents only: template currency fields store integer cents, and a
--     decimal string ("50.72") is a dollar amount this function cannot tell apart, so it is skipped.
--   * The lead_queue buffer_ended_at backfill is gone: it only touched finished transfers, bumped
--     their updated_at and broadcast a floor change per row. Finished transfers are excluded by
--     status instead (end_buffer_involvement in 709860 refuses them).
--
-- Down: drop the trigger deal_flow_compose_initial_quote and the functions lead_values_age,
-- language_key, lead_language_key, agent_speaks_language, compose_initial_quote, lead_value_cents,
-- deal_flow_compose_initial_quote, restate list_transfer_inbox from 20260924250000, drop the columns
-- lead_queue.buffer_ended_at/requeued_at/requeue_count and deal_flow.buffer_agent (after 709860 and
-- 709870 are rolled back). The stage-history source is left as it is (other files use it).

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
-- Adds 'inbound' (and 'dialer', for a replay where 20260925711300 has not run yet) to whatever the
-- live check allows. A no-op when both are already there, which is the live state on 2026-09-29.
do $$
declare
  v_def text;
  v_values text[];
  v_needed constant text[] := array['board', 'table', 'list', 'lead_detail', 'owner_fix', 'dialer', 'inbound'];
  v_list text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'public.tenant_lead_stage_events'::regclass
     and c.conname = 'tenant_lead_stage_events_source_check';
  select coalesce(array_agg(distinct t.m[1]), '{}'::text[]) into v_values
    from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') as t(m);
  if v_def is not null and v_values @> v_needed then
    raise notice '20260925709850: stage history already accepts %', array_to_string(v_values, ', ');
    return;
  end if;
  select string_agg(quote_literal(s.v), ', ' order by s.v) into v_list
    from (select distinct unnest(v_values || v_needed) as v) s;
  execute format(
    'alter table public.tenant_lead_stage_events drop constraint if exists tenant_lead_stage_events_source_check, '
    || 'add constraint tenant_lead_stage_events_source_check check (source = any (array[%s])) not valid', v_list);
  execute 'alter table public.tenant_lead_stage_events validate constraint tenant_lead_stage_events_source_check';
end $$;

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
-- all read 'spanish'. The same code list the Agent Floor uses (lib/transferInbox/constants.ts
-- languageKey). Null when nothing is recorded.
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

-- A cents amount from a lead value: template currency fields store integer cents. A decimal string
-- ("50.72") is a dollar amount typed as text and is not read, so it can never show as 51 cents.
create or replace function public.lead_value_cents(p_values jsonb, p_keys text[])
returns bigint
language sql
immutable
set search_path = pg_catalog
as $function$
  select (
    select btrim(p_values->>k)::bigint
      from unnest(p_keys) with ordinality as keys(k, n)
     where coalesce(btrim(p_values->>k), '') ~ '^[0-9]{1,15}$'
     order by n
     limit 1
  )
$function$;

-- An initial quote somebody gave -- the partner's text, or an agent's typed quote on a manual deal --
-- is never replaced. A blank one is composed from the deal row's carrier, face and premium, or, on a
-- new row that has none of them, from the partner's submission.
create or replace function public.deal_flow_compose_initial_quote()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_values jsonb;
  v_composed text;
begin
  if nullif(btrim(coalesce(new.initial_quote, '')), '') is not null then
    return new;
  end if;
  v_composed := public.compose_initial_quote(new.carrier, new.face_amount_cents, new.monthly_premium_cents);
  if v_composed is null and tg_op = 'INSERT' then
    select l.values into v_values from public.agent_leads l where l.id = new.lead_id and l.tenant_id = new.tenant_id;
    if v_values is not null and jsonb_typeof(v_values) = 'object' then
      v_composed := public.compose_initial_quote(
        nullif(btrim(coalesce(v_values->>'carrier', v_values->>'quoted_carrier', v_values->>'preferred_carrier', '')), ''),
        public.lead_value_cents(v_values, array['face_amount_cents', 'face_amount', 'coverage_amount']),
        public.lead_value_cents(v_values, array['monthly_premium_cents', 'monthly_premium', 'quoted_premium', 'premium']));
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
-- Restated from the live definition (20260924250000, read 2026-09-29). One change: the age column.
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
    -- `truncated` flag reads this same 500.
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
  -- The buffer assistant who took each transfer, from the work item that still names them.
  update public.deal_flow d
     set buffer_agent = q.buffer_user_id
    from public.lead_queue q
   where q.lead_id = d.lead_id
     and q.tenant_id = d.tenant_id
     and q.buffer_user_id is not null
     and d.buffer_agent is null
     and exists (select 1 from public.users u where u.id = q.buffer_user_id);
  -- Deals with no initial quote whose agent already recorded carrier, face or premium get the
  -- composed one. A quote somebody gave is left exactly as it is.
  update public.deal_flow
     set initial_quote = left(public.compose_initial_quote(carrier, face_amount_cents, monthly_premium_cents), 1000)
   where nullif(btrim(coalesce(initial_quote, '')), '') is null
     and public.compose_initial_quote(carrier, face_amount_cents, monthly_premium_cents) is not null;
end $$;

-- ── assertions ──────────────────────────────────────────────────────────────
-- Run in the SQL editor they prove this file landed, the checker's role skips them.
do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709850: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.lead_queue'::regclass and attname = 'requeue_count' and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = 'public.lead_queue'::regclass and attname = 'buffer_ended_at' and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = 'public.deal_flow'::regclass and attname = 'buffer_agent' and not attisdropped) then
    raise exception '20260925709850: the requeue, buffer and deal-buffer columns are missing';
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
  if public.lead_value_cents('{"premium":"50.72","monthly_premium_cents":4850}'::jsonb, array['premium', 'monthly_premium_cents']) is distinct from 4850 then
    raise exception '20260925709850: a decimal dollar string is read as cents';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_lead_stage_events_source_check'
                  and pg_get_constraintdef(oid) like '%''inbound''%' and pg_get_constraintdef(oid) like '%''dialer''%'
                  and pg_get_constraintdef(oid) like '%''owner_fix''%' and convalidated) then
    raise exception '20260925709850: stage history does not accept inbound and dialer';
  end if;
  -- LA-3 (20260926101000) added 'application_sync'. Once it is live it must still be there.
  if to_regclass('public.tenant_application_stage_map') is not null then
    if not exists (select 1 from pg_constraint where conname = 'tenant_lead_stage_events_source_check'
                    and pg_get_constraintdef(oid) like '%''application_sync''%') then
      raise exception '20260925709850: stage history lost the LA-3 application_sync source';
    end if;
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'list_transfer_inbox'
                  and position('public.lead_values_age(l.values)' in prosrc) > 0) then
    raise exception '20260925709850: the inbox does not work out age';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.deal_flow'::regclass and tgname = 'deal_flow_compose_initial_quote' and not tgisinternal) then
    raise exception '20260925709850: the initial-quote trigger is missing';
  end if;
  if has_function_privilege('anon', 'public.agent_speaks_language(uuid, uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.agent_speaks_language(uuid, uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid)', 'execute') then
    raise exception '20260925709850: a service-only function is callable from the browser';
  end if;
  -- Coverage: LA-1.10-2, LA-1.13-2 (columns, quote), LA-1.12-10 (source), LA-1.14-9 and LA-1.14-10 (helpers).
end $$;

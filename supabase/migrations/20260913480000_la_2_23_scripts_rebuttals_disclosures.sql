-- LA-2.23 · Scripts, rebuttals and required disclosures
--
-- Script content is tenant data, versioned and selected at call time. Required disclosures are
-- platform-owned because the wording follows the calling-law table, not an agent's preference.

create table if not exists public.tenant_scripts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid references public.tenant_campaigns(id) on delete cascade,
  product_code text not null check (char_length(btrim(product_code)) between 1 and 80),
  version integer not null check (version > 0),
  sections jsonb not null check (jsonb_typeof(sections) = 'object'),
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tenant_scripts_campaign_version_idx
  on public.tenant_scripts (tenant_id, campaign_id, product_code, version)
  where campaign_id is not null;
create unique index if not exists tenant_scripts_default_version_idx
  on public.tenant_scripts (tenant_id, product_code, version)
  where campaign_id is null;
create index if not exists tenant_scripts_active_lookup_idx
  on public.tenant_scripts (tenant_id, campaign_id, product_code, is_active, version desc);

create table if not exists public.tenant_rebuttals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  objection_key text not null check (objection_key in ('too_expensive', 'already_covered', 'send_me_something', 'not_interested', 'call_me_later', 'how_did_you_get_my_number')),
  label text not null check (char_length(btrim(label)) between 1 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, objection_key)
);

create index if not exists tenant_rebuttals_search_idx
  on public.tenant_rebuttals (tenant_id, is_active, sort_order, objection_key);

create table if not exists public.state_disclosures (
  id uuid primary key default gen_random_uuid(),
  state text not null check (state ~ '^[A-Z]{2}$'),
  product_code text not null check (char_length(btrim(product_code)) between 1 and 80),
  required_text text not null check (char_length(btrim(required_text)) between 1 and 8000),
  effective_from date not null,
  created_at timestamptz not null default now(),
  unique (state, product_code, effective_from)
);

create index if not exists state_disclosures_current_idx
  on public.state_disclosures (state, product_code, effective_from desc);

alter table public.tenant_call_attempts
  add column if not exists script_id uuid references public.tenant_scripts(id) on delete set null,
  add column if not exists script_version integer,
  add column if not exists disclosure_state text,
  add column if not exists disclosure_product_code text,
  add column if not exists disclosure_confirmed_at timestamptz;

alter table public.tenant_scripts enable row level security;
alter table public.tenant_rebuttals enable row level security;
alter table public.state_disclosures enable row level security;

drop policy if exists tenant_scripts_tenant_scoped on public.tenant_scripts;
create policy tenant_scripts_tenant_scoped on public.tenant_scripts for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists tenant_rebuttals_tenant_scoped on public.tenant_rebuttals;
create policy tenant_rebuttals_tenant_scoped on public.tenant_rebuttals for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists state_disclosures_tenant_read on public.state_disclosures;
create policy state_disclosures_tenant_read on public.state_disclosures for select to tenant_app using (true);

revoke all on public.tenant_scripts, public.tenant_rebuttals, public.state_disclosures from anon, authenticated, public;
grant select, insert, update on public.tenant_scripts to tenant_app;
grant select, insert, update on public.tenant_rebuttals to tenant_app;
grant select on public.state_disclosures to tenant_app;
grant select, insert, update, delete on public.tenant_scripts, public.tenant_rebuttals, public.state_disclosures to service_role;

-- A disclosure confirmation can only be written against a call attempt owned by this tenant and
-- agent. There is no "I read it" boolean in the browser that can be trusted by itself.
create or replace function public.confirm_call_disclosure(
  p_tenant_id uuid,
  p_attempt_id uuid,
  p_agent_user_id uuid,
  p_state text,
  p_product_code text,
  p_confirmed_at timestamptz default now()
)
returns public.tenant_call_attempts
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_row public.tenant_call_attempts;
begin
  if p_state is null or p_state !~ '^[A-Za-z]{2}$' then raise exception 'DISCLOSURE_STATE_INVALID'; end if;
  select * into v_row from public.tenant_call_attempts
   where id = p_attempt_id and tenant_id = p_tenant_id and agent_id = p_agent_user_id for update;
  if not found then raise exception 'CALL_ATTEMPT_NOT_FOUND'; end if;
  if upper(p_state) <> coalesce(v_row.disclosure_state, '')
     or p_product_code <> coalesce(v_row.disclosure_product_code, '') then
    raise exception 'DISCLOSURE_MISMATCH';
  end if;
  if not exists (
    select 1 from public.state_disclosures
     where state = upper(p_state)
       and product_code = p_product_code
       and effective_from <= current_date
  ) then
    raise exception 'DISCLOSURE_NOT_CONFIGURED';
  end if;
  update public.tenant_call_attempts set disclosure_state = upper(p_state), disclosure_product_code = p_product_code,
    disclosure_confirmed_at = coalesce(p_confirmed_at, now()) where id = p_attempt_id returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.confirm_call_disclosure(uuid, uuid, uuid, text, text, timestamptz) from public, anon, authenticated, tenant_app;
grant execute on function public.confirm_call_disclosure(uuid, uuid, uuid, text, text, timestamptz) to service_role;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenant_call_attempts' and column_name = 'disclosure_confirmed_at') then
    raise exception 'call-attempt disclosure column missing';
  end if;
end $$;

-- ============================================================================
-- Pending migrations — 1 files, each in its own transaction
-- Generated 2026-11-12 by scripts/build-pending-bundle.mjs. Do not hand-edit; regenerate.
--
-- HOW TO RUN: Supabase dashboard → SQL editor → paste this whole file → Run.
-- Each file is begin … commit on its own. The SQL editor STOPS at the first error: that file is
-- rolled back, the files before it stay applied, and nothing after it runs. Fix the named file,
-- regenerate, and run the whole script again — re-running is safe: the files use
-- create-or-replace / if-not-exists, and history rows use on-conflict-do-nothing.
--
-- AFTERWARDS: node --env-file=.env.local scripts/verify-applied-migrations.mjs
--
-- Files, in order:
--    1. 20261112200000_application_forms.sql
-- ============================================================================

-- ─── [1/1] 20261112200000_application_forms.sql ──────────────────────────────────
begin;

-- Settings round 8 · Application forms, option A (owner pick 2026-11-12, docs/design/settings-r8/application-forms.html).
--
-- What the builder can do without this file: pages, AND / OR logic, page skips and the new question
-- rules all live inside form_definition (format 2, lib/templates/logic.ts), so they publish today.
-- This file adds what has to be stored somewhere new:
--
--   tenant_form_drafts            the builder's draft saved to Insurvas, one per form, so it follows the
--                                 owner to any computer (was: this browser only)
--   tenant_form_variants          several forms per product: another arrangement of the product's own
--   tenant_form_variant_revisions questions (pages, logic, required-on-form), each with its versions
--   tenant_form_shares            a form's share link: its name in the URL, who can open it, its lead source
--   tenant_form_events            opened / started / reached a question / sent, for Results
--   agent_leads.is_test           a test submission is a real lead, tagged, kept out of counts
--   webhook_subscription          tenant_template_id scopes a subscription to one form; form.submitted
--                                 and form.test join the LA-8.7 queue (signed, retried, logged), queued
--                                 by a trigger on agent_leads so every way a lead is made is covered
--
-- The app's service client is the only reader and writer of the new tables (RLS on, no policies,
-- every API role revoked). The webhook payload carries the lead id, the form, its version, where it
-- came from and the answers, with SSN and bank fields removed; a payload over 15 kB drops the answers.
-- A webhook that cannot be queued never stops the lead: the trigger warns and moves on.
--
-- Requires 20261015340000 (webhook_subscription, webhook_delivery) and the LA-1.4 tables.
--
-- Rollback: drop trigger webhook_form_submitted_events on agent_leads; drop function
--   webhook_form_submitted_events(); restore webhook_subscription_events and webhook_delivery_type from
--   20261015340000; alter table webhook_subscription drop column tenant_template_id; alter table
--   agent_leads drop column is_test; drop table tenant_form_events, tenant_form_shares,
--   tenant_form_variant_revisions, tenant_form_variants, tenant_form_drafts.

-- ─── drafts saved to Insurvas ─────────────────────────────────────────────────────────────────────
create table if not exists public.tenant_form_drafts (
  tenant_template_id uuid primary key references public.tenant_templates(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  base_revision integer not null,
  draft jsonb not null,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint tenant_form_drafts_shape check (jsonb_typeof(draft) = 'object' and octet_length(draft::text) <= 1000000),
  constraint tenant_form_drafts_revision check (base_revision >= 0)
);
create index if not exists tenant_form_drafts_tenant_idx on public.tenant_form_drafts (tenant_id);
create index if not exists tenant_form_drafts_updated_by_idx on public.tenant_form_drafts (updated_by) where updated_by is not null;

-- ─── several forms per product ───────────────────────────────────────────────────────────────────
create table if not exists public.tenant_form_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tenant_template_id uuid not null references public.tenant_templates(id) on delete cascade,
  name text not null,
  audience text[] not null default array['partners', 'agents']::text[],
  status text not null default 'draft',
  version integer not null default 0,
  form_definition jsonb not null,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_form_variants_name check (char_length(btrim(name)) between 1 and 120),
  constraint tenant_form_variants_audience check (cardinality(audience) between 1 and 3 and audience <@ array['partners', 'agents', 'public']::text[]),
  constraint tenant_form_variants_status check (status in ('draft', 'live', 'off')),
  constraint tenant_form_variants_version check (version >= 0 and (status = 'draft' or version >= 1)),
  constraint tenant_form_variants_form check (jsonb_typeof(form_definition) = 'object' and jsonb_typeof(form_definition -> 'sections') = 'array' and octet_length(form_definition::text) <= 500000)
);
create index if not exists tenant_form_variants_tenant_idx on public.tenant_form_variants (tenant_id, created_at);
create index if not exists tenant_form_variants_copy_idx on public.tenant_form_variants (tenant_template_id);
create index if not exists tenant_form_variants_created_by_idx on public.tenant_form_variants (created_by) where created_by is not null;
create index if not exists tenant_form_variants_updated_by_idx on public.tenant_form_variants (updated_by) where updated_by is not null;

create table if not exists public.tenant_form_variant_revisions (
  variant_id uuid not null references public.tenant_form_variants(id) on delete cascade,
  version integer not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  form_definition jsonb not null,
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (variant_id, version),
  constraint tenant_form_variant_revisions_note check (note is null or char_length(note) <= 300)
);
create index if not exists tenant_form_variant_revisions_tenant_idx on public.tenant_form_variant_revisions (tenant_id);
create index if not exists tenant_form_variant_revisions_created_by_idx on public.tenant_form_variant_revisions (created_by) where created_by is not null;

-- ─── share links ─────────────────────────────────────────────────────────────────────────────────
create table if not exists public.tenant_form_shares (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tenant_template_id uuid not null references public.tenant_templates(id) on delete cascade,
  slug text not null,
  audience text not null default 'public',
  source_label text not null default 'Website',
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_form_shares_slug check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 140),
  constraint tenant_form_shares_audience check (audience in ('public', 'partners', 'agents')),
  constraint tenant_form_shares_source check (char_length(btrim(source_label)) between 1 and 80)
);
-- The slug is the public URL, so it is unique across every agency.
create unique index if not exists tenant_form_shares_slug_key on public.tenant_form_shares (slug);
create unique index if not exists tenant_form_shares_one_per_form on public.tenant_form_shares (tenant_template_id);
create index if not exists tenant_form_shares_tenant_idx on public.tenant_form_shares (tenant_id);
create index if not exists tenant_form_shares_created_by_idx on public.tenant_form_shares (created_by) where created_by is not null;

-- ─── results events ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.tenant_form_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tenant_template_id uuid not null references public.tenant_templates(id) on delete cascade,
  definition_version integer,
  session_id uuid not null,
  event text not null,
  field_key text,
  source text not null default 'partner',
  occurred_at timestamptz not null default now(),
  constraint tenant_form_events_event check (event in ('opened', 'started', 'question', 'sent')),
  constraint tenant_form_events_field check ((event = 'question') = (field_key is not null) and (field_key is null or field_key ~ '^[a-z][a-z0-9_]*$')),
  constraint tenant_form_events_source check (source ~ '^[a-z][a-z0-9_]{0,39}$')
);
create index if not exists tenant_form_events_form_idx on public.tenant_form_events (tenant_id, tenant_template_id, occurred_at desc);
create index if not exists tenant_form_events_copy_idx on public.tenant_form_events (tenant_template_id);
-- One "question" row per session per question, however often the person comes back to it.
create unique index if not exists tenant_form_events_once on public.tenant_form_events (session_id, event, coalesce(field_key, ''));

-- ─── the test-lead flag ──────────────────────────────────────────────────────────────────────────
alter table public.agent_leads add column if not exists is_test boolean not null default false;
create index if not exists agent_leads_test_idx on public.agent_leads (tenant_id) where is_test;

-- ─── access: the app's service client only ──────────────────────────────────────────────────────
alter table public.tenant_form_drafts enable row level security;
alter table public.tenant_form_variants enable row level security;
alter table public.tenant_form_variant_revisions enable row level security;
alter table public.tenant_form_shares enable row level security;
alter table public.tenant_form_events enable row level security;
revoke all on public.tenant_form_drafts, public.tenant_form_variants, public.tenant_form_variant_revisions, public.tenant_form_shares, public.tenant_form_events from public, anon, authenticated;
do $grants$ begin
  if exists (select 1 from pg_roles where rolname = 'tenant_app') then
    execute 'revoke all on public.tenant_form_drafts, public.tenant_form_variants, public.tenant_form_variant_revisions, public.tenant_form_shares, public.tenant_form_events from tenant_app';
  end if;
end $grants$;
revoke truncate on public.tenant_form_drafts, public.tenant_form_variants, public.tenant_form_variant_revisions, public.tenant_form_shares, public.tenant_form_events from service_role;
grant select, insert, update, delete on public.tenant_form_drafts, public.tenant_form_variants, public.tenant_form_shares to service_role;
-- Versions and events are history: written once, never changed.
revoke update, delete on public.tenant_form_variant_revisions, public.tenant_form_events from service_role;
grant select, insert on public.tenant_form_variant_revisions, public.tenant_form_events to service_role;

-- ─── a webhook per form ──────────────────────────────────────────────────────────────────────────
alter table public.webhook_subscription add column if not exists tenant_template_id uuid references public.tenant_templates(id) on delete cascade;
create index if not exists webhook_subscription_form_idx on public.webhook_subscription (tenant_template_id) where tenant_template_id is not null;

alter table public.webhook_subscription drop constraint if exists webhook_subscription_events;
alter table public.webhook_subscription add constraint webhook_subscription_events check (
  cardinality(event_types) between 1 and 5
  and event_types <@ array['policy.issued', 'policy.lapsed', 'commission.discrepancy_found', 'form.submitted', 'form.test']::text[]
);
alter table public.webhook_delivery drop constraint if exists webhook_delivery_type;
alter table public.webhook_delivery add constraint webhook_delivery_type check (
  event_type in ('policy.issued', 'policy.lapsed', 'commission.discrepancy_found', 'form.submitted', 'form.test', 'webhook.test')
);

create or replace function public.webhook_form_submitted_events()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r record;
  v_type text;
  v_event uuid;
  v_answers jsonb;
  v_payload jsonb;
begin
  -- The cheap check first: no agency here listens for a form, nothing to build.
  if not exists (
    select 1 from inserted i
      join public.webhook_subscription s on s.tenant_id = i.tenant_id
     where s.status <> 'disabled' and s.event_types && array['form.submitted', 'form.test']::text[]
  ) then
    return null;
  end if;
  for r in
    select i.id, i.tenant_id, i.tenant_template_id, i.definition_version, i.product_line, i."values" as answers, i.partner_id, i.is_test
      from inserted i
     where i.tenant_template_id is not null
  loop
    begin
      v_type := case when r.is_test then 'form.test' else 'form.submitted' end;
      -- Never an SSN or bank detail in a webhook.
      select coalesce(r.answers, '{}'::jsonb) - coalesce(array_agg(f.field_key), '{}'::text[])
        into v_answers
        from public.tenant_template_fields f
       where f.tenant_template_id = r.tenant_template_id and f.type in ('ssn', 'bank_routing', 'bank_account');
      v_payload := jsonb_build_object(
        'lead_id', r.id,
        'form', r.tenant_template_id,
        'product', r.product_line,
        'version', r.definition_version,
        'source', case when r.partner_id is null then 'agent' else 'partner' end,
        'test', r.is_test,
        'answers', v_answers
      );
      if octet_length(v_payload::text) > 15000 then
        v_payload := (v_payload - 'answers') || jsonb_build_object('answers_omitted', true);
      end if;
      v_event := gen_random_uuid();
      insert into public.webhook_delivery (tenant_id, subscription_id, event_id, event_type, source_key, payload)
      select s.tenant_id, s.id, v_event, v_type, 'lead:' || r.id,
             jsonb_build_object('id', v_event, 'type', v_type, 'created_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'data', v_payload)
        from public.webhook_subscription s
       where s.tenant_id = r.tenant_id
         and s.status in ('active', 'paused', 'failing')
         and v_type = any (s.event_types)
         and (s.tenant_template_id is null or s.tenant_template_id = r.tenant_template_id)
      on conflict (subscription_id, source_key) do nothing;
    exception when others then
      -- The lead matters more than its webhook: say so in the log and carry on.
      raise warning 'form webhook for lead % was not queued: %', r.id, sqlerrm;
    end;
  end loop;
  return null;
end;
$$;

revoke all on function public.webhook_form_submitted_events() from public, anon, authenticated;

drop trigger if exists webhook_form_submitted_events on public.agent_leads;
create trigger webhook_form_submitted_events
  after insert on public.agent_leads
  referencing new table as inserted
  for each statement execute function public.webhook_form_submitted_events();

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261112200000', 'application_forms') on conflict do nothing;
  end if;
end $bundle$;
commit;

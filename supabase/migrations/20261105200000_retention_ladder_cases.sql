-- Retention ladder (owner 2026-11-05, docs/retention/SPEC.md): every policy the carrier files flag,
-- at its risk point, worked until a later file proves it fixed.
--
--   retention_case        one per flagged policy while it needs care. step = the risk point
--                         (payment_problem → pending_lapse → lapsed_reinstatable → lost), or paperwork
--                         beside the ladder. reason = the file fact that put it there. Opened, moved and
--                         closed as saved / lost by the app's sync (lib/retention/cases/sync.ts) from the
--                         uploaded policy and commission files; a person can only close it "without a
--                         save", with a reason. One open ladder case per policy; one open paperwork case
--                         per policy and reason.
--   retention_case_event  the timeline: every step move, file evidence, call, fix, assignment, close.
--   retention_ladder_rule        an agency's overrides of the default rules (a reason on/off, thresholds).
--   carrier_status_map.retention_flag
--                         a carrier's own status word flagged as banking / notice / manual_action /
--                         cancellation / pending_lapse, so each carrier's words put policies on the
--                         ladder without a code change.
--
-- Writes go through the server only (service role); tenant_app reads its own rows under RLS.
-- Additive. Requires policy_current (20261008160000), carrier_status_map (20261008130000),
-- servicing_request (20261014200000), reinstatement_case (20261014400000).
--
-- Rollback:
--   drop table if exists public.retention_case_event; drop table if exists public.retention_case;
--   drop table if exists public.retention_ladder_rule;
--   alter table public.carrier_status_map drop column if exists retention_flag;


create table if not exists public.retention_case (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null,
  contact_id uuid references public.contacts(id) on delete set null,
  step text not null,
  reason text not null,
  status text not null default 'open',
  priority smallint not null default 2,
  deadline date,
  evidence jsonb not null default '{}'::jsonb,
  owner_user_id uuid references public.users(id) on delete set null,
  contact_attempts integer not null default 0,
  last_contact_at timestamptz,
  servicing_request_id uuid references public.servicing_request(id) on delete set null,
  reinstatement_case_id uuid references public.reinstatement_case(id) on delete set null,
  outcome_reason text,
  opened_at timestamptz not null default now(),
  step_changed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  constraint retention_case_step check (step in ('payment_problem', 'pending_lapse', 'lapsed_reinstatable', 'lost', 'paperwork')),
  constraint retention_case_reason check (reason in (
    'first_draft_failed', 'later_draft_failed', 'bounced_draft', 'banking_problem',
    'pending_lapse', 'lapse_notice', 'lapsed_reinstatable', 'lapsed_lost', 'chargeback',
    'cancellation_request', 'pending_manual_action', 'payment_date_change', 'mailed_bill')),
  constraint retention_case_status check (status in ('open', 'working', 'waiting_on_carrier', 'saved', 'lost', 'closed_no_save')),
  constraint retention_case_priority check (priority between 1 and 3),
  constraint retention_case_policy check (char_length(policy_number) between 1 and 120),
  constraint retention_case_attempts check (contact_attempts >= 0),
  constraint retention_case_reason_text check (outcome_reason is null or char_length(outcome_reason) <= 1000),
  -- Closed exactly when resolved; "closed without a save" always says why.
  constraint retention_case_resolved check ((status in ('saved', 'lost', 'closed_no_save')) = (resolved_at is not null)),
  constraint retention_case_no_save_reason check (status <> 'closed_no_save' or (outcome_reason is not null and char_length(btrim(outcome_reason)) >= 3)),
  constraint retention_case_resolved_by check (resolved_by is null or resolved_by = 'file' or resolved_by ~ '^[0-9a-f-]{36}$')
);

-- One open ladder case per policy; one open paperwork case per policy and reason.
create unique index if not exists retention_case_open_ladder on public.retention_case (tenant_id, carrier_id, policy_number)
  where step <> 'paperwork' and status in ('open', 'working', 'waiting_on_carrier');
create unique index if not exists retention_case_open_paperwork on public.retention_case (tenant_id, carrier_id, policy_number, reason)
  where step = 'paperwork' and status in ('open', 'working', 'waiting_on_carrier');
create index if not exists retention_case_list_idx on public.retention_case (tenant_id, status, step, deadline);
create index if not exists retention_case_owner_idx on public.retention_case (tenant_id, owner_user_id) where status in ('open', 'working', 'waiting_on_carrier');
create index if not exists retention_case_policy_idx on public.retention_case (tenant_id, carrier_id, policy_number);
create index if not exists retention_case_carrier_idx on public.retention_case (carrier_id);
create index if not exists retention_case_contact_idx on public.retention_case (contact_id);
create index if not exists retention_case_owner_fk_idx on public.retention_case (owner_user_id);
create index if not exists retention_case_servicing_idx on public.retention_case (servicing_request_id);
create index if not exists retention_case_reinstatement_idx on public.retention_case (reinstatement_case_id);

create table if not exists public.retention_case_event (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  case_id uuid not null references public.retention_case(id) on delete cascade,
  kind text not null,
  actor_user_id uuid references public.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint retention_case_event_kind check (kind in ('opened', 'step_moved', 'evidence', 'assigned', 'call', 'fix', 'note', 'servicing_linked', 'resolved', 'reopened'))
);
create index if not exists retention_case_event_case_idx on public.retention_case_event (case_id, created_at);
create index if not exists retention_case_event_tenant_idx on public.retention_case_event (tenant_id);
create index if not exists retention_case_event_actor_idx on public.retention_case_event (actor_user_id);

create table if not exists public.retention_ladder_rule (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reason text not null,
  enabled boolean not null default true,
  params jsonb not null default '{}'::jsonb,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, reason),
  constraint retention_ladder_rule_reason check (reason in (
    'first_draft_failed', 'later_draft_failed', 'bounced_draft', 'banking_problem',
    'pending_lapse', 'lapse_notice', 'lapsed_reinstatable', 'lapsed_lost', 'chargeback',
    'cancellation_request', 'pending_manual_action', 'payment_date_change', 'mailed_bill', 'thresholds'))
);
create index if not exists retention_ladder_rule_updated_by_idx on public.retention_ladder_rule (updated_by);

alter table public.carrier_status_map add column if not exists retention_flag text;
alter table public.carrier_status_map drop constraint if exists carrier_status_map_retention_flag;
alter table public.carrier_status_map add constraint carrier_status_map_retention_flag
  check (retention_flag is null or retention_flag in ('banking', 'notice', 'manual_action', 'cancellation', 'pending_lapse'));

-- Access: the server writes (service role); an agency reads its own rows.
alter table public.retention_case enable row level security;
alter table public.retention_case_event enable row level security;
alter table public.retention_ladder_rule enable row level security;
drop policy if exists retention_case_read on public.retention_case;
create policy retention_case_read on public.retention_case for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists retention_case_event_read on public.retention_case_event;
create policy retention_case_event_read on public.retention_case_event for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists retention_ladder_rule_read on public.retention_ladder_rule;
create policy retention_ladder_rule_read on public.retention_ladder_rule for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.retention_case, public.retention_case_event, public.retention_ladder_rule from public, anon, authenticated;
grant select, insert, update on public.retention_case to service_role;
grant select, insert on public.retention_case_event to service_role;
grant select, insert, update, delete on public.retention_ladder_rule to service_role;
revoke delete, truncate on public.retention_case from service_role;
-- The timeline is append-only.
revoke update, delete, truncate on public.retention_case_event from service_role;
revoke insert, update, delete, truncate on public.retention_case, public.retention_case_event, public.retention_ladder_rule from tenant_app;
grant select on public.retention_case, public.retention_case_event, public.retention_ladder_rule to tenant_app;

-- Proof it landed (raises if not).
do $$
begin
  if to_regclass('public.retention_case') is null or to_regclass('public.retention_case_event') is null or to_regclass('public.retention_ladder_rule') is null then
    raise exception 'retention ladder tables missing';
  end if;
  if not exists (select 1 from pg_attribute where attrelid = to_regclass('public.carrier_status_map') and attname = 'retention_flag' and not attisdropped) then
    raise exception 'carrier_status_map.retention_flag missing';
  end if;
  if to_regclass('public.retention_case_open_ladder') is null or to_regclass('public.retention_case_open_paperwork') is null then
    raise exception 'retention_case open-case indexes missing';
  end if;
end $$;


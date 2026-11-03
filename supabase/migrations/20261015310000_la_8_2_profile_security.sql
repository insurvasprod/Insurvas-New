-- LA-8.2 (Notion sprint, Module 8 — Settings) · My profile & security.
--
-- Sessions the agent can see and end, two-factor authentication (TOTP, never SMS) with one-time
-- recovery codes, a personal display timezone, and the security event log.
--
--   tenant_user_session   one row per sign-in. The session cookie names its row (`sid`), and every
--                         request checks the row (lib/tenantAuth/requireTenant.ts): ending a session
--                         takes effect on its next request — store-checked, never inferred from the
--                         token. Spec name: user_session; is_current is computed (the cookie's sid).
--   user_two_factor       the TOTP secret (encrypted by the app), when it was turned on, and the last
--                         accepted time step, so a code is used once.
--   user_recovery_code    hashes only; shown once at enrolment; a used code is dead.
--   user_security_event   append-only: password and email changes, 2FA on/off, recovery-code use,
--                         sessions ended. Failed-login bursts are read from login_events, not copied.
--                         LA-8.8's audit viewer reads this too.
--
-- The 2FA records belong to the PERSON (users), not the workspace: one account, one authenticator,
-- whichever agency they sign in to.
--
-- Rollback: drop table public.user_security_event, public.user_recovery_code, public.user_two_factor,
--   public.tenant_user_session; drop the functions below; alter table public.users drop column display_timezone.

-- ─── display timezone (the person's own; the agency's is LA-8.3's) ──────────────────────────────
alter table public.users add column if not exists display_timezone text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_display_timezone_len') then
    alter table public.users add constraint users_display_timezone_len check (display_timezone is null or length(display_timezone) between 1 and 64);
  end if;
end;
$$;

-- ─── sessions ─────────────────────────────────────────────────────────────────────────────────
create table if not exists public.tenant_user_session (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ip text check (ip is null or length(ip) <= 64),
  approx_location text check (approx_location is null or length(approx_location) <= 120),
  user_agent text check (user_agent is null or length(user_agent) <= 512),
  device_label text check (device_label is null or length(device_label) <= 120),
  -- When this session passed the second factor. Revealing a sensitive field needs it (LA-8.2).
  two_factor_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason is null or revoked_reason in ('signed_out', 'ended_by_user', 'password_changed', 'email_changed', 'two_factor_changed', 'switched_workspace')),
  revoked_by uuid references public.users(id) on delete set null,
  constraint tenant_user_session_revoked check ((revoked_at is null) = (revoked_reason is null))
);
create index if not exists tenant_user_session_user_live on public.tenant_user_session (user_id, last_seen_at desc) where revoked_at is null;
create index if not exists tenant_user_session_tenant on public.tenant_user_session (tenant_id);
create index if not exists tenant_user_session_revoked_by on public.tenant_user_session (revoked_by);

-- ─── two-factor ───────────────────────────────────────────────────────────────────────────────
create table if not exists public.user_two_factor (
  user_id uuid primary key references public.users(id) on delete cascade,
  secret_ciphertext text not null,
  key_version integer not null default 1,
  created_at timestamptz not null default now(),
  -- Null while enrolment waits for its first code: a secret nobody has proven they hold is not 2FA.
  enabled_at timestamptz,
  last_totp_step bigint
);

create table if not exists public.user_recovery_code (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  code_hash text not null check (length(code_hash) = 64),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  constraint user_recovery_code_unique unique (user_id, code_hash)
);

-- ─── the security event log ───────────────────────────────────────────────────────────────────
create table if not exists public.user_security_event (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  event_type text not null check (event_type in (
    'password_changed', 'email_change_requested', 'email_changed', 'two_factor_enabled', 'two_factor_disabled',
    'recovery_code_used', 'recovery_codes_regenerated', 'session_ended', 'other_sessions_ended')),
  detail jsonb not null default '{}'::jsonb,
  ip text check (ip is null or length(ip) <= 64),
  user_agent text check (user_agent is null or length(user_agent) <= 512),
  occurred_at timestamptz not null default now()
);
create index if not exists user_security_event_user on public.user_security_event (user_id, occurred_at desc);
create index if not exists user_security_event_tenant on public.user_security_event (tenant_id);

-- Append-only: a log someone can edit is not a log. Revoked from service_role too, explicitly —
-- Supabase grants it everything by default.
create or replace function public.user_security_event_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  raise exception 'user_security_event is append-only' using errcode = '42501';
end;
$$;
drop trigger if exists user_security_event_guard on public.user_security_event;
create trigger user_security_event_guard before update or delete on public.user_security_event
  for each row execute function public.user_security_event_guard();

-- ─── writers ──────────────────────────────────────────────────────────────────────────────────
-- A code is accepted once: the step must be newer than the last accepted one, compared and set in
-- one statement so two concurrent sign-ins with the same code cannot both pass.
create or replace function public.claim_user_totp_step(p_user_id uuid, p_step bigint)
returns boolean
language sql
security definer
set search_path = public, pg_catalog
as $$
  with claimed as (
    update public.user_two_factor set last_totp_step = p_step
     where user_id = p_user_id and (last_totp_step is null or last_totp_step < p_step)
    returning 1
  )
  select exists (select 1 from claimed);
$$;

-- A recovery code works once.
create or replace function public.use_user_recovery_code(p_user_id uuid, p_code_hash text)
returns boolean
language sql
security definer
set search_path = public, pg_catalog
as $$
  with used as (
    update public.user_recovery_code set used_at = now()
     where user_id = p_user_id and code_hash = p_code_hash and used_at is null
    returning 1
  )
  select exists (select 1 from used);
$$;

-- Turn 2FA on after the first code: the step is claimed, the old codes go, the new ones arrive —
-- all or nothing.
create or replace function public.enable_user_two_factor(p_user_id uuid, p_step bigint, p_code_hashes text[])
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  update public.user_two_factor set enabled_at = now(), last_totp_step = p_step
   where user_id = p_user_id and enabled_at is null;
  if not found then
    raise exception 'enable_user_two_factor: start enrolment first' using errcode = '22023';
  end if;
  delete from public.user_recovery_code where user_id = p_user_id;
  insert into public.user_recovery_code (user_id, code_hash) select p_user_id, h from unnest(p_code_hashes) h;
end;
$$;

-- Fresh recovery codes replace every earlier one, used or not.
create or replace function public.replace_user_recovery_codes(p_user_id uuid, p_code_hashes text[])
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not exists (select 1 from public.user_two_factor where user_id = p_user_id and enabled_at is not null) then
    raise exception 'replace_user_recovery_codes: two-factor is not on' using errcode = '22023';
  end if;
  delete from public.user_recovery_code where user_id = p_user_id;
  insert into public.user_recovery_code (user_id, code_hash) select p_user_id, h from unnest(p_code_hashes) h;
end;
$$;

create or replace function public.disable_user_two_factor(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  delete from public.user_recovery_code where user_id = p_user_id;
  delete from public.user_two_factor where user_id = p_user_id;
end;
$$;

-- End sessions: one, or every one but the caller's. Returns how many ended.
create or replace function public.end_user_sessions(p_user_id uuid, p_session_id uuid, p_except uuid, p_reason text, p_by uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_n integer;
begin
  update public.tenant_user_session
     set revoked_at = now(), revoked_reason = p_reason, revoked_by = p_by
   where user_id = p_user_id and revoked_at is null
     and (p_session_id is null or id = p_session_id)
     and (p_except is null or id <> p_except);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- A person asks to change their own sign-in email: one live request at a time (a new one replaces
-- the old), refused when the address already belongs to an account. The token goes to the NEW
-- address; nothing changes until it is used (consume_user_email_change_token).
create or replace function public.request_own_email_change(p_user_id uuid, p_new_email text, p_token_hash text, p_expires_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_email text := lower(btrim(p_new_email));
begin
  if exists (select 1 from public.users where lower(email) = v_email) then
    raise exception 'EMAIL_ALREADY_REGISTERED' using errcode = 'P0001';
  end if;
  -- One live request per person (user_invitations_one_live_idx): the earlier link stops working.
  delete from public.user_invitations
   where user_id = p_user_id and purpose = 'email_change' and accepted_at is null;
  insert into public.user_invitations (user_id, purpose, token_hash, new_email, expires_at, created_by)
  values (p_user_id, 'email_change', p_token_hash, v_email, p_expires_at, p_user_id);
end;
$$;

-- ─── access ───────────────────────────────────────────────────────────────────────────────────
alter table public.tenant_user_session enable row level security;
alter table public.user_two_factor enable row level security;
alter table public.user_recovery_code enable row level security;
alter table public.user_security_event enable row level security;
revoke all on public.tenant_user_session, public.user_two_factor, public.user_recovery_code, public.user_security_event from public, anon, authenticated;
grant select, insert, update on public.tenant_user_session to service_role;
grant select, insert, update, delete on public.user_two_factor, public.user_recovery_code to service_role;
grant select, insert on public.user_security_event to service_role;
revoke update, delete, truncate on public.user_security_event from service_role;
revoke delete, truncate on public.tenant_user_session from service_role;

-- The tenant-scoped read backstop, as the other tenant tables carry. The secret and the recovery
-- code hashes have no tenant and no tenant_app read at all.
drop policy if exists tenant_user_session_read on public.tenant_user_session;
create policy tenant_user_session_read on public.tenant_user_session for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_user_session to tenant_app;

revoke all on function public.claim_user_totp_step(uuid, bigint), public.use_user_recovery_code(uuid, text), public.enable_user_two_factor(uuid, bigint, text[]),
  public.replace_user_recovery_codes(uuid, text[]), public.disable_user_two_factor(uuid), public.end_user_sessions(uuid, uuid, uuid, text, uuid),
  public.request_own_email_change(uuid, text, text, timestamptz), public.user_security_event_guard() from public, anon, authenticated, tenant_app;
grant execute on function public.claim_user_totp_step(uuid, bigint), public.use_user_recovery_code(uuid, text), public.enable_user_two_factor(uuid, bigint, text[]),
  public.replace_user_recovery_codes(uuid, text[]), public.disable_user_two_factor(uuid), public.end_user_sessions(uuid, uuid, uuid, text, uuid),
  public.request_own_email_change(uuid, text, text, timestamptz) to service_role;

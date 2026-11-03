-- Audit 2026-10-16 · a reveal of an SSN or a bank / card number says why.
--
-- tenant_sensitive_access_log (LA-3.7, 20260926100000) recorded who revealed which field and when,
-- but not why, so an owner reading the log could not tell reading a number back to the customer
-- from browsing. The app now requires a short typed reason on every person-initiated reveal
-- (lib/applications/revealReason.ts, 4–200 characters) and stores it here.
--
--   reason                    NEW column, nullable: rows before this have none, nor do the carrier
--                             extension's per-field read ('extension_read') and the opening of a
--                             signed confirmation document (lib/applications/confirmations.ts).
--   ..._reason_length         when present, 4–200 characters, as the app accepts. Requiring it per
--                             action is left to the app: a confirmation open is also a 'reveal'.
--
-- Either order with the deploy is safe: until this is applied the app writes the log row without
-- the column (the reason still lands on the audit row), and the old app never sends one.
--
-- Additive. Requires 20260926100000. The table stays append-only (no grant changes here).
--
-- Rollback:
--   alter table public.tenant_sensitive_access_log drop constraint if exists tenant_sensitive_access_log_reason_length;
--   alter table public.tenant_sensitive_access_log drop column if exists reason;

alter table public.tenant_sensitive_access_log
  add column if not exists reason text;

alter table public.tenant_sensitive_access_log
  drop constraint if exists tenant_sensitive_access_log_reason_length;
alter table public.tenant_sensitive_access_log
  add constraint tenant_sensitive_access_log_reason_length
  check (reason is null or char_length(reason) between 4 and 200);

comment on column public.tenant_sensitive_access_log.reason is
  'Why the person revealed the value, as they typed it (the app requires it on SSN / bank / card reveals since 20261016300000).';

-- Self-check: the column and the constraint exist.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tenant_sensitive_access_log' and column_name = 'reason'
  ) then
    raise exception 'tenant_sensitive_access_log.reason is missing';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_sensitive_access_log'::regclass
       and conname = 'tenant_sensitive_access_log_reason_length'
  ) then
    raise exception 'tenant_sensitive_access_log_reason_length is missing';
  end if;
end
$$;

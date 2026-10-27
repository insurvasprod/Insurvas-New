-- Google sign-in (2026-10-27): two new rows in a person's own security log.
--
--   signed_in_with_google   They signed in with Google instead of the password.
--   google_sign_in_added    Google was linked to an account that already had a password (Supabase
--                           links a verified Google address to the existing Auth user).
--
-- Until this is applied the app still works: recordSecurityEvent logs the refused insert and carries
-- on, so the only thing missing is the row in Settings › Sign-in and security.

alter table public.user_security_event drop constraint if exists user_security_event_event_type_check;
alter table public.user_security_event add constraint user_security_event_event_type_check check (event_type = any (array[
  'password_changed', 'email_change_requested', 'email_changed', 'two_factor_enabled', 'two_factor_disabled',
  'recovery_code_used', 'recovery_codes_regenerated', 'session_ended', 'other_sessions_ended',
  'device_trusted', 'signed_in_with_link',
  'signed_in_with_google', 'google_sign_in_added'
]::text[]));

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.user_security_event'::regclass
       and conname = 'user_security_event_event_type_check'
       and pg_get_constraintdef(oid) like '%google_sign_in_added%'
  ) then
    raise exception 'user_security_event_event_type_check was not widened';
  end if;
end $$;

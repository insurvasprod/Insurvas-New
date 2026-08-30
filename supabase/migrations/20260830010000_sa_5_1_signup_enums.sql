-- SA-5.1 uses explicit lifecycle values instead of overloading `active` and `invite`.
-- Kept separate because PostgreSQL cannot safely use a newly-added enum value in the
-- same transaction that adds it.
alter type public.user_status
  add value if not exists 'pending_verification' before 'active';

alter type public.user_token_purpose
  add value if not exists 'email_verification';

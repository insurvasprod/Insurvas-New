-- E2E 2026-10-16 · inviting a user to an OFFBOARDED partner was accepted.
--
-- partner_invite_user_with_auth checked only that the partner exists, so an invite to an offboarded
-- partner created the account and membership and sent the email, though the token can never be
-- redeemed (set-password refuses offboarded partners). The app route now refuses first (409); this
-- guard makes the database refuse too, for every caller, through a trigger on partner_users so the
-- two invite overloads (and any future one) are covered without restating them.
--
-- Rollback: drop trigger if exists partner_users_refuse_offboarded on public.partner_users;
--           drop function if exists public.partner_users_refuse_offboarded();

create or replace function public.partner_users_refuse_offboarded()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.partners p where p.id = new.partner_id and p.status = 'offboarded') then
    raise exception 'partner_offboarded' using errcode = 'P0001', hint = 'An offboarded partner takes no new users.';
  end if;
  return new;
end;
$$;
revoke all on function public.partner_users_refuse_offboarded() from public, anon, authenticated;

drop trigger if exists partner_users_refuse_offboarded on public.partner_users;
create trigger partner_users_refuse_offboarded before insert on public.partner_users
  for each row execute function public.partner_users_refuse_offboarded();

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'partner_users_refuse_offboarded' and tgrelid = 'public.partner_users'::regclass) then
    raise exception '20261016100000: the offboarded-partner guard is missing';
  end if;
end $$;

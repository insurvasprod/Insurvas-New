-- M2 D15 / LA-2.23-3 · the rebuttal library had room for exactly six objections.
--
-- tenant_rebuttals_objection_key_check allowed six keys, so the demo's "about eight rebuttals" could
-- not be stored. Two common objections are added: "I need to think about it" and "I need to talk
-- to my spouse first". Every existing row already satisfies the wider list.
--
-- The app works before this is applied: the route accepts the two new keys, and a save refused by
-- the old constraint (23514) answers 503 "needs a database update".

alter table public.tenant_rebuttals drop constraint if exists tenant_rebuttals_objection_key_check;
alter table public.tenant_rebuttals
  add constraint tenant_rebuttals_objection_key_check check (objection_key = any (array[
    'too_expensive', 'already_covered', 'send_me_something', 'not_interested', 'call_me_later',
    'how_did_you_get_my_number', 'need_to_think', 'talk_to_spouse'
  ]::text[]));

do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929200100: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if position('talk_to_spouse' in (select pg_get_constraintdef(c.oid) from pg_constraint c
                                     where c.conname = 'tenant_rebuttals_objection_key_check'
                                       and c.conrelid = 'public.tenant_rebuttals'::regclass)) = 0 then
    raise exception '20260929200100: the rebuttal library still allows six objections only';
  end if;
end
$$;

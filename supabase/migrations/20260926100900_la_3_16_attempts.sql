-- LA-3 step 15 — attempts (LA-3.16): structured outcome reasons and the next-attempt function.
--
-- docs/la3/SCHEMA-PLAN.md "Step 15" and docs/la3/STATUS-MODEL.md §3–§4 are the specification. In short:
--
--   application_outcome_reasons  NEW       platform list (tenant_id null), extendable per tenant and
--                                          optionally scoped to one carrier; seeded per STATUS-MODEL §3
--   open_next_attempt()          NEW       attempt N + 1 after a declined / postponed / refused /
--                                          expired attempt on an open case
--
-- application_transition() (step 1) stays the only writer of status and outcome; open_next_attempt
-- only inserts a new draft attempt beside a closed one.
--
-- What carries forward: tenant_application_values in the insured / contact / addr / owner groups,
-- as source 'carried_forward' and unreviewed; the beneficiaries; the payment method's non-secret
-- columns. What does NOT: quotes, disclosures, QA, copy-assist ticks, the carrier — and no
-- ciphertext at all. Ciphertext is bound by AES-GCM associated data to the application id it was
-- written for, so a copied SSN, routing, account or card number would never decrypt on the new
-- attempt; the app re-encrypts carried sensitive values itself.
--
-- Down:
--   drop function public.open_next_attempt(uuid, uuid, uuid);
--   drop table public.application_outcome_reasons;

-- ── 1 · outcome reasons ─────────────────────────────────────────────────────
create table if not exists public.application_outcome_reasons (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[a-z][a-z0-9_]{0,63}$'),
  tenant_id uuid references public.tenants(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 120),
  valid_outcomes text[] not null
    check (cardinality(valid_outcomes) > 0
           and valid_outcomes <@ array['issued', 'declined', 'postponed', 'withdrawn', 'declined_by_client', 'offer_expired']::text[]),
  carrier_id uuid references public.carriers(id) on delete cascade,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists application_outcome_reasons_code_unique
  on public.application_outcome_reasons (
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    code,
    coalesce(carrier_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
create index if not exists application_outcome_reasons_tenant_idx
  on public.application_outcome_reasons (tenant_id) where tenant_id is not null;
create index if not exists application_outcome_reasons_carrier_idx
  on public.application_outcome_reasons (carrier_id) where carrier_id is not null;

alter table public.application_outcome_reasons enable row level security;
drop policy if exists application_outcome_reasons_tenant_read on public.application_outcome_reasons;
create policy application_outcome_reasons_tenant_read on public.application_outcome_reasons
  for select to tenant_app
  using (tenant_id is null or tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists application_outcome_reasons_tenant_scoped on public.application_outcome_reasons;
create policy application_outcome_reasons_tenant_scoped on public.application_outcome_reasons
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.application_outcome_reasons to tenant_app;
grant select, insert, update, delete on public.application_outcome_reasons to service_role;

drop trigger if exists application_outcome_reasons_touch on public.application_outcome_reasons;
create trigger application_outcome_reasons_touch before update on public.application_outcome_reasons
  for each row execute function public.la3_touch_updated_at();

-- STATUS-MODEL §3, the LA-3.16 Final Expense set (lib/applications/constants.ts OUTCOME_REASONS).
-- `other` requires free text; the service enforces that, as application_transition takes the text.
insert into public.application_outcome_reasons (code, tenant_id, label, valid_outcomes, carrier_id, sort_order) values
  ('medication',                null, 'Medication disclosed',          array['declined', 'postponed'],              null, 10),
  ('recent_hospitalisation',    null, 'Recent hospitalisation',        array['declined', 'postponed'],              null, 20),
  ('height_weight',             null, 'Height / weight (build chart)', array['declined'],                           null, 30),
  ('prior_decline',             null, 'Prior decline',                 array['declined'],                           null, 40),
  ('banking_nsf',               null, 'Banking / NSF',                 array['declined', 'withdrawn'],              null, 50),
  ('incomplete_application',    null, 'Incomplete application',        array['declined'],                           null, 60),
  ('replacement_not_disclosed', null, 'Replacement not disclosed',     array['declined'],                           null, 70),
  ('client_changed_mind',       null, 'Client changed their mind',     array['withdrawn'],                          null, 80),
  ('client_unreachable',        null, 'Client unreachable',            array['withdrawn'],                          null, 90),
  ('other',                     null, 'Other',                         array['declined', 'postponed', 'withdrawn'], null, 1000)
on conflict do nothing;

-- ── 2 · the next attempt ────────────────────────────────────────────────────
create or replace function public.open_next_attempt(
  p_tenant_id uuid,
  p_application_id uuid,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a record;
  v_case_status text;
  v_new uuid;
begin
  select * into a from tenant_applications t
   where t.id = p_application_id and t.tenant_id = p_tenant_id
   for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;

  -- Only a carrier decision (or the client refusing / letting a counteroffer lapse) earns a retry;
  -- issued is a sale and withdrawn is the client or agent walking away.
  if a.status <> 'closed' or a.outcome not in ('declined', 'postponed', 'declined_by_client', 'offer_expired') then
    raise exception 'NEXT_ATTEMPT_NOT_ALLOWED: the attempt is not closed as declined, postponed, declined_by_client or offer_expired';
  end if;

  select c.status into v_case_status from tenant_application_cases c
   where c.id = a.case_id and c.tenant_id = p_tenant_id
   for update;
  if v_case_status is distinct from 'open' then
    raise exception 'NEXT_ATTEMPT_NOT_ALLOWED: the case is not open';
  end if;

  -- The retry follows the insured's latest attempt, and only once nothing is live for them.
  if exists (select 1 from tenant_applications x
              where x.case_id = a.case_id and x.insured_role = a.insured_role
                and (x.status <> 'closed' or x.attempt_no > a.attempt_no)) then
    raise exception 'NEXT_ATTEMPT_NOT_ALLOWED: this is not the latest attempt, or one is already live';
  end if;

  insert into tenant_applications (tenant_id, case_id, lead_id, insured_role, attempt_no, supersedes_application_id,
                                   field_set_template_id, field_set_revision, status, draft_day, created_by)
  values (a.tenant_id, a.case_id, a.lead_id, a.insured_role, a.attempt_no + 1, a.id,
          a.field_set_template_id, a.field_set_revision, 'draft', a.draft_day, p_actor)
  returning id into v_new;

  -- Plain values only: a ciphertext row is bound to the old application id and is re-encrypted by
  -- the app. Carried values are unreviewed, so QA's "prefilled, never reviewed" warning applies.
  insert into tenant_application_values (application_id, field_key, tenant_id, value, source, linked_to_primary, updated_by)
  select v_new, v.field_key, v.tenant_id, v.value, 'carried_forward', v.linked_to_primary, p_actor
    from tenant_application_values v
   where v.application_id = a.id
     and v.tenant_id = p_tenant_id
     and v.value_ciphertext is null
     and (v.field_key like 'insured.%' or v.field_key like 'contact.%'
          or v.field_key like 'addr.%' or v.field_key like 'owner.%');

  insert into tenant_application_beneficiaries (application_id, tenant_id, tier, first_name, last_name, relationship,
                                                relationship_other, dob, share_bp, phone, address, sort_order, updated_by)
  select v_new, b.tenant_id, b.tier, b.first_name, b.last_name, b.relationship,
         b.relationship_other, b.dob, b.share_bp, b.phone, b.address, b.sort_order, p_actor
    from tenant_application_beneficiaries b
   where b.application_id = a.id and b.tenant_id = p_tenant_id;

  -- The payment method without any ciphertext, last-four or key version: the app asks for (or
  -- re-encrypts) the numbers, so a last-four never points at a number that is not there.
  insert into tenant_application_payment_methods (application_id, tenant_id, method, account_type, bank_name, name_on_account,
                                                  card_exp_month, card_exp_year, card_brand, name_on_card,
                                                  billing_frequency, billing_address_same_as_insured,
                                                  draft_income_type, draft_income_inputs, draft_day_recommended,
                                                  draft_day_override_reason, draft_day_overridden_by, draft_day_overridden_at,
                                                  linked_to_primary, updated_by)
  select v_new, m.tenant_id, m.method, m.account_type, m.bank_name, m.name_on_account,
         m.card_exp_month, m.card_exp_year, m.card_brand, m.name_on_card,
         m.billing_frequency, m.billing_address_same_as_insured,
         m.draft_income_type, m.draft_income_inputs, m.draft_day_recommended,
         m.draft_day_override_reason, m.draft_day_overridden_by, m.draft_day_overridden_at,
         m.linked_to_primary, p_actor
    from tenant_application_payment_methods m
   where m.application_id = a.id and m.tenant_id = p_tenant_id;

  return v_new;
end;
$function$;

revoke all on function public.open_next_attempt(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.open_next_attempt(uuid, uuid, uuid) to service_role;

-- ── 3 · checks ──────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from public.application_outcome_reasons where tenant_id is null and carrier_id is null
        and code in ('medication', 'recent_hospitalisation', 'height_weight', 'prior_decline', 'banking_nsf',
                     'incomplete_application', 'replacement_not_disclosed', 'client_changed_mind',
                     'client_unreachable', 'other')) <> 10 then
    raise exception '20260926100900: the ten platform outcome reasons are missing';
  end if;
  if exists (select 1 from public.application_outcome_reasons where 'issued' = any (valid_outcomes)) then
    raise exception '20260926100900: an outcome reason is offered for issued';
  end if;
  if not exists (select 1 from pg_proc where proname = 'open_next_attempt' and prosecdef) then
    raise exception '20260926100900: open_next_attempt is missing or not security definer';
  end if;
  if has_function_privilege('tenant_app', 'public.open_next_attempt(uuid, uuid, uuid)', 'execute') then
    raise exception '20260926100900: open_next_attempt is callable by tenant_app';
  end if;
  if position('value_ciphertext is null' in (select prosrc from pg_proc where proname = 'open_next_attempt' limit 1)) = 0 then
    raise exception '20260926100900: open_next_attempt may copy ciphertext bound to the old application';
  end if;
end $$;

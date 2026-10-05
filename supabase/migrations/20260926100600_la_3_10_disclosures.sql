-- LA-3 step 9 — application disclosures (LA-3.10).
--
-- docs/la3/SCHEMA-PLAN.md "Step 9" is the specification. In short:
--
--   application_disclosures          NEW   the disclosure library (tenant_id null = platform)
--   application_disclosure_rules     NEW   when one is required: ANDed {field, op, value} clauses
--   tenant_application_disclosures   NEW   per attempt: required / acknowledged / not applicable
--   REPLACEMENT_NOTICE, 1035_EXCHANGE SEED  platform, published, with their rules
--
-- Separate from state_disclosures (LA-2.23 call scripts). The seeded bodies are plain generic text:
-- the carrier's and the state's own replacement forms are still the ones the client signs, and a
-- tenant publishes its own version (version N + 1, or a tenant row) with the exact wording it uses.
-- Rule fields name interview answers as `health.<question_key>` (20260926100100's
-- existing_coverage and existing_cash_value).
--
-- Down (only while no row exists in tenant_application_disclosures):
--   drop table public.tenant_application_disclosures, public.application_disclosure_rules,
--              public.application_disclosures;

-- ── 1 · the library ─────────────────────────────────────────────────────────
create table if not exists public.application_disclosures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_]{1,63}$'),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body_markdown text not null check (char_length(body_markdown) between 1 and 20000),
  attachment_path text check (attachment_path is null or char_length(attachment_path) <= 500),
  states text[],
  carrier_ids uuid[],
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists application_disclosures_version_unique
  on public.application_disclosures (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), code, version);
create index if not exists application_disclosures_tenant_idx
  on public.application_disclosures (tenant_id, status) where tenant_id is not null;

alter table public.application_disclosures enable row level security;
drop policy if exists application_disclosures_tenant_read on public.application_disclosures;
create policy application_disclosures_tenant_read on public.application_disclosures
  for select to tenant_app
  using (tenant_id is null or tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists application_disclosures_tenant_scoped on public.application_disclosures;
create policy application_disclosures_tenant_scoped on public.application_disclosures
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.application_disclosures to tenant_app;
grant select, insert, update, delete on public.application_disclosures to service_role;

-- ── 2 · rules ───────────────────────────────────────────────────────────────
create table if not exists public.application_disclosure_rules (
  id uuid primary key default gen_random_uuid(),
  disclosure_id uuid not null references public.application_disclosures(id) on delete cascade,
  clauses jsonb not null,
  created_at timestamptz not null default now(),
  constraint application_disclosure_rules_clauses_shape check (
    jsonb_typeof(clauses) = 'array'
    and jsonb_array_length(clauses) > 0
    and not jsonb_path_exists(clauses,
      '$[*] ? (!exists(@.field) || !(@.field.type() == "string") || !exists(@.value) || !(@.op == "eq" || @.op == "neq" || @.op == "in" || @.op == "not_in" || @.op == "gt" || @.op == "lt"))')
  )
);
create index if not exists application_disclosure_rules_disclosure_idx on public.application_disclosure_rules (disclosure_id);

-- No tenant_id: scoped through the disclosure it belongs to.
alter table public.application_disclosure_rules enable row level security;
drop policy if exists application_disclosure_rules_tenant_read on public.application_disclosure_rules;
create policy application_disclosure_rules_tenant_read on public.application_disclosure_rules
  for select to tenant_app
  using (exists (select 1 from public.application_disclosures d
                  where d.id = application_disclosure_rules.disclosure_id
                    and (d.tenant_id is null or d.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)));
drop policy if exists application_disclosure_rules_tenant_scoped on public.application_disclosure_rules;
create policy application_disclosure_rules_tenant_scoped on public.application_disclosure_rules
  for all to tenant_app
  using (exists (select 1 from public.application_disclosures d
                  where d.id = application_disclosure_rules.disclosure_id
                    and d.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid))
  with check (exists (select 1 from public.application_disclosures d
                       where d.id = application_disclosure_rules.disclosure_id
                         and d.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid));
grant select on public.application_disclosure_rules to tenant_app;
grant select, insert, update, delete on public.application_disclosure_rules to service_role;

-- ── 3 · per attempt ─────────────────────────────────────────────────────────
create table if not exists public.tenant_application_disclosures (
  application_id uuid not null references public.tenant_applications(id) on delete cascade,
  disclosure_id uuid not null references public.application_disclosures(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  disclosure_version integer not null check (disclosure_version > 0),
  status text not null default 'required' check (status in ('required', 'acknowledged', 'not_applicable')),
  method text check (method is null or method in ('read_aloud', 'emailed', 'mailed')),
  note text check (note is null or char_length(note) <= 1000),
  acknowledged_by uuid references public.users(id) on delete set null,
  acknowledged_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (application_id, disclosure_id),
  constraint tenant_application_disclosures_na_has_note
    check (status <> 'not_applicable' or nullif(btrim(coalesce(note, '')), '') is not null),
  constraint tenant_application_disclosures_ack_has_method
    check (status <> 'acknowledged' or method is not null)
);
create index if not exists tenant_application_disclosures_disclosure_idx on public.tenant_application_disclosures (disclosure_id);
create index if not exists tenant_application_disclosures_tenant_idx on public.tenant_application_disclosures (tenant_id, status);

alter table public.tenant_application_disclosures enable row level security;
drop policy if exists tenant_application_disclosures_tenant_scoped on public.tenant_application_disclosures;
create policy tenant_application_disclosures_tenant_scoped on public.tenant_application_disclosures
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_application_disclosures to tenant_app;
grant select, insert, update, delete on public.tenant_application_disclosures to service_role;

drop trigger if exists application_disclosures_touch on public.application_disclosures;
create trigger application_disclosures_touch before update on public.application_disclosures
  for each row execute function public.la3_touch_updated_at();
drop trigger if exists tenant_application_disclosures_touch on public.tenant_application_disclosures;
create trigger tenant_application_disclosures_touch before update on public.tenant_application_disclosures
  for each row execute function public.la3_touch_updated_at();

-- ── 4 · seed ────────────────────────────────────────────────────────────────
insert into public.application_disclosures (tenant_id, code, title, body_markdown, version, status) values
  (null, 'REPLACEMENT_NOTICE', 'Notice regarding replacement of life insurance', $body$
You told us you have life insurance now. If the policy we are applying for will **replace** that
coverage, or if you plan to let it lapse, surrender it or borrow against it to pay for the new one,
this is a replacement.

Before you decide:

- Keep your current policy in force until the new policy is issued and you have accepted it.
- A new policy may have a new contestability and suicide period, and a waiting period on the
  full death benefit, that your current policy has already passed.
- Your premium on a new policy is based on your age and health today.
- You may lose benefits, cash value or guarantees you have under your current policy.
- You have the right to a free-look period after the new policy is delivered.

The carrier's own replacement form, where your state requires one, is part of this application
and must be completed and signed. Ask any question you have before we continue.
$body$, 1, 'published'),
  (null, '1035_EXCHANGE', 'Section 1035 exchange of an existing policy', $body$
You told us your current policy has a cash value that you plan to move to the new policy. Moving it
directly from one insurer to another can be done as a **Section 1035 exchange**, which lets the
value transfer without it being treated as a taxable withdrawal.

Before you decide:

- The exchange is requested on the carrier's own 1035 exchange and absolute assignment forms, which
  you sign; the current insurer releases the value directly to the new one.
- Your current insurer may charge a surrender charge, and any outstanding policy loan may reduce
  the amount transferred or be taxable.
- The new policy's coverage and costs are not the same as your current policy's.
- This is not tax advice. Talk to a tax professional if you are unsure how the exchange affects you.

The replacement notice also applies and must be acknowledged.
$body$, 1, 'published')
on conflict do nothing;

insert into public.application_disclosure_rules (disclosure_id, clauses)
select d.id, '[{"field": "health.existing_coverage", "op": "eq", "value": true}]'::jsonb
  from public.application_disclosures d
 where d.tenant_id is null and d.code = 'REPLACEMENT_NOTICE' and d.version = 1
   and not exists (select 1 from public.application_disclosure_rules r where r.disclosure_id = d.id);

insert into public.application_disclosure_rules (disclosure_id, clauses)
select d.id, '[{"field": "health.existing_coverage", "op": "eq", "value": true},
               {"field": "health.existing_cash_value", "op": "eq", "value": true}]'::jsonb
  from public.application_disclosures d
 where d.tenant_id is null and d.code = '1035_EXCHANGE' and d.version = 1
   and not exists (select 1 from public.application_disclosure_rules r where r.disclosure_id = d.id);

-- ── 5 · checks ──────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from public.application_disclosures
       where tenant_id is null and status = 'published' and version = 1
         and code in ('REPLACEMENT_NOTICE', '1035_EXCHANGE')) <> 2 then
    raise exception '20260926100600: the two platform disclosures are missing';
  end if;
  if not exists (select 1 from public.application_disclosure_rules r
                   join public.application_disclosures d on d.id = r.disclosure_id
                  where d.tenant_id is null and d.code = 'REPLACEMENT_NOTICE'
                    and r.clauses @> '[{"field": "health.existing_coverage", "op": "eq", "value": true}]'::jsonb) then
    raise exception '20260926100600: the replacement notice has no existing-coverage rule';
  end if;
  if not exists (select 1 from public.application_disclosure_rules r
                   join public.application_disclosures d on d.id = r.disclosure_id
                  where d.tenant_id is null and d.code = '1035_EXCHANGE' and jsonb_array_length(r.clauses) = 2
                    and r.clauses @> '[{"field": "health.existing_cash_value", "op": "eq", "value": true}]'::jsonb) then
    raise exception '20260926100600: the 1035 exchange has no existing-coverage-and-cash-value rule';
  end if;
  -- A malformed clause is refused.
  begin
    insert into public.application_disclosure_rules (disclosure_id, clauses)
    select id, '[{"field": "health.x", "op": "contains", "value": 1}]'::jsonb
      from public.application_disclosures where code = 'REPLACEMENT_NOTICE' limit 1;
    raise exception '20260926100600: a rule with an unknown operator was accepted';
  exception when check_violation then
    null;
  end;
end $$;

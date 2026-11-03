-- LA-3 step 2 — sales templates: underwriting (LA-3.1), quotation (LA-3.4), application field sets (LA-3.7).
--
-- docs/la3/SCHEMA-PLAN.md "Step 2", the note "Revised 2026-09-28", is the specification. In short:
--
--   sales_templates   NEW   a registry beside LA-1.4's templates, never a second engine
--   4 platform rows   SEED  FE general intake, Term Life standard, FE generic quotation, FE field set
--
-- `templates` / `tenant_templates` and every function that writes them are NOT touched: replacing
-- their UNIQUE (tenant_id, product_code) would break the three live `on conflict (tenant_id,
-- product_code)` targets (admin template apply among them). The definition is exactly LA-1.4's
-- {fields: TemplateField[], form_definition: TemplateFormDefinition} shape, validated by Zod in the
-- app, plus `age_basis` for quotation and `required` / `optional` for a field set. Knockouts
-- (`is_knockout`, `knockout_when`, `knockout_note`) sit on the form fields beside `show_when`;
-- the five persistency questions carry `"persistency": true` on their field.
--
-- A published (or retired) row is immutable: editing makes version N + 1. Draft rows are editable.
--
-- Down (only while nothing references a row — tenant_uw_interviews and tenant_quotes point here):
--   drop table public.sales_templates;
--   drop function public.sales_templates_guard_published();

-- ── 1 · the registry ────────────────────────────────────────────────────────
create table if not exists public.sales_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('underwriting', 'quotation', 'application_field_set')),
  product_code text not null references public.products(code) on delete restrict,
  carrier_id uuid references public.carriers(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  definition jsonb not null default '{}'::jsonb check (jsonb_typeof(definition) = 'object'),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint sales_templates_published_dated check (status = 'draft' or published_at is not null)
);

create unique index if not exists sales_templates_version_unique
  on public.sales_templates (
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    kind,
    product_code,
    coalesce(carrier_id, '00000000-0000-0000-0000-000000000000'::uuid),
    version
  );
create index if not exists sales_templates_lookup_idx
  on public.sales_templates (tenant_id, kind, product_code, status);
create index if not exists sales_templates_carrier_idx
  on public.sales_templates (carrier_id) where carrier_id is not null;

-- Platform rows (tenant_id null) are readable by every tenant; a tenant writes only its own rows.
alter table public.sales_templates enable row level security;
drop policy if exists sales_templates_tenant_read on public.sales_templates;
create policy sales_templates_tenant_read on public.sales_templates
  for select to tenant_app
  using (tenant_id is null or tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists sales_templates_tenant_scoped on public.sales_templates;
create policy sales_templates_tenant_scoped on public.sales_templates
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.sales_templates to tenant_app;
grant select, insert, update, delete on public.sales_templates to service_role;

-- ── 2 · published rows are immutable ────────────────────────────────────────
--
-- Allowed on a published row: published → retired (status and updated_at only). Nothing on a
-- retired row changes, and neither can be deleted — an interview or quote records the version it
-- was taken on, so the version it names has to stay what it was.
create or replace function public.sales_templates_guard_published()
returns trigger language plpgsql as $function$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'SALES_TEMPLATE_PUBLISHED_IMMUTABLE: % v% is %, it cannot be deleted', old.name, old.version, old.status;
    end if;
    return old;
  end if;

  if old.status in ('published', 'retired') then
    if new.definition is distinct from old.definition
       or (new.tenant_id, new.kind, new.product_code, new.carrier_id, new.version, new.name, new.published_at)
          is distinct from (old.tenant_id, old.kind, old.product_code, old.carrier_id, old.version, old.name, old.published_at) then
      raise exception 'SALES_TEMPLATE_PUBLISHED_IMMUTABLE: % v% is %; edit a new version instead', old.name, old.version, old.status;
    end if;
    if new.status is distinct from old.status and not (old.status = 'published' and new.status = 'retired') then
      raise exception 'SALES_TEMPLATE_PUBLISHED_IMMUTABLE: % v% cannot go from % to %', old.name, old.version, old.status, new.status;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists sales_templates_guard_published on public.sales_templates;
create trigger sales_templates_guard_published before update or delete on public.sales_templates
  for each row execute function public.sales_templates_guard_published();
drop trigger if exists sales_templates_touch on public.sales_templates;
create trigger sales_templates_touch before update on public.sales_templates
  for each row execute function public.la3_touch_updated_at();

-- ── 3 · seed: platform defaults, published, version 1 ───────────────────────

-- (a) Final Expense — general intake (underwriting). The five persistency questions first, then
-- health with knockouts and follow-ups, medications, notes. `existing_cash_value` is the follow-up
-- the 1035_EXCHANGE disclosure rule reads (20260926100600).
insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'underwriting', p.code, null, 'Final Expense — general intake', 1, 'published', $def${
  "fields": [
    {"field_key": "ss_deposit_day", "label": "When does your Social Security arrive?", "type": "single_select", "is_required": true,
     "options": ["2nd Wednesday", "3rd Wednesday", "4th Wednesday", "The 3rd", "The 1st (SSI)", "Not on Social Security"],
     "sort_order": 10, "help_text": "Sets the draft date — the biggest lever on month-4 lapse.", "persistency": true},
    {"field_key": "deposit_account", "label": "Is the account you'll pay from the one it lands in?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 20, "help_text": null, "persistency": true},
    {"field_key": "decision_maker", "label": "Does anyone else need to be on this call?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 30, "help_text": null, "persistency": true},
    {"field_key": "existing_coverage", "label": "Do you have any life insurance now?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 40, "help_text": "A yes brings up the replacement notice.", "persistency": true},
    {"field_key": "existing_cash_value", "label": "Does that policy have a cash value you plan to move to the new one?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 45, "help_text": "A yes brings up the 1035 exchange form."},
    {"field_key": "can_receive_text", "label": "Can you get a text or email without hanging up?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 50, "help_text": null, "persistency": true},
    {"field_key": "oxygen", "label": "In the last 2 years, have you used oxygen equipment?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 100, "help_text": null},
    {"field_key": "dialysis", "label": "Are you on kidney dialysis?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 110, "help_text": null},
    {"field_key": "cancer", "label": "Have you been diagnosed with or treated for cancer in the last 3 years?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 120, "help_text": null},
    {"field_key": "cancer_when", "label": "When was it diagnosed?", "type": "date", "is_required": false,
     "options": [], "sort_order": 121, "help_text": null},
    {"field_key": "cancer_type", "label": "What type?", "type": "text", "is_required": false,
     "options": [], "sort_order": 122, "help_text": null},
    {"field_key": "heart", "label": "Have you had heart failure, a heart attack or heart surgery in the last 2 years?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 130, "help_text": null},
    {"field_key": "diabetes", "label": "Do you have diabetes?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 140, "help_text": null},
    {"field_key": "diabetes_insulin", "label": "Do you use insulin?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 141, "help_text": null},
    {"field_key": "medications", "label": "Medications", "type": "medication_list", "is_required": false,
     "options": [], "sort_order": 200, "help_text": "Name, dose, since when and what it is for."},
    {"field_key": "notes", "label": "Anything else the carrier should know", "type": "long_text", "is_required": false,
     "options": [], "sort_order": 300, "help_text": null}
  ],
  "form_definition": {"sections": [
    {"section_key": "before", "label": "Before we start", "sort_order": 10, "fields": [
      {"field_key": "ss_deposit_day", "is_required": true, "show_when": null},
      {"field_key": "deposit_account", "is_required": true, "show_when": null},
      {"field_key": "decision_maker", "is_required": false, "show_when": null},
      {"field_key": "existing_coverage", "is_required": true, "show_when": null},
      {"field_key": "existing_cash_value", "is_required": false, "show_when": {"field_key": "existing_coverage", "equals": "true"}},
      {"field_key": "can_receive_text", "is_required": false, "show_when": null}
    ]},
    {"section_key": "health", "label": "Health", "sort_order": 20, "fields": [
      {"field_key": "oxygen", "is_required": true, "show_when": null,
       "is_knockout": true, "knockout_when": {"equals": "true"}, "knockout_note": "Most carriers decline oxygen use in the last 2 years or offer guaranteed issue only."},
      {"field_key": "dialysis", "is_required": true, "show_when": null,
       "is_knockout": true, "knockout_when": {"equals": "true"}, "knockout_note": "Most carriers decline applicants on dialysis; guaranteed issue only."},
      {"field_key": "cancer", "is_required": true, "show_when": null},
      {"field_key": "cancer_when", "is_required": false, "show_when": {"field_key": "cancer", "equals": "true"}},
      {"field_key": "cancer_type", "is_required": false, "show_when": {"field_key": "cancer", "equals": "true"}},
      {"field_key": "heart", "is_required": true, "show_when": null},
      {"field_key": "diabetes", "is_required": true, "show_when": null},
      {"field_key": "diabetes_insulin", "is_required": false, "show_when": {"field_key": "diabetes", "equals": "true"}}
    ]},
    {"section_key": "medications", "label": "Medications", "sort_order": 30, "fields": [
      {"field_key": "medications", "is_required": false, "show_when": null}
    ]},
    {"section_key": "notes", "label": "Notes", "sort_order": 40, "fields": [
      {"field_key": "notes", "is_required": false, "show_when": null}
    ]}
  ]}
}$def$::jsonb, now()
  from public.products p
 where p.code = 'final_expense'
on conflict do nothing;

-- (b) Term Life — standard (underwriting): build chart, driving, aviation and avocations, travel,
-- family history before 60, financial justification, and the same five persistency questions.
insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'underwriting', p.code, null, 'Term Life — standard', 1, 'published', $def${
  "fields": [
    {"field_key": "ss_deposit_day", "label": "When does your Social Security arrive?", "type": "single_select", "is_required": true,
     "options": ["2nd Wednesday", "3rd Wednesday", "4th Wednesday", "The 3rd", "The 1st (SSI)", "Not on Social Security"],
     "sort_order": 10, "help_text": "Sets the draft date — the biggest lever on month-4 lapse.", "persistency": true},
    {"field_key": "deposit_account", "label": "Is the account you'll pay from the one it lands in?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 20, "help_text": null, "persistency": true},
    {"field_key": "decision_maker", "label": "Does anyone else need to be on this call?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 30, "help_text": null, "persistency": true},
    {"field_key": "existing_coverage", "label": "Do you have any life insurance now?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 40, "help_text": "A yes brings up the replacement notice.", "persistency": true},
    {"field_key": "existing_cash_value", "label": "Does that policy have a cash value you plan to move to the new one?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 45, "help_text": "A yes brings up the 1035 exchange form."},
    {"field_key": "can_receive_text", "label": "Can you get a text or email without hanging up?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 50, "help_text": null, "persistency": true},
    {"field_key": "height_in", "label": "Height (inches)", "type": "number", "is_required": true,
     "options": [], "sort_order": 100, "help_text": "Read against the carrier's build chart."},
    {"field_key": "weight_lb", "label": "Weight (pounds)", "type": "number", "is_required": true,
     "options": [], "sort_order": 110, "help_text": "Read against the carrier's build chart."},
    {"field_key": "weight_change", "label": "Have you gained or lost more than 20 pounds in the last 12 months?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 120, "help_text": null},
    {"field_key": "driving_dui", "label": "Any DUI or DWI in the last 5 years?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 200, "help_text": null},
    {"field_key": "driving_violations", "label": "How many moving violations in the last 3 years?", "type": "number", "is_required": true,
     "options": [], "sort_order": 210, "help_text": null},
    {"field_key": "driving_suspended", "label": "Has your driver's license been suspended or revoked in the last 5 years?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 220, "help_text": null},
    {"field_key": "aviation", "label": "Do you fly as a pilot, student pilot or crew member (other than as a fare-paying passenger)?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 300, "help_text": null},
    {"field_key": "aviation_details", "label": "Aircraft, hours flown per year and certificates held", "type": "long_text", "is_required": false,
     "options": [], "sort_order": 301, "help_text": null},
    {"field_key": "hazardous_avocations", "label": "Do you take part in scuba diving, skydiving, climbing, motor racing or other hazardous activities?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 310, "help_text": null},
    {"field_key": "hazardous_avocations_details", "label": "Which activities, and how often?", "type": "long_text", "is_required": false,
     "options": [], "sort_order": 311, "help_text": null},
    {"field_key": "foreign_travel", "label": "Do you plan to travel or live outside the United States in the next 2 years?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 320, "help_text": null},
    {"field_key": "foreign_travel_details", "label": "Where, and for how long?", "type": "long_text", "is_required": false,
     "options": [], "sort_order": 321, "help_text": null},
    {"field_key": "family_cardiac_before_60", "label": "Has a parent or sibling died of, or been diagnosed with, heart disease before age 60?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 400, "help_text": null},
    {"field_key": "family_cancer_before_60", "label": "Has a parent or sibling died of, or been diagnosed with, cancer before age 60?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 410, "help_text": null},
    {"field_key": "annual_income", "label": "Annual earned income", "type": "currency", "is_required": true,
     "options": [], "sort_order": 500, "help_text": "Carriers cap face amount at a multiple of income."},
    {"field_key": "net_worth", "label": "Household net worth", "type": "currency", "is_required": false,
     "options": [], "sort_order": 510, "help_text": null},
    {"field_key": "coverage_purpose", "label": "What is the coverage for?", "type": "single_select", "is_required": true,
     "options": ["Income replacement", "Mortgage protection", "Debt payoff", "Final expenses", "Business or key person", "Estate planning"],
     "sort_order": 520, "help_text": null},
    {"field_key": "medications", "label": "Medications", "type": "medication_list", "is_required": false,
     "options": [], "sort_order": 600, "help_text": "Name, dose, since when and what it is for."},
    {"field_key": "notes", "label": "Anything else the carrier should know", "type": "long_text", "is_required": false,
     "options": [], "sort_order": 700, "help_text": null}
  ],
  "form_definition": {"sections": [
    {"section_key": "before", "label": "Before we start", "sort_order": 10, "fields": [
      {"field_key": "ss_deposit_day", "is_required": true, "show_when": null},
      {"field_key": "deposit_account", "is_required": true, "show_when": null},
      {"field_key": "decision_maker", "is_required": false, "show_when": null},
      {"field_key": "existing_coverage", "is_required": true, "show_when": null},
      {"field_key": "existing_cash_value", "is_required": false, "show_when": {"field_key": "existing_coverage", "equals": "true"}},
      {"field_key": "can_receive_text", "is_required": false, "show_when": null}
    ]},
    {"section_key": "build", "label": "Height and weight", "sort_order": 20, "fields": [
      {"field_key": "height_in", "is_required": true, "show_when": null},
      {"field_key": "weight_lb", "is_required": true, "show_when": null},
      {"field_key": "weight_change", "is_required": false, "show_when": null}
    ]},
    {"section_key": "driving", "label": "Driving record", "sort_order": 30, "fields": [
      {"field_key": "driving_dui", "is_required": true, "show_when": null},
      {"field_key": "driving_violations", "is_required": true, "show_when": null},
      {"field_key": "driving_suspended", "is_required": true, "show_when": null}
    ]},
    {"section_key": "lifestyle", "label": "Aviation, avocations and travel", "sort_order": 40, "fields": [
      {"field_key": "aviation", "is_required": true, "show_when": null},
      {"field_key": "aviation_details", "is_required": false, "show_when": {"field_key": "aviation", "equals": "true"}},
      {"field_key": "hazardous_avocations", "is_required": true, "show_when": null},
      {"field_key": "hazardous_avocations_details", "is_required": false, "show_when": {"field_key": "hazardous_avocations", "equals": "true"}},
      {"field_key": "foreign_travel", "is_required": true, "show_when": null},
      {"field_key": "foreign_travel_details", "is_required": false, "show_when": {"field_key": "foreign_travel", "equals": "true"}}
    ]},
    {"section_key": "family", "label": "Family history", "sort_order": 50, "fields": [
      {"field_key": "family_cardiac_before_60", "is_required": true, "show_when": null},
      {"field_key": "family_cancer_before_60", "is_required": true, "show_when": null}
    ]},
    {"section_key": "financial", "label": "Financial justification", "sort_order": 60, "fields": [
      {"field_key": "annual_income", "is_required": true, "show_when": null},
      {"field_key": "net_worth", "is_required": false, "show_when": null},
      {"field_key": "coverage_purpose", "is_required": true, "show_when": null}
    ]},
    {"section_key": "medications", "label": "Medications", "sort_order": 70, "fields": [
      {"field_key": "medications", "is_required": false, "show_when": null}
    ]},
    {"section_key": "notes", "label": "Notes", "sort_order": 80, "fields": [
      {"field_key": "notes", "is_required": false, "show_when": null}
    ]}
  ]}
}$def$::jsonb, now()
  from public.products p
 where p.code = 'term_life'
on conflict do nothing;

-- (c) Final Expense — generic quotation, no carrier. Face amount is currency, held in cents.
insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'quotation', p.code, null, 'Final Expense — generic', 1, 'published', $def${
  "age_basis": "nearest",
  "fields": [
    {"field_key": "dob", "label": "Date of birth", "type": "date", "is_required": true, "options": [], "sort_order": 10, "help_text": null},
    {"field_key": "gender", "label": "Gender", "type": "single_select", "is_required": true, "options": ["Male", "Female"], "sort_order": 20, "help_text": null},
    {"field_key": "state", "label": "State", "type": "single_select", "is_required": true,
     "options": ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"],
     "sort_order": 30, "help_text": null},
    {"field_key": "tobacco", "label": "Tobacco or nicotine in the last 12 months", "type": "boolean", "is_required": true, "options": [], "sort_order": 40, "help_text": null},
    {"field_key": "face_amount", "label": "Face amount", "type": "currency", "is_required": true, "options": [], "sort_order": 50, "help_text": null},
    {"field_key": "tier", "label": "Tier", "type": "single_select", "is_required": true, "options": ["level", "graded", "modified", "gi"], "sort_order": 60, "help_text": null},
    {"field_key": "riders", "label": "Riders", "type": "multi_select", "is_required": false,
     "options": ["Accidental death", "Child rider", "Grandchild rider", "Terminal illness", "Waiver of premium"], "sort_order": 70, "help_text": null}
  ],
  "form_definition": {"sections": [
    {"section_key": "quote", "label": "Quote", "sort_order": 10, "fields": [
      {"field_key": "dob", "is_required": true, "show_when": null},
      {"field_key": "gender", "is_required": true, "show_when": null},
      {"field_key": "state", "is_required": true, "show_when": null},
      {"field_key": "tobacco", "is_required": true, "show_when": null},
      {"field_key": "face_amount", "is_required": true, "show_when": null},
      {"field_key": "tier", "is_required": true, "show_when": null},
      {"field_key": "riders", "is_required": false, "show_when": null}
    ]}
  ]}
}$def$::jsonb, now()
  from public.products p
 where p.code = 'final_expense'
on conflict do nothing;

-- (d) Final Expense — platform default application field set: canonical keys (LA-3.7).
insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'application_field_set', p.code, null, 'Final Expense — platform default', 1, 'published', $def${
  "required": ["insured.first_name", "insured.last_name", "insured.dob", "insured.gender", "insured.ssn", "insured.height_in",
               "insured.weight_lb", "insured.tobacco", "contact.phone", "addr.line1", "addr.city", "addr.state", "addr.zip"],
  "optional": ["insured.middle_initial", "insured.birth_state", "contact.email", "addr.line2", "addr.years_at",
               "owner.same_as_insured", "owner.first_name", "owner.last_name", "owner.dob", "owner.relationship"]
}$def$::jsonb, now()
  from public.products p
 where p.code = 'final_expense'
on conflict do nothing;

-- ── 4 · checks ──────────────────────────────────────────────────────────────
do $$
declare
  v_id uuid;
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'sales_templates_version_unique') then
    raise exception '20260926100100: one row per (tenant, kind, product, carrier, version) is not enforced';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'sales_templates_guard_published' and not tgisinternal) then
    raise exception '20260926100100: published sales templates are not guarded';
  end if;
  if (select count(*) from public.sales_templates
       where tenant_id is null and status = 'published' and version = 1
         and (kind, product_code, name) in (('underwriting', 'final_expense', 'Final Expense — general intake'),
                                             ('underwriting', 'term_life', 'Term Life — standard'),
                                             ('quotation', 'final_expense', 'Final Expense — generic'),
                                             ('application_field_set', 'final_expense', 'Final Expense — platform default'))) <> 4 then
    raise exception '20260926100100: the four platform sales templates are missing';
  end if;
  if exists (select 1 from public.sales_templates t
              where t.tenant_id is null and t.kind = 'underwriting' and t.version = 1
                and (select count(*) from jsonb_array_elements(t.definition->'fields') f
                      where f->>'persistency' = 'true'
                        and f->>'field_key' in ('ss_deposit_day', 'deposit_account', 'decision_maker', 'existing_coverage', 'can_receive_text')) <> 5) then
    raise exception '20260926100100: a platform underwriting template lacks the five persistency questions';
  end if;
  if (select definition->>'age_basis' from public.sales_templates
       where tenant_id is null and kind = 'quotation' and product_code = 'final_expense' and version = 1) is distinct from 'nearest' then
    raise exception '20260926100100: the FE quotation template has no nearest-age basis';
  end if;

  -- A published definition cannot be edited (the update is rolled back with the sub-block).
  select id into v_id from public.sales_templates where tenant_id is null and status = 'published' limit 1;
  begin
    update public.sales_templates set definition = definition || '{"probe": true}'::jsonb where id = v_id;
    raise exception '20260926100100: a published sales template was edited';
  exception when others then
    if sqlerrm not like 'SALES_TEMPLATE_PUBLISHED_IMMUTABLE%' then raise; end if;
  end;
end $$;

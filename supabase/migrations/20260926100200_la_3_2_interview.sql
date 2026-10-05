-- LA-3 step 3 — the underwriting interview and medications (LA-3.2).
--
-- docs/la3/SCHEMA-PLAN.md "Step 3" is the specification. In short:
--
--   tenant_uw_interviews      NEW  one per insured per CASE, so it carries across attempts uncopied
--   tenant_uw_answers         NEW  one row per question; hidden follow-ups are pruned on save
--   tenant_uw_answer_changes  NEW  post-call amend audit, append-only
--   tenant_medications        NEW  the medication list, "prescribed for: unknown" is explicit
--   medication_names          NEW  platform autocomplete list (generic names), free entry always allowed
--
-- The interview points at sales_templates (20260926100100) — the Revised Step 2 registry — and
-- records the version it was taken on. Step 11 freezes answers and medications onto the submission
-- row, because the interview is shared by every attempt on the case.
--
-- Down (only while no row exists in the new tables):
--   drop table public.tenant_medications, public.tenant_uw_answer_changes, public.tenant_uw_answers,
--              public.tenant_uw_interviews, public.medication_names;

-- ── 1 · the interview ───────────────────────────────────────────────────────
create table if not exists public.tenant_uw_interviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  case_id uuid not null references public.tenant_application_cases(id) on delete cascade,
  insured_role text not null default 'primary' check (insured_role in ('primary', 'spouse')),
  sales_template_id uuid not null references public.sales_templates(id) on delete restrict,
  template_version integer not null check (template_version > 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  started_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint tenant_uw_interviews_one_per_insured unique (case_id, insured_role),
  constraint tenant_uw_interviews_completed_after_start check (completed_at is null or completed_at >= started_at)
);
create index if not exists tenant_uw_interviews_tenant_idx on public.tenant_uw_interviews (tenant_id, case_id);
create index if not exists tenant_uw_interviews_template_idx on public.tenant_uw_interviews (sales_template_id);

alter table public.tenant_uw_interviews enable row level security;
drop policy if exists tenant_uw_interviews_tenant_scoped on public.tenant_uw_interviews;
create policy tenant_uw_interviews_tenant_scoped on public.tenant_uw_interviews
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_uw_interviews to tenant_app;
grant select, insert, update on public.tenant_uw_interviews to service_role;

-- ── 2 · answers ─────────────────────────────────────────────────────────────
create table if not exists public.tenant_uw_answers (
  interview_id uuid not null references public.tenant_uw_interviews(id) on delete cascade,
  question_key text not null check (question_key ~ '^[a-z][a-z0-9_]*$'),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  value jsonb,
  notes text check (notes is null or char_length(notes) <= 2000),
  answered_at timestamptz not null default now(),
  answered_by uuid references public.users(id) on delete set null,
  primary key (interview_id, question_key)
);
create index if not exists tenant_uw_answers_tenant_idx on public.tenant_uw_answers (tenant_id);

alter table public.tenant_uw_answers enable row level security;
drop policy if exists tenant_uw_answers_tenant_scoped on public.tenant_uw_answers;
create policy tenant_uw_answers_tenant_scoped on public.tenant_uw_answers
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_uw_answers to tenant_app;
-- delete: a hidden follow-up's value is removed on save (pruneHiddenTemplateValues).
grant select, insert, update, delete on public.tenant_uw_answers to service_role;

-- ── 3 · post-call amendments (written only once completed_at is set) ────────
create table if not exists public.tenant_uw_answer_changes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  interview_id uuid not null references public.tenant_uw_interviews(id) on delete cascade,
  question_key text not null check (question_key ~ '^[a-z][a-z0-9_]*$'),
  old_value jsonb,
  new_value jsonb,
  changed_by uuid references public.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  reason text check (reason is null or char_length(reason) <= 500)
);
create index if not exists tenant_uw_answer_changes_interview_idx on public.tenant_uw_answer_changes (interview_id, changed_at desc);
create index if not exists tenant_uw_answer_changes_tenant_idx on public.tenant_uw_answer_changes (tenant_id);

alter table public.tenant_uw_answer_changes enable row level security;
drop policy if exists tenant_uw_answer_changes_tenant_scoped on public.tenant_uw_answer_changes;
create policy tenant_uw_answer_changes_tenant_scoped on public.tenant_uw_answer_changes
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_uw_answer_changes to tenant_app;
-- Append-only, like tenant_sensitive_access_log.
grant select, insert on public.tenant_uw_answer_changes to service_role;
revoke update, delete, truncate on public.tenant_uw_answer_changes from service_role, tenant_app, anon, authenticated;

-- ── 4 · medications ─────────────────────────────────────────────────────────
create table if not exists public.tenant_medications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  interview_id uuid not null references public.tenant_uw_interviews(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  dose text check (dose is null or char_length(dose) <= 100),
  since text check (since is null or char_length(since) <= 40),
  prescribed_for text check (prescribed_for is null or char_length(prescribed_for) <= 200),
  prescribed_for_unknown boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 1000),
  sort_order integer not null default 0,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- "Unknown" is an answer, not a blank: it cannot sit beside a stated reason.
  constraint tenant_medications_unknown_has_no_reason check (not prescribed_for_unknown or prescribed_for is null)
);
create index if not exists tenant_medications_interview_idx on public.tenant_medications (interview_id, sort_order);
create index if not exists tenant_medications_tenant_idx on public.tenant_medications (tenant_id);

alter table public.tenant_medications enable row level security;
drop policy if exists tenant_medications_tenant_scoped on public.tenant_medications;
create policy tenant_medications_tenant_scoped on public.tenant_medications
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_medications to tenant_app;
grant select, insert, update, delete on public.tenant_medications to service_role;

drop trigger if exists tenant_uw_interviews_touch on public.tenant_uw_interviews;
create trigger tenant_uw_interviews_touch before update on public.tenant_uw_interviews
  for each row execute function public.la3_touch_updated_at();
drop trigger if exists tenant_medications_touch on public.tenant_medications;
create trigger tenant_medications_touch before update on public.tenant_medications
  for each row execute function public.la3_touch_updated_at();

-- ── 5 · the autocomplete list (platform) ────────────────────────────────────
--
-- Generic names as RxNorm displays them (lowercase ingredient names; combinations joined by "/").
-- The app matches case-insensitively and always accepts free text — a name missing here is still
-- a valid answer.
create table if not exists public.medication_names (
  name text primary key check (char_length(btrim(name)) between 1 and 120 and name = btrim(name)),
  generic_of text check (generic_of is null or char_length(generic_of) <= 120),
  rxcui text check (rxcui is null or rxcui ~ '^[0-9]{1,10}$')
);
create unique index if not exists medication_names_lower_idx on public.medication_names (lower(name) text_pattern_ops);

alter table public.medication_names enable row level security;
drop policy if exists medication_names_service_role_only on public.medication_names;
create policy medication_names_service_role_only on public.medication_names
  for all to service_role using (true) with check (true);
drop policy if exists medication_names_tenant_read on public.medication_names;
create policy medication_names_tenant_read on public.medication_names
  for select to tenant_app using (true);
grant select on public.medication_names to tenant_app;
grant select, insert, update, delete on public.medication_names to service_role;

insert into public.medication_names (name) values
  -- cardiac and blood pressure
  ('lisinopril'), ('enalapril'), ('ramipril'), ('benazepril'), ('quinapril'), ('fosinopril'), ('captopril'),
  ('perindopril'), ('trandolapril'), ('moexipril'), ('losartan'), ('valsartan'), ('irbesartan'), ('olmesartan'),
  ('telmisartan'), ('candesartan'), ('azilsartan'), ('sacubitril/valsartan'), ('amlodipine'), ('nifedipine'),
  ('felodipine'), ('diltiazem'), ('verapamil'), ('metoprolol tartrate'), ('metoprolol succinate'), ('atenolol'),
  ('carvedilol'), ('bisoprolol'), ('propranolol'), ('nebivolol'), ('labetalol'), ('nadolol'), ('sotalol'),
  ('hydrochlorothiazide'), ('chlorthalidone'), ('indapamide'), ('furosemide'), ('bumetanide'), ('torsemide'),
  ('spironolactone'), ('eplerenone'), ('triamterene/hydrochlorothiazide'), ('amiloride'), ('metolazone'),
  ('clonidine'), ('hydralazine'), ('minoxidil'), ('methyldopa'), ('doxazosin'), ('terazosin'), ('prazosin'),
  ('isosorbide mononitrate'), ('isosorbide dinitrate'), ('nitroglycerin'), ('ranolazine'), ('digoxin'),
  ('amiodarone'), ('dronedarone'), ('flecainide'), ('propafenone'), ('dofetilide'), ('ivabradine'), ('midodrine'),
  -- anticoagulants and antiplatelets
  ('warfarin'), ('apixaban'), ('rivaroxaban'), ('dabigatran'), ('edoxaban'), ('enoxaparin'), ('heparin'),
  ('clopidogrel'), ('prasugrel'), ('ticagrelor'), ('aspirin'), ('cilostazol'), ('dipyridamole'), ('pentoxifylline'),
  -- lipids
  ('atorvastatin'), ('simvastatin'), ('rosuvastatin'), ('pravastatin'), ('lovastatin'), ('pitavastatin'),
  ('ezetimibe'), ('fenofibrate'), ('gemfibrozil'), ('niacin'), ('icosapent ethyl'), ('omega-3-acid ethyl esters'),
  ('colesevelam'), ('evolocumab'), ('alirocumab'), ('bempedoic acid'),
  -- diabetes
  ('metformin'), ('glipizide'), ('glyburide'), ('glimepiride'), ('pioglitazone'), ('sitagliptin'), ('linagliptin'),
  ('saxagliptin'), ('alogliptin'), ('empagliflozin'), ('dapagliflozin'), ('canagliflozin'), ('ertugliflozin'),
  ('liraglutide'), ('semaglutide'), ('dulaglutide'), ('exenatide'), ('tirzepatide'), ('insulin glargine'),
  ('insulin detemir'), ('insulin degludec'), ('insulin lispro'), ('insulin aspart'), ('insulin glulisine'),
  ('insulin regular'), ('insulin isophane'), ('repaglinide'), ('nateglinide'), ('acarbose'),
  -- respiratory
  ('albuterol'), ('levalbuterol'), ('ipratropium'), ('tiotropium'), ('umeclidinium'), ('aclidinium'),
  ('salmeterol'), ('formoterol'), ('fluticasone'), ('fluticasone/salmeterol'), ('budesonide/formoterol'),
  ('fluticasone/umeclidinium/vilanterol'), ('budesonide'), ('mometasone'), ('beclomethasone'), ('ciclesonide'),
  ('montelukast'), ('theophylline'), ('roflumilast'), ('benzonatate'), ('guaifenesin'), ('cetirizine'),
  ('loratadine'), ('fexofenadine'), ('azelastine'), ('pirfenidone'), ('nintedanib'),
  -- pulmonary hypertension
  ('sildenafil'), ('tadalafil'), ('bosentan'), ('ambrisentan'), ('macitentan'), ('riociguat'),
  -- corticosteroids
  ('prednisone'), ('prednisolone'), ('methylprednisolone'), ('dexamethasone'), ('hydrocortisone'), ('fludrocortisone'),
  -- psychiatric
  ('sertraline'), ('fluoxetine'), ('paroxetine'), ('citalopram'), ('escitalopram'), ('fluvoxamine'),
  ('venlafaxine'), ('desvenlafaxine'), ('duloxetine'), ('bupropion'), ('mirtazapine'), ('trazodone'),
  ('amitriptyline'), ('nortriptyline'), ('imipramine'), ('doxepin'), ('vortioxetine'), ('vilazodone'),
  ('lithium'), ('quetiapine'), ('olanzapine'), ('risperidone'), ('aripiprazole'), ('ziprasidone'),
  ('haloperidol'), ('clozapine'), ('lurasidone'), ('paliperidone'), ('brexpiprazole'), ('cariprazine'),
  ('alprazolam'), ('lorazepam'), ('clonazepam'), ('diazepam'), ('temazepam'), ('buspirone'), ('hydroxyzine'),
  ('zolpidem'), ('eszopiclone'), ('methylphenidate'), ('dextroamphetamine/amphetamine'), ('atomoxetine'),
  ('naltrexone'), ('buprenorphine'), ('buprenorphine/naloxone'), ('disulfiram'), ('acamprosate'), ('varenicline'),
  -- neurological
  ('gabapentin'), ('pregabalin'), ('levetiracetam'), ('lamotrigine'), ('phenytoin'), ('carbamazepine'),
  ('oxcarbazepine'), ('divalproex sodium'), ('valproic acid'), ('topiramate'), ('lacosamide'), ('zonisamide'),
  ('phenobarbital'), ('primidone'), ('donepezil'), ('memantine'), ('rivastigmine'), ('galantamine'),
  ('carbidopa/levodopa'), ('pramipexole'), ('ropinirole'), ('rasagiline'), ('selegiline'), ('amantadine'),
  ('benztropine'), ('entacapone'), ('baclofen'), ('tizanidine'), ('cyclobenzaprine'), ('methocarbamol'),
  ('sumatriptan'), ('rizatriptan'), ('riluzole'), ('dalfampridine'), ('meclizine'),
  -- pain, gout and inflammation
  ('tramadol'), ('hydrocodone/acetaminophen'), ('oxycodone'), ('oxycodone/acetaminophen'), ('morphine'),
  ('hydromorphone'), ('fentanyl'), ('methadone'), ('tapentadol'), ('codeine'), ('acetaminophen'), ('ibuprofen'),
  ('naproxen'), ('meloxicam'), ('celecoxib'), ('diclofenac'), ('etodolac'), ('nabumetone'), ('indomethacin'),
  ('ketorolac'), ('lidocaine'), ('allopurinol'), ('febuxostat'), ('colchicine'), ('probenecid'), ('naloxone'),
  -- thyroid and hormones
  ('levothyroxine'), ('liothyronine'), ('thyroid'), ('methimazole'), ('propylthiouracil'), ('estradiol'),
  ('conjugated estrogens'), ('medroxyprogesterone'), ('progesterone'), ('testosterone'), ('desmopressin'),
  -- renal and urological
  ('sevelamer'), ('calcium acetate'), ('lanthanum carbonate'), ('cinacalcet'), ('calcitriol'), ('paricalcitol'),
  ('sodium bicarbonate'), ('epoetin alfa'), ('darbepoetin alfa'), ('ferric citrate'), ('patiromer'),
  ('sodium zirconium cyclosilicate'), ('sodium polystyrene sulfonate'), ('tamsulosin'), ('alfuzosin'),
  ('silodosin'), ('finasteride'), ('dutasteride'), ('oxybutynin'), ('tolterodine'), ('solifenacin'),
  ('mirabegron'), ('trospium'), ('bethanechol'),
  -- oncology and supportive care
  ('tamoxifen'), ('anastrozole'), ('letrozole'), ('exemestane'), ('leuprolide'), ('bicalutamide'),
  ('enzalutamide'), ('abiraterone'), ('capecitabine'), ('methotrexate'), ('hydroxyurea'), ('imatinib'),
  ('lenalidomide'), ('ibrutinib'), ('palbociclib'), ('cyclophosphamide'), ('pembrolizumab'), ('nivolumab'),
  ('trastuzumab'), ('rituximab'), ('megestrol'), ('ondansetron'), ('prochlorperazine'), ('promethazine'),
  ('filgrastim'), ('pegfilgrastim'),
  -- gastrointestinal and liver
  ('omeprazole'), ('esomeprazole'), ('pantoprazole'), ('lansoprazole'), ('rabeprazole'), ('dexlansoprazole'),
  ('famotidine'), ('sucralfate'), ('metoclopramide'), ('dicyclomine'), ('docusate'), ('sennosides'),
  ('polyethylene glycol 3350'), ('lactulose'), ('loperamide'), ('mesalamine'), ('rifaximin'), ('ursodiol'),
  ('linaclotide'), ('bisacodyl'),
  -- anti-infectives, HIV and hepatitis
  ('amoxicillin'), ('amoxicillin/clavulanate'), ('azithromycin'), ('ciprofloxacin'), ('levofloxacin'),
  ('doxycycline'), ('cephalexin'), ('sulfamethoxazole/trimethoprim'), ('nitrofurantoin'), ('metronidazole'),
  ('clindamycin'), ('valacyclovir'), ('acyclovir'), ('fluconazole'),
  ('bictegravir/emtricitabine/tenofovir alafenamide'), ('emtricitabine/tenofovir disoproxil fumarate'),
  ('dolutegravir'), ('sofosbuvir/velpatasvir'), ('entecavir'),
  -- immune and rheumatology
  ('hydroxychloroquine'), ('sulfasalazine'), ('leflunomide'), ('adalimumab'), ('etanercept'), ('infliximab'),
  ('tofacitinib'), ('tacrolimus'), ('mycophenolate mofetil'), ('cyclosporine'), ('azathioprine'),
  -- bone
  ('alendronate'), ('risedronate'), ('ibandronate'), ('zoledronic acid'), ('denosumab'), ('raloxifene'),
  ('teriparatide'),
  -- eye
  ('latanoprost'), ('timolol'), ('brimonidine'), ('dorzolamide'),
  -- vitamins, minerals and electrolytes
  ('cyanocobalamin'), ('folic acid'), ('ferrous sulfate'), ('potassium chloride'), ('magnesium oxide'),
  ('cholecalciferol'), ('ergocalciferol'), ('calcium carbonate'),
  -- smoking cessation
  ('nicotine')
on conflict do nothing;

-- ── 6 · checks ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_uw_interviews_one_per_insured' and contype = 'u') then
    raise exception '20260926100200: one interview per insured per case is not enforced';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_medications_unknown_has_no_reason' and contype = 'c') then
    raise exception '20260926100200: "prescribed for: unknown" can sit beside a stated reason';
  end if;
  if has_table_privilege('service_role', 'public.tenant_uw_answer_changes', 'UPDATE')
     or has_table_privilege('service_role', 'public.tenant_uw_answer_changes', 'DELETE') then
    raise exception '20260926100200: the amend audit is not append-only';
  end if;
  if (select count(*) from public.medication_names) < 300 then
    raise exception '20260926100200: the medication autocomplete list is short (% names)', (select count(*) from public.medication_names);
  end if;
end $$;

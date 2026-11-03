-- Settings defaults · Insurvas templates for every catalogue line (docs/settings/DEFAULTS.md, owner
-- pick 2026-11-03: "All lines, for review").
--
-- Before this, only Final Expense had all three Insurvas templates and Term Life had only health
-- questions, so every other line borrowed Final Expense's questions, quote inputs and field set
-- (pickTemplate / pickQuotationTemplate / fieldSetFor fall back to final_expense). This adds platform
-- rows (tenant_id null), published at version 1, so a new agency can work any line it switches on:
--
--   underwriting           whole_life, iul, medicare_advantage, annuity
--   quotation              term_life, whole_life, iul, medicare_advantage, annuity
--   application_field_set  term_life, whole_life, iul, medicare_advantage, annuity
--   disclosures (DRAFT)    MA_TPMO_DISCLAIMER, ANNUITY_SUITABILITY — unpublished, so no application
--                          carries them until Insurvas staff review and publish them.
--
-- NEEDS REVIEW. The new templates are a working starting point written from general US practice,
-- not carrier- or counsel-approved wording; the names end "needs review" so the Settings pages say
-- so. The Medicare Advantage and annuity ones touch CMS marketing rules and the NAIC best-interest
-- standard, and must be reviewed by the owner or counsel before they are relied on.
--
-- Existing agencies keep their own templates: their own rows win over these (own → platform), and
-- nothing here writes a tenant row. Insert-only and idempotent (`on conflict do nothing` on the
-- coalesced version index). Every definition is validated against the editor's own Zod schemas by
-- lib/salesSettings/platformTemplates.test.mjs, which reads this file.

begin;

-- ── 1 · underwriting ─────────────────────────────────────────────────────────

-- Whole Life (simplified issue): the persistency questions, build and tobacco, the common knockouts.
insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'underwriting', p.code, null, 'Whole Life — standard · needs review', 1, 'published', $def${
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
    {"field_key": "tobacco", "label": "Have you used tobacco or nicotine in the last 12 months?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 120, "help_text": null},
    {"field_key": "terminal", "label": "Have you been diagnosed with a terminal illness, or are you in hospice care?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 200, "help_text": null},
    {"field_key": "confined", "label": "Are you in a nursing home, or do you need help with bathing, dressing or eating?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 210, "help_text": null},
    {"field_key": "oxygen", "label": "In the last 2 years, have you used oxygen equipment?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 220, "help_text": null},
    {"field_key": "cancer", "label": "Have you been diagnosed with or treated for cancer in the last 2 years?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 230, "help_text": null},
    {"field_key": "heart_stroke", "label": "Have you had a heart attack, stroke or heart surgery in the last 2 years?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 240, "help_text": null},
    {"field_key": "copd", "label": "Do you have COPD, emphysema or chronic bronchitis?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 250, "help_text": null},
    {"field_key": "diabetes", "label": "Do you have diabetes?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 260, "help_text": null},
    {"field_key": "diabetes_insulin", "label": "Do you use insulin?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 261, "help_text": null},
    {"field_key": "medications", "label": "Medications", "type": "medication_list", "is_required": false,
     "options": [], "sort_order": 300, "help_text": "Name, dose, since when and what it is for."},
    {"field_key": "notes", "label": "Anything else the carrier should know", "type": "long_text", "is_required": false,
     "options": [], "sort_order": 400, "help_text": null}
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
    {"section_key": "build", "label": "Height, weight and tobacco", "sort_order": 20, "fields": [
      {"field_key": "height_in", "is_required": true, "show_when": null},
      {"field_key": "weight_lb", "is_required": true, "show_when": null},
      {"field_key": "tobacco", "is_required": true, "show_when": null}
    ]},
    {"section_key": "health", "label": "Health", "sort_order": 30, "fields": [
      {"field_key": "terminal", "is_required": true, "show_when": null,
       "is_knockout": true, "knockout_when": {"equals": "true"}, "knockout_note": "Simplified-issue whole life declines a terminal diagnosis or hospice care."},
      {"field_key": "confined", "is_required": true, "show_when": null,
       "is_knockout": true, "knockout_when": {"equals": "true"}, "knockout_note": "Most carriers decline nursing-home confinement or help with daily living; guaranteed issue only."},
      {"field_key": "oxygen", "is_required": true, "show_when": null},
      {"field_key": "cancer", "is_required": true, "show_when": null},
      {"field_key": "heart_stroke", "is_required": true, "show_when": null},
      {"field_key": "copd", "is_required": true, "show_when": null},
      {"field_key": "diabetes", "is_required": true, "show_when": null},
      {"field_key": "diabetes_insulin", "is_required": false, "show_when": {"field_key": "diabetes", "equals": "true"}}
    ]},
    {"section_key": "medications", "label": "Medications", "sort_order": 40, "fields": [
      {"field_key": "medications", "is_required": false, "show_when": null}
    ]},
    {"section_key": "notes", "label": "Notes", "sort_order": 50, "fields": [
      {"field_key": "notes", "is_required": false, "show_when": null}
    ]}
  ]}
}$def$::jsonb, now()
  from public.products p
 where p.code = 'whole_life'
on conflict do nothing;

-- Indexed Universal Life: fully underwritten like term, plus the goal and how it is funded.
insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'underwriting', p.code, null, 'Indexed Universal Life — standard · needs review', 1, 'published', $def${
  "fields": [
    {"field_key": "ss_deposit_day", "label": "When is your pay or Social Security deposited?", "type": "single_select", "is_required": false,
     "options": ["2nd Wednesday", "3rd Wednesday", "4th Wednesday", "The 3rd", "The 1st (SSI)", "Payday from work", "Other"],
     "sort_order": 10, "help_text": "Sets the draft date.", "persistency": true},
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
    {"field_key": "coverage_goal", "label": "What matters most from this policy?", "type": "single_select", "is_required": true,
     "options": ["Death benefit for my family", "Tax-advantaged cash value", "Supplemental retirement income", "Business or key person", "Estate planning"],
     "sort_order": 60, "help_text": "Written into the case notes, so the recommendation can be explained later."},
    {"field_key": "funding_source", "label": "How will the premium be paid?", "type": "single_select", "is_required": true,
     "options": ["Monthly from income", "Annual from savings", "Lump sum", "Premium financing"],
     "sort_order": 70, "help_text": null},
    {"field_key": "height_in", "label": "Height (inches)", "type": "number", "is_required": true,
     "options": [], "sort_order": 100, "help_text": "Read against the carrier's build chart."},
    {"field_key": "weight_lb", "label": "Weight (pounds)", "type": "number", "is_required": true,
     "options": [], "sort_order": 110, "help_text": "Read against the carrier's build chart."},
    {"field_key": "tobacco", "label": "Have you used tobacco or nicotine in the last 12 months?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 120, "help_text": null},
    {"field_key": "driving_dui", "label": "Any DUI or DWI in the last 5 years?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 200, "help_text": null},
    {"field_key": "hazardous_avocations", "label": "Do you fly as a pilot, or take part in scuba diving, skydiving, climbing or motor racing?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 210, "help_text": null},
    {"field_key": "hazardous_avocations_details", "label": "Which, and how often?", "type": "long_text", "is_required": false,
     "options": [], "sort_order": 211, "help_text": null},
    {"field_key": "family_history_before_60", "label": "Has a parent or sibling died of, or been diagnosed with, heart disease or cancer before age 60?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 300, "help_text": null},
    {"field_key": "annual_income", "label": "Annual earned income", "type": "currency", "is_required": true,
     "options": [], "sort_order": 400, "help_text": "Carriers cap face amount at a multiple of income."},
    {"field_key": "net_worth", "label": "Household net worth", "type": "currency", "is_required": true,
     "options": [], "sort_order": 410, "help_text": null},
    {"field_key": "medications", "label": "Medications", "type": "medication_list", "is_required": false,
     "options": [], "sort_order": 500, "help_text": "Name, dose, since when and what it is for."},
    {"field_key": "notes", "label": "Anything else the carrier should know", "type": "long_text", "is_required": false,
     "options": [], "sort_order": 600, "help_text": null}
  ],
  "form_definition": {"sections": [
    {"section_key": "before", "label": "Before we start", "sort_order": 10, "fields": [
      {"field_key": "ss_deposit_day", "is_required": false, "show_when": null},
      {"field_key": "deposit_account", "is_required": true, "show_when": null},
      {"field_key": "decision_maker", "is_required": false, "show_when": null},
      {"field_key": "existing_coverage", "is_required": true, "show_when": null},
      {"field_key": "existing_cash_value", "is_required": false, "show_when": {"field_key": "existing_coverage", "equals": "true"}},
      {"field_key": "can_receive_text", "is_required": false, "show_when": null}
    ]},
    {"section_key": "goal", "label": "What it is for", "sort_order": 20, "fields": [
      {"field_key": "coverage_goal", "is_required": true, "show_when": null},
      {"field_key": "funding_source", "is_required": true, "show_when": null}
    ]},
    {"section_key": "build", "label": "Height, weight and tobacco", "sort_order": 30, "fields": [
      {"field_key": "height_in", "is_required": true, "show_when": null},
      {"field_key": "weight_lb", "is_required": true, "show_when": null},
      {"field_key": "tobacco", "is_required": true, "show_when": null}
    ]},
    {"section_key": "lifestyle", "label": "Driving and activities", "sort_order": 40, "fields": [
      {"field_key": "driving_dui", "is_required": true, "show_when": null},
      {"field_key": "hazardous_avocations", "is_required": true, "show_when": null},
      {"field_key": "hazardous_avocations_details", "is_required": false, "show_when": {"field_key": "hazardous_avocations", "equals": "true"}}
    ]},
    {"section_key": "family", "label": "Family history", "sort_order": 50, "fields": [
      {"field_key": "family_history_before_60", "is_required": true, "show_when": null}
    ]},
    {"section_key": "financial", "label": "Financial justification", "sort_order": 60, "fields": [
      {"field_key": "annual_income", "is_required": true, "show_when": null},
      {"field_key": "net_worth", "is_required": true, "show_when": null}
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
 where p.code = 'iul'
on conflict do nothing;

-- Medicare Advantage: eligibility and fit, not health underwriting. CMS rules apply to these calls.
insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'underwriting', p.code, null, 'Medicare Advantage — eligibility · needs review', 1, 'published', $def${
  "fields": [
    {"field_key": "ss_deposit_day", "label": "When does your Social Security arrive?", "type": "single_select", "is_required": false,
     "options": ["2nd Wednesday", "3rd Wednesday", "4th Wednesday", "The 3rd", "The 1st (SSI)", "Not on Social Security"],
     "sort_order": 10, "help_text": "Only matters for a plan with a premium.", "persistency": true},
    {"field_key": "deposit_account", "label": "If the plan has a premium, will it come from the account your benefits land in?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 20, "help_text": null, "persistency": true},
    {"field_key": "decision_maker", "label": "Does anyone else help you decide on your health coverage?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 30, "help_text": null, "persistency": true},
    {"field_key": "existing_coverage", "label": "Do you have any life insurance now?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 40, "help_text": "Asked on every Insurvas template; a yes brings up the life replacement notice.", "persistency": true},
    {"field_key": "can_receive_text", "label": "Can you get a text or email without hanging up?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 50, "help_text": null, "persistency": true},
    {"field_key": "scope_of_appointment", "label": "Is a Scope of Appointment on file for the plan types discussed today?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 60, "help_text": "CMS rules decide when one is needed and how far ahead. Check your agency's compliance guidance."},
    {"field_key": "medicare_parts_ab", "label": "Are you enrolled in both Medicare Part A and Part B?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 100, "help_text": null},
    {"field_key": "election_period", "label": "Which enrollment period does this fall in?", "type": "single_select", "is_required": true,
     "options": ["Initial Enrollment Period", "Annual Enrollment Period (Oct 15 – Dec 7)", "Medicare Advantage Open Enrollment (Jan 1 – Mar 31)", "Special Enrollment Period", "Not sure"],
     "sort_order": 110, "help_text": "The carrier's form asks for the election and, for a Special Enrollment Period, the reason."},
    {"field_key": "sep_reason", "label": "What is the reason for the Special Enrollment Period?", "type": "text", "is_required": false,
     "options": [], "sort_order": 111, "help_text": null},
    {"field_key": "current_coverage", "label": "What coverage do you have now?", "type": "single_select", "is_required": true,
     "options": ["Original Medicare only", "A Medicare Advantage plan", "A Medicare Supplement (Medigap)", "Employer or retiree coverage", "Medicaid", "None"],
     "sort_order": 120, "help_text": null},
    {"field_key": "medicaid_or_extra_help", "label": "Do you have Medicaid or Extra Help with drug costs?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 130, "help_text": "A yes may open a Special Needs Plan."},
    {"field_key": "doctors_to_keep", "label": "Which doctors and hospitals do you want to keep?", "type": "long_text", "is_required": false,
     "options": [], "sort_order": 200, "help_text": "Check each against the plan's network before enrolling."},
    {"field_key": "preferred_pharmacy", "label": "Which pharmacy do you use?", "type": "text", "is_required": false,
     "options": [], "sort_order": 210, "help_text": null},
    {"field_key": "medications", "label": "Prescriptions", "type": "medication_list", "is_required": false,
     "options": [], "sort_order": 220, "help_text": "Name and dose, to check each plan's drug list."},
    {"field_key": "notes", "label": "Anything else to note", "type": "long_text", "is_required": false,
     "options": [], "sort_order": 300, "help_text": null}
  ],
  "form_definition": {"sections": [
    {"section_key": "before", "label": "Before we start", "sort_order": 10, "fields": [
      {"field_key": "scope_of_appointment", "is_required": true, "show_when": null,
       "is_knockout": true, "knockout_when": {"equals": "false"}, "knockout_note": "Record a Scope of Appointment before discussing plan types, where CMS rules require one."},
      {"field_key": "ss_deposit_day", "is_required": false, "show_when": null},
      {"field_key": "deposit_account", "is_required": false, "show_when": null},
      {"field_key": "decision_maker", "is_required": false, "show_when": null},
      {"field_key": "existing_coverage", "is_required": false, "show_when": null},
      {"field_key": "can_receive_text", "is_required": false, "show_when": null}
    ]},
    {"section_key": "eligibility", "label": "Eligibility", "sort_order": 20, "fields": [
      {"field_key": "medicare_parts_ab", "is_required": true, "show_when": null,
       "is_knockout": true, "knockout_when": {"equals": "false"}, "knockout_note": "Medicare Advantage needs both Part A and Part B."},
      {"field_key": "election_period", "is_required": true, "show_when": null},
      {"field_key": "sep_reason", "is_required": false, "show_when": {"field_key": "election_period", "equals": "Special Enrollment Period"}},
      {"field_key": "current_coverage", "is_required": true, "show_when": null},
      {"field_key": "medicaid_or_extra_help", "is_required": true, "show_when": null}
    ]},
    {"section_key": "fit", "label": "Doctors and drugs", "sort_order": 30, "fields": [
      {"field_key": "doctors_to_keep", "is_required": false, "show_when": null},
      {"field_key": "preferred_pharmacy", "is_required": false, "show_when": null},
      {"field_key": "medications", "is_required": false, "show_when": null}
    ]},
    {"section_key": "notes", "label": "Notes", "sort_order": 40, "fields": [
      {"field_key": "notes", "is_required": false, "show_when": null}
    ]}
  ]}
}$def$::jsonb, now()
  from public.products p
 where p.code = 'medicare_advantage'
on conflict do nothing;

-- Annuity: the suitability facts a best-interest recommendation rests on. No health questions.
insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'underwriting', p.code, null, 'Annuity — suitability · needs review', 1, 'published', $def${
  "fields": [
    {"field_key": "ss_deposit_day", "label": "When does your Social Security arrive?", "type": "single_select", "is_required": false,
     "options": ["2nd Wednesday", "3rd Wednesday", "4th Wednesday", "The 3rd", "The 1st (SSI)", "Not on Social Security"],
     "sort_order": 10, "help_text": "Only matters for a flexible-premium annuity.", "persistency": true},
    {"field_key": "deposit_account", "label": "Will the money come from an account in your own name?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 20, "help_text": null, "persistency": true},
    {"field_key": "decision_maker", "label": "Does anyone else need to be on this call?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 30, "help_text": null, "persistency": true},
    {"field_key": "existing_coverage", "label": "Do you have any life insurance now?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 40, "help_text": "Asked on every Insurvas template; a yes brings up the replacement notice.", "persistency": true},
    {"field_key": "existing_cash_value", "label": "Will money come from an existing annuity or life policy's cash value?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 45, "help_text": "A yes brings up the 1035 exchange form."},
    {"field_key": "can_receive_text", "label": "Can you get a text or email without hanging up?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 50, "help_text": null, "persistency": true},
    {"field_key": "objective", "label": "What is this money for?", "type": "single_select", "is_required": true,
     "options": ["Guaranteed income for life", "Growth with protection from loss", "Tax deferral", "Leaving it to my family"],
     "sort_order": 100, "help_text": null},
    {"field_key": "time_horizon", "label": "When do you expect to start using it?", "type": "single_select", "is_required": true,
     "options": ["Right away", "Within 5 years", "5 to 10 years", "More than 10 years"],
     "sort_order": 110, "help_text": null},
    {"field_key": "liquidity_need", "label": "Could you need this money for an emergency before the surrender period ends?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 120, "help_text": null},
    {"field_key": "risk_tolerance", "label": "How do you feel about your savings going down in value?", "type": "single_select", "is_required": true,
     "options": ["I can't accept any loss", "A small dip is fine for more growth", "I accept market ups and downs"],
     "sort_order": 130, "help_text": null},
    {"field_key": "source_of_funds", "label": "Where is the money coming from?", "type": "single_select", "is_required": true,
     "options": ["Bank savings or CD", "Retirement plan rollover (401k, IRA)", "Existing annuity", "Life insurance cash value", "Sale of a home or business", "Other"],
     "sort_order": 140, "help_text": null},
    {"field_key": "annual_income", "label": "Annual household income", "type": "currency", "is_required": true,
     "options": [], "sort_order": 200, "help_text": null},
    {"field_key": "liquid_net_worth", "label": "Savings you could reach quickly, after this purchase", "type": "currency", "is_required": true,
     "options": [], "sort_order": 210, "help_text": null},
    {"field_key": "net_worth", "label": "Household net worth, not counting your home", "type": "currency", "is_required": true,
     "options": [], "sort_order": 220, "help_text": null},
    {"field_key": "notes", "label": "Why this annuity fits (for the file)", "type": "long_text", "is_required": false,
     "options": [], "sort_order": 300, "help_text": "The reason for the recommendation, in the agent's words."}
  ],
  "form_definition": {"sections": [
    {"section_key": "before", "label": "Before we start", "sort_order": 10, "fields": [
      {"field_key": "ss_deposit_day", "is_required": false, "show_when": null},
      {"field_key": "deposit_account", "is_required": true, "show_when": null},
      {"field_key": "decision_maker", "is_required": false, "show_when": null},
      {"field_key": "existing_coverage", "is_required": false, "show_when": null},
      {"field_key": "existing_cash_value", "is_required": true, "show_when": null},
      {"field_key": "can_receive_text", "is_required": false, "show_when": null}
    ]},
    {"section_key": "needs", "label": "Goals and needs", "sort_order": 20, "fields": [
      {"field_key": "objective", "is_required": true, "show_when": null},
      {"field_key": "time_horizon", "is_required": true, "show_when": null},
      {"field_key": "liquidity_need", "is_required": true, "show_when": null,
       "is_knockout": true, "knockout_when": {"equals": "true"}, "knockout_note": "Money that may be needed before the surrender period ends is a poor fit for most annuities."},
      {"field_key": "risk_tolerance", "is_required": true, "show_when": null},
      {"field_key": "source_of_funds", "is_required": true, "show_when": null}
    ]},
    {"section_key": "financial", "label": "Financial picture", "sort_order": 30, "fields": [
      {"field_key": "annual_income", "is_required": true, "show_when": null},
      {"field_key": "liquid_net_worth", "is_required": true, "show_when": null},
      {"field_key": "net_worth", "is_required": true, "show_when": null}
    ]},
    {"section_key": "notes", "label": "Notes", "sort_order": 40, "fields": [
      {"field_key": "notes", "is_required": false, "show_when": null}
    ]}
  ]}
}$def$::jsonb, now()
  from public.products p
 where p.code = 'annuity'
on conflict do nothing;

-- ── 2 · quotation ────────────────────────────────────────────────────────────

insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'quotation', p.code, null, 'Term Life — generic · needs review', 1, 'published', $def${
  "age_basis": "nearest",
  "fields": [
    {"field_key": "dob", "label": "Date of birth", "type": "date", "is_required": true, "options": [], "sort_order": 10, "help_text": null},
    {"field_key": "gender", "label": "Gender", "type": "single_select", "is_required": true, "options": ["Male", "Female"], "sort_order": 20, "help_text": null},
    {"field_key": "state", "label": "State", "type": "single_select", "is_required": true,
     "options": ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"],
     "sort_order": 30, "help_text": null},
    {"field_key": "tobacco", "label": "Tobacco or nicotine in the last 12 months", "type": "boolean", "is_required": true, "options": [], "sort_order": 40, "help_text": null},
    {"field_key": "face_amount", "label": "Face amount", "type": "currency", "is_required": true, "options": [], "sort_order": 50, "help_text": null},
    {"field_key": "term_length", "label": "Term length (years)", "type": "number", "is_required": true, "options": [], "sort_order": 60, "help_text": "10, 15, 20, 25 or 30, where the carrier offers it."},
    {"field_key": "health_class", "label": "Health class quoted", "type": "single_select", "is_required": true,
     "options": ["Preferred Plus", "Preferred", "Standard Plus", "Standard", "Table rated"], "sort_order": 70, "help_text": "The class the quote assumes; underwriting decides the real one."},
    {"field_key": "riders", "label": "Riders", "type": "multi_select", "is_required": false,
     "options": ["Accidental death", "Child rider", "Waiver of premium", "Terminal illness", "Return of premium"], "sort_order": 80, "help_text": null}
  ],
  "form_definition": {"sections": [
    {"section_key": "quote", "label": "Quote", "sort_order": 10, "fields": [
      {"field_key": "dob", "is_required": true, "show_when": null},
      {"field_key": "gender", "is_required": true, "show_when": null},
      {"field_key": "state", "is_required": true, "show_when": null},
      {"field_key": "tobacco", "is_required": true, "show_when": null},
      {"field_key": "face_amount", "is_required": true, "show_when": null},
      {"field_key": "term_length", "is_required": true, "show_when": null},
      {"field_key": "health_class", "is_required": true, "show_when": null},
      {"field_key": "riders", "is_required": false, "show_when": null}
    ]}
  ]}
}$def$::jsonb, now()
  from public.products p
 where p.code = 'term_life'
on conflict do nothing;

insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'quotation', p.code, null, 'Whole Life — generic · needs review', 1, 'published', $def${
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
     "options": ["Accidental death", "Child rider", "Waiver of premium", "Terminal illness", "Paid-up additions"], "sort_order": 70, "help_text": null}
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
 where p.code = 'whole_life'
on conflict do nothing;

insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'quotation', p.code, null, 'Indexed Universal Life — generic · needs review', 1, 'published', $def${
  "age_basis": "nearest",
  "fields": [
    {"field_key": "dob", "label": "Date of birth", "type": "date", "is_required": true, "options": [], "sort_order": 10, "help_text": null},
    {"field_key": "gender", "label": "Gender", "type": "single_select", "is_required": true, "options": ["Male", "Female"], "sort_order": 20, "help_text": null},
    {"field_key": "state", "label": "State", "type": "single_select", "is_required": true,
     "options": ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"],
     "sort_order": 30, "help_text": null},
    {"field_key": "tobacco", "label": "Tobacco or nicotine in the last 12 months", "type": "boolean", "is_required": true, "options": [], "sort_order": 40, "help_text": null},
    {"field_key": "face_amount", "label": "Face amount", "type": "currency", "is_required": true, "options": [], "sort_order": 50, "help_text": null},
    {"field_key": "health_class", "label": "Health class quoted", "type": "single_select", "is_required": true,
     "options": ["Preferred Plus", "Preferred", "Standard Plus", "Standard", "Table rated"], "sort_order": 60, "help_text": "The class the illustration assumes; underwriting decides the real one."},
    {"field_key": "planned_premium", "label": "Planned premium", "type": "currency", "is_required": false, "options": [], "sort_order": 70, "help_text": "What the client means to pay, if more than the minimum."},
    {"field_key": "premium_mode", "label": "Paid", "type": "single_select", "is_required": false, "options": ["Monthly", "Quarterly", "Annually"], "sort_order": 80, "help_text": null},
    {"field_key": "riders", "label": "Riders", "type": "multi_select", "is_required": false,
     "options": ["Chronic illness", "Critical illness", "Terminal illness", "Waiver of premium", "Child rider"], "sort_order": 90, "help_text": null}
  ],
  "form_definition": {"sections": [
    {"section_key": "quote", "label": "Quote", "sort_order": 10, "fields": [
      {"field_key": "dob", "is_required": true, "show_when": null},
      {"field_key": "gender", "is_required": true, "show_when": null},
      {"field_key": "state", "is_required": true, "show_when": null},
      {"field_key": "tobacco", "is_required": true, "show_when": null},
      {"field_key": "face_amount", "is_required": true, "show_when": null},
      {"field_key": "health_class", "is_required": true, "show_when": null},
      {"field_key": "planned_premium", "is_required": false, "show_when": null},
      {"field_key": "premium_mode", "is_required": false, "show_when": null},
      {"field_key": "riders", "is_required": false, "show_when": null}
    ]}
  ]}
}$def$::jsonb, now()
  from public.products p
 where p.code = 'iul'
on conflict do nothing;

-- The Quote step always asks a face amount and a date of birth; for these two lines the face amount
-- is labelled for what it holds (no plan has a face amount; an annuity has a deposit).
insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'quotation', p.code, null, 'Medicare Advantage — plan fit · needs review', 1, 'published', $def${
  "age_basis": "last",
  "fields": [
    {"field_key": "dob", "label": "Date of birth", "type": "date", "is_required": true, "options": [], "sort_order": 10, "help_text": null},
    {"field_key": "state", "label": "State", "type": "single_select", "is_required": true,
     "options": ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"],
     "sort_order": 20, "help_text": null},
    {"field_key": "zip_code", "label": "ZIP code", "type": "text", "is_required": true, "options": [], "sort_order": 30, "help_text": "Plans are sold by county; the ZIP finds it."},
    {"field_key": "plan_type", "label": "Plan type", "type": "single_select", "is_required": true, "options": ["HMO", "PPO", "PFFS", "Special Needs Plan"], "sort_order": 40, "help_text": null},
    {"field_key": "face_amount", "label": "Monthly plan premium", "type": "currency", "is_required": true, "options": [], "sort_order": 50, "help_text": "Medicare Advantage has no face amount: record the plan's monthly premium, $0 included."},
    {"field_key": "drug_coverage", "label": "Includes drug coverage (MAPD)", "type": "boolean", "is_required": true, "options": [], "sort_order": 60, "help_text": null}
  ],
  "form_definition": {"sections": [
    {"section_key": "quote", "label": "Plan", "sort_order": 10, "fields": [
      {"field_key": "dob", "is_required": true, "show_when": null},
      {"field_key": "state", "is_required": true, "show_when": null},
      {"field_key": "zip_code", "is_required": true, "show_when": null},
      {"field_key": "plan_type", "is_required": true, "show_when": null},
      {"field_key": "face_amount", "is_required": true, "show_when": null},
      {"field_key": "drug_coverage", "is_required": true, "show_when": null}
    ]}
  ]}
}$def$::jsonb, now()
  from public.products p
 where p.code = 'medicare_advantage'
on conflict do nothing;

insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'quotation', p.code, null, 'Annuity — generic · needs review', 1, 'published', $def${
  "age_basis": "nearest",
  "fields": [
    {"field_key": "dob", "label": "Owner's date of birth", "type": "date", "is_required": true, "options": [], "sort_order": 10, "help_text": null},
    {"field_key": "state", "label": "State", "type": "single_select", "is_required": true,
     "options": ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"],
     "sort_order": 20, "help_text": null},
    {"field_key": "face_amount", "label": "Amount to deposit", "type": "currency", "is_required": true, "options": [], "sort_order": 30, "help_text": "An annuity has no face amount: record the premium deposited."},
    {"field_key": "annuity_type", "label": "Annuity type", "type": "single_select", "is_required": true, "options": ["Multi-year guaranteed (MYGA)", "Fixed indexed", "Immediate income (SPIA)", "Deferred income"], "sort_order": 40, "help_text": null},
    {"field_key": "tax_status", "label": "Tax status", "type": "single_select", "is_required": true, "options": ["Qualified (IRA, rollover)", "Non-qualified"], "sort_order": 50, "help_text": null},
    {"field_key": "surrender_years", "label": "Surrender period (years)", "type": "number", "is_required": false, "options": [], "sort_order": 60, "help_text": null},
    {"field_key": "income_rider", "label": "Income rider", "type": "boolean", "is_required": false, "options": [], "sort_order": 70, "help_text": null}
  ],
  "form_definition": {"sections": [
    {"section_key": "quote", "label": "Quote", "sort_order": 10, "fields": [
      {"field_key": "dob", "is_required": true, "show_when": null},
      {"field_key": "state", "is_required": true, "show_when": null},
      {"field_key": "face_amount", "is_required": true, "show_when": null},
      {"field_key": "annuity_type", "is_required": true, "show_when": null},
      {"field_key": "tax_status", "is_required": true, "show_when": null},
      {"field_key": "surrender_years", "is_required": false, "show_when": null},
      {"field_key": "income_rider", "is_required": false, "show_when": null}
    ]}
  ]}
}$def$::jsonb, now()
  from public.products p
 where p.code = 'annuity'
on conflict do nothing;

-- ── 3 · application field sets ───────────────────────────────────────────────

insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'application_field_set', p.code, null, 'Term Life — platform default · needs review', 1, 'published', $def${
  "required": ["insured.first_name", "insured.last_name", "insured.dob", "insured.gender", "insured.ssn", "insured.height_in",
               "insured.weight_lb", "insured.tobacco", "contact.phone", "addr.line1", "addr.city", "addr.state", "addr.zip",
               "custom.drivers_license_number", "custom.drivers_license_state", "custom.occupation", "custom.annual_income"],
  "optional": ["insured.middle_initial", "insured.birth_state", "contact.email", "addr.line2", "addr.years_at",
               "owner.same_as_insured", "owner.first_name", "owner.last_name", "owner.dob", "owner.relationship"],
  "custom": [
    {"key": "custom.drivers_license_number", "label": "Driver's license number", "type": "text", "group": "insured"},
    {"key": "custom.drivers_license_state", "label": "Driver's license state", "type": "state", "group": "insured"},
    {"key": "custom.occupation", "label": "Occupation", "type": "text", "group": "insured"},
    {"key": "custom.annual_income", "label": "Annual earned income", "type": "currency", "group": "insured"}
  ]
}$def$::jsonb, now()
  from public.products p
 where p.code = 'term_life'
on conflict do nothing;

insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'application_field_set', p.code, null, 'Whole Life — platform default · needs review', 1, 'published', $def${
  "required": ["insured.first_name", "insured.last_name", "insured.dob", "insured.gender", "insured.ssn", "insured.height_in",
               "insured.weight_lb", "insured.tobacco", "contact.phone", "addr.line1", "addr.city", "addr.state", "addr.zip"],
  "optional": ["insured.middle_initial", "insured.birth_state", "contact.email", "addr.line2", "addr.years_at",
               "owner.same_as_insured", "owner.first_name", "owner.last_name", "owner.dob", "owner.relationship",
               "custom.occupation"],
  "custom": [
    {"key": "custom.occupation", "label": "Occupation", "type": "text", "group": "insured"}
  ]
}$def$::jsonb, now()
  from public.products p
 where p.code = 'whole_life'
on conflict do nothing;

insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'application_field_set', p.code, null, 'Indexed Universal Life — platform default · needs review', 1, 'published', $def${
  "required": ["insured.first_name", "insured.last_name", "insured.dob", "insured.gender", "insured.ssn", "insured.height_in",
               "insured.weight_lb", "insured.tobacco", "contact.phone", "contact.email", "addr.line1", "addr.city", "addr.state", "addr.zip",
               "custom.drivers_license_number", "custom.drivers_license_state", "custom.occupation", "custom.annual_income", "custom.net_worth"],
  "optional": ["insured.middle_initial", "insured.birth_state", "addr.line2", "addr.years_at",
               "owner.same_as_insured", "owner.first_name", "owner.last_name", "owner.dob", "owner.relationship", "custom.employer"],
  "custom": [
    {"key": "custom.drivers_license_number", "label": "Driver's license number", "type": "text", "group": "insured"},
    {"key": "custom.drivers_license_state", "label": "Driver's license state", "type": "state", "group": "insured"},
    {"key": "custom.occupation", "label": "Occupation", "type": "text", "group": "insured"},
    {"key": "custom.employer", "label": "Employer", "type": "text", "group": "insured"},
    {"key": "custom.annual_income", "label": "Annual earned income", "type": "currency", "group": "insured"},
    {"key": "custom.net_worth", "label": "Household net worth", "type": "currency", "group": "insured"}
  ]
}$def$::jsonb, now()
  from public.products p
 where p.code = 'iul'
on conflict do nothing;

-- Medicare Advantage: the enrollment form's facts. The Medicare number is an identifier the carrier
-- needs; it is not masked like the SSN (a custom question cannot be), which is part of the review.
insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'application_field_set', p.code, null, 'Medicare Advantage — platform default · needs review', 1, 'published', $def${
  "required": ["insured.first_name", "insured.last_name", "insured.dob", "insured.gender", "contact.phone",
               "addr.line1", "addr.city", "addr.state", "addr.zip",
               "custom.medicare_number", "custom.part_a_date", "custom.part_b_date"],
  "optional": ["insured.middle_initial", "contact.email", "addr.line2", "custom.primary_care_provider", "custom.medicaid_number", "custom.emergency_contact"],
  "custom": [
    {"key": "custom.medicare_number", "label": "Medicare number (MBI)", "type": "text", "group": "insured"},
    {"key": "custom.part_a_date", "label": "Part A effective date", "type": "date", "group": "insured"},
    {"key": "custom.part_b_date", "label": "Part B effective date", "type": "date", "group": "insured"},
    {"key": "custom.primary_care_provider", "label": "Primary care provider", "type": "text", "group": "insured"},
    {"key": "custom.medicaid_number", "label": "Medicaid number", "type": "text", "group": "insured"},
    {"key": "custom.emergency_contact", "label": "Emergency contact (name and phone)", "type": "text", "group": "contact"}
  ],
  "help": {
    "custom.medicare_number": "From the red, white and blue Medicare card: 11 letters and numbers."
  }
}$def$::jsonb, now()
  from public.products p
 where p.code = 'medicare_advantage'
on conflict do nothing;

insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'application_field_set', p.code, null, 'Annuity — platform default · needs review', 1, 'published', $def${
  "required": ["insured.first_name", "insured.last_name", "insured.dob", "insured.gender", "insured.ssn",
               "contact.phone", "addr.line1", "addr.city", "addr.state", "addr.zip",
               "owner.same_as_insured", "custom.tax_status", "custom.source_of_funds"],
  "optional": ["insured.middle_initial", "contact.email", "addr.line2", "owner.first_name", "owner.last_name", "owner.dob", "owner.relationship",
               "custom.drivers_license_number", "custom.drivers_license_state"],
  "labels": {
    "owner.same_as_insured": "Owner is the annuitant"
  },
  "custom": [
    {"key": "custom.tax_status", "label": "Tax status", "type": "choice", "options": ["Qualified (IRA, rollover)", "Non-qualified"], "group": "cov"},
    {"key": "custom.source_of_funds", "label": "Source of funds", "type": "choice", "options": ["Bank savings or CD", "Retirement plan rollover", "Existing annuity", "Life insurance cash value", "Other"], "group": "cov"},
    {"key": "custom.drivers_license_number", "label": "Driver's license number", "type": "text", "group": "insured"},
    {"key": "custom.drivers_license_state", "label": "Driver's license state", "type": "state", "group": "insured"}
  ]
}$def$::jsonb, now()
  from public.products p
 where p.code = 'annuity'
on conflict do nothing;

-- ── 4 · disclosures, as unpublished drafts ───────────────────────────────────
-- Platform drafts are never loaded by an application (refreshDisclosures reads published rows only)
-- and never listed for an agency (disclosureLibrary shows published platform rows only). They wait
-- for Insurvas staff to review the wording, add their rules and publish them.

insert into public.application_disclosures (tenant_id, code, title, body_markdown, version, status) values
  (null, 'MA_TPMO_DISCLAIMER', 'Medicare Advantage: plans we represent', $body$
[DRAFT — NOT COMPLIANCE-APPROVED. Review the current CMS marketing rules before publishing.]

We do not offer every plan available in your area. Currently we represent **[number]**
organizations which offer **[number]** products in your area. Please contact Medicare.gov,
1-800-MEDICARE, or your local State Health Insurance Program (SHIP) to get information on all of
your options.
$body$, 1, 'draft'),
  (null, 'ANNUITY_SUITABILITY', 'Annuity recommendation: what you told us', $body$
[DRAFT — NOT COMPLIANCE-APPROVED. Review against your state's annuity best-interest rule before publishing.]

Before recommending this annuity, your agent asked about your financial situation, goals, time
horizon, need for access to the money, tolerance for risk, and where the money is coming from.

Please confirm that:

- the information you gave is complete and accurate;
- you understand this annuity has a **surrender period**, and that taking out more than the free
  withdrawal amount during it can cost you a surrender charge;
- you have enough other money available for emergencies;
- if this replaces an existing annuity or policy, you were told what you may give up;
- you have a free-look period after the contract is delivered.

Ask any question you have before we continue.
$body$, 1, 'draft')
on conflict do nothing;

-- ── 5 · checks ───────────────────────────────────────────────────────────────
do $$
declare
  v_missing text;
begin
  select string_agg(want.kind || '/' || want.code, ', ') into v_missing
    from (values
      ('underwriting', 'whole_life'), ('underwriting', 'iul'), ('underwriting', 'medicare_advantage'), ('underwriting', 'annuity'),
      ('quotation', 'term_life'), ('quotation', 'whole_life'), ('quotation', 'iul'), ('quotation', 'medicare_advantage'), ('quotation', 'annuity'),
      ('application_field_set', 'term_life'), ('application_field_set', 'whole_life'), ('application_field_set', 'iul'),
      ('application_field_set', 'medicare_advantage'), ('application_field_set', 'annuity')
    ) as want(kind, code)
   where exists (select 1 from public.products p where p.code = want.code)
     and not exists (
       select 1 from public.sales_templates t
        where t.tenant_id is null and t.carrier_id is null and t.status = 'published'
          and t.kind = want.kind and t.product_code = want.code
     );
  if v_missing is not null then
    raise exception '20261103120000: no published Insurvas template for %', v_missing;
  end if;
  if (select count(*) from public.application_disclosures
       where tenant_id is null and code in ('MA_TPMO_DISCLAIMER', 'ANNUITY_SUITABILITY')) <> 2 then
    raise exception '20261103120000: the two draft disclosures are missing';
  end if;
  if exists (select 1 from public.application_disclosures
              where tenant_id is null and code in ('MA_TPMO_DISCLAIMER', 'ANNUITY_SUITABILITY') and status <> 'draft') then
    raise exception '20261103120000: a reviewed-only disclosure is not a draft';
  end if;
end $$;

commit;

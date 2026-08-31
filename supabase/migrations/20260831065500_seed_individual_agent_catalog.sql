-- The launch catalog for the individual licensed agent.
--
-- Drawn from "Basic Idea Individual Agent Side" §2 (prices), §6.5 (menu by plan) and "Basic Idea
-- Super Admin Side" §4 (feature catalog, meter catalog, plan shape, add-ons).
--
-- Two deliberate departures from the docs, both because the CODE is the binding constraint:
--
--   1. The admin doc lists ~30 feature keys including team_hierarchy, producer_scorecards,
--      team_qa and appointment_guardrails. The agent menu never references them — agency is
--      Phase 2 — and `npm run check:features` fails on a catalog key with no menu node. Only the
--      27 keys the menu actually requires are seeded.
--   2. The doc's meter catalog includes consent_certs, transcription_min, phone_numbers and
--      skip_trace. lib/creditsLimits/constants.ts knows six meters; metering anything else would
--      be unenforceable, so only those six exist.
--
-- The `agency` plan from the doc is not seeded: it is explicitly "Phase 2 of the business".

insert into public.feature_modules (key, label, sort_order) values
  ('book',        'Book of Business', 1),
  ('acquisition', 'Acquisition',      2),
  ('sell',        'Sell',             3),
  ('retention',   'Retention',        4),
  ('insight',     'Insight',          5),
  ('partners',    'Partners',         6),
  ('accounting',  'Accounting',       7),
  ('compliance',  'Compliance',       8);

-- The 27 features. Every one has a menu node in lib/menu/definition.ts.
insert into public.features (feature_key, label, module, description, sort_order) values
  ('book_of_business',     'Book of Business',              'book',        'Every policy still in force.', 1),
  ('statement_ingestion',  'Carrier statement import',      'book',        'Upload a carrier statement and have it parsed.', 2),
  ('commission_ledger',    'Commission ledger',             'book',        'Every money event, in one place.', 3),
  ('appointment_vault',    'Appointments & contract levels','book',        'Which carriers, which states, what rate.', 4),
  ('discrepancy_report',   'Discrepancy report',            'book',        'What the carrier paid against what they owed.', 5),

  ('inbound_transfers',    'Inbound live transfers',        'acquisition', 'Calls a publisher hands over live.', 10),
  ('outbound_dialing',     'Outbound dialer',               'acquisition', 'Dial a purchased list.', 11),
  ('lead_import',          'Purchased list import',         'acquisition', 'Bring in a bought spreadsheet of names.', 12),
  ('duplicate_detection',  'Duplicate & existing customer', 'acquisition', 'Do not pay twice for the same person.', 13),

  ('quoting',              'Quoting',                       'sell',        'Compare carrier premiums side by side.', 20),
  ('applications',         'Dynamic application forms',     'sell',        'Carrier applications, filled in-app.', 21),
  ('draft_date_optimizer', 'Draft-date optimiser',          'sell',        'Pick the draft date least likely to bounce.', 22),
  ('callback_calendar',    'Callback calendar',             'sell',        'Callbacks that do not live in a phone.', 23),
  ('daily_deal_flow',      'Daily deal flow',               'sell',        'What was sold today.', 24),

  ('chargeback_radar',     'Predictive lapse scoring',      'retention',   'Warn before a policy dies, not after.', 30),
  ('payment_repair',       'Failed-payment repair',         'retention',   'Fix a missed draft before it lapses.', 31),
  ('winback',              'Win-back campaigns',            'retention',   'Bring back a lapsed customer.', 32),

  ('true_cpa',             'True cost per acquisition',     'insight',     'What a sale actually cost.', 40),
  ('cohort_persistency',   'Persistency by source',         'insight',     'Which lead source survives.', 41),

  ('publisher_records',    'Publisher management',          'partners',    'Who supplies leads, and on what terms.', 50),
  ('payout_runs',          'Payout runs & settlement',      'partners',    'Pay publishers from the ledger, not WhatsApp.', 51),
  ('partner_portal',       'External publisher logins',     'partners',    'Publishers see their own numbers.', 52),

  ('profit_and_loss',      'Full P&L',                      'accounting',  'Did this month make money.', 60),
  ('tax_summaries',        'Tax-year summaries & 1099',     'accounting',  'What the accountant asks for.', 61),

  ('consent_locker',       'Consent certificate storage',   'compliance',  'Proof of consent, kept.', 70),
  ('tcpa_checker',         'TCPA & DNC checking',           'compliance',  'Scrub before dialing.', 71),
  ('litigation_packet',    'Litigation packet export',      'compliance',  'Everything about one number, for a lawyer.', 72);

-- statement_pages has NO hard cap on purpose. The admin doc is explicit: statement processing is
-- the activation event and the core value, so blocking it to force an upgrade would be blocking
-- the thing they pay for. It bills overage quietly instead.
insert into public.meters (meter_key, unit, label, default_hard_cap, sort_order) values
  ('dialer_minutes',   'minute',   'Dialer minutes',   true,  1),
  ('dnc_lookups',      'lookup',   'DNC lookups',      true,  2),
  ('tcpa_checks',      'check',    'TCPA checks',      true,  3),
  ('sms_segments',     'segment',  'SMS segments',     true,  4),
  ('esign_envelopes',  'envelope', 'E-sign envelopes', true,  5),
  ('statement_pages',  'page',     'Statement pages',  false, 6);

-- Cost and sell per unit, from the admin doc's meter catalog.
--
-- NOTE the rounding: the doc prices several meters below one cent per unit (dialer $0.014,
-- DNC $0.012, SMS $0.011) and these columns are whole cents. Sell prices are rounded UP so we
-- never price below cost, which makes the margin indicator conservative rather than wrong in the
-- dangerous direction. Real per-unit billing at this precision needs a decimal column.
--
-- default_included is 0, not null: null means unlimited, and a meter with no plan row should fall
-- back to "none" rather than "infinite".
insert into public.meter_pricing (meter_key, cost_cents, sell_cents, default_included) values
  ('dialer_minutes',   1,  3,   0),
  ('dnc_lookups',      1,  2,   0),
  ('tcpa_checks',      1,  2,   0),
  ('sms_segments',     1,  2,   0),
  ('esign_envelopes', 70, 110,  0),
  ('statement_pages',  6,  15,  0);

-- Version 1 of each. A price change creates version 2 and existing subscribers stay where they
-- are, which is what makes grandfathering real.
insert into public.plans (code, version, name, plan_type, description, is_public, is_default, sort_order) values
  ('basic',   1, 'Basic',   'individual',
   'Your book of business and your commission money, reconciled. No CRM.', true, false, 1),
  ('pro',     1, 'Pro',     'individual',
   'The full-time solo producer: leads, dialer, selling and compliance.', true, true,  2),
  ('advance', 1, 'Advance', 'individual',
   'For a book big enough that chargebacks decide the year.', true, false, 3);

-- Yearly is ten months for twelve, matching the admin doc's own example (a $449 plan priced at
-- $4,490 a year). Quarterly is deliberately null — a cycle with no price cannot be sold.
insert into public.plan_prices (plan_id, price_monthly_cents, price_quarterly_cents, price_yearly_cents, setup_fee_cents, trial_days, currency)
select p.id, v.monthly, null, v.yearly, 0, 14, 'USD'
from public.plans p
join (values ('basic', 9900, 99000), ('pro', 24900, 249000), ('advance', 44900, 449000))
  as v(code, monthly, yearly) on v.code = p.code;

insert into public.plan_limits (plan_id, max_seats, max_carriers)
select p.id, 1, v.carriers
from public.plans p
join (values ('basic', 10), ('pro', 10), ('advance', null::integer)) as v(code, carriers)
  on v.code = p.code;

-- Features nest exactly as the agent doc's §6.5 menus do: Pro is Basic plus
-- acquisition/sell/compliance, Advance is Pro plus retention/insight/partners/accounting.
--
-- partner_portal is deliberately in NO plan. The doc assigns it to the Partner Portal add-on.
insert into public.plan_features (plan_id, feature_key)
select p.id, f.feature_key
from public.plans p
cross join lateral (
  select unnest(array[
    'book_of_business','statement_ingestion','commission_ledger','appointment_vault','discrepancy_report'
  ]) as feature_key
) f
where p.code in ('basic', 'pro', 'advance');

insert into public.plan_features (plan_id, feature_key)
select p.id, f.feature_key
from public.plans p
cross join lateral (
  select unnest(array[
    'inbound_transfers','outbound_dialing','lead_import','duplicate_detection',
    'quoting','applications','draft_date_optimizer','callback_calendar','daily_deal_flow',
    'consent_locker','tcpa_checker'
  ]) as feature_key
) f
where p.code in ('pro', 'advance');

insert into public.plan_features (plan_id, feature_key)
select p.id, f.feature_key
from public.plans p
cross join lateral (
  select unnest(array[
    'chargeback_radar','payment_repair','winback',
    'true_cpa','cohort_persistency',
    'publisher_records','payout_runs',
    'profit_and_loss','tax_summaries',
    'litigation_packet'
  ]) as feature_key
) f
where p.code = 'advance';

-- Basic gets zero of everything it cannot use — it has no dialer, SMS, e-sign or compliance
-- feature, so an allowance for those would be theatre. It gets MORE statement pages than Pro
-- because reconciliation is the entire plan. Advance gets unlimited statement pages (null), as
-- the doc's plan JSON specifies.
insert into public.plan_meters (plan_id, meter_key, included_qty, hard_cap)
select p.id, v.meter_key, v.qty, v.hard_cap
from public.plans p
join (values
  ('basic',   'dialer_minutes',     0,               true),
  ('basic',   'dnc_lookups',        0,               true),
  ('basic',   'tcpa_checks',        0,               true),
  ('basic',   'sms_segments',       0,               true),
  ('basic',   'esign_envelopes',    0,               true),
  ('basic',   'statement_pages',    1000,            false),

  ('pro',     'dialer_minutes',     1000,            true),
  ('pro',     'dnc_lookups',        2000,            true),
  ('pro',     'tcpa_checks',        2000,            true),
  ('pro',     'sms_segments',       500,             true),
  ('pro',     'esign_envelopes',    25,              true),
  ('pro',     'statement_pages',    500,             false),

  ('advance', 'dialer_minutes',     3000,            true),
  ('advance', 'dnc_lookups',        6000,            true),
  ('advance', 'tcpa_checks',        6000,            true),
  ('advance', 'sms_segments',       2000,            true),
  ('advance', 'esign_envelopes',    100,             true),
  ('advance', 'statement_pages',    null::integer,   false)
) as v(code, meter_key, qty, hard_cap) on v.code = p.code;

-- Only Partner Portal: the one add-on in the doc whose features already exist in the menu. The
-- other six (AI Sales Coach, Live Call Assist, accounting sync, extended recording retention,
-- API, white-label) need feature keys that do not exist, and selling access to a screen nobody
-- can open is worse than not selling it.
insert into public.addons (code, name, description, price_cents, billing_cycle, is_active, sort_order) values
  ('partner_portal', 'Partner Portal',
   'Publishers log in and see their own numbers, and payouts settle from the ledger.',
   9900, 'monthly', true, 1);

insert into public.addon_features (addon_id, feature_key)
select a.id, f.key from public.addons a
cross join lateral (select unnest(array['partner_portal','payout_runs']) as key) f
where a.code = 'partner_portal';

insert into public.plan_available_addons (plan_id, addon_id)
select p.id, a.id from public.plans p, public.addons a
where p.code = 'advance' and a.code = 'partner_portal';

-- Credit top-up packs, priced from the sell rates above. These now genuinely grant credits —
-- before bugs_sa.md #11 was fixed, buying one billed the customer and moved nothing.
insert into public.credit_packs (name, meter_key, quantity, price_cents, is_active) values
  ('1,000 dialer minutes',  'dialer_minutes',  1000, 2500,  true),
  ('2,000 DNC lookups',     'dnc_lookups',     2000, 2400,  true),
  ('2,000 TCPA checks',     'tcpa_checks',     2000, 2400,  true),
  ('1,000 SMS segments',    'sms_segments',    1000, 1800,  true),
  ('25 e-sign envelopes',   'esign_envelopes',   25, 2800,  true),
  ('500 statement pages',   'statement_pages',  500, 7500,  true);

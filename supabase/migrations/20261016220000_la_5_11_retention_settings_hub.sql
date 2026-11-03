-- LA-5.11 (Notion sprint, Module 5 — Retention) · the retention settings hub's last two settings.
--
-- Everything else the hub edits already exists on retention_settings (20261014100000, 200000, 300000,
-- 400000, 500000; 20261016200000 and 210000). Two more:
--
--   carrier_sample_floor  Sign 7's floor, apart from Sign 6's (sample_floor). "Lead-source and carrier
--                         sample-size floors (default 20)". Starts equal to the agency's sample_floor.
--   queue_default_sort    the save queue's order when the agent has not picked one (risk × money).
--
-- Every change the hub makes writes retention_setting_change (who, what, from, to, when); LA-8.8's
-- trigger copies each row into settings_audit. A weight change is a new risk_weight_set version.
--
-- Additive. Requires 20261014100000.
--
-- Rollback:
--   alter table public.retention_settings drop column if exists carrier_sample_floor, drop column if exists queue_default_sort;

alter table public.retention_settings add column if not exists carrier_sample_floor smallint;
update public.retention_settings set carrier_sample_floor = sample_floor where carrier_sample_floor is null;
alter table public.retention_settings alter column carrier_sample_floor set default 20;
alter table public.retention_settings alter column carrier_sample_floor set not null;
alter table public.retention_settings add column if not exists queue_default_sort text not null default 'value';
alter table public.retention_settings drop constraint if exists retention_settings_hub;
alter table public.retention_settings add constraint retention_settings_hub check (
  carrier_sample_floor between 5 and 500
  and queue_default_sort in ('value', 'score', 'exposure', 'next_draft', 'months')
);

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.retention_setting_change'::regclass and not tgisinternal) then
    raise exception '20261016220000: retention_setting_change has no audit trigger (LA-8.8, 20261015360000)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'retention_settings' and column_name = 'queue_default_sort') then
    raise exception '20261016220000: queue_default_sort is missing';
  end if;
end $$;

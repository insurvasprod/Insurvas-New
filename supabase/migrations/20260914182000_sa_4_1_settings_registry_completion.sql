-- SA-4.1 follow-up: keep the deployed settings store aligned with the typed registry.
--
-- 0001_settings.sql seeds the first four keys. The application registry also exposes the
-- Agent Floor and callback reminder thresholds, so a project that already ran 0001 can
-- otherwise fall back to coded defaults for those keys and cannot persist an override.
--
-- This is intentionally additive and non-destructive: an existing value is never replaced.
-- On a clean database, 0001_settings.sql creates the table before this migration runs.

insert into public.settings (key, value, type, label, "group") values
  ('agent_floor.wait_amber_seconds',
   '120'::jsonb, 'number', 'Agent Floor amber wait threshold (seconds)', 'Agent Floor'),
  ('agent_floor.wait_red_seconds',
   '300'::jsonb, 'number', 'Agent Floor red wait threshold (seconds)', 'Agent Floor'),
  ('callbacks.reminder_lead_minutes',
   '30'::jsonb, 'number', 'Callback reminder lead time (minutes)', 'Callbacks')
on conflict (key) do nothing;

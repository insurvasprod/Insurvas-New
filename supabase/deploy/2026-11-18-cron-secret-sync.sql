-- ============================================================================
-- Why 16 of 20 jobs fail (found 2026-11-18): the database calls the app's /api/cron/* routes every few minutes
-- (call_app_cron, 20261015500000) with "Authorization: Bearer <vault cron_secret>", and production answers every
-- call with 401 {"error":"Unauthorized"}. The route answers that only when the app's CRON_SECRET is unset or differs
-- from the vault's copy. The database's own pg_cron jobs all succeed; only the calls into the app fail. That is why
-- nightly metrics (MRR, since Sep 21), the billing run (since Sep 13), notifications, webhooks, reminders and the
-- rest are stopped.
--
-- FIX: one value in two places.
--   1. Hosting (Vercel → Project → Settings → Environment Variables → Production): CRON_SECRET is set.
--      Copy its value. If it is missing, create one (any long random string), save, and REDEPLOY production,
--      since env changes reach only new deployments.
--   2. Supabase dashboard → SQL editor: paste the block below, replace the placeholder with that same value,
--      and Run. Also check app_base_url is the production address (https://…, no trailing path).
--   3. Within 5 minutes Admin › Monitoring › Jobs & services turns green (or press Run now on a job).
--
-- Never commit the real value; this file keeps the placeholder.
-- ============================================================================

-- What the vault holds now (names only, and the base URL so you can check it).
select name, case when name = 'app_base_url' then decrypted_secret else '(hidden)' end as value
from vault.decrypted_secrets
where name in ('app_base_url', 'cron_secret');

-- Make the vault's cron_secret the app's CRON_SECRET.
select vault.update_secret(
  (select id from vault.secrets where name = 'cron_secret'),
  'PASTE-THE-PRODUCTION-CRON_SECRET-HERE'
);

-- Only if app_base_url above is wrong:
-- select vault.update_secret((select id from vault.secrets where name = 'app_base_url'), 'https://<production host>');

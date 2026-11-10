-- ============================================================================
-- Pending migrations — 1 files, each in its own transaction
-- Generated 2026-11-07 by scripts/build-pending-bundle.mjs. Do not hand-edit; regenerate.
--
-- HOW TO RUN: Supabase dashboard → SQL editor → paste this whole file → Run.
-- Each file is begin … commit on its own. The SQL editor STOPS at the first error: that file is
-- rolled back, the files before it stay applied, and nothing after it runs. Fix the named file,
-- regenerate, and run the whole script again — re-running is safe: the files use
-- create-or-replace / if-not-exists, and history rows use on-conflict-do-nothing.
--
-- AFTERWARDS: node --env-file=.env.local scripts/verify-applied-migrations.mjs
--
-- Files, in order:
--    1. 20261107120000_build_run_counts_pay_lines.sql
-- ============================================================================

-- ─── [1/1] 20261107120000_build_run_counts_pay_lines.sql ─────────────────────────
begin;

-- Team payouts, fix found in the 2026-11-07 demo payroll test.
--
-- build_producer_run (as restated by 20261015620000 and patched by AG-1.7) counts only commission lines as the
-- month's movement: ('split_advance', 'split_earned', 'split_chargeback', 'earned', 'chargeback'). Every other line
-- dated in the month went to "owed from before". So base pay, application bonuses and save fees (20261107100000)
-- were treated as old balance: the run paid $0 under "take a share" and the statement showed them as opening.
-- This adds the three pay-plan lines to both of the builder's lists, in place. The preview (agency_payout_preview)
-- already counts them.
--
-- Requires 20261107100000. Rollback: replace the extended list with the original five types in build_producer_run.

do $$
declare
  v_def text := pg_get_functiondef('public.build_producer_run(uuid,uuid,date,date,uuid)'::regprocedure);
  a_old constant text := '(''split_advance'', ''split_earned'', ''split_chargeback'', ''earned'', ''chargeback'')';
  a_new constant text := '(''split_advance'', ''split_earned'', ''split_chargeback'', ''earned'', ''chargeback'', ''salary'', ''app_bonus'', ''save_fee'')';
begin
  if position('''save_fee''' in v_def) > 0 then return; end if;
  if (length(v_def) - length(replace(v_def, a_old, ''))) / length(a_old) <> 2 then
    raise exception 'Pay lines in runs: expected the commission type list twice in build_producer_run';
  end if;
  execute replace(v_def, a_old, a_new);
end;
$$;

do $$
declare
  v_def text := pg_get_functiondef('public.build_producer_run(uuid,uuid,date,date,uuid)'::regprocedure);
begin
  if (length(v_def) - length(replace(v_def, '''save_fee''', ''))) / length('''save_fee''') <> 2 then
    raise exception 'Pay lines in runs: build_producer_run does not count base pay, bonuses and save fees in the month';
  end if;
end;
$$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261107120000', 'build_run_counts_pay_lines') on conflict do nothing;
  end if;
end $bundle$;
commit;

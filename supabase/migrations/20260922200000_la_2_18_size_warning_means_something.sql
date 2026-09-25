-- ---------------------------------------------------------------------------
-- LA-2.18 criterion 1 · "Comparing campaigns of VERY DIFFERENT SIZES produces an explicit warning,
-- not a verdict."
--
-- The warning fires on any inequality:
--
--   'size_warning', case when m.leads_a <> m.leads_b then '…' else null end
--
-- Two campaigns essentially never have identical lead counts, so the warning is on for every
-- comparison anybody will ever run — 4,000 against 3,999 gets the same red text as 4,000 against
-- 30. A warning that is always on carries no information, and the reader learns to scroll past the
-- one case where it mattered.
--
-- The criterion says "very different", so the threshold is a ratio rather than an inequality. Two
-- to one, because that is roughly where the smaller arm stops being able to move the comparison:
-- below it the arms are comparable, above it the reader should be told which one is carrying the
-- result. The number is in the message so nobody has to guess what "very different" meant.
--
-- The rest of the comparison is untouched. Only the `size_warning` expression changes.
-- ---------------------------------------------------------------------------

do $$
declare
  v_src text;
  v_new text;
  v_old constant text :=
    E'case when m.leads_a <> m.leads_b then ''Campaign sizes differ; use the rates and costs as the comparison, not raw volume.'' else null end';
  v_replacement constant text :=
    E'case when greatest(m.leads_a, m.leads_b) >= 2 * greatest(least(m.leads_a, m.leads_b), 1)\n'
    || E'             then format(''Campaign sizes are very different — %s leads against %s. Compare the rates and costs, not raw volume, and treat the smaller arm as the limit on what this can show.'', m.leads_a, m.leads_b)\n'
    || E'             else null end';
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tenant_campaign_comparison';

  if v_src is null then
    raise exception 'tenant_campaign_comparison does not exist; apply the LA-2.18 migration first';
  end if;

  if v_src ~ 'sizes are very different' then
    raise notice 'the size warning already uses a threshold';
    return;
  end if;

  v_new := replace(v_src, v_old, v_replacement);
  if v_new = v_src then
    raise exception 'the size_warning expression is not in the expected form; fix by hand';
  end if;

  execute v_new;
  raise notice 'the size warning now fires on a 2:1 ratio rather than on any difference';
end $$;

do $$
declare
  v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tenant_campaign_comparison';

  if v_src ~ 'm\.leads_a <> m\.leads_b' then
    raise exception 'the size warning still fires on any difference in size';
  end if;
  -- The refusals that make the comparison honest must survive this edit untouched.
  if v_src !~ 'campaign_comparison_periods_must_match'
     or v_src !~ 'campaign_comparison_weekdays_must_align' then
    raise exception 'the matched-period refusals were lost';
  end if;
end $$;

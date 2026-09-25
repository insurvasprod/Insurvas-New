-- ---------------------------------------------------------------------------
-- LA-2.18 · the comparison's confidence uses a pooled standard error
--
-- Found 2026-09-25 (Module 2 readiness, LA-2.18-4): comparing issued conversion 24/4,767 against
-- 0/261 came back 'strong … unlikely to be chance'. The z-test divided by the UNPOOLED Wald error,
-- sqrt(pA(1-pA)/nA + pB(1-pB)/nB). When one arm has no successes its term is exactly zero, the error
-- collapses to the other arm's alone, and z comes out near 4.9. Testing "are these two rates
-- different" is the pooled two-proportion test: p = (xA+xB)/(nA+nB), error sqrt(p(1-p)(1/nA+1/nB)),
-- which gives z near 1.1 here, and so 'not conclusive'.
--
-- The fix, and nothing else: the error expression, which appears twice (the level and the statement),
-- is replaced in the live function's own source, the way 20260922200000 changed the size warning, so
-- the rest of the function is untouched. Re-running is a no-op.
-- ---------------------------------------------------------------------------

do $$
declare
  v_src text;
  v_new text;
  v_old constant text :=
    'nullif(sqrt((m.numerator_a::numeric / nullif(m.sample_a, 0)) * (1 - m.numerator_a::numeric / nullif(m.sample_a, 0)) / nullif(m.sample_a, 0) + (m.numerator_b::numeric / nullif(m.sample_b, 0)) * (1 - m.numerator_b::numeric / nullif(m.sample_b, 0)) / nullif(m.sample_b, 0)), 0)';
  v_pooled constant text :=
    'nullif(sqrt(((m.numerator_a + m.numerator_b)::numeric / nullif(m.sample_a + m.sample_b, 0)) * (1 - (m.numerator_a + m.numerator_b)::numeric / nullif(m.sample_a + m.sample_b, 0)) * (1.0 / nullif(m.sample_a, 0) + 1.0 / nullif(m.sample_b, 0))), 0)';
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709400: skipped, % cannot create in public', current_user;
    return;
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tenant_campaign_comparison';
  if v_src is null then
    raise exception 'tenant_campaign_comparison does not exist; apply the LA-2.18 migration first';
  end if;

  if strpos(v_src, v_pooled) > 0 and strpos(v_src, v_old) = 0 then
    raise notice 'the comparison already uses a pooled standard error';
    return;
  end if;
  if (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 2 then
    raise exception 'the unpooled error expression is not in the expected form (expected it twice); fix by hand';
  end if;

  v_new := replace(v_src, v_old, v_pooled);
  execute v_new;
  raise notice 'the comparison now tests with a pooled standard error';
end $$;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709400: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tenant_campaign_comparison';
  if v_src ~ 'nullif\(sqrt\(\(m\.numerator_a::numeric / nullif\(m\.sample_a, 0\)\) \*' then
    raise exception 'the unpooled standard error is still in the comparison';
  end if;
  if strpos(v_src, '(m.numerator_a + m.numerator_b)::numeric / nullif(m.sample_a + m.sample_b, 0)') = 0 then
    raise exception 'the pooled standard error was not applied';
  end if;
  -- What made the comparison honest before must survive.
  if v_src !~ 'campaign_comparison_periods_must_match' or v_src !~ 'campaign_comparison_weekdays_must_align'
     or v_src !~ 'sizes are very different' then
    raise exception 'the matched-period refusals or the size warning were lost';
  end if;
end $$;

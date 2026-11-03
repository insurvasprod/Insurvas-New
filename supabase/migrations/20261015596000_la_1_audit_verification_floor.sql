-- LA-1 audit · verification is complete only when every required field is confirmed.
--
-- update_verification_field rounded the share of confirmed required fields to a whole percent, and
-- marks the session complete (completed_at) when that number is 100. round(99.5) is 100, so 199 of
-- 200 confirmed fields read 100% and completed the session: the application gate then let a sale
-- through with one required field never read back to the customer. The figure is now floored, so
-- it reaches 100 only when all are confirmed. update_verification_progress (the legacy
-- verification_items trigger) shows the same figure and is floored too.
--
-- Both are patched IN PLACE from their live definitions (the SQL editor stores CRLF; normalised
-- first), each anchor required exactly once; a function that already floors is left alone.

do $$
declare
  v_patch record;
  v_def text;
  v_count integer;
begin
  for v_patch in
    select * from (values
      ('public.update_verification_field(uuid,uuid,uuid,uuid,text,text,jsonb,text[],text[],text,text)', 'else round(100.0*count(*) filter(where is_required and is_visible and state in (''confirmed'',''corrected''))', 'else floor(100.0*count(*) filter(where is_required and is_visible and state in (''confirmed'',''corrected''))'),
      ('public.update_verification_progress()', 'else round(100.0 * (select count(*) from public.verification_items where session_id = sid and is_verified)', 'else floor(100.0 * (select count(*) from public.verification_items where session_id = sid and is_verified)')
    ) as t(sig, anchor, replacement)
  loop
    if to_regprocedure(v_patch.sig) is null then
      raise notice '20261015596000: % is not present; skipped', v_patch.sig;
      continue;
    end if;
    v_def := replace(pg_get_functiondef(v_patch.sig::regprocedure), E'\r\n', E'\n');
    if position(v_patch.replacement in v_def) > 0 then
      continue; -- already floored
    end if;
    v_count := (length(v_def) - length(replace(v_def, v_patch.anchor, ''))) / length(v_patch.anchor);
    if v_count <> 1 then
      raise exception '20261015596000: expected the progress expression once in %, found %', v_patch.sig, v_count;
    end if;
    execute replace(v_def, v_patch.anchor, v_patch.replacement);
  end loop;
end
$$;

-- ─── self-check ──────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.update_verification_field(uuid,uuid,uuid,uuid,text,text,jsonb,text[],text[],text,text)') is not null
     and position('else round(100.0*count(*)' in replace(pg_get_functiondef('public.update_verification_field(uuid,uuid,uuid,uuid,text,text,jsonb,text[],text[],text,text)'::regprocedure), E'\r\n', E'\n')) > 0 then
    raise exception '20261015596000: update_verification_field still rounds progress up to 100';
  end if;
end
$$;

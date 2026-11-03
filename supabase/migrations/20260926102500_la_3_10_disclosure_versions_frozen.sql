-- LA-3.10 — a published disclosure version never changes (the library's half of "a new disclosure
-- version does not change the version recorded on an acknowledged application").
--
-- 20260926100600 made the library; this freezes what an acknowledgement points at. In short:
--
--   application_disclosures        GUARD  a published or retired row changes only published → retired;
--                                         only a draft can be deleted
--   application_disclosure_rules   GUARD  the rules of a published or retired row never change
--   application_disclosures        INDEX  created_by (every FK gets its index — 2026-09-23 perf pass)
--
-- Editing a published disclosure makes version N + 1 as a draft (lib/salesSettings/disclosures.ts),
-- and tenant_application_disclosures keeps pointing at the row — so the text — it was acknowledged
-- on. The same rule as sales_templates_guard_published (20260926100100).
--
-- A tenant being deleted still cascades: by the time its rows are removed the tenant row is gone,
-- and the guard lets that through.
--
-- Down:
--   drop trigger if exists application_disclosures_guard on public.application_disclosures;
--   drop trigger if exists application_disclosure_rules_guard on public.application_disclosure_rules;
--   drop function if exists public.application_disclosures_guard(), public.application_disclosure_rules_guard();
--   drop index if exists public.application_disclosures_created_by_idx;

-- ── 1 · the disclosure row ──────────────────────────────────────────────────
create or replace function public.application_disclosures_guard()
returns trigger language plpgsql as $function$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft'
       and (old.tenant_id is null or exists (select 1 from public.tenants t where t.id = old.tenant_id)) then
      raise exception 'DISCLOSURE_PUBLISHED_IMMUTABLE: % v% is %, it cannot be deleted', old.code, old.version, old.status;
    end if;
    return old;
  end if;

  if old.status in ('published', 'retired') then
    -- created_by is left out: a deleted user sets it null, and that is not an edit of the text.
    if (new.tenant_id, new.code, new.title, new.body_markdown, new.attachment_path, new.states, new.carrier_ids, new.version)
       is distinct from
       (old.tenant_id, old.code, old.title, old.body_markdown, old.attachment_path, old.states, old.carrier_ids, old.version) then
      raise exception 'DISCLOSURE_PUBLISHED_IMMUTABLE: % v% is %; edit a new version instead', old.code, old.version, old.status;
    end if;
    if new.status is distinct from old.status and not (old.status = 'published' and new.status = 'retired') then
      raise exception 'DISCLOSURE_PUBLISHED_IMMUTABLE: % v% cannot go from % to %', old.code, old.version, old.status, new.status;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists application_disclosures_guard on public.application_disclosures;
create trigger application_disclosures_guard before update or delete on public.application_disclosures
  for each row execute function public.application_disclosures_guard();

-- ── 2 · its rules ───────────────────────────────────────────────────────────
-- A rule row of a published or retired disclosure cannot be added, changed or removed. When the
-- disclosure itself is being deleted (a draft, or a tenant cascade) its row is already gone here.
create or replace function public.application_disclosure_rules_guard()
returns trigger language plpgsql as $function$
begin
  if exists (select 1 from public.application_disclosures d
              where d.id in (case when tg_op <> 'INSERT' then old.disclosure_id end,
                             case when tg_op <> 'DELETE' then new.disclosure_id end)
                and d.status in ('published', 'retired')) then
    raise exception 'DISCLOSURE_PUBLISHED_IMMUTABLE: the rules of a published disclosure cannot change; edit a new version instead';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

drop trigger if exists application_disclosure_rules_guard on public.application_disclosure_rules;
create trigger application_disclosure_rules_guard before insert or update or delete on public.application_disclosure_rules
  for each row execute function public.application_disclosure_rules_guard();

create index if not exists application_disclosures_created_by_idx
  on public.application_disclosures (created_by) where created_by is not null;

-- ── 3 · checks ──────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_trigger
       where not tgisinternal
         and tgname in ('application_disclosures_guard', 'application_disclosure_rules_guard')) <> 2 then
    raise exception '20260926102500: the disclosure version guard is missing';
  end if;
end $$;

-- The guard, exercised on the seeded replacement notice: its text, its rules and a delete are all
-- refused. Nothing the probe does survives (every statement is refused, and the sentinel rolls back).
do $$
declare
  v_id uuid := (select id from public.application_disclosures
                 where tenant_id is null and code = 'REPLACEMENT_NOTICE' and status = 'published' order by version limit 1);
begin
  if v_id is null then
    raise notice '20260926102500: no published platform disclosure to probe the guard with; skipped';
    return;
  end if;
  begin
    begin
      update public.application_disclosures set title = title || ' (edited)' where id = v_id;
      raise exception '20260926102500: a published disclosure''s text was edited';
    exception when others then
      if sqlerrm not like 'DISCLOSURE_PUBLISHED_IMMUTABLE%' then raise; end if;
    end;
    begin
      insert into public.application_disclosure_rules (disclosure_id, clauses)
      values (v_id, '[{"field": "addr.state", "op": "eq", "value": "TX"}]'::jsonb);
      raise exception '20260926102500: a rule was added to a published disclosure';
    exception when others then
      if sqlerrm not like 'DISCLOSURE_PUBLISHED_IMMUTABLE%' then raise; end if;
    end;
    begin
      delete from public.application_disclosures where id = v_id;
      raise exception '20260926102500: a published disclosure was deleted';
    exception when others then
      if sqlerrm not like 'DISCLOSURE_PUBLISHED_IMMUTABLE%' then raise; end if;
    end;
    raise exception 'la3_probe_rollback';
  exception when others then
    if sqlerrm <> 'la3_probe_rollback' then raise; end if;
  end;
end $$;

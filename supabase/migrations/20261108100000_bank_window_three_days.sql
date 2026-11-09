-- Bank deposits (owner's Accounting doc, "The Bank Matchmaker", 2026-11-08): a carrier's money lands "on the same
-- day, or maybe a day or two later". A new agency starts with 3 days after the carrier's date, not 21: past it,
-- Bank deposits › Results flags the payment as missing money. Agencies that already have a setting keep theirs
-- (an owner may have chosen it); they change it in Settings › Accounting › Bank.
-- The fallbacks inside suggest_deposit_matches / deposit_unreceived_statements (no settings row at all) follow.
--
-- Rollback: alter column bank_window_days set default 21; restore the two functions from 20261015260000.

alter table public.accounting_settings alter column bank_window_days set default 3;

do $$
declare
  f text;
  v_def text;
begin
  foreach f in array array['public.suggest_deposit_matches(uuid)', 'public.deposit_unreceived_statements(uuid,date)'] loop
    v_def := pg_get_functiondef(f::regprocedure);
    if position('bank_window_days from public.accounting_settings where tenant_id = p_tenant_id), 21)' in v_def) > 0 then
      execute replace(v_def, 'bank_window_days from public.accounting_settings where tenant_id = p_tenant_id), 21)', 'bank_window_days from public.accounting_settings where tenant_id = p_tenant_id), 3)');
    elsif position('(select a.bank_window_days from public.accounting_settings a where a.tenant_id = p_tenant_id), 21)' in v_def) > 0 then
      execute replace(v_def, '(select a.bank_window_days from public.accounting_settings a where a.tenant_id = p_tenant_id), 21)', '(select a.bank_window_days from public.accounting_settings a where a.tenant_id = p_tenant_id), 3)');
    end if;
  end loop;
end;
$$;

do $$
begin
  if (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
       where d.adrelid = 'public.accounting_settings'::regclass and a.attname = 'bank_window_days') is distinct from '3' then
    raise exception 'Bank window: the default is not 3 days';
  end if;
end;
$$;

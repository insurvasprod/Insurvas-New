-- ---------------------------------------------------------------------------
-- The invoice counter had fallen behind the invoices it numbers
--
-- `invoice_counters` said the next INV number for 2026-09 was 0012. Rows numbered INV-2026-09-0012
-- and -0013 already existed. So every attempt to create an invoice — any invoice, by anyone —
-- failed on `duplicate key value violates unique constraint "platform_invoices_number_key"`, and
-- would have kept failing until the drift was noticed.
--
-- How the counter got behind the rows, which is the part worth writing down. As committed at
-- e7c00ee, scripts/verify-coupons.mjs did this:
--
--   1. record the counter at the start of the run and write it back at the end, to leave
--      "no gap in the live sequence"
--   2. delete the invoices it created first, which is what would have made that safe
--   3. except those deletes fail: prevent_issued_invoice_mutation refuses to delete an invoice
--      that has been issued, and the suite's invoices are `paid`
--   4. and the failure is discarded (`await supabase.from(...).delete()` with no error branch),
--      so the rewind happens regardless
--
-- Each step is defensible alone. Together they rewind a shared sequence while leaving the rows
-- that consumed it, which is a guaranteed collision for whoever creates the next invoice.
--
-- The suite itself no longer does this: the working tree already retains its invoices and only
-- reads the counter. What remained was the damage from its last committed-version run -- rows
-- above a counter that still pointed underneath them -- and that is what this repairs.
--
-- The general rule, recorded in the backlog: a verification suite may create and remove its own
-- rows, but it must not write a counter the rest of the system is reading.
--
-- This migration repairs the drift from the data rather than from a remembered number: for every
-- series and month, the counter is moved to one past the highest number actually issued. It is
-- safe to run more than once and does nothing when the counter is already correct.
-- ---------------------------------------------------------------------------

do $$
declare
  v_row record;
  v_fixed integer := 0;
begin
  for v_row in
    select c.series, c.year, c.month, c.next_number,
           max((regexp_match(i.number, '^INV-\d{4}-\d{2}-(\d+)$'))[1]::integer) as highest
      from public.invoice_counters c
      join public.platform_invoices i
        on i.number like format('%s-%s-%s-%%', c.series, c.year, lpad(c.month::text, 2, '0'))
     where c.series = 'INV'
     group by c.series, c.year, c.month, c.next_number
  loop
    if v_row.highest is not null and v_row.next_number <= v_row.highest then
      update public.invoice_counters
         set next_number = v_row.highest + 1
       where series = v_row.series and year = v_row.year and month = v_row.month;
      raise notice 'counter %-%-%: % -> % (highest issued %)',
        v_row.series, v_row.year, v_row.month, v_row.next_number, v_row.highest + 1, v_row.highest;
      v_fixed := v_fixed + 1;
    end if;
  end loop;

  if v_fixed = 0 then
    raise notice 'every invoice counter was already ahead of its invoices';
  end if;
end $$;

-- ── the next number is free ─────────────────────────────────────────────────
-- Asserted against the rows rather than against the counter, because the counter agreeing with
-- itself is what the drift looked like from the inside.
do $$
declare
  v_row record;
begin
  for v_row in
    select c.series, c.year, c.month, c.next_number
      from public.invoice_counters c
     where c.series = 'INV'
  loop
    if exists (
      select 1 from public.platform_invoices
       where number = format('%s-%s-%s-%s', v_row.series, v_row.year,
                             lpad(v_row.month::text, 2, '0'), lpad(v_row.next_number::text, 4, '0'))
    ) then
      raise exception 'counter %-%-% would hand out a number that is already taken (%)',
        v_row.series, v_row.year, v_row.month, v_row.next_number;
    end if;
  end loop;
end $$;

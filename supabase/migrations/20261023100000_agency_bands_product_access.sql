-- The public agency bands sell the products Advanced sells (AG-0.12: a band carries everything Advanced has).
--
-- AG-0.12 copied Advanced's FEATURES onto agency_50, agency_150 and agency_unlimited but not its products. With no
-- plan_product_access rows, every agency on a public band got a 500 from lead import and /api/app/leads (QA pass
-- 2026-10-22). This copies Advanced's product rows onto each band. It is idempotent; the rows were written live on
-- 2026-10-23, so applying this file there adds nothing.
--
-- Rollback: delete from plan_product_access where plan_id in (the three bands).

insert into public.plan_product_access (plan_id, product_code)
select band.id, pa.product_code
  from public.plans band
  join public.plans adv on adv.code = 'advance'
  join public.plan_product_access pa on pa.plan_id = adv.id
 where band.code in ('agency_50', 'agency_150', 'agency_unlimited')
   and not exists (select 1 from public.plan_product_access x where x.plan_id = band.id and x.product_code = pa.product_code);

do $$
begin
  if exists (
    select 1 from public.plans band
     where band.code in ('agency_50', 'agency_150', 'agency_unlimited')
       and not exists (select 1 from public.plan_product_access x where x.plan_id = band.id)
  ) then
    raise exception 'an agency band still sells no products';
  end if;
end;
$$;

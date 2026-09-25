-- Make the partner_products upsert key usable by ON CONFLICT.
--
-- 20260912160000 added this key as a PARTIAL index, `where product_code is not null`, to keep the
-- organizations-era rows (which leave product_code null) out of it. That was over-cautious and it
-- does not work: Postgres only matches a partial index to an ON CONFLICT when the statement repeats
-- the predicate, and set_partner_product_approval says plainly
--
--   on conflict (partner_id, product_code)
--
-- so the upsert still fails with 42P10 and LA-1.3 still loses its five approval criteria.
--
-- The predicate was never necessary. NULLs are distinct in a unique index, so a full index on
-- (partner_id, product_code) still permits any number of rows with a null product_code -- exactly
-- the rows the partial predicate was protecting. Swapping the partial for a full index therefore
-- costs the other product nothing and gives the upsert something to resolve against.

drop index if exists public.partner_products_partner_product_code_idx;

create unique index if not exists partner_products_partner_product_code_idx
  on public.partner_products (partner_id, product_code);

comment on index public.partner_products_partner_product_code_idx is
  'Upsert key for set_partner_product_approval. Not partial: ON CONFLICT cannot match a partial index unless the statement repeats the predicate, and NULL product_code rows stay legal because NULLs are distinct here.';

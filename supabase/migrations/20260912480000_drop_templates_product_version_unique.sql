-- Let a product have more than one template.
--
-- templates_product_version_compat_idx is `unique (product_code, version)` across the whole table,
-- so the catalog can hold exactly one template per product per version. SA-4.6 says the opposite:
-- "editing a template already in use creates a new version", and a product may have several
-- templates, each with its own version series. Under this index two templates for one product can
-- never share a version number, including version 1 — so the second one can never be created.
--
-- admin_duplicate_template therefore fails outright:
--
--   23505 duplicate key value violates unique constraint "templates_product_version_compat_idx"
--
-- which is where verify-agent-templates stops, and why LA-1.4's sixth criterion — "the preview
-- matches the partner's view exactly" — has no reachable evidence. It is not a fixture problem:
-- any operator duplicating a live product template hits it.
--
-- Why it is safe to drop rather than narrow. The index comes from
-- 20260911100000_live_runtime_compatibility, immediately above an idempotent seed for the Term Life
-- template — and that seed guards itself with `where not exists (...)`, not `on conflict`, so it
-- never needed the index. Checked before removing:
--
--   this repository's own CREATE TABLE for public.templates declares no such constraint
--   no function uses (product_code, version) as an ON CONFLICT target -- checked all three of
--     admin_duplicate_template, admin_save_template and admin_apply_tenant_template
--   every template lookup in lib/ and app/ is by id; none selects on (product_code, version)
--   the table holds one row and zero duplicate pairs, so nothing is invalidated either way
--
-- The uniqueness the catalog actually wants is per template, not per product: a template's versions
-- must not collide with each other. That is (id, version), and the primary key on id already makes
-- each row a distinct template-version pair. Nothing further is added here rather than guessing at
-- a constraint SA-4.6 does not ask for.

drop index if exists public.templates_product_version_compat_idx;

do $$
begin
  if exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'templates_product_version_compat_idx'
  ) then
    raise exception 'templates_product_version_compat_idx is still present';
  end if;
end;
$$;

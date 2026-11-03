-- SA-4.6 / SA-4.7 audit fixes (2026-10-15): which template a product gets, and the pipeline board a
-- template gives an agent.
--
-- 1. The platform's designated default template per product.
--    With two active templates for one product (say "Term Life — standard" and "Term Life —
--    simplified"), the auto-apply picked the highest version number across DIFFERENT template ids,
--    so a v3 of the simplified one beat a v1 of the standard one and new agents got whichever had
--    been edited most. templates.is_default names the one a product hands out; at most one per
--    product. With none marked, the app falls back to the most recently published template
--    (lib/agentTemplates/templateChoice.ts). "A newer version is available" now compares versions only
--    within the template id the agent's copy came from.
--
-- 2. A product pipeline built from the template's stages.
--    Applying a template wrote its stages only to tenant_template_stages. The pipeline board reads
--    tenant_pipeline_stages, which seed_default_pipelines fills with fixed partner stages, so the
--    template's pipeline never reached the board. apply_template_pipeline creates (or finds) the
--    tenant's pipeline for that product and MERGES the template's stages into it (SA-4.7: "applying a
--    second template merges rather than replaces"; "applying the same template twice does not
--    duplicate"):
--      * a stage whose name already exists in that pipeline (any case, archived or not) is left
--        exactly as the agency has it — its name, colour, position, archive state;
--      * a missing stage is appended after the last active stage, in template order;
--      * nothing is deleted, renamed, moved or archived, so every stage_dispositions mapping (the
--        agency-wide outcome → stage rule) and every lead's stage_id stays valid.
--    The pipeline has no partner type (20260924240100) and is not the default, so partner and
--    unpartnered lead routing is unchanged; lead creation from the product's template prefers it
--    (lib/pipelines/service.ts resolveProductEntryStage).
--
-- Both are additive. The app reads them only after checking they exist, so it works before and after
-- this file is applied.

alter table public.templates add column if not exists is_default boolean not null default false;

comment on column public.templates.is_default is
  'SA-4.7: the template a product hands out when an agent has none yet. At most one per product (templates_one_default_per_product). Set through admin_set_default_template.';

create unique index if not exists templates_one_default_per_product
  on public.templates (product_code)
  where is_default;

create or replace function public.admin_set_default_template(p_template_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_product text;
  v_active boolean;
begin
  select product_code, is_active into v_product, v_active from public.templates where id = p_template_id for update;
  if not found then raise exception 'template_not_found' using errcode = 'P0002'; end if;
  if not v_active then raise exception 'template_archived' using errcode = '22023'; end if;
  -- Clear first, then set: the partial unique index allows only one default per product.
  update public.templates set is_default = false where product_code = v_product and is_default and id <> p_template_id;
  update public.templates set is_default = true where id = p_template_id and not is_default;
end;
$$;

revoke all on function public.admin_set_default_template(uuid) from public, anon, authenticated;
grant execute on function public.admin_set_default_template(uuid) to service_role;

alter table public.tenant_pipelines add column if not exists product_code text;

comment on column public.tenant_pipelines.product_code is
  'SA-4.7: the product whose template built this pipeline (apply_template_pipeline). NULL for partner and hand-made pipelines. One per tenant and product.';

create unique index if not exists tenant_pipelines_one_per_product
  on public.tenant_pipelines (tenant_id, product_code)
  where product_code is not null;

create or replace function public.apply_template_pipeline(
  p_tenant_id uuid,
  p_product_code text,
  p_pipeline_name text,
  p_stages jsonb
)
returns table (pipeline_id uuid, added integer)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
#variable_conflict use_column
declare
  v_pipeline uuid;
  v_name text := left(btrim(coalesce(p_pipeline_name, '')), 120);
  v_next integer;
  v_added integer := 0;
  v_stage record;
begin
  if p_tenant_id is null or coalesce(btrim(p_product_code), '') = '' then
    raise exception 'tenant and product are required' using errcode = '22023';
  end if;
  if v_name = '' then v_name := p_product_code; end if;

  -- The product's pipeline, locked so two applies for the same product cannot interleave.
  select id into v_pipeline from public.tenant_pipelines
   where tenant_id = p_tenant_id and product_code = p_product_code
   for update;

  if v_pipeline is null then
    -- An unpartnered pipeline the agency already made with this name is adopted, not duplicated
    -- (tenant_pipelines_unpartnered_name_idx would refuse a second one anyway).
    select id into v_pipeline from public.tenant_pipelines
     where tenant_id = p_tenant_id and partner_type is null and name = v_name and product_code is null
     for update;
    if v_pipeline is not null then
      update public.tenant_pipelines set product_code = p_product_code, updated_at = now() where id = v_pipeline;
    else
      insert into public.tenant_pipelines (tenant_id, name, partner_type, is_default, product_code)
      values (p_tenant_id, v_name, null, false, p_product_code)
      returning id into v_pipeline;
    end if;
  end if;

  select coalesce(max(s.position), -1) + 1 into v_next
    from public.tenant_pipeline_stages s
   where s.pipeline_id = v_pipeline and not s.is_archived;

  for v_stage in
    select btrim(t.label) as label,
           case when t.stage_type in ('open', 'won', 'lost') then t.stage_type else 'open' end as stage_type,
           case when t.color ~ '^#[0-9a-fA-F]{6}$' then t.color else '#64748b' end as color
      from jsonb_to_recordset(coalesce(p_stages, '[]'::jsonb))
           as t(stage_key text, label text, stage_type text, color text, sort_order integer)
     where char_length(btrim(coalesce(t.label, ''))) between 1 and 120
     order by t.sort_order nulls last, t.label
  loop
    if not exists (
      select 1 from public.tenant_pipeline_stages s
       where s.pipeline_id = v_pipeline and lower(btrim(s.name)) = lower(v_stage.label)
    ) then
      insert into public.tenant_pipeline_stages (pipeline_id, name, position, stage_type, color)
      values (v_pipeline, v_stage.label, v_next, v_stage.stage_type, v_stage.color);
      v_next := v_next + 1;
      v_added := v_added + 1;
    end if;
  end loop;

  if v_added > 0 then
    update public.tenant_pipelines set updated_at = now() where id = v_pipeline;
  end if;

  return query select v_pipeline, v_added;
end;
$$;

revoke all on function public.apply_template_pipeline(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_template_pipeline(uuid, text, text, jsonb) to service_role;

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.templates'::regclass and attname = 'is_default' and not attisdropped) then
    raise exception 'templates.is_default is missing';
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.tenant_pipelines'::regclass and attname = 'product_code' and not attisdropped) then
    raise exception 'tenant_pipelines.product_code is missing';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'templates_one_default_per_product') then
    raise exception 'templates_one_default_per_product is missing';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'tenant_pipelines_one_per_product') then
    raise exception 'tenant_pipelines_one_per_product is missing';
  end if;
  if has_function_privilege('anon', 'public.apply_template_pipeline(uuid, text, text, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.admin_set_default_template(uuid)', 'execute') then
    raise exception 'the new functions must not be callable by anon or authenticated';
  end if;
  if (select count(*) from public.templates where is_default) > (select count(distinct product_code) from public.templates where is_default) then
    raise exception 'more than one default template for a product';
  end if;
end;
$$;

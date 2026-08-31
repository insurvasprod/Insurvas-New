-- Which plan the pricing page highlights, as data rather than as an accident of sort order.
--
-- The public plans API has always returned `is_default` — the agent doc lists it in the contract —
-- but it was computed as `index === 0`, so it silently meant "the cheapest published plan". The
-- doc designates Basic as "the main plan", and the cheapest plan is rarely the one a business
-- wants to lead with. Making it a column lets that be chosen instead of inferred.

alter table public.plans add column if not exists is_default boolean not null default false;

comment on column public.plans.is_default is
  'The plan the public pricing page leads with. At most one non-archived plan may hold it.';

-- At most one. A pricing page that highlights two plans highlights neither, and this is the kind
-- of thing that goes wrong quietly when a second plan is published months later.
create unique index if not exists plans_single_default_idx
  on public.plans ((true))
  where is_default and not is_archived;

-- Carry it through the list view. Appended at the end rather than placed beside is_public:
-- CREATE OR REPLACE VIEW can only add columns to the end, and dropping the view to reorder them
-- would take its grants with it.
create or replace view public.admin_plan_list as
 SELECT DISTINCT ON (code) id, code, version, name, plan_type, description,
    is_public, is_archived, sort_order, created_at,
    ( SELECT count(*) FROM plans v WHERE v.code = p.code) AS version_count,
    ( SELECT count(*) FROM subscriptions s JOIN plans sp ON sp.id = s.plan_id
       WHERE sp.code = p.code AND s.status <> 'cancelled'::subscription_status) AS subscriber_count,
    ( SELECT count(*) FROM subscriptions s JOIN plans sp ON sp.id = s.plan_id
       WHERE sp.code = p.code) AS ever_subscribed_count,
    is_default
   FROM plans p
  ORDER BY code, version DESC;

revoke all on public.admin_plan_list from tenant_app, anon, authenticated;

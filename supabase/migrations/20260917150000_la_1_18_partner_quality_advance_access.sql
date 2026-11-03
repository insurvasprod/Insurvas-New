-- LA-1.18 · Partner Quality is part of the Advance partner workspace.
-- The original plan seed intentionally left this feature unassigned. This follow-up grants it to
-- existing and future Advance v1 subscriptions without changing the Partner Portal add-on.
insert into public.plan_features (plan_id, feature_key)
select p.id, 'partner_quality'
from public.plans p
where p.code = 'advance'
  and p.version = 1
on conflict do nothing;

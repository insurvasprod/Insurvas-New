-- LA-1.17: the partner pipeline is a bounded read model, not an analytics query.
-- PostgreSQL JIT compilation can cost more than the 5,000-row read itself on a
-- cold request, making the first page breach the two-second contract. Keep this
-- scoped to the function; do not change the project's global JIT policy.
alter function public.partner_lead_pipeline_page(
  uuid, uuid, date, date, uuid, text, uuid, text, text, integer, integer
) set jit = off;

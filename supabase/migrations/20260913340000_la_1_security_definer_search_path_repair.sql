-- LA-1 security repair identified during the baseline audit.
-- Keep the existing function contract and only harden its execution environment.

alter function public.render_disposition_note(text, text, text, text, text, text)
  set search_path = pg_catalog;

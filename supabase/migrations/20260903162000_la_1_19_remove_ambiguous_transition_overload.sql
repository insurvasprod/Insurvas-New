-- LA-1.19: the eight-argument transition RPC supersedes the first draft. Removing the old
-- overload is required because PostgREST cannot choose between functions with default args.
drop function if exists public.transition_partner_with_limits(uuid, uuid, public.partner_status, text, integer, integer, integer);

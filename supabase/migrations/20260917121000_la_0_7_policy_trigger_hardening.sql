-- The trigger invokes this function internally; it is not an application RPC.
revoke all on function public.touch_tenant_policies_updated_at() from public, anon, authenticated;

-- LA-1.22: callback writes must use audited server-side lifecycle functions.

revoke insert, update, delete on public.callbacks, public.callback_history from tenant_app;
grant select on public.callbacks, public.callback_history to tenant_app;

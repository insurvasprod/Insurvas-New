-- SA-4.2 · The platform has one configured payment provider: Whop.
--
-- Credentials deliberately remain in process environment variables. This migration only makes the
-- provider registry usable after a schema replay; it does not store a key, secret, mode, or price.
-- The update first clears any legacy default because provider_settings has a unique partial index on
-- is_default, then the idempotent upsert establishes Whop as the single platform default.

update public.provider_settings
set is_default = false,
    updated_at = now()
where is_default = true
  and provider <> 'whop';

insert into public.provider_settings (
  provider,
  display_label,
  is_enabled,
  is_default
)
values (
  'whop',
  'Whop',
  true,
  true
)
on conflict (provider) do update
set display_label = excluded.display_label,
    is_enabled = true,
    is_default = true,
    updated_at = now();

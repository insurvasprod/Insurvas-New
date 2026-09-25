-- Per-treatment sound preferences, stored per user rather than per browser.
--
-- The six notification treatments (win, arrive, done, warn, block, fail) each decide whether they
-- make a noise. Two of them are audible by default and two more are opt-in, and until now that
-- choice lived in localStorage — which meant an agent who switched machines, or whose browser data
-- was cleared, silently got the defaults back. The master controls beside it (do_not_disturb,
-- sound_muted, sound_volume) have been per user since LA-1.25; having half the sound settings
-- follow someone between machines and half not is worse than either answer on its own.
--
-- Additive only: one nullable-by-default jsonb column. Existing rows keep working untouched and
-- read as "no explicit choice", which is exactly what an empty object means to the application —
-- fall back to the defaults. Nothing needs backfilling.
--
-- Deliberately NOT a column per treatment. The set of treatments is a product decision that has
-- already changed once during this work; a shape that requires DDL every time someone adds a
-- seventh is a shape that will instead grow a second storage mechanism beside it.

alter table public.agent_notification_settings
  add column if not exists sound_treatments jsonb not null default '{}'::jsonb;

-- The application reads this as Partial<Record<Treatment, boolean>>: a missing key means "no
-- opinion, use the default", and a present key must be a real yes or no. Without the guard a null
-- or a string would read as neither, and the resulting silence would be indistinguishable from a
-- deliberate mute.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.agent_notification_settings'::regclass
      and conname = 'agent_notification_settings_sound_treatments_object'
  ) then
    alter table public.agent_notification_settings
      add constraint agent_notification_settings_sound_treatments_object
      check (jsonb_typeof(sound_treatments) = 'object');
  end if;
end $$;

-- Only the four treatments that can ever be audible may appear. `done` and `fail` are silent
-- permanently and by design — a chime for every routine save is a chime nobody hears, and a noise
-- for a server fault fires in bursts on exactly the days it is least welcome. Storing a key for
-- them would imply a control that does not exist, and would quietly become one the first time
-- somebody wrote the obvious loop over Object.keys.
--
-- Written without a subquery: Postgres refuses one in a CHECK (0A000 "cannot use subquery in check
-- constraint"), which is how the first apply of this file failed on 2026-09-24. `jsonb - text[]`
-- strips the four allowed keys, so anything left over is a key that must not be there; each allowed
-- key, when present, must hold a boolean. The CASE is there because `-` raises on a non-object and
-- Postgres does not promise to evaluate AND/OR left to right — the _object constraint above is what
-- rejects a non-object, and this one simply passes it through to that.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.agent_notification_settings'::regclass
      and conname = 'agent_notification_settings_sound_treatments_keys'
  ) then
    alter table public.agent_notification_settings
      add constraint agent_notification_settings_sound_treatments_keys
      check (
        case when jsonb_typeof(sound_treatments) = 'object' then
          (sound_treatments - array['win', 'arrive', 'warn', 'block']) = '{}'::jsonb
          and coalesce(jsonb_typeof(sound_treatments -> 'win'), 'boolean') = 'boolean'
          and coalesce(jsonb_typeof(sound_treatments -> 'arrive'), 'boolean') = 'boolean'
          and coalesce(jsonb_typeof(sound_treatments -> 'warn'), 'boolean') = 'boolean'
          and coalesce(jsonb_typeof(sound_treatments -> 'block'), 'boolean') = 'boolean'
        else true end
      );
  end if;
end $$;

comment on column public.agent_notification_settings.sound_treatments is
  'Per-treatment sound opt-in. Partial<Record<"win"|"arrive"|"warn"|"block", boolean>>; a missing key means use the default (win, arrive and block on, warn off). done and fail are never audible and must not appear.';

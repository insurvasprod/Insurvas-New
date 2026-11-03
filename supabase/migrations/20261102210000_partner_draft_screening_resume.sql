-- Keep the partner-safe result of the phone-entry screen with its draft so Resume can reopen
-- the in-progress form without repeating the number-entry screen. Submission still evaluates
-- the transfer gate again at the authoritative submit step.
alter table public.form_drafts
  add column if not exists screening_result_id uuid,
  add column if not exists screening_submission_id uuid,
  add column if not exists screening_snapshot jsonb;

comment on column public.form_drafts.screening_result_id is
  'Pointer to the completed phone screening result for this draft; verified against its saved phone before resume.';
comment on column public.form_drafts.screening_submission_id is
  'Retry key used by the number-entry screen and matching final submit gate.';
comment on column public.form_drafts.screening_snapshot is
  'Partner-safe response from phone-entry screening. Contains no phone number or vendor/list detail.';

notify pgrst, 'reload schema';

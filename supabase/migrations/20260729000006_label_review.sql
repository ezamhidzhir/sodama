-- Fasa 4a — human-in-the-loop label review.
--
-- Until now a file carried only YAMNet's guess, and the export shipped that guess
-- as if it were ground truth. YAMNet is often wrong (a 440 Hz test tone comes back
-- as "Telephone"), so training on unreviewed output teaches the model YAMNet's
-- mistakes. These columns let a trainer confirm, correct, or reject each label and
-- record who did it — the "ML Trainer Review" and "Approve Dataset" steps of the
-- proposal, which the implementation had been skipping.
--
-- `status` (pending/processing/done/error) stays as-is: that is the *pipeline*
-- state. `review_status` is a separate axis — the *human* verdict.

alter table public.audio_files
  add column if not exists review_status text not null default 'unreviewed',
  add column if not exists verified_label text,
  add column if not exists reviewed_by    text,
  add column if not exists reviewed_at    timestamptz,
  add column if not exists review_note    text,
  -- ESP32 clips knew their device only through the filename prefix; a real FK lets
  -- the export carry a device column. Deleting a device keeps its recordings.
  add column if not exists device_id      uuid references public.devices(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'audio_files_review_status_check') then
    alter table public.audio_files add constraint audio_files_review_status_check
      check (review_status in ('unreviewed', 'approved', 'rejected'));
  end if;
end $$;

-- Library filters and the dataset readiness summary both group on this.
create index if not exists audio_files_review_status_idx on public.audio_files (review_status);
create index if not exists audio_files_device_id_idx     on public.audio_files (device_id);

comment on column public.audio_files.review_status is
  'Human verdict: unreviewed | approved | rejected. Independent of `status` (pipeline state).';
comment on column public.audio_files.verified_label is
  'Label confirmed or corrected by a human. NULL means the label is still YAMNet''s unverified guess.';

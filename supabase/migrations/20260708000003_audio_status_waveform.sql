-- Fasa 2: classification pipeline status + precomputed waveform peaks
alter table public.audio_files
    add column status text not null default 'pending'
        check (status in ('pending', 'processing', 'done', 'error')),
    add column waveform jsonb;  -- downsampled peak array for dashboard rendering

create index audio_files_status_idx on public.audio_files (status);

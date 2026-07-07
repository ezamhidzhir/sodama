-- Storage bucket for audio files (private; access via signed URLs / service role)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'audio-files',
    'audio-files',
    false,
    52428800,  -- 50 MB per file
    array['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/flac', 'audio/ogg']
)
on conflict (id) do nothing;

-- Authenticated dashboard users can read audio objects;
-- writes go through the backend (service role, bypasses RLS).
create policy "audio_files_bucket_read" on storage.objects
    for select to authenticated
    using (bucket_id = 'audio-files');

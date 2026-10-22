-- A stream chunk is muted by the privacy filter when it arrives, so by the time
-- a "join" session is stitched the voices are already silence and a second pass
-- finds nothing. Each chunk keeps what was muted, so the joined recording can
-- report it (speech_removed_seconds / privacy_redactions) like any other file.
alter table public.ingest_chunks
    add column if not exists privacy_redactions jsonb not null default '[]'::jsonb;

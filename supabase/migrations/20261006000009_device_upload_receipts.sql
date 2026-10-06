-- Fasa 6 — one upload contract for every recording client.
--
-- Until now the ingest path was ESP32-specific: raw PCM in, a row out, and
-- nothing the device could check before freeing its own storage. The new
-- contract works for any client (ESP32, a script on a laptop, ...):
--
--   record -> POST /ingest (client id + SHA-256) -> server replies with the
--   hash it stored -> client deletes its local copy only if the hashes match.
--
-- Retries are safe because the client's id is unique per device: a re-sent
-- recording is recognised and answered with the original receipt instead of
-- being stored twice. Stream mode sends ~10 s chunks under a session id; with
-- "join" on, the server stitches them into one recording when the session
-- closes.

-- ============================================================
-- 1. source: 'esp32' becomes 'device' — any API-key client
-- ============================================================
alter table public.audio_files drop constraint if exists audio_files_source_check;
update public.audio_files set source = 'device' where source = 'esp32';
alter table public.audio_files add constraint audio_files_source_check
    check (source in ('upload', 'device', 'recording'));

-- ============================================================
-- 2. audio_files: upload receipt + stream provenance
-- ============================================================
alter table public.audio_files
    add column if not exists client_id   uuid,     -- id the sending client gave this recording
    add column if not exists sha256      text,     -- hex SHA-256 of the body exactly as received
    add column if not exists session_id  uuid,     -- stream mode: the session this clip came from
    add column if not exists chunk_index integer;  -- stream mode, not joined: position in the session

-- One recording per (device, client id): what makes a retry idempotent.
create unique index if not exists audio_files_device_client_uidx
    on public.audio_files (device_id, client_id) where client_id is not null;
-- Same for a stream chunk re-sent without a client id.
create unique index if not exists audio_files_session_chunk_uidx
    on public.audio_files (session_id, chunk_index) where chunk_index is not null;
create index if not exists audio_files_session_idx
    on public.audio_files (session_id) where session_id is not null;

-- ============================================================
-- 3. ingest_sessions: one row per stream-mode recording
-- ============================================================
create table if not exists public.ingest_sessions (
    id            uuid primary key,                 -- chosen by the client
    device_id     uuid not null references public.devices (id) on delete cascade,
    user_id       uuid references auth.users (id) on delete cascade,
    join_chunks   boolean not null default false,
    -- 'joining' claims the session while chunks are stitched, so two close
    -- calls racing each other cannot produce two joined recordings.
    status        text not null default 'open' check (status in ('open', 'joining', 'closed')),
    audio_file_id uuid references public.audio_files (id) on delete set null,  -- the joined result
    started_at    timestamptz not null default now(),
    closed_at     timestamptz
);
create index if not exists ingest_sessions_device_idx on public.ingest_sessions (device_id);

-- ============================================================
-- 4. ingest_chunks: chunks of a "join" session, waiting to be stitched
-- ============================================================
-- Kept out of audio_files so the Library never shows half a recording.
create table if not exists public.ingest_chunks (
    session_id   uuid not null references public.ingest_sessions (id) on delete cascade,
    chunk_index  integer not null check (chunk_index >= 0),
    client_id    uuid,
    sha256       text not null,
    storage_path text not null,
    duration     real not null,
    recorded_at  timestamptz,
    received_at  timestamptz not null default now(),
    primary key (session_id, chunk_index)
);

-- Only the backend (service role) touches either table; with RLS on and no
-- policies, browser clients holding the anon key see nothing.
alter table public.ingest_sessions enable row level security;
alter table public.ingest_chunks   enable row level security;

comment on column public.audio_files.client_id is
    'Recording id chosen by the uploading client; unique per device so retries are idempotent';
comment on column public.audio_files.sha256 is
    'SHA-256 of the uploaded body; returned in the receipt so the client can verify before deleting its copy';

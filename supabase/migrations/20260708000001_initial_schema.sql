-- Sound Data Management System — initial schema (Fasa 1)
-- Tables: audio_files, classifications, metadata, datasets, dataset_items, devices

create extension if not exists "uuid-ossp";

-- ============================================================
-- audio_files: one row per uploaded/streamed audio file
-- ============================================================
create table public.audio_files (
    id           uuid primary key default gen_random_uuid(),
    filename     text not null,
    storage_path text not null unique,
    duration     double precision,          -- seconds
    sample_rate  integer,                   -- Hz (target: 16000)
    file_size    bigint,                    -- bytes
    source       text not null default 'upload' check (source in ('upload', 'esp32')),
    uploaded_at  timestamptz not null default now(),
    user_id      uuid references auth.users (id) on delete set null
);

create index audio_files_user_id_idx     on public.audio_files (user_id);
create index audio_files_uploaded_at_idx on public.audio_files (uploaded_at desc);
create index audio_files_source_idx      on public.audio_files (source);

-- ============================================================
-- classifications: YAMNet per-window results (0.96s windows)
-- ============================================================
create table public.classifications (
    id            uuid primary key default gen_random_uuid(),
    audio_file_id uuid not null references public.audio_files (id) on delete cascade,
    class_name    text not null,
    confidence    real not null check (confidence >= 0 and confidence <= 1),
    window_start  double precision not null,  -- seconds from file start
    window_end    double precision not null,
    created_at    timestamptz not null default now()
);

create index classifications_audio_file_id_idx on public.classifications (audio_file_id);
create index classifications_class_name_idx    on public.classifications (class_name);

-- ============================================================
-- metadata: flexible key-value tags per audio file
-- ============================================================
create table public.metadata (
    id            uuid primary key default gen_random_uuid(),
    audio_file_id uuid not null references public.audio_files (id) on delete cascade,
    key           text not null,
    value         text not null,
    unique (audio_file_id, key)
);

create index metadata_audio_file_id_idx on public.metadata (audio_file_id);
create index metadata_key_idx           on public.metadata (key);

-- ============================================================
-- datasets + dataset_items: curated collections for ML training
-- ============================================================
create table public.datasets (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    description text,
    created_at  timestamptz not null default now(),
    user_id     uuid references auth.users (id) on delete set null
);

create index datasets_user_id_idx on public.datasets (user_id);

create table public.dataset_items (
    dataset_id    uuid not null references public.datasets (id) on delete cascade,
    audio_file_id uuid not null references public.audio_files (id) on delete cascade,
    added_at      timestamptz not null default now(),
    primary key (dataset_id, audio_file_id)
);

-- ============================================================
-- devices: ESP32 device registry + API key auth
-- ============================================================
create table public.devices (
    id          uuid primary key default gen_random_uuid(),
    device_name text not null unique,
    api_key     text not null unique,
    last_seen   timestamptz,
    created_at  timestamptz not null default now()
);

-- ============================================================
-- Row Level Security
-- Backend (service role) bypasses RLS; policies below cover
-- authenticated dashboard users reading/writing their own data.
-- ============================================================
alter table public.audio_files     enable row level security;
alter table public.classifications enable row level security;
alter table public.metadata        enable row level security;
alter table public.datasets        enable row level security;
alter table public.dataset_items   enable row level security;
alter table public.devices         enable row level security;

-- audio_files: owner full access; ESP32 rows (user_id null) readable by any authenticated user
create policy "audio_files_select" on public.audio_files
    for select to authenticated
    using (user_id = (select auth.uid()) or user_id is null);

create policy "audio_files_insert" on public.audio_files
    for insert to authenticated
    with check (user_id = (select auth.uid()));

create policy "audio_files_update" on public.audio_files
    for update to authenticated
    using (user_id = (select auth.uid()));

create policy "audio_files_delete" on public.audio_files
    for delete to authenticated
    using (user_id = (select auth.uid()));

-- classifications / metadata: visible when parent audio file is visible
create policy "classifications_select" on public.classifications
    for select to authenticated
    using (exists (
        select 1 from public.audio_files af
        where af.id = audio_file_id
          and (af.user_id = (select auth.uid()) or af.user_id is null)
    ));

create policy "metadata_select" on public.metadata
    for select to authenticated
    using (exists (
        select 1 from public.audio_files af
        where af.id = audio_file_id
          and (af.user_id = (select auth.uid()) or af.user_id is null)
    ));

create policy "metadata_write" on public.metadata
    for all to authenticated
    using (exists (
        select 1 from public.audio_files af
        where af.id = audio_file_id and af.user_id = (select auth.uid())
    ))
    with check (exists (
        select 1 from public.audio_files af
        where af.id = audio_file_id and af.user_id = (select auth.uid())
    ));

-- datasets: owner-only
create policy "datasets_all" on public.datasets
    for all to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

create policy "dataset_items_all" on public.dataset_items
    for all to authenticated
    using (exists (
        select 1 from public.datasets d
        where d.id = dataset_id and d.user_id = (select auth.uid())
    ))
    with check (exists (
        select 1 from public.datasets d
        where d.id = dataset_id and d.user_id = (select auth.uid())
    ));

-- devices: no policies — service role (backend) only.

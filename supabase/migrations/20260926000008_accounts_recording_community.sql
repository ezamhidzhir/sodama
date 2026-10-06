-- Fasa 5 — per-user accounts, in-app recording, community sharing.
--
-- Until now every endpoint ran as the service role with no idea who was asking,
-- so every signed-in user saw (and could delete) everyone's audio. The backend
-- now verifies the Supabase JWT on each request and scopes every query by
-- `user_id`; this migration gives the remaining tables an owner and adds what
-- the three new features need.

-- ============================================================
-- 1. profiles: one row per auth user (created lazily by the backend)
-- ============================================================
create table if not exists public.profiles (
    id           uuid primary key references auth.users (id) on delete cascade,
    username     text not null unique
                 check (username ~ '^[a-z0-9_]{3,30}$'),
    full_name    text check (char_length(full_name) <= 80),
    bio          text check (char_length(bio) <= 300),
    organization text check (char_length(organization) <= 100),
    role         text check (role in ('student', 'researcher', 'lecturer',
                                      'industry', 'hobbyist', 'other')),
    avatar_path  text,                        -- object path in the `avatars` bucket
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
    for select to authenticated using (true);   -- usernames are public in Community

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
    for update to authenticated
    using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ============================================================
-- 2. audio_files: in-app recordings with capture metadata
-- ============================================================
alter table public.audio_files drop constraint if exists audio_files_source_check;
alter table public.audio_files add constraint audio_files_source_check
    check (source in ('upload', 'esp32', 'recording'));

alter table public.audio_files
    add column if not exists recorded_at       timestamptz,       -- when the sound happened (device clock)
    add column if not exists latitude          double precision,
    add column if not exists longitude         double precision,
    add column if not exists location_accuracy real,              -- metres, from the Geolocation API
    add column if not exists location_name     text,              -- human-readable place, e.g. "Seri Iskandar, Perak"
    -- Where `verified_label` came from: 'capture' = typed by the recordist at
    -- recording time, 'review' = set on the review panel. NULL = no human label.
    add column if not exists label_origin      text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'audio_files_label_origin_check') then
    alter table public.audio_files add constraint audio_files_label_origin_check
      check (label_origin in ('capture', 'review'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'audio_files_lat_check') then
    alter table public.audio_files add constraint audio_files_lat_check
      check (latitude between -90 and 90 and longitude between -180 and 180);
  end if;
end $$;

-- Existing reviewed rows were all labelled on the review panel.
update public.audio_files set label_origin = 'review'
 where verified_label is not null and label_origin is null;

create index if not exists audio_files_verified_label_idx on public.audio_files (verified_label);

-- ============================================================
-- 3. datasets: class list + community publishing
-- ============================================================
alter table public.datasets
    add column if not exists labels         text[] not null default '{}',  -- the classes this dataset collects
    add column if not exists visibility     text   not null default 'private',
    add column if not exists license        text,
    add column if not exists share_location boolean not null default false,
    add column if not exists published_at   timestamptz,
    add column if not exists download_count integer not null default 0,
    add column if not exists updated_at     timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'datasets_visibility_check') then
    alter table public.datasets add constraint datasets_visibility_check
      check (visibility in ('private', 'public'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'datasets_license_check') then
    alter table public.datasets add constraint datasets_license_check
      check (license in ('CC-BY-4.0', 'CC-BY-NC-4.0', 'CC-BY-SA-4.0', 'CC0-1.0'));
  end if;
end $$;

create index if not exists datasets_visibility_idx on public.datasets (visibility, published_at desc);

drop policy if exists "datasets_public_select" on public.datasets;
create policy "datasets_public_select" on public.datasets
    for select to authenticated using (visibility = 'public');

create table if not exists public.dataset_likes (
    dataset_id uuid not null references public.datasets (id) on delete cascade,
    user_id    uuid not null references auth.users (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (dataset_id, user_id)
);
create index if not exists dataset_likes_user_idx on public.dataset_likes (user_id);

alter table public.dataset_likes enable row level security;
drop policy if exists "dataset_likes_own" on public.dataset_likes;
create policy "dataset_likes_own" on public.dataset_likes
    for all to authenticated
    using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ============================================================
-- 4. devices: owned by a user; names unique per owner, not globally
-- ============================================================
alter table public.devices
    add column if not exists user_id uuid references auth.users (id) on delete cascade;
alter table public.devices drop constraint if exists devices_device_name_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'devices_user_name_key') then
    alter table public.devices add constraint devices_user_name_key unique (user_id, device_name);
  end if;
end $$;
create index if not exists devices_user_id_idx on public.devices (user_id);

-- ============================================================
-- 5. Give pre-existing rows an owner
-- Everything created before accounts were enforced belongs to the project
-- owner's account. If that account does not exist the rows stay NULL and are
-- simply invisible, never exposed to another user.
-- ============================================================
do $$
declare owner uuid;
begin
  select id into owner from auth.users where email = 'ezamhidzhir09@gmail.com';
  if owner is not null then
    update public.audio_files set user_id = owner where user_id is null;
    update public.datasets    set user_id = owner where user_id is null;
    update public.devices     set user_id = owner where user_id is null;
  end if;
end $$;

-- ============================================================
-- 6. Avatars bucket (public read — profile pictures are shown in Community)
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ============================================================
-- 7. dashboard_stats, now per user
-- The argument list changes, so the old function is DROPPED first — a bare
-- `create or replace` would add an overload and PostgREST would fail with
-- PGRST203 (see migration 7).
-- ============================================================
drop function if exists public.dashboard_stats(real);
drop function if exists public.dashboard_stats();

create or replace function public.dashboard_stats(p_user uuid, min_confidence real default 0.3)
returns json
language sql
stable
set search_path = ''
as $$
  with mine as (select * from public.audio_files where user_id = p_user)
  select json_build_object(
    'total_files', (select count(*) from mine),
    'total_duration_seconds', coalesce((select sum(duration) from mine), 0),
    'files_by_source', (
      select coalesce(json_object_agg(source, n), '{}'::json)
      from (select source, count(*) n from mine group by source) s
    ),
    'files_by_status', (
      select coalesce(json_object_agg(status, n), '{}'::json)
      from (select status, count(*) n from mine group by status) s
    ),
    'files_by_review', (
      select coalesce(json_object_agg(review_status, n), '{}'::json)
      from (select review_status, count(*) n from mine group by review_status) s
    ),
    'class_distribution', (
      select coalesce(json_agg(row_to_json(c)), '[]'::json)
      from (
        select cl.class_name,
               count(distinct cl.audio_file_id) as file_count,
               round(avg(cl.confidence)::numeric, 4)::float8 as avg_confidence,
               round(max(cl.confidence)::numeric, 4)::float8 as max_confidence
        from public.classifications cl
        join mine m on m.id = cl.audio_file_id
        where cl.confidence >= min_confidence
        group by cl.class_name
        order by file_count desc, avg_confidence desc, cl.class_name
        limit 10
      ) c
    ),
    'label_distribution', (
      select coalesce(json_agg(row_to_json(l)), '[]'::json)
      from (
        select verified_label as label, count(*) as file_count
        from mine
        where verified_label is not null and review_status <> 'rejected'
        group by verified_label
        order by file_count desc, verified_label
        limit 10
      ) l
    ),
    'min_confidence', min_confidence,
    'total_datasets', (select count(*) from public.datasets where user_id = p_user),
    'public_datasets', (select count(*) from public.datasets
                        where user_id = p_user and visibility = 'public'),
    'total_devices', (select count(*) from public.devices where user_id = p_user)
  );
$$;

-- ============================================================
-- 8. community_datasets: the public catalogue in one round-trip
-- Counts exclude rejected clips, matching what a download actually contains.
-- ============================================================
create or replace function public.community_datasets(
    p_viewer uuid,
    p_query  text default null,
    p_sort   text default 'popular',     -- popular | newest | likes | clips
    p_owner  uuid default null,
    p_limit  int  default 24,
    p_offset int  default 0)
returns json
language sql
stable
set search_path = ''
as $$
  with base as (
    select d.id, d.name, d.description, d.labels, d.license, d.published_at,
           d.download_count, d.user_id,
           s.clip_count, s.total_duration,
           (select count(*) from public.dataset_likes l where l.dataset_id = d.id) as like_count,
           exists (select 1 from public.dataset_likes l
                   where l.dataset_id = d.id and l.user_id = p_viewer) as liked,
           (select coalesce(array_agg(x.label order by x.n desc, x.label), '{}')
              from (select af.verified_label as label, count(*) as n
                      from public.dataset_items di
                      join public.audio_files af on af.id = di.audio_file_id
                     where di.dataset_id = d.id and af.verified_label is not null
                       and af.review_status <> 'rejected'
                     group by af.verified_label
                     order by n desc limit 8) x) as top_labels
      from public.datasets d
      cross join lateral (
        select count(*) as clip_count, coalesce(sum(af.duration), 0) as total_duration
          from public.dataset_items di
          join public.audio_files af on af.id = di.audio_file_id
         where di.dataset_id = d.id and af.review_status <> 'rejected'
      ) s
     where d.visibility = 'public'
       and (p_owner is null or d.user_id = p_owner)
       and (p_query is null or p_query = ''
            or d.name ilike '%' || p_query || '%'
            or d.description ilike '%' || p_query || '%'
            or exists (select 1 from unnest(d.labels) lb where lb ilike '%' || p_query || '%')
            or exists (select 1 from public.dataset_items di
                         join public.audio_files af on af.id = di.audio_file_id
                        where di.dataset_id = d.id
                          and af.verified_label ilike '%' || p_query || '%'))
  )
  select json_build_object(
    'total', (select count(*) from base),
    'items', coalesce((
      select json_agg(row_to_json(r))
      from (
        select b.*, p.username, p.full_name, p.avatar_path
          from base b
          left join public.profiles p on p.id = b.user_id
         order by
           case when p_sort = 'newest' then extract(epoch from b.published_at) end desc nulls last,
           case when p_sort = 'likes'  then b.like_count end desc nulls last,
           case when p_sort = 'clips'  then b.clip_count end desc nulls last,
           (b.download_count + 2 * b.like_count) desc,
           b.published_at desc nulls last
         limit p_limit offset p_offset
      ) r
    ), '[]'::json)
  );
$$;

-- Fasa 6b — clips, privacy filter, quotas, edits and Community reports.
--
-- Every schema change for this phase is in one file so it is applied once.
--
--   1. Clips: a long recording is split into short clips that each get their
--      own label and review. A clip is *virtual* — it points at a stretch of
--      its parent recording and stores no audio of its own.
--   2. Edits: loops, merges and copies saved from Community are real files,
--      flagged so they never slip into training data unnoticed.
--   3. Privacy: where human speech was muted before the audio was stored.
--   4. Quota: minutes of stored audio each user may keep.
--   5. Reports: Community datasets hide themselves after enough reports.

-- ============================================================
-- 1. audio_files: virtual clips
-- ============================================================
alter table public.audio_files
    add column if not exists parent_id  uuid references public.audio_files (id) on delete cascade,
    add column if not exists clip_start double precision,   -- seconds into the parent
    add column if not exists clip_end   double precision;

-- A clip has no storage object of its own; an original always has one.
alter table public.audio_files alter column storage_path drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'audio_files_clip_shape_check') then
    alter table public.audio_files add constraint audio_files_clip_shape_check check (
      (parent_id is null and storage_path is not null and clip_start is null and clip_end is null)
      or
      (parent_id is not null and storage_path is null and clip_start >= 0 and clip_end > clip_start)
    );
  end if;
end $$;

create index if not exists audio_files_parent_idx on public.audio_files (parent_id)
    where parent_id is not null;

-- ============================================================
-- 2. audio_files: edited audio and where it came from
-- ============================================================
alter table public.audio_files
    -- loop = repeated to a target length, merge = several clips joined,
    -- copy = a stretch of someone else's public clip saved to this library
    add column if not exists edit_kind    text,
    add column if not exists derived_from uuid[] not null default '{}',
    -- for copies: {"author": "username", "license": "CC-BY-4.0",
    --              "dataset_id": "...", "dataset_name": "...", "audio_id": "..."}
    add column if not exists attribution  jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'audio_files_edit_kind_check') then
    alter table public.audio_files add constraint audio_files_edit_kind_check
      check (edit_kind in ('loop', 'merge', 'copy'));
  end if;
end $$;

-- ============================================================
-- 3. audio_files: privacy filter results
-- ============================================================
alter table public.audio_files
    add column if not exists speech_removed_seconds real  not null default 0,
    add column if not exists privacy_redactions     jsonb not null default '[]'::jsonb;  -- [[start, end], ...]

comment on column public.audio_files.privacy_redactions is
    'Stretches (seconds) muted because YAMNet heard human speech there; muted before the audio was stored';

-- ============================================================
-- 4. profiles: storage quota
-- ============================================================
alter table public.profiles
    add column if not exists quota_seconds integer not null default 1800
    check (quota_seconds >= 0);

comment on column public.profiles.quota_seconds is
    'Seconds of stored audio (originals, edits, copies — not virtual clips) this user may keep';

-- ============================================================
-- 5. Community reports
-- ============================================================
alter table public.datasets
    add column if not exists hidden_at timestamptz;   -- set when reports reach the threshold

create table if not exists public.dataset_reports (
    dataset_id uuid not null references public.datasets (id) on delete cascade,
    user_id    uuid not null references auth.users (id) on delete cascade,
    reason     text not null check (reason in ('voices', 'copyright', 'offensive', 'spam', 'other')),
    note       text check (char_length(note) <= 300),
    created_at timestamptz not null default now(),
    primary key (dataset_id, user_id)
);
alter table public.dataset_reports enable row level security;   -- backend only

-- ============================================================
-- 6. dashboard_stats: count recordings once, clips separately, show quota
-- ============================================================
create or replace function public.dashboard_stats(p_user uuid, min_confidence real default 0.3)
returns json
language sql
stable
set search_path = ''
as $$
  with mine as (select * from public.audio_files where user_id = p_user),
       originals as (select * from mine where parent_id is null)
  select json_build_object(
    'total_files', (select count(*) from originals),
    'total_clips', (select count(*) from mine where parent_id is not null),
    'total_duration_seconds', coalesce((select sum(duration) from originals), 0),
    'quota_used_seconds', coalesce((select sum(duration) from mine where storage_path is not null), 0),
    'quota_seconds', coalesce((select quota_seconds from public.profiles where id = p_user), 1800),
    'speech_removed_seconds', coalesce((select sum(speech_removed_seconds) from originals), 0),
    'files_by_source', (
      select coalesce(json_object_agg(source, n), '{}'::json)
      from (select source, count(*) n from originals group by source) s
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
        join originals m on m.id = cl.audio_file_id
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
-- 7. community_datasets: hidden datasets leave the catalogue
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
       and d.hidden_at is null
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

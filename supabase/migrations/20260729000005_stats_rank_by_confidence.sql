-- Fix "Top classes": rank by prevalence AND strength, not alphabetically.
--
-- The previous version ordered by (file_count desc, class_name). YAMNet logs the
-- top-3 classes per window, so a file also carries many weak guesses (Aircraft at
-- 11%, Boat at 12%, ...). With a small collection every class ties at the same
-- file_count and the alphabetical tiebreak wins, burying the classes that actually
-- describe the audio. Now weak predictions are excluded and ties break on mean
-- confidence.

create or replace function public.dashboard_stats(min_confidence real default 0.3)
returns json
language sql
stable
as $$
  select json_build_object(
    'total_files', (select count(*) from public.audio_files),
    'total_duration_seconds', coalesce((select sum(duration) from public.audio_files), 0),
    'files_by_source', (
      select coalesce(json_object_agg(source, n), '{}'::json)
      from (select source, count(*) n from public.audio_files group by source) s
    ),
    'files_by_status', (
      select coalesce(json_object_agg(status, n), '{}'::json)
      from (select status, count(*) n from public.audio_files group by status) s
    ),
    'class_distribution', (
      select coalesce(json_agg(row_to_json(c)), '[]'::json)
      from (
        select class_name,
               count(distinct audio_file_id) as file_count,
               round(avg(confidence)::numeric, 4)::float8 as avg_confidence,
               round(max(confidence)::numeric, 4)::float8 as max_confidence
        from public.classifications
        where confidence >= min_confidence
        group by class_name
        order by file_count desc, avg_confidence desc, class_name
        limit 10
      ) c
    ),
    'min_confidence', min_confidence,
    'total_datasets', (select count(*) from public.datasets),
    'total_devices', (select count(*) from public.devices)
  );
$$;

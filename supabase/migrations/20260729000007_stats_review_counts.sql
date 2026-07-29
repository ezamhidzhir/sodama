-- Add review counts to the dashboard aggregate so the trainer can see, at a
-- glance, how much of the collection still needs verifying.
--
-- Same signature as 20260729000005 — `create or replace` genuinely replaces it.
-- (Changing the argument list would ADD an overload instead and break callers
-- with PGRST203 "could not choose the best candidate function", which is exactly
-- what happened when dashboard_stats() gained its min_confidence parameter.)

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
    'files_by_review', (
      select coalesce(json_object_agg(review_status, n), '{}'::json)
      from (select review_status, count(*) n from public.audio_files group by review_status) s
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

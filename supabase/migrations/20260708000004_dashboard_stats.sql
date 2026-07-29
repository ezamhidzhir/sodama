-- Fasa 3: aggregated stats for the dashboard, computed in one round-trip
create or replace function public.dashboard_stats()
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
        select class_name, count(distinct audio_file_id) as file_count
        from public.classifications
        group by class_name
        order by file_count desc, class_name
        limit 10
      ) c
    ),
    'total_datasets', (select count(*) from public.datasets),
    'total_devices', (select count(*) from public.devices)
  );
$$;

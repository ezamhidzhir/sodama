-- Devices page redesign.
-- 1. Each device remembers what it is, so the page shows the right setup guide:
--    'computer' = a laptop or PC running client/sodama_client.py
--    'api'      = an ESP32 or any program that calls /ingest itself
-- 2. device_stats() gives each device's recording count, total length and
--    latest recording in one call for the device cards.

alter table public.devices
    add column if not exists kind text not null default 'computer';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'devices_kind_check') then
    alter table public.devices add constraint devices_kind_check
      check (kind in ('computer', 'api'));
  end if;
end $$;

-- Whole recordings only: a clip cut from a device recording keeps its
-- device_id, and counting it would inflate the total.
create or replace function public.device_stats(p_user uuid)
returns table (device_id uuid, recordings bigint, total_seconds double precision,
               last_recording timestamptz)
language sql stable
as $$
    select a.device_id,
           count(*),
           coalesce(sum(a.duration), 0),
           max(coalesce(a.recorded_at, a.uploaded_at))
    from public.audio_files a
    where a.user_id = p_user
      and a.device_id is not null
      and a.parent_id is null
    group by a.device_id;
$$;

-- Only the backend (service role) may call it: it takes any user's id.
revoke execute on function public.device_stats(uuid) from public, anon, authenticated;

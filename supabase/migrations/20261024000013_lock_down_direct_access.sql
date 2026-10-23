-- Close direct access that the app never uses.
--
-- The browser holds the anon key (it needs it to sign in), so anything the
-- `authenticated` role may do, any signed-up user can do straight against
-- Supabase, bypassing the backend. The app itself reads audio only through the
-- backend (service role + signed URLs), so these grants were pure exposure.

-- 1. Storage: this policy let every signed-in user list and download every
--    object in the private `audio-files` bucket, including other users'
--    unpublished recordings. Signed URLs made by the backend keep working
--    without it.
drop policy if exists "audio_files_bucket_read" on storage.objects;

-- 2. Stats functions take a user id as a parameter. Row-level security already
--    limits what a caller sees, but only the backend needs to call them.
revoke execute on function public.dashboard_stats(uuid, real) from public, anon, authenticated;
revoke execute on function public.community_datasets(uuid, text, text, uuid, int, int)
    from public, anon, authenticated;

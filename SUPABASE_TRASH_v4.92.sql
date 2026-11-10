-- Run once in Supabase SQL editor before deploying v4.92.
create table if not exists public.ost_trash_songs (
  video_id text primary key,
  trashed_at timestamptz not null default now()
);
grant select, insert, update, delete on table public.ost_trash_songs to service_role;

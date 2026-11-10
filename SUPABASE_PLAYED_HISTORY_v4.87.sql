-- Supabase SQL Editor에서 1회 실행 (서버 service_role 전용)
CREATE TABLE IF NOT EXISTS public.ost_played_songs (
 video_id text PRIMARY KEY CHECK (video_id ~ '^[A-Za-z0-9_-]{11}$'),
 played_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ost_played_songs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ost_played_songs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ost_played_songs TO service_role;
NOTIFY pgrst, 'reload schema';

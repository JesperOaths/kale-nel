-- Public guest fallback for Tune Rush when Supabase Edge quota is exhausted.
-- All mutations are validated atomically in the existing server-side game function.
-- Auth is 256-bit room/player bearer capability represented as a SHA-256 digest.
-- Nothing in the musicquiz private schema is exposed to anon or authenticated.
begin;
alter function public.musicquiz_v1(text,text,text,jsonb)
  security definer;
alter function public.musicquiz_v1(text,text,text,jsonb)
  set search_path=pg_catalog,musicquiz;
revoke all on function public.musicquiz_v1(text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.musicquiz_v1(text,text,text,jsonb) to anon,service_role;
commit;

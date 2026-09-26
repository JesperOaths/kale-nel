-- v865: close raw Data API disclosure surfaces while preserving guarded RPC access.
-- Applied live on 2026-09-26.
begin;

alter table public.ballroom_safe_requests enable row level security;
alter table public.ballroom_safe_request_history enable row level security;
alter table public.drink_event_verifications enable row level security;
alter table public.drink_speed_verifications enable row level security;
alter table public.site_poll_votes enable row level security;
alter table public.gejast_weekly_votes enable row level security;

revoke all privileges on table public.ballroom_safe_requests from anon, authenticated;
revoke all privileges on table public.ballroom_safe_request_history from anon, authenticated;
revoke all privileges on table public.drink_event_verifications from anon, authenticated;
revoke all privileges on table public.drink_speed_verifications from anon, authenticated;
revoke all privileges on table public.site_poll_votes from anon, authenticated;
revoke all privileges on table public.gejast_weekly_votes from anon, authenticated;

commit;

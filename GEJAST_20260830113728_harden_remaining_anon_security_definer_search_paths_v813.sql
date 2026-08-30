-- Production migration provenance backfill.
-- Already applied in Supabase as 20260830113728 / harden_remaining_anon_security_definer_search_paths_v813.
-- Recorded body below is copied from supabase_migrations.schema_migrations; do not rerun solely to reconcile repository history.
-- Scope: 34 existing anonymous-executable SECURITY DEFINER functions receive a fixed search_path only.

alter function public.ballroom_abdicate_safe(text,text) set search_path = public;
alter function public.ballroom_resolve_request_safe(text,text,bigint,boolean) set search_path = public;
alter function public.create_combined_drink_speed_attempt(text,text,numeric,numeric,double precision,double precision,double precision) set search_path = public;
alter function public.create_combined_drink_speed_attempt(text,text,text,numeric,numeric,double precision,double precision,double precision) set search_path = public;
alter function public.create_drink_event_v382(text,text,numeric,double precision,double precision,double precision) set search_path = public;
alter function public.create_drink_speed_attempt(text,text,text,numeric,numeric,double precision,double precision,double precision) set search_path = public;
alter function public.create_drink_speed_attempt_v382(text,text,text,numeric,numeric,double precision,double precision,double precision) set search_path = public;
alter function public.draw_next_paardenrace_card_safe(text,text,text) set search_path = public;
alter function public.draw_paardenrace_card_safe(text,text,text,text) set search_path = public;
alter function public.draw_paardenrace_card_safe(text,text,text) set search_path = public;
alter function public.get_ballroom_public_state(text,text) set search_path = public;
alter function public.get_drink_speed_page_public(text,double precision,double precision) set search_path = public;
alter function public.get_drinks_workflow_public(text,double precision,double precision,integer) set search_path = public;
alter function public.get_my_pending_drink_requests_public(text) set search_path = public;
alter function public.get_paardenrace_pending_drink_verifications_safe(text,text,text) set search_path = public;
alter function public.get_paardenrace_stats_public(text,text) set search_path = public;
alter function public.get_verified_drinks_history_public(integer) set search_path = public;
alter function public.join_paardenrace_room_safe(text,text,text) set search_path = public;
alter function public.klaverjas_clear_active_match_presence_scoped(text,bigint) set search_path = public;
alter function public.klaverjas_get_fun_ladders_public(text) set search_path = public;
alter function public.klaverjas_get_live_match_public(bigint) set search_path = public;
alter function public.klaverjas_get_player_stats_public(text,text) set search_path = public;
alter function public.klaverjas_get_quick_stats_public(bigint,integer) set search_path = public;
alter function public.klaverjas_set_active_match_presence_scoped(text,bigint,text,text,text) set search_path = public;
alter function public.reset_paardenrace_room_safe(text,text,text) set search_path = public;
alter function public.reshuffle_paardenrace_draw_pile_safe(text,text,text,text) set search_path = public;
alter function public.save_paardenrace_choice_safe(text,text,text,text,integer,bigint) set search_path = public;
alter function public.save_paardenrace_choice_safe(text,text,text,text,integer) set search_path = public;
alter function public.submit_paardenrace_nominations_safe(text,jsonb,text,text,text) set search_path = public;
alter function public.submit_paardenrace_nominations_safe(text,text,text,jsonb) set search_path = public;
alter function public.tick_paardenrace_room_safe(text,text,text,text) set search_path = public;
alter function public.verify_drink_event(text,bigint,numeric,numeric,numeric,boolean,text) set search_path = public;
alter function public.verify_drink_speed_attempt(text,bigint,numeric,numeric,numeric,boolean,text) set search_path = public;
alter function public.verify_paardenrace_obligation_safe(text,text,text,bigint) set search_path = public;

-- Production migration provenance backfill.
-- Already applied in Supabase as 20260825203001 / harden_admin_drinks_security_definer_search_path_20260825.
-- Recorded body below is copied from supabase_migrations.schema_migrations; do not rerun solely to reconcile repository history.

alter function public.admin_batch_update_drink_event_entries(text,bigint[],text) set search_path = public;
alter function public.admin_batch_update_drink_speed_attempt_entries(text,bigint[],text) set search_path = public;
alter function public.admin_delete_drink_event_entry(text,bigint) set search_path = public;
alter function public.admin_delete_drink_speed_attempt_entry(text,bigint) set search_path = public;
alter function public.admin_get_web_push_runtime_diagnostics(text,text) set search_path = public;
alter function public.admin_revoke_player_access(text,bigint,text) set search_path = public;
alter function public.admin_undo_drinks_action(text,bigint) set search_path = public;
alter function public.admin_update_drink_event_entry(text,bigint,text,numeric,text) set search_path = public;
alter function public.admin_update_drink_speed_attempt_entry(text,bigint,text,numeric,text) set search_path = public;
alter function public.get_drinks_admin_console(text) set search_path = public;

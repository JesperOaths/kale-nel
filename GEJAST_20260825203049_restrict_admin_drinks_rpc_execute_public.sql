-- Production migration provenance backfill.
-- Already applied in Supabase as 20260825203049 / restrict_admin_drinks_rpc_execute_public_20260825.
-- Recorded body below is copied from supabase_migrations.schema_migrations; do not rerun solely to reconcile repository history.

revoke execute on function public.admin_batch_update_drink_event_entries(text,bigint[],text) from public;
grant execute on function public.admin_batch_update_drink_event_entries(text,bigint[],text) to anon, authenticated, service_role;
revoke execute on function public.admin_batch_update_drink_speed_attempt_entries(text,bigint[],text) from public;
grant execute on function public.admin_batch_update_drink_speed_attempt_entries(text,bigint[],text) to anon, authenticated, service_role;
revoke execute on function public.admin_delete_drink_event_entry(text,bigint) from public;
grant execute on function public.admin_delete_drink_event_entry(text,bigint) to anon, authenticated, service_role;
revoke execute on function public.admin_delete_drink_speed_attempt_entry(text,bigint) from public;
grant execute on function public.admin_delete_drink_speed_attempt_entry(text,bigint) to anon, authenticated, service_role;
revoke execute on function public.admin_get_web_push_runtime_diagnostics(text,text) from public;
grant execute on function public.admin_get_web_push_runtime_diagnostics(text,text) to anon, authenticated, service_role;
revoke execute on function public.admin_revoke_player_access(text,bigint,text) from public;
grant execute on function public.admin_revoke_player_access(text,bigint,text) to anon, authenticated, service_role;
revoke execute on function public.admin_undo_drinks_action(text,bigint) from public;
grant execute on function public.admin_undo_drinks_action(text,bigint) to anon, authenticated, service_role;
revoke execute on function public.admin_update_drink_event_entry(text,bigint,text,numeric,text) from public;
grant execute on function public.admin_update_drink_event_entry(text,bigint,text,numeric,text) to anon, authenticated, service_role;
revoke execute on function public.admin_update_drink_speed_attempt_entry(text,bigint,text,numeric,text) from public;
grant execute on function public.admin_update_drink_speed_attempt_entry(text,bigint,text,numeric,text) to anon, authenticated, service_role;
revoke execute on function public.get_drinks_admin_console(text) from public;
grant execute on function public.get_drinks_admin_console(text) to anon, authenticated, service_role;

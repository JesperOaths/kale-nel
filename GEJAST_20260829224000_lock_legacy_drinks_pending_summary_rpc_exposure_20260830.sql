-- Production migration provenance backfill.
-- Already applied in Supabase as 20260829224000 / lock_legacy_drinks_pending_summary_rpc_exposure_20260830.
-- Recorded body below is copied from supabase_migrations.schema_migrations; do not rerun solely to reconcile repository history.

revoke execute on function public.get_drinks_pending_verification_summary_v660(text,integer) from public, anon, authenticated;
revoke execute on function public.get_drinks_pending_verification_summary_v661(integer,text) from public, anon, authenticated;

grant execute on function public.get_drinks_pending_verification_summary_v660(text,integer) to service_role;
grant execute on function public.get_drinks_pending_verification_summary_v661(integer,text) to service_role;

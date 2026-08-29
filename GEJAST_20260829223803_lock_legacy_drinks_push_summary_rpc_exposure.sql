-- Production migration provenance backfill.
-- Already applied in Supabase as 20260829223803 / lock_legacy_drinks_push_summary_rpc_exposure_20260830.
-- This migration records the emergency containment of legacy no-token Web Push summary RPCs.
-- Reapplying is ACL-idempotent, but do not rerun solely to reconcile repository history.

revoke execute on function public.get_drinks_push_eligibility_summary_v660(text,integer) from public, anon, authenticated;
revoke execute on function public.get_drinks_push_eligibility_summary_v661(integer,text) from public, anon, authenticated;
revoke execute on function public.get_drinks_push_phase_summary_v660(text,integer) from public, anon, authenticated;
revoke execute on function public.get_drinks_push_phase_summary_v661(integer,text) from public, anon, authenticated;
revoke execute on function public._gejast_v660_recent_rows(text,integer) from public, anon, authenticated;

grant execute on function public.get_drinks_push_eligibility_summary_v660(text,integer) to service_role;
grant execute on function public.get_drinks_push_eligibility_summary_v661(integer,text) to service_role;
grant execute on function public.get_drinks_push_phase_summary_v660(text,integer) to service_role;
grant execute on function public.get_drinks_push_phase_summary_v661(integer,text) to service_role;
grant execute on function public._gejast_v660_recent_rows(text,integer) to service_role;

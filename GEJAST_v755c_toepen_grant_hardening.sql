-- GEJAST v755c: Toepen RPC grant hardening.
-- SQL-only forward fix after v755/v755b Toepen backend apply.
-- Removes default PUBLIC execute and keeps only intended RPC grants.

begin;

revoke all on function public.create_toepen_game(text,jsonb,text) from public;
revoke all on function public.get_toepen_app_state(text,text) from public;
revoke all on function public.get_toepen_vault_summary(text,integer,text) from public;
revoke all on function public._v755_admin_session_ok(text) from public;
revoke all on function public._v755_admin_session_ok(text) from anon, authenticated;

grant execute on function public.create_toepen_game(text,jsonb,text) to anon, authenticated;
grant execute on function public.get_toepen_app_state(text,text) to anon, authenticated;
grant execute on function public.get_toepen_vault_summary(text,integer,text) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;

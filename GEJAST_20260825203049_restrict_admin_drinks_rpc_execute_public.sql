-- Production migration provenance backfill.
-- Already applied in Supabase as 20260825203049 / restrict_admin_drinks_rpc_execute_public_20260825.
-- Do not rerun solely to reconcile repository history.

REVOKE EXECUTE ON FUNCTION public.admin_activate_release(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_allowed_emails(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_invites(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_allowed_email(text, text, boolean, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_invite_email(text, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_player_banned(text, bigint, boolean, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_release_channel(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_reuse_expected_domain(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_reuse_expected_origin(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_upsert_release(text, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_upsert_release_manifest(text, text, text, text, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_revoke_player_access(text, bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_resolve_player_access(text, bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_create_player(text, text, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_create_drink(text, text, numeric, numeric, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_update_drink(text, bigint, text, numeric, numeric, integer, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_delete_drink(text, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_settings_list_drinks(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_ingame_drinks_v1() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_reset_game_stats4035(text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_activate_release(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_allowed_emails(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_invites(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_allowed_email(text, text, boolean, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_invite_email(text, text, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_player_banned(text, bigint, boolean, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_release_channel(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_reuse_expected_domain(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_reuse_expected_origin(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_release(text, text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_release_manifest(text, text, text, text, text, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_revoke_player_access(text, bigint, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_resolve_player_access(text, bigint, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_player(text, text, text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_drink(text, text, numeric, numeric, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_drink(text, bigint, text, numeric, numeric, integer, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_drink(text, bigint) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_settings_list_drinks(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_ingame_drinks_v1() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reset_game_stats4035(text, text) TO anon, authenticated, service_role;

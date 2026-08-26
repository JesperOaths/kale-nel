-- Production migration provenance backfill.
-- Already applied in Supabase as 20260825203001 / harden_admin_drinks_security_definer_search_path_20260825.
-- Do not rerun solely to reconcile repository history.

ALTER FUNCTION public.admin_activate_release(text, text)
SET search_path = public;

ALTER FUNCTION public.admin_list_allowed_emails(text)
SET search_path = public;

ALTER FUNCTION public.admin_list_invites(text)
SET search_path = public;

ALTER FUNCTION public.admin_set_allowed_email(text, text, boolean, text)
SET search_path = public;

ALTER FUNCTION public.admin_set_invite_email(text, text, boolean)
SET search_path = public;

ALTER FUNCTION public.admin_set_player_banned(text, bigint, boolean, text)
SET search_path = public;

ALTER FUNCTION public.admin_set_release_channel(text, text, text)
SET search_path = public;

ALTER FUNCTION public.admin_set_reuse_expected_domain(text, text, text)
SET search_path = public;

ALTER FUNCTION public.admin_set_reuse_expected_origin(text, text, text)
SET search_path = public;

ALTER FUNCTION public.admin_upsert_release(text, text, text, text, text)
SET search_path = public;

ALTER FUNCTION public.admin_upsert_release_manifest(text, text, text, text, text, boolean)
SET search_path = public;

ALTER FUNCTION public.admin_revoke_player_access(text, bigint, text)
SET search_path = public;

ALTER FUNCTION public.admin_resolve_player_access(text, bigint, text)
SET search_path = public;

ALTER FUNCTION public.admin_create_player(text, text, text, text, text, text)
SET search_path = public;

ALTER FUNCTION public.admin_create_drink(text, text, numeric, numeric, integer)
SET search_path = public;

ALTER FUNCTION public.admin_update_drink(text, bigint, text, numeric, numeric, integer, boolean)
SET search_path = public;

ALTER FUNCTION public.admin_delete_drink(text, bigint)
SET search_path = public;

ALTER FUNCTION public.admin_settings_list_drinks(text)
SET search_path = public;

ALTER FUNCTION public.get_ingame_drinks_v1()
SET search_path = public;

ALTER FUNCTION public.admin_reset_game_stats4035(text, text)
SET search_path = public;

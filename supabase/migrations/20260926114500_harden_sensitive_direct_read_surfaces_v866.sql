begin;

-- v866: close residual direct browser reads on internal/sensitive tables.
-- Public game/stat surfaces remain unchanged; browser access continues through
-- existing SECURITY DEFINER RPCs where intended. service_role retains access.

revoke select on table
  public.gejast_account_names_v671,
  public.gejast_account_players_v671,
  public.gejast_active_player_metadata_policy_v679,
  public.gejast_active_player_metadata_v679,
  public.gejast_login_player_map_v681,
  public.gejast_profile_settings,
  public.gejast_scope_memberships_v672,
  public.gejast_scope_runtime_events_v672,
  public.web_push_active_presence,
  public.web_push_jobs,
  public.web_push_subscriptions,
  public.shop_printify_product_backups
from anon, authenticated;

commit;

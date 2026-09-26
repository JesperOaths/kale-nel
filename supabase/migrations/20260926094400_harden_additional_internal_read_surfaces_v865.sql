begin;

-- Close direct browser-role discovery/read access to internal working,
-- identity-audit and ops-observability state. Their supported application
-- paths are SECURITY DEFINER RPCs, so callers do not need raw table SELECT.
revoke select on table
  public._scratch_pikken_ladder_work,
  public._scratch_pikken_match_participants,
  public.account_identity_events,
  public.gejast_ops_release_breadcrumbs,
  public.gejast_ops_runtime_events,
  public.gejast_ops_smoke_checks
from anon, authenticated;

commit;

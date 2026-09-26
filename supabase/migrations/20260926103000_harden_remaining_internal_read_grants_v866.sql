begin;

-- v866 disclosure hardening: these relations are internal-only. Both already
-- have RLS enabled with no browser policies; remove stale table-level SELECT
-- grants as defense in depth and keep access through privileged service/RPC
-- paths only.
revoke select on table
  public.despimarkt_audit_log_v669,
  public.shop_internal_job_tokens
from anon, authenticated;

commit;

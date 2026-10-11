# Step 3 — Database permissions and secrets (2026-10-11)

## Production changes and validation

- All 242 public tables have RLS enabled. Tables with no RLS policy generally deny anon/authenticated rather than expose records.
- Fixed missing explicit `search_path` on 10 `SECURITY DEFINER` functions and 284 invoker functions. Preserved `pg_catalog`, `public`, `extensions` and placed `pg_temp` last.
- Revoked `EXECUTE` for `anon`, `authenticated` and `PUBLIC` on four unnecessary privileged RPCs: `_badge_verified_drink_rows(text)`, `_badge_verified_speed_rows(text)`, `paardenrace_cleanup_idle_lobbies_v621()` and `despimarkt_run_background_maintenance()`. Kept internal owner and `service_role` access.
- Stored pre-change ACL/config for 14 routines in `security_audit.function_hardening_20261011`, and 284 invoker function settings in `security_audit.invoker_search_path_backup_20261011`. Both are private.
- Added restricted `security_audit.posture_v1` as an inventory for future drift detection. No secret values are exposed.
- Supabase advisor after change: search-path warnings 294 → 0; anonymous privileged `SECURITY DEFINER` warnings 775 → 771.
- Tested `get_badge_registry_public`, `get_drinks_homepage_public` and `get_all_site_players_public` as `anon`; responses remained valid JSON objects.
- Confirmed anonymous read access is absent on identified credential/token/password columns in public tables. The private Vault schema and its secrets table are not accessible to `anon`. Three Vault secret records were counted **without reading values**.
- Examined probable token patterns in GitHub public sources; the reviewed matches did not contain confirmed full usable raw credentials. This is not an exhaustive Git history scan.

## Decisions and remaining work

The **771** remaining anonymous-callable `SECURITY DEFINER` functions are not automatically exploitable. Many are required public read endpoints or carry application-specific session tokens. Review their authorization logic, especially historical admin and account APIs, before revoking access. Do not blanket-revoke and break site features.

No existing Printify, bunq, SSH, C720P or Supabase key was rotated, because there is no confirmed leak of its raw value from the reviewed sources and an uncoordinated change could disrupt payments, camera recording or remote maintenance. For any verified compromised key, replace both ends and validate before revoking the old key. Previously exposed hardcoded rescue endpoints were retired in Step 2.

Do not interpret successful database checks as a full security certification. The Security media endpoints and local device network still require their separate hardening phases.

## Reversible operations

Use the private backup tables to inspect prior function ACLs and search-path settings for rollback. Do not grant `EXECUTE` back to anonymous users by default; restore only a proven legitimate API need. Function OIDs and signatures may change after replacing functions; check the current catalog before restoring.

## Quick live audit

```sql
select * from security_audit.posture_v1;
```

The SQL source in `supabase/migrations/20261011195000_step3_rpc_privilege_and_search_path_hardening.sql` mirrors the applied changes without secrets and can be applied idempotently.

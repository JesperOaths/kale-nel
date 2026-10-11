# C720P secured outbound maintenance gateway — 2026-10-11

## Architecture
The C720P agent initiates outbound requests to the existing authenticated `c720p-agent` endpoint. It is **not** necessary to open the SSH server to the public internet. The host firewall already limits SSH (22) and Home Assistant (8123) to local ranges (verify runtime router and IPv6 settings independently).

The authoritative privileged submission API is the **private PostgreSQL function** `c720p_agent.submit_management_job_v1`. It requires PostgreSQL's management user, validates operation type, actor, command size, timeout and idempotency, and writes an audit entry without copying the command into the audit table. No `anon`, `authenticated` or `service_role` access is granted to that function. The private schema is not exposed through PostgREST.

The `C720P secure maintenance` GitHub Action uses its existing `SUPABASE_DB_URL` secret to call this function and exposes only a finite allowlist of diagnostics. An automation may reuse it through `workflow_call`. General maintenance, deployment, SSH and ADB tasks remain available to authorized operators via a trusted Supabase database management connection, rather than an anonymously callable Edge Function.

## Deployment safety
- Do not disable or rotate the `c720p-agent` outbound polling credential while migrating command submitters.
- Replace and retire old one-shot endpoints before considering public route shutdown complete.
- Keep database migration history, Edge rollback snapshots, and the current C720P rollback files.
- Never write an API key, session cookie, SSH private key or command output containing secrets into public GitHub.
- Changes to firewall/SSH/ADB policy must preserve authorized remote access and be tested from the management path first.

## Validation
1. Check that management SQL has permission to execute the private function, and that `anon`, `authenticated` and `service_role` do not.
2. Submit a harmless diagnostic and wait for the existing agent to complete it.
3. Check `c720p_agent.command_gateway_audit_v1` contains the job ID.
4. Verify unauthenticated calls to retired one-shot functions return a denial.
5. Confirm the agent's systemd service, watchdog, security tunnel and ADB device connections are healthy.

### Future hardening
Audit and retire all obsolete endpoints in batches, verify router forwarding and exposed ancillary ports, and isolate SSH/ADB access to authorized administrators.

# Authorized administrative access: continuity runbook

**Operator requirement:** Preserve at least one **verified, authorized administrative route** for every managed device, website, connected service, and project. Prefer two viable access routes wherever possible. Never retire the final working route to improve security. Apply security changes with rollback and proof of continued operation.

**Working preference:** Be autonomous, proactive, thorough and decisive in normal operations. Discover and try permitted connected tools before asking the owner to intervene; contact them only when access or a consequential decision cannot be resolved through authorized means. This preference never overrides actual permission boundaries or safety controls.

## Verified management architecture (11 October 2026)

- **Primary device administration:** connected Supabase **management** tools -> private, audited database job-submission gateway -> existing **outbound** C720P maintenance agent -> local services or authorized ADB to connected Android phones. A harmless end-to-end job and ADB shell information query on all three phones completed successfully.
- **Second cloud operator entry point:** GitHub Actions' `.github/workflows/c720p-secure-maintenance.yml` can enqueue **allowlisted** diagnostics using its configured private database connection. A real Actions run succeeded, and the C720P executed the resulting job. This is an independent *submission interface*, **not** an independent backend: it still depends on Supabase and the C720P agent.
- **Local management alternative:** the operator's authorized local SSH setup can address C720P with their configured `c720p` alias. The SSH daemon was observed listening and its configuration allows key-based access; an actual SSH login from the current ChatGPT chat has **not** been established. Do not claim otherwise.
- **Downstream authorized devices:** Samsung S9+ camera, S3 bedroom motion sensor, and S5 IR remote all successfully answered a harmless ADB-shell query through the C720P agent. Home Assistant's local HTTP interface also returned 200. Camera services, tunnel, and video-relay components were active.
- **Website control:** code and deployment work through connected GitHub and Supabase management tools, as appropriate to the target. The main site, shop and League subsite returned HTTP 200 during the check. An HTTP 200 is availability evidence, not proof that every feature is functional.
- **Other project integrations:** discover and verify the actual available and authorized provider tools at task time. Connected-tool support may include Google Drive, Shopify, Stripe, Canva and more, but the presence of a tool alone does not prove login or permission to a particular resource.

## Private operations inventory

Detailed, non-secret gateway metadata and verification notes are kept in a **private** Supabase record:
`c720p_agent.operator_access_continuity_v1` / `access_id='primary'` in the managed Supabase project.

Retrieve that record only through an authorized Supabase management database connection. Anonymous, regular authenticated and service-role database access are explicitly revoked. Do not expose the full private runbook in public API responses.

## Mandatory pre-change and recovery procedure

1. Inventory the exact target and its dependency chain. Check the current permitted tool list **before saying an action is unavailable**. Prefer existing, tested paths to inventing a new public endpoint.
2. Confirm an authorized execution route is currently working. For device changes, verify the C720P agent end-to-end and the relevant ADB device(s); for website changes verify GitHub/Supabase and a relevant smoke test.
3. Record and safeguard a rollback plan and source/config backup; never write raw access tokens, passwords, secret values, SSH keys, camera media, or public one-shot job payloads to this repository.
4. For changes affecting an agent, route, firewall, SSH, ADB, secrets, Home Assistant, camera, GitHub workflow, or Supabase: stage first; keep the current connection and a tested fallback alive; apply one guarded change; verify before retiring the previous path.
5. If a direct SSH terminal is not exposed by the current ChatGPT tooling, distinguish that from the *working managed C720P agent*. Do not say **"I cannot control your devices"** until the authorized Supabase/GitHub management pathway has been inspected and tested.
6. Be precise: a workflow file's presence is not a successful Actions run, a listening SSH port is not a successful SSH login, and a public website HTTP response does not verify backend operations.
7. If the route is unavailable, inspect the private runbook, check agent heartbeat and job states through authorized SQL, consider the allowlisted GitHub Actions interface and the local authorized SSH fallback, and recover without creating anonymous remote-command endpoints.
8. Maintain and update this runbook after topology or credential rotations; preserve at least one actual tested working path.

## Last verification

- 2026-10-11: private Supabase management job **10230** completed with exit code 0. C720P agent and camera tunnel active; ADB-shell probe successful for all three Android models; local Home Assistant returned HTTP 200; main site, shop and League pages returned HTTP 200.
- 2026-10-11: connected GitHub maintenance workflow remains manually dispatchable and reusable; prior GitHub Actions run **38160493700** and resulting C720P job **10196** completed successfully.
- This document is **operational context, not a security bypass**. Permissions and connections must be verified again before use.

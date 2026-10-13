# Authorized administrative access: continuity runbook

**Operator requirement:** Preserve at least one **verified, authorized administrative route** for every managed device, website, connected service, and project. Prefer two viable access routes wherever possible. Never retire the final working route to improve security. Apply security changes with rollback and proof of continued operation.

**Working preference:** Be autonomous, proactive, thorough and decisive in normal operations. Discover and try permitted connected tools before asking the owner to intervene; contact them only when access or a consequential decision cannot be resolved through authorized means. This preference never overrides actual permission boundaries or safety controls.

## Verified management architecture (11 October 2026)

- **Primary device administration:** connected Supabase **management** tools -> private, audited database job-submission gateway -> existing **outbound** C720P maintenance agent -> local services or authorized ADB to connected Android phones. A harmless end-to-end job and ADB shell information query on all three phones completed successfully.
- **Second cloud operator entry point:** GitHub Actions' `.github/workflows/c720p-secure-maintenance.yml` can enqueue **allowlisted** diagnostics using its configured private database connection. A real Actions run succeeded, and the C720P executed the resulting job. This is an independent *submission interface*, **not** an independent backend: it still depends on Supabase and the C720P agent.
- **Local management alternative:** the operator's authorized local SSH setup addresses C720P with the configured `c720p` alias. Actual key-based SSH login from the Windows operator environment was verified on 14 October 2026. No public SSH exposure or key change was needed.
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

- 2026-10-14, recovery completed: the owner's USB connection enumerated as exact S9+ serial `27bb603837047ece` / model `SM-G965F`. The existing `recover-authorized-s9-adb-from-usb-v1.py` restored direct `192.168.178.250:5555` access and the localhost camera relay. The native-camera bridge timer remains enabled; SSH and `c720p-agent-runner.service` remain verified independent hub entry points. Keep the direct USB recovery option available; a cold-reboot persistence test has not been performed.
- The signed person-evidence V31 package from source commit `4b081f75e46dc3570f50c51a88b3f9d2fbfd7a2e` is installed and live. 4K capture, GPU multiscale scans and all four native control options passed live checks. Real archived recordings are now being enriched on the phone, with original MP4 digests and prior sidecars preserved. See `s9-native-security/PERSON_EVIDENCE_V31.md` for release and rollback details.
- **Conflicting old installer disabled:** `c720p-s9-joined-preroll-safe-upgrade.timer` attempted an older APK cutover after access returned, then failed because its service-launch command targets a non-exported component. It interrupted the camera and would conflict with V31. Its timer is now disabled; the camera was restored via exported `CameraActivity`. Do not re-enable it unchanged or install its older package over V31. Its files and rollback artifacts remain available. Existing pre-event capture and complete-recording playback routes remain present.
- The Home Assistant Security iframe now uses `?v=person-folders-v31-20261014`. The prior 7 October URL could retain an old empty-controls page for 31 days under Home Assistant static caching. Its private dashboard backup is `/config/.storage/lovelace.c720p_hub.before-security-entry-v31-20261013T234511Z`; only that iframe URL changed and HA health was verified after restart.

- 2026-10-14 (Amsterdam), after the owner reported an S9+ restart: the preserved private management gateway remains functional. Diagnostic job **10672** (`adb devices -l`) completed with exit code 0 and showed the S3/S5, with no S9+ transport. The C720P outbound agent is active and the authorized `c720p` SSH alias works.
- The exact saved S9+ network identity remains at `192.168.178.250` (model `SM-G965F`, serial `27bb603837047ece`, saved MAC `82:a7:90:2b:95:b4`), but direct ADB TCP 5555 is refused from both C720P and the Windows operator PC. Saved configuration, IPv6 neighbor records and mDNS provided no alternative verified S9+ endpoint. Neither computer reported an S9+ USB ADB transport. The installed Windows Phone Link app exposed no usable connection window.
- **Access chain to remember:** privileged Supabase management connector -> private audited job gateway -> existing outbound C720P agent -> a phone's authorized direct ADB transport. SSH is an independent entry to the hub; the allowlisted GitHub maintenance workflow is another caller of the same database/agent path. None of these is a separate administrator service running on an unreachable phone.
- Do not infer reboot-persistent S9+ access from an earlier successful ADB probe. The saved watchdog describes best-effort `persist.adb.tcp.port` writes and a recovery fallback; no successful S9+ cold-reboot persistence test was documented. The missing post-restart phone transport must be distinguished from a failed hub management route. Current activation is to use a direct S9+ connection; no S3 relay was started.

- 2026-10-11: private Supabase management job **10230** completed with exit code 0. C720P agent and camera tunnel active; ADB-shell probe successful for all three Android models; local Home Assistant returned HTTP 200; main site, shop and League pages returned HTTP 200.
- 2026-10-11: connected GitHub maintenance workflow remains manually dispatchable and reusable; prior GitHub Actions run **38160493700** and resulting C720P job **10196** completed successfully.
- This document is **operational context, not a security bypass**. Permissions and connections must be verified again before use.

# Authorized administrative access: continuity runbook

## Current People & faces workflow — 16 October 2026, V40a

The People page now uses `people-folders-v40.html/js`, served through the
existing People aliases and Archive review entry. UI cache is
`manual-folders-v40a-20261016`. It has one recording per card, explicit green
Approve/red Reject controls, persistent clip folders, rejected/approved tabs
and reversible decisions. Folder suggestions use clothing HSV histograms only;
there is no automatic biometric same-person grouping or identity training.
The first folder/example is seeded by the owner's explicit approval.

Approvals/rejections are keyed to original recording name and SHA-256, with
pinned review snapshots; detector/track changes do not silently change them.
Schema changes are additive. Do not overwrite the current review database
when rolling back UI/source after the owner starts reviewing.

Previous Security assets, consistent SQLite state and catalog are preserved
under `backups/s9-folder-review-v40/20261016T192043Z/`, with subsequent change
manifests beneath it. Receipts are
`state/s9-visual-attributes-v36/folder-review-v40-{release,verification}.json`.
See `s9-native-security/FOLDER_REVIEW_V40.md` for recovery and packaging.
Fifty-one catalog/workflow tests, four playback lifecycle tests and twenty
live acceptance checks passed. Production folders/actions remained zero at
acceptance; browser approval tests used an isolated synthetic database.

The regenerated local archive entry point omitted its old review registration.
Routes now mount from the existing `s9_hub_playback.install` initializer,
preserving auth mode. Registration is idempotent and refuses downgrade. Both
8794 and 8795 answer the folder API. Preserve that hook during maintenance.
The unrelated independently restored Tracks page was preserved as found.

Phone APK/recording remain V39 (details below): direct SSH/ADB routes, native
4K capture, original recordings and Archive verifications are unchanged.

## Current S9+ security checkpoint — 16 October 2026

Direct `ssh c720p` and direct ADB `192.168.178.250:5555` remain the working
routes. The maintenance agent and Home Assistant remain independent of the
phone app. No S3 relay or credential change was needed.

Installed phone APK: **V39**, SHA-256
`c8bddd3812964ce161cf5027d766303752bf0f45ba1aaf2c457ff2a3d9f75228`.
Live detector policy is `person_multicandidate_transport_v38`, review sampling
is `native_4k_dense_small_people_v39`, and the UI cache is
`detection-review-v39b-20261016`. Use the pinned-source
`prepare-detection-phone-v39.py`; older V37/V38 preparation entry points now
refuse current sources. Do not deploy the branch's historical recorder classes.

All nine currently owner-verified Person / People clips finished native 4K
reprocessing on the S9+: 287 frames, 39 temporally supported candidate views
and 39 weak views. These are **candidates, not confirmed people or identities**.
The inbox includes weak views. Cross-recording colour/scene sets are temporary
manual comparison aids; no biometric matching or automatic folder assignment
was added. Existing production manual state remained zero folders/actions.

Sixteen final live checks passed. Native recording remained approximately
30 fps, with zero dropped output frames and zero review errors. Originals
retained their hashes. Full details, backup paths, source reproduction and
verification commands are in `s9-native-security/DETECTION_REVIEW_V39.md`.
Durable receipts are `build/s9-detection-review-v39/{release,deployment}.json`
and `state/s9-visual-attributes-v36/detection-{hub-v39-release,pipeline-v39-verification}.json`.
The exact APK is also retained in the operator workspace because it was built
in RAM scratch to protect the hub's limited root storage.

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

- **Current native temporal review V37, 15 October 2026:** the signed on-device S9+ update is installed with SHA-256 `d0582c3a1aa0103617c7ddea3db4ce182bf025f273c2da6266c9771faf2a6f05`, retaining the pinned v11 recorder and assets. All 9 currently human-verified S9+ recordings completed native 4K review: 163 frames, 41 follow-up requests, 17 temporally supported candidate views and 10 weak views. The expiring owner-verification queue confines the new worker to approved recordings; weak detections remain recoverable. People & faces now has manual folder home/inbox, Tracks has per-recording movement timelines, and Evidence separates human verification from detector analysis. Thirty-three Python tests, JVM and physical-phone suites, exact 25-source reproduction and fourteen final live checks passed. Camera: watching at 30.01 fps / 35.8°C, zero dropped encoder frames / visual-review errors. No originals, human labels or production folder assignments changed. HA cache `temporal-review-v37a-20261015`. Exact release/rollback receipts and limitations are in [TEMPORAL_REVIEW_V37.md](s9-native-security/TEMPORAL_REVIEW_V37.md). Direct ADB, SSH and the outbound agent remain preserved.

- **Verified-crop correction V36c, 15 October 2026:** the review catalog and crop endpoint now enforce current human Archive Person / People decisions, including file revision and size. False model candidates are labelled Needs crop review; crop confirmation/rejection is recoverable and folder assignment requires confirmation. Final live check: 28 candidate crops from 9 verified S9+ recordings, instead of 182 unrestricted crops; 91 recordings indexed. The status adapter now accepts the installed v9 detector; the camera remained watching at 30.02 fps / 34.7°C. Twenty-eight review tests, eight status tests, synthetic browser actions and live private/API checks passed. No phone package or human verification labels changed. HA cache `verified-crops-v36c-20261015`. See [VERIFIED_CROPS_V36C.md](s9-native-security/VERIFIED_CROPS_V36C.md) for exact rollback and limitations.

- **Current original-4K visual review V36, 14 October 2026:** non-biometric colour/scene attributes, clip-local duplicate suppression, timestamped native crops and manual review folders are deployed on the S9+/hub. Installed signed APK SHA-256 `5548aece5864cfb9bae96211aa4d15375e59892f822b186ce20cd0c223c74bb0` preserves exact unified-v11 recorder helpers, encoded timestamp timing, garden v9 gate, pre-event target and 10-second tail. The recorded release checkpoint is 29 original 4K clips / 417 native frames / 73 anonymous tracklets / 146 crops, decoded on the actual S9+ using `OMX.Exynos.avc.dec`, with zero visual processing errors. Capture was watching at 30.02 fps / 34.2°C with zero dropped encoder frames. Seventeen Python regressions, Java tests including eight count checks on the physical phone, synthetic UI review persistence and live private-crop/auth/original-range checks passed. Manual state is separate transactional SQLite; old source/state and labels are retained. The current workbench does not perform embedding extraction or automatic cross-recording identity assignment. The incremental queue yields to movement/capture/heat. HA cache: `visual-review-v36b-20261014`; direct S9+ ADB, SSH and the outbound agent remain working. Exact source/build/rollback paths and limitations are in [VISUAL_REVIEW_V36.md](s9-native-security/VISUAL_REVIEW_V36.md). Do not install this branch's historical Android camera sources directly over the pinned v11-based release.

- **Historical verified-person grouping V35, 14 October 2026:** the owner-approved frozen 41 clips have been reprocessed with a second body model, 170 additional native body views and 935 native observed-head scans. All 108 sightings remain available: 89 occupy 26 candidate person folders, with 19 unmatched sightings separated from person counts. Sixteen folders span recordings; 21 assignments remain tentative. The registry has 45 collections including the unmatched singles, not 45 proven people. Presence labels no longer supply identity training examples; co-occurrence requires a shared observed frame. Named/confirmed folders and manual corrections retain stable labels and are protected. Each recording appears once inside a folder, with individual views and match controls inside it. There are 43 face crops, 15 comparable templates across 10 tracks, 93 posture measurements and no reliable gait cadence. All original-view/head-review work items finished without errors; 120 tests, numerical parity, synthetic UI and live private-image/range/authentication checks passed. Seven application sources match the private persistent release manifest. HA cache: `ensemble-people-v35-20261014`; the camera remained watching at 35.3°C. Source/data backup, registry rollback and the HA backup are recorded in [ENSEMBLE_PEOPLE_V35.md](s9-native-security/ENSEMBLE_PEOPLE_V35.md). V35 is hub-only: preserve newer independent phone packages and all established SSH/agent/direct-ADB routes. The legacy unfiltered matcher remains locked.

- **Historical V34 grouping, superseded by V35 above:** following the owner's request to group individual sightings by person, V34 is deployed on the same frozen 41 approved clips. All 108 sightings now occupy 33 candidate folders (previously 64); 14 folders span multiple recordings. The learned profile-fitting objective uses observed same-person view variation, available face/body/clothing/proportion evidence and hard separation constraints. Fifty-two appearances carry tentative identity labels; do not present these folders as proven distinct people. Named/confirmed folders and manual splits are protected. Eighty-eight tests and live private-image/original-range/authentication checks passed; the camera was watching at 36.1°C and HA was healthy. Current Security cache: `best-fit-people-v34-20261014`. Source and exact rollback receipts are documented in [BEST_FIT_PEOPLE_V34.md](s9-native-security/BEST_FIT_PEOPLE_V34.md). No new footage, human labels, phone package, timer or access route was changed.

- **Completed owner-approved verified-person phase, 14 October 2026:** the owner said **“yes, done”**, approving the frozen set of 41 positively human-verified Drive clips. V33 People & faces is deployed with actual person/face crops, clip playback at appearances and rename/confirm/combine/separate controls. Main, final motion and original-resolution face passes each completed 41/41 with zero errors; the last finished at 10:37:28 UTC. Results: 108 appearance tracks, 64 provisional groups (not established identities), 42 face crops, 93 posture measurements and no reliable gait cadence. Two groups span multiple recordings through appearance support; one verified recording remains in the clearer-view list. Sixty-two isolated tests and final private-image/original-range/authentication checks passed; all 15 deployed files matched final source and the camera was watching at 36.3°C. Only current positive references from the frozen snapshot may be used; additional verified clips are not implicitly approved. Raw descriptors and motion sequences stay private on the hub. The legacy unfiltered matcher stays locked. Current Security cache entry: `verified-people-v33d-20261014`. See [VERIFIED_PEOPLE_V33.md](s9-native-security/VERIFIED_PEOPLE_V33.md) for safeguards, completed jobs and rollback. Do not restore a historical APK: this phase did not change the phone package.

- **Historical V32 review phase, before the owner released the gate on 14 October 2026:** Archive verification V32 deployed per-recording Person/People buttons, multi-selection and guarded bulk actions. People & faces was paused in `awaiting_owner_done`; ordinary “continue” messages did not release that gate. Initial checks found 374 microSD and 173 Drive recordings with zero human verifications. V33 above supersedes that paused page after the explicit **“yes, done”** signal; the old unfiltered matching API stays locked. Previous model/thumbnail labels are not human verification. See [ARCHIVE_REVIEW_V32.md](s9-native-security/ARCHIVE_REVIEW_V32.md) for those components and private rollback paths.
- **Current phone package precedence:** the latest read-only check during V32 deployment found installed APK SHA256 `881069d0c91616761a5e8cd4e321738e469cf1bd5e64432c1c7a6578db24e4c4`, watching at 36.7°C, with no `person_evidence_version` field. Phone updates have occurred independently since the historical V31 checks below. This archive task did not install or alter the phone package. Do not restore the older V31 APK based on those historical entries. Preserve current authorized direct ADB/USB access and inspect the actual latest release before any future phone change.

- 2026-10-14, recovery completed: the owner's USB connection enumerated as exact S9+ serial `27bb603837047ece` / model `SM-G965F`. The existing `recover-authorized-s9-adb-from-usb-v1.py` restored direct `192.168.178.250:5555` access and the localhost camera relay. After another unplanned phone reboot, the same direct recovery route was used and capture resumed through exported `CameraActivity`. The native-camera bridge timer remains enabled; SSH and `c720p-agent-runner.service` remain verified independent hub entry points. Keep the direct USB recovery option available; unattended cold-reboot recovery has not been proven.
- The signed combined person-evidence V31 package from source commit `99a124a67720106448bfe14fd88a52f149723ebb` is installed and live. The exact installed APK SHA-256 `70e628b536d4ab17bc4abbb510a6d32e81430b1c72660ba8ff6be0a864fe4e0a` was verified after the reboot. It retains the V1c native libraries/support dex and includes V31 review/recovery and guarded pre-event assembly. 4K capture, GPU multiscale scans and all four native control options passed live checks. Real archived recordings are being enriched on the phone, with original MP4 digests and prior sidecars preserved. The final check reported 22 completed reviews in the current app session, zero detector/person-review errors, 358 recordings and 91 native appearances. The index retained 26 enriched recordings, 23 person tracks and 22 bounded pose summaries; these initial mostly nighttime recordings provided no available posture/gait or face evidence. See `s9-native-security/PERSON_EVIDENCE_V31.md` for release and rollback details.
- **Automatic assembly route preserved:** `c720p-s9-complete-clip-worker.timer` remains active, using `s9-complete-worker-v1.py` six minutes after boot and three minutes after each service completion. Publication receipts verify automatic complete MP4s, including the 05:03 Amsterdam output on 14 October. Its actual media hash matched its receipt and pre-event/event durations matched the completed timeline. Real range/HEAD playback and missing-route 404 checks passed after the deployed proxy fallback fix. The separate on-phone worker reported three errors and halted with zero completed merges; capture and person review remained healthy. Preserve the working hub fallback, original recordings and pre-event companions while diagnosing the native worker.
- **Conflicting old installer retired:** `c720p-s9-joined-preroll-safe-upgrade.timer` attempted an older APK cutover after access returned, then failed because its service-launch command targets a non-exported component. It interrupted the camera and would conflict with V31. Its timer is disabled and its one-time report now records `superseded_by_combined_person_evidence_v31`; the camera was restored via exported `CameraActivity`. Do not re-enable it unchanged or install its older package over V31. Its files and rollback artifacts remain available. Existing pre-event capture and complete-recording playback routes remain present.
- The Home Assistant Security iframe now uses `?v=person-folders-v31-20261014`. The prior 7 October URL could retain an old empty-controls page for 31 days under Home Assistant static caching. Its private dashboard backup is `/config/.storage/lovelace.c720p_hub.before-security-entry-v31-20261013T234511Z`; only that iframe URL changed and HA health was verified after restart.

- Earlier on 2026-10-14 (Amsterdam), before USB recovery and after the owner reported an S9+ restart: the preserved private management gateway remained functional. Diagnostic job **10672** (`adb devices -l`) completed with exit code 0 and showed the S3/S5, with no S9+ transport. The C720P outbound agent was active and the authorized `c720p` SSH alias worked.
- At that earlier outage, the saved S9+ network identity remained at `192.168.178.250` (model `SM-G965F`, serial `27bb603837047ece`, saved MAC `82:a7:90:2b:95:b4`), but direct ADB TCP 5555 was refused from both C720P and the Windows operator PC. Saved configuration, IPv6 neighbor records and mDNS provided no alternative verified S9+ endpoint. Neither computer then reported an S9+ USB ADB transport. The installed Windows Phone Link app exposed no usable connection window. These observations describe the recovered outage, not the current phone connection.
- **Access chain to remember:** privileged Supabase management connector -> private audited job gateway -> existing outbound C720P agent -> a phone's authorized direct ADB transport. SSH is an independent entry to the hub; the allowlisted GitHub maintenance workflow is another caller of the same database/agent path. None of these is a separate administrator service running on an unreachable phone.
- Do not infer reboot-persistent S9+ access from an earlier successful ADB probe. The saved watchdog describes best-effort `persist.adb.tcp.port` writes and a recovery fallback; unattended S9+ cold-reboot persistence has not been proven. A missing post-restart phone transport must be distinguished from a failed hub management route. Recovery used a direct S9+ connection; no S3 relay was started.

- 2026-10-11: private Supabase management job **10230** completed with exit code 0. C720P agent and camera tunnel active; ADB-shell probe successful for all three Android models; local Home Assistant returned HTTP 200; main site, shop and League pages returned HTTP 200.
- 2026-10-11: connected GitHub maintenance workflow remains manually dispatchable and reusable; prior GitHub Actions run **38160493700** and resulting C720P job **10196** completed successfully.
- This document is **operational context, not a security bypass**. Permissions and connections must be verified again before use.

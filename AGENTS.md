# Autonomous operations contract

This repository manages the C720P Home Assistant hub, Samsung S9+ camera, S3 motion sensor, S5 IR, hosted websites and linked projects. For all authorized work, read [the verified administrative access runbook](ops/c720p/ADMIN_ACCESS_CONTINUITY.md) **before claiming a device or project cannot be controlled**.

## Standing owner instructions

**Work autonomously, proactively and thoroughly. The owner is a last-resort resource.** Make sound technical decisions and execute them using all legitimately available tools and access routes. Do not repeatedly ask the owner to choose routine engineering details, re-confirm information already supplied, run commands that the connected tools can run, or manually shepherd multi-step work.

For requests to continue or finish an earlier task, retrieve the actual task state and latest verification; do not start over with generic proposals. Favor making measurable progress on the named production problem over cosmetic notes or unrequested refactoring.

## End-to-end completion procedure

1. **Recover context and inspect reality.** Read the most relevant documentation, source, live status and logs. Verify exact branch, service versions, automation states, source of truth and existing backups. Never infer a deployment from a merged PR.
2. **Plan and act without repetitive questions.** Use the working connected GitHub/Supabase management routes, permitted tools, established SSH, or other authorized service APIs as appropriate. Prefer changes with actual observed user benefit, backed by evidence.
3. **Guard and test changes.** Save a rollback, check syntax/regressions, deploy only via a genuinely authorized mechanism, verify live service health and real-world functional outcomes. Preserve manual overrides and the last verified administrator route.
4. **If an action is denied:** Do not bypass, disguise or reroute the *same prohibited operation*. Inspect the precise failure, explore other genuinely authorized and independently meaningful actions, and advance the task as far as permitted (e.g., diagnostics, tests, corrective source changes, regression prevention). After an explicit authorization denial, report the specific unresolved production step rather than claiming completion.
5. **Keep user involvement minimal.** Make independent low-risk choices. Ask only when there is a real permissions/physical-world blocker or an unresolved consequential choice; describe exactly what intervention is required and what has already been exhausted. Do not call a device unavailable just because a direct SSH terminal is not present in a particular chat.
6. **Report evidence, not intentions.** Separate *staged*, *deployed*, *verified in simulation*, *verified on live device*, and *not verified*. Quote real test and job IDs where useful. Do not silently leave work incomplete, overwrite a newer live version with an older patch, or say an untested feature works.

## Important live context (11 October 2026)

- Source of truth: `ops/c720p/ADMIN_ACCESS_CONTINUITY.md` and private `c720p_agent.operator_access_continuity_v1` record in Supabase. The private C720P outbound maintenance agent can perform authorized diagnostics and has previously communicated with S9+, S3 and S5 via ADB.
- The GitHub workflow `.github/workflows/c720p-secure-maintenance.yml` only supports allowlisted **diagnostic operations**. It is not an authorized arbitrary code deployment facility.
- For the living-room lamp: V17 night shape filter is installed, but the real lit-room walk at approximately 21:09 was missed; a transition-settling motion event switched the lamp on at 21:07. V18 adjustment is staged in `ops/c720p/frontcam_motion_v18_normal_light_patch.py` (merged PR #515) and passed a read-only on-device dry run, but **is NOT deployed** because production activation was denied. Preserve the V17 detector and HA manual override while pursuing an explicitly permitted activation and real-walk acceptance test.
- These working preferences and access notes are project-level persistence. They are not a promise that account-level ChatGPT Memory will always expose every detail.

# GEJAST / Kale Nel v653 repair patch — version alignment

## Goal

Repair the verified version-drift state without adding new features.

Verified drift before this patch:

- GitHub `VERSION` was `652`.
- GitHub `gejast-config.js` still declared `VERSION:'v638'`.
- GitHub `admin.html` still declared `window.GEJAST_PAGE_VERSION='v638'` and loaded many `?v638` assets.
- GitHub `admin_shared_stats.html` still declared/loaded v639.
- GitHub `admin_ops_observability.html` still declared/loaded/displayed v651.
- Live deployed `admin.html` also appeared divergent from GitHub `main`, so deployment/cache state must be verified after upload.

## Contents

- `VERSION` — target version file (`653`).
- `apply_v653_version_alignment.py` — repository-root repair script.
- `verify_v653_version_alignment.py` — post-repair scanner.
- `README_v653_VERSION_ALIGNMENT_PATCH.md` — this file.

## Why this is a script patch instead of hand-edited full-file replacements

The connected GitHub tool verified the drift, but it did not provide a safe complete repository checkout inside the execution container. The script performs targeted replacements against the actual repo checkout used by the next AI/GitHub operator, avoiding stale-file replacement from older uploaded bundles.

This is safer than uploading old reconstructed versions of core files over the current GitHub state.

## How to apply

From the root of the current `JesperOaths/kale-nel` checkout:

```bash
python3 apply_v653_version_alignment.py --dry-run
python3 apply_v653_version_alignment.py
python3 verify_v653_version_alignment.py
```

Then commit all changed files plus the generated `v653_version_alignment_report.json` if desired.

## What the script updates

It updates only targeted frontend/version markers:

- `VERSION` -> `653`
- `window.GEJAST_PAGE_VERSION='v###'` -> `v653`
- `gejast-config.js` style `VERSION:'v###'` -> `v653`
- local JS/CSS/MJS/HTML cache refs like `./gejast-config.js?v638` -> `?v653`
- hardcoded visible labels like `v638 · Made by Bruis` -> `v653 · Made by Bruis`
- `id="releaseVersion">v###` -> `v653`

## What it deliberately does not update

It does not blanket-replace every `v638` or `v651` string. That is intentional.

The following must remain untouched unless a specific SQL/API migration changes them:

- RPC names such as `admin_wake_outbound_email_job_safe_v638`
- helper constant names such as `DRINKS_SPEED_PAGE_RPC_V638`
- storage/session keys such as `jas_session_token_v11`
- historical handoff/report text

## Post-upload verification checklist

After GitHub upload/commit:

1. Confirm `VERSION` is `653`.
2. Confirm `gejast-config.js` exposes `VERSION:'v653'`.
3. Confirm `admin.html`, `admin_shared_stats.html`, and `admin_ops_observability.html` load `gejast-config.js?v653` and show `v653 · Made by Bruis`.
4. Open deployed `https://kalenel.nl/admin.html` in a hard-refresh/private window and check whether it matches GitHub `main`.
5. If deployment still shows an older page such as `Adminhub` instead of GitHub's `Beheerhub`, treat that as a deploy/cache mismatch, not as a source-code patch failure.

## SQL

No SQL is included or required for this repair patch.

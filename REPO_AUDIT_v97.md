# Repo audit v97

## Keep (runtime website/app files)
- `index.html`, `login.html`, `request.html`, `activate.html`, `leaderboard.html`, `scorer.html`, `score.html`, `vault.html`
- `admin.html`, `admin_claims.html`, `admin_expired.html`, `admin_mail_audit.html`, `admin_reserved_names.html`, `admin_security.html`
- `gejast-config.js`, `admin.js`
- Shared CSS and theme files actually referenced by live pages: `site-shell.css`, `phase2-v49.css`, `premium-v47.css`, `ui-v51.css`, `ui-v52.css`, `uniform-v48.css`, `theme-v46.css` (verify actual references before deleting older theme files)
- Live image/assets used by pages: `wordtergejast.png`, `logo.png`, `site-bg-desktop.webp`, `site-bg-mobile.webp`, `spinoza-silhouette.png`, `playingcard-accent.png`, `playingcard-accent1-trimmed.png`, `123zwartkaart.png`, `dubbeleD-goud.png`, `kale9goed.png`
- `CNAME`
- `klaverjas/score.html`, `klaverjas/leaderboard.html`, `klaverjas/style.css`, `klaverjas/score.js`, `klaverjas/klaverjas.sql` only if this subfolder is still used/deployed separately.

## Keep but move into docs or migrations folders
- Planning / handoff docs: `*_PLAN_*.md`, `CHANGES_v61.md`, `DEPLOYMENT_GUIDE_v50.md`, `EMAIL_*`, `FILE_AUDIT_v48.md`, `HOSTING_kalenel_nl.md`, `HTTPS_AUTOFILL_STATUS_v61.md`, `IMPLEMENTATION_README_v46.md`, `SITE_PAGES_v58.md`, `SITE_PAGES_v59.md`, `V47_ROLLOUT.md`
- SQL patches: `gejast_v32_secure_activation.sql`, `gejast_v47_frontend_alignment_patch.sql`, `gejast_v48_klaverjas_score.sql`, `gejast_v50_rest_and_email_worker_patch.sql`, `gejast_v53_email_activation_make_patch.sql`, `gejast_v62_admin_names_lockdown_patch_r6.sql`, `gejast_v62_allowed_usernames_expiry_admin_patch.sql`, `gejast_v64_site_db_patch.sql`, `gejast_v65_site_db_patch.sql`

Recommended cleanup:
- move docs into `/docs`
- move SQL patches into `/sql` or `/migrations`
- keep root mostly for live site files only

## Good candidates to remove from root repo (after verifying not deployed or referenced)
- `admin-dev.html`
- `admin_v60_orig.html`
- `index_v60_orig.html`
- `scorer_v60_orig.html`
- `README_v45_patch.txt`
- `README.txt` if replaced by a proper `README.md`
- `testfile`
- duplicate/obsolete images if unreferenced: `playingcard-accent1-v48.png`
- old theme files if no page references them: `theme-v43.css`, `theme-v45.css`

## Before deleting anything, verify references
Run a reference search first:
- `grep -Rni "filename" .`
- or use your editor global search

## Main cleanup recommendation
1. Keep only live HTML/assets in root.
2. Move docs + SQL history into folders.
3. Delete `*_orig.html`, `*-dev.html`, `testfile`, and unreferenced duplicate assets.
4. Replace text readmes with one `README.md` describing deploy + structure.

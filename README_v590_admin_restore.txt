KALE NEL v590 admin restore patch

Purpose
- Restore the admin surfaces and admin session flow from the uploaded pre-mobile repo snapshot.
- Keep admin pages desktop-first.
- Prevent the repo-wide mobile foundation scripts/styles from attaching to admin/control pages.

Apply
1. Upload all files in this zip to the repo root.
2. Deploy.
3. Open admin.html once, log in again if needed, then test admin navigation across pages.

Included
- Restored admin pages and admin helper scripts from the pre-mobile repo snapshot.
- Restored match_control / match_swap pages referenced by admin nav.
- Added admin-desktop-restore-v590.js to strip repo-wide mobile foundation assets from admin/control pages.

Notes
- No SQL required.
- This patch is intentionally desktop-first for admin.

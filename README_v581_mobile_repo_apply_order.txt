KALE NEL v581 MOBILE REPO PATCH

What this patch is
- Repo-wide mobile hardening pass based on the locked shared mobile standard.
- No SQL in this patch.
- Frontend/code replacement patch only.

Core changes
1) Shared mobile baseline added and auto-loaded through gejast-config.js
   - gejast-mobile-foundation-v581.css
   - gejast-mobile-foundation-v581.js
   - gejast-mobile-route-fixes-v581.js
2) gejast-config.js bumped to v581 and now auto-loads the new mobile baseline on pages that use gejast-config.
3) GEJAST page version and gejast-config query strings synced to v581 across the repo files touched here.
4) Homepage cache keys bumped to v581.
5) Existing mobile helper modules kept but moved to v581 labeling.
6) Legacy iframe vault wrappers now get mobile-direct handling like the chosen ladder direction.
7) Family redirect shells got viewport/mobile-safe wrapper treatment.

Apply order
1. Upload/replace all files from this zip in the repo.
2. Deploy.
3. Open the site once in a normal browser and clear site data if old shell behavior still persists.

Notes
- No SQL is required for this patch.
- This patch keeps one canonical route per normal page. It does not create separate mobile duplicate pages.
- Pikken and Paardenrace remain watermark-free through the existing config/module handling.

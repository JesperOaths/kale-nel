GEJAST patch v423

Files in this bundle:
- index.html
- gejast-config.js
- gejast_v423.sql

What changed:
- Restored the homepage row with Paardenrace + placeholder beneath Beerpong/Spelers and above Balzaal.
- Bumped the shared frontend version to v423 through gejast-config.js and pointed index.html at gejast-config.js?v423.
- Added an SQL bundle intended to restore the missing live RPC contract pieces behind the console errors:
  - track_site_event
  - get_gejast_homepage_state
  - get_jas_app_state
  - queue_test_web_push compatibility
  - touch_active_web_push_presence_v3 compatibility

Apply order:
1. Upload index.html and gejast-config.js to the repo.
2. Run gejast_v423.sql in Supabase SQL editor.
3. Deploy / wait for site update.
4. Hard refresh the homepage.

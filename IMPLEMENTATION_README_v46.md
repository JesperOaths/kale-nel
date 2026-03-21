# v46 implementation notes

## What changed
- Homepage simplified to state + two vote buttons + Legends/Losers only.
- Player login moved to `login.html`.
- Public-facing test mode removed from the main homepage and hidden from `admin.html`.
- Admin automatic mail now targets the queue-based SQL flow via `admin_queue_activation_email(...)`.
- Added SQL migrations/proposals for:
  - homepage status RPC
  - sliding player session refresh
  - durable outbound email queue
  - admin queue helper
  - Supabase -> Make webhook trigger
- Rebuilt background assets and layered SVG sources.

## Apply in this order
1. Upload the static site files.
2. Run the SQL files in `supabase/sql/` in this order:
   1. `2025-03-21_proposed_homepage_status_rpc.sql`
   2. `2025-03-21_proposed_player_session_refresh.sql`
   3. `2025-03-21_proposed_outbound_email_jobs.sql`
   4. `2025-03-21_proposed_admin_queue_activation_email.sql`
   5. `2025-03-21_make_webhook_trigger.sql` (after you have your Make webhook URL)
3. In Make, build the scenario described in `planning/MAKE_SCENARIO_BLUEPRINT.md`.
4. Replace the placeholder webhook URL and API key in the Make trigger SQL before running it.
5. Hard refresh the site.

## Important note
The SQL files are based on the documented snapshot and the current frontend assumptions. Because the live Supabase schema is quirky, verify each function signature in the SQL-understanding folder before applying changes to production.

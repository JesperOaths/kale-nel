# GEJAST v718 Surgical Continuity Update

Built from the user-supplied `gejast_v725a_USE_THIS_v717_frontend_surgical_sql` baseline.

This package keeps the v717 repair-first ownership model and applies only surgical changes:

- version/cache-buster convergence to v718 across the included frontend files;
- Pikken live dice fraction fallback no longer hardcodes 6 dice per player;
- Pikken victory burst is expanded behind the popup with more dice/faces/streamers/balloons/logos;
- Paardenrace live drawer no longer auto-opens on desktop;
- Paardenrace live bounces out of active races that have fewer than 2 players instead of showing a fake empty active race;
- SQL wrapper repair is narrowed to frontend-facing wrappers and cleanup, without replacing Pikken bidding/voting/gameplay or Paardenrace draw logic.

SQL is separate: `GEJAST_v718_surgical_wrapper_and_cleanup.sql`.

# GEJAST Handoff Note v156

- SQL/script patches should keep being delivered as full updated scripts.
- Sitewide versioning now uses `gejast-config.js?v156` cache-busted includes across pages.
- Root cause admin re-login loop: `admin-session-sync.js` and `admin-gate-v105.js` incorrectly required both token and username/device context. The durable fix is token-first validation with device upgrade only when extra data exists.
- `player.html` is now a unified player profile with per-game toggle instead of separate profile pages per game.
- `profiles.html` should list every site player, not only players seen in match/profile tables.
- Homepage ladder names, vote lists, ladder tables, recent matches, pair stats, matchup stats, and profile cards should link through to `player.html`.

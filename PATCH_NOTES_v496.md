# v496 fast login + session gate stability patch

Included files:
- login.html
- gejast-home-gate.js
- scorer.html
- klaverjas_quick_stats_v593.html
- kruipen_under_table.png
- naakt_kruipen_danger.png

Main fixes:
- login page now renders cached names immediately and uses a single fast names path first
- login page no longer does the duplicate floating session-corner fetch
- login page defers the existing-session tile lookup instead of competing with name load
- home gate now only redirects on missing token or hard-invalid session; transient lookup failures/timeouts no longer dump users to home
- exact v596 scorer/quick-stats layout preserved while converging their hidden script includes to v496

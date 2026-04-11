GEJAST v430 index auth root-fix

Files included:
- index.html
- home.html
- gejast-config.js
- site-analytics.js
- README_v430.txt

Root cause addressed:
index.html was using token-presence checks plus a separate shared gate. That combination allowed blank/frozen states: the page could start booting before auth was truly validated, while the old shared gate could still redirect or stall.

Changes:
- add a dedicated index auth promise that validates the player session against Supabase before homepage boot continues
- keep index hidden only at the card level during auth-pending, not by hiding the entire document
- if validation fails, clear the stale player token and redirect to home.html
- make bootHomepage wait for the auth promise before any heavy homepage boot work runs
- disable site analytics on public auth pages like home.html to remove the track_site_event CORS noise there
- bump shared version to v430 and update home watermark

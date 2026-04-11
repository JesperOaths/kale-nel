GEJAST v428 raw index preflight patch

Files included:
- index.html
- home.html
- gejast-config.js

Changes:
- replaces the index auth preflight with a raw storage-based redirect check that runs before gejast-config and before the heavy homepage scripts
- redirects no-session users from index.html to home.html earlier and more reliably
- updates home watermark/version to v428
- bumps shared version to v428

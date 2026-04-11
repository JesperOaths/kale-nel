GEJAST v432 public page cache-bust patch

Files included:
- index.html
- home.html
- login.html
- gejast-config.js

Purpose:
The browser was serving disk/memory-cached old public-page HTML and old script references even after uploads. This patch adds an early __bust=v432 redirect shim on the public entry pages so they force a fresh HTML request once and stop reusing the stale cached markup.

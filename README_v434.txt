GEJAST v434 public entry sync patch

Files included:
- index.html
- home.html
- login.html
- request.html
- gejast-config.js

Deep diagnosis from latest repo:
- public/auth entry pages are version-skewed: request is still v420, index/home are v432, login is v433
- login.html still contains a gejast-cache-bust shim targeting v432 while the page itself is v433
- this means the public entry pipeline is internally inconsistent and can keep bouncing users through stale-cached HTML/script references

This patch synchronizes the whole public entry pipeline to v434 and aligns the cache-bust target and shared config version across all public entry pages.

GEJAST v437 login script-rename bypass patch

Files included:
- login.html
- gejast-config.js
- gejast-family-rollout-v437.js
- gejast-account-scope-v437.js
- gejast-account-links-v437.js
- README_v437.txt

Why this exists:
Incognito still freezing means this is not just the normal browser profile. The problematic requests are clustered around the same login helper filenames. This patch bypasses poisoned path-level caching/interference by changing the actual script basenames, not just query strings.

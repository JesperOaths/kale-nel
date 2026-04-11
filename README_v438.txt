GEJAST v438 minimal login pipeline patch

Files included:
- login.html
- gejast-config.js
- README_v438.txt

Reasoning:
The login helper chain kept being the common denominator across desktop, incognito, and mobile. This patch reduces login.html to a minimal dependency path: only gejast-config remains external; helper scripts and analytics are removed from login entirely. Login now uses direct inline RPC calls with short timeouts and manual scoped link rewriting.

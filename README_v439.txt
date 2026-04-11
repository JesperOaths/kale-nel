GEJAST v439 safe-login fallback

Files included:
- login.html
- gejast-config.js
- README_v439.txt

This replaces login.html with a barebones fallback page: no decorative scene, no helper-chain scripts, no analytics, no modal, no player-session corner. Only gejast-config.js remains external. If this still freezes, the cause is no longer inside the original login page pipeline.

GEJAST gate hotfix v423

Files:
- gejast-config.js
- gejast-home-gate.js

Hotfix:
- fixes the blank-site regression caused by clearing body content before successful auth validation
- keeps the page hidden while validating
- only scrubs the DOM if a redirect is actually happening
- preserves the fail-closed redirect logic to home.html for missing/invalid sessions
- bumps shared visible version to v423

GEJAST v425 patch

Files included:
- index.html
- home.html
- gejast-home-gate.js
- gejast-config.js

Changes:
- fixes blank index/homepage by preventing old fail-hidden state from persisting
- adds a safe reveal fallback if homepage boot stalls
- hardens private-page redirect gate to validate session and redirect to home.html on invalid sessions
- fixes home.html stale-token redirect loop by validating session before forwarding
- restores Paardenrace + placeholder row below Beerpong/Spelers and above Balzaal
- bumps shared version to v425

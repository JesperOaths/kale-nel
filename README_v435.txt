GEJAST v435 versioned-public-links patch

Files included:
- gejast-config.js
- gejast-account-links.js
- index.html
- home.html
- login.html
- request.html

Deeper finding from the screenshots:
The browser is mixing fresh and stale public-page HTML. Home is already on v434 while login still opens an older cached document. To avoid relying on manual force-refresh, all public entry links should carry a versioned __bust param generated from the shared current version.

This patch synchronizes the public pages to v435 and makes buildHomeUrl/buildLoginUrl/buildRequestUrl plus scoped public links append __bust=v435 automatically.

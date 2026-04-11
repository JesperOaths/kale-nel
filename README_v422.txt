GEJAST gate fix v422

Files:
- gejast-config.js
- gejast-home-gate.js

What changed:
- private-page gate now fails closed instead of open
- stale/invalid session tokens no longer count as access
- pages stay hidden until viewer RPC validation succeeds
- if viewer RPCs fail or return no logged-in identity, the user is cleared out and redirected to home.html
- shared visible version bumped to v422

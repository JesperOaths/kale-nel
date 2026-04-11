GEJAST loop fix v424

Files:
- gejast-config.js
- home.html

Root cause fixed:
- home.html was auto-forwarding on raw token presence only
- that could create a redirect loop with the hardened private-page gate when the stored token was stale/invalid

What changed:
- home.html now validates the viewer session before auto-forwarding
- invalid/stale tokens are cleared instead of bouncing the user back into protected pages
- shared visible version bumped to v424

v594 patch bundle

Changed repo-upload files:
- gejast-config.js
- admin.html
- admin-session-sync.js
- admin-gate-v105.js
- gejast-scope.js
- pikken.html
- gejast-pikken.js
- pikken_live.html

Separate SQL:
- gejast_v594_scope_and_pikken_followup.sql

What this patch covers:
- admin hub session/device remembrance is stretched out and no longer tied to a short 8-hour local deadline
- admin hub now reuses a stored local/device session more softly and refreshes it in the background
- stronger family/friends frontend scope filtering
- stricter scoped login/player SQL readers
- Pikken lobby page cleaned up for desktop and mobile:
  - room-first create/join
  - visible open/live room rail
  - clearer host/start readiness state
  - less cluttered hierarchy
- Pikken open-lobby SQL reader now safely cleans up empty games and stale non-live lobbies

Important limitation:
- this workspace did not contain the canonical current SQL bodies for Pikken match-history/ELO finalization
- because of that, the SQL file does NOT auto-finalize stale live games with >10 rounds into weighted history/ELO
- that specific live-finalization part still needs the real current backend owner path before it should be patched

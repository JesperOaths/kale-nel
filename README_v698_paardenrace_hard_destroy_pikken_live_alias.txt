GEJAST v698 - Paardenrace hard destroy + Pikken live alias

Upload/copy the files from this update folder, then run:

GEJAST_v698_paardenrace_hard_destroy_pikken_live_alias.sql

Fixes:

1. Paardenrace "Hef room op"
- The client now suppresses the just-deleted room code for a short period so a stale open-room fetch cannot flash it back into the UI.
- The SQL replaces the old disband/reset-style behavior with a real delete:
  - delete paardenrace_room_players
  - delete known optional child tables when present
  - delete paardenrace_rooms
- The aliases destroy_paardenrace_room_safe, close_paardenrace_room_safe, and disband_paardenrace_room_safe now all delegate to the same hard-delete path.

2. Pikken screenshot alert
- Restores public.pikken_get_live_state_public(uuid, text, text) as a compatibility alias.
- It delegates to pikken_get_state_scoped so older deployed live-page calls no longer fail with "function does not exist".

Notes:
- This update is a normal folder, not a zip.
- Run the SQL after uploading the changed frontend files.

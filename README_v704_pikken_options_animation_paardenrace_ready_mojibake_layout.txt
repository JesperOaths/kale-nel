GEJAST v704 - Pikken options/animations, Paardenrace ready, mojibake cleanup, layout guide

Upload/copy the files in this folder to the site root.

Run this SQL in Supabase:
- GEJAST_v704_pikken_options_animation_paardenrace_ready_mojibake.sql

Main fixes:
- Pikken first bid dropdown now shows every possible first bid from 1 through current dice total, ordered 2, 3, 4, 5, 6, pik for each count.
- Pikken live now shows a clear round-resolve overlay and plays a throw animation when the new private hand arrives.
- Pikken still keeps other players' dice hidden.
- Paardenrace ready RPC now uses row_count after dynamic SQL, so a successful update is recognized correctly.
- Paardenrace ready RPC matches the player by id plus multiple name fields.
- Mojibake sequences were removed from text files that contained visible bad characters.
- A mobile/desktop visual guide was added: VISUAL_GUIDE_v704_PIKKEN_PAARDENRACE_MOBILE_LAYOUT.md

Notes:
- This is a normal update folder, not a zip.
- Source should use ASCII placeholders like --, ..., ->, and " - " instead of mojibake-prone symbols.

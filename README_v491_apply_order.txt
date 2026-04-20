v491 apply order

1. Upload the files from this flat zip.
2. Run the separate SQL file:
   gejast_v491_pikken_resume_snapshot_followup.sql

What changed
- Pikken lobby now tries to auto-resume the current player's existing active lobby/game instead of allowing duplicate lobbies
- create/join now refuse by returning the player to their current active game
- ready/unready buttons now highlight current state
- non-host users no longer see a start button
- rules moved to a floating sheet button instead of an in-layout accordion
- Pikken live page redesigned toward the chosen P2 + T2 mobile direction
- homepage version drift corrected to v491 in this patch
- watermark softened to 75% on game-heavy pages included in this patch
- SQL adds active-game lookup plus round-6-and-onward snapshotting and delete/finalize safety

GEJAST v701 - Pikken rules, Paardenrace ready, continuation handoff

Run:

GEJAST_v701_pikken_rules_paardenrace_ready_handoff_fix.sql

Fixes:

1. Pikken afkeuren/voting/reveal
- Bidder is excluded from voting on his own bid.
- Challenger automatically records an "afgekeurd" vote when pressing Afkeuren.
- In a two-player match, Afkeuren resolves immediately.
- The backend counts all dice, applies the penalty mode, removes one die from the correct player, deals the next round, and continues.
- Normal/wrong_loses: wrong side loses one die.
- Fair/right_loses: right/winning side loses one die.
- Match only finishes when one player remains.

2. Paardenrace ready
- Drops all overloaded set_paardenrace_ready_safe signatures again.
- Recreates one canonical function that directly updates the ready/is_ready column on paardenrace_room_players.
- Does not delegate through the older choice RPC, avoiding another overload trap.

3. Handoff
- Adds HANDOFF_v701_RECENT_CHAT_CONTINUATION.md for a future AI continuation with current state, gotchas, and test checklist.

No zip is created for this update.

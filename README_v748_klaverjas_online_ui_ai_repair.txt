GEJAST v748 - Klaverjas online UI / hand / score / coach repair

Prepared patch bundle contents:
- VERSION
- klaverjas_online.html
- README_v748_klaverjas_online_ui_ai_repair.txt

Purpose:
- Make the Klaverjas online hand easier to read.
- Make the bidding interface more like a score-form layout.
- Keep a score-form style side panel visible during multiplayer play.
- Sort the visible hand by suits in the requested order: hearts, spades, diamonds, clubs.
- Sort ranks high-to-low; after trump is chosen, trump cards are moved to the front and sorted by trump strength.
- Keep the last completed hand/trick visible in miniature.
- Slow down card play, trick collection, bot actions, shuffling and dealing visually.
- Store progress metadata into the online game state at every save and into localStorage as a client snapshot.
- Add richer AI coach output with +/- point delta where the simple AI would have differed.
- Rotate the dealer clockwise in the visual table order.

SQL:
- No SQL required for v748.
- Existing klaverjas_online_save_state persists the state after every action.
- v748 adds progress_tick, last_saved_at, last_trick, saved_at on round records, and richer coach_recap fields inside the existing JSON state.

Deployment note:
- The full patched klaverjas_online.html is supplied in the v748 flat patch bundle for upload.
- The page script query parameters in that file are v748 to avoid immutable v746 JS cache reuse.

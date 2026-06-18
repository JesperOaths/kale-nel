GEJAST v749 - Klaverjas online complete gameplay repair

Files:
- VERSION
- klaverjas_online.html
- gejast-klaverjas-online.js
- README_v749_klaverjas_online_complete_gameplay_repair.txt

Implemented:
- End-of-round score panel showing both teams' earned points, card points, roem, and nat/non-nat status.
- Kruipen / naakt-kruipen danger indicator in the visible score panel.
- Four passes without a current bid now reshuffle/redeal and keep the bidding phase alive.
- Roem tally per round is shown on the table/score panel.
- Bots consider roem preservation, trump, table points, partner-winner status, remaining-card memory, and safer value plays instead of only using the old single-card value heuristic.
- Blinking border marks the current player/bot.
- Played cards get player-colored borders.
- Trump memory aid shows the two important trump cards (J and 9) or Sans when no trump is active.
- Suit bidding keeps 80 bids available and treats 80 color as a target of 82 card points.
- Nat checking uses card points only. Roem does not help make the bid.
- If the bidder is nat, defenders receive 162 plus all roem.
- Leave Table button clears the local current bot/match table and returns the page to lobby state.
- Hand remains large, sticky, and sorted hearts -> spades -> diamonds -> clubs, with trump cards moved to the front after bidding.
- Last completed trick remains visible in miniature.
- Slower bot/card/trick/deal timing and CSS animations are included.
- Progress metadata is stamped at every save and localStorage gets a client progress snapshot.

SQL:
- No SQL required.
- Existing klaverjas_online_save_state persists the JSON state; v749 extends the JSON payload with progress_tick, last_saved_at, last_trick, saved_at, redeal_count, and richer round/coaching/result fields.

Known honest note:
- I searched the connected GitHub repo for kruip/naakt image assets and did not find a matching image file. The patch therefore uses a visible text/emoji danger indicator instead of a real image asset.

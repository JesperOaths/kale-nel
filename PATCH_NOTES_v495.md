# GEJAST / Kale Nel — v495 patch notes

## Included frontend files
- `gejast-config.js`
- `gejast-paardenrace.js`
- `paardenrace.html`
- `paardenrace_live.html`
- `pikken.html`
- `pikken_live.html`
- `gejast-pikken-live.js`

## Main changes in this patch

### Paardenrace
- replaced the heavy live-board image / horse-image presentation with a lighter CSS-driven board
- minimap now has an extra top GATE row
- resolved gate cards show their suit color in the minimap and on the main board
- hearts and diamonds are red on the left-side suit labels; spades and clubs stay black
- last drawn card is shown as a full card view instead of shorthand text
- mobile live screen is simplified and the bottom dock no longer has a `Race` button
- host-only controls are hidden from normal participants
- participants can leave from the live page with Dutch confirmation
- host can close the match from the live page with Dutch confirmation
- host can kick participants from the live page with Dutch confirmation
- `Nieuwe ronde nieuwe kansen` now resets the same room and sends users back to the lobby flow
- live page auto-closes after all winner nominations are submitted (host closes, others bounce back on poll)
- lobby refresh path now calls the idle cleanup helper

### Pikken
- live page now shows the actor hand directly instead of hiding it behind a local fake roll/lock layer
- live page keeps grouped/sorted dice visible
- added a client-side next-seat fallback when the server state keeps the turn on the bidder after a bid
- leave / destroy / kick confirmations are in Dutch on the live page
- updated Pikken page versions to v495 to reduce drift on this surface

## Important caveat
- the Pikken turn-handoff issue may still need a true backend fix if the database itself keeps enforcing the old current-turn seat; this patch adds a client fallback and better visibility, but it cannot fully rewrite an unverified backend state machine by itself

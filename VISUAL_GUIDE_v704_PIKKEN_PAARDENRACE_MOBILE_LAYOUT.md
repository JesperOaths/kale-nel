# Visual Guide v704 - Pikken + Paardenrace Mobile Layout

## Shared Layout Rules

Use a single responsive shell for lobby, live game, and spectator pages:

```text
Desktop >= 980px
┌────────────────────────────────────────────┐
│ Header: title, phase pill, primary actions │
├──────────────────────┬─────────────────────┤
│ Main game surface    │ Side/status panels  │
│ table / track / map  │ player state, rules │
├──────────────────────┴─────────────────────┤
│ Sticky action dock: only current actions    │
└────────────────────────────────────────────┘

Mobile < 700px
┌──────────────────────────────┐
│ Compact header + phase       │
├──────────────────────────────┤
│ Main game surface first      │
├──────────────────────────────┤
│ Current player/action state  │
├──────────────────────────────┤
│ Collapsible rules/history    │
├──────────────────────────────┤
│ Sticky bottom action dock    │
└──────────────────────────────┘
```

The mobile order should always be: what is happening, what can I do now, what happened before, extra admin/rules.

## Pikken Lobby

- Show create/join controls as a compact row on desktop and a two-button grid on mobile.
- Open lobbies should be a vertical list with code, host, player count, ready count, and one join button.
- If the viewer has an active match, show one clear "Open match" action and one "Leave match" action. Do not auto-forward unless the viewer is still in the players list.

## Pikken Live

- The table is the first visual. Seats stay around the table on desktop; on mobile seats can compress closer to the table, but the current bid must stay readable.
- Bid dropdown must include all legal options. First bid should list every count from 1 to current dice total, each ordered 2, 3, 4, 5, 6, pik.
- Resolve must be visual:
  - Overlay: "Bod gehaald" or "Bod niet gehaald".
  - Show loser name and "verliest een dobbelsteen".
  - Immediately animate the new private dice hand.
  - Never show other players' dice.
- Keep the action dock sticky and minimal:
  - Bidding: bid select, Bied, Afkeuren.
  - Voting: Goedgekeurd, Afgekeurd.
  - Passive: "Live meekijken", Leave.

## Paardenrace Lobby

- The current room card should be the truth source. If a room state is visible, no stale "Room niet gevonden" error may stay on screen.
- Open lobbies should refresh separately from current room state. The current room state gets priority; open-lobby refresh is throttled.
- Ready controls should be tactile:
  - Disable Ready until wager is saved and verified.
  - On click, set button label to "Ready..." until RPC returns.
  - On success, immediately update the local ready pill and stats from returned state.
- Host/admin verification should stay in the right column on desktop and move below player list on mobile.

## Paardenrace Live

- Desktop: track/horse board full width, right rail with pot, players, deck, last card, and event log.
- Mobile: track first, then compact player rows, then event log. Keep "Terug", "Sync", and spectator/open controls in a horizontal scroll row.
- Gate events need a short visual state: card flips, suit goes back, and event log gets a highlighted newest row.

## CSS Implementation Notes

- Use `grid-template-columns: minmax(0, 1.08fr) minmax(320px, .92fr)` on desktop, collapse to `1fr` below 980px.
- Use sticky bottom docks with stable button sizes.
- Avoid nested cards. Panels can be sections; repeated lobby/player rows can be cards.
- Use ASCII placeholders: `--`, `...`, `->`, ` - `. Avoid mojibake-prone symbols in source.

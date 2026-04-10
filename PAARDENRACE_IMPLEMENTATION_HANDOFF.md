# Paardenrace Implementation Handoff

This document is the concrete build brief for implementing the `paardenrace` game on `kalenel.nl` inside this repo.

For a more step-by-step, “tell an AI exactly what to do” guide, also see:
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\PAARDENRACE_AI_IMPLEMENTATION_GUIDE.md`

## Goal

Build a live multiplayer paardenrace game using the existing static HTML/JS + Supabase architecture already used on the site.

The game must feel native to the current site:
- parchment / bookmaker / card-table visual language
- actual ace cards as horses
- dark card back for gate and draw cards
- live shared state across all viewers in a room

## Relevant Existing Repo Files

- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\gejast-config.js`
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\gejast-live-sync.js`
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\gejast-live-summary.js`
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\beerpong.html`
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\ladder.html`
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\player.html`
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\profiles.html`
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\admin_match_control.html`
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\gejast-drinks-workflow.js`
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\gejast_v125_stats_hub_elo.sql`

## Visual Direction

Visual thesis:
- bookmaker ledger + ivory playing cards + dark card back + turf club betting table

Canonical exact supplied card source:
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\assets\paardenrace\paardenrace-cards-supplied.webp`

Exact preview page (renders the supplied sheet as-is):
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\paardenrace_cards_supplied_exact.html`

Exact-card board reference (DOM + sprite slicing):
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\paardenrace_track_supplied_cards.html`

Important:
- Do not redraw or reinterpret the supplied paardenrace cards.
- Use the supplied sheet as a sprite and crop it for the ace horses + gate backs.

Card sprite metadata (sheet = `1024x278`):
- `heart` ace: `x=193 y=86 w=118 h=168`
- `club` ace: `x=325 y=86 w=117 h=168`
- `diamond` ace: `x=456 y=86 w=118 h=168`
- `spade` ace: `x=588 y=86 w=117 h=168`

Canonical face-down card back (gates + draw deck):
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\assets\paardenrace\paardenrace-card-back.png`

The earlier canvas renderer is still useful for supporting ornament/background ideas, but it is no longer the canonical card source:
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\gejast-paardenrace-canvas-art.js`

Important exported visuals:
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\assets\paardenrace\paardenrace-cards-sheet.png`
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\assets\paardenrace\paardenrace-track.png`

The intended board geometry is now:
- 4 horse lanes
- each lane has:
  - 1 start box before the start line
  - 10 race boxes
  - 1 finish box after the finish line
- 1 extra gate row above the lanes
  - this row has 10 face-down gate cards aligned with the 10 race boxes only

Position semantics:
- horse position `0` = start box
- horse positions `1..10` = race boxes
- horse position `11` = finish box / crossed

## Files To Create

- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\paardenrace.html`
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\paardenrace_live.html`
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\paardenrace_stats.html`
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\gejast-paardenrace.js`
- next SQL migration file, for example `gejast_vXXX_paardenrace.sql`

Files likely to update:
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\index.html`
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\ladder.html`
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\player.html`
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\profiles.html`
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\admin_match_control.html`

## Recommended Frontend Split

Use DOM for:
- room creation / join flow
- wager entry
- suit selection
- player list
- ready states
- countdown text
- next-card button
- winner nomination modal
- final “Jij moet drinken: X Bakken” summary

Use canvas for:
- board
- horse cards in lanes
- gate row
- draw pile / last drawn card

Recommended page structure for `paardenrace.html`:

```html
<main class="pr-page">
  <section class="pr-topbar">
    <div class="pr-room-meta"></div>
    <div class="pr-actions"></div>
  </section>

  <section class="pr-layout">
    <aside class="pr-sidebar">
      <div id="prLobbyCard"></div>
      <div id="prPlayerList"></div>
      <div id="prDrawInfo"></div>
      <div id="prResultPanel"></div>
    </aside>

    <section class="pr-board-wrap">
      <canvas id="prBoard" width="1400" height="980"></canvas>
    </section>
  </section>

  <dialog id="prSetupDialog"></dialog>
  <dialog id="prNominationDialog"></dialog>
</main>
```

## Renderer Usage

### Cards: Use The Supplied Sprite (Canonical)

For the paardenrace cards, the canonical source-of-truth is the supplied sprite sheet:
`assets/paardenrace/paardenrace-cards-supplied.webp`.

Do **not** rebuild these cards in SVG/Canvas; crop from the sprite.

Canvas helper (draw exact card art using `drawImage` crop):

```js
const CARD_RECTS = {
  heart:   { sx: 193, sy: 86, sw: 118, sh: 168 },
  club:    { sx: 325, sy: 86, sw: 117, sh: 168 },
  diamond: { sx: 456, sy: 86, sw: 118, sh: 168 },
  spade:   { sx: 588, sy: 86, sw: 117, sh: 168 }
};

const CARD_BACK_SRC = './assets/paardenrace/paardenrace-card-back.png';

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Usage: const sheet = await loadImage('./assets/paardenrace/paardenrace-cards-supplied.webp');
function drawSuppliedCard(ctx, sheet, kind, dx, dy, dw, dh) {
  const r = CARD_RECTS[kind];
  ctx.drawImage(sheet, r.sx, r.sy, r.sw, r.sh, dx, dy, dw, dh);
}

// Usage: const back = await loadImage(CARD_BACK_SRC);
function drawCardBack(ctx, backImg, dx, dy, dw, dh) {
  ctx.drawImage(backImg, dx, dy, dw, dh);
}
```

DOM helper (CSS sprite slicing) is demonstrated in:
`paardenrace_track_supplied_cards.html`.

## Board Coordinate Mapping

Use these exact logical columns:

- column `0` = start box
- columns `1..10` = race boxes
- column `11` = finish box

Recommended helper:

```js
function getLaneSuitOrder() {
  return ['hearts', 'diamonds', 'clubs', 'spades'];
}

function getBoardLayout() {
  return {
    boardX: 248,
    gateY: 172,
    gateHeight: 84,
    laneStartY: 292,
    cellWidth: 80,
    cellHeight: 104,
    cellGap: 10,
    rowGap: 16
  };
}

function getLaneY(laneIndex) {
  const layout = getBoardLayout();
  return layout.laneStartY + laneIndex * (layout.cellHeight + layout.rowGap);
}

function getColumnX(columnIndex) {
  const layout = getBoardLayout();
  return layout.boardX + columnIndex * (layout.cellWidth + layout.cellGap);
}
```

## Draw Overlay Pass

After drawing the board, overlay live state (ace horses + revealed gates + last drawn card):

```js
function drawLiveRaceState(canvas, state) {
  const ctx = canvas.getContext('2d');
  // const sheet = (loaded once) from paardenrace-cards-supplied.webp
  const suits = getLaneSuitOrder();
  const layout = getBoardLayout();

  // draw board background here (DOM or canvas), then overlay cards

  suits.forEach((suitKey, laneIndex) => {
    const pos = Number(state.match.horse_positions[suitKey] || 0);
    const col = Math.max(0, Math.min(11, pos));
    const x = getColumnX(col) + 5;
    const y = getLaneY(laneIndex) + 5;
    drawSuppliedCard(ctx, sheet, suitKey, x, y, layout.cellWidth - 10, layout.cellHeight - 10);
  });

  state.match.revealed_gate_cards.forEach((cardCode, gateIndex) => {
    if (!cardCode) return;
    // For non-ace cards you can either render a text-only mini card
    // or add more crop logic if you decide to use a full deck sprite later.
    const x = getColumnX(gateIndex + 1) + 7;
    const y = layout.gateY + 5;
    // draw a placeholder / mini card here
  });

  if (state.match.last_drawn_card) {
    // draw last drawn card UI (text-only or separate deck sprite)
  }
}
```

## Deck And Race Logic

Use canonical card codes:
- `AH`, `2H`, `KH`
- `AD`, `2D`, `KD`
- `AC`, `2C`, `KC`
- `AS`, `2S`, `KS`

Suggested helpers:

```js
const SUIT_MAP = {
  H: 'hearts',
  D: 'diamonds',
  C: 'clubs',
  S: 'spades'
};

function buildStandardDeck() {
  const suits = ['H', 'D', 'C', 'S'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const out = [];
  suits.forEach((suit) => {
    ranks.forEach((rank) => out.push(rank + suit));
  });
  return out;
}

function cardSuitFromCode(cardCode) {
  return SUIT_MAP[String(cardCode).slice(-1)];
}

function cardRankFromCode(cardCode) {
  return String(cardCode).slice(0, -1);
}
```

Match deck setup:

```js
function splitPaardenraceDeck(shuffledDeck) {
  const aceCards = shuffledDeck.filter((code) => cardRankFromCode(code) === 'A');
  const nonAce = shuffledDeck.filter((code) => cardRankFromCode(code) !== 'A');

  return {
    horses: {
      hearts: aceCards.find((code) => code === 'AH'),
      diamonds: aceCards.find((code) => code === 'AD'),
      clubs: aceCards.find((code) => code === 'AC'),
      spades: aceCards.find((code) => code === 'AS')
    },
    gate_cards: nonAce.slice(0, 10),
    draw_deck: nonAce.slice(10)
  };
}
```

## Server-Authoritative Match State

Suggested state shape:

```js
{
  room_code: 'PR-4831',
  stage: 'lobby',
  countdown_seconds: null,
  players: [
    {
      player_id: 'uuid',
      display_name: 'Jesper',
      selected_suit: 'hearts',
      wager_bakken: 2,
      ready: true
    }
  ],
  match: {
    match_ref: 'uuid',
    gate_cards: ['7C', 'KD', '4S', '2H', '9C', 'JD', '6H', '8S', '5D', 'QC'],
    revealed_gate_cards: [null, null, null, null, null, null, null, null, null, null],
    draw_deck: ['3H', '9S', 'KC'],
    draw_index: 0,
    last_drawn_card: null,
    horse_positions: {
      hearts: 0,
      diamonds: 0,
      clubs: 0,
      spades: 0
    },
    first_finish_suit: null,
    first_claimed_finish_suit: null,
    finished_suits: [],
    winner_player_ids: [],
    nominations_complete: false
  }
}
```

## Atomic Draw Logic

Implement the turn logic on the server in one transaction.

Pseudo logic for `paardenrace_draw_next_card(room_id, actor_player_id)`:

```sql
1. lock the current active room/match row
2. verify room stage = 'race'
3. verify there is still a card left in draw_deck
4. read draw_deck[draw_index]
5. increment the matching suit horse by 1
6. increment draw_index
7. set last_drawn_card
8. while there exists a gate index not yet revealed where all 4 horses >= gate_step:
   - reveal that gate card
   - move matching suit back 1 but never below 0
9. if any horse position > 10:
   - add that suit to finished_suits if not already there
   - if first_finish_suit is null, set it
   - if that suit has at least one selecting player and first_claimed_finish_suit is null:
     - set first_claimed_finish_suit
     - compute winners = players whose selected_suit equals that suit
     - stage becomes 'nominations'
10. write updated room summary payload
11. return the updated room/match state
```

Important:
- do not allow double-draw on multi-click
- do not let the browser compute official next state

## Gate Reveal Rule

Gate index mapping:
- gate row index `0` belongs to race step `1`
- gate row index `9` belongs to race step `10`

Reveal condition:

```js
function shouldRevealGate(horsePositions, gateStep) {
  return ['hearts', 'diamonds', 'clubs', 'spades']
    .every((suitKey) => Number(horsePositions[suitKey] || 0) >= gateStep);
}
```

Back-step rule:

```js
function moveHorseBackOne(horsePositions, suitKey) {
  horsePositions[suitKey] = Math.max(0, Number(horsePositions[suitKey] || 0) - 1);
}
```

## Winner Rule

Important:
- multiple people may choose the same suit
- multiple winners are allowed
- if an unselected suit crosses first, the game does not end

Winner helper:

```js
function getWinnersForClaimedSuit(players, winningSuit) {
  return players.filter((player) => player.selected_suit === winningSuit);
}

function hasAtLeastOneSelector(players, suitKey) {
  return players.some((player) => player.selected_suit === suitKey);
}
```

## Nominations

Each winner receives:

```js
nomination_budget_bakken = winner.wager_bakken * 2;
```

Rules:
- whole numbers only
- can nominate any participating player except themselves
- may nominate other winners
- full budget must be allocated before submitting

Recommended winner-side form state:

```js
{
  winner_player_id: 'uuid',
  budget: 4,
  assignments: {
    'target-player-1': 2,
    'target-player-2': 2
  }
}
```

Validation:

```js
function validateNominationBudget(formState) {
  const total = Object.values(formState.assignments)
    .map(Number)
    .reduce((sum, value) => sum + value, 0);
  return total === Number(formState.budget || 0);
}
```

## Final Obligation Summary

For every player compute:

```js
function buildObligationSummary(players, nominationsByTarget) {
  return players.map((player) => {
    const ownWager = Number(player.wager_bakken || 0);
    const nominatedExtra = Number(nominationsByTarget[player.player_id] || 0);
    return {
      player_id: player.player_id,
      display_name: player.display_name,
      own_wager_bakken: ownWager,
      nominated_extra_bakken: nominatedExtra,
      total_bakken_owed: ownWager + nominatedExtra
    };
  });
}
```

The current logged-in player must get a strong DOM panel:

```html
<section class="pr-you-owe">
  <h2>Jij moet drinken</h2>
  <div class="pr-total">4 Bakken</div>
  <dl>
    <div><dt>Eigen inzet</dt><dd>2</dd></div>
    <div><dt>Extra gekregen</dt><dd>2</dd></div>
  </dl>
</section>
```

## Suggested SQL Tables

Create dedicated paardenrace tables, for example:

- `paardenrace_rooms`
- `paardenrace_room_players`
- `paardenrace_matches`
- `paardenrace_match_nominations`

Suggested `paardenrace_room_players` columns:
- `room_id`
- `player_id`
- `display_name`
- `selected_suit`
- `wager_bakken`
- `ready`
- `joined_at`

Suggested `paardenrace_matches` columns:
- `room_id`
- `match_ref`
- `stage`
- `gate_cards jsonb`
- `revealed_gate_cards jsonb`
- `draw_deck jsonb`
- `draw_index`
- `last_drawn_card`
- `horse_positions jsonb`
- `first_finish_suit`
- `first_claimed_finish_suit`
- `finished_suits jsonb`
- `winner_player_ids jsonb`
- `summary_payload jsonb`

Suggested `paardenrace_match_nominations` columns:
- `match_ref`
- `winner_player_id`
- `target_player_id`
- `bakken_assigned`
- `created_at`

## Drink Integration

Use the existing drinks system, but create a secure server-side route for game-generated obligations.

Two obligation sources must exist:
- `source_kind='wager'`
- `source_kind='winner_nomination'`

Required metadata:
- `source_game='paardenrace'`
- `match_ref`
- `winner_player_id`
- `target_player_id`
- `selected_suit`

Do not fake cross-user drink creation from the browser.

## ELO And Stats

Integrate paardenrace into the existing multi-game ELO/stat system.

At minimum store:
- wins
- losses
- win %
- bakken_wagered
- bakken_received
- bakken_assigned
- nominations_made
- nominations_received
- average_wager
- average_total_bakken_owed
- favorite_suit
- suit_win_rate
- shared_wins
- solo_wins
- gate_setbacks_suffered
- unclaimed_finish_skips

Use `game_key='paardenrace'` where the current shared ELO system supports it.

## Frontend Flow Summary

1. load session and config
2. open setup modal if no active room
3. create or join room
4. submit wager and suit
5. auto-create self wager drink obligation
6. ready up
7. when all ready, show countdown
8. race stage begins
9. `Volgende kaart` calls server RPC
10. live board rerenders from authoritative state
11. if selected suit wins, open winner nomination flow
12. create winner nomination obligations
13. show final “Jij moet drinken: X Bakken” summary
14. persist match result + ELO + stats + live summary

## Acceptance Checklist

- shared room state works for multiple users
- multiple players can select the same suit
- unselected winning horse does not end the game
- first selected winning horse ends the race
- multiple winners are supported
- gate row aligns with the 10 race boxes
- start box and finish box exist as separate boxes
- actual ace cards are used as the horse pieces
- final personal drink amount is impossible to miss
- paardenrace appears in ladder, profiles, player pages, and admin

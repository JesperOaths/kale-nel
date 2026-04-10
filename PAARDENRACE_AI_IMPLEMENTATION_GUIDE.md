# Paardenrace — AI Implementation Guide (kale-nel-main)

This guide is written for a **new AI coding agent** that will implement the `paardenrace` live multiplayer game inside this existing repo.

It combines:
- the product/game rules (server-authoritative live state)
- the required site integrations (ladders, player pages, admin, drinks)
- the delivered visual assets (track + default face-down card back)
- concrete suggestions for how to code it in this repo’s style

---

## 0) Non‑Negotiables (Read First)

You MUST follow these repo constraints:

- **Plain HTML/CSS/JS only.** Do not introduce React, a bundler, Vite, or a new framework.
- **Supabase RPC + Postgres is authoritative.** The browser must never decide the next card or official match state.
- **Reuse existing patterns** (session/config/scope/scoped RPC/live-summary/ladder/player/profiles/admin/drinks). Do not create parallel auth or parallel stats pipelines.
- **Do not edit old SQL migrations in place.** Add a new migration file using the **next available** `gejast_vNNN_*.sql` number.

---

## 1) Repo Orientation (What To Inspect First)

Study these to match the site’s architecture:

- Config + session:
  - `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\gejast-config.js`
  - `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\gejast-player-session-ui.js`
  - `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\gejast-scoped-rpc.js` (client RPC helper)
  - `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\gejast-scope.js`
- Live summaries (homepage/live pages integration):
  - `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\gejast-live-sync.js`
  - `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\gejast-live-summary.js`
- Existing game pages for UI and session gating:
  - `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\beerpong.html`
  - `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\boerenbridge.html`
- Ladders / player pages / profiles:
  - `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\ladder.html`
  - `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\player.html`
  - `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\profiles.html`
- Admin match management:
  - `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\admin_match_control.html`
- Drinks workflow:
  - `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\gejast-drinks-workflow.js`
  - `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\drinks_add.html`
- Unified ELO/stat hub baseline:
  - `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\gejast_v125_stats_hub_elo.sql`

---

## 2) Visual Assets (Canonical Sources)

### 2.1 Track and Board Geometry

Use these assets for the paardenrace “race track” look:

- Polished track background (canvas export):  
  - `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\assets\paardenrace\paardenrace-track.png` (`1400x980`)
- Clean exact-layout reference (DOM + card placement):  
  - `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\assets\paardenrace\paardenrace-track-supplied-cards.png` (`1400x980`)
- Reference page that slices and centers cards (no overlap):  
  - `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\paardenrace_track_supplied_cards.html`

Board geometry (logical columns):
- column `0` = start box
- columns `1..10` = race boxes (steps)
- column `11` = finish box

Gate row:
- exactly 10 gate slots aligned to race columns `1..10` (not including start/finish).

### 2.2 Cards

**Canonical supplied card source (aces only):**
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\assets\paardenrace\paardenrace-cards-supplied.webp` (`1024x278`)

Preview (renders exact supplied sheet):
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\paardenrace_cards_supplied_exact.html`

**Canonical face-down back for ALL face-down cards** (gate + draw deck):
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\assets\paardenrace\paardenrace-card-back.png` (`420x600`)

Important note:
- The supplied sheet only contains the **ace horses**, not the full 52-card art.
- For drawn non-ace cards and revealed gate cards: render a clean stylized mini-card (rank + suit), not a fake crop.

### 2.3 Suit Mapping

Server/game suit keys should be:
- `hearts`
- `diamonds`
- `clubs`
- `spades`

For canonical card codes (deck), use:
- `AH`, `2H`, ..., `KH`
- `AD`, `2D`, ..., `KD`
- `AC`, `2C`, ..., `KC`
- `AS`, `2S`, ..., `KS`

---

## 3) Gameplay Rules (Authoritative)

Deck:
- Start with a standard 52-card deck.
- Remove the 4 aces first: these are the 4 horses.
- From remaining 48:
  - take 10 face-down “gate” cards = race steps 1..10
  - remaining 38 = draw deck

Board:
- Horses start at position `0` (start box).
- Each draw reveals the next draw-deck card (face up).
- Matching suit horse moves forward `+1`.

Gate rule (step `n`):
- Gate `n` reveals **exactly once** when **all 4 horses** have reached or passed step `n` (i.e. positions `>= n`).
- When a gate reveals: the horse matching that gate card’s suit moves back `-1`, minimum `0`.

Finish:
- The race continues until a horse crosses past step 10 (i.e. position `> 10`, or position `11` if you represent finish as its own cell).
- Track:
  - the **first horse to cross overall** (`first_finish_suit`)
  - the **first claimed/selected horse to cross** (`first_claimed_finish_suit`)

Important winning rule:
- If the first horse to cross has **no players** who selected that suit, **the game does not end**.
- Keep drawing until a suit with **>=1 selecting player** crosses. That suit is the winner suit.
- If multiple players selected the winner suit, **all are winners**.

---

## 4) Multiplayer / Lobby / Room Requirements

Create `paardenrace.html`:

Setup modal must block gameplay until user:
- enters integer wager in `Bakken`
- selects exactly 1 suit
- creates room or joins existing room

Room display must show live:
- room code
- joined players
- selected suit per player
- wager per player
- ready state per player
- game stage (lobby / countdown / race / nominations / finished)

Ready rules:
- A player can only ready up after selecting suit AND confirming wager.
- Do not enforce unique suit selection.
- Game starts only when **all joined players** are ready.
- Add a short countdown before first draw (server-driven).

---

## 5) Winner Nomination Flow (Winners Only)

After the first claimed suit crosses:
- determine winners = players whose selected suit == winner suit
- stage changes to `nominations`

Each winner gets **their own** nomination budget:
- `winner_nomination_budget_bakken = winner_wager_bakken * 2`

Nomination rules:
- whole-number Bakken only
- winners can nominate any participating player, including other winners
- **no self-nomination**
- winner must allocate **exactly** their full budget before they can submit

Room should show nomination progress live:
- which winners still need to nominate
- which winners already submitted
- final allocations after all winners are done

Store nomination rows explicitly, fields like:
- `match_ref`
- `winner_player_id`
- `winner_player_name`
- `target_player_id`
- `target_player_name`
- `bakken_assigned`

---

## 6) Drink Obligations Integration (Mandatory)

### 6.1 Required obligations

1) On room join / wager confirmation:
- create a pending drink request for the current player for their own wager amount.

2) At end of match (after nominations complete):
- create pending drink requests for all winner nominations.

### 6.2 Security requirement

- Do not “pretend to be another player” from the browser.
- If existing client-side drinks flow cannot reliably create game-generated obligations, implement a **secured server-side RPC** for game-generated drink obligations and call it from the client.

Metadata to attach to created drink events (jsonb recommended):
- `source_game='paardenrace'`
- `match_ref`
- `source_kind='wager' | 'winner_nomination'`
- `winner_player_id`
- `winner_player_name`
- `target_player_id`
- `target_player_name`
- `selected_suit`

---

## 7) End-of-Game UI Requirements (Clarity)

At end of match, show a very clear personal result panel for the logged-in user:
- **`Jij moet drinken: X Bakken`**

Breakdown:
- own starting wager
- extra Bakken received via nominations
- total Bakken owed

Also show a room summary list with for every participant:
- selected suit
- wager
- winner status
- extra Bakken assigned to them
- total Bakken owed

Winner UI must be impossible to miss and must show:
- remaining budget
- allocated budget
- target players
- confirm action that only unlocks when budget is exactly allocated

---

## 8) Live Synchronization (Do Not Cheat)

All players in same room must see the same:
- shuffled deck order
- gate card order
- revealed draw cards / draw index
- revealed gate cards
- horse positions
- room players + selected suits + wagers + readiness
- countdown state
- winner state
- nomination state and submitted allocations

**Client MUST NOT compute official next card/state.**

Server authoritative means:
- shuffle is done on server and persisted per match
- draw progression is a single atomic RPC (`Volgende kaart`)
- gate reveals happen in the same transaction
- winner is set once
- each winner can submit nominations exactly once

Realtime strategy:
- Prefer Supabase Realtime on the match/room row if practical.
- If not, poll the read-state RPC (turn-based; polling is acceptable).

---

## 9) Database + RPC Design (Suggested)

### 9.1 Tables (suggested minimum)

Create new tables (names can follow existing conventions, but keep them paardenrace-specific):

- `paardenrace_rooms`
- `paardenrace_room_players`
- `paardenrace_matches`
- `paardenrace_match_events` (optional but helps audits/rebuilds)
- `paardenrace_match_nominations`

Recommended columns (examples, adjust to repo conventions + scope patterns):

`paardenrace_rooms`
- `room_id uuid primary key default gen_random_uuid()`
- `site_scope text not null`
- `room_code text not null` (unique per scope)
- `status text not null` (`lobby|countdown|race|nominations|finished`)
- `active_match_ref uuid null`
- timestamps + created_by

`paardenrace_room_players`
- `room_id uuid references paardenrace_rooms(room_id)`
- `player_id uuid not null` (auth uid)
- `player_name text not null`
- `selected_suit text null` (check constraint to 4 suits)
- `wager_bakken int null`
- `ready boolean not null default false`
- timestamps (joined/updated)

`paardenrace_matches`
- `match_ref uuid primary key default gen_random_uuid()`
- `site_scope text not null`
- `room_id uuid references paardenrace_rooms(room_id)`
- `status text not null` (`race|nominations|finished`)
- `deck jsonb not null` (array of canonical card codes)
- `gate_cards jsonb not null` (10 card codes)
- `draw_deck jsonb not null` (38 card codes)
- `draw_index int not null default 0`
- `last_drawn_card text null`
- `horse_positions jsonb not null` (e.g. `{hearts:0,...}`)
- `revealed_gate_cards jsonb not null` (length 10, null or card code)
- `first_finish_suit text null`
- `first_claimed_finish_suit text null`
- `winner_suit text null`
- `winner_player_ids jsonb not null default '[]'::jsonb`
- `nominations_complete boolean not null default false`
- timestamps

`paardenrace_match_nominations`
- `match_ref uuid references paardenrace_matches(match_ref)`
- `winner_player_id uuid not null`
- `winner_player_name text not null`
- `target_player_id uuid not null`
- `target_player_name text not null`
- `bakken_assigned int not null check (bakken_assigned >= 0)`
- timestamps

### 9.2 RPCs (minimum set)

Implement RPCs that the browser can call using `GEJAST_SCOPED_RPC.callRpc(...)`.

Must-have:
- `paardenrace_create_room_scoped`
- `paardenrace_join_room_scoped`
- `paardenrace_update_selection_scoped` (suit + wager)
- `paardenrace_set_ready_scoped`
- `paardenrace_start_if_ready_scoped` (or fold into ready RPC)
- `paardenrace_draw_next_card_scoped`
- `paardenrace_submit_nominations_scoped`
- `paardenrace_get_room_state_scoped`

Also likely needed:
- `paardenrace_create_game_drink_obligations_scoped` (if you cannot reuse existing drinks RPC securely)
- any stats/ladder RPCs required by `ladder.html`, `player.html`, `profiles.html`

### 9.3 Transactional draw logic (server)

`paardenrace_draw_next_card_scoped(room_code, session_token, site_scope_input)` should:

1) lock the room and match rows
2) validate match is in `race` stage
3) take the next draw card from `draw_deck[draw_index]`
4) update matching horse `+1`
5) increment draw_index + set last_drawn_card
6) check for any gates that should reveal (in order), revealing each at most once
7) apply gate setback `-1` for matching suit, min 0
8) if any horse crosses (>10), write:
   - `first_finish_suit` once
   - track “finished suits” (optional)
   - if crossed suit has >=1 selector and `first_claimed_finish_suit` is null:
     - set winner suit and winner players
     - switch room/match status to `nominations`
9) return the full room state snapshot

Concurrency:
- do not allow double-draw (use `FOR UPDATE` row locks + single authoritative counter).

### 9.4 Room state snapshot

Your read RPC (`paardenrace_get_room_state_scoped`) should return one JSON payload containing:
- room header (code, status, active_match_ref)
- ordered players
- match state (deck progress, gate reveals, horse positions, winner info, nominations progress)
- (optional) precomputed per-player totals for end-of-match summary

Keep the JSON structure stable; the client should be mostly a renderer.

---

## 10) Live Summary Integration (Homepage + Spectator)

Use existing live-summary hub:
- Write summaries via `save_game_match_summary_scoped` (client helper: `GEJAST_LIVE_SYNC.writeSummary(...)`).
- Read summaries via `get_live_match_summary_public_scoped` (client helper: `GEJAST_LIVE_SUMMARY.loadPublicSummary(...)`).

For paardenrace, the summary payload should include at least:
- room info + participants
- selected suits + wagers
- deck progress, revealed draw/gate cards
- horse positions
- `first_finish_suit`
- `first_claimed_finish_suit`
- winners
- nominations progress / allocations
- final Bakken obligations per player

Recommendation:
- On every authoritative RPC response (join/ready/start/draw/nominate), the client writes a deduped summary payload derived from the server-returned state (not client-invented).

---

## 11) ELO / Ladder / Stats Integration (Unified)

Goal:
- paardenrace must plug into existing “unified” systems.
- prefer `game_elo_ratings` and `game_elo_history` with `game_key='paardenrace'`.

You must ensure:
- `ladder.html?game=paardenrace` works
- homepage top ladders can include paardenrace
- `player.html` shows paardenrace rating/history/stats
- `profiles.html` shows paardenrace stats/match counts (where applicable)
- `admin_match_control.html` can filter/manage paardenrace matches

Implementation approach:
- after match completes, compute winners/losers and submit ELO updates using the same RPC patterns used by other games
- store match stats in the same shared stats hub tables/functions, or add paardenrace-specific stats tables and expose them via existing unified public RPCs

Stats minimum (from product brief):
- wins, losses, win%
- Bakken wagered / received / assigned
- nominations made / received
- average wager
- average total Bakken owed per match
- favorite suit, suit picked most often
- wins by suit, win rate by suit
- shared wins / solo wins
- unclaimed-finish skips
- gate setbacks suffered
- horse led most steps
- comeback wins, wire-to-wire wins

---

## 12) Frontend Pages To Add

Create:
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\paardenrace.html` (main game room)
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\paardenrace_live.html` (spectator/live)
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\paardenrace_stats.html` (richer stats)

Recommended JS split:
- `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\gejast-paardenrace.js` (page logic + renderer + RPC calls)

Rendering suggestion:
- DOM for all text/UI/flows (setup modal, players list, ready, countdown, nominations, final results).
- Canvas for board visual (track + cards + simple animations).

Default canvas resolution:
- treat `1400x980` as the “design coordinate system”
- scale to fit the page container (use `devicePixelRatio` for crisp output)

---

## 13) REQUIRED Homepage Button Placement (index.html)

The implementing AI MUST update the homepage to add:

1) A new box/button for **Paardenrace**:
- place it **under** “Beerpong Invoeren”
- and **above** “Balzaal”

2) A **placeholder** box/button right next to it:
- place it **under** “Spelers”
- in the same row as the paardenrace button

Where:
- In `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\index.html`, locate the `public-links-grid` row that contains:
  - “Beerpong Invoeren” (left)
  - “Spelers” (right)
  - (around `index.html:734`)
- Insert a new `public-links-grid` row directly after it, and before the “Balzaal” block (around `index.html:745`).

The left new card should link to `./paardenrace.html`.
The right card should be a placeholder (label like “Binnenkort” or similar; it can be non-clickable or link to `#`).

Suggested HTML to insert (match existing `page-link-card` style):

```html
<div class="public-links-grid">
  <a class="page-link-card" href="./paardenrace.html">
    <div class="page-link-label">Paardenrace</div>
    <div class="page-link-copy plus-copy">
      <img class="page-link-plus" src="./plus-icon.png" alt="Plus" />
    </div>
  </a>
  <a class="page-link-card" href="#" aria-disabled="true" style="pointer-events:none;opacity:0.72;">
    <div class="page-link-label">Binnenkort</div>
    <div class="page-link-copy">Nog een spel volgt.</div>
  </a>
</div>
```

---

## 14) Integration Touchpoints Checklist

When you implement the full feature, update:

- `index.html` (new paardenrace button + placeholder as described above)
- `ladder.html` (support `game=paardenrace`)
- `player.html` (show paardenrace)
- `profiles.html` (show paardenrace)
- `admin_match_control.html` (filter + manage paardenrace)
- any unified RPCs that enumerate supported games for ladders/homepage/player insights

---

## 15) Implementation Sequence (Recommended)

1) **DB migration**
   - add paardenrace tables + RPCs + RLS/policies
   - ensure all writes are server-authoritative + transactional
2) **Room/lobby frontend (`paardenrace.html`)**
   - suit selection + wager + ready + countdown
3) **Race engine**
   - `Volgende kaart` calls draw RPC; render returned state only
4) **Nominations UI**
   - winner-only; strict budget validation; submit once
5) **Drink obligations**
   - wager obligation on confirm
   - nomination obligations at end
6) **Match finalization**
   - write summary payload + ELO + stats
7) **Site integration**
   - index buttons, ladder, player, profiles, admin match control
8) **Multi-user test**
   - two browsers; confirm no desync; confirm no double-draw; confirm unclaimed-finish skip rule

---

## 16) Acceptance Criteria (Must Pass)

- 2+ logged-in users in same room see identical state.
- Multiple players can pick same suit.
- One shared server-generated shuffle per match.
- `Volgende kaart` advances exactly 1 global card per press.
- Gate cards reveal exactly once and only at correct threshold.
- If an unselected suit crosses first, match continues.
- Match ends only when a selected suit crosses.
- Multiple winners supported.
- Each winner has independent exact nomination budget.
- Winners can nominate other winners; cannot self-nominate.
- Everyone gets clear final “Jij moet drinken: X Bakken” panel + breakdown.
- Wager obligations created automatically.
- Winner nomination obligations created automatically.
- `ladder.html?game=paardenrace` works.
- Homepage + player pages + profiles + admin include paardenrace.
- Visuals are readable, non-overlapping, and match the delivered assets.

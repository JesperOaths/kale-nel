# GEJAST v710 — ELO Prediction Integration Plan

Status: PLAN ONLY. Do not execute this in the v710 repair patch.

## 1. Goal

Add visible pre-game / live-game win prediction surfaces without moving game truth into the browser.

The correct ownership chain stays:

`page.html -> helper/runtime JS -> Supabase RPC -> SQL function/view/table/policy -> stored truth -> page/admin verification surface`

Predictions should be derived from stored ELO/rating truth and current lobby participants. The browser may render the result, but may not own the calculation as canonical truth.

## 2. Canonical backend contract

Create one shared RPC:

```sql
get_game_win_prediction_public_v710(
  game_key_input text,
  participant_names_input text[],
  site_scope_input text default 'friends',
  context_input jsonb default '{}'::jsonb
) returns jsonb
```

Expected output:

```json
{
  "ok": true,
  "game_key": "pikken",
  "site_scope": "friends",
  "model_version": "elo_v710_baseline",
  "participants": [
    {
      "player_name": "Name",
      "rating": 1042,
      "rating_source": "game_elo_ratings_scoped",
      "win_probability": 0.41,
      "confidence": "medium",
      "notes": ["rating known", "small sample"]
    }
  ],
  "summary": "Name is slight favourite at 41%.",
  "warnings": []
}
```

## 3. SQL data sources

Use existing rating/storage sources in this order:

1. `game_elo_ratings_scoped` for `klaverjas`, `boerenbridge`, and shared game ELO where available.
2. Pikken stats/rating table once the v709 Pikken archive/stats flow is verified.
3. Paardenrace ladder/stats table once wager/race completion writes are verified.
4. Game-specific fallback ratings only if the canonical scoped ELO table has no row.
5. Default rating = 1000 only for unknown players, explicitly marked as low-confidence.

Do not infer ratings from profile display cards or localStorage.

## 4. Probability model

For two-player/team games:

```txt
expected_a = 1 / (1 + 10 ^ ((rating_b - rating_a) / 400))
```

For multi-player games:

```txt
strength_i = 10 ^ (rating_i / 400)
probability_i = strength_i / sum(strength_all)
```

For team games:

```txt
team_rating = average(team player ratings)
```

For games with strong randomness, cap certainty:

```txt
Pikken: clamp probability to 18%..55% before normalization when >= 3 players
Paardenrace: clamp probability to 15%..50% before normalization when >= 3 players
```

This keeps the prediction playful and avoids pretending random/luck-heavy games are deterministic.

## 5. Page integration order

### Phase A — backend only

- Add `get_game_win_prediction_public_v710`.
- Add helper SQL `_gejast_prediction_rating_for_player_v710(game_key, player_name, scope)`.
- Add helper SQL `_gejast_prediction_multiplayer_v710(rows jsonb)`.
- Grant execute to anon/authenticated only for the public prediction RPC.
- Add no frontend yet.

### Phase B — shared frontend helper

Create:

```txt
gejast-game-predictions.js
```

Responsibilities:

- read visible lobby/live participants from page state supplied by each game helper;
- call the prediction RPC;
- render a small prediction card;
- cache only display payload for a short TTL;
- never mutate game state.

### Phase C — page-by-page rollout

1. `pikken.html`
   - Show prediction once a lobby has at least 2 players.
   - Recompute when players join/leave/ready state changes.
   - Label as "Kans volgens ELO + Pikkenhistorie".

2. `pikken_live.html`
   - Show a compact prediction strip near the sticky action dock.
   - Update only at round boundaries, not every 1.2s poll.
   - Do not cover dice hand or bid/reject controls.

3. `paardenrace.html`
   - Show prediction after all players locked suit+wager.
   - Include a note that suit choice/wager does not equal skill prediction unless Paardenrace stats exist.

4. `paardenrace_live.html`
   - Show prediction before countdown/race start only.
   - Once race starts, switch to live race odds only if a separate race-position model is built later.

5. `klaverjas.html` / `klaverjas_live.html`
   - Show team-vs-team expected win rate after four players/teams are selected.
   - Use team average ELO.

6. `boerenbridge.html` / live page
   - Show multi-player probabilities after participants are selected.
   - Use multi-player rating strength normalization.

7. `beerpong.html`
   - Show team prediction using beerpong ratings if table exists; otherwise shared game ELO.

8. `profiles.html`
   - Add a non-interactive "prediction input" explanation only later, not in first rollout.

## 6. UX rules

- The card must be small, playful, and clearly labelled as prediction.
- Never say "will win"; say "favoriet", "kans", or "verwachting".
- Show confidence: low / medium / high.
- Explain low confidence when players have few matches.
- Hide prediction if fewer than two participants are known.
- Do not show prediction when RPC fails; show no noisy error unless in admin/debug.

## 7. Testing checklist

- Unknown player defaults to 1000 and low confidence.
- Family/friends scope does not leak ratings across scopes.
- Two-player expected probabilities sum to 100%.
- Multi-player probabilities sum to 100% after rounding.
- Team game uses team averages.
- Pikken live page does not move or cover action dock.
- Paardenrace input fields are not overwritten by prediction refresh.
- Prediction refresh does not run every live polling tick.
- Admin/rebuild ELO changes are reflected after cache expiry.

## 8. Do not do yet

- Do not add betting or Despimarkt markets from predictions yet.
- Do not add public observability scripts.
- Do not calculate canonical prediction entirely in browser.
- Do not integrate before the v709/v710 repair line is live-tested.

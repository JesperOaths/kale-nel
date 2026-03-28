# Game data note v133

## Canonical storage after foundation reset
- `game_match_summaries`: shared recap/profile surface for klaverjas, boerenbridge, beerpong
- `klaverjas_matches`: canonical klaverjas match store from `save_game_match_summary(...)`
- `klaverjas_player_ratings` + `klaverjas_player_rating_history` + `klaverjas_player_stats`
- `boerenbridge_matches`: canonical boerenbridge payload/raw payload/totals/rounds store from `save_boerenbridge_match(...)`
- `boerenbridge_player_ratings` + `boerenbridge_player_rating_history` + `boerenbridge_player_stats`
- `beerpong_matches`: canonical beerpong match store from `save_beerpong_match(...)`
- `beerpong_player_ratings` + `beerpong_player_rating_history` + `beerpong_player_stats`

## Data retention rule
Keep both normalized columns and raw payload JSON where available.
Do not throw away useful match input data unless it is provably redundant.

## Current frontend compatibility assumptions
- Klaverjas submits summary payload with players, totals, rounds, recap
- Boerenbridge submits full match payload with participants/players, rounds, totals, analytics snapshot, raw payload
- Beerpong submits player ids and player names, winner team, cups left, cups hit

## Why this matters
Every stat feature later depends on canonical match history being rich enough to rebuild ratings, trends, matchup stats, partner stats, and player pages without guessing.

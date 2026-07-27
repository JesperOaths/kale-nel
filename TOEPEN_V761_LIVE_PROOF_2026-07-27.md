# Toepen v761 live proof — 2026-07-27

Production project: `jas-site`  
Frontend version: `v761`  
Branch: `agent/v761-production-completion`  
Secrets policy: no PINs, session tokens, admin tokens, or TOTP values recorded.

## SQL forward fixes applied

- `GEJAST_v755d_toepen_creator_scope_guard.sql`
  - Requires the saving player session scope to match `site_scope_input`.
  - Requires the saving player to be one of the Toepen participants.
- `GEJAST_v755e_admin_reset_login_player_pin_compat.sql`
  - Restores missing `admin_reset_login_player_pin_v678(text,text,text,text)` compatibility target used by live v679/v680/v681 wrappers.
  - Used only to create temporary beta accounts with generated one-time PINs retained in memory for the test run.
- `GEJAST_v755f_login_session_bridge.sql`
  - Makes `_gejast_player_from_session(text)` recognise canonical `login_player` sessions stored in `public.sessions.session_token_hash`.

## Temporary accounts

Created through authenticated admin session using `admin_reset_login_player_pin_v681`, then logged in through normal `login_player(input_username, entered_pin)` RPC.

| Scope | Name | Player ID | Session proof |
|---|---|---:|---|
| friends | `AutoV761ToepFriendsA_202607270115` | 155 | canonical session obtained, token not recorded |
| friends | `AutoV761ToepFriendsB_202607270115` | 156 | canonical session obtained, token not recorded |
| family | `AutoV761ToepFamilyA_202607270115` | 157 | canonical session obtained, token not recorded |
| family | `AutoV761ToepFamilyB_202607270115` | 158 | canonical session obtained, token not recorded |

Earlier failed setup attempt also created temp players `151–154`; these were included in cleanup.

## Controlled Toepen saves

Each controlled game included a toep (`stake_final=2`) and a fold (`action='fold'`, `folded_at_stake=1`), then a finishing round.

| Scope | Client match ID | Game ID | First save | Identical retry/idempotency | History | Vault |
|---|---|---:|---|---|---|---|
| friends | `v761-toepen-friends-202607270115-w2i5h8` | 1 | ok, `already_saved=false` | ok, `already_saved=true`, same game ID | present | present |
| family | `v761-toepen-family-202607270115-zspece` | 2 | ok, `already_saved=false` | ok, `already_saved=true`, same game ID | present | present |

## Vault/stat proof

Authenticated admin vault access succeeded for both scopes.

Friends vault stats:

- `AutoV761ToepFriendsA_202607270115`: games played `1`, games won `1`, folds `0`, stay losses `0`, rounds won `2`.
- `AutoV761ToepFriendsB_202607270115`: games played `1`, games won `0`, folds `1`, stay losses `1`, rounds won `0`.

Family vault stats:

- `AutoV761ToepFamilyA_202607270115`: games played `1`, games won `1`, folds `0`, stay losses `0`, rounds won `2`.
- `AutoV761ToepFamilyB_202607270115`: games played `1`, games won `0`, folds `1`, stay losses `1`, rounds won `0`.

Invalid admin vault request rejected with `Geen geldige adminsessie.`

## Negative/isolation proof

- Invalid player token save rejected with `Niet ingelogd.`
- Wrong-player save rejected with `Alleen een deelnemer mag dit Toepen-potje opslaan.`
- Friends player saving family scope rejected with `Verkeerde Toepen-scope voor deze speler.`
- Friends token reading family scope returned `0` controlled games.
- Family token reading friends scope returned `0` controlled games.

## Cleanup evidence

Cleanup query targeted only:

- `public.toepen_games` with `client_match_id like 'v761-toepen-%'` or participants matching `AutoV761Toep%`.
- `public.sessions` for temp players.
- `public.players` matching `AutoV761Toep%` for deactivation and secret clearing.

Cleanup result:

- Temp players before cleanup: `8`.
- Controlled Toepen games before cleanup: `2`.
- Controlled Toepen participants before cleanup: `4`.
- Deleted controlled Toepen games: `2`.
- Deleted client match IDs:
  - `v761-toepen-family-202607270115-zspece`
  - `v761-toepen-friends-202607270115-w2i5h8`
- Post-cleanup controlled Toepen games remaining: `0`.
- Post-cleanup controlled Toepen participants remaining: `0`.
- Post-cleanup temp public sessions remaining: `0`.
- Post-cleanup temp players still active/approved/with PIN/session material: `0`.

Deactivated/cleared temp players:

- IDs `151–158`, all `active=false`, `approved=false`, `pin_cleared=true`, `session_token_cleared=true`.

## Result

Toepen backend exit gate passed for both friends and family scopes. Controlled data was cleaned up; unrelated production records were not targeted or modified.

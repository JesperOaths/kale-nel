# Migrations Applied

## Production observed/applied before this branch
- v756 SQL-only homepage-ladder compatibility hotfix reported applied before this continuation. It repaired homepage ladder public functions failing on 
.rating when production rows expose elo_rating.

## Applied 2026-07-26
- `GEJAST_v757_paardenrace_session_name_compat.sql` — applied through Supabase SQL Editor to production `jas-site`. Repairs `_gejast_name_for_session(text)` so canonical player sessions fall through to `get_jas_app_state` when earlier state RPCs return null names.
- `GEJAST_v757b_paardenrace_player_id_compat.sql` — applied through Supabase SQL Editor to production `jas-site`. Repairs `_paardenrace_player_id(text,text)` to prefer canonical v746 player sessions and fall back safely.
- Proof immediately after apply: `account_login_v687` Beta1 returned canonical session; `create_paardenrace_room_fast_v687` succeeded for `DESPINOZA 11`; cleanup via `disband_paardenrace_room_fast_v687` succeeded.

## Candidate migrations not yet applied in this session
- GEJAST_v755_toepen_backend.sql — dedicated Toepen backend lane. Rechecked during the 2026-07-26 deployment-proof audit; still pending safe production apply/proof. Do not run destructively and do not combine with unrelated deployment/cache work.

## Rule
SQL remains separate from frontend code. Record every future apply with timestamp, actor/tool, statements/file, function signatures, grants/RLS proof, PostgREST reload proof, controlled IDs, cleanup evidence, and rollback notes.

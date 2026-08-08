import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const migration = readFileSync('GEJAST_v755p_beerpong_save_auth_guard.sql', 'utf8');
const rollback = readFileSync('GEJAST_v755p_beerpong_save_auth_guard_ROLLBACK.sql', 'utf8');
const frontend = readFileSync('beerpong.html', 'utf8');
const harness = readFileSync('scripts/matrix-harness.mjs', 'utf8');

function bodyWithoutRevokes(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*revoke\b/i.test(line) && !/^\s*grant\b/i.test(line))
    .join('\n');
}

for (const [name, text] of [['migration', migration], ['rollback', rollback]]) {
  assert.match(text, /create or replace function public\.save_beerpong_match\(\s*session_token text default null,\s*client_match_id text default null,\s*payload jsonb default '\{\}'::jsonb\s*\)/s, `${name}: preserves public save_beerpong_match signature`);
  assert.match(text, /if nullif\(trim\(coalesce\(save_beerpong_match\.session_token, ''\)\), ''\) is null then\s*raise exception 'Niet ingelogd\.'/s, `${name}: missing session rejected`);
  assert.match(text, /_tier3_player_from_any_session_v740\(save_beerpong_match\.session_token\)/, `${name}: uses deployed session resolver`);
  assert.match(text, /if p\.id is null then\s*raise exception 'Niet ingelogd\.'/s, `${name}: invalid session resolver result rejected`);
  assert.match(text, /v_match\.created_by_player_id is null or v_match\.created_by_player_id <> p\.id/s, `${name}: rejects null or different owner on existing client_match_id`);
  assert.match(text, /beerpong_match_owner_mismatch/, `${name}: explicit owner mismatch error`);
  assert.match(text, /revoke all on function public\.save_beerpong_match\(text, text, jsonb\) from public;/i, `${name}: PUBLIC execute revoked explicitly`);
  assert.match(text, /grant execute on function public\.save_beerpong_match\(text, text, jsonb\) to anon, authenticated;/i, `${name}: web roles retain RPC execute`);
  assert.match(text, /revoke insert, update, delete on table public\.beerpong_matches from public, anon, authenticated;/i, `${name}: direct beerpong_matches DML revoked`);
  assert.match(text, /revoke insert, update, delete on table public\.beerpong_player_ratings from public, anon, authenticated;/i, `${name}: direct rating DML revoked`);
  assert.match(text, /beerpong_player_rating_history/, `${name}: current rating history table referenced`);
  assert.match(text, /v_existing boolean := false;/, `${name}: tracks existing-vs-new before returning already_saved`);
  assert.match(text, /v_existing := v_match\.id is not null;/, `${name}: computes already_saved before insert/update result replaces row`);
  assert.doesNotMatch(text, /AcA|�/, `${name}: no Beerpong SQL mojibake markers`);
  assert.match(text, /nullif\(v_payload->>'match_format',''\), nullif\(v_payload->>'format',''\)/, `${name}: canonicalizes match_format and frontend format`);
  assert.match(text, /coalesce\(v_payload->>'team_a_cups_left', v_payload->>'cups_left_team_a'\)/, `${name}: canonicalizes team A cups aliases`);
  assert.match(text, /coalesce\(v_payload->>'team_b_cups_left', v_payload->>'cups_left_team_b'\)/, `${name}: canonicalizes team B cups aliases`);
  assert.match(text, /if v_match_format = '1v1'[\s\S]*<> 1[\s\S]*Bij 1v1/s, `${name}: validates 1v1 team sizes`);
  assert.match(text, /else[\s\S]*<> 2[\s\S]*Bij 2v2/s, `${name}: validates 2v2 team sizes`);
  assert.match(text, /winner_team ongeldig/, `${name}: validates winner`);
  assert.match(text, /join unnest\(v_team_b\) b on lower\(trim\(a\)\) = lower\(trim\(b\)\)/, `${name}: rejects cross-team duplicate player names`);
  assert.match(text, /team_a_player_names/s, `${name}: uses current player-name Beerpong schema`);
  assert.doesNotMatch(text, /team_a_player_ids\s*=/, `${name}: does not use old player-id rating schema updates`);
  assert.doesNotMatch(text, /player_id\)\s*values/s, `${name}: does not insert old player-id rating rows`);
  assert.match(text, /'ratings_applied', false/, `${name}: preserves current ratings_applied=false contract`);
}

const migrationBody = bodyWithoutRevokes(migration);
assert.doesNotMatch(migrationBody, /rebuild_beerpong_ratings\s*\(/i, 'migration must not invoke Beerpong rating rebuild');
assert.doesNotMatch(migrationBody, /insert\s+into\s+public\.beerpong_player_ratings/i, 'migration must not insert rating rows');
assert.doesNotMatch(migrationBody, /update\s+public\.beerpong_player_ratings/i, 'migration must not update rating rows');
assert.doesNotMatch(migrationBody, /delete\s+from\s+public\.beerpong_player_ratings/i, 'migration must not delete rating rows');
assert.doesNotMatch(migrationBody, /insert\s+into\s+public\.beerpong_player_rating_history/i, 'migration must not insert rating history');
assert.doesNotMatch(migrationBody, /update\s+public\.beerpong_player_rating_history/i, 'migration must not update rating history');
assert.doesNotMatch(migrationBody, /delete\s+from\s+public\.beerpong_player_rating_history/i, 'migration must not delete rating history');
assert.doesNotMatch(migration, /ratings_rebuilt/, 'migration must not report rating rebuild');

assert.match(frontend, /const payload = \{[^}]*submitter_meta:getSubmitterMeta\(\),\s*status:'finished', format,/s, 'frontend still sends format field');
assert.match(frontend, /sb\.rpc\('save_beerpong_match', \{ session_token: getSessionToken\(\) \|\| null, client_match_id: clientMatchId, payload \}\)/, 'frontend active caller still uses save_beerpong_match');
assert.match(migration, /'already_saved', v_existing/s, 'migration reports replay state from pre-write lookup');
assert.match(rollback, /ratings_disabled_by_forward_fix/s, 'rollback remains forward-fix fallback, not vulnerable restore');
assert.doesNotMatch(rollback, /where m\.id = v_existing\s+returning m\.id/s, 'rollback does not restore ownerless v740 update');
assert.match(harness, /beerpong_player_ratings/, 'matrix harness tracks current Beerpong rating table');
assert.match(harness, /beerpong_player_rating_history/, 'matrix harness tracks current Beerpong rating history table');
assert.doesNotMatch(harness, /beerpong_match_players|beerpong_rating_history/, 'matrix harness does not track nonexistent Beerpong tables');

console.log('PASS Beerpong v755p save auth guard static contract');

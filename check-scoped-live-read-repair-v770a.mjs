#!/usr/bin/env node
import fs from 'node:fs';

const sql = fs.readFileSync('GEJAST_v770a_scoped_live_read_repair.sql', 'utf8');
const rollback = fs.readFileSync('GEJAST_v770a_scoped_live_read_repair_ROLLBACK.sql', 'utf8');
const frontend = fs.readFileSync('gejast-live-summary.js', 'utf8');
const failures = [];

function requireText(text, label) {
  if (!sql.includes(text)) failures.push(`migration missing ${label}`);
}
function requireRollback(text, label) {
  if (!rollback.includes(text)) failures.push(`rollback missing ${label}`);
}

const forbidden = [
  /\binsert\s+into\b/i,
  /\bupdate\s+(?:public\.)?[a-z_]/i,
  /\bdelete\s+from\b/i,
  /\btruncate\b/i,
  /\balter\s+table\b/i,
  /\bcreate\s+table\b/i,
  /\bdrop\s+table\b/i,
];
for (const pattern of forbidden) {
  if (pattern.test(sql)) failures.push(`migration contains forbidden data/table mutation: ${pattern}`);
}

requireText("to_regprocedure('public._gejast_live_scope_norm_v352(text)')", 'scope normalizer dependency guard');
requireText("to_regprocedure('public._gejast_live_surface_rows_v352(text,boolean)')", 'read-only scoped row helper dependency guard');
requireText("to_regprocedure('public._gejast_name_for_session(text)')", 'session-name dependency guard');
requireText("to_regprocedure('public._name_in_site_scope(text,text)')", 'identity scope dependency guard');

requireText('drop function if exists public.get_live_match_summary_public_scoped(text);', 'old one-argument summary stub removal');
requireText('get_live_match_summary_public_scoped(\n  game_type_input text,', 'current summary signature');
requireText('from public._gejast_live_surface_rows_v352(v_scope, true) r', 'scope-filtered summary source');
requireText("'site_scope', r.site_scope", 'summary scope in result');
requireText("'item', v_item", 'frontend item envelope');

requireText('drop function if exists public.get_homepage_live_state_public_scoped(text);', 'old one-argument homepage stub removal');
requireText('get_homepage_live_state_public_scoped(\n  session_token text default null,', 'current homepage signature');
requireText('public._name_in_site_scope(v_viewer_name, v_scope)', 'homepage cross-scope identity guard');
requireText('from public._gejast_live_surface_rows_v352(v_scope, false) r', 'scope-filtered homepage source');
requireText("'entries', jsonb_build_object(", 'homepage entries result');
requireText("'by_game', jsonb_build_object(", 'homepage by_game compatibility result');

if (/\bget_live_match_summary_public\s*\(/i.test(sql)) failures.push('migration must not forward scoped summary reads to the legacy unscoped RPC');
if (/\bget_homepage_live_state_public\s*\(/i.test(sql)) failures.push('migration must not forward scoped homepage reads to the legacy unscoped RPC');

requireText('revoke all on function public.get_live_match_summary_public_scoped(text,text,text,text) from public;', 'summary PUBLIC revoke');
requireText('grant execute on function public.get_live_match_summary_public_scoped(text,text,text,text) to anon, authenticated;', 'summary web-role grant');
requireText('revoke all on function public.get_homepage_live_state_public_scoped(text,text) from public;', 'homepage PUBLIC revoke');
requireText('grant execute on function public.get_homepage_live_state_public_scoped(text,text) to anon, authenticated;', 'homepage web-role grant');

if (!frontend.includes('get_live_match_summary_public_scoped')) failures.push('frontend no longer calls scoped summary RPC');
for (const arg of ['game_type_input', 'match_ref_input', 'client_match_id_input', 'site_scope_input']) {
  if (!frontend.includes(arg)) failures.push(`frontend scoped summary contract missing ${arg}`);
}
if (!frontend.includes('get_homepage_live_state_public_scoped')) failures.push('frontend no longer calls scoped homepage RPC');
if (!frontend.includes("JSON.stringify({ session_token: token || null, site_scope_input: useScope })")) failures.push('frontend scoped homepage call shape changed');

requireRollback('drop function if exists public.get_live_match_summary_public_scoped(text,text,text,text);', 'new summary overload removal');
requireRollback("get_live_match_summary_public_scoped(\n  site_scope_input text default 'friends'", 'v690 summary stub restore');
requireRollback('drop function if exists public.get_homepage_live_state_public_scoped(text,text);', 'new homepage overload removal');
requireRollback("get_homepage_live_state_public_scoped(\n  site_scope_input text default 'friends'", 'v690 homepage stub restore');

if (failures.length) {
  console.error('v770a scoped live read repair regression FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('v770a scoped live read repair regression PASS.');

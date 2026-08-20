#!/usr/bin/env node
import fs from 'node:fs';

const migrationPath = 'sql/GEJAST_v812a_visual_warning_cleanup_contracts.sql';
const refinerPath = 'scripts/refine-benign-visual-aborts-v813.mjs';
const workflowPath = '.github/workflows/full-live-visual-audit-v792.yml';

for (const file of [migrationPath, refinerPath, workflowPath]) {
  if (!fs.existsSync(file)) throw new Error(`V813_VISUAL_WARNING_CLEANUP_FAIL missing ${file}`);
}

const sql = fs.readFileSync(migrationPath, 'utf8');
const refiner = fs.readFileSync(refinerPath, 'utf8');
const workflow = fs.readFileSync(workflowPath, 'utf8');

function requireMatch(text, regex, label) {
  if (!regex.test(text)) throw new Error(`V813_VISUAL_WARNING_CLEANUP_FAIL ${label}`);
}
function forbidMatch(text, regex, label) {
  if (regex.test(text)) throw new Error(`V813_VISUAL_WARNING_CLEANUP_FAIL ${label}`);
}

requireMatch(sql, /revoke execute on function public\.cleanup_stale_paardenrace_rooms_v718\(text\) from public, anon, authenticated;/i, 'Paardenrace v718 must remain browser-inaccessible');
requireMatch(sql, /revoke execute on function public\.cleanup_stale_pikken_rooms_v718\(text\) from public, anon, authenticated;/i, 'Pikken v718 must remain browser-inaccessible');
requireMatch(sql, /grant execute on function public\.cleanup_stale_paardenrace_rooms_v718\(text\) to service_role;/i, 'Paardenrace v718 service role grant missing');
requireMatch(sql, /grant execute on function public\.cleanup_stale_pikken_rooms_v718\(text\) to service_role;/i, 'Pikken v718 service role grant missing');
requireMatch(sql, /create function public\.cleanup_stale_paardenrace_rooms_v706[\s\S]+?security invoker[\s\S]+?'v812a_client_noop'/i, 'Paardenrace v706 safe compatibility contract missing');
requireMatch(sql, /create or replace function public\.cleanup_stale_pikken_rooms_v706[\s\S]+?security invoker[\s\S]+?'v812a_client_noop'/i, 'Pikken v706 safe compatibility contract missing');
requireMatch(sql, /create function public\.paardenrace_cleanup_idle_lobbies_v495[\s\S]+?security invoker[\s\S]+?'v812a_client_noop'/i, 'Paardenrace v495 safe compatibility contract missing');
forbidMatch(sql, /grant execute on function public\.cleanup_stale_(?:paardenrace|pikken)_rooms_v718\(text\) to [^;]*(?:anon|authenticated)/i, 'v718 mutation grant widened to a browser role');

for (const route of ['boerenbridge_spectator.html','despimarkt_force.html','klaverjas_quick_stats_v596_repo.html','klaverjas_room.html','klaverjas_spectator.html','klaverjas_online.html']) {
  requireMatch(refiner, new RegExp(route.replaceAll('.', '\\.'), 'i'), `strict redirect allowlist missing ${route}`);
}
for (const asset of ['gejast-mobile-route-fixes-v583.js','gejast-mobile-foundation-v583.js']) {
  requireMatch(refiner, new RegExp(asset.replaceAll('.', '\\.'), 'i'), `source abort allowlist missing ${asset}`);
}
for (const rpc of ['get_login_active_names_v687','get_player_selector_source_v1']) {
  requireMatch(refiner, new RegExp(rpc, 'i'), `login retry allowlist missing ${rpc}`);
}
requireMatch(refiner, /Number\(record\?\.stale_loading_count \|\| 0\) === 0/, 'refiner must reject stale-loading pages');
requireMatch(refiner, /listEmpty\(record\?\.console_errors\)/, 'refiner must reject console errors');
requireMatch(refiner, /listEmpty\(record\?\.page_errors\)/, 'refiner must reject page errors');
requireMatch(refiner, /listEmpty\(record\?\.http_errors\)/, 'refiner must reject HTTP errors');
requireMatch(refiner, /listEmpty\(record\?\.issue_signals\)/, 'refiner must reject issue signals');
requireMatch(refiner, /\(\\d\+\)\\s\+actieve loginspeler/, 'login classification requires positive loaded-player evidence');

requireMatch(workflow, /node --check scripts\/refine-benign-visual-aborts-v813\.mjs/, 'workflow syntax-check for abort refiner missing');
requireMatch(workflow, /run: node scripts\/refine-benign-visual-aborts-v813\.mjs/, 'workflow abort refiner execution missing');
requireMatch(workflow, /const warnings=rows\.filter/, 'workflow must enumerate remaining warnings');
requireMatch(workflow, /if\(broken\.length \|\| warnings\.length\)/, 'authenticated certification must fail on WARN or BROKEN');

console.log('RESULT=V813_VISUAL_WARNING_CLEANUP_CONTRACT_PASS');

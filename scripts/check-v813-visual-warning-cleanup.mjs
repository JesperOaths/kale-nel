#!/usr/bin/env node
import fs from 'node:fs';

const migrationPath = 'GEJAST_v813b_visual_warning_cleanup_contracts.sql';
const refinerPath = 'scripts/refine-expected-visual-aliases-v809.mjs';
const workflowPath = '.github/workflows/full-live-visual-audit-v792.yml';
const klaverjasRoomPath = 'klaverjas_room.html';
for (const file of [migrationPath, refinerPath, workflowPath, klaverjasRoomPath]) {
  if (!fs.existsSync(file)) throw new Error(`V813_VISUAL_WARNING_CLEANUP_FAIL missing ${file}`);
}

const sql = fs.readFileSync(migrationPath, 'utf8');
const refiner = fs.readFileSync(refinerPath, 'utf8');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const klaverjasRoom = fs.readFileSync(klaverjasRoomPath, 'utf8');
const need = (text, token, label) => { if (!text.includes(token)) throw new Error(`V813_VISUAL_WARNING_CLEANUP_FAIL ${label}`); };
const forbid = (text, regex, label) => { if (regex.test(text)) throw new Error(`V813_VISUAL_WARNING_CLEANUP_FAIL ${label}`); };

need(sql, "revoke execute on function public.cleanup_stale_paardenrace_rooms_v718(text) from public, anon, authenticated;", 'Paardenrace v718 browser revoke missing');
need(sql, "revoke execute on function public.cleanup_stale_pikken_rooms_v718(text) from public, anon, authenticated;", 'Pikken v718 browser revoke missing');
need(sql, "grant execute on function public.cleanup_stale_paardenrace_rooms_v718(text) to service_role;", 'Paardenrace v718 service grant missing');
need(sql, "grant execute on function public.cleanup_stale_pikken_rooms_v718(text) to service_role;", 'Pikken v718 service grant missing');
need(sql, "site_scope_input text default 'friends',\n  session_token text default null,\n  session_token_input text default null", 'Paardenrace helper argument contract missing');
need(sql, "current_user in ('anon','authenticated')", 'browser no-op role boundary missing');
need(sql, "'source', 'v813b_client_noop'", 'v813b client no-op marker missing');
need(sql, "'source', 'v813b_retired_noop'", 'v813b retired no-op marker missing');
forbid(sql, /grant execute on function public\.cleanup_stale_(?:paardenrace|pikken)_rooms_v718\(text\) to [^;]*(?:anon|authenticated)/i, 'v718 mutation grant widened to browser role');

for (const route of ['boerenbridge_spectator.html','despimarkt_force.html','klaverjas_quick_stats_v596_repo.html','klaverjas_room.html','klaverjas_spectator.html','klaverjas_online.html']) need(refiner, route, `redirect allowlist missing ${route}`);
for (const asset of ['gejast-mobile-route-fixes-v583.js','gejast-mobile-foundation-v583.js']) need(refiner, asset, `source abort allowlist missing ${asset}`);
for (const rpc of ['get_login_active_names_v687','get_player_selector_source_v1']) need(refiner, rpc, `login read-abort allowlist missing ${rpc}`);
need(refiner, 'Number(record?.stale_loading_count || 0) === 0', 'stale-loading guard missing');
need(refiner, 'emptyList(record?.http_errors)', 'HTTP error guard missing');
need(refiner, 'emptyList(record?.page_errors)', 'page error guard missing');
need(refiner, 'emptyList(record?.console_errors)', 'console error guard missing');
need(refiner, 'emptyList(record?.issue_signals)', 'issue-signal guard missing');
need(refiner, 'Number(loaded[1]) > 0', 'positive loaded-player proof missing');
need(refiner, 'OVERFLOW_TOLERANCE_PX = 4', 'overflow regression guard missing');

need(klaverjasRoom, '.score-cell{min-width:0;overflow:hidden;', 'Klaverjas score cells must be shrinkable and clipped to the sidebar');
need(klaverjasRoom, '.score-cell .muted{min-width:0;overflow-wrap:anywhere;word-break:break-word}', 'Klaverjas long player names must wrap inside score cells');

need(workflow, 'node --check scripts/refine-expected-visual-aliases-v809.mjs', 'workflow refiner syntax check missing');
need(workflow, 'run: node scripts/refine-expected-visual-aliases-v809.mjs', 'workflow refiner execution missing');
need(workflow, 'node scripts/check-v813-visual-warning-cleanup.mjs', 'workflow contract check missing');
need(workflow, 'const warnings=rows.filter', 'workflow warning enumeration missing');
need(workflow, 'if(broken.length || warnings.length)', 'authenticated certification must fail on WARN or BROKEN');

console.log('RESULT=V813_VISUAL_WARNING_CLEANUP_CONTRACT_PASS');

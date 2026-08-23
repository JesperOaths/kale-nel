#!/usr/bin/env node
import fs from 'node:fs';

// Product-neutral post-deployment certification trigger for the merged v813 runtime.
// Re-run against the exact-current v813 + Security v773 baseline before release promotion.
const migrationPath = 'GEJAST_v813b_visual_warning_cleanup_contracts.sql';
const refinerPath = 'scripts/refine-expected-visual-aliases-v809.mjs';
const workflowPath = '.github/workflows/full-live-visual-audit-v792.yml';
const liveBrowserWorkflowPath = '.github/workflows/final-certification-live-browser-v792.yml';
const dataPlanePath = 'check-live-data-plane.mjs';
const klaverjasRoomPath = 'klaverjas_room.html';
const mobileFoundationPath = 'gejast-mobile-foundation-v583.js';
const authGatePath = 'gejast-auth-gate.js';
const scoreAliasPath = 'score.html';
for (const file of [migrationPath, refinerPath, workflowPath, liveBrowserWorkflowPath, dataPlanePath, klaverjasRoomPath, mobileFoundationPath, authGatePath, scoreAliasPath]) {
  if (!fs.existsSync(file)) throw new Error(`V813_VISUAL_WARNING_CLEANUP_FAIL missing ${file}`);
}

const sql = fs.readFileSync(migrationPath, 'utf8');
const refiner = fs.readFileSync(refinerPath, 'utf8');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const liveBrowserWorkflow = fs.readFileSync(liveBrowserWorkflowPath, 'utf8');
const dataPlane = fs.readFileSync(dataPlanePath, 'utf8');
const klaverjasRoom = fs.readFileSync(klaverjasRoomPath, 'utf8');
const mobileFoundation = fs.readFileSync(mobileFoundationPath, 'utf8');
const authGate = fs.readFileSync(authGatePath, 'utf8');
const scoreAlias = fs.readFileSync(scoreAliasPath, 'utf8');
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
need(mobileFoundation, 'fixKlaverjasRoomOverflow', 'Klaverjas runtime overflow containment missing');
need(mobileFoundation, '.roombar,.game-layout,.side,.stat,.score-grid,.score-cell,.lobby-seat-grid,.lobby-seat{min-width:0}', 'Klaverjas grid min-width containment missing');
need(mobileFoundation, '.stat strong,.score-cell,.score-cell strong,.lobby-seat strong{min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word}', 'Klaverjas long-name runtime wrapping missing');

need(authGate, "const nativeFetch=typeof window.fetch==='function'?window.fetch.bind(window):null;", 'native fetch boundary missing');
need(authGate, "/\\/rest\\/v1\\/allowed_usernames(?:[?#]|$)/i", 'legacy allowed_usernames interception missing');
need(authGate, "['get_login_active_names_v687',{site_scope_input:scope}]", 'active-login RPC compatibility source missing');
need(authGate, "['get_player_selector_source_v1',{site_scope_input:scope}]", 'selector RPC compatibility fallback missing');
need(authGate, "return names.map(display_name=>({display_name,status:'active',site_scope:scope}));", 'safe compatibility row projection missing');
need(authGate, "const safeRows=Array.isArray(rows)?rows:[];", 'legacy direct-read interception must fail closed to an empty safe projection');
need(authGate, "v813-secure-active-name-rpc-empty", 'safe empty compatibility source marker missing');
need(authGate, "direct_allowed_usernames_network:false", 'direct-read network compatibility marker missing');
forbid(authGate, /allowed_usernames[^\n]{0,120}(?:apikey|Authorization)/i, 'auth gate must not perform direct allowed_usernames table fetch');
forbid(authGate, /if\(Array\.isArray\(rows\)\)[\s\S]{0,450}return nativeFetch\(input,init\);/, 'legacy allowed_usernames compatibility must not fall back to a direct table request');

forbid(scoreAlias, /gejast-auth-gate\.js/i, 'score alias must remain runtime-light');
need(scoreAlias, "new URL('./klaverjas_scorer_v596_repo_ready.html',location.href)", 'score alias canonical destination missing');
need(scoreAlias, 'location.replace(url.toString())', 'score alias must preserve canonical replace redirect');

need(workflow, 'node --check scripts/refine-expected-visual-aliases-v809.mjs', 'workflow refiner syntax check missing');
need(workflow, 'run: node scripts/refine-expected-visual-aliases-v809.mjs', 'workflow refiner execution missing');
need(workflow, 'node scripts/check-v813-visual-warning-cleanup.mjs', 'workflow contract check missing');
need(workflow, "GEJAST_DATA_PLANE_ATTEMPTS: '3'", 'visual data-plane transient retry contract missing');
need(dataPlane, 'attempts > 3', 'data-plane probe must accept the workflow three-attempt retry contract');
need(workflow, 'const warnings=rows.filter', 'workflow warning enumeration missing');
need(workflow, 'if(broken.length || warnings.length)', 'authenticated certification must fail on WARN or BROKEN');

// The shipped browser session parser accepts exactly 48 hexadecimal characters.
// Certification fixtures must use that same contract so SQL/RPC-only success cannot
// mask a browser-side session rejection and false login redirect.
need(liveBrowserWorkflow, 'token1="$(openssl rand -hex 24)"', 'browser fixture token1 must be 48 hex characters');
need(liveBrowserWorkflow, 'token2="$(openssl rand -hex 24)"', 'browser fixture token2 must be 48 hex characters');
need(liveBrowserWorkflow, '[[ "$token1" =~ ^[0-9a-f]{48}$ ]]', 'browser fixture token1 format assertion missing');
need(liveBrowserWorkflow, '[[ "$token2" =~ ^[0-9a-f]{48}$ ]]', 'browser fixture token2 format assertion missing');
forbid(liveBrowserWorkflow, /token[12]="v792-cert-/, 'legacy prefixed certification token reintroduced');

console.log('RESULT=V813_VISUAL_WARNING_CLEANUP_CONTRACT_PASS');

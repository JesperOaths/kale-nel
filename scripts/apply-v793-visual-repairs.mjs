#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

function read(file){ return fs.readFileSync(file, 'utf8'); }
function write(file, text){ fs.writeFileSync(file, text, 'utf8'); console.log(`updated ${file}`); }
function replaceOnce(text, search, replacement, label){
  const count = text.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one occurrence, found ${count}`);
  return text.replace(search, replacement);
}
function replaceRegexOnce(text, rx, replacement, label){
  const matches = [...text.matchAll(new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : `${rx.flags}g`))];
  if (matches.length !== 1) throw new Error(`${label}: expected exactly one regex occurrence, found ${matches.length}`);
  return text.replace(rx, replacement);
}

// 1. Homepage: expose exactly the user's two intended Klaverjas products:
//    one scorer and one online game. score.html remains a compatibility alias, not a competing tile.
{
  const file = 'index.html';
  let text = read(file);
  const block = `          <a id="homeKlaverjasLiveEntry" class="page-link-card scorer-link feature-primary" href="./score.html" data-default-href="./score.html">\n            <div class="page-link-label">Klaverjas live</div>\n            <div class="page-link-copy">Start een live pot en houd de tussenstand bij.</div>\n          </a>\n`;
  if (!text.includes(block)) {
    const crlf = block.replaceAll('\n', '\r\n');
    if (!text.includes(crlf)) throw new Error('index.html: Klaverjas live tile block not found');
    text = text.replace(crlf, '');
  } else text = text.replace(block, '');
  write(file, text);
}

// 2. Shared ladder: browser URL may accept the historical plural alias, but the deployed
//    SQL contract is singular "klaverjas". Never send "klaverjassen" as game_key.
{
  const file = 'ladder.html';
  let text = read(file);
  text = replaceOnce(
    text,
    `const game=(new URLSearchParams(location.search).get('game')||'klaverjassen').toLowerCase();`,
    `const requestedGame=(new URLSearchParams(location.search).get('game')||'klaverjas').toLowerCase();\nconst game=requestedGame==='klaverjassen'?'klaverjas':requestedGame;`,
    'ladder requested game normalization'
  );
  text = replaceOnce(
    text,
    `const apiGame=({klaverjas:'klaverjassen',klaverjassen:'klaverjassen',boerenbridge:'boerenbridge',beerpong:'beerpong'}[game]||game);`,
    `const apiGame=({klaverjas:'klaverjas',boerenbridge:'boerenbridge',beerpong:'beerpong'}[game]||game);`,
    'ladder backend game key'
  );
  text = text.replaceAll(`apiGame==='klaverjassen'`, `apiGame==='klaverjas'`);
  text = text.replaceAll(`apiGame!=='klaverjassen'`, `apiGame!=='klaverjas'`);
  if (/apiGame\s*[!=]==?\s*['"]klaverjassen['"]/.test(text)) throw new Error('ladder.html still contains plural backend Klaverjas comparisons');
  write(file, text);
}

// 3. Beerpong / Boerenbridge phase/status panel: v661 wrappers in production no longer
//    accept the three-argument payload this bridge was sending. Use the current v668 runtime
//    bundle contracts, with correct per-function payload shapes.
{
  const file = 'gejast-game-phase-bridge.js';
  let text = read(file);
  text = text.replace(`const VERSION='v661';`, `const VERSION='v793';`);
  text = text.replace(`generic:'get_game_group_a_bundle_v661'`, `generic:'get_game_group_a_runtime_bundle_v668'`);
  text = text.replace(`beerpong:'get_beerpong_phase_bundle_v661'`, `beerpong:'get_beerpong_runtime_bundle_v668'`);
  text = text.replace(`boerenbridge:'get_boerenbridge_phase_bundle_v661'`, `boerenbridge:'get_boerenbridge_runtime_bundle_v668'`);
  text = replaceRegexOnce(
    text,
    /  async function bundle\(opts=\{\}\)\{[\s\S]*?\n  \}\r?\n  async function audit/,
    `  async function bundle(opts={}){\n    const game=normGame(opts.gameKey||opts.game_key||opts.game);\n    const siteScope=normScope(opts.scope);\n    const limit=Math.max(1,Math.min(100,Number(opts.limit||20)||20));\n    const specific=game==='boerenbridge'?RPC.boerenbridge:RPC.beerpong;\n    try{return await rpc(specific,{site_scope_input:siteScope,limit_input:limit});}catch(err){\n      if(!/could not find|schema cache|function|does not exist/i.test(String(err.message||err))) throw err;\n      return await rpc(RPC.generic,{site_scope_input:siteScope,game_key_input:game,limit_input:limit});\n    }\n  }\n  async function audit`,
    'game group A bundle implementation'
  );
  if (/get_(?:game_group_a_bundle|beerpong_phase_bundle|boerenbridge_phase_bundle)_v661/.test(text)) throw new Error('game phase bridge still points at stale v661 phase contracts');
  write(file, text);
}

// 4. Pikken / Paardenrace status panel: production has one current generic v661-compat
//    three-argument RPC. Avoid first calling nonexistent specific phase RPCs on every page.
{
  const file = 'gejast-game-group-b-bridge.js';
  let text = read(file);
  text = text.replace(`const VERSION='v661';`, `const VERSION='v793';`);
  text = replaceRegexOnce(
    text,
    /  async function bundle\(opts=\{\}\)\{[\s\S]*?\n  \}\r?\n  async function audit/,
    `  async function bundle(opts={}){\n    const game=normGame(opts.gameKey||opts.game_key||opts.game);\n    const payload={site_scope_input:normScope(opts.scope),game_key_input:game,limit_input:Math.max(1,Math.min(100,Number(opts.limit||20)||20))};\n    return rpc(RPC.generic,payload);\n  }\n  async function audit`,
    'game group B bundle implementation'
  );
  write(file, text);
}

// 5. Legacy standalone Klaverjas leaderboard: point it at the current shared ladder RPC
//    instead of waiting on a removed get_klaverjas_leaderboard_public_v687 endpoint.
{
  const file = 'gejast-klaverjas-runtime.js';
  let text = read(file);
  text = replaceRegexOnce(
    text,
    /  async function getLeaderboard\(\)\{[\s\S]*?\n  \}\n  async function getBundle\(\)\{/,
    `  async function getLeaderboard(){\n    const data = await rpc('get_public_ladder_page_scoped', { game_key: 'klaverjas', site_scope_input: getScope() }, { timeoutMs: 10000 });\n    const rows = Array.isArray(data?.ladder) ? data.ladder : [];\n    return Object.assign({}, data || {}, { leaderboard: rows });\n  }\n  async function getBundle(){`,
    'Klaverjas leaderboard compatibility'
  );
  write(file, text);
}

// 6. Pikken spectator alias: preserve the canonical game_id (and useful compatible ids)
//    when redirecting to the shared live renderer.
{
  const file = 'pikken_spectator.html';
  let text = read(file);
  const old = `if(q.get('client_match_id'))u.searchParams.set('client_match_id',q.get('client_match_id'));if(q.get('match_ref'))u.searchParams.set('match_ref',q.get('match_ref'));`;
  const next = `for(const key of ['game_id','client_match_id','match_ref','lobby_code']){if(q.get(key))u.searchParams.set(key,q.get(key));}`;
  text = replaceOnce(text, old, next, 'Pikken spectator query preservation');
  write(file, text);
}

// 7. v792's final-acceptance artifact remains a historical certification after this product
//    change. Keep validating that evidence, but stop falsely requiring the current repo to
//    remain v792 once v793 is created.
{
  const file = 'check-final-acceptance-v792.mjs';
  let text = read(file);
  text = text.replace(`const version = fs.readFileSync('VERSION', 'utf8').trim();\n`, '');
  text = replaceOnce(
    text,
    `assert.equal(version, 'v792', 'repository VERSION must remain v792');\nassert.equal(artifact.site_version, version, 'final acceptance must certify the checked-in VERSION');`,
    `assert.equal(artifact.site_version, 'v792', 'historical final acceptance artifact must remain v792');`,
    'historical v792 certification scope'
  );
  text = text.replace(`console.log('FINAL ACCEPTANCE v792 artifact is internally consistent and fail-closed.');`, `console.log('Historical FINAL ACCEPTANCE v792 artifact remains internally consistent.');`);
  write(file, text);
}

// 8. Explicit current-release certification state. v793 must be revalidated after deployment;
//    this prevents the old PASS from being mistaken for a certification of new frontend code.
write('release-certification.json', `${JSON.stringify({
  schema_version: 1,
  current_version: 'v793',
  status: 'REVALIDATION_REQUIRED',
  prior_certification: { version: 'v792', issue: 131, artifact: 'final-acceptance-v792.json' },
  current_audit_issue: 153,
  reason: 'Frontend/runtime repairs from the full screenshot audit require fresh production visual and gameplay revalidation.'
}, null, 2)}\n`);

write('check-release-certification-state.mjs', `#!/usr/bin/env node\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\nconst version=fs.readFileSync('VERSION','utf8').trim();\nconst state=JSON.parse(fs.readFileSync('release-certification.json','utf8'));\nassert.equal(state.schema_version,1,'unsupported release certification schema');\nassert.equal(state.current_version,version,'release certification state must track root VERSION');\nassert(['REVALIDATION_REQUIRED','PASS'].includes(state.status),'invalid release certification state');\nif(state.status==='PASS'){\n  assert(fs.existsSync('final-acceptance-v793.json'),'PASS requires final-acceptance-v793.json');\n  const final=JSON.parse(fs.readFileSync('final-acceptance-v793.json','utf8'));\n  assert.equal(final.site_version,version,'final acceptance must match current VERSION');\n  assert.equal(final.status,'PASS','current final acceptance must be PASS');\n}\nconsole.log('Release certification state:',state.current_version,state.status);\n`);

// 9. Deterministic regression checker for the visible defects this audit found.
write('check-v793-visual-audit-repairs.mjs', `#!/usr/bin/env node\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\nconst index=fs.readFileSync('index.html','utf8');\nassert(!index.includes('homeKlaverjasLiveEntry'),'homepage must not expose duplicate Klaverjas live/scorer tile');\nassert.equal((index.match(/Klaverjas Score Formulier/g)||[]).length,1,'homepage must expose exactly one Klaverjas score-form tile');\nassert.equal((index.match(/<div class=\\"page-link-label\\">Klaverjas online<\\/div>/g)||[]).length,1,'homepage must expose exactly one Klaverjas online tile');\nconst ladder=fs.readFileSync('ladder.html','utf8');\nassert(ladder.includes("requestedGame==='klaverjassen'?'klaverjas':requestedGame"),'plural Klaverjas URL alias must canonicalize to singular');\nassert(ladder.includes("klaverjas:'klaverjas'"),'ladder backend key must be singular klaverjas');\nassert(!/apiGame\\s*[!=]==?\\s*['\\"]klaverjassen['\\"]/.test(ladder),'ladder must never compare backend key to plural klaverjassen');\nconst a=fs.readFileSync('gejast-game-phase-bridge.js','utf8');\nassert(a.includes('get_game_group_a_runtime_bundle_v668'),'group A status bridge must use current runtime bundle');\nassert(a.includes('get_beerpong_runtime_bundle_v668'),'Beerpong status bridge must use current runtime RPC');\nassert(a.includes('get_boerenbridge_runtime_bundle_v668'),'Boerenbridge status bridge must use current runtime RPC');\nassert(!/get_(?:game_group_a_bundle|beerpong_phase_bundle|boerenbridge_phase_bundle)_v661/.test(a),'stale group A v661 phase endpoints must not be used');\nconst b=fs.readFileSync('gejast-game-group-b-bridge.js','utf8');\nassert(b.includes('return rpc(RPC.generic,payload)'),'group B status bridge must avoid nonexistent specific phase RPCs');\nconst kl=fs.readFileSync('gejast-klaverjas-runtime.js','utf8');\nassert(kl.includes("get_public_ladder_page_scoped"),'standalone Klaverjas leaderboard must use current ladder RPC');\nassert(!kl.includes("get_klaverjas_leaderboard_public_v687"),'removed legacy Klaverjas leaderboard RPC must not remain active');\nconst spec=fs.readFileSync('pikken_spectator.html','utf8');\nassert(spec.includes("['game_id','client_match_id','match_ref','lobby_code']"),'Pikken spectator alias must preserve game_id/context');\nconst sql=fs.readFileSync('GEJAST_v793a_rad_stats_aggregate_repair.sql','utf8');\nassert(sql.includes('from (\\n            select segment_label'),'Rad leaderboard must pre-aggregate before jsonb_agg');\nassert(sql.includes('v793a Rad stats payload shape verification failed'),'Rad migration must self-verify');\nconsole.log('v793 visual-audit repair regressions ok.');\n`);

// 10. Wire the new current-release state + regressions into canonical static verification.
{
  const file = 'package.json';
  const pkg = JSON.parse(read(file));
  let command = pkg.scripts['verify:static'];
  if (!command.includes('check-release-certification-state.mjs')) command = command.replace('node check-final-acceptance-v792.mjs', 'node check-final-acceptance-v792.mjs && node check-release-certification-state.mjs && node check-v793-visual-audit-repairs.mjs');
  pkg.scripts['verify:static'] = command;
  write(file, `${JSON.stringify(pkg, null, 2)}\n`);
}

// 11. Bump frontend release and synchronize all active hardcoded cache-busters/watermarks.
write('VERSION', 'v793\n');
execFileSync(process.execPath, ['fix-version-drift.mjs'], { stdio: 'inherit' });

console.log('RESULT=V793_VISUAL_REPAIRS_GENERATED');

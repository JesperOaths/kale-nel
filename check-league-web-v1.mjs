import fs from 'node:fs';
import assert from 'node:assert/strict';

const api=fs.readFileSync('supabase/functions/league-api-v1/index.ts','utf8');
const app=fs.readFileSync('league/app.js','utf8');
const html=fs.readFileSync('league/index.html','utf8');
const migration=fs.readFileSync('supabase/migrations/20261001043000_league_web_foundation_v1.sql','utf8');

assert.ok(api.includes('x-gejast-session'));
assert.ok(api.includes('x-riot-api-key'));
assert.ok(api.includes('Access-Control-Allow-Headers'));
assert.ok(api.includes('const hasNum='));
assert.ok(api.includes('fightProfile'));
assert.ok(api.includes('killConversionWindows'));
assert.ok(api.includes('lateResetObjectiveMissRate'));
assert.ok(api.includes('championBehaviorModel'));
assert.ok(api.includes('higherRankPeerGames'));
assert.ok(api.includes('recentTrend'));
assert.ok(api.includes('damageGoldEfficiency'));
assert.ok(api.includes('games=deepCandidates.slice(0,20)'));
assert.ok(app.includes('function hasNum(v)'));
assert.ok(app.includes('renderPracticePlan'));
assert.ok(app.includes('renderProgressComparison'));
assert.ok(app.includes("if(tab==='fights')"));
assert.ok(app.includes('Post-kill conversion'));
assert.ok(app.includes('Late-reset neutral-objective misses'));

const refs=[...app.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]);
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.deepEqual([...new Set(refs.filter(x=>!ids.includes(x)))],[]);
assert.deepEqual([...new Set(ids.filter((x,i)=>ids.indexOf(x)!==i))],[]);

for(const table of ['league_profiles_v1','league_match_cache_v1','league_fetch_runs_v1','league_analysis_runs_v1']){
  assert.ok(migration.includes('alter table public.'+table+' enable row level security'));
  assert.ok(migration.includes('revoke all on public.'+table+' from anon, authenticated'));
}
console.log('league-web-contract=PASS');

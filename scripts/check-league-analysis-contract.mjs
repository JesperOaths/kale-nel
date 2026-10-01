import fs from 'node:fs';

const read=(p)=>fs.readFileSync(p,'utf8');
const backend=read('supabase/functions/league-api-v1/index.ts');
const app=read('league/app.js');
const html=read('league/index.html');

const failures=[];
const ok=(cond,msg)=>{if(!cond)failures.push(msg);};

ok(backend.includes('const hasNum=(v:any)=>v!==null&&v!==undefined&&v!==""'), 'backend must reject null/undefined/empty before numeric conversion');
ok(app.includes("function hasNum(v){return v!==null&&v!==undefined&&v!==''"), 'frontend must reject null/undefined/empty before numeric conversion');

const backendUnsafe=[...backend.matchAll(/Number\.isFinite\(Number\(([^)]+)\)\)/g)].map(m=>m[0]);
ok(backendUnsafe.every(x=>x==='Number.isFinite(Number(v))'), 'backend contains unguarded Number.isFinite(Number(...)) that can turn null into zero: '+backendUnsafe.join(', '));
const appUnsafe=[...app.matchAll(/Number\.isFinite\(Number\(([^)]+)\)\)/g)].map(m=>m[0]);
ok(appUnsafe.every(x=>x==='Number.isFinite(Number(v))'), 'frontend contains unguarded Number.isFinite(Number(...)) that can turn null into zero: '+appUnsafe.join(', '));

ok(backend.includes('coachingGames=games.filter((g:any)=>g.role===primaryRole)'), 'behavioral coaching must be filtered to the primary role');
ok(backend.includes('coachingAllGames=allGames.filter((g:any)=>g.role===primaryRole)'), 'historical coaching baseline must use the same role');
ok(backend.includes('eligibleRows=cachedRows.filter')&&backend.includes('===11'), 'deep analyzer must exclude non-Summoner\'s-Rift maps');
ok(backend.includes('reaches25=Number(match?.info?.gameDuration||0)>=25*60'), '@25 metrics must require a game that actually reaches 25 minutes');
ok(backend.includes('frameNearMinute(frames,25,45000)'), '@25 metrics must use a frame close to 25 minutes');
ok(backend.includes('d.tMs+75000'), 'pre-objective conversion window must remain explicit');
ok(backend.includes('impactDeltaVsOpponent'), 'direct-peer first-impact comparison must remain in analyzer');
ok(backend.includes('roam.laneCostCs='), 'roam lane-cost comparison must remain in analyzer');
ok(backend.includes('objectiveSetupDeltaVsOpponent'), 'objective-setup vision comparison must remain in analyzer');
ok(backend.includes('function deathArea('), 'spatial death-context classification must remain in analyzer');
ok(backend.includes('peer_rank_json'), 'same-role peer rank cache must remain available');
ok(backend.includes('x-riot-api-key'), 'session Riot-key header must remain supported by backend/CORS');
ok(!/localStorage|sessionStorage|indexedDB/.test(app), 'Riot key or League state must not be persisted in browser storage');

let parseError=null;
try{new Function(app);}catch(e){parseError=e;}
ok(!parseError, 'league/app.js failed JS parse: '+(parseError?.message||'unknown'));

const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
const refs=[...app.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]);
const missing=[...new Set(refs.filter(id=>!ids.includes(id)))];
const dupes=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))];
ok(missing.length===0, 'frontend references missing DOM ids: '+missing.join(', '));
ok(dupes.length===0, 'HTML contains duplicate DOM ids: '+dupes.join(', '));

const appVersion=(html.match(/\/league\/app\.js\?v=([^"]+)/)||[])[1]||'';
const cssVersion=(html.match(/\/league\/styles\.css\?v=([^"]+)/)||[])[1]||'';
ok(appVersion&&cssVersion&&appVersion===cssVersion, 'League app/css cache-bust versions must match');

if(failures.length){
  console.error('\nLeague analysis contract FAILED:\n- '+failures.join('\n- '));
  process.exit(1);
}
console.log('League analysis contract OK');
console.log(JSON.stringify({
  appVersion,
  domRefs:refs.length,
  domIds:ids.length,
  invariants:['missing-is-not-zero','primary-role-coaching','real-25-minute-frame','summoners-rift-only','session-only-riot-key','peer-comparison']
},null,2));

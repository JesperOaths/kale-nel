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
ok(backend.includes('summonersRiftRows=cachedRows.filter')&&backend.includes('===11')&&backend.includes('durationEligibleRows=summonersRiftRows.filter'), 'deep analyzer must filter to Summoner\'s Rift before duration and queue coaching eligibility');
ok(backend.includes('gameDurationSec=Number(match?.info?.gameDuration||0)')&&backend.includes('reaches25=gameDurationSec>=25*60'), '@25 metrics must require a game that actually reaches 25 minutes');
ok(backend.includes('frameNearMinute(frames,25,45000)'), '@25 metrics must use a frame close to 25 minutes');
ok(backend.includes('d.tMs+75000'), 'pre-objective conversion window must remain explicit');
ok(backend.includes('function gamePhaseKey('), 'game-phase classifier must remain explicit');
ok(backend.includes('m<14?"early":m<25?"mid":"late"'), 'game-phase boundaries must remain early <14, mid <25, late ≥25');
ok(backend.includes('phaseRisk'), 'phase-normalized behavioral risk summary must remain exported');
ok(backend.includes('midRoutingGames'), 'mid-game routing efficiency model must remain explicit');
ok(backend.includes('x.csSwing<=-8&&x.objectiveJoinRate<50'), 'inefficient mid-routing threshold must remain CS loss + low objective presence');
ok(backend.includes('x.csSwing>=8&&x.objectiveJoinRate>=60'), 'balanced mid-routing strength threshold must remain CS gain + objective presence');
ok(backend.includes('lead25Games=games.filter(g=>hasNum(g.goldDiff25)&&Number(g.goldDiff25)>=500)'), '25-minute closing model must keep +500g direct-role lead threshold');
ok(backend.includes('deficit25Games=games.filter(g=>hasNum(g.goldDiff25)&&Number(g.goldDiff25)<=-500)'), '25-minute recovery model must keep -500g direct-role deficit threshold');
ok(backend.includes('lead25LossesWithLateRisk'), 'lead@25 losses must preserve late-risk evidence');
ok(backend.includes('closing25:{'), '25-minute closing summary must remain exported');
ok(backend.includes('impactDeltaVsOpponent'), 'direct-peer first-impact comparison must remain in analyzer');
ok(backend.includes('roam.laneCostCs='), 'roam lane-cost comparison must remain in analyzer');
ok(backend.includes('objectiveSetupDeltaVsOpponent'), 'objective-setup vision comparison must remain in analyzer');
ok(backend.includes('objectiveRootCauses'), 'objective root-cause evidence ranking must remain in analyzer');
ok(backend.includes('objectiveRootCauses.sort'), 'objective root causes must remain severity-ranked');
ok(backend.includes('objectiveDiagnosis:{presenceLow:objectivePresenceLow,primaryCause:objectivePrimaryCause?.key||null,causes:objectiveRootCauses}'), 'objective diagnosis must remain exported');
ok(backend.includes('goldSwingTo15'), 'clean solo-kill conversion must preserve gold swing to 15');
ok(backend.includes('csSwingTo15'), 'clean solo-kill conversion must preserve CS swing to 15');
ok(backend.includes('Number(x.goldSwingTo15)>=200'), 'clean solo-kill conversion threshold must remain +200g by 15');
ok(backend.includes('soloKillConversionRate'), 'aggregate clean solo-kill conversion rate must remain exported');
ok(backend.includes('soloKillStructureConversionRate'), 'clean solo-kill structure conversion must remain exported');
ok(backend.includes('endMs=startMs+90000'), 'solo-kill structure conversion window must remain 90 seconds');
ok(backend.includes('Number(o.killerId)===pid'), 'solo-kill structure conversion must use direct Riot player credit');
ok(backend.includes('diedBeforeNextShop'), 'post-solo-kill banking model must preserve death-before-shop ordering');
ok(backend.includes('nextShopDelaySec'), 'post-solo-kill banking model must preserve time to next detected shop');
ok(backend.includes('soloKillDeathsBeforeShopRate'), 'aggregate post-solo-kill death-before-shop rate must remain exported');
ok(backend.includes('itemSpikeWindow'), 'first-major-item spike utilization model must remain in analyzer');
ok(backend.includes('leadSec>=45'), 'measurable first-major-item advantage must remain at least 45 seconds');
ok(backend.includes('itemSpikeUtilizationRate'), 'aggregate first-major-item spike utilization rate must remain exported');
ok(backend.includes('diedBeforeImpact'), 'item-spike model must preserve death-before-impact evidence');
ok(backend.includes('function repeatDeathSummary('), 'rapid repeat-death model must remain explicit');
ok(backend.includes('windowMs=240000'), 'rapid repeat-death window must remain four minutes');
ok(backend.includes('repeatDeathRateDelta'), 'repeat-death comparison versus direct role opponents must remain exported');
ok(backend.includes('visionMission'), 'vision-action safety model must remain in analyzer');
ok(backend.includes('Number(d.tMs)-Number(v.tMs)<=20000'), 'vision-action death window must remain 20 seconds');
ok(backend.includes('dist2(pos,v)<=2500*2500'), 'vision-action death spatial radius must remain 2500 units');
ok(backend.includes('function deathArea('), 'spatial death-context classification must remain in analyzer');
ok(backend.includes('sideLaneRisk'), 'post-lane side-lane timing model must remain in analyzer');
ok(backend.includes('postImpactRisk'), 'post-play give-back model must remain in analyzer');
ok(backend.includes('Number(d.tMs)-Number(x.tMs)<=30000'), 'post-play give-back window must remain 30 seconds');
ok(backend.includes('alliesNear===0'), 'isolated side-lane deaths must require no nearby ally');
ok(backend.includes('d.tMs+90000'), 'pre-objective side-lane window must remain 90 seconds');
ok(backend.includes('peer_rank_json'), 'same-role peer rank cache must remain available');
ok(backend.includes('gameDuration||r?.game_duration_seconds||0)>=600'), 'coaching sample must exclude sub-10-minute games');
ok(backend.includes('shortGameThresholdSeconds:600'), 'short-game threshold must remain explicit in data quality');
ok(backend.includes('opponentMatchupBehaviorModel'), 'repeated opposing-champion matchup model must remain in analyzer');
ok(backend.includes('buildReplayReviewQueue'), 'replay review queue must remain explicit in analyzer');
ok(backend.includes('buildPracticeTargets'), 'measurable practice-target builder must remain explicit');
ok(backend.includes('source:"self_relative_short_term"'), 'practice targets must remain explicitly self-relative');
ok(backend.includes('Number(sampleSize||0)<minSample'), 'practice targets must fail closed on thin evidence');
ok(backend.includes('windowGames:5'), 'practice targets must remain scoped to a five-game practice horizon');
ok(backend.includes('if(out.length>=3)break'), 'practice targets must remain capped at three');
ok(backend.includes('if(n>=2)continue'), 'replay review queue must cap repeated moments to two per match');
ok(backend.includes('if(selected.length>=10)break'), 'replay review queue must cap output at ten moments');
ok(backend.includes('deathConsequences?.events'), 'replay queue must preserve death-consequence evidence');
ok(backend.includes('objectiveReadiness?.events'), 'replay queue must preserve objective-readiness evidence');
ok(backend.includes('fightProfile?.events'), 'replay queue must preserve fight-entry evidence');
ok(backend.includes('if(list.length<3)continue'), 'opponent matchup coaching must require at least three repeated games');
ok(backend.includes('pre14SoloDeathsToRole'), 'matchup model must preserve clean direct-role duel evidence');
ok(backend.includes('pre14OutsidePressureDeaths'), 'matchup model must preserve outside-pressure evidence');
ok(backend.includes('durationEligibleRows=summonersRiftRows.filter'), 'duration eligibility must be computed before queue isolation');
ok(backend.includes('dominantQueueId'), 'queue-context isolation must select a dominant raw Riot queue id');
ok(backend.includes('durationEligibleRows.filter')&&backend.includes('===Number(dominantQueueId)'), 'coaching sample must stay homogeneous by dominant queue id');
ok(backend.includes('excludedOtherQueues'), 'data quality must expose cross-queue exclusions');
ok(backend.includes('function patchKey('), 'patch cohort parser must remain in analyzer');
ok(backend.includes('gameVersion:gv||null')&&backend.includes('patchKey:pk'), 'deep/baseline games must preserve Riot game version and patch key');
ok(backend.includes('currentPatchRoleGames.length>=3&&olderSamePatchRoleGames.length>=5'), 'same-patch historical trend must keep 3 recent / 5 older minimum evidence');
ok(backend.includes('crossPatchBaselineRoleGames'), 'cross-patch older games must remain explicitly excluded from trend coaching');
ok(backend.includes('baselineKind:"older_same_patch"'), 'historical coaching baseline must remain same-patch and older-only');
ok(backend.includes('peerRankTargetCount'), 'fetch finish must compute peer-rank targets for the comparable sample');
ok(backend.includes('slice(0,20)'), 'peer-rank backfill must remain bounded to the final Last-20 target');
ok(backend.includes('peer_rank_backfilled'), 'fetch finish must report peer-rank backfill results');
ok(backend.includes('comparableCachedGames'), 'fetch finish must measure comparable cached sample size');
ok(backend.includes('.order("game_start_at",{ascending:false}).limit(100)'), 'peer-rank backfill must use the same last-100 cache horizon as analysis');
ok(backend.includes('recommend_deeper_cache'), 'fetch finish must flag a comparable sample smaller than Last 20');
ok(backend.includes('x-riot-api-key'), 'session Riot-key header must remain supported by backend/CORS');
ok(app.includes('practiceTargetHtml'), 'frontend must render measurable practice checkpoints');
ok(app.includes('previousPracticeTargetOutcomes'), 'frontend must score prior practice targets against later distinct analyses');
ok(app.includes('curRole!==prevRole'), 'practice-target follow-up must fail closed when primary role changes');
ok(app.includes('Number(curQueue)!==Number(prevQueue)'), 'practice-target follow-up must fail closed when queue context changes');
ok(app.includes('curPatch!==prevPatch'), 'practice-target follow-up must fail closed when patch cohort changes');
ok(app.includes("'moving closer'")&&app.includes("'moved away'")&&app.includes("'unchanged'"), 'practice-target follow-up statuses must remain explicit');
ok(html.includes('id="practiceOutcome"'), 'practice target outcome container must remain in page');
ok(app.includes('Next 5 comparable games'), 'practice cards must identify the short practice horizon');
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

ok(backend.includes('"post-play discipline"'), 'post-play discipline must consolidate into a stable coaching theme');
ok(backend.includes('"side-lane timing"'), 'side-lane timing must consolidate into a stable coaching theme');
ok(backend.includes('supportingTitles'), 'priority themes must preserve supporting finding titles');

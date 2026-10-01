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
assert.ok(api.includes('totalTimelineDeaths=validTimeline.reduce'),'Death-trade aggregates must be declared before coaching uses them');
const behaviorStart=api.lastIndexOf('behaviorSummary:{');
const behaviorEnd=api.indexOf('\n  };',behaviorStart);
assert.ok(behaviorStart>=0&&behaviorEnd>behaviorStart,'Behavior summary export block must exist');
const behaviorExport=api.slice(behaviorStart,behaviorEnd);
for(const field of [
  'deathTradeRate','highRiskUntradedDeaths','highRiskUntradedPerGame',
  'measuredDeathConsequences','costlyDeathEvents','severeDeathEvents','costlyDeathRate','costlyDeathsPerTimelineGame','severeDeathsPerTimelineGame','avgGoldSwingAfterDeath','avgCsSwingAfterDeath',
  'itemSpikeEligibleWindows','itemSpikeUtilizedWindows','itemSpikeUtilizationRate','itemSpikeDeathsBeforeImpact','avgItemSpikeLeadSec',
  'fightSamples','firstAllyFightDeathRate','preContributionFightDeathRate','fightSurvivalRate',
  'highUnspentFightRate','itemDisadvantageFightRate','goldDeficitFightRate',
  'killConversionRate','opponentKillConversionRate','killConversionDelta',
  'neutralObjectiveEvents','earlySetupObjectiveJoinRate','earlySetupObjectiveCoverageRate','lateResetObjectiveMissRate','freshPurchaseObjectiveJoinRate',
  'objectiveSetupWardRate','objectiveSetupWardRateDelta','visionActions','visionActionDeaths','visionActionDeathRate','highRiskVisionActionDeaths','highRiskVisionActionDeathsPerGame','unsupportedVisionActionDeaths','damageGoldEfficiency'
])assert.ok(behaviorExport.includes(field),'Behavior summary must export '+field);
assert.ok(api.includes('sessionBehaviorModel'));
assert.ok(api.includes('highRiskLeadDeathsPerGame'));
assert.ok(api.includes('riskStateDeaths'));
assert.ok(api.includes('highRiskBehindDeathsPerGame'));
assert.ok(api.includes('itemDisadvantageFightRate'));
assert.ok(api.includes('outnumberedFightLossRate'));
assert.ok(api.includes('roleLevelDisadvantageFightRate'));
assert.ok(api.includes('rolePeerNear'));
assert.ok(api.includes('pre14RoleSoloDeaths'));
assert.ok(api.includes('soloKillConversionRate'));
assert.ok(api.includes('avgSoloKillGoldSwingTo15'));
assert.ok(api.includes('avgSoloKillCsSwingTo15'));
assert.ok(api.includes('soloKillDeathsBeforeShopRate'));
assert.ok(api.includes('avgSoloKillNextShopDelaySec'));
assert.ok(api.includes('pre14OutsidePressureDeaths'));
assert.ok(api.includes('avgCsSwing15to25'));
assert.ok(api.includes('lanePressure'));
assert.ok(api.includes('laneDuel'));
assert.ok(api.includes('killConversionRate'));
assert.ok(api.includes('games=deepCandidates.slice(0,20)'));
assert.ok(api.includes('excludedShortGames'));
assert.ok(api.includes('shortGameThresholdSeconds:600'));
assert.ok(api.includes('dominantQueueId'));
assert.ok(api.includes('gameVersion:gv||null'));
assert.ok(api.includes('patchKey:pk'));
assert.ok(api.includes('patchBaselineReady'));
assert.ok(api.includes('olderSamePatchRoleGames'));
assert.ok(api.includes('crossPatchBaselineRoleGames'));
assert.ok(api.includes('excludedOtherQueues'));
assert.ok(api.includes('queueCounts:Object.fromEntries'));
assert.ok(app.includes('function hasNum(v)'));
assert.ok(app.includes('renderPracticePlan'));
assert.ok(app.includes('renderProgressComparison'));
assert.ok(app.includes("if(tab==='fights')"));
assert.ok(app.includes('Locally outnumbered'));
assert.ok(app.includes('Pre-14 clean duel'));
assert.ok(app.includes('Clean solo-kill lane conversion'));
assert.ok(app.includes('Clean solo-kill conversion rate'));
assert.ok(app.includes('Item-spike window'));
assert.ok(app.includes('Major-item spike utilization'));
assert.ok(app.includes('Earlier-item windows used'));
assert.ok(app.includes('Solo-kill deaths before next shop'));
assert.ok(app.includes('Deaths before shop after solo kill'));
assert.ok(app.includes('Outside-pressure lane deaths'));
assert.ok(app.includes('CS swing 15→25'));
assert.ok(app.includes('Outside-pressure share of early lane deaths'));
assert.ok(app.includes('solo death to role opponent'));
assert.ok(app.includes('Loss rate while outnumbered'));
assert.ok(app.includes('Level-down shared-role fights'));
assert.ok(app.includes('Post-kill conversion'));
assert.ok(app.includes('Prior-frame objective setup'));
assert.ok(app.includes('Vision-action deaths'));
assert.ok(app.includes('Vision-action death rate'));
assert.ok(app.includes('Sample exclusions'));
assert.ok(app.includes('Queue context'));
assert.ok(app.includes('Patch context'));
assert.ok(app.includes('Same-patch self baseline'));
assert.ok(app.includes('Late-reset neutral-objective misses'));
assert.ok(app.includes('r.sessionBehavior||r.sessionModel'),'Session panel must read the report contract name');
assert.ok(app.includes('function renderSpatial'),'Spatial review renderer must remain present');
assert.ok(app.includes('SR_MAP_BOUNDS'),'Spatial review must use the shared Summoner\'s Rift transform');
assert.ok(app.includes('map11.png'),'Spatial review must use the Riot/Data Dragon minimap asset');
assert.ok(html.includes('id="sessionHabitsPanel"'),'Session habits panel must remain in the League page');
assert.ok(html.includes('id="spatialReview"'),'Spatial review panel must remain in the League page');
assert.ok(html.includes('value="50" selected'),'50 raw matches must remain the recommended default fetch depth');
assert.ok(app.includes("value||50"),'frontend fetch fallback must remain 50 raw matches');
assert.ok(api.includes('body.count||50'),'backend fetch fallback must remain 50 raw matches');
assert.ok(api.includes('peer_rank_backfilled'),'fetch finish must expose final-sample peer-rank backfill count');
assert.ok(api.includes('comparable_cached_games'),'fetch finish must expose comparable cached sample size');
assert.ok(api.includes('recommend_deeper_cache'),'fetch finish must signal a thin comparable cache');
assert.ok(api.includes('peerRankTargetCount'),'fetch finish must target only the comparable final sample');
assert.ok(app.includes('rank snapshots backfilled'),'frontend must report peer-rank backfill results');
assert.ok(app.includes('100-match cache depth'),'frontend must warn when the comparable cache cannot fill Last 20');
assert.ok(api.includes('w.objectiveSetup=allObjectives.some'),'Per-ward objective-setup evidence must be preserved');
assert.ok(app.includes('function worldToMapPoint'));
assert.ok(app.includes('minX:-120'));
assert.ok(app.includes('maxX:14870'));
assert.ok(app.includes('minY:-120'));
assert.ok(app.includes('maxY:14980'));
assert.ok(app.includes('renderSpatial'));
assert.ok(!app.includes("['DQI'"));
assert.ok(!app.includes("['AGOR'"));
assert.ok(html.includes('id="spatialReview"'));
assert.ok(app.includes('Game 3+ gold @15 delta'));
assert.ok(app.includes('High-risk deaths while ahead'));
assert.ok(app.includes('High-risk deaths while behind'));
assert.ok(app.includes('Costly measured deaths'));
assert.ok(app.includes('Costly deaths / game'));
assert.ok(app.includes('prior-frame setup'));

const refs=[...app.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]);
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.deepEqual([...new Set(refs.filter(x=>!ids.includes(x)))],[]);
assert.deepEqual([...new Set(ids.filter((x,i)=>ids.indexOf(x)!==i))],[]);

for(const table of ['league_profiles_v1','league_match_cache_v1','league_fetch_runs_v1','league_analysis_runs_v1']){
  assert.ok(migration.includes('alter table public.'+table+' enable row level security'));
  assert.ok(migration.includes('revoke all on public.'+table+' from anon, authenticated'));
}
console.log('league-web-contract=PASS');

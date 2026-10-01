import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const api=fs.readFileSync('supabase/functions/league-api-v1/index.ts','utf8');
const app=fs.readFileSync('league/app.js','utf8');
const html=fs.readFileSync('league/index.html','utf8');
const css=fs.readFileSync('league/styles.css','utf8');
const migration=fs.readFileSync('supabase/migrations/20261001043000_league_web_foundation_v1.sql','utf8');

assert.doesNotThrow(()=>new vm.Script(app,{filename:'league/app.js'}),'league/app.js must remain valid browser JavaScript');

assert.ok(api.includes('x-gejast-session'));
assert.ok(api.includes('x-riot-api-key'));
assert.ok(api.includes('Access-Control-Allow-Headers'));
assert.ok(api.includes('const hasNum='));
assert.ok(api.includes('fightProfile'));
assert.ok(api.includes('killConversionWindows'));
assert.ok(api.includes('lateResetObjectiveMissRate'));
assert.ok(api.includes('championBehaviorModel'));
assert.ok(api.includes('opponentMatchupBehaviorModel'));
assert.ok(api.includes('buildReplayReviewQueue'));
assert.ok(api.includes('buildPracticeTargets'));
assert.ok(api.includes('practiceTargets'));
assert.ok(api.includes('source:"self_relative_short_term"'));
assert.ok(api.includes('windowGames:5'));
assert.ok(api.includes('replayReviewQueue'));
assert.ok(api.includes('if(n>=2)continue'));
assert.ok(api.includes('if(selected.length>=10)break'));
assert.ok(api.includes('matchupBehavior:matchupModel.profiles'));
assert.ok(api.includes('higherRankPeerGames'));
assert.ok(api.includes('recentTrend'));
assert.ok(api.includes('damageGoldEfficiency'));
assert.ok(api.includes('totalTimelineDeaths=validTimeline.reduce'),'Death-trade aggregates must be declared before coaching uses them');
const behaviorStart=api.lastIndexOf('behaviorSummary:{');
const behaviorEnd=api.indexOf('\n  };',behaviorStart);
assert.ok(behaviorStart>=0&&behaviorEnd>behaviorStart,'Behavior summary export block must exist');
const behaviorExport=api.slice(behaviorStart,behaviorEnd);
for(const field of [
  'phaseRisk','midRouting','closing25','deathTradeRate','highRiskUntradedDeaths','highRiskUntradedPerGame',
  'measuredDeathConsequences','costlyDeathEvents','severeDeathEvents','costlyDeathRate','costlyDeathsPerTimelineGame','severeDeathsPerTimelineGame','avgGoldSwingAfterDeath','avgCsSwingAfterDeath',
  'repeatDeathOpportunities','repeatDeaths','repeatDeathRate','highRiskRepeatDeaths','costlyRepeatDeaths','opponentRepeatDeathRate','repeatDeathRateDelta',
  'earlyLeadGames','earlyLeadGivebackGames','earlyLeadGivebackRate','avgEarlyLeadPeakGold','avgEarlyLeadGoldSwingTo15','earlyLeadGivebackDeaths','earlyLeadGivebackHighRiskDeaths',
  'majorReadinessGames','delayedMajorCompletionGames','avgMajorCompletionDelayMin','majorReadinessPeerGames','avgMajorCompletionDelayVsPeerMin',
  'itemSpikeEligibleWindows','itemSpikeUtilizedWindows','itemSpikeUtilizationRate','itemSpikeDeathsBeforeImpact','avgItemSpikeLeadSec',
  'fightSamples','firstAllyFightDeathRate','preContributionFightDeathRate','fightSurvivalRate',
  'highUnspentFightRate','itemDisadvantageFightRate','goldDeficitFightRate',
  'killConversionRate','opponentKillConversionRate','killConversionDelta',
  'neutralObjectiveEvents','earlySetupObjectiveJoinRate','earlySetupObjectiveCoverageRate','lateResetObjectiveMissRate','freshPurchaseObjectiveJoinRate',
  'objectiveSetupWardRate','objectiveSetupWardRateDelta','visionActions','visionActionDeaths','visionActionDeathRate','highRiskVisionActionDeaths','highRiskVisionActionDeathsPerGame','unsupportedVisionActionDeaths','damageGoldEfficiency'
])assert.ok(behaviorExport.includes(field),'Behavior summary must export '+field);
assert.ok(api.includes('objectiveDiagnosis'));
assert.ok(api.includes('sessionBehaviorModel'));
assert.ok(api.includes('highRiskLeadDeathsPerGame'));
assert.ok(api.includes('riskStateDeaths'));
assert.ok(api.includes('highRiskBehindDeathsPerGame'));
assert.ok(api.includes('preNeutralObjectiveSideLaneDeathsPerGame'));
assert.ok(api.includes('postImpactRisk'));
assert.ok(api.includes('highRiskUntradedPostImpactPerGame'));
assert.ok(api.includes('isolatedSideLaneDeathRate'));
assert.ok(api.includes('itemDisadvantageFightRate'));
assert.ok(api.includes('outnumberedFightLossRate'));
assert.ok(api.includes('roleLevelDisadvantageFightRate'));
assert.ok(api.includes('rolePeerNear'));
assert.ok(api.includes('pre14RoleSoloDeaths'));
assert.ok(api.includes('soloKillConversionRate'));
assert.ok(api.includes('soloKillStructureConversionRate'));
assert.ok(api.includes('pre14PlateDelta'));
assert.ok(api.includes('avgSoloKillGoldSwingTo15'));
assert.ok(api.includes('avgSoloKillCsSwingTo15'));
assert.ok(api.includes('soloKillDeathsBeforeShopRate'));
assert.ok(api.includes('firstResetLossRate'));
assert.ok(api.includes('avgFirstResetGoldSwing'));
assert.ok(api.includes('avgFirstResetCsSwing'));
assert.ok(api.includes('avgFirstResetTimingDelta'));
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
assert.ok(app.includes('practiceTargetHtml'));
assert.ok(app.includes('previousPracticeTargetOutcomes'));
assert.ok(app.includes('curRole!==prevRole'));
assert.ok(app.includes('Number(curQueue)!==Number(prevQueue)'));
assert.ok(app.includes('curPatch!==prevPatch'));
assert.ok(app.includes("'moving closer'"));
assert.ok(html.includes('id="practiceOutcome"'));
assert.ok(app.includes('Next 5 comparable games'));
assert.ok(app.includes('based on '));
assert.ok(app.includes('renderProgressComparison'));
assert.ok(app.includes("if(tab==='fights')"));
assert.ok(app.includes("if(tab==='phases')"));
assert.ok(app.includes('Early-phase high-risk deaths'));
assert.ok(app.includes('Mid-routing comparable games'));
assert.ok(app.includes('Win rate from role lead @25'));
assert.ok(app.includes('Lead@25 losses with late risk'));
assert.ok(app.includes('Wins when ≥500g ahead @25'));
assert.ok(app.includes('Mid routing objective presence'));
assert.ok(app.includes('Late high-risk deaths / game'));
assert.ok(app.includes('Locally outnumbered'));
assert.ok(app.includes('Pre-14 clean duel'));
assert.ok(app.includes('Clean solo-kill lane conversion'));
assert.ok(app.includes('Clean solo-kill conversion rate'));
assert.ok(app.includes('Solo-kill structure conversion'));
assert.ok(app.includes('Item-spike window'));
assert.ok(app.includes('First-reset loss rate'));
assert.ok(app.includes('Post-reset role-CS swing'));
assert.ok(app.includes('Early-lead give-back rate'));
assert.ok(app.includes('Peak pre-15 role lead'));
assert.ok(app.includes('≥500g pre-15 lead opportunities'));
assert.ok(app.includes('Major-item spike utilization'));
assert.ok(app.includes('Major affordability sample'),'Frontend must surface recipe-aware first-major affordability evidence');
assert.ok(app.includes('Avg affordable → purchase delay'),'Frontend must expose affordability-to-purchase delay');
assert.ok(app.includes('Readiness delay vs peer'),'Frontend must expose recipe-aware delay versus the direct role opponent');
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
assert.ok(app.includes('Objective diagnosis'));
assert.ok(app.includes('Primary supported cause'));
assert.ok(app.includes('Vision-action deaths'));
assert.ok(app.includes('Vision-action death rate'));
assert.ok(app.includes('Sample exclusions'));
assert.ok(html.includes('Repeated opponent matchups'));
assert.ok(html.includes('Highest-value moments to review'));
assert.ok(app.includes('renderReplayReviewQueue'));
assert.ok(app.includes('openReplayReviewMatch'));
assert.ok(app.includes('review-open'));
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
assert.ok(app.includes('function perGameSpatialHtml'),'Expanded matches must retain their per-game spatial renderer');
assert.ok(app.includes("['map','macro'"),'Expanded match tabs must retain the native Map tab');
assert.ok(app.includes('g.deathPositions'),'Per-game map must use preserved raw player death positions');
assert.ok(app.includes('Map renderer unavailable for mapId'),'Non-Summoner’s Rift games must not be forced onto map11');
assert.ok(app.includes('numbered chronologically'),'Per-game death map must preserve chronological marker correspondence');
assert.ok(css.includes('.detail-map-grid'),'Per-game map layout styling must remain present');
assert.ok(css.includes('.map-marker-label'),'Numbered death marker styling must remain present');
assert.ok(!app.includes("['DQI'"));
assert.ok(!app.includes("['AGOR'"));
assert.ok(html.includes('id="spatialReview"'));
assert.ok(app.includes('Game 3+ gold @15 delta'));
assert.ok(app.includes('High-risk deaths while ahead'));
assert.ok(app.includes('High-risk deaths while behind'));
assert.ok(app.includes('Isolated side-lane deaths'));
assert.ok(app.includes('Pre-objective side-lane deaths'));
assert.ok(app.includes('Post-impact deaths'));
assert.ok(app.includes('High-risk post-play give-backs / game'));
assert.ok(app.includes('Costly measured deaths'));
assert.ok(app.includes('Rapid repeat deaths'));
assert.ok(app.includes('Rapid repeat-death rate'));
assert.ok(app.includes('Repeat-death rate delta'));
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

assert.ok(css.includes('.objective-diagnosis'),'Objective diagnosis must have dedicated styling');

assert.ok(app.includes('practice-supporting'),'Practice plan must expose supporting evidence');
assert.ok(app.includes('Why this is a priority'),'Practice plan must explain why a theme ranked highly');
assert.ok(css.includes('.practice-supporting'),'Practice supporting evidence must be styled');

assert.ok(api.includes('High-risk post-play give-backs / game'),'Align diagnosed root causes with measurable practice targets');
assert.ok(api.includes('Late-reset objective miss rate'),'Objective reset diagnosis must have a direct measurable target');
assert.ok(api.includes('Pre-objective side-lane deaths / game'),'Side-lane diagnosis must have a direct measurable target');

assert.ok(api.includes('function majorItemReadiness('),'recipe-aware first-major readiness helper must remain explicit');
assert.ok(api.includes('Number(me.currentGold)>=combineCost'),'first-major readiness must require current gold to cover the remaining combine cost');
assert.ok(api.includes('base.delayMin>=1.5'),'delayed first-major completion threshold must remain explicit');
assert.ok(api.includes('out.majorItemReadiness=majorItemReadiness('),'per-game first-major readiness evidence must remain exported');
assert.ok(api.includes('earlyLeadWindow:{eligible:false'),'per-game early lead state must remain explicit');
assert.ok(api.includes('Number(peak.goldDiff)>=500'),'early lead opportunity threshold must remain +500g');
assert.ok(api.includes('giveback:swing<=-500'),'early lead give-back threshold must remain a 500g loss from peak');
assert.ok(api.includes('preserved:swing>=-250'),'early lead preservation tolerance must remain 250g');
assert.ok(api.includes('behaviorSummary.earlyLeadGivebackRate'),'Next-5 target path must remain tied to the exported early-lead rate');
assert.ok(api.includes('Review where this early lead started to unwind'),'replay queue must keep early-lead review moments');

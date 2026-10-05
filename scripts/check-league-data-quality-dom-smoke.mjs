import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app=fs.readFileSync('league/app.js','utf8');

function functionSource(name){
  const marker=`function ${name}(`,start=app.indexOf(marker);
  assert.notEqual(start,-1,`${name} must remain defined in league/app.js`);
  const bodyStart=app.indexOf('{',start);
  let depth=0,quote='',escaped=false,lineComment=false,blockComment=false;
  for(let i=bodyStart;i<app.length;i++){
    const ch=app[i],next=app[i+1];
    if(lineComment){if(ch==='\n')lineComment=false;continue;}
    if(blockComment){if(ch==='*'&&next==='/'){blockComment=false;i++;}continue;}
    if(quote){
      if(escaped){escaped=false;continue;}
      if(ch==='\\'){escaped=true;continue;}
      if(ch===quote)quote='';
      continue;
    }
    if(ch==='/'&&next==='/'){lineComment=true;i++;continue;}
    if(ch==='/'&&next==='*'){blockComment=true;i++;continue;}
    if(ch==='\''||ch==='"'||ch==='`'){quote=ch;continue;}
    if(ch==='{')depth++;
    if(ch==='}'&&--depth===0)return app.slice(start,i+1);
  }
  assert.fail(`${name} must have a complete function body`);
}

const elements={
  qualityGrid:{innerHTML:''},
  sourceNote:{textContent:''}
};
const context={
  elements,
  $:id=>{
    assert.ok(elements[id],`renderQuality wrote unexpected DOM node ${id}`);
    return elements[id];
  },
  esc:v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])),
  hasNum:v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v)),
  fmtPct:v=>Number.isFinite(Number(v))?Number(v).toFixed(1)+'%':'n/a',
  fmtInt:v=>Number.isFinite(Number(v))?String(Math.round(Number(v))):'n/a',
  roleLabel:v=>String(v||'GENERIC'),
  adcBenchmarkUnavailableReason:()=> 'external benchmark withheld'
};
vm.createContext(context);
vm.runInContext(
  `${['evidenceLevel','qualityCard','qualityEvidenceDetail','renderQuality'].map(functionSource).join('\n')}\nthis.renderQuality=renderQuality;`,
  context,
  {filename:'league/app.js#data-quality-dom-smoke'}
);

context.renderQuality({
  summary:{primaryRole:'ADC'},
  dataQuality:{
    selectedRole:'ADC',
    analyzedGames:4,
    coachingRoleGames:2,
    dominantQueueId:420,
    dominantQueueFamily:'standard_pvp_sr',
    dominantQueueGames:2,
    queueSelection:{considered:4,windowSize:20},
    excludedUnsupportedQueues:1,
    unsupportedQueueIds:[900],
    excludedOtherSupportedQueues:0,
    excludedShortGames:0,
    excludedOtherMaps:0,
    excludedOtherRoles:3,
    excludedMissingRole:1,
    excludedAmbiguousRole:1,
    excludedBeyondLast20:6,
    validTimelineGames:'unavailable',
    peerComparableGames:1,
    rankedPeerGames:0,
    excludedLowConfidenceDirectPeerGames:2,
    ambiguousDirectPeerGames:1,
    missingDirectPeerGames:1,
    currentPublicPatchKey:'16.19',
    currentPatchRoleGames:2,
    olderSamePatchRoleGames:0,
    crossPatchBaselineRoleGames:4,
    coachingBaselineRoleGames:0,
    roleQuestRevisionCounts:{'adc_26.9_40g_takedown':2},
    mechanicsCohortGames:2,
    primaryRoleGamesInLast20:2,
    mechanicsCohortApplied:false,
    mixedMechanicsFallback:true,
    itemCatalogExactPatches:0,
    itemCatalogFallbackPatches:1,
    itemCatalogUnknownPatchGames:1,
    positionEvidenceModel:'nearest_timeline_frame_within_35s',
    positionEvidenceMaxDeltaMs:35000,
    unresolvedItemUndoEvents:1,
    gamesWithUnresolvedItemUndo:1,
    fallbackPlayerRoleGames:1,
    fallbackDirectPeerRoleGames:1
  },
  behaviorSummary:{fightSamples:3,neutralObjectiveEvents:2,checkpointEligibility:{lane15Games:0,fixed15to25Games:0,closing25Games:0}},
  peerComparison:{visionWardTotal:5},
  externalBenchmarks:{eligible:false},
  sourceStatus:{note:'Synthetic report smoke.'}
});

const html=elements.qualityGrid.innerHTML;
const note=elements.sourceNote.textContent;
assert.match(html,/Queue context[\s\S]*thin sample — descriptive only; do not treat this rate as stable yet/,'thin queue evidence must render as descriptive-only, not stable');
assert.match(html,/Timeline coverage[\s\S]*evidence unavailable — unknown, not zero/,'unavailable timeline evidence must render as unknown rather than zero');
assert.match(html,/Queue context[\s\S]*unsupported special\/bot queue game\(s\) excluded before coaching\/benchmarks, not counted as losses or zero-rate events/,'unsupported queue exclusions must not be rendered as losses or zero-rate evidence');
assert.match(html,/Sample exclusions[\s\S]*unsupported special\/bot queues \[900\] fail closed outside the report cohort/,'unsupported queue sample exclusions must render as fail-closed outside the report cohort');
assert.match(note,/Thin-evidence areas right now:[\s\S]*unsupported special\/bot Summoner’s Rift queues excluded/,'source note must include unsupported queues in thin-evidence summary');
assert.match(note,/direct-peer comparisons/,'source note must keep thin evidence summary for peer-comparison coverage');

console.log('League Data Quality DOM smoke OK');

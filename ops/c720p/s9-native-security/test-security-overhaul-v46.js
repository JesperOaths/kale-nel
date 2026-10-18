#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const base='ops/c720p/s9-native-security/';
const read=name=>fs.readFileSync(base+name,'utf8');
const people=read('security-people-v45.js');
const peopleHtml=read('security-people-v45.html');
const archive=read('security-archive-v7.html');
const records=read('security-review-v8.html');
const tracks=read('security-tracks-v7.html');
const camera=read('src/nl/kalenel/s9security/CameraService.java');
const outfit=read('src/nl/kalenel/s9security/OutfitEvidence.java');
for(const [label,source] of [['archive',archive],['recordings',records],['tracks',tracks],['people',peopleHtml]]){
 assert(!/<script[^>]+src="[^"]*security-video-playback/.test(source),label+': obsolete smooth-copy loader must be removed');
 for(const script of source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g))
  new vm.Script(script[1],{filename:label+'.inline.js'});
}
new vm.Script(people);
assert(archive.includes("showSource('local');"),'S9+ must be selected initially');
assert(archive.includes("a.fetch('/new/api/drive-saved'"),'Keep historical Drive archive selectable');
for(const source of [archive,records,tracks]){
 assert(source.includes('personFilingControls('),'All source playback views need filing actions');
 assert(source.includes('manual-original-review-links-v1'),'File decisions must use authenticated audited route');
 assert(source.includes('human_confirmed:true'),'Never auto-assign people');
}
assert(peopleHtml.includes('value="100" selected'),'Review defaults to 100 original recordings');
assert(people.includes('batch.revision!==next.revision'),'Pages must be consistent under concurrent reviews');
assert(people.includes('Array.from(host.children).some'),'A recording must not appear twice in a person');
assert(people.includes("String(a.label||'').localeCompare"),'Saved people must sort A-Z');
assert(people.includes('searchClothingMatches()'),'Outfit matches use approved reference recordings');
assert(people.includes("upper_clothing")&&people.includes("lower_clothing"),
 'Outfit suggestions require independent upper and lower garment similarity');
assert(people.includes('u<.90||l<.88'),'Reject weak one-colour-only outfit matches');
assert(!people.includes("groupRows($('clothingList'))"),'Retire unverified provisional-cluster gallery');
assert(people.includes('Recheck person evidence'),'Human recheck action must be visible');
assert(records.includes("'/new/api/drive-person-review'"),'Drive inference results must join archived footage');
assert(records.includes('processingDistribution')&&records.includes('durationDistribution')&&records.includes('sourceDistribution'),
 'Evidence must show three distinct useful analytics');
assert(records.includes('.evidence-mode .evidence-summary,.evidence-mode .statrow') &&
       records.includes('.evidence-mode .layout{display:none!important}'),
 'Evidence must not duplicate Recordings and Archive browsers');
assert(!records.includes('#list{max-height:440px}'),'Avoid invisible last recording due to nested scroll cap');
assert(tracks.includes('directionChart')&&tracks.includes('timeOfDayChart'),
 'Movement needs independently useful direction and hour summaries');
assert(camera.includes('QUIET_MS=5000,MIN_EVENT_RECORD_MS=10000,MAX_MS=120000'));
assert(camera.includes('requested_preroll_ms",5000'),'Expose requested preroll metadata');
assert(outfit.includes('RGBToHSV')&&outfit.includes('Math.sqrt(here*other)'),
 'HSV appearance score must use normalized histogram affinity');
assert(outfit.includes('appearance_matching_policy')&&outfit.includes('VERSION.equals(metadata.optString'),
 'Incompatible and unreviewed outfit versions must not silently match');
console.log('S9_SECURITY_OVERHAUL_V46_SOURCE_CONTRACT_PASS');

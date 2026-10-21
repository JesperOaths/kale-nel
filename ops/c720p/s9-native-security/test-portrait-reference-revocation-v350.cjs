#!/usr/bin/env node
'use strict';
// Read-only test: no media files or real human decisions are opened.
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const src=fs.readFileSync('ops/c720p/s9-native-security/security-people-v45.js','utf8');
const extract=(a,b)=>{const start=src.indexOf(a),end=src.indexOf(b,start);assert(start>=0&&end>start);return src.slice(start,end)};
assert.equal(src.split('QUALIFIED_PORTRAIT_REVOCATION_V350').length-1,1);
const helper=extract('function qualifiedOutfitReference(', 'function outfitReviewEligible(');
const portrait=extract('function automaticPortrait(f){','function representativeReviewedImage(f){');
const representative=extract('function representativeReviewedImage(f){','function profileRow(f){');
assert(!portrait.includes('folder.previews'),'historical previews must never admit new portrait');
assert(portrait.includes('qualifiedOutfitReference('),'portrait must recheck current manual approval');
assert(representative.includes('qualifiedOutfitReference('),'fallback must recheck current manual approval');
const clip='motion_1790000000000.mp4';
const face={clip,face:{snapshot_name:'motion_1790000000000__face__1000_0.jpg',snapshot_sha256:'a'.repeat(64),snapshot_size:10000,snapshot_on_s9:true}};
const state={
 assignedReady:true,extraLinks:{items:{}},legacyAssigned:new Map(),folder:'',doc:null,
 clipEvidence:new Map([[clip,{person_count:1,person_tracks:[]}]]),faceList:[face],
};
const people=[{id:'personA',label:'A',approved_clips:1,previews:[{clip}]},{id:'personB',label:'B',approved_clips:1,previews:[{clip}]}];
const ctx={state,
 assignmentKey:x=>x.source+':'+x.name,
 assignedFolders:x=>{const key=x.source+':'+x.name,entry=state.extraLinks?.items?.[key];return entry===undefined?(state.legacyAssigned.has(key)?[state.legacyAssigned.get(key)]:[]):(Array.isArray(entry.folders)?entry.folders:entry.folder?[entry.folder]:[])},
 savedFolders:()=>people,
 folderApprovedSDClips:()=>new Set([clip]),reliableFaces:()=>[face],
 num:x=>Number(x)||0,mediaForFace:()=>({fake:'image'}),
 faceName:/^motion_.*\.jpg$/
};
vm.createContext(ctx);vm.runInContext(helper+portrait+representative,ctx);
const picked=id=>ctx.automaticPortrait(people.find(x=>x.id===id));
const fallback=id=>ctx.representativeReviewedImage(people.find(x=>x.id===id));
state.legacyAssigned.set('sd:'+clip,'personA');
assert.equal(picked('personA')?.clip,clip,'current legacy approved original accepted');
assert.equal(picked('personB'),null,'historical preview in wrong person rejected');
state.extraLinks.items['sd:'+clip]={review_status:'assigned',folders:['personA','personB']};
assert.equal(picked('personA'),null,'group original must not label specific face');
assert.equal(fallback('personA'),null,'group original must not become default fallback image');
for(const status of ['skipped','rejected','inbox']){
 state.extraLinks.items['sd:'+clip]={review_status:status,folders:status==='inbox'?[]:['personA']};
 assert.equal(picked('personA'),null,status+' must revoke portrait');
 assert.equal(fallback('personA'),null,status+' must revoke fallback');
}
state.extraLinks.items['sd:'+clip]={review_status:'assigned',folders:['personB']};
assert.equal(picked('personA'),null,'reassignment revokes A');
assert.equal(picked('personB')?.clip,clip,'reassignment enables current B');
state.assignedReady=false;assert.equal(picked('personB'),null,'incomplete manual inventory fails closed');
console.log('S9_PORTRAIT_REFERENCE_REVOCATION_V350 current-review revocation cases passed');

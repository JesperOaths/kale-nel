#!/usr/bin/env node
// Fail-closed group-reference and latest-manual-decision regression.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('ops/c720p/s9-native-security/security-people-v45.js','utf8');
const start=source.indexOf('// QUALIFIED_OUTFIT_REFERENCE_REVOCATION_V319');
const end=source.indexOf('function outfitReviewEligible(',start);
assert(start>=0&&end>start,'reference admission helper must be installed exactly once');
assert.equal(source.split('QUALIFIED_OUTFIT_REFERENCE_REVOCATION_V319').length-1,1);
assert(source.includes("const sources=state.archiveEntries.filter(x=>qualifiedOutfitReference(x)&&"));
assert(source.includes('if(!qualifiedOutfitReference(ref))continue;'));
assert(source.includes('match.references.every(clip=>'));
assert(source.includes("qualifiedOutfitReference({source:'sd',name:clip,clip},match.person.id)"));
const state={assignedReady:true,extraLinks:{items:{}},legacyAssigned:new Map()};
const ctx={state,assignmentKey:x=>x.source+':'+x.name,
 assignedFolders:x=>{const entry=state.extraLinks.items[x.source+':'+x.name];
 if(entry!==undefined)return entry.folders===undefined?
   (entry.folder?[entry.folder]:[]):entry.folders;
 return state.legacyAssigned.has(x.source+':'+x.name)?
    [state.legacyAssigned.get(x.source+':'+x.name)]:[];
}};
vm.createContext(ctx);
vm.runInContext(source.slice(start,end),ctx);
const admit=ctx.qualifiedOutfitReference;
const item={source:'sd',name:'motion_1790000000000.mp4'};
state.legacyAssigned.set('sd:'+item.name,'personA');
assert.equal(admit(item,'personA'),true,'legacy verified single-person reference stays eligible');
assert.equal(admit(item,'personB'),false,'wrong person denied');
state.extraLinks.items['sd:'+item.name]={review_status:'assigned',folders:['personA','personB']};
assert.equal(admit(item,'personA'),false,'multi-person group excluded, not attributed to first folder');
state.extraLinks.items['sd:'+item.name]={review_status:'inbox',folders:[]};
assert.equal(admit(item,'personA'),false,'returned-to-queue revokes previous V40 reference');
state.extraLinks.items['sd:'+item.name]={review_status:'skipped',folders:['personA']};
assert.equal(admit(item,'personA'),false,'skipped source is ineligible');
state.extraLinks.items['sd:'+item.name]={review_status:'rejected',folders:['personA']};
assert.equal(admit(item,'personA'),false,'rejected source is ineligible');
state.extraLinks.items['sd:'+item.name]={review_status:'assigned',folders:['personB']};
assert.equal(admit(item,'personA'),false,'reassignment revokes old-person reference');
assert.equal(admit(item,'personB'),true,'current single-person assignment works');
state.assignedReady=false;
assert.equal(admit(item,'personB'),false,'stale partial source state fails closed');
state.assignedReady=true;state.extraLinks=null;
assert.equal(admit(item,'personB'),false,'missing manual source fails closed');
assert.equal(admit({source:'drive',name:item.name},'personB'),false,'SD biometrics cannot bind Drive clips');
console.log('QUALIFIED_OUTFIT_REFERENCE_REVOCATION_V319 passed: 11 authority and reindex guards');

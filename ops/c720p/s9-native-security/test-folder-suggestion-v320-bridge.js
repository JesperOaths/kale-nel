#!/usr/bin/env node
'use strict';
/* V321 versioned bridge regression: source-only, no camera or authenticated browser needed. */
const fs = require('node:fs'), path=require('node:path');
const assert=require('node:assert/strict');
const dir=__dirname;
const js=fs.readFileSync(path.join(dir,'security-people-v321.js'),'utf8');
const html=fs.readFileSync(path.join(dir,'security-people-v51.html'),'utf8');
const script='/local/frontyard-security-new/folder-suggestion-cards-v1.js';
const native='/local/frontyard-security-new/security-people-v321.js';
function one(source,needle) {
  assert.equal(source.split(needle).length-1,1,'expected exactly one '+needle);
}
one(html,'id="folderRankedCards"');
assert(!fs.readFileSync(path.join(dir,'security-people-v50.html'),'utf8').includes('folderRankedCards'),
  'Protected V50 must never gain hidden pending UI controls');
assert(!fs.readFileSync(path.join(dir,'security-people-v320.js'),'utf8').includes('renderVerifiedFolderSuggestions'),
  'Protected V320 must remain byte-identical to deployed baseline');
one(html,script);
one(html,native);
assert(html.indexOf(script)<html.indexOf(native),'renderer must load before main UI');
one(js,'function renderVerifiedFolderSuggestions()');
one(js,' renderVerifiedFolderSuggestions();');
assert(js.includes("typeof signed?.openAndAttest==='function'"),
  'review cards require signed opened-media hook');
assert(js.includes("typeof window.FolderSuggestionCards?.connect==='function'"),
  'viewer is optional');
assert(js.includes('host.hidden=!available'),'missing hook must hide whole feature');
assert(js.includes('hook.openAndAttest(row,()=>startVideo(clip))'),
  'server-bound proof must originate from the actual opened clip');
assert(js.includes("assignmentKey(x)===row.source_qualified_clip_id"),
  'same basename SD and Drive must not be mixed');
assert(js.includes("onSaved:()=>{if(state.pane==='folder'&&state.folder===personId)loadView();}"));
assert(js.includes("openFolderEditor('create')"));
assert(js.includes('Review each original before filing'));
assert(!js.includes("FolderSuggestionCards.connect(host,{\n    relay:relay(),folderId:personId,showProvisional:true,\n    onOpen:async row=>{\n     const clip=state.archiveEntries.find(x=>assignmentKey(x)===row.source_qualified_clip_id);\n     if(!clip)return {verified:true}"),
  'missing clip must not be marked verified');
assert(!/S9SignedOriginalReview\s*=/.test(js),'no synthetic signed attestor');
assert(js.includes("const saved=new Set(savedFolders().map(p=>p.id))"),
  'preserve existing automatic person gating');
assert(js.includes("function startVideo(item)"),
  'keep existing authenticated original player');
assert(js.includes("async function manualLink(item,folder,reviewAction=null)"),
  'keep existing human assignment workflow');
console.log('V321_OPTIONAL_FOLDER_REVIEW_BRIDGE_PASS');

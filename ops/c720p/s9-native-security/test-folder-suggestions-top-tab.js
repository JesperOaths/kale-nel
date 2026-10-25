#!/usr/bin/env node
'use strict';
// Offline controller/navigation acceptance. No private media or relay access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = __dirname;
const html = fs.readFileSync(path.join(root, 'security-people-v52.html'), 'utf8');
const nav = fs.readFileSync(path.join(root, 'security-people-v325.js'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'folder-suggestions-top-tab-v1.js'), 'utf8');
assert.match(html, /data-pane="suggestions" aria-selected="false"/);
assert.match(html, /id="suggestionsTabCount"/);
assert.match(html, /<section id="suggestions" hidden/);
assert.match(html, /id="liveFolderSuggestionCards"/);
assert.match(html, /folder-suggestions-top-tab-v1\.js/);
assert.match(html, /security-people-v325\.js/);
assert.doesNotMatch(html, /folder-suggestions-panel-v1\.js/);
assert.match(nav, /'automatic','suggestions','folderView'/);
assert.match(nav, /if\(pane==='suggestions'\)/);
assert.match(nav, /people-folder-suggestions-open/);

class Element {
  constructor(name) { this.name=name; this.textContent=''; this.hidden=false;this.disabled=false;
    this.style={cssText:''};this.nodeType=1;
    this.handlers=new Map();this.children=[];this.attributes={}; }
  setAttribute(key,value) {this.attributes[key]=value;}
  addEventListener(kind,handler){this.handlers.set(kind,handler);}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  remove(){}
}
const ids = Object.fromEntries(
  ['suggestions','suggestionsTabCount','liveFolderSuggestionCards','refreshSuggestions']
  .map(id=>[id,new Element('div')])
);
ids.suggestions.hidden=true;
let requests=0;
const valid = { schema:'folder_suggestions_v1', status:'human_review_only',
  historic_review_index_verified:true, verified_media_evidence:true,
  raw_embeddings_exposed:false, automatic_assignments:0,
  probabilities:false, identity_probabilities:false,
  matches:[{state:'pending_review',safe:true},{state:'pending_review',safe:false}]};
let failure=false,sessionHeader=false,loads=0,connectOptions=null;
const listeners=new Map();
const window={
  C720PSecureRelay:{
    fetch: async (_path,opts)=>{requests++;sessionHeader=opts.headers.has('X-S9-Review-Session');
      return {ok:!failure,json:async()=>valid};},
    url: async path=>'http://example.invalid'+path
  },
  addEventListener:(kind,fn)=>listeners.set(kind,fn),
  dispatchEvent:(e)=>{listeners.get(e.type)?.();}
};
window.parent=window;
window.FolderSuggestionCards={
  safeMatch:row=>row.safe===true,
  connect:async (_host,opts)=>{loads++;connectOptions=opts;opts.onSnapshot(valid);return{visible:1};}
};
const ctx={window,document:{getElementById:id=>ids[id],createElement:t=>new Element(t),
  body:new Element('body'),addEventListener(){},hidden:false},
  crypto:{getRandomValues:arr=>arr.fill(23)},Uint8Array,Headers,Promise,
  setInterval:()=>0,setTimeout:()=>0,clearTimeout(){},encodeURIComponent,console};
vm.runInNewContext(controller,ctx,{filename:'folder-suggestions-top-tab-v1.js'});
(async()=>{
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ids.suggestionsTabCount.textContent,'1','badge counts eligible matches only');
  assert.equal(sessionHeader,true,'relay must carry authenticated review session');
  ids.suggestions.hidden=false;
  window.dispatchEvent({type:'people-folder-suggestions-open'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(loads,1,'top-level nav loads existing verified cards renderer');
  assert(connectOptions && connectOptions.onPreview && connectOptions.onOpen);
  const image=connectOptions.onPreview({clip_id:'motion_1790000000000.mp4'});
  assert.equal(image.name,'img','preview thumbnails available');
  assert.equal(connectOptions.showProvisional,true);
  failure=true;
  ids.suggestions.hidden=true;
  await new Promise(resolve=>{
    ids.refreshSuggestions.handlers.get('click')();
    setImmediate(resolve);
  });
  assert.equal(loads,1,'hidden tab never re-renders cards');
  console.log('SUGGESTIONS_TOP_NAV_TEST_PASS badge=1 authenticated=true exclusive_tab=true previews=true');
})().catch(error=>{console.error(error);process.exitCode=1});

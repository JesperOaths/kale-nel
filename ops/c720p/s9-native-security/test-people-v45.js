#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('ops/c720p/s9-native-security/security-people-v45.html','utf8');
const js=fs.readFileSync('ops/c720p/s9-native-security/security-people-v45.js','utf8');
new vm.Script(js,{filename:'security-people-v45.js'});
assert(js.includes('function sceneFor(item)'),'Review must show a full recording scene, not only a tight detection crop');
assert(js.includes('function automaticPortrait(f)'),'Automatic folder portrait required');
assert(js.includes('function scanApprovedFolders('),'Full folder assignment scan required');
assert(js.includes("'/new/api/drive-saved'"),'Historical Drive catalog must be included');
assert(js.includes("'/new/api/s9-manual-recording-links'"),'Use isolated authenticated assignment route');
assert(js.includes('function queueVisibleFace('),'Face previews must be loaded only when visible');
assert(js.includes('credibleFaceCrop(')&&js.includes('Change cover photo'),'Only qualified faces can be portraits; optional override remains');
assert(!/\.innerHTML\s*=/.test(js));
assert(!/id="unassignedFolder"|Clothing appearances grouped into folders/.test(html));
const ids=[...js.matchAll(/\$\('([A-Za-z0-9]+)'\)/g)].map(x=>x[1]);
for(const id of new Set(ids))assert(html.includes('id="'+id+'"'),'Missing rendered control '+id);
for(const label of ['Activity &amp; scan status','Review recordings','People','Your people and groups'])
 assert(html.includes(label),label);
assert(!html.includes('id="approvalConfirmed"'),'Remove redundant second confirmation checkbox');
assert(js.includes('state.lastFolder=folder||state.lastFolder'),'Review queue must retain last selected person');
const keepMarkup=html.split('<dialog id="approvalDialog"')[1]?.split('</dialog>')[0]||'';
assert(keepMarkup.includes('id="approvalFolder"'),'Keep dialog must expose the folder picker');
assert(keepMarkup.includes('id="approvalLabel"'),'Keep dialog must expose new folder input');
assert(keepMarkup.includes('Confirm &amp; keep'),'Positive submit button must clearly confirm reviewed decision');
assert(keepMarkup.includes('id="approvalCancelFooter"'),'Keep dialog must expose cancel');
assert(keepMarkup.includes('type="submit"'),'Keep dialog must have a save control');
assert(keepMarkup.includes('id="approvalPlay"'),'Keep dialog retains the original video button');
assert(!keepMarkup.includes('<img')&&!keepMarkup.includes('id="approvalPreview"')&&!keepMarkup.includes('class="media"'),
 'Keep dialog must contain NO image or media elements that can obscure controls');
assert(html.includes('#approvalDialog{box-sizing:border-box;width:min(490px'),'Keep dialog width must be bounded');
assert(!js.includes("$('approvalPreview').replaceChildren("),'Keep dialog must not inject preview images');

class E{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.handlers={};this.attributes={};this.dataset={};this.style={};
 this.hidden=false;this.disabled=false;this.textContent='';this.value='';this.checked=false;this.src='';this.isConnected=true;this.open=false;this.lastChild=null;}
 append(...arr){this.children.push(...arr);this.lastChild=this.children[this.children.length-1]||null}
 replaceChildren(...arr){this.children=[...arr];this.lastChild=this.children[this.children.length-1]||null}
 add(o){this.append(o)}
 addEventListener(name,handler){this.handlers[name]=handler}
 setAttribute(k,v){this.attributes[k]=String(v)}
 removeAttribute(k){delete this.attributes[k];if(k==='src')this.src=''}
 getAttribute(k){return this.attributes[k]||null}
 querySelector(tag){const t=tag.toUpperCase();return this.children.find(e=>e.tagName===t)||null}
 showModal(){this.open=true}close(){this.open=false}
 load(){}pause(){}remove(){}get duration(){return 20}set currentTime(x){this.seek=x}
}
const idMap=new Map();const el=id=>{if(!idMap.has(id))idMap.set(id,new E());return idMap.get(id)};
const panes=['overview','review','people','clothing'].map(p=>{const b=new E('button');b.dataset.pane=p;return b});
const document={getElementById:el,createElement:t=>new E(t),querySelectorAll:q=>q==='[data-pane]'?panes:[],addEventListener(){}};
const clip='motion_1792200000000.mp4';
const driveClip='historical_2026-05-12_08-30-00.mp4';
const otherClip='motion_1792200500000.mp4';
const item={recorded_ms:1792200000000,clip,source_sha256:'a'.repeat(64),observation:'v1',signature:'b'.repeat(64),
 full_crop:{name:'motion_1792200000000.mp4.t1.abcd.v44.34.full.jpg',time_ms:2500},video_path:'/new/saved/clip/'+clip,
 temporal_support:true,decision:null,entry_zone:'front_garden',memberships:[]};
const saved={id:'G123',label:'Jesper',automatic_appearance_group:false,approved_clips:3,suggested_clips:0,previews:[{name:'motion_1792200000000.mp4.t1.abcd.v44.34.full.jpg'}],approvals_needing_person_recheck:3};
const provisional={id:'P345',label:'Appearance #4',automatic_appearance_group:true,approved_clips:0,suggested_clips:4,previews:[],approvals_needing_person_recheck:0};
let posts=[],linkPosts=[],fetches=[],holdAll=false,releaseHeldAll=null,linkRevision=0,linkItems={};
const relay={url:async p=>'https://signed.example.test/'+encodeURIComponent(p),
 fetch:async (p,opts={})=>{
  fetches.push(p);
  if(p==='/new/api/visual-review/review'||p==='/new/api/s9-manual-recording-links'&&opts.method==='POST'){
   const payload=JSON.parse(opts.body);
   if(opts.headers?.['X-S9-Manual-Link-Intent']){
    linkPosts.push({payload,opts});
    assert.equal(payload.revision,linkRevision);
    linkItems[payload.source+':'+payload.name]={source:payload.source,
      name:payload.name,folder:payload.action==='return_to_queue'?null:payload.folder};
    linkRevision++;
    return {ok:true,json:async()=>({ok:true,revision:linkRevision,
      folder:linkItems[payload.source+':'+payload.name].folder})};
   }
   posts.push({payload,opts});
   return {ok:true,json:async()=>({ok:true,folder:payload.folder||'G123'})};
  }
  if(p==='/new/api/s9-manual-recording-links')
   return {ok:true,json:async()=>({ok:true,revision:linkRevision,items:linkItems,
     manual_links_only:true,automatic_identity_matching:false})};
  if(p==='/new/api/drive-saved')return {ok:true,json:async()=>({
    ok:true,archive_mode:'historical-google-drive',events:[
      {remote_name:driveClip,timestamp:'2026-05-12T08:30:00',snapshot_name:'history.jpg'}
    ]})};
  if(p.startsWith('/new/api/visual-review?')){
   const q=new URLSearchParams(p.split('?')[1]),tab=q.get('tab');
   if(tab==='all'&&holdAll)await new Promise(resolve=>{releaseHeldAll=resolve});
   return {ok:true,json:async()=>({ok:true,revision:0,folders:[saved,provisional],person_detection:
    {assessed_clips:80,total_clips:141,clips_with_supported_people:29,status:'in_progress'},
    inbox_clips:27,total:tab==='inbox'?27:tab==='approved'?1:1,
    items:tab==='approved'?[{...item,decision:'approved'}]:[item],
    reference_examples:tab==='suggestions'?[item]:[]})};
  }
  if(p==='/new/api/saved')return {ok:true,json:async()=>({archive_mode:'S9-microSD-only',events:[
   {clip_no:clip,face_deep_review_version:'s9_onphone_36_samples_overlapping_tiles_v5',
    anonymous_tracks:[
     {id:'Person 1',upper_clothing_colour:'blue',image_movement_direction:'image_left'},
     {id:'Person 2',upper_clothing_colour:'red',image_movement_direction:'insufficient_samples'}],
    face_candidates:[{snapshot_name:'motion_1792200000000__pending_1__6365_0.jpg',time_ms:6365,
    snapshot_size:120000,face_crop_requires_manual_review:true,match_status:'not_tested_no_usable_face'},
    {snapshot_name:'motion_1792200000000__pending_2__8300_0.jpg',time_ms:8300,
    snapshot_size:50000,face_crop_requires_manual_review:true,match_status:'not_tested_no_usable_face'},
    {snapshot_name:null,time_ms:7200,match_status:'not_tested_no_usable_face'}]},
   {clip_no:otherClip,face_deep_review_version:'s9_onphone_36_samples_overlapping_tiles_v5',face_candidates:[]}]})};
  if(p.startsWith('/new/saved/face/'))return {ok:true,status:200};
  throw Error('Unexpected request '+p);
 }};
const window={C720PSecureRelay:relay};window.parent=window;window.addEventListener=()=>{};
const ctx={window,document,Option:class Option{constructor(text,value){this.text=text;this.value=value}},
  URLSearchParams,Date,Promise,Number,String,Array,Math,Map,Set,Object,Error,JSON,RegExp,console};
vm.createContext(ctx);vm.runInContext(js,ctx);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function scan(root,name){if(root.textContent===name&&root.tagName==='BUTTON')return root;for(const c of root.children||[]){
 const match=scan(c,name);if(match)return match;}return null}
(async()=>{
 for(let i=0;i<9;i++)await flush();
 assert.equal(el('people').hidden,false,'Saved people must be the landing page');
 assert.equal(el('savedList').children.length,1,'Show saved person folders immediately');
 assert.equal(el('peopleReviewSummary').textContent,'27 recordings need review');
 assert.equal(el('peopleReviewNotice').hidden,false);
 assert.equal(el('reviewTabCount').textContent,' · 27');
 assert.equal(el('queueCount').textContent,'27');
 assert.equal(el('personCount').textContent,'1');
 assert.equal(el('approvalCount').textContent,'3');
 assert.equal(el('archiveCount').textContent,'3','SD originals plus historical Drive appear in archive');
 assert(!html.includes('data-pane="faces"'),'Face gallery tab must be removed');
 assert(!html.includes('id="faceGrid"'),'Invalid gallery not to be retained');
 assert.equal(el('personScanLabel').textContent,'80 / 141');
 assert.equal(el('faceScanLabel').textContent,'2 / 2 · reviewed');
 assert.match(el('facePhotoStatus').textContent,/2 candidate crops/);
 assert.equal(el('faceScanProgress').value,100);
 panes[0].handlers.click();
 for(let i=0;i<5;i++)await flush();
 assert.equal(el('overview').hidden,false);
 assert.equal(el('savedPreview').children.length,1,'Provisional clothing group must not appear as confirmed person');
 assert(!html.includes('id="appearancePreview"'),'Clothing group must not be in bottom of scan status');
 assert(!html.includes('id="candidateList"'),'Clothing group must not be attached below saved people');
 assert.equal(el('reviewPreview').children.length,1);
 assert.equal(el('reviewAlerts').children.length,1,'The existing Jesper review issue must be highlighted as an action');
 assert(scan(el('reviewAlerts'),'Inspect originals →'),'Saved clips flagged for person recheck must be actionable');
 let keep=scan(el('reviewPreview'),'✓ Choose person / folder');assert(keep,'Primary review action');
 keep.handlers.click();
 assert(el('approvalDialog').open,'Keep must open explicit confirmation');
 assert.match(el('approvalClip').textContent,/Recording/,'Confirmation must identify its recording');
 el('approvalFolder').value='G123';
 await el('approvalForm').handlers.submit({preventDefault(){}});
 for(let i=0;i<5;i++)await flush();
 assert.equal(linkPosts.length,1);
 assert.equal(el('overview').hidden,false,'Keep from overview must not redirect');
 assert.equal(linkPosts[0].payload.action,'assign');
 assert.equal(linkPosts[0].payload.folder,'G123');
 assert.equal(linkPosts[0].payload.source,'sd');
 assert.equal(linkPosts[0].opts.headers['X-S9-Manual-Link-Intent'],'manual-original-review-links-v1');
 // Creating a new folder also preserves the review context.
 keep=scan(el('reviewPreview'),'✓ Choose person / folder');
 keep.handlers.click();
 el('approvalFolder').value='';
 el('approvalLabel').value='New reviewed visitor';
 await el('approvalForm').handlers.submit({preventDefault(){}});
 for(let i=0;i<5;i++)await flush();
 assert.equal(posts.at(-1).payload.action,'create_folder');
 assert.equal(linkPosts.at(-1).payload.action,'assign');
 assert.equal(el('overview').hidden,false,'New folder must not redirect from queue');
 el('savedPreview').children[0].handlers.click();
 for(let i=0;i<5;i++)await flush();
 assert.equal(el('folderView').hidden,false);
 assert(fetches.some(x=>x.includes('folder=G123')&&x.includes('tab=approved')));
 const folderGrid=el('folderGrid');
 assert(folderGrid.children.length,'Saved folder must show original recording rows');
 assert.equal(el('folderFaces').hidden,true,'Unverified context crops must not masquerade as faces');
 assert.equal(el('folderFaceGrid').children.length,0);
 assert(!scan(folderGrid,'View face candidate 1'),'Do not surface scenery as a verified face');
 assert.equal(el('savedList').children[0].children[0].children[0].tagName,'SPAN',
  'Saved folder portrait must be a neutral initial, not a crop of bicycles');

 panes[1].handlers.click();
 for(let i=0;i<5;i++)await flush();
 assert.equal(el('review').hidden,false);
 assert(el('reviewGrid').children.length>=2,'Show unassigned SD and historical Drive footage');
 assert(el('reviewGrid').children.some(x=>x.dataset.clip===driveClip),
  'Historical verified Drive video must appear');
 assert(el('pageSize').value==='','Select mock has no initial value');
 el('pageSize').value='96';el('pageSize').handlers.change();
 for(let i=0;i<4;i++)await flush();
 assert(fetches.some(p=>p.includes('limit=24')),'Bounding page size protects v40 backend');
 assert.match(el('reviewTotal').textContent,/unassigned recordings/);
 assert(!scan(el('reviewGrid'),'View face candidate 1'),'Background crops must not be called faces');
 const archiveEntry=el('reviewGrid').children[0];
 assert(scan(archiveEntry,'▶ Play'),'Unindexed originals still available for playback');
 assert(scan(archiveEntry,'✓ Choose person / folder'),
   'Unindexed original clips must be manually assignable');
 // Main requirement: save from Review recordings, stay on Review recordings,
 // and preselect the last-used person to speed up review of the next clip.
 const nextKeep=scan(el('reviewGrid'),'✓ Choose person / folder');assert(nextKeep);
 nextKeep.handlers.click();
 assert.equal(el('approvalFolder').value,'G123','Previously chosen folder should be remembered');
 await el('approvalForm').handlers.submit({preventDefault(){}});
 for(let i=0;i<5;i++)await flush();
 assert.equal(el('review').hidden,false,'Confirm & keep must not navigate into a folder');
 assert.equal(el('folderView').hidden,true,'Saved clips must not hijack the current review queue');
 assert.equal(linkPosts.at(-1).payload.folder,'G123');
 panes[2].handlers.click();
 for(let i=0;i<5;i++)await flush();
 assert.equal(el('savedList').children.length,1);
 assert.equal(el('savedList').children[0].children[0].children[0].tagName,'SPAN',
  'Only a real, qualified face can replace the folder initials');
 // Navigate to a provisional group; explicit manual approval must remain
 // possible without claiming an automatic same-person identity.
 panes[3].handlers.click();
 for(let i=0;i<5;i++)await flush();
 assert.equal(el('clothing').hidden,false,'Clothing matches deserve their own tab');
 assert.equal(el('people').hidden,true);
 const group=el('clothingList').children[0];assert(group);
 group.handlers.click();
 for(let i=0;i<5;i++)await flush();
 assert.equal(el('folderView').hidden,false);
 assert.equal(panes[3].attributes['aria-selected'],'true','Clothing group keeps its navigation context');
 const provisionalKeep=scan(el('folderGrid'),'✓ Keep here');assert(provisionalKeep);
 provisionalKeep.handlers.click();
 assert(el('approvalFolder').children.some(x=>x.value==='P345'),
  'Selected provisional appearance group should be an available manual destination');
 el('approvalDialog').close();
 // Simulate a slow previous tab request arriving after a newer navigation.
 panes[1].handlers.click();
 for(let i=0;i<5;i++)await flush();
 holdAll=true;
 el('reviewMode').value='all';el('reviewMode').handlers.change();
 for(let i=0;i<4;i++)await flush();
 assert(releaseHeldAll,'Old request must be deliberately paused');
 el('reviewMode').value='inbox';el('reviewMode').handlers.change();
 for(let i=0;i<5;i++)await flush();
 assert.equal(el('reviewTotal').textContent,'0 review items');
 holdAll=false;releaseHeldAll();
 for(let i=0;i<5;i++)await flush();
 assert.equal(el('reviewTotal').textContent,'0 review items',
  'Stale responses must not replace current tab data');
 console.log('S9_PEOPLE_FACES_V45_WORKSPACE_TEST_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});

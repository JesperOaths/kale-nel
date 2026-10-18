#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('ops/c720p/s9-native-security/security-people-v45.html','utf8');
const js=fs.readFileSync('ops/c720p/s9-native-security/security-people-v45.js','utf8');
new vm.Script(js,{filename:'security-people-v45.js'});
assert(!/\.innerHTML\s*=/.test(js));
assert(!/Unassigned recordings|Clothing appearances grouped into folders/.test(html));
const ids=[...js.matchAll(/\$\('([A-Za-z0-9]+)'\)/g)].map(x=>x[1]);
for(const id of new Set(ids))assert(html.includes('id="'+id+'"'),'Missing rendered control '+id);
for(const label of ['Overview','Review queue','People &amp; groups','Face images','Needs your decision','Saved people &amp; groups'])
 assert(html.includes(label),label);
assert(html.includes('id="approvalConfirmed"')&&js.includes('if(!$('+"'approvalConfirmed'"+').checked)'));
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
const panes=['overview','review','people','faces'].map(p=>{const b=new E('button');b.dataset.pane=p;return b});
const document={getElementById:el,createElement:t=>new E(t),querySelectorAll:q=>q==='[data-pane]'?panes:[],addEventListener(){}};
const clip='motion_1792200000000.mp4';
const item={recorded_ms:1792200000000,clip,source_sha256:'a'.repeat(64),observation:'v1',signature:'b'.repeat(64),
 full_crop:{name:'motion_1792200000000.mp4.t1.abcd.v44.34.full.jpg',time_ms:2500},video_path:'/new/saved/clip/'+clip,
 temporal_support:true,decision:null,entry_zone:'front_garden',memberships:[]};
const saved={id:'G123',label:'Jesper',automatic_appearance_group:false,approved_clips:3,suggested_clips:0,previews:[],approvals_needing_person_recheck:3};
const provisional={id:'P345',label:'Appearance #4',automatic_appearance_group:true,approved_clips:0,suggested_clips:4,previews:[],approvals_needing_person_recheck:0};
let posts=[],fetches=[],holdAll=false,releaseHeldAll=null;
const relay={url:async p=>'https://signed.example.test/'+encodeURIComponent(p),
 fetch:async (p,opts={})=>{
  fetches.push(p);
  if(p.startsWith('/new/api/visual-review/review')){
   const payload=JSON.parse(opts.body);posts.push({payload,opts});
   return {ok:true,json:async()=>({ok:true,folder:payload.folder||'G123'})};
  }
  if(p.startsWith('/new/api/visual-review?')){
   const q=new URLSearchParams(p.split('?')[1]),tab=q.get('tab');
   if(tab==='all'&&holdAll)await new Promise(resolve=>{releaseHeldAll=resolve});
   return {ok:true,json:async()=>({ok:true,revision:0,folders:[saved,provisional],person_detection:
    {assessed_clips:80,total_clips:141,clips_with_supported_people:29,status:'in_progress'},
    inbox_clips:27,total:tab==='inbox'?27:tab==='approved'?3:1,
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
    {snapshot_name:null,time_ms:7200,match_status:'not_tested_no_usable_face'}]}]})};
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
 assert.equal(el('queueCount').textContent,'27');
 assert.equal(el('personCount').textContent,'1');
 assert.equal(el('approvalCount').textContent,'3');
 assert.equal(el('faceCount').textContent,'2');
 assert.equal(el('personScanLabel').textContent,'80 / 141');
 assert.equal(el('faceScanLabel').textContent,'1 / 1 · reviewed');
 assert.match(el('facePhotoStatus').textContent,/2 saved face images available · 1 candidate records have no saved image/);
 assert.equal(el('faceScanProgress').value,100);
 assert.equal(el('savedPreview').children.length,1,'Provisional clothing group must not appear as confirmed person');
 assert.equal(el('appearancePreview').children.length,1,'Unreviewed group is optional separate list');
 assert.equal(el('reviewPreview').children.length,1);
 assert.equal(el('reviewAlerts').children.length,1,'The existing Jesper review issue must be highlighted as an action');
 assert(scan(el('reviewAlerts'),'Inspect originals →'),'Saved clips flagged for person recheck must be actionable');
 let keep=scan(el('reviewPreview'),'✓ Keep');assert(keep,'Primary review action');
 keep.handlers.click();
 assert(el('approvalDialog').open,'Keep must open explicit confirmation');
 el('approvalFolder').value='G123';
 await el('approvalForm').handlers.submit({preventDefault(){}});
 assert.equal(posts.length,0,'No manual approval without explicit original inspection confirmation');
 assert.match(el('message').textContent,/Confirm that you reviewed/);
 el('approvalConfirmed').checked=true;
 await el('approvalForm').handlers.submit({preventDefault(){}});
 for(let i=0;i<5;i++)await flush();
 assert.equal(posts.length,1);
 assert.equal(posts[0].payload.action,'approve_clip');
 assert.equal(posts[0].payload.folder,'G123');
 assert.equal(posts[0].payload.human_confirmed,true);
 assert.equal(posts[0].opts.headers['X-S9-Visual-Review-Intent'],'manual-attributes-v36');
 // Starting a new folder must open its approved recordings, not a broken
 // folder-only inbox view.
 keep=scan(el('reviewPreview'),'✓ Keep');
 keep.handlers.click();
 el('approvalFolder').value='';
 el('approvalLabel').value='New reviewed visitor';
 el('approvalConfirmed').checked=true;
 await el('approvalForm').handlers.submit({preventDefault(){}});
 for(let i=0;i<5;i++)await flush();
 assert.equal(posts[1].payload.action,'seed_folder');
 assert.equal(el('folderView').hidden,false);
 assert(fetches.some(x=>x.includes('folder=G123')&&x.includes('tab=approved')));
 const folderGrid=el('folderGrid');
 assert(folderGrid.children.length,'Saved folder must show original recording rows');
 const faceContext=scan(folderGrid,'Inspect face 1');
 assert(faceContext,'Step 3 must link exact same-recording face snapshot for human review');
 let lines=[];
 function collect(x){if(x.textContent)lines.push(x.textContent);
  for(const child of x.children||[])collect(child)}
 collect(folderGrid);
 assert(lines.some(x=>x.includes('2 temporary within-clip tracks')));
 assert(lines.some(x=>x.includes('clothing blue')&&x.includes('moves left across image')));
 assert(lines.some(x=>x.includes('clothing red')&&x.includes('direction not measured')));
 assert(lines.some(x=>x.includes('Body pose and gait: not verified')));
 assert(!lines.some(x=>x.includes('face matches track 1')),'Do not invent face-to-track associations');
 faceContext.handlers.click();
 assert.equal(el('snapshotViewer').open,true);
 el('snapshotViewer').close();

 panes[1].handlers.click();
 for(let i=0;i<5;i++)await flush();
 assert.equal(el('review').hidden,false);
 assert.equal(el('reviewGrid').children.length,1);
 panes[3].handlers.click();
 for(let i=0;i<5;i++)await flush();
 assert.equal(el('faces').hidden,false);
 assert.equal(el('faceGrid').children.length,1);
 assert.match(el('faceTotal').textContent,/2 images across 1 original recordings/);
 assert.equal(el('faceGrouping').value,'','Initial select mock has no default value');
 const faceInspect=scan(el('faceGrid'),'Inspect images');
 assert(faceInspect,'Face gallery should group saved photos from the same recording');
 faceInspect.handlers.click();
 assert.equal(el('snapshotViewer').open,true,'Full-size image dialog must open');
 assert.equal(el('snapshotPosition').textContent,'Image 1 of 2 in this recording');
 assert.equal(el('snapshotPrev').disabled,true);
 assert.equal(el('snapshotNext').disabled,false);
 el('snapshotNext').handlers.click();
 for(let i=0;i<4;i++)await flush();
 assert.equal(el('snapshotPosition').textContent,'Image 2 of 2 in this recording');
 assert.equal(el('snapshotNext').disabled,true);
 assert.equal(el('snapshotPrev').disabled,false);
 assert(decodeURIComponent(el('snapshotImage').src).includes('pending_2__8300_0.jpg'));
 el('snapshotPrev').handlers.click();
 for(let i=0;i<4;i++)await flush();
 assert.equal(el('snapshotPosition').textContent,'Image 1 of 2 in this recording');
 for(let i=0;i<4;i++)await flush();
 assert(decodeURIComponent(el('snapshotImage').src).includes('/new/saved/face/'),
   'Saved face image must load through the existing authenticated relay');
 assert.match(el('snapshotDescription').textContent,/identity not established/);
 el('snapshotPlay').handlers.click();
 for(let i=0;i<4;i++)await flush();
 assert.equal(el('snapshotViewer').open,false);
 assert.equal(el('viewer').open,true);
 assert(decodeURIComponent(el('video').src).includes('/new/saved/clip/'),
   'Original MP4 must open from the face snapshot inspector');
 el('viewer').close();
 el('faceGrouping').value='images';el('faceGrouping').handlers.change();
 assert.equal(el('faceGrid').children.length,2,'Individual image mode must show both saved crops');
 el('faceSearch').value='not-a-recording';el('faceSearch').handlers.input();
 assert.equal(el('faceGrid').children.length,1,'Search must filter the images and show empty state');
 el('faceSearch').value='';el('faceSearch').handlers.input();
 assert.equal(el('faceGrid').children.length,2);
 el('faceGrouping').value='recording';el('faceGrouping').handlers.change();
 assert.equal(el('faceGrid').children.length,1,'By-recording mode must collapse same-source crops');
 panes[2].handlers.click();
 for(let i=0;i<5;i++)await flush();
 assert.equal(el('savedList').children.length,1);
 // Navigate to a provisional group; explicit manual approval must remain
 // possible without claiming an automatic same-person identity.
 const group=el('candidateList').children[0];assert(group);
 group.handlers.click();
 for(let i=0;i<5;i++)await flush();
 assert.equal(el('folderView').hidden,false);
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
 assert.equal(el('reviewTotal').textContent,'27 matching recordings');
 holdAll=false;releaseHeldAll();
 for(let i=0;i<5;i++)await flush();
 assert.equal(el('reviewTotal').textContent,'27 matching recordings',
  'Stale responses must not replace current tab data');
 console.log('S9_PEOPLE_FACES_V45_WORKSPACE_TEST_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});

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
assert(js.includes('credibleFaceCrop(')&&js.includes('Use as portrait'),'Qualified auto-portraits remain gated; explicit human crop selection must work');
assert(!/\.innerHTML\s*=/.test(js));
assert(!js.includes("groupRows($('clothingList'))"),'Legacy provisional groups cannot masquerade as scored outfit matches');
assert(!/id="unassignedFolder"|Clothing appearances grouped into folders/.test(html));
const ids=[...js.matchAll(/\$\('([A-Za-z0-9]+)'\)/g)].map(x=>x[1]);
for(const id of new Set(ids))assert(html.includes('id="'+id+'"'),'Missing rendered control '+id);
for(const label of ['Processing coverage','Review recordings','People','People A–Z'])
 assert(html.includes(label),label);
assert(js.includes('limit:100')&&html.includes('value="100" selected'),'Page size must default to 100');
assert(js.includes('batch.revision!==next.revision'),'Review pagination must not combine changed revisions');
assert(js.includes('viewerFile')&&html.includes('id="viewerFile"'),'Video filing must be actionable');
assert(js.includes('approvedFolderContext')&&js.includes('playVideo(path,date(item),sec,item)'),
 'Approved person folder must keep modal Return to review available while full assignment scan loads');
assert(js.includes('for(let pass=0;pass<3&&references.length<18;pass++)'),
 'Outfit references must rotate across saved people before using extra samples');
assert(js.includes('Math.abs(candidateTime-ref.recorded_ms)>72*60*60*1000'),
 'Clothing-only suggestions require nearby timestamps, not ancient colour lookalikes');
assert(!html.includes('id="approvalConfirmed"'),'Remove redundant second confirmation checkbox');
assert(js.includes('state.lastFolder=selected[0]||state.lastFolder'),'Review queue must retain last selected person');
assert(js.includes("assign_many")&&html.includes('id="approvalAddPerson"'),'Repeatable group filing must be wired end to end');
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
const panes=['overview','review','people','clothing','automatic'].map(p=>{const b=new E('button');b.dataset.pane=p;return b});
const document={getElementById:el,createElement:t=>new E(t),querySelectorAll:q=>q==='[data-pane]'?panes:[],addEventListener(){}};
const clip='motion_1792200000000.mp4';
const driveClip='historical_2026-05-12_08-30-00.mp4';
const otherClip='motion_1792200500000.mp4';
const extraClip='motion_1792201000000.mp4';
const candidateClip='motion_1792100000000.mp4';
const pendingOutfitClip='motion_1792000000000.mp4';
const item={recorded_ms:1792200000000,clip,source_sha256:'a'.repeat(64),observation:'v1',signature:'b'.repeat(64),
 full_crop:{name:'motion_1792200000000.mp4.t1.abcd.v44.34.full.jpg',time_ms:2500},video_path:'/new/saved/clip/'+clip,
 temporal_support:true,decision:null,entry_zone:'front_garden',memberships:[]};
const saved={id:'G123',label:'Jesper',automatic_appearance_group:false,approved_clips:3,suggested_clips:0,previews:[{name:'motion_1792200000000.mp4.t1.abcd.v44.34.full.jpg'}],approvals_needing_person_recheck:3};
const provisional={id:'P345',label:'Appearance #4',automatic_appearance_group:true,approved_clips:0,suggested_clips:4,previews:[],approvals_needing_person_recheck:0};
let posts=[],linkPosts=[],autoPosts=[],autoDenied=new Set(),fetches=[],faceReadFailures=0,holdAll=false,releaseHeldAll=null,linkRevision=0,linkItems={},linkReadFailures=0;
let inboxOverride=null,driveOnlyPerson=null,badReceipt=false;
const folders=()=>[saved,provisional,...(driveOnlyPerson?[driveOnlyPerson]:[])];
const relay={url:async p=>'https://signed.example.test/'+encodeURIComponent(p),
 fetch:async (p,opts={})=>{
  fetches.push(p);
  if(p==='/new/api/visual-review/review'||p==='/new/api/s9-manual-recording-links'&&opts.method==='POST'){
   const payload=JSON.parse(opts.body);
   if(opts.headers?.['X-S9-Manual-Link-Intent']){
    linkPosts.push({payload,opts});
    if(payload.revision!==linkRevision)
     return {ok:false,status:409,json:async()=>({ok:false,error:'review_revision_changed'})};
    if(badReceipt)return {ok:true,json:async()=>({ok:true,persisted:true,manual_links_only:true,source:'sd',name:'wrong.mp4',revision:linkRevision+1,folder:payload.folder})};
    linkItems[payload.source+':'+payload.name]={source:payload.source,
      name:payload.name,folder:payload.folder,
      folders:payload.action==='assign_many'?payload.folders:payload.folder?[payload.folder]:[],
      review_status:({assign:'assigned',assign_many:'assigned',return_to_queue:'inbox',skip:'skipped',reject:'rejected'})[payload.action]};
    linkRevision++;
    return {ok:true,json:async()=>({ok:true,persisted:true,source:payload.source,name:payload.name,manual_links_only:true,revision:linkRevision,
      folder:linkItems[payload.source+':'+payload.name].folder,
      folders:linkItems[payload.source+':'+payload.name].folders,
      review_status:linkItems[payload.source+':'+payload.name].review_status})};
   }
   posts.push({payload,opts});
   return {ok:true,json:async()=>({ok:true,folder:payload.folder||'G123'})};
  }
  if(p==='/new/api/automatic-person'&&opts.method==='POST'){
   const body=JSON.parse(opts.body);autoPosts.push({body,opts});autoDenied.add(body.id);
   return {ok:true,json:async()=>({ok:true,revision:autoDenied.size,decision:'denied'})};
  }
  if(p==='/new/api/automatic-person'){
   const rows=[clip,pendingOutfitClip].map((name,i)=>({id:(i?'e':'f').repeat(64),source:'sd',name,
    folder:'G123',score:.94,margin:.12,reference_count:2,human_approved:false}));
   return {ok:true,json:async()=>({ok:true,status:'ready',revision:autoDenied.size,
    items:rows.filter(x=>!autoDenied.has(x.id))})};
  }
  if(p==='/new/api/s9-manual-recording-links'){
   if(linkReadFailures>0){linkReadFailures--;throw Error('Synthetic refresh outage')}
   return {ok:true,json:async()=>({ok:true,revision:linkRevision,items:linkItems,
     manual_links_only:true,automatic_identity_matching:false})};
  }
  if(p.startsWith('/new/api/appearance-search?'))return {ok:true,json:async()=>({ok:true,appearance_only:true,results:[{clip_name:pendingOutfitClip,similarity:.97,zone:'front_garden'}]})};
  if(p==='/new/api/drive-saved')return {ok:true,json:async()=>({
    ok:true,archive_mode:'historical-google-drive',events:[
      {remote_name:driveClip,timestamp:'2026-05-12T08:30:00',snapshot_name:'history.jpg'},
      {remote_name:clip,timestamp:'2026-10-17T09:00:00',snapshot_name:'same-name.jpg'}
    ]})};
  if(p.startsWith('/new/api/visual-review?')){
   const q=new URLSearchParams(p.split('?')[1]),tab=q.get('tab');
   if(tab==='all'&&holdAll)await new Promise(resolve=>{releaseHeldAll=resolve});
   if(tab==='inbox'&&inboxOverride){
    const start=Number(q.get('offset')),limit=Number(q.get('limit'));
    return {ok:true,json:async()=>({ok:true,revision:0,folders:folders(),
     inbox_clips:inboxOverride.length,total:inboxOverride.length,
     items:inboxOverride.slice(start,start+limit),reference_examples:[]})};
   }
   return {ok:true,json:async()=>({ok:true,revision:0,folders:folders(),person_detection:
    {assessed_clips:80,total_clips:141,clips_with_supported_people:29,status:'in_progress'},
    inbox_clips:27,total:tab==='inbox'?1:tab==='approved'?1:1,
    items:tab==='approved'?[{...item,decision:'approved'}]:[item],
    reference_examples:tab==='suggestions'?[item]:[]})};
  }
  if(p==='/new/api/saved'){
   if(faceReadFailures>0){faceReadFailures--;throw Error('Synthetic S9+ source outage')}
   return {ok:true,json:async()=>({archive_mode:'S9-microSD-only',events:[
   {clip_no:clip,person_count:1,frames_with_distinct_multiple_person_boxes:0,face_deep_review_version:'s9_onphone_36_samples_overlapping_tiles_v5',
    anonymous_tracks:[
     {id:'Person 1',upper_clothing_colour:'blue',image_movement_direction:'image_left'},
     {id:'Person 2',upper_clothing_colour:'red',image_movement_direction:'insufficient_samples'}],
    face_candidates:[{snapshot_name:'motion_1792200000000__pending_1__6365_0.jpg',time_ms:6365,
    snapshot_size:120000,face_crop_requires_manual_review:true,match_status:'not_tested_no_usable_face'},
    {snapshot_name:'motion_1792200000000__pending_2__8300_0.jpg',time_ms:8300,
    snapshot_size:50000,face_crop_requires_manual_review:true,match_status:'not_tested_no_usable_face'},
    {snapshot_name:null,time_ms:7200,match_status:'not_tested_no_usable_face'}]},
   {clip_no:otherClip,person_count:1,face_deep_review_version:'s9_onphone_36_samples_overlapping_tiles_v5',face_candidates:[]},
   {clip_no:extraClip,person_count:1,face_deep_review_version:'s9_onphone_36_samples_overlapping_tiles_v5',face_candidates:[]},
   {clip_no:candidateClip,person_count:1,face_deep_review_version:'s9_onphone_36_samples_overlapping_tiles_v5',face_candidates:[]},
   {clip_no:pendingOutfitClip,person_count:1,face_deep_review_version:'s9_onphone_36_samples_overlapping_tiles_v5',face_candidates:[]}]})};
  }
  if(p.startsWith('/new/saved/face/'))return {ok:true,status:200};
  throw Error('Unexpected request '+p);
 }};
const window={C720PSecureRelay:relay,confirm:()=>true};window.parent=window;window.addEventListener=()=>{};
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
 assert.equal(el('peopleReviewSummary').textContent,'6 recordings need review');
 assert.equal(el('peopleReviewNotice').hidden,false);
 assert.equal(el('peopleRecheckNotice').hidden,true,'Saved human decisions must not be repeatedly reopened by model disagreements');
 assert.equal(el('peopleRecheckSummary').textContent,'0 confirmed recordings need evidence rechecking');
 assert(el('peopleRecheckNow').handlers.click,'Recheck button must lead to person originals');
 assert.equal(el('reviewTabCount').textContent,' · 6');
 assert.equal(el('queueCount').textContent,'6');
 assert.equal(el('personCount').textContent,'1');
 assert.equal(el('approvalCount').textContent,'1');
 assert.equal(el('archiveCount').textContent,'7','All SD originals plus two historical Drive originals appear in archive');
 assert(!html.includes('data-pane="faces"'),'Face gallery tab must be removed');
 assert(!html.includes('id="faceGrid"'),'Invalid gallery not to be retained');
 assert.equal(el('personScanLabel').textContent,'80 / 141');
 assert.equal(el('faceScanLabel').textContent,'5 / 5 · reviewed');
 assert.match(el('facePhotoStatus').textContent,/2 candidate crops/);
 assert.equal(el('faceScanProgress').value,100);
 // Every entry point uses the same source-qualified archive. Drive must also
 // remain actionable in Needs review, rather than existing only on old pages.
 el('peopleReviewNow').handlers.click();for(let i=0;i<5;i++)await flush();
 assert.equal(el('reviewMode').value,'all','People shortcut must open the combined unassigned queue');
 el('reviewSource').value='drive';el('reviewSource').handlers.change();
 assert.equal(el('reviewGrid').children.length,2);
 assert(el('reviewGrid').children.every(x=>x.dataset.source==='drive'));
 assert.match(el('reviewTotal').textContent,/2 Drive/);
 el('reviewMode').value='skipped';el('reviewMode').handlers.change();
 for(let i=0;i<5;i++)await flush();
 assert.equal(el('reviewSource').value,'drive','Skipped view must retain its selected source');
 assert.equal(el('reviewSource').disabled,false);
 el('reviewMode').value='inbox';el('reviewMode').handlers.change();
 for(let i=0;i<5;i++)await flush();
 assert.equal(el('reviewGrid').children.length,2,'Needs review includes both unassigned Drive originals');
 assert(el('reviewGrid').children.every(x=>scan(x,'✓ File under person')),
  'Drive queue entries must retain actual filing actions');
 inboxOverride=Array.from({length:125},(_,i)=>({...item,
  clip:'motion_'+String(1792500000000+i)+'.mp4',recorded_ms:1792500000000+i}));
 el('reviewSource').value='all';el('reviewSource').handlers.change();
 el('reviewMode').value='inbox';el('reviewMode').handlers.change();
 for(let i=0;i<16;i++)await flush();
 assert.match(el('reviewTotal').textContent,/127 review items · 2 Drive/,
  'Merge the complete paginated native inbox before applying UI page limits');
 assert.equal(el('reviewGrid').children.length,100);
 scan(el('reviewPage'),'Next →').handlers.click();
 assert.equal(el('reviewGrid').children.length,27);
 el('reviewSource').value='drive';el('reviewSource').handlers.change();
 assert.equal(el('reviewGrid').children.length,2,'Changing source must reset combined pagination');
 assert(el('reviewGrid').children.every(x=>x.dataset.source==='drive'));
 inboxOverride=null;
 el('reviewMode').value='inbox';el('reviewMode').handlers.change();
 for(let i=0;i<5;i++)await flush();
 el('reviewSource').value='sd';el('reviewSource').handlers.change();
 assert.equal(el('reviewGrid').children.filter(x=>x.dataset.source==='drive').length,0);
 el('reviewSource').value='all';el('reviewSource').handlers.change();
 panes[2].handlers.click();for(let i=0;i<4;i++)await flush();
 panes[0].handlers.click();
 for(let i=0;i<5;i++)await flush();
 assert.equal(el('overview').hidden,false);
 assert.equal(el('savedPreview').children.length,3,'Coverage shows SD, Drive, and manual assignments without duplicating person cards');
 assert(!html.includes('id="appearancePreview"'),'Clothing group must not be in bottom of scan status');
 assert(!html.includes('id="candidateList"'),'Clothing group must not be attached below saved people');
 assert(el('reviewPreview').children.length>=1,'Coverage summary must display outstanding work');
 assert.equal(el('reviewAlerts').children.length,0,'Saved clips do not become mandatory rechecks when the model changes');
 assert(!scan(el('reviewAlerts'),'Inspect originals →'),'No forced recheck for human-confirmed clips');
 assert(el('peopleReviewNow').handlers.click,'Review action must remain accessible without a duplicate recording list');
 let keep;
 el('openReview').handlers.click();for(let i=0;i<4;i++)await flush();
 const unassignedVideo=scan(el('reviewGrid').children.find(x=>x.dataset.source==='sd'),'▶ Play');
 assert(unassignedVideo,'Unassigned video must expose original player');
 unassignedVideo.handlers.click();
 for(let i=0;i<3;i++)await flush();
 assert.equal(el('viewer').open,true,'Original player opens from review queue');
 assert.equal(el('viewerFile').hidden,false,'Filing control visible inside player');
 assert.equal(el('viewerReturn').hidden,true,'Return control hidden on unassigned original');
 el('viewerFile').handlers.click();
 assert.equal(el('approvalDialog').open,true,'File from video opens actionable confirmation');
 assert.equal(el('viewer').open,false,'Player closes before confirmation');
 el('approvalDialog').close();
 keep=scan(el('reviewGrid').children.find(x=>x.dataset.source==='sd'),'✓ File under person');
 assert(keep,'Primary SD review action');
 keep.handlers.click();
 assert(el('approvalDialog').open,'Keep must open explicit confirmation');
 assert.match(el('approvalClip').textContent,/Recording/,'Confirmation must identify its recording');
 el('approvalFolder').value='G123';
 await el('approvalForm').handlers.submit({preventDefault(){}});
 for(let i=0;i<5;i++)await flush();
 assert.equal(linkPosts.length,1);
 assert.equal(el('review').hidden,false,'Keep from the review queue must remain in the queue');
 assert.equal(linkPosts[0].payload.action,'assign');
 assert.equal(linkPosts[0].payload.folder,'G123');
 assert.equal(linkPosts[0].payload.source,'sd');
 assert.equal(linkPosts[0].opts.headers['X-S9-Manual-Link-Intent'],'manual-original-review-links-v1');
 // Creating a new folder also preserves the review context.
 keep=scan(el('reviewGrid').children.find(x=>x.dataset.source==='sd'),'✓ File under person');
 keep.handlers.click();
 el('approvalFolder').value='';
 el('approvalLabel').value='New reviewed visitor';
 await el('approvalForm').handlers.submit({preventDefault(){}});
 for(let i=0;i<5;i++)await flush();
 assert.equal(posts.at(-1).payload.action,'create_folder');
 assert.equal(linkPosts.at(-1).payload.action,'assign');
 assert.equal(el('review').hidden,false,'New person must not redirect from queue');
 el('savedList').children[0].handlers.click();
 for(let i=0;i<5;i++)await flush();
 assert.equal(el('folderView').hidden,false);
 assert(fetches.some(x=>x.includes('folder=G123')&&x.includes('tab=approved')));
 const folderGrid=el('folderGrid');
 assert(folderGrid.children.length,'Saved folder must show original recording rows');
 const editApproved=scan(folderGrid,'＋ Edit people');
 assert(editApproved,'Approved originals need a direct action to update their people without returning to review');
 editApproved.handlers.click();
 assert.equal(el('approvalDialog').open,true,'Edit people opens the existing group-filing dialog');
 assert.equal(el('approvalFolder').value,'G123','Existing approved person should be selected');
 el('approvalDialog').close();
 assert.equal(el('folderFaces').hidden,false,
  'Real candidate crops from approved clips must be available for explicit human selection');
 assert.equal(el('folderFaceGrid').children.length,2,
  'Do not discard both manual-review crops just because automatic qualification is incomplete');
 assert(scan(el('folderFaceGrid'),'Use as portrait'),
  'A person can deliberately choose their cover crop, including when automatic face verification is pending');
 assert(!scan(folderGrid,'View face candidate 1'),'Do not surface scenery as a verified face');
 assert.equal(el('savedList').children[0].children[0].children[0].tagName,'SPAN',
  'Saved folder portrait must be a neutral initial, not a crop of bicycles');

 panes[1].handlers.click();
 for(let i=0;i<5;i++)await flush();
 assert.equal(el('review').hidden,false);
 assert(el('reviewGrid').children.length>=1,'Only recordings not already filed under a person remain; historical Drive stays available');
 assert(el('reviewGrid').children.some(x=>x.dataset.clip===driveClip),
  'Historical verified Drive video must appear');
 assert(el('pageSize').value==='','Select mock has no initial value');
 el('pageSize').value='150';el('pageSize').handlers.change();
 for(let i=0;i<4;i++)await flush();
 assert(fetches.some(p=>p.includes('limit=24')),'Bounding page size protects v40 backend');
 assert.match(el('reviewTotal').textContent,/unassigned recordings/);
 assert(!scan(el('reviewGrid'),'View face candidate 1'),'Background crops must not be called faces');
 const archiveEntry=el('reviewGrid').children[0];
 assert(scan(archiveEntry,'▶ Play'),'Unindexed originals still available for playback');
 assert(scan(archiveEntry,'✓ File under person'),
   'Unindexed original clips must be manually assignable');
 // Main requirement: save from Review recordings, stay on Review recordings,
 // and preselect the last-used person to speed up review of the next clip.
 const nextKeep=scan(el('reviewGrid').children.find(x=>x.dataset.source==='sd'),'✓ File under person');assert(nextKeep);
 nextKeep.handlers.click();
 assert.equal(el('approvalFolder').value,'G123','Previously chosen folder should be remembered');
 await el('approvalForm').handlers.submit({preventDefault(){}});
 for(let i=0;i<5;i++)await flush();
 assert.equal(el('review').hidden,false,'Confirm & keep must not navigate into a folder');
 assert.equal(el('folderView').hidden,true,'Saved clips must not hijack the current review queue');
 assert.equal(linkPosts.at(-1).payload.folder,'G123');
 assert.equal(el('approvalDialog').open,false,'Successful SD filing must close popup');
 // Universal review disposition: both sources may be skipped or rejected,
 // reversibly, without confusing same-named originals or filing a person.
 for(const source of ['drive','sd']){
  const row=el('reviewGrid').children.find(x=>x.dataset.source===source);
  assert(row,'Unassigned '+source+' fixture');
  const name=row.dataset.clip;
  for(const [button,mode] of [['↷ Skip for now','skipped'],['✕ Reject','rejected']]){
   const current=el('reviewGrid').children.find(x=>x.dataset.source===source&&x.dataset.clip===name);
   assert(scan(current,button),'Every original exposes '+button);
   scan(current,button).handlers.click();for(let i=0;i<7;i++)await flush();
   assert(!el('reviewGrid').children.some(x=>x.dataset.source===source&&x.dataset.clip===name),
    mode+' must leave Unassigned');
   assert.equal(linkItems[source+':'+name].folder,null,'Review dismissal must not assign a person');
   el('reviewMode').value=mode;el('reviewMode').handlers.change();
   for(let i=0;i<5;i++)await flush();
   const hidden=el('reviewGrid').children.find(x=>x.dataset.source===source&&x.dataset.clip===name);
   assert(hidden,source+' disposition must survive switching views');
   assert(!scan(hidden,'✓ File under person'),'Dismissed clips must show Restore first');
   scan(hidden,'Restore').handlers.click();for(let i=0;i<7;i++)await flush();
   assert(!el('reviewGrid').children.some(x=>x.dataset.source===source&&x.dataset.clip===name));
   el('reviewMode').value='all';el('reviewMode').handlers.change();
   for(let i=0;i<5;i++)await flush();
   assert(el('reviewGrid').children.some(x=>x.dataset.source===source&&x.dataset.clip===name),
    'Restore must return original to Unassigned');
  }
 }
 // A successful backend commit remains a success when only the follow-up
 // GET fails. Never invite a second accidental assignment in this case.
 const driveBefore=el('reviewGrid').children.find(x=>x.dataset.clip===driveClip);
 assert(driveBefore,'Drive original must be visible in the unassigned queue');
 scan(driveBefore,'▶ Play').handlers.click();for(let i=0;i<3;i++)await flush();
 assert.equal(el('viewerFile').hidden,false,'Unassigned historical Drive video may be filed in player');
 el('viewerFile').handlers.click();
 assert.equal(el('approvalDialog').open,true);
 assert.equal(el('approvalClip').textContent.includes('Recording'),true);
 el('approvalDialog').close();
 const driveKeep=scan(driveBefore,'✓ File under person');
 assert(driveKeep,'Verified Drive originals must have the filing action');
 driveKeep.handlers.click();el('approvalFolder').value='G123';
 linkReadFailures=1;
 await el('approvalForm').handlers.submit({preventDefault(){}});
 for(let i=0;i<6;i++)await flush();
 assert.equal(el('approvalDialog').open,false,
  'A committed POST must close its confirmation even if a subsequent GET fails');
 assert.equal(linkItems['drive:'+driveClip].folder,'G123');
 assert.equal(el('notice').children[0].textContent.includes('Saved, but'),true,
  'Successful commit plus failed refresh must clearly distinguish the outcomes');
 assert(!el('reviewGrid').children.some(x=>x.dataset.clip===driveClip),
  'Locally acknowledged Drive link must leave the unassigned queue');
 const driveWrites=linkPosts.filter(x=>x.payload.source==='drive');
 assert.equal(driveWrites.filter(x=>x.payload.action==='assign').length,1,'Transient GET failure cannot duplicate committed POST');
 
 // Readback after reopening must retain the exact source and link. Removing
 // it from a person must expose the unchanged original to review again.
 panes[2].handlers.click();for(let i=0;i<5;i++)await flush();
 el('savedList').children[0].handlers.click();for(let i=0;i<5;i++)await flush();
 const driveInPerson=el('folderGrid').children.find(x=>x.dataset.clip===driveClip);
 assert(driveInPerson,'Drive original must appear in the chosen person');
 scan(driveInPerson,'▶ Play').handlers.click();for(let i=0;i<3;i++)await flush();
 assert.equal(el('viewerFile').hidden,false,'Assigned Drive original can be refiled');
 assert.equal(el('viewerReturn').hidden,false,'Assigned Drive original has a return action in modal');
 el('closeVideo').handlers.click();
 const returnDrive=scan(driveInPerson,'↩ Return to review queue');
 assert(returnDrive,'Person folder must allow returning an archived Drive original');
 returnDrive.handlers.click();for(let i=0;i<6;i++)await flush();
 assert.equal(linkItems['drive:'+driveClip].folder,null);
 assert.equal(linkPosts.at(-1).payload.action,'return_to_queue');
 assert.equal(linkPosts.at(-1).payload.source,'drive');
 assert.equal(el('folderGrid').children.some(x=>x.dataset.clip===driveClip),false,
  'Returned Drive item must leave the person view');
 panes[1].handlers.click();for(let i=0;i<6;i++)await flush();
 assert(el('reviewGrid').children.some(x=>x.dataset.clip===driveClip),
  'Returned Drive original must reappear in review');
 
 // A concurrent reviewer advancing the revision must not silently overwrite
 // their assignment. The UI refreshes and permits an explicit second attempt.
 const staleRow=el('reviewGrid').children.find(x=>x.dataset.clip===driveClip);
 scan(staleRow,'✓ File under person').handlers.click();
 el('approvalFolder').value='G123';const writesBeforeConflict=linkPosts.length;
 linkRevision++;
 await el('approvalForm').handlers.submit({preventDefault(){}});
 for(let i=0;i<5;i++)await flush();
 assert.equal(linkItems['drive:'+driveClip].folder,null,
  'A 409 must not mutate the previous reviewer decision');
 assert.equal(linkPosts.length,writesBeforeConflict+1);
 assert.match(el('message').textContent,/Another review changed/);
 assert.equal(el('approvalDialog').open,true,'Stale-save dialog must remain open');
 await el('approvalForm').handlers.submit({preventDefault(){}});
 for(let i=0;i<5;i++)await flush();
 assert.equal(linkItems['drive:'+driveClip].folder,'G123',
  'Confirmed retry uses the refreshed revision');
 assert.equal(el('approvalDialog').open,false);
 // Same-basename originals must remain source distinct in a person folder.
 // The SD original has a legacy approval, while the Drive original with the
 // same basename gets a separate manual source-qualified link.
 const sameNameDriveRow=el('reviewGrid').children.find(x=>
  x.dataset.clip===clip&&x.dataset.source==='drive');
 assert(sameNameDriveRow,'Drive and SD entries with identical names must remain distinct');
 scan(sameNameDriveRow,'✓ File under person').handlers.click();
 el('approvalFolder').value='G123';
 await el('approvalForm').handlers.submit({preventDefault(){}});
 for(let i=0;i<5;i++)await flush();
 assert.equal(linkItems['drive:'+clip].folder,'G123');
 panes[2].handlers.click();for(let i=0;i<5;i++)await flush();
 el('savedList').children[0].handlers.click();for(let i=0;i<5;i++)await flush();
 const sameNameEntries=el('folderGrid').children.filter(x=>x.dataset.clip===clip);
 assert.deepEqual(sameNameEntries.map(x=>x.dataset.source).sort(),['drive','sd'],
  'Source-specific approved originals may share the same basename');
 const sdInPerson=sameNameEntries.find(x=>x.dataset.source==='sd');
 scan(sdInPerson,'↩ Return to review queue').handlers.click();
 for(let i=0;i<5;i++)await flush();
 assert.equal(linkItems['sd:'+clip].folder,null,
  'Returning SD original must not delete or move the same-name Drive link');
 assert.equal(linkItems['drive:'+clip].folder,'G123');
 panes[1].handlers.click();for(let i=0;i<5;i++)await flush();
 assert(el('reviewGrid').children.some(x=>x.dataset.clip===clip&&x.dataset.source==='sd'),
  'Returned native original must be available for review');
 assert(!el('reviewGrid').children.some(x=>x.dataset.clip===clip&&x.dataset.source==='drive'),
  'Same-name Drive original remains assigned');
 panes[2].handlers.click();
 for(let i=0;i<5;i++)await flush();
 assert.equal(el('savedList').children.length,1);
 assert.equal(el('savedList').children[0].children[0].children[0].tagName,'SPAN',
  'Only a real, qualified face can replace the folder initials');
 // The outfit page must use separately scored upper/lower clothing matches
 // against a previously human-approved, single-person reference clip.
 panes[3].handlers.click();
 for(let i=0;i<15;i++)await flush();
 assert.equal(el('clothing').hidden,false);
 assert.equal(el('people').hidden,true);
 assert.equal(panes[3].attributes['aria-selected'],'true');
 assert(fetches.some(p=>p.includes('/new/api/appearance-search?')&&p.includes('upper_clothing')),
  'Must use indexed upper clothing, not guessed group IDs');
 assert(fetches.some(p=>p.includes('/new/api/appearance-search?')&&p.includes('lower_clothing')),
  'Must corroborate with indexed lower clothing');
 assert(scan(el('clothingList'),'▶ Review original'),
  'Suggestions must return to source evidence for confirmation: '+el('clothingTotal').textContent+
  '; items='+el('clothingList').children.length+'; requests='+fetches.filter(p=>p.includes('/appearance-search?')).length);
 assert.match(el('clothingTotal').textContent,/human review/);
 assert.match(el('clothingTotal').textContent,/within 72 hours/);
 // Simulate a slow previous tab request arriving after a newer navigation.
 panes[1].handlers.click();
 for(let i=0;i<5;i++)await flush();
 holdAll=true;
 el('reviewMode').value='all';el('reviewMode').handlers.change();
 for(let i=0;i<4;i++)await flush();
 assert(releaseHeldAll,'Old request must be deliberately paused');
 el('reviewMode').value='inbox';el('reviewMode').handlers.change();
 for(let i=0;i<5;i++)await flush();
 assert.equal(el('reviewTotal').textContent,'2 review items · 0 Drive');
 holdAll=false;releaseHeldAll();
 for(let i=0;i<5;i++)await flush();
 assert.equal(el('reviewTotal').textContent,'2 review items · 0 Drive',
  'Stale responses must not replace current tab data');
 // Failed native face metadata is unknown coverage, never a false zero or
 // an indefinitely spinning Loading state. Refresh repairs the display.
 faceReadFailures=1;
 el('refresh').handlers.click();
 for(let i=0;i<9;i++)await flush();
 assert.equal(el('faceScanLabel').textContent,'Unavailable · retry Refresh');
 assert.match(el('facePhotoStatus').textContent,/could not be checked/);
 assert.equal(el('faceScanProgress').value,0);
 el('refresh').handlers.click();
 for(let i=0;i<10;i++)await flush();
 assert.equal(el('faceScanLabel').textContent,'5 / 5 · reviewed');
 assert.equal(el('faceScanProgress').value,100);
 // Automatic Person shows suggestions for known saved people, never files
 // a clip until a reviewer explicitly approves it.
 panes[4].handlers.click();for(let i=0;i<12;i++)await flush();
 assert.equal(el('automatic').hidden,false);
 assert.equal(el('automaticFolders').children.length,1,'Group candidates under one saved person');
 assert.match(el('automaticStatus').textContent,/requiring your decision/);
 const denied=scan(el('automaticFolders'),'✕ Deny');
 assert(denied,'Explicit person-match denial action missing');
 const postsBefore=linkPosts.length;
 denied.handlers.click();for(let i=0;i<9;i++)await flush();
 assert.equal(autoPosts.length,1,'Denials use the audited suggestion endpoint');
 assert.equal(autoPosts[0].body.human_confirmed,true);
 assert.equal(linkPosts.length,postsBefore,'Deny must not modify any person assignment');
 console.log('AUTO_PERSON_AFTER_DENY',JSON.stringify({status:el('automaticStatus').textContent,count:el('automaticTabCount').textContent,groups:el('automaticFolders').children.length,links:Object.keys(linkItems)}));
 const approve=scan(el('automaticFolders'),'✓ Approve');
 assert(approve,'Remaining match must support manual approval');
 approve.handlers.click();for(let i=0;i<15;i++)await flush();
 assert.equal(linkPosts.length,postsBefore+1,'Approval uses existing human-confirmed filing');
 assert.equal(linkPosts.at(-1).payload.folder,'G123');
 assert.equal(linkPosts.at(-1).payload.human_confirmed,true);
 assert.equal(el('automaticTabCount').textContent,'');
 // A saved person with only Drive/manual originals has zero v40 approvals.
 // Reopening must choose Approved, show the persisted links and count them.
 driveOnlyPerson={id:'GDRIVE',label:'Drive-only person',automatic_appearance_group:false,
  approved_clips:0,suggested_clips:0,previews:[]};
 linkItems['drive:'+driveClip]={source:'drive',name:driveClip,folder:'GDRIVE',review_status:'assigned'};
 linkRevision++;
 el('refresh').handlers.click();for(let i=0;i<12;i++)await flush();
 panes[2].handlers.click();for(let i=0;i<6;i++)await flush();
 const person=el('savedList').children.find(x=>x.children[1]?.children[0]?.textContent==='Drive-only person');
 assert(person,'Person with only Drive assignments must remain in People');
 assert.match(person.children[1].children[1].textContent,/1 reviewed recording/);
 person.handlers.click();for(let i=0;i<6;i++)await flush();
 assert.equal(el('folderMode').value,'approved','Drive-only person must open filed recordings, not empty suggestions');
 assert.match(el('folderDescription').textContent,/1 saved recording links/);
 assert(el('folderGrid').children.some(x=>x.dataset.source==='drive'&&x.dataset.clip===driveClip),
  'Persisted Drive assignment must appear after a full source refresh');
 // Assignment to a former provisional group promotes it to a reviewed person.
 driveOnlyPerson.automatic_appearance_group=true;
 panes[2].handlers.click();for(let i=0;i<6;i++)await flush();
 const promoted=el('savedList').children.find(x=>x.children[1]?.children[0]?.textContent==='Drive-only person');
 assert(promoted,'A manual Drive approval must promote a provisional group');
 promoted.handlers.click();for(let i=0;i<6;i++)await flush();
 assert.equal(el('folderMode').value,'approved');
 const returned=scan(el('folderGrid'),'↩ Return to review queue');assert(returned);
 returned.handlers.click();for(let i=0;i<6;i++)await flush();
 assert.equal(linkItems['drive:'+driveClip].folder,null);
 assert(!el('folderGrid').children.some(x=>x.dataset.source==='drive'&&x.dataset.clip===driveClip));
 // A generic/wrong-target success is never a persisted assignment receipt.
 panes[1].handlers.click();for(let i=0;i<6;i++)await flush();
 const retryRow=el('reviewGrid').children.find(x=>x.dataset.source==='drive'&&x.dataset.clip===driveClip);
 scan(retryRow,'✓ File under person').handlers.click();el('approvalFolder').value='G123';badReceipt=true;
 await el('approvalForm').handlers.submit({preventDefault(){}});
 for(let i=0;i<6;i++)await flush();
 assert.equal(el('approvalDialog').open,true,'Unverified save must remain actionable');
 assert.match(el('approvalStatus').textContent,/Save was not confirmed/);
 assert.equal(linkItems['drive:'+driveClip].folder,null);
 assert(el('reviewGrid').children.some(x=>x.dataset.source==='drive'&&x.dataset.clip===driveClip));
 badReceipt=false;await el('approvalForm').handlers.submit({preventDefault(){}});
 for(let i=0;i<6;i++)await flush();
 assert.equal(el('approvalDialog').open,false);
 assert.equal(linkItems['drive:'+driveClip].folder,'G123');
 // Group filing must persist one authoritative entry with two people, including
 // a second person added via the repeatable + selector, and show it in both.
 driveOnlyPerson.automatic_appearance_group=false;
 panes[1].handlers.click();for(let i=0;i<8;i++)await flush();
 // Earlier Drive-only source selection must not hide the synthetic SD group.
 el('reviewSource').value='all';el('reviewSource').handlers.change();
 const groupRow=el('reviewGrid').children.find(x=>x.dataset.source==='sd'&&x.dataset.clip===clip);
 assert(groupRow,'Unassigned reviewed original for a group fixture must be present');
 const groupFile=scan(groupRow,'✓ File under person');
 assert(groupFile,'Group candidate must be fileable');
 groupFile.handlers.click();el('approvalFolder').value='G123';
 el('approvalAddPerson').handlers.click();
 assert.equal(el('approvalMorePeople').children.length,1,'Plus inserts another person picker');
 el('approvalMorePeople').children[0].children[0].value='GDRIVE';
 await el('approvalForm').handlers.submit({preventDefault(){}});
 for(let i=0;i<12;i++)await flush();
 const groupPost=linkPosts.at(-1).payload;
 assert.equal(groupPost.action,'assign_many');
 assert.equal(groupPost.source,'sd');
 assert.equal(groupPost.name,clip);
 assert.equal(groupPost.folder,'G123');
 assert.equal(groupPost.folders.join(','),'G123,GDRIVE');
 assert.equal(linkItems['sd:'+clip].folders.join(','),'G123,GDRIVE');
 panes[2].handlers.click();for(let i=0;i<9;i++)await flush();
 const groupPeople=[...el('savedList').children];
 assert(groupPeople.some(x=>x.children[1]?.children[0]?.textContent==='Drive-only person'),
  'Secondary person must remain saved and accessible');
 const secondary=groupPeople.find(x=>x.children[1]?.children[0]?.textContent==='Drive-only person');
 secondary.handlers.click();for(let i=0;i<10;i++)await flush();
 assert(el('folderGrid').children.some(x=>x.dataset.source==='sd'&&x.dataset.clip===clip),
  'Second person folder must display the same manually group-assigned original');
 console.log('S9_PEOPLE_FACES_V45_WORKSPACE_TEST_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});

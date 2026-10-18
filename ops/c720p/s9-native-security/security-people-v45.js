(()=>{
'use strict';
/* People & Faces V45: task-first independent UI, authenticated existing v40 API.
   No recording is changed or assigned automatically. */
const $=id=>document.getElementById(id);
const elt=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(cls)e.className=cls;return e};
const state={pane:'people',folder:'',tab:'inbox',offset:0,limit:48,doc:null,
 busy:false,loading:false,serial:0,faceList:[],faceLoaded:false,facePage:0,folderPortraits:new Map(),
 approvalItem:null,editMode:'create',playSerial:0,playTime:0,compareItem:null,
 faceSummary:null,clipEvidence:new Map(),faceFetchToken:0,snapshotRequest:0,snapshotSelected:null,lastFolder:'',folderReturnPane:'people',archiveClips:null,archiveEntries:[],driveStatus:'loading',extraLinks:null,legacyAssigned:new Map(),assignedReady:false,linksRevision:0,archiveToken:0};
const clipName=/^motion_[0-9]{13}[.]mp4$/;
const faceName=/^motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2][.]jpg$/;
const cropName=/^[A-Za-z0-9._-]{1,200}[.]jpg$/;
function relay(){
 let w=window;
 for(let i=0;i<5;i++){
  try{if(w.C720PSecureRelay?.fetch&&w.C720PSecureRelay?.url)return w.C720PSecureRelay;
   if(w===w.parent)break;w=w.parent}catch(_){break}
 }
 throw Error('Open People & Faces inside the Home Assistant Security hub.');
}
function alertText(text){$('message').textContent=String(text||'');$('message').hidden=!text}
function notification(text,undo){
 const host=$('notice');host.replaceChildren(elt('span',text));
 if(undo)host.append(control('Undo',undo,'secondary'));
 host.hidden=false;
}
function clearNote(){$('notice').hidden=true;$('notice').replaceChildren()}
function control(label,cb,kind){
 const b=elt('button',label,kind||'secondary');b.type='button';
 b.addEventListener('click',()=>{if(!state.busy)cb()});return b;
}
function num(x){const n=Number(x);return Number.isFinite(n)&&n>=0?n:0}
function stampMs(ms){const t=Number(ms);return Number.isFinite(t)&&t>0?
 new Date(t).toLocaleString('en-GB',{timeZone:'Europe/Amsterdam',day:'2-digit',
 month:'short',hour:'2-digit',minute:'2-digit'}):'Recording time unavailable'}
function date(item){return stampMs(item.recorded_ms)}
const driveName=/^[A-Za-z0-9._-]{1,180}[.]mp4$/;
const driveSnap=/^[A-Za-z0-9._-]{1,180}[.]jpg$/;
function assignmentKey(item){return (item.source==='drive'?'drive':'sd')+':'+String(item.name||item.clip||'')}
function assignedFolder(item){
 const key=assignmentKey(item);
 const explicit=state.extraLinks?.items?.[key];
 if(explicit&&Object.prototype.hasOwnProperty.call(explicit,'folder'))return explicit.folder||null;
 return state.legacyAssigned.get(key)||null;
}
function makeArchiveRows(){
 const sd=[...state.clipEvidence.keys()].map(clip=>({
  source:'sd',name:clip,clip,recorded_ms:Number(clip.slice(7,20)),
  video_path:'/new/saved/clip/'+encodeURIComponent(clip),
  temporal_support:!!state.clipEvidence.get(clip)?.person_event_category
 }));
 const byName=new Map(sd.map(e=>[e.name,e]));
 for(const rec of state.driveRecords||[]){
  const name=String(rec.remote_name||'');
  if(!driveName.test(name)||name.includes('..')||byName.has(name))continue;
  const timestamp=Date.parse(String(rec.timestamp||rec.date||''));
  if(!Number.isFinite(timestamp)||timestamp<=0)continue;
  byName.set(name,{
   source:'drive',name,clip:name,recorded_ms:timestamp,unindexed:true,
   video_path:'/new/drive/saved/clip/'+encodeURIComponent(name),
   snapshot_name:rec.snapshot_name,temporal_support:false
  });
 }
 state.archiveEntries=[...byName.values()].sort((a,b)=>
  num(b.recorded_ms)-num(a.recorded_ms)||String(a.name).localeCompare(String(b.name)));
 $('archiveCount').textContent=String(state.archiveEntries.length);
}
async function fetchExtraLinks(){
 const response=await relay().fetch('/new/api/visual-review?workflow=manual_recording_links_v1',{cache:'no-store'});
 const data=await response.json();
 if(!response.ok||data.ok!==true||!data.manual_links_only||!data.items)
  throw Error('Manual recording links unavailable');
 state.extraLinks=data;state.linksRevision=data.revision;
}
async function fetchDriveArchive(){
 const response=await relay().fetch('/new/api/drive-saved',{cache:'no-store'});
 const data=await response.json();
 if(!response.ok||data.ok!==true||!Array.isArray(data.events)||
    data.archive_mode==='S9-microSD-only')throw Error('Drive archive unavailable');
 state.driveRecords=data.events;
 state.driveStatus='ready';
}
async function scanApprovedFolders(folders){
 // Read every page of the authoritative v40 approved lists. Never mistake
 // the current review-page slice for the full set of assigned originals.
 const assigned=new Map();
 for(const folder of folders.filter(isSaved)){
  let offset=0,total=0;
  do{
   const q=new URLSearchParams({workflow:'clip_folders_v40',tab:'approved',
       folder:String(folder.id),offset:String(offset),limit:'48'});
   const response=await relay().fetch('/new/api/visual-review?'+q,{cache:'no-store'});
   const data=await response.json();
   if(!response.ok||data.ok!==true||!Array.isArray(data.items))
    throw Error('Cannot verify all saved assignments');
   total=num(data.total);
   for(const item of data.items)if(clipName.test(String(item.clip||'')))
     assigned.set('sd:'+item.clip,folder.id);
   if(data.items.length===0&&offset<total)throw Error('Incomplete assigned archive');
   offset+=data.items.length;
   if(offset>5000)throw Error('Assigned archive too large');
  }while(offset<total);
 }
 state.legacyAssigned=assigned;state.assignedReady=true;
}
async function refreshArchiveReviewSources(folders){
 const token=++state.archiveToken;
 state.assignedReady=false;
 const jobs=await Promise.allSettled([fetchExtraLinks(),fetchDriveArchive(),
     scanApprovedFolders(folders)]);
 if(token!==state.archiveToken)return;
 if(jobs[0].status!=='fulfilled'||jobs[2].status!=='fulfilled'){
  $('reviewTotal').textContent='Review index unavailable · Refresh';
  alertText('Could not safely verify assigned recordings; refresh to retry.');
  return;
 }
 if(jobs[1].status!=='fulfilled')state.driveStatus='unavailable';
 makeArchiveRows();
 if(state.doc)render();
}
async function manualLink(item,folder){
 if(state.busy||!state.extraLinks)return false;
 const data={action:folder?'assign':'return_to_queue',
   source:item.source==='drive'?'drive':'sd',name:String(item.name||item.clip),
   folder:folder||null,revision:state.linksRevision,human_confirmed:true};
 state.busy=true;
 try{
  const response=await relay().fetch('/new/api/visual-review/review',{
   method:'POST',headers:{'Content-Type':'application/json',
    'X-S9-Manual-Link-Intent':'manual-original-review-links-v1'},
   body:JSON.stringify(data)});
  const outcome=await response.json();
  if(!response.ok||outcome.ok!==true)throw Error(outcome.error||'Could not save folder link');
  await fetchExtraLinks();
  state.lastFolder=folder||state.lastFolder;
  notification(folder?'Recording saved':'Recording returned to review');
  return true;
 }catch(error){alertText(String(error.message||error));return false}
 finally{state.busy=false;await loadView();if(state.doc)render()}
}

function actualFolder(){return state.doc?.folders.find(f=>f.id===state.folder)}
function isSaved(f){return !f.automatic_appearance_group||num(f.approved_clips)>0}
function savedFolders(){return (state.doc?.folders||[]).filter(isSaved).sort((a,b)=>num(b.approved_clips)-num(a.approved_clips))}
function tentativeFolders(){return (state.doc?.folders||[]).filter(f=>!isSaved(f)).sort((a,b)=>num(b.suggested_clips)-num(a.suggested_clips))}
function imageFor(crop,alt,kind){
 const wrap=elt('div','',kind||'media');
 if(!crop||!cropName.test(String(crop.name||''))){wrap.append(elt('span','No saved image'));return wrap}
 const img=elt('img');img.loading='lazy';img.decoding='async';img.alt=alt;
 wrap.append(img);
 Promise.resolve().then(()=>relay().url('/new/api/visual-review/crop/'+encodeURIComponent(crop.name)))
  .then(url=>{if(img.isConnected)img.src=url}).catch(()=>{});
 img.addEventListener('error',()=>{img.remove();wrap.append(elt('span','Image unavailable · play video'))},{once:true});
 return wrap;
}
function sceneFor(item){
 const clip=String(item?.clip||'');
 const fallback=imageFor(item?.full_crop,'Detector crop (scene thumbnail unavailable)');
 if(item?.source==='drive'){
  const name=String(item.snapshot_name||'');
  const host=elt('div','','media scene-media');
  if(!driveSnap.test(name)||name.includes('..')){host.append(elt('span','Drive recording'));return host}
  const img=elt('img');img.alt='Historical Drive recording preview';
  img.loading='lazy';host.append(img);
  Promise.resolve().then(()=>relay().url('/new/drive/saved/snap/'+encodeURIComponent(name)))
   .then(url=>{if(img.isConnected)img.src=url}).catch(()=>{});
  return host;
 }
 if(!clipName.test(clip))return fallback;
 const host=elt('div','','media scene-media'),img=elt('img');
 img.loading='lazy';img.decoding='async';
 img.alt='Entire recording scene with surrounding context, not an identified person';
 host.append(img);
 Promise.resolve().then(()=>relay().url('/new/saved/snap/'+encodeURIComponent(clip+'.thumb.jpg')))
 .then(url=>{if(img.isConnected)img.src=url})
 .catch(()=>{if(host.isConnected)host.replaceChildren(fallback)});
 img.addEventListener('error',()=>{if(host.isConnected)host.replaceChildren(fallback)},{once:true});
 return host;
}
// Delay signed face URLs until on-screen, and limit simultaneous on-phone loads.
const faceQueue=[],facePending=new Set();let faceWorkers=0;
// Fetch JPEG bytes through the authenticated relay header rather than putting
// short-lived query tokens in <img src>. Verify MIME type and size first.
async function authenticatedFaceImageURL(source){
 const r=relay();
 if(!r?.fetch)throw Error('Secure relay unavailable');
 const response=await r.fetch(source,{cache:'no-store'});
 if(!response.ok)throw Error('Face endpoint HTTP '+response.status);
 if(typeof response.blob!=='function'||typeof URL==='undefined'||typeof URL.createObjectURL!=='function')
  return r.url(source); // Node regression mock / older browsers only
 const blob=await response.blob();
 if(blob.type!=='image/jpeg'||blob.size<512||blob.size>2200000)
  throw Error('Invalid face JPEG response');
 return URL.createObjectURL(blob);
}
function installFaceURL(img,url){
 img.src=url;
 if(typeof url==='string'&&url.startsWith('blob:')){
  // Retain the decoded frame, but release its temporary Blob URL.
  img.addEventListener('load',()=>setTimeout(()=>URL.revokeObjectURL(url),1800),{once:true});
  img.addEventListener('error',()=>URL.revokeObjectURL(url),{once:true});
 }
}
function pumpFaces(){
 while(faceWorkers<2&&faceQueue.length){
  const {img,source,host}=faceQueue.shift();
  if(!img.isConnected){facePending.delete(img);continue}
  faceWorkers++;
  let complete=false;
  const finish=()=>{
   if(complete)return;
   complete=true;faceWorkers=Math.max(0,faceWorkers-1);facePending.delete(img);pumpFaces();
  };
  const failure=e=>{
   if(!img.isConnected){finish();return}
   img.remove();
   const message=String(e?.message||'Unable to load');
   const placeholder=host.querySelector('.face-image-loading');
   if(placeholder)placeholder.textContent=message.startsWith('Face endpoint HTTP')?message+' · Open recording':'Face image unavailable · Open recording';
   else host.append(elt('span','Face image unavailable · Open recording'));
   finish();
  };
  img.addEventListener('load',finish,{once:true});
  img.addEventListener('error',()=>failure(Error('JPEG decoding failed')),{once:true});
  (async()=>{
   try{
    let url;
    try{url=await authenticatedFaceImageURL(source)}
    catch(_){url=await authenticatedFaceImageURL(source)} // one authenticated retry
    if(img.isConnected)installFaceURL(img,url);else{
     if(url.startsWith('blob:'))URL.revokeObjectURL(url);
     finish();
    }
   }catch(e){failure(e)}
  })();
  if(typeof setTimeout==='function')setTimeout(finish,30000);
 }
}
function queueVisibleFace(img,source,host){
 const queue=()=>{if(facePending.has(img))return;facePending.add(img);faceQueue.push({img,source,host});pumpFaces()};
 if(typeof IntersectionObserver==='undefined'){queue();return}
 const observer=new IntersectionObserver(items=>{
  if(items.some(x=>x.isIntersecting)){observer.disconnect();queue()}
 },{rootMargin:'280px'});
 observer.observe(host);
}
// The S9+ sometimes saves manually-rescued *context* crops containing clothes,
// bicycles or scenery. An original JPEG is NOT proof of a detected face.
// Only crops produced by a reliable 4K embedding-grade face observation may
// receive an automatic face thumbnail. No identity link is implied.
const strongFaceStatuses=new Set([
 'new_anonymous_candidate','anonymous_similarity_unverified',
 'reference_similarity_unverified']);
function credibleFaceCrop(f){
 const face=f?.face||{};
 return face.face_crop_requires_manual_review===false&&
  face.face_crop_padded_context_only===false&&
  strongFaceStatuses.has(String(face.match_status||''))&&
  face.snapshot_on_s9!==false&&faceName.test(String(face.snapshot_name||''));
}
function reliableFaces(clip){
 const seen=new Set();
 return state.faceList.filter(f=>f.clip===clip&&credibleFaceCrop(f)).filter(f=>{
  const key=String(f.face.snapshot_sha256||f.face.snapshot_name);
  if(seen.has(key))return false;seen.add(key);return true;
 });
}
function mediaForFace(f){
 const host=elt('div','','media');
 const img=elt('img');img.loading='lazy';img.decoding='async';img.alt='Captured face for manual review';
 const loading=elt('span','Loading face image…','face-image-loading');
 host.append(loading,img);
 const name=String(f?.face?.snapshot_name||'');
 if(!faceName.test(name)){loading.textContent='No saved face image';img.remove();return host}
 queueVisibleFace(img,'/new/saved/face/'+encodeURIComponent(name),host);
 img.addEventListener('load',()=>loading.remove(),{once:true});
 img.addEventListener('error',()=>{img.remove();loading.textContent='Face image unavailable · inspect original recording'},{once:true});
 return host;
}
function badge(media,text){media.append(elt('span',text,'corner'))}
function fields(item){return Object.fromEntries(['clip','source_sha256','observation','signature'].map(k=>[k,item[k]]))}
async function loadView(){
 if(state.busy)return;
 // Latest request wins. View switches must not inherit the old tab's response.
 state.loading=true;const token=++state.serial;alertText('');
 const q=new URLSearchParams({workflow:'clip_folders_v40',tab:state.tab,
  offset:String(state.offset),limit:String(state.limit)});
 if(state.folder)q.set('folder',state.folder);
 if(state.tab==='suggestions'){
  q.set('distance',$('distance').value);q.set('weak',$('weak').value);q.set('route',$('route').value)
 }
 try{
  const res=await relay().fetch('/new/api/visual-review?'+q.toString(),{cache:'no-store'});
  const next=await res.json();
  if(token!==state.serial)return;
  if(!res.ok||next.ok!==true||!Array.isArray(next.folders)||!Array.isArray(next.items))
   throw Error(next.error||'The review archive is unavailable.');
  state.doc=next;
  if(state.pane==='review'&&!state.assignedReady&&state.archiveEntries.length===0)
   refreshArchiveReviewSources(next.folders);
  const pageTotal=state.tab==='all'&&state.archiveClips?
   state.archiveClips.length:num(next.total);
  if(state.offset>=pageTotal&&pageTotal>0&&state.pane!=='review'){
   state.offset=Math.max(0,Math.floor((pageTotal-1)/state.limit)*state.limit);
   state.loading=false;return loadView();
  }
  render();
 }catch(err){if(token===state.serial)alertText(err.message||'Unable to load review data')}
 finally{if(token===state.serial)state.loading=false}
}
async function fetchFaces(){
 if(state.faceLoaded)return;
 const requestToken=++state.faceFetchToken;
 try{
  const r=await relay().fetch('/new/api/saved',{cache:'no-store'});
  const data=await r.json();
  if(requestToken!==state.faceFetchToken)return;
  if(!r.ok||data.archive_mode!=='S9-microSD-only'||!Array.isArray(data.events))
   throw Error('S9+ face image archive unavailable');
  const found=[];
  const byClip=new Map();
  let candidateRecords=0;
  const v5Reviewed=data.events.filter(rec=>rec.face_deep_review_version==='s9_onphone_36_samples_overlapping_tiles_v5').length;
  for(const rec of data.events){
   if(!clipName.test(String(rec.clip_no||'')))continue;
   byClip.set(rec.clip_no,rec);
   const candidates=Array.isArray(rec.face_candidates)?rec.face_candidates:[];
   candidateRecords+=candidates.length;
   for(const face of candidates.slice(0,48)){
    if(!face||!faceName.test(String(face.snapshot_name||''))||face.snapshot_on_s9===false)continue;
    if(!String(face.snapshot_name).startsWith(rec.clip_no.slice(0,-4)+'__'))continue;
    found.push({clip:rec.clip_no,face,recording:rec});
   }
  }
  state.clipEvidence=byClip;
  state.archiveClips=[...byClip.keys()].sort((a,b)=>b.localeCompare(a));
  makeArchiveRows();
  if(state.doc)refreshArchiveReviewSources(state.doc.folders);
  state.faceList=found.sort((a,b)=>String(b.clip).localeCompare(String(a.clip)));
  state.faceSummary={reviewed:v5Reviewed,total:data.events.length,
   snapshots:found.length,withoutSnapshot:Math.max(0,candidateRecords-found.length)};
  state.faceLoaded=true;
  $('archiveCount').textContent=String(state.archiveClips.length);
  renderMetrics();
  if(state.doc)render();
 }catch(e){
  if(requestToken!==state.faceFetchToken)return;
  state.faceSummary=null;
  state.clipEvidence=new Map();
 state.archiveClips=null;
  $('archiveCount').textContent='—';
  $('faceScanLabel').textContent='Unavailable';
  $('facePhotoStatus').textContent='Face snapshot metadata is currently unavailable. Try Refresh.';
  // The separate crop gallery is intentionally retired; original recordings remain accessible.
 }
}
async function action(data,after){
 if(state.busy||!state.doc)return false;
 state.busy=true;state.serial++;alertText('');
 const request={...data,revision:state.doc.revision,human_confirmed:true};
 try{
  const r=await relay().fetch('/new/api/visual-review/review',{
   method:'POST',headers:{'Content-Type':'application/json',
    'X-S9-Visual-Review-Intent':'manual-attributes-v36'},
   body:JSON.stringify(request)});
  const result=await r.json();
  if(!r.ok||result.ok!==true)throw Error(({
    reviewed_view_changed_refresh:'The observed image has changed. Inspect again.',
    review_changed_refresh_then_retry:'Another review changed. Refresh and try again.'
   })[result.error]||result.error||'Review decision could not be saved.');
  if(after)after(result);
  return true;
 }catch(e){alertText(e.message||'Review decision failed');return false}
 finally{state.busy=false;state.loading=false;await loadView()}
}
function openReview(mode){
 state.pane='review';state.folder='';state.tab=mode||'all';state.offset=0;
 $('reviewMode').value=state.tab;
 selectPane('review');loadView();fetchFaces();
 if(state.doc)refreshArchiveReviewSources(state.doc.folders);
}
function openFolder(id,tab){
 const f=state.doc?.folders.find(f=>f.id===id);if(!f)return;
 state.folderReturnPane=f.automatic_appearance_group&&!isSaved(f)?'clothing':'people';
 state.pane='folder';state.folder=id;state.tab=tab|| (num(f.approved_clips)?'approved':'suggestions');
 state.offset=0;state.facePage=0;$('folderMode').value=state.tab;
 selectPane('folder');loadView();
}
function openHome(pane){
 state.pane=pane;state.folder='';state.tab='inbox';state.offset=0;
 selectPane(pane);loadView();if(pane==='people'||pane==='clothing'||pane==='review')fetchFaces();
}
function selectPane(pane){
 for(const name of ['overview','review','people','clothing','folderView'])
  $(name).hidden=(name!==(pane==='folder'?'folderView':pane));
 for(const b of document.querySelectorAll('[data-pane]')){
  const expected=pane==='folder'?state.folderReturnPane:pane;
  b.setAttribute('aria-selected',String(b.dataset.pane===expected));
 }
}
function openApproval(item){
 state.approvalItem=item;
 $('approvalClip').textContent='Recording · '+date(item);
 const select=$('approvalFolder');select.replaceChildren();
 select.add(new Option('Create a new folder',''));
 for(const f of savedFolders())select.add(new Option(f.label,f.id));
 if(state.folder){
  const f=actualFolder();
  if(f?.automatic_appearance_group)select.add(new Option('Keep in '+f.label+' (reviewed)',f.id));
 }
 $('approvalLabel').value='';
 if(state.folder)select.value=state.folder;
 else if(state.lastFolder&&savedFolders().some(f=>f.id===state.lastFolder))select.value=state.lastFolder;
 $('newLabel').hidden=!!select.value;
 $('approvalDialog').showModal();
 const main=$('approvalDialog').querySelector('.approval-main');
 if(main&&typeof main.scrollTop==='number')main.scrollTop=0;
 if(typeof $('approvalFolder').focus==='function')$('approvalFolder').focus();
}
function dismiss(item){
 const currentFolder=state.folder;
 const code=currentFolder?'reject_clip':'skip_clip';
 action({action:code,folder:currentFolder,...fields(item)},()=>{
  notification('Clip removed from the current review queue.',
    ()=>action({action:currentFolder?'restore_clip':'restore_inbox_clip',folder:currentFolder,...fields(item)}));
 });
}
function restore(item){
 const currentFolder=state.folder;
 action({action:currentFolder?'restore_clip':'restore_inbox_clip',folder:currentFolder,...fields(item)},
  ()=>notification('Clip returned for review.'));
}
function startVideo(item){
 const sec=num(item?.full_crop?.time_ms)/1000;
 playVideo(item.video_path,date(item),sec);
}
async function playVideo(path,title,seconds){
 const ticket=++state.playSerial;
 if(typeof path!=='string'||!path.startsWith('/new/')){alertText('Invalid clip path');return}
 const modal=$('viewer');$('videoTitle').textContent=title;
 $('videoStatus').textContent='Opening original recording…';state.playTime=Math.max(0,seconds||0);
 if(!modal.open)modal.showModal();
 try{
  const url=await relay().url(path);
  if(ticket!==state.playSerial)return;
  $('video').src=url;$('video').load();
 }catch(e){if(ticket===state.playSerial)$('videoStatus').textContent='Could not access the recording: '+e.message}
}
// Step 3: display observations anchored to the EXACT original clip. A
// recording may contain multiple people; NEVER pair a face with a particular
// track or declare the same person across recordings from these observations.
const movementLabels=Object.freeze({
 image_left:'moves left across image',image_right:'moves right across image',
 image_up:'moves upward in image',image_down:'moves downward in image',
 stationary:'little image movement',insufficient_samples:'direction not measured'
});
const colourLabels=new Set(['black','white','grey','gray','blue','red','green','yellow',
 'orange','purple','pink','brown','tan','beige','multicolour','multicolor']);
function step3ClipEvidence(item){
 const clip=String(item?.clip||'');
 const record=clipName.test(clip)?state.clipEvidence.get(clip):null;
 const root=elt('details','','step3-evidence');
 const heading=elt('summary','Face and movement evidence · Expand details');
 root.append(heading);
 const details=elt('div','','step3-evidence-lines');
 const faces=reliableFaces(clip).slice(0,8);
 const tracks=record&&Array.isArray(record.anonymous_tracks)?
  record.anonymous_tracks.slice(0,8):[];
 if(!record){
  details.append(elt('span',state.faceLoaded?
   'Additional face and movement metadata unavailable for this clip':
   'Loading independent face and movement observations…'));
 }else{
  details.append(elt('span',tracks.length+' person tracks · '+faces.length+' usable face candidates'));
  if(tracks.length){
   for(const [i,track] of tracks.entries()){
    const shade=String(track?.upper_clothing_colour||'').toLowerCase();
    const colour=colourLabels.has(shade)?shade:'colour not measured';
    const direction=movementLabels[track?.image_movement_direction]||'direction not measured';
    details.append(elt('span','Track '+(i+1)+' · clothing '+colour+' · '+direction));
   }
  }
  details.append(elt('span','Body pose and gait: not verified · No cross-clip identity claim'));
 }
 root.append(details);
 if(faces.length){
  const buttons=elt('div','','step3-face-links');
  for(const [i,face] of faces.entries())
   buttons.append(control('View face candidate '+(i+1),()=>inspectFaceSnapshot(face),'secondary'));
  root.append(buttons);
 }
 return root;
}
function reviewFacesForClip(item){
 const faces=reliableFaces(item.clip).slice(0,3);
 if(!faces.length)return null;
 const host=elt('div','','review-face-evidence');
 host.append(elt('small','Face candidates'));
 const group=elt('div','','review-face-strip');
 for(const [i,face] of faces.entries()){
  const button=control('',()=>inspectFaceSnapshot(face),'review-face-button');
  button.setAttribute('aria-label','Inspect captured face '+(i+1));
  button.replaceChildren(mediaForFace(face));
  group.append(button);
 }
 host.append(group);
 return host;
}
function reviewItem(item,compact){
 const root=elt('article','',compact?'review-row':'evidence');
 root.dataset.clip=String(item.clip||'');
 const media=sceneFor(item);
 const info=elt('div','',compact?'row-info':'body');
 badge(media,item.unindexed?'ARCHIVE':item.person_recheck_required?'RECHECK':item.decision==='approved'?'SAVED':item.temporal_support?'PERSON':'REVIEW');
 const main=elt('strong',date(item));
 info.append(main);
 if(!compact){const faceEvidence=reviewFacesForClip(item);if(faceEvidence)info.append(faceEvidence)}
 if(item.unindexed)info.append(elt('p',item.source==='drive'?'Google Drive':'Person analysis unavailable'));
 else if(item.person_recheck_required)info.append(elt('p','Person evidence needs recheck'));
 else if(!item.temporal_support)info.append(elt('p','Person evidence uncertain'));
 const tools=elt('div','','actions');
 tools.append(control('▶ Play',()=>startVideo(item)));
 if(item.decision==='approved'){
  if(state.folder)tools.append(control('↩ Return to recordings',
    ()=>manualLink({source:item.source||'sd',name:item.name||item.clip,clip:item.clip},null),'secondary'));
  else tools.append(control('Saved ✓',()=>{},'secondary'));
 }else if(item.unindexed||item.source==='drive'){
  tools.append(control('✓ Choose person / folder',()=>openApproval(item),'primary'));
 }else if(item.decision==='approved'){
  tools.append(control('Saved ✓',()=>{},'secondary'));tools.lastChild.disabled=true;
 }else if(['rejected','skipped'].includes(item.decision)){
  tools.append(control('Restore',()=>restore(item),'secondary'));
 }else{
  tools.append(control(state.folder?'✓ Keep here':'✓ Choose person / folder',()=>openApproval(item),'primary'),
   control('✕ Skip',()=>dismiss(item),'danger'));
 }
 if(state.folder&&state.doc?.reference_examples?.length&&item.decision!=='approved')
  tools.append(control('Compare',()=>compare(item)));
 info.append(tools);
 // Detailed track analytics remain on Tracks & Movements, not each card.
 if(compact)root.append(media,info);
 else root.append(media,info);
 return root;
}
function portraitKey(id){return 's9security.folderPortrait.v1.'+String(id).slice(0,100)}
function chosenPortrait(f){
 const id=String(f?.id||'');
 if(!id)return null;
 let saved=state.folderPortraits.get(id);
 if(!saved&&typeof localStorage!=='undefined'){
  try{saved=JSON.parse(localStorage.getItem(portraitKey(id))||'null')}catch(_){}
 }
 if(!saved||!faceName.test(String(saved.name||''))||!clipName.test(String(saved.clip||'')))return null;
 return state.faceList.find(x=>x.clip===saved.clip&&x.face.snapshot_name===saved.name&&credibleFaceCrop(x))||null;
}
function choosePortrait(f,face){
 // The user, not the model, picks this folder's cover from an approved clip.
 const id=String(f.id||''),name=String(face?.face?.snapshot_name||'');
 if(!id||!faceName.test(name)||!credibleFaceCrop(face)||
     !state.doc?.items?.some(x=>x.clip===face.clip&&x.decision==='approved')){
  alertText('Choose a face image from an approved recording in this folder.');return;
 }
 const data={name,clip:face.clip};state.folderPortraits.set(id,data);
 if(typeof localStorage!=='undefined'){
  try{localStorage.setItem(portraitKey(id),JSON.stringify(data))}
  catch(_){notification('Folder photo selected for this session; browser storage is unavailable.')}
 }
 notification('Folder photo selected on this browser. Your review approvals were not changed.');
 renderFolder();
}
function approvedPreviewClip(preview){
 for(const value of [preview?.clip,preview?.clip_no,preview?.source_clip,preview?.name]){
  const m=/^(motion_[0-9]{13}[.]mp4)(?:[.]|$)/.exec(String(value||''));
  if(m)return m[1];
 }
 return '';
}
function automaticPortrait(f){
 if(!f||!num(f.approved_clips))return null;
 const approved=new Set((Array.isArray(f.previews)?f.previews:[])
  .map(approvedPreviewClip).filter(Boolean));
 if(state.folder===f.id){
  for(const item of state.doc?.items||[])if(item.decision==='approved'&&clipName.test(String(item.clip||'')))
   approved.add(item.clip);
 }
 if(!approved.size)return null;
 // Never recycle the same face between people or guess from group footage.
 const proposed=new Map();
 const reserved=new Set();
 for(const folder of savedFolders().slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)))){
  const source=new Set((Array.isArray(folder.previews)?folder.previews:[])
   .map(approvedPreviewClip).filter(Boolean));
  if(state.folder===folder.id)for(const x of state.doc?.items||[])
   if(x.decision==='approved'&&clipName.test(String(x.clip||'')))source.add(x.clip);
  const options=[];
  for(const clip of source){
   const faces=reliableFaces(clip);
   // A crop in a multi-person recording cannot be assigned to an individual.
   const rec=state.clipEvidence.get(clip);
   const tracks=rec?.anonymous_tracks||rec?.person_tracks||[];
   if(faces.length!==1||tracks.length>1)continue;
   const key=String(faces[0].face.snapshot_sha256||faces[0].face.snapshot_name);
   if(!reserved.has(key))options.push(faces[0]);
  }
  options.sort((a,b)=>num(b.face.snapshot_size)-num(a.face.snapshot_size)||
   String(a.face.snapshot_name).localeCompare(String(b.face.snapshot_name)));
  const selected=options[0]||null;
  if(selected){
   const key=String(selected.face.snapshot_sha256||selected.face.snapshot_name);
   reserved.add(key);
  }
  proposed.set(folder.id,selected);
 }
 return proposed.get(f.id)||null;
}
function profileRow(f){
 const b=control('',()=>openFolder(f.id),'profile');b.replaceChildren();
 const avatar=elt('div','', 'avatar');
 const face=chosenPortrait(f)||automaticPortrait(f);
 if(face){
  avatar.append(mediaForFace(face));
  avatar.title='Candidate from a reviewed recording';
 }else avatar.append(elt('span',(String(f.label||'?')[0]||'?').toUpperCase()));
 const info=elt('div');info.append(elt('strong',f.label),
  elt('small',num(f.approved_clips)+' reviewed '+(num(f.approved_clips)===1?'recording':'recordings')+
    (num(f.approvals_needing_person_recheck)?' · '+num(f.approvals_needing_person_recheck)+' need recheck':'')),
  elt('small',face?'Portrait from reviewed recording':'No verified face portrait yet'));
 b.append(avatar,info,elt('span','Open recordings →','arrow'));
 return b;
}
function groupRows(host){
 host.replaceChildren();
 const groups=tentativeFolders();
 if(!groups.length){host.append(elt('p','No provisional groups available.','status'));return}
 for(const f of groups){
  const b=control('',()=>openFolder(f.id,'suggestions'),'candidate-folder');
  const preview=Array.isArray(f.previews)&&f.previews.length?f.previews[0]:null;
  const match=/^(motion_[0-9]{13}[.]mp4)(?:[.]|$)/.exec(String(preview?.name||''));
  const picture=preview?
   (match?sceneFor({clip:match[1],full_crop:preview}):imageFor(preview,'Appearance evidence, not identified')):
   elt('span','No preview available','candidate-empty');
  b.replaceChildren(picture,elt('strong',f.label),
   elt('small',num(f.suggested_clips)+' unverified suggestions · Open to review'));
  host.append(b);
 }
}
function renderMetrics(){
 const f=state.doc?.folders||[];
 const saved=f.filter(isSaved);
 $('queueCount').textContent=String(num(state.doc?.inbox_clips));
 const queue=num(state.doc?.inbox_clips);
 $('reviewTabCount').textContent=queue?' · '+queue:'';
 $('peopleReviewNotice').hidden=queue===0;
 $('peopleReviewSummary').textContent=queue+(queue===1?' recording needs':' recordings need')+' review';
 $('personCount').textContent=String(saved.length);
 $('approvalCount').textContent=String(saved.reduce((n,x)=>n+num(x.approved_clips),0));
 $('groupCount').textContent=String(tentativeFolders().length);
 $('clothingTabCount').textContent=tentativeFolders().length?' · '+tentativeFolders().length:'';
 const scan=state.doc?.person_detection;
 if(scan&&num(scan.total_clips)){
  const total=num(scan.total_clips),reviewed=Math.min(total,num(scan.assessed_clips));
  $('personScanLabel').textContent=reviewed+' / '+total+
    (scan.status==='complete'?' · complete':'');
  $('personScanProgress').value=Math.round(100*reviewed/total);
  $('scanStatus').textContent=num(scan.clips_with_supported_people)+
   ' recordings with supported person evidence. Lack of detection is not proof that nobody appeared.';
 }else{
  $('personScanLabel').textContent='No current data';
  $('personScanProgress').value=0;
  $('scanStatus').textContent='Person-detection coverage is currently unavailable.';
 }
 const fs=state.faceSummary;
 if(fs&&fs.total){
  const reviewed=Math.min(fs.total,fs.reviewed);
  $('faceScanLabel').textContent=reviewed+' / '+fs.total+
   (reviewed===fs.total?' · reviewed':' · remaining '+(fs.total-reviewed));
  $('faceScanProgress').value=Math.round(100*reviewed/fs.total);
  $('facePhotoStatus').textContent=fs.snapshots+' candidate crops · only face-qualified crops are shown';
 }else if(!state.faceLoaded){
  $('faceScanLabel').textContent='Loading…';
  $('faceScanProgress').value=0;
 }
}
function renderOverview(){
 const flagged=savedFolders().filter(f=>num(f.approvals_needing_person_recheck)>0);
 const reviewAlerts=$('reviewAlerts');reviewAlerts.replaceChildren();
 for(const f of flagged.slice(0,3)){
  const count=num(f.approvals_needing_person_recheck);
  const summary=elt('div','', 'recheck-row');
  const body=elt('div');body.append(elt('strong',f.label+' · '+count+' previously kept '+(count===1?'clip needs':'clips need')+' rechecking'),
   elt('small','The latest person scan did not support the prior result. Review the original recordings.'));
  summary.append(body,control('Inspect originals →',()=>openFolder(f.id,'approved'),'secondary'));
  reviewAlerts.append(summary);
 }
 reviewAlerts.hidden=flagged.length===0;
 const host=$('reviewPreview');host.replaceChildren();
 const preview=state.doc?.items||[];
 for(const item of preview.slice(0,4))host.append(reviewItem(item,true));
 if(!preview.length)host.append(elt('p','No supported recordings waiting for review.','empty'));
 const saved=$('savedPreview');saved.replaceChildren();
 for(const f of savedFolders().slice(0,4))saved.append(profileRow(f));
 if(!saved.children.length)saved.append(elt('p','No saved groups yet. Use Keep after reviewing a recording.','empty'));
 // Clothing suggestions are accessible in their own tab.
}
function paginate(host,total,onPage){
 host.replaceChildren();const page=state.offset/state.limit;
 if(total<=state.limit)return;
 const back=control('← Previous',()=>onPage(Math.max(0,state.offset-state.limit)));
 back.disabled=state.offset===0;
 const forward=control('Next →',()=>onPage(state.offset+state.limit));
 forward.disabled=state.offset+state.limit>=total;
 host.append(back,elt('span',total?(state.offset+1)+'–'+Math.min(state.offset+state.limit,total)+' / '+total:'0 clips'),forward);
}
function renderReview(){
 $('reviewMode').value=state.tab;
 const host=$('reviewGrid');host.replaceChildren();
 if(state.tab==='all'){
  if(!state.assignedReady||!state.extraLinks){
   $('reviewTotal').textContent='Checking saved recordings…';
   host.append(elt('p','Loading the complete review queue…','empty'));return;
  }
  const free=state.archiveEntries.filter(item=>!assignedFolder(item));
  const visible=free.slice(state.offset,state.offset+state.limit);
  for(const item of visible){
   const fromReview=(state.doc?.items||[]).find(x=>x.clip===item.clip);
   // Preserve verified native observation fields for safe review actions.
   host.append(reviewItem({...item,...(item.source==='sd'&&fromReview?
    fromReview:{}),source:item.source,name:item.name,
    // Manual return overrides a historically approved v40 decision.
    decision:null,unindexed:!fromReview||item.source==='drive'},false));
  }
  const driveCount=free.filter(x=>x.source==='drive').length;
  const suffix=state.driveStatus==='unavailable'?' · Drive unavailable':' · '+driveCount+' Drive';
  $('reviewTotal').textContent=free.length+' unassigned recordings'+suffix;
  paginate($('reviewPage'),free.length,n=>{state.offset=n;renderReview()});
 }else{
  const unsaved=(state.doc?.items||[]).filter(item=>
   !assignedFolder({source:'sd',name:item.clip,clip:item.clip}));
  $('reviewTotal').textContent=unsaved.length+' review items';
  for(const item of unsaved)host.append(reviewItem(item,false));
  paginate($('reviewPage'),num(state.doc?.total),n=>{state.offset=n;loadView()});
 }
 if(!host.children.length)host.append(elt('p','No unassigned recordings in this view.','empty'));
}

function renderPeople(){
 const saved=$('savedList');saved.replaceChildren();
 for(const f of savedFolders())saved.append(profileRow(f));
 if(!saved.children.length)saved.append(elt('p','No reviewed folders. Create a folder or keep a recording to get started.','empty'));
 // Clothing suggestions are not mixed into the saved-people list.
}
function renderClothing(){
 groupRows($('clothingList'));
 $('clothingTotal').textContent=tentativeFolders().length+' provisional groups · not identified people';
}
function renderFolder(){
 const f=actualFolder();
 if(!f){alertText('This folder is no longer available');return}
 $('folderTitle').textContent=f.label;
 $('folderDescription').textContent=num(f.approved_clips)+' saved recording links · '+
  num(f.suggested_clips)+' appearance suggestions'+
  (num(f.approvals_needing_person_recheck)?' · '+num(f.approvals_needing_person_recheck)+' need person rechecking':'');
 $('folderRecheck').hidden=!num(f.approvals_needing_person_recheck);
 $('folderRecheck').textContent=num(f.approvals_needing_person_recheck)+
  ' saved clip(s) need rechecking against the original recording; a previous approval is not a current detector confirmation.';
 $('folderMode').value=state.tab;
 const suggestions=state.tab==='suggestions';
 for(const id of ['distanceLabel','weakLabel','routeLabel'])$(id).hidden=!suggestions;
 const context=$('folderContext');context.hidden=!f.automatic_appearance_group;
 $('folderContextText').textContent='Provisional clothing match. These recordings must be reviewed separately; this folder is NOT an automatically identified person.';
 const host=$('folderGrid');host.replaceChildren();
 for(const item of state.doc?.items||[]){
  if(state.tab==='approved'&&state.extraLinks?.items?.['sd:'+item.clip]?.folder!==undefined&&
     state.extraLinks.items['sd:'+item.clip].folder!==state.folder)continue;
  host.append(reviewItem({...item,source:'sd',name:item.clip},false));
 }
 if(state.tab==='approved'){
  // New manual links (Drive, unindexed SD, and corrected folder moves).
  for(const entry of state.archiveEntries){
   const override=state.extraLinks?.items?.[assignmentKey(entry)];
   if(!override||override.folder!==state.folder)continue;
   if(host.children.some?.(x=>x.dataset?.clip===entry.clip))continue;
   host.append(reviewItem({...entry,decision:'approved',
     manualAssignment:true,unindexed:entry.source==='drive'||!state.clipEvidence.has(entry.clip)},false));
  }
 }
 if(!host.children.length)host.append(elt('p',suggestions?'No appearance suggestions.':'No recordings in this folder.','empty'));
 // Only show images linked to manually approved recordings in this folder.
 // A linked recording can still contain a different person: never label a crop as an identified face.
 const facePanel=$('folderFaces'),faceGrid=$('folderFaceGrid');faceGrid.replaceChildren();
 const clips=new Set((state.doc?.items||[]).filter(x=>x.decision==='approved').map(x=>String(x.clip||'')));
 const faceMatches=state.faceList.filter(x=>clips.has(x.clip)&&credibleFaceCrop(x)).slice(0,16);
 facePanel.hidden=state.tab!=='approved'||faceMatches.length===0;
 if(!facePanel.hidden)for(const face of faceMatches){
  const cell=elt('div','','folder-photo-choice');
  const button=control('',()=>inspectFaceSnapshot(face),'folder-face');
  button.replaceChildren(mediaForFace(face),elt('small',stampMs(Number(face.clip.slice(7,20)))+' · View'));
  const selected=(chosenPortrait(f)||automaticPortrait(f))?.face.snapshot_name===face.face.snapshot_name;
  const set=control(selected?'✓ Cover photo':'Change cover photo',()=>choosePortrait(f,face),'secondary');
  set.setAttribute('aria-pressed',String(selected));
  cell.append(button,set);faceGrid.append(cell);
 }
 paginate($('folderPage'),num(state.doc?.total),n=>{state.offset=n;loadView()});
 const ref=$('references'),list=$('referenceList');list.replaceChildren();
 const references=state.doc?.reference_examples||[];
 ref.hidden=!(suggestions&&references.length);
 if(!ref.hidden)for(const item of references.slice(0,8)){
  const b=control('',()=>startVideo(item));
  b.replaceChildren(sceneFor(item),elt('small',date(item)));
  list.append(b);
 }
}
function facesInRecording(clip){
 return state.faceList.filter(f=>f.clip===clip).sort((a,b)=>
   num(a.face.time_ms)-num(b.face.time_ms)||
   String(a.face.snapshot_name).localeCompare(String(b.face.snapshot_name)));
}
function advanceFaceSnapshot(direction){
 const current=state.snapshotSelected;
 if(!current)return;
 const faces=facesInRecording(current.clip);
 const index=faces.findIndex(f=>f.face.snapshot_name===current.face.snapshot_name);
 if(index<0||index+direction<0||index+direction>=faces.length)return;
 inspectFaceSnapshot(faces[index+direction]);
}
function inspectFaceSnapshot(f){
 // Only indexed S9+ face crops may open; never infer that two crops share an identity.
 if(!f||!clipName.test(String(f.clip||''))||
    !faceName.test(String(f.face?.snapshot_name||'')))return;
 const ticket=++state.snapshotRequest;
 state.snapshotSelected=f;
 const clipFaces=facesInRecording(f.clip);
 const pos=clipFaces.findIndex(x=>x.face.snapshot_name===f.face.snapshot_name);
 const index=Math.max(0,pos);
 $('snapshotPosition').textContent='Image '+(index+1)+' of '+clipFaces.length+' in this recording';
 $('snapshotPrev').disabled=index===0;
 $('snapshotNext').disabled=index>=clipFaces.length-1;
 const t=Number(String(f.clip).slice(7,20));
 $('snapshotTitle').textContent='Face candidate · '+stampMs(t);
 $('snapshotDescription').textContent='Original 4K · '+(num(f.face.time_ms)/1000).toFixed(1)+' s';
 $('snapshotStatus').textContent='Loading saved crop securely…';
 $('snapshotImage').removeAttribute('src');
 $('snapshotPlay').disabled=false;
 const dialog=$('snapshotViewer');if(!dialog.open)dialog.showModal();
 Promise.resolve().then(()=>authenticatedFaceImageURL('/new/saved/face/'+encodeURIComponent(f.face.snapshot_name)))
 .then(url=>{
  if(ticket===state.snapshotRequest&&dialog.open)installFaceURL($('snapshotImage'),url);
  else if(url.startsWith('blob:'))URL.revokeObjectURL(url);
 })
 .catch(e=>{if(ticket===state.snapshotRequest)$('snapshotStatus').textContent=
   (String(e?.message||'Face image unavailable'))+'. Original recording remains accessible.'});
}
function closeFaceSnapshot(){
 ++state.snapshotRequest;
 $('snapshotViewer').close();
 $('snapshotImage').removeAttribute('src');
 state.snapshotSelected=null;
}
function render(){
 if(!state.doc)return;
 renderMetrics();
 if(state.pane==='overview')renderOverview();
 if(state.pane==='review')renderReview();
 if(state.pane==='people')renderPeople();
 if(state.pane==='folder')renderFolder();
 if(state.pane==='clothing')renderClothing();
}
function compare(item){
 const examples=(state.doc?.reference_examples||[]).slice(0,3);
 if(!examples.length)return;
 const host=$('compareGrid');host.replaceChildren();
 for(const [i,entry] of examples.entries()){
  const col=elt('div');
  col.append(elt('h3','Reviewed reference '+(i+1)),
   sceneFor(entry),elt('p',date(entry)+' · approved example, not automatic identity','status'),
   control('▶ View reference recording',()=>startVideo(entry)));
  host.append(col);
 }
 const proposed=elt('div');
 proposed.append(elt('h3','New clip to compare · unverified'),
  sceneFor(item),elt('p',date(item)+' · colour alone is unreliable','status'),
  control('▶ View new recording',()=>startVideo(item)));
 host.append(proposed);
 $('compareDialog').showModal();
}
function openFolderEditor(mode){
 state.editMode=mode;
 const f=actualFolder();
 $('folderDialogTitle').textContent=mode==='edit'?'Edit saved folder':'New saved folder';
 $('folderLabel').value=mode==='edit'&&f?f.label:'';
 $('folderNotes').value=mode==='edit'&&f?f.note||'':'';
 $('folderDialog').showModal();
}
function stopVideo(){++state.playSerial;const v=$('video');v.pause();v.removeAttribute('src');v.load()}
for(const b of document.querySelectorAll('[data-pane]'))b.addEventListener('click',()=>{
 const p=b.dataset.pane;if(p==='review')openReview('all');else openHome(p);
});
$('openReview').addEventListener('click',()=>openReview('all'));
$('peopleReviewNow').addEventListener('click',()=>openReview('inbox'));
$('openPeople').addEventListener('click',()=>openHome('people'));
$('openClothing').addEventListener('click',()=>openHome('clothing'));
$('backFolders').addEventListener('click',()=>openHome(state.folderReturnPane));
$('reviewMode').addEventListener('change',()=>{state.tab=$('reviewMode').value;state.offset=0;loadView()});
$('folderMode').addEventListener('change',()=>{state.tab=$('folderMode').value;state.offset=0;loadView()});
for(const id of ['distance','weak','route'])$(id).addEventListener('change',()=>{if(state.tab==='suggestions'){state.offset=0;loadView()}});
$('refresh').addEventListener('click',()=>{
 state.faceLoaded=false;
 state.faceSummary=null;
 state.clipEvidence=new Map();
 state.archiveClips=null;state.archiveEntries=[];state.driveRecords=[];
 state.extraLinks=null;state.assignedReady=false;
 loadView();
 fetchFaces();
});
$('newFolder').addEventListener('click',()=>openFolderEditor('create'));
$('newFolderInline').addEventListener('click',()=>openFolderEditor('create'));
$('editFolder').addEventListener('click',()=>openFolderEditor('edit'));
$('cancelFolder').addEventListener('click',()=>$('folderDialog').close());
$('cancelApproval').addEventListener('click',()=>$('approvalDialog').close());
$('approvalFolder').addEventListener('change',()=>{$('newLabel').hidden=!!$('approvalFolder').value});
$('approvalPlay').addEventListener('click',()=>{if(state.approvalItem)startVideo(state.approvalItem)});
$('approvalCancelFooter').addEventListener('click',()=>$('approvalDialog').close());
$('approvalForm').addEventListener('submit',async e=>{
 e.preventDefault();const item=state.approvalItem;if(!item)return;
 const id=$('approvalFolder').value;
 const label=$('approvalLabel').value.trim();
 // Confirm & keep is the explicit human-review decision; the second checkbox
 // previously required for the exact same decision is removed.
 if(!id&&(!label||label.length>100)){alertText('Enter a name for the new folder.');return}
 let folder=id;
 if(!folder){
  let created='';
  const done=await action({action:'create_folder',folder:'',label,note:''},result=>{
   created=String(result.folder||'');});
  if(!done||!created){alertText('Could not create a folder.');return}
  folder=created;
 }
 const ok=await manualLink({source:item.source||'sd',name:item.name||item.clip,clip:item.clip},folder);
 if(ok)$('approvalDialog').close();
});
$('folderForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const name=$('folderLabel').value.trim();
 if(!name){alertText('Choose a folder name');return}
 const payload={action:state.editMode==='edit'?'edit_folder':'create_folder',
  folder:state.editMode==='edit'?state.folder:'',label:name,note:$('folderNotes').value.slice(0,2000)};
 const ok=await action(payload,result=>{notification('Folder saved.');if(result.folder&&state.editMode==='create'){
  state.folder=result.folder;state.pane='folder';state.tab='suggestions';selectPane('folder')
 }});
 if(ok)$('folderDialog').close();
});
$('closeVideo').addEventListener('click',()=>$('viewer').close());
$('viewer').addEventListener('close',stopVideo);
$('video').addEventListener('loadedmetadata',()=>{const v=$('video');
 if(state.playTime>0&&Number.isFinite(v.duration))v.currentTime=Math.min(state.playTime,Math.max(0,v.duration-.1));
 $('videoStatus').textContent='Original recording ready · '+(Number.isFinite(v.duration)?v.duration.toFixed(1)+' s':'duration unavailable');
});
$('video').addEventListener('error',()=>{$('videoStatus').textContent='Playback error. Original recording has not been altered.'});
$('closeCompare').addEventListener('click',()=>$('compareDialog').close());
$('closeSnapshot').addEventListener('click',closeFaceSnapshot);
$('snapshotPrev').addEventListener('click',()=>advanceFaceSnapshot(-1));
$('snapshotNext').addEventListener('click',()=>advanceFaceSnapshot(1));
$('snapshotViewer').addEventListener('close',()=>{
 ++state.snapshotRequest;
 $('snapshotImage').removeAttribute('src');
 state.snapshotSelected=null;
});
$('snapshotImage').addEventListener('load',()=>{
 if($('snapshotViewer').open)$('snapshotStatus').textContent='Source image loaded';
});
$('snapshotImage').addEventListener('error',()=>{
 if($('snapshotViewer').open)$('snapshotStatus').textContent='Saved crop could not be displayed. Try the original video.';
});
$('snapshotPlay').addEventListener('click',()=>{
 const f=state.snapshotSelected;
 if(!f||!clipName.test(String(f.clip||'')))return;
 closeFaceSnapshot();
 const time=Number(String(f.clip).slice(7,20));
 playVideo('/new/saved/clip/'+encodeURIComponent(f.clip),
  'Original 4K recording · '+stampMs(time),num(f.face.time_ms)/1000);
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&$('viewer').open)$('viewer').close()});
window.addEventListener('pagehide',stopVideo);
document.querySelectorAll('[data-go]').forEach(button=>button.addEventListener('click',()=>{
 const pane=button.dataset.go;
 if(pane==='review')openReview('all');
 else if(pane==='people'||pane==='clothing')openHome(pane);
}));
selectPane('people');loadView();fetchFaces();
})();
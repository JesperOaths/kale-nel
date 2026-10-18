(()=>{
'use strict';
/* People & Faces V45: task-first independent UI, authenticated existing v40 API.
   No recording is changed or assigned automatically. */
const $=id=>document.getElementById(id);
const elt=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(cls)e.className=cls;return e};
const state={pane:'people',folder:'',tab:'inbox',offset:0,limit:24,doc:null,
 busy:false,loading:false,serial:0,faceList:[],faceLoaded:false,facePage:0,
 approvalItem:null,editMode:'create',playSerial:0,playTime:0,compareItem:null,
 faceSummary:null,clipEvidence:new Map(),faceFetchToken:0,snapshotRequest:0,snapshotSelected:null};
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
function mediaForFace(f){
 const host=elt('div','', 'media');
 const img=elt('img');img.loading='lazy';img.decoding='async';img.alt='Captured face for manual review';
 host.append(img);
 Promise.resolve().then(()=>relay().url('/new/saved/face/'+encodeURIComponent(f.face.snapshot_name)))
 .then(url=>{if(img.isConnected)img.src=url}).catch(()=>{img.remove();host.append(elt('span','Image unavailable'))});
 img.addEventListener('error',()=>{img.remove();host.append(elt('span','Image unavailable'))},{once:true});
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
  if(state.offset>=num(next.total)&&num(next.total)>0){
   state.offset=Math.max(0,Math.floor((next.total-1)/state.limit)*state.limit);
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
    if(!face||!faceName.test(String(face.snapshot_name||'')))continue;
    if(!String(face.snapshot_name).startsWith(rec.clip_no.slice(0,-4)+'__'))continue;
    found.push({clip:rec.clip_no,face,recording:rec});
   }
  }
  state.clipEvidence=byClip;
  state.faceList=found.sort((a,b)=>String(b.clip).localeCompare(String(a.clip)));
  state.faceSummary={reviewed:v5Reviewed,total:data.events.length,
   snapshots:found.length,withoutSnapshot:Math.max(0,candidateRecords-found.length)};
  state.faceLoaded=true;
  $('faceCount').textContent=String(found.length);
  renderMetrics();
  if(state.doc)render();
 }catch(e){
  if(requestToken!==state.faceFetchToken)return;
  state.faceSummary=null;
  state.clipEvidence=new Map();
  $('faceCount').textContent='—';
  $('faceScanLabel').textContent='Unavailable';
  $('facePhotoStatus').textContent='Face snapshot metadata is currently unavailable. Try Refresh.';
  if(state.pane==='faces')$('faceGrid').replaceChildren(elt('p','Face images could not be loaded right now.','empty'));
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
 state.pane='review';state.folder='';state.tab=mode||'inbox';state.offset=0;
 $('reviewMode').value=state.tab;
 selectPane('review');loadView();
}
function openFolder(id,tab){
 const f=state.doc?.folders.find(f=>f.id===id);if(!f)return;
 state.pane='folder';state.folder=id;state.tab=tab|| (num(f.approved_clips)?'approved':'suggestions');
 state.offset=0;state.facePage=0;$('folderMode').value=state.tab;
 selectPane('folder');loadView();
}
function openHome(pane){
 state.pane=pane;state.folder='';state.tab='inbox';state.offset=0;
 selectPane(pane);loadView();if(pane==='faces')fetchFaces();
}
function selectPane(pane){
 for(const name of ['overview','review','people','faces','folderView'])
  $(name).hidden=(name!==(pane==='folder'?'folderView':pane));
 for(const b of document.querySelectorAll('[data-pane]')){
  const expected=pane==='folder'?'people':pane;
  b.setAttribute('aria-selected',String(b.dataset.pane===expected));
 }
}
function openApproval(item){
 state.approvalItem=item;
 $('approvalPreview').replaceChildren(imageFor(item.full_crop,'Clip to review'));
 const select=$('approvalFolder');select.replaceChildren();
 select.add(new Option('Create a new folder',''));
 for(const f of (state.doc?.folders||[]))if(isSaved(f)||f.id===state.folder)
  select.add(new Option(f.automatic_appearance_group?'Manually keep in '+f.label:f.label,f.id));
 $('approvalLabel').value='';
 if(state.folder)select.value=state.folder;
 $('newLabel').hidden=!!select.value;
 $('approvalConfirmed').checked=false;
 $('approvalDialog').showModal();
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
 const faces=state.faceList.filter(f=>f.clip===clip).slice(0,8);
 const tracks=record&&Array.isArray(record.anonymous_tracks)?
  record.anonymous_tracks.slice(0,8):[];
 if(!record){
  details.append(elt('span',state.faceLoaded?
   'Additional face and movement metadata unavailable for this clip':
   'Loading independent face and movement observations…'));
 }else{
  details.append(elt('span',faces.length+' saved face '+(faces.length===1?'image':'images')+
   ' · '+tracks.length+' temporary within-clip '+(tracks.length===1?'track':'tracks')));
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
   buttons.append(control('Inspect face '+(i+1),()=>inspectFaceSnapshot(face),'secondary'));
  root.append(buttons);
 }
 return root;
}
function reviewItem(item,compact){
 const root=elt('article','',compact?'review-row':'evidence');
 const media=imageFor(item.full_crop,'Cropped evidence from original recording');
 const info=elt('div','',compact?'row-info':'body');
 badge(media, item.person_recheck_required?'RECHECK':item.decision==='approved'?'APPROVED':item.temporal_support?'PERSON CLUE':'WEAK EVIDENCE');
 const main=elt('strong',date(item));
 info.append(main);
 if(item.person_recheck_required)info.append(elt('p','Previously kept, but current person detection needs checking.'));
 else if(!item.temporal_support)info.append(elt('p','Limited observations · inspect the original video.'));
 else info.append(elt('p','Original 4K · '+(item.entry_zone||'front garden').replaceAll('_',' ')+' · visual evidence'));
 const tools=elt('div','','actions');
 tools.append(control('▶ Play',()=>startVideo(item)));
 if(item.decision==='approved'){
  tools.append(control('Saved ✓',()=>{},'secondary'));tools.lastChild.disabled=true;
 }else if(['rejected','skipped'].includes(item.decision)){
  tools.append(control('Restore',()=>restore(item),'secondary'));
 }else{
  tools.append(control(state.folder?'✓ Keep here':'✓ Keep',()=>openApproval(item),'primary'),
   control('✕ Skip',()=>dismiss(item),'danger'));
 }
 if(state.folder&&state.doc?.reference_examples?.length&&item.decision!=='approved')
  tools.append(control('Compare',()=>compare(item)));
 info.append(tools);
 if(!compact)info.append(step3ClipEvidence(item));
 if(compact)root.append(media,info);
 else root.append(media,info);
 return root;
}
function profileRow(f){
 const b=control('',()=>openFolder(f.id),'profile');b.replaceChildren();
 const avatar=elt('div','', 'avatar');
 if(Array.isArray(f.previews)&&f.previews.length){
  const im=imageFor(f.previews[0],'Saved folder preview');
  const img=im.querySelector('img');
  if(img)avatar.append(img);else avatar.append(elt('span',String(f.label||'?')[0]||'?'));
 }else avatar.append(elt('span',(String(f.label||'?')[0]||'?').toUpperCase()));
 const info=elt('div');info.append(elt('strong',f.label),
  elt('small',num(f.approved_clips)+' reviewed '+(num(f.approved_clips)===1?'recording':'recordings')+
    (num(f.approvals_needing_person_recheck)?' · '+num(f.approvals_needing_person_recheck)+' need recheck':'')));
 b.append(avatar,info,elt('span','Open recordings →','arrow'));
 return b;
}
function groupRows(host){
 host.replaceChildren();
 const groups=tentativeFolders();
 if(!groups.length){host.append(elt('p','No provisional groups available.','status'));return}
 for(const f of groups){
  const b=control('',()=>openFolder(f.id,'suggestions'));
  b.replaceChildren(elt('span',f.label),elt('small',num(f.suggested_clips)+' to review · not an identity'));
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
 $('appearanceCount').textContent=String(tentativeFolders().length);
 $('groupCount').textContent=String(tentativeFolders().length);
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
  $('facePhotoStatus').textContent=fs.snapshots+' saved face images available · '+
   fs.withoutSnapshot+' candidate records have no saved image. Images are for manual review, not identity matches.';
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
 groupRows($('appearancePreview'));
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
 $('reviewTotal').textContent=num(state.doc?.total)+' matching recordings';
 const host=$('reviewGrid');host.replaceChildren();
 for(const item of state.doc?.items||[])host.append(reviewItem(item,false));
 if(!host.children.length)host.append(elt('p','No recordings match this view.','empty'));
 paginate($('reviewPage'),num(state.doc?.total),n=>{state.offset=n;loadView()});
}
function renderPeople(){
 const saved=$('savedList');saved.replaceChildren();
 for(const f of savedFolders())saved.append(profileRow(f));
 if(!saved.children.length)saved.append(elt('p','No reviewed folders. Create a folder or keep a recording to get started.','empty'));
 groupRows($('candidateList'));
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
 for(const item of state.doc?.items||[])host.append(reviewItem(item,false));
 if(!host.children.length)host.append(elt('p',suggestions?'No appearance suggestions with these filters.':'No recordings in this view.','empty'));
 // Only show images linked to manually approved recordings in this folder.
 // A linked recording can still contain a different person: never label a crop as an identified face.
 const facePanel=$('folderFaces'),faceGrid=$('folderFaceGrid');faceGrid.replaceChildren();
 const clips=new Set((state.doc?.items||[]).filter(x=>x.decision==='approved').map(x=>String(x.clip||'')));
 const faceMatches=state.faceList.filter(x=>clips.has(x.clip)).slice(0,16);
 facePanel.hidden=state.tab!=='approved'||faceMatches.length===0;
 if(!facePanel.hidden)for(const face of faceMatches){
  const button=control('',()=>inspectFaceSnapshot(face),'folder-face');
  button.replaceChildren(mediaForFace(face),elt('small',stampMs(Number(face.clip.slice(7,20)))+' · Inspect image'));
  faceGrid.append(button);
 }
 paginate($('folderPage'),num(state.doc?.total),n=>{state.offset=n;loadView()});
 const ref=$('references'),list=$('referenceList');list.replaceChildren();
 const references=state.doc?.reference_examples||[];
 ref.hidden=!(suggestions&&references.length);
 if(!ref.hidden)for(const item of references.slice(0,8)){
  const b=control('',()=>startVideo(item));
  b.replaceChildren(imageFor(item.full_crop,'Reviewed reference'),elt('small',date(item)));
  list.append(b);
 }
}
function facesInRecording(clip){
 return state.faceList.filter(f=>f.clip===clip).sort((a,b)=>
   num(a.face.time_ms)-num(b.face.time_ms)||
   String(a.face.snapshot_name).localeCompare(String(b.face.snapshot_name)));
}
function representativeFace(list){
 // Prefer non-padded saved crops, then a larger saved crop for a usable preview.
 const sorted=[...list].sort((a,b)=>
  Number(a.face.face_crop_padded_context_only===true)-
   Number(b.face.face_crop_padded_context_only===true)||
  num(b.face.snapshot_size)-num(a.face.snapshot_size));
 return sorted[0];
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
 $('snapshotTitle').textContent='Face image · '+stampMs(t);
 $('snapshotDescription').textContent='Saved from original 4K · '+(num(f.face.time_ms)/1000).toFixed(1)+
  ' s into recording · manual inspection only · identity not established';
 $('snapshotStatus').textContent='Loading saved crop securely…';
 $('snapshotImage').removeAttribute('src');
 $('snapshotPlay').disabled=false;
 const dialog=$('snapshotViewer');if(!dialog.open)dialog.showModal();
 Promise.resolve().then(()=>relay().url('/new/saved/face/'+encodeURIComponent(f.face.snapshot_name)))
 .then(url=>{if(ticket===state.snapshotRequest&&dialog.open)$('snapshotImage').src=url})
 .catch(()=>{if(ticket===state.snapshotRequest)$('snapshotStatus').textContent='Image unavailable. The original recording remains accessible.'});
}
function closeFaceSnapshot(){
 ++state.snapshotRequest;
 $('snapshotViewer').close();
 $('snapshotImage').removeAttribute('src');
 state.snapshotSelected=null;
}
function renderFaces(){
 const mode=$('faceMode').value;
 const needle=String($('faceSearch').value||'').trim().toLowerCase().slice(0,120);
 const images=state.faceList.filter(f=>{
  const suggested=['anonymous_similarity_unverified','reference_similarity_unverified'].includes(
    String(f.face.match_status||''))&&
    f.face.face_crop_requires_manual_review!==true&&
    f.face.face_crop_padded_context_only!==true;
  if(mode==='suggested'&&!suggested)return false;
  if(mode==='manual'&&suggested)return false;
  if(needle){
   const clipDate=stampMs(Number(f.clip.slice(7,20))).toLowerCase();
   if(!f.clip.toLowerCase().includes(needle)&&!clipDate.includes(needle))return false;
  }
  return true;
 });
 const grouping=$('faceGrouping').value==='images'?'images':'recording';
 const groups=new Map();
 for(const f of images){
  if(!groups.has(f.clip))groups.set(f.clip,[]);
  groups.get(f.clip).push(f);
 }
 const grouped=[...groups.entries()].map(([clip,faces])=>
  ({clip,faces,preview:representativeFace(faces)}));
 const entries=grouping==='recording'?grouped:images.map(f=>
  ({clip:f.clip,faces:[f],preview:f}));
 $('faceTotal').textContent=images.length+' images across '+groups.size+' original recordings';
 $('faceGroupingNote').textContent=grouping==='recording'?
  'One card per original recording. Multiple crops can show different people; grouping does not identify anyone.':
  'One card per saved face crop. These images are not automatic same-person matches.';
 const host=$('faceGrid');host.replaceChildren();
 const start=state.facePage*24;
 const visible=entries.slice(start,start+24);
 for(const row of visible){
  const f=row.preview;
  const card=elt('article','','evidence'),media=mediaForFace(f);
  badge(media,grouping==='recording'?row.faces.length+' FACE IMAGES':'FACE IMAGE');
  const box=elt('div','','body');
  const timestamp=Number(String(row.clip).slice(7,20));
  box.append(elt('strong',stampMs(timestamp)),
    elt('p',row.faces.length+' saved '+(row.faces.length===1?'image':'images')+
    ' · original 4K · no identity grouping'));
  const tools=elt('div','','actions');
  tools.append(control(grouping==='recording'?'Inspect images':'Inspect image',
    ()=>inspectFaceSnapshot(f),'secondary'));
  tools.append(control('▶ Play recording',()=>playVideo('/new/saved/clip/'+encodeURIComponent(row.clip),
   'Original 4K recording · '+stampMs(timestamp),num(f.face.time_ms)/1000)));
  box.append(tools);card.append(media,box);host.append(card);
 }
 if(!entries.length)host.append(elt('p',state.faceLoaded?
   'No face images match these filters. Try All captured images or clear the recording search.':
   'Loading face-image evidence…','empty'));
 const bar=$('facePage');bar.replaceChildren();
 if(entries.length>24){
  const prev=control('← Previous',()=>{state.facePage=Math.max(0,state.facePage-1);renderFaces()});
  prev.disabled=state.facePage===0;
  const next=control('Next →',()=>{state.facePage++;renderFaces()});
  next.disabled=start+24>=entries.length;
  bar.append(prev,elt('span',Math.min(start+1,entries.length)+'–'+
    Math.min(start+24,entries.length)+' / '+entries.length+
    ' '+(grouping==='recording'?'recordings':'images')),next);
 }
}
function render(){
 if(!state.doc)return;
 renderMetrics();
 if(state.pane==='overview')renderOverview();
 if(state.pane==='review')renderReview();
 if(state.pane==='people')renderPeople();
 if(state.pane==='folder')renderFolder();
 if(state.pane==='faces')renderFaces();
}
function compare(item){
 const examples=state.doc?.reference_examples||[];
 if(!examples.length)return;
 const ref=examples[0],host=$('compareGrid');host.replaceChildren();
 for(const [name,entry] of [['Already approved (reference)',ref],['Proposed appearance (unverified)',item]]){
  const col=elt('div');col.append(elt('h3',name),imageFor(entry.full_crop,name),
   elt('p',date(entry),'status'),control('▶ Play original',()=>startVideo(entry)));
  host.append(col);
 }
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
 const p=b.dataset.pane;if(p==='review')openReview('inbox');else openHome(p);
});
$('openReview').addEventListener('click',()=>openReview('inbox'));
$('peopleReviewNow').addEventListener('click',()=>openReview('inbox'));
$('openPeople').addEventListener('click',()=>openHome('people'));
$('backFolders').addEventListener('click',()=>openHome('people'));
$('reviewMode').addEventListener('change',()=>{state.tab=$('reviewMode').value;state.offset=0;loadView()});
$('folderMode').addEventListener('change',()=>{state.tab=$('folderMode').value;state.offset=0;loadView()});
for(const id of ['distance','weak','route'])$(id).addEventListener('change',()=>{if(state.tab==='suggestions'){state.offset=0;loadView()}});
$('faceMode').addEventListener('change',()=>{state.facePage=0;renderFaces()});
$('faceGrouping').addEventListener('change',()=>{state.facePage=0;renderFaces()});
$('faceSearch').addEventListener('input',()=>{state.facePage=0;renderFaces()});
$('refresh').addEventListener('click',()=>{
 state.faceLoaded=false;
 state.faceSummary=null;
 state.clipEvidence=new Map();
 loadView();
 fetchFaces();
});
$('newFolder').addEventListener('click',()=>openFolderEditor('create'));
$('newFolderInline').addEventListener('click',()=>openFolderEditor('create'));
$('editFolder').addEventListener('click',()=>openFolderEditor('edit'));
$('cancelFolder').addEventListener('click',()=>$('folderDialog').close());
$('cancelApproval').addEventListener('click',()=>$('approvalDialog').close());
$('approvalFolder').addEventListener('change',()=>{$('newLabel').hidden=!!$('approvalFolder').value});
$('approvalForm').addEventListener('submit',async e=>{
 e.preventDefault();const item=state.approvalItem;if(!item)return;
 const id=$('approvalFolder').value;
 const label=$('approvalLabel').value.trim();
 if(!$('approvalConfirmed').checked){alertText('Confirm that you reviewed the original recording before keeping it.');return}
 if(!id&&(!label||label.length>100)){alertText('Enter a name for the new folder.');return}
 const ok=await action(id?{action:'approve_clip',folder:id,...fields(item)}:
  {action:'seed_folder',folder:'',label,...fields(item)},result=>{
   notification('Recording kept in the chosen folder.');
   if(!id&&result.folder){
    state.folder=result.folder;state.pane='folder';state.tab='approved';state.offset=0;
    $('folderMode').value='approved';selectPane('folder');
   }
 });
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
 if($('snapshotViewer').open)$('snapshotStatus').textContent='Original saved face crop · inspection only';
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
 if(pane==='review')openReview('inbox');
 else if(pane==='people'||pane==='faces')openHome(pane);
}));
selectPane('people');loadView();fetchFaces();
})();
/* C720P Security Archive thumbnail actions v1.
 * The existing Archive viewer remains responsible for video playback.
 * Only explicit user actions may mutate individual indexed recordings.
 */
(()=>{
'use strict';
if(window.__c720pArchiveActionsV1)return;
window.__c720pArchiveActionsV1=true;
const VERSION='ARCHIVE_ACTIONS_V1_20261012';
const NAME=/^(?:(?:motion|native4k)_[0-9]{13}|rec_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2})[.]mp4$/;
const DRIVE=/^[A-Za-z0-9._-]{1,180}[.]mp4$/;
const KEY='c720p-archive-pinned-v1';
const $=(id)=>document.getElementById(id);
const relay=()=>{
 if(window.C720PSecureRelay?.fetch&&window.C720PSecureRelay?.url)return window.C720PSecureRelay;
 try{if(window.parent!==window&&window.parent.location.origin===location.origin)
  return window.parent.C720PSecureRelay||null;}catch(_){}
 return null;
};
const css=document.createElement('style');css.textContent=`
.archive-action-card{min-width:0;display:flex;flex-direction:column;gap:7px;position:relative}
.archive-action-card>.clip{width:100%;display:block}
.archive-action-card.is-pinned>.clip .picture{border:2px solid #e6bf6a;box-shadow:0 0 0 1px #977b43}
.archive-action-card .archive-badge{position:absolute;top:8px;right:8px;z-index:2;background:#483c21;color:#fce0a7;border-radius:7px;font-size:11px;padding:2px 7px;font-weight:800;pointer-events:none}
.archive-action-toolbar{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px;min-width:0}
.archive-action-toolbar button{min-height:34px;padding:6px 2px;border:1px solid #3c5362;background:#203440;color:#dce9ef;border-radius:8px;font-size:15px;cursor:pointer}
.archive-action-toolbar button:hover{background:#355565;border-color:#85c7c0}
.archive-action-toolbar button:focus-visible{outline:2px solid #7de4d0;outline-offset:2px}
.archive-action-toolbar button.danger{border-color:#744a4c;color:#ffb5b5;background:#32252b}
.archive-action-toolbar button.danger:hover{background:#652e35}
.archive-action-toolbar button:disabled{opacity:.55;cursor:wait}
.archive-action-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483000;max-width:min(90vw,570px);padding:10px 16px;background:#1e3a45;color:#f5ffff;border:1px solid #73b6b7;border-radius:10px;box-shadow:0 5px 30px #0008;font-size:13px}
.archive-action-info{border:1px solid #547481;background:#10222e;color:#eaf6fc;border-radius:13px;width:min(520px,92vw);padding:24px}
.archive-action-info::backdrop{background:#02060bc9}
.archive-action-info h2{margin:0 0 13px;font-size:18px}
.archive-action-info dl{display:grid;grid-template-columns:minmax(105px,36%) 1fr;gap:8px 12px;font-size:13px;overflow-wrap:anywhere}
.archive-action-info dt{color:#9fbbc9}.archive-action-info dd{margin:0}
.archive-action-info button{margin-top:15px;background:#244b52;border:1px solid #5eaca8;border-radius:7px;color:#e5fff9;padding:8px 15px}
`;document.head.append(css);
let pinned=new Set();
try{const data=JSON.parse(localStorage.getItem(KEY)||'[]');if(Array.isArray(data))pinned=new Set(data.filter(x=>typeof x==='string').slice(0,2500));}catch(_){}
function toast(message){
 let element=$('archiveActionsToast');
 if(!element){element=document.createElement('div');element.id='archiveActionsToast';element.className='archive-action-toast';element.setAttribute('role','status');document.body.append(element)}
 element.textContent=message;
 clearTimeout(toast.timeout);
 toast.timeout=setTimeout(()=>{if(element.isConnected)element.remove()},4500);
}
const entryKey=(source,name)=>source+':'+name;
function pin(card,button,source,name){
 const k=entryKey(source,name);
 if(pinned.has(k))pinned.delete(k);else pinned.add(k);
 try{localStorage.setItem(KEY,JSON.stringify([...pinned].slice(-2500)))}catch(_){}
 mark(card,button,source,name);
 toast(pinned.has(k)?'Recording pinned in this browser':'Recording unpinned');
}
function mark(card,button,source,name){
 const active=pinned.has(entryKey(source,name));
 card.classList.toggle('is-pinned',active);
 button.textContent=active?'★':'☆';
 button.title=active?'Unpin recording (on this device)':'Pin recording (on this device)';
 button.setAttribute('aria-label',button.title);
 let tag=card.querySelector('.archive-badge');
 if(active&&!tag){tag=document.createElement('span');tag.className='archive-badge';tag.textContent='★ Pinned';card.append(tag)}
 if(!active&&tag)tag.remove();
}
async function copy(name){
 try{
  if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(name);
  else{
   const input=document.createElement('textarea');input.value=name;input.style.cssText='position:fixed;opacity:0';document.body.append(input);input.select();
   if(!document.execCommand('copy'))throw Error('Copy unsupported');input.remove();
  }
  toast('Recording filename copied');
 }catch(_){toast('Cannot access clipboard. Filename: '+name)}
}
function details(source,name,info){
 const dialog=document.createElement('dialog');dialog.className='archive-action-info';
 const heading=document.createElement('h2');heading.textContent='Recording details';dialog.append(heading);
 const dl=document.createElement('dl');dialog.append(dl);
 function add(label,value){
  if(value===null||value===undefined||value==='')return;
  const dt=document.createElement('dt'),dd=document.createElement('dd');
  dt.textContent=label;dd.textContent=String(value);dl.append(dt,dd);
 }
 add('Source',source==='drive'?'Historical Google Drive':'S9+ microSD');
 add('Filename',name);
 add('Date',info.timestamp||info.date);
 if(Number.isFinite(Number(info.size))&&Number(info.size)>0)add('File size',(Number(info.size)/(1024*1024)).toFixed(1)+' MB');
 if(info.scene_category||info.person_status)add('Classification',info.scene_category||info.person_status);
 if(info.person_count!==null&&info.person_count!==undefined&&Number.isFinite(Number(info.person_count)))add('Detected people',info.person_count);
 if(info.person_score!==null&&info.person_score!==undefined&&Number.isFinite(Number(info.person_score)))add('Person detector score',(100*Number(info.person_score)).toFixed(1)+'%');
 if(Number(info.face_snapshots_saved)>0)add('Face snapshots',info.face_snapshots_saved);
 if(info.review_backend)add('Reviewed using',info.review_backend);
 const copyButton=document.createElement('button');copyButton.type='button';copyButton.textContent='Copy filename';copyButton.style.marginRight='10px';copyButton.onclick=()=>copy(name);dialog.append(copyButton);
 const close=document.createElement('button');close.type='button';close.textContent='Close';close.onclick=()=>dialog.close();dialog.append(close);
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});
 document.body.append(dialog);dialog.showModal();
}
async function saveOriginal(source,name){
 const a=relay();if(!a?.url)throw Error('Private media connection unavailable');
 const path=source==='drive'?'/new/drive/saved/clip/':'/new/saved/clip/';
 const url=await a.url(path+encodeURIComponent(name));
 // Cross-origin download attributes can be ignored by Chromium. A signed
 // original-file page still allows browser Save As without loading 4K into RAM.
 const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';
 link.download=name;document.body.append(link);link.click();link.remove();
 toast('Original recording opened. Use Save As if it does not download automatically.');
}
async function deleteRecording(source,name,info,card,button){
 if(source==='sd'&&!NAME.test(name))return toast('Invalid S9+ recording name');
 if(source==='drive'&&!DRIVE.test(name))return toast('Invalid Drive recording name');
 const a=relay();if(!a?.fetch)return toast('Private Security connection unavailable');
 const size=Number(info.size);
 if(source==='sd'&&(!Number.isSafeInteger(size)||size<=10000))
  return toast('Cannot safely delete: recording file size is unverified');
 const warning=source==='drive'?
  'Permanently delete this historical Google Drive recording AND its associated snapshot?':
  'Permanently delete this original recording from the S9+ microSD card? This frees space and cannot be undone.';
 if(!window.confirm(warning+'\n\n'+name+'\n\nThis action cannot be undone.'))return;
 button.disabled=true;
 try{
  const path=source==='drive'?'/new/api/saved/delete':'/new/api/sd/delete';
  const body=source==='drive'?{remote_name:name}:{clip_no:name,expected_bytes:size,confirm:'DELETE '+name};
  const headers={'Content-Type':'application/json'};
  headers['X-S9-Archive-Delete-Intent']='explicit-user-delete-v1';
  const r=await a.fetch(path,{method:'POST',headers,body:JSON.stringify(body),cache:'no-store'});
  const data=await r.json().catch(()=>({}));
  if(!r.ok||data.ok!==true||!(data.deleted===true||Array.isArray(data.deleted)))
   throw Error(data.error||'HTTP '+r.status);
  const key=entryKey(source,name);pinned.delete(key);
  try{localStorage.setItem(KEY,JSON.stringify([...pinned]))}catch(_){}
  card.remove();
  toast('Recording deleted from '+(source==='drive'?'Google Drive':'S9+ microSD')+'. Refreshing archive…');
  const refresh=$(source==='drive'?'driveRefresh':'refresh');if(refresh)refresh.click();
 }catch(error){toast('Delete failed; recording retained: '+String(error.message||error))}
 finally{button.disabled=false;}
}
function makeButton(glyph,title,callback,danger=false){
 const button=document.createElement('button');button.type='button';
 button.textContent=glyph;button.title=title;button.setAttribute('aria-label',title);
 if(danger)button.className='danger';
 button.addEventListener('click',async event=>{
  event.preventDefault();event.stopPropagation();
  if(button.disabled)return;
  try{await callback(button)}catch(error){toast('Action unavailable: '+String(error.message||error))}
 });
 return button;
}
function enhance(){
 for(const button of document.querySelectorAll('#driveLibrary .clips>.clip[data-archive-name],#localLibrary .clips>.clip[data-archive-name]')){
  if(button.dataset.archiveActionsV1==='1')continue;
  const source=button.dataset.archiveSource;
  const name=button.dataset.archiveName;
  if(source!=='drive'&&source!=='sd')continue;
  if(!(source==='sd'?NAME:DRIVE).test(name))continue;
  button.dataset.archiveActionsV1='1';
  let info={};try{info=JSON.parse(button.dataset.archiveInfo||'{}')}catch(_){}
  const parent=button.parentNode;
  const card=document.createElement('div');card.className='archive-action-card';
  parent.insertBefore(card,button);card.append(button);
  const toolbar=document.createElement('div');toolbar.className='archive-action-toolbar';
  toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','Actions for '+name);
  toolbar.append(makeButton('▶','Play recording',()=>button.click()));
  toolbar.append(makeButton('↗','Open or save original',()=>saveOriginal(source,name)));
  const pinBtn=makeButton('☆','Pin recording',()=>pin(card,pinBtn,source,name));toolbar.append(pinBtn);mark(card,pinBtn,source,name);
  toolbar.append(makeButton('ⓘ','Show clip information',()=>details(source,name,info)));
  toolbar.append(makeButton('🗑','Permanently delete recording',b=>deleteRecording(source,name,info,card,b),true));
  card.append(toolbar);
 }
}
let pending=false;
const observer=new MutationObserver(()=>{if(pending)return;pending=true;queueMicrotask(()=>{pending=false;enhance()})});
observer.observe(document.documentElement,{childList:true,subtree:true});
enhance();
})();

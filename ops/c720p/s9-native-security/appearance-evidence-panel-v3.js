(() => {
 'use strict';
 const API='/new/api/appearance-review-v2';
 const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e};
 const session=Array.from(crypto.getRandomValues(new Uint8Array(24)),x=>x.toString(16).padStart(2,'0')).join('');
 function relay(){let w=window;for(let i=0;i<5;i++){try{if(w.C720PSecureRelay?.fetch)return w.C720PSecureRelay;if(w===w.parent)break;w=w.parent}catch(_){break}}throw Error('Open this page inside the Security Hub.')}
 async function fetchJSON(path,body){
  const headers=new Headers({'X-S9-Review-Session':session});let options={headers,cache:'no-store'};
  if(body!==undefined){headers.set('Content-Type','application/json');headers.set('X-S9-Appearance-Intent','manual-appearance-review-v2');options={...options,method:'POST',body:JSON.stringify(body)}}
  const r=await relay().fetch(API+path,options),d=await r.json();
  if(!r.ok||d.ok===false){const labels={review_snapshot_changed:'The review list changed. Refresh and inspect the evidence again.',recording_already_reviewed:'This recording was already reviewed. Refresh the list.',preview_not_opened:'Inspect the evidence image before making a decision.',source_revision_changed:'The recording or cached evidence changed. Refresh before reviewing.'};throw Error(labels[d.error]||'Verified evidence is temporarily unavailable.')}
  return d;
 }
 const controllers=[];let previews=new Map();
 window.AppearanceEvidenceV2={folderPreview:id=>previews.get(String(id))||null};
 async function covers(){
  try{const d=await fetchJSON('/status');previews=new Map(Object.entries(d.folder_previews||{}));window.dispatchEvent(new CustomEvent('appearance-reviewed-covers-updated'));return d}catch(_){return null}
 }
 const dialog=node('dialog');dialog.className='dialog';dialog.id='appearanceEvidenceViewer';
 const title=node('h2'),close=node('button','Close'),image=node('img'),caption=node('p');
 close.type='button';image.style.cssText='display:block;max-width:100%;max-height:65vh;object-fit:contain;margin:auto';
 close.addEventListener('click',()=>dialog.close());dialog.append(title,close,image,caption);document.body.append(dialog);
 async function inspect(row,pipeline,revision){
  const prepared=await fetchJSON('/open',{key:row.key,pipeline,revision});
  title.textContent=pipeline==='clothing'?'Cached garment evidence':'Cached objects and scene evidence';
  caption.textContent='Evidence from this indexed recording. The original video has not been opened. This comparison does not establish identity.';
  image.alt=pipeline==='clothing'?'Face-excluding garment crop':'Coarse scene with people masked or pixelated';
  if(!dialog.open)dialog.showModal();
  const url=await relay().url(prepared.preview_url);
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>done(Error('Evidence image did not load.')),20000);
   const loaded=()=>done();const failed=()=>done(Error('Verified evidence image is unavailable.'));const cancelled=()=>done(Error('Inspection closed.'));
   function done(error){clearTimeout(timer);image.removeEventListener('load',loaded);image.removeEventListener('error',failed);dialog.removeEventListener('close',cancelled);error?reject(error):resolve()}
   image.addEventListener('load',loaded,{once:true});image.addEventListener('error',failed,{once:true});dialog.addEventListener('close',cancelled,{once:true});image.src=url;
  });
  const proof=await fetchJSON('/attest',{challenge:prepared.challenge});
  caption.textContent='Cached evidence verified. Inspect it, then close this viewer to confirm a folder or deny the suggestion. No original playback or identity claim is implied.';
  return proof.opened_ticket;
 }
 function preview(row,pipeline){
  const img=node('img');img.alt=pipeline==='clothing'?'Garment evidence':'Masked scene evidence';img.loading='lazy';
  img.style.cssText='width:224px;max-width:100%;height:150px;object-fit:contain;background:#17232c;border-radius:8px';
  const digest=pipeline==='clothing'?row.preview_sha256:row.scene_preview_sha256;
  relay().url(API+'/preview/'+pipeline+'/'+digest).then(url=>{img.src=url}).catch(()=>img.remove());img.addEventListener('error',()=>img.remove(),{once:true});return img;
 }
 async function refreshAll(){await covers();await Promise.all(controllers.filter(c=>c.active()).map(c=>c.load()))}
 function mount(parent,automatic=false){
  const section=node('section');section.className='appearance-evidence-panel';section.setAttribute('aria-label','Clothing and context review');
  section.append(node('h3','Appearance evidence · manual review'));
  section.append(node('p','Two separate comparisons: clothing, and objects with scene context. Neither identifies a person. Every folder decision remains yours.'));
  const nav=node('nav');nav.className='tabs';nav.setAttribute('aria-label','Evidence pipeline');
  const clothing=node('button','Clothing'),context=node('button','Objects & scene'),refresh=node('button','Refresh');
  for(const b of [clothing,context,refresh])b.type='button';nav.append(clothing,context,refresh);
  const status=node('p');status.setAttribute('role','status');const host=node('div');host.className='appearance-evidence-cards';
  section.append(nav,status,host);parent.append(section);
  let pipeline='clothing',busy=false,serial=0,inspectionPending=false;const choices=new Map();
  const canAutoRefresh=()=>!busy&&!inspectionPending&&!dialog.open;
  const active=()=>!parent.hidden&&(!automatic?parent.classList.contains('appearance-evidence-active'):true);
  async function load(){
   inspectionPending=false;
   const ticket=++serial;refresh.disabled=true;clothing.setAttribute('aria-selected',String(pipeline==='clothing'));context.setAttribute('aria-selected',String(pipeline==='context'));
   host.replaceChildren(node('p','Loading verified evidence…'));
   try{
    const d=await fetchJSON('/'+pipeline);if(ticket!==serial)return;
    const progress=d.backfill||{};
    status.textContent=d.items.length+' pending recordings · '+d.assigned_indexed+'/'+d.assigned_recordings+' assigned recordings indexed · '+(progress.pending||0)+' queued · '+(progress.unavailable||0)+' currently unavailable';
    host.replaceChildren();
    if(!d.items.length)host.append(node('p','No indexed unreviewed evidence is available yet. Backfill continues in the background.'));
    for(const row of d.items.slice(0,120)){
     const card=node('article');card.className='appearance-evidence-card';card.dataset.key=row.key;
     card.append(preview(row,pipeline),node('strong',row.clip_id));
     const label=d.folder_options.find(f=>f.id===row.folder_id)?.label;
     card.append(node('p',row.score!==null?'Similar '+(pipeline==='clothing'?'garment appearance':'object/scene evidence')+' in a recording filed under '+label+' · score '+row.score.toFixed(3):'No supported reference comparison. Choose a folder only after inspecting the evidence.'));
     card.append(node('p',pipeline==='context'?(row.objects.length?'Detected objects: '+row.objects.join(', '):'No reliable supporting object detections. Background alone is not a matching cue.'):'Only the interior torso garment region is compared; head, gait and body proportions are excluded.'));
     const select=node('select');select.setAttribute('aria-label','Folder for this recording');select.append(new Option('Choose a folder…',''));
     for(const f of d.folder_options)select.append(new Option(f.label,f.id));select.append(new Option('+ Add person / folder…','__new__'));
     select.value=choices.get(row.key)||row.folder_id||'';
     const actions=node('div');actions.className='actions';const open=node('button','Inspect evidence'),approve=node('button','Confirm selected folder'),reject=node('button','Deny for selected folder'),note=node('p','Inspect the cached evidence before making a decision.');
     for(const b of [open,approve,reject])b.type='button';approve.disabled=true;reject.disabled=true;let openedTicket='';
     select.addEventListener('change',async()=>{
      openedTicket='';inspectionPending=false;approve.disabled=true;reject.disabled=true;
      if(select.value==='__new__'){
       const name=window.prompt('Name for the new person or folder:');if(!name?.trim()){select.value='';return}
       try{const result=await fetchJSON('/folders',{label:name.trim(),human_confirmed:true});choices.set(row.key,result.folder.id);await refreshAll()}catch(e){note.textContent=e.message;select.value=''}
      }else choices.set(row.key,select.value);
     });
     open.addEventListener('click',async()=>{
      if(busy)return;busy=true;inspectionPending=true;open.disabled=true;
      try{openedTicket=await inspect(row,pipeline,d.revision);approve.disabled=!select.value;reject.disabled=!select.value;note.textContent='Cached evidence inspected. Confirm or deny the selected folder.'}
      catch(e){openedTicket='';inspectionPending=false;note.textContent=e.message}finally{busy=false;open.disabled=false}
     });
     async function decision(action){
      if(!openedTicket||!select.value||select.value==='__new__'||busy)return;
      busy=true;approve.disabled=true;reject.disabled=true;
      try{await fetchJSON('/review',{action,folder_id:select.value,revision:d.revision,opened_ticket:openedTicket,human_confirmed:true});openedTicket='';await refreshAll()}
      catch(e){note.textContent=e.message}finally{busy=false}
     }
     approve.addEventListener('click',()=>decision('approve'));reject.addEventListener('click',()=>decision('reject'));
     actions.append(open,approve,reject);card.append(select,actions,note);host.append(card);
    }
    if(d.items.length>120)host.append(node('p','Showing the first 120 pending recordings. Reviewed items leave the queue on refresh.'));
   }catch(e){if(ticket===serial)host.replaceChildren(node('p',e.message))}finally{if(ticket===serial)refresh.disabled=false}
  }
  clothing.addEventListener('click',()=>{pipeline='clothing';load()});context.addEventListener('click',()=>{pipeline='context';load()});refresh.addEventListener('click',load);
   controllers.push({active,load,canAutoRefresh});return {section,load,canAutoRefresh};
 }
 const style=node('style');style.textContent='#review.appearance-evidence-active>:not(.appearance-evidence-nav):not(.appearance-evidence-panel):not(.section-head){display:none!important}.appearance-evidence-card{display:flex;flex-direction:column;align-items:flex-start;gap:7px;padding:14px;border:1px solid #34505d;border-radius:10px;margin:12px 0}.appearance-evidence-card .actions{display:flex;flex-wrap:wrap;gap:8px}.appearance-evidence-card select{max-width:100%}.appearance-evidence-card p{margin:3px 0}';document.head.append(style);
 const review=document.getElementById('review');
 if(review){
  const nav=node('nav');nav.className='tabs appearance-evidence-nav';const recordings=node('button','Recordings'),suggestions=node('button','Appearance comparisons');recordings.type=suggestions.type='button';nav.append(recordings,suggestions);
  const header=review.querySelector('.section-head');header?header.after(nav):review.prepend(nav);const panel=mount(review);panel.section.hidden=true;
  recordings.addEventListener('click',()=>{review.classList.remove('appearance-evidence-active');panel.section.hidden=true});
  suggestions.addEventListener('click',()=>{review.classList.add('appearance-evidence-active');panel.section.hidden=false;panel.load()});
 }
 const automatic=document.getElementById('automatic');if(automatic){
  const panel=mount(automatic,true);automatic.prepend(panel.section);
  new MutationObserver(()=>{if(!automatic.hidden&&panel.canAutoRefresh())panel.load()}).observe(automatic,{attributes:true,attributeFilter:['hidden']});
 }
 covers();setInterval(()=>{if(document.visibilityState==='visible'){covers();for(const c of controllers)if(c.active()&&c.canAutoRefresh())c.load()}},60000);
})();

/* Whole-recording owner review. No person matching or analysis is started here. */
(()=>{'use strict';
if(window.C720PArchiveReviewV32)return;
const $=id=>document.getElementById(id),key=(s,n)=>s+':'+n;
const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
const text=(e,value)=>{if(e.textContent!==String(value))e.textContent=String(value)};
const relay=()=>{try{return window.C720PSecureRelay||window.parent.C720PSecureRelay}catch(_){return null}};
const selected=new Map(),reviews={sd:null,drive:null},loading={},errors={};let busy=false,cancelled=false,scheduled=false;
const labels={person:'Verified · one person',people:'Verified · people',no_people:'Verified · no people',uncertain:'Unsure',clear:'Unreviewed'};
const style=make('style');style.textContent=`
.archive-bulk-v32{position:sticky;top:0;z-index:20;background:#142631f5;border:1px solid #47616f;border-radius:12px;padding:13px;margin:0 0 20px;backdrop-filter:blur(12px)}
.archive-bulk-v32 .bulk-line{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.archive-bulk-v32 button,.archive-bulk-v32 select,.review-verify-v32 button{font:inherit;border:1px solid #4b6572;border-radius:8px;background:#233c49;color:#eff9fc;padding:9px 11px;min-height:40px;cursor:pointer}
.archive-bulk-v32 button:disabled,.archive-bulk-v32 select:disabled,.review-verify-v32 button:disabled{opacity:.48;cursor:default}.archive-bulk-v32 .danger{background:#482c32;border-color:#925963;color:#ffd1d5}
.archive-bulk-v32 p{margin:7px 0 0;font-size:12px;color:#b7cbd4}.archive-bulk-v32 strong{margin-right:5px}.archive-select-v32{display:flex;gap:9px;align-items:center;justify-content:space-between;min-height:38px;padding:0 3px}
.archive-select-v32 label{display:flex;gap:8px;align-items:center;cursor:pointer;min-height:38px;font-size:12px}.archive-select-v32 input{width:20px;height:20px;accent-color:#79d2ba}.archive-review-state-v32{font-size:11px;color:#9fb9c5;text-align:right}
.archive-action-card.is-selected-v32{outline:2px solid #80dbc9;outline-offset:5px;border-radius:9px}.archive-action-card.is-verified-v32 .archive-review-state-v32{color:#a2edd1}.review-verify-v32{display:grid;grid-template-columns:1fr 1fr;gap:6px}.review-verify-v32 button{font-size:11px;padding:8px 4px;min-height:38px}.review-verify-v32 button[aria-pressed=true]{background:#234f44;border-color:#7bd8b2;color:#c9ffe4}
.archive-bulk-v32 button:focus-visible,.archive-bulk-v32 select:focus-visible,.review-verify-v32 button:focus-visible,.archive-select-v32 input:focus-visible{outline:2px solid #99eddb;outline-offset:3px}#archiveBulkResultsV32{font-size:12px;max-height:180px;overflow:auto;white-space:pre-wrap;color:#ffd4bb;margin:8px 0 0}#archiveBulkCancelV32[hidden]{display:none}
`;document.head.append(style);
const bar=make('section','archive-bulk-v32');bar.setAttribute('aria-label','Select and verify archive recordings');
const line=make('div','bulk-line'),count=make('strong','','0 selected');count.id='archiveSelectedCountV32';line.append(count);
function button(label,id,callback,cls){const b=make('button',cls,label);b.type='button';if(id)b.id=id;b.addEventListener('click',callback);return b}
line.append(button('Select all shown','archiveSelectAllV32',()=>selectShown(false)),button('Select verified','archiveSelectVerifiedV32',()=>selectShown(true)),button('Clear selection','archiveClearSelectionV32',()=>{if(!busy){selected.clear();paint()}}));
const actionLine=make('div','bulk-line');actionLine.style.marginTop='9px';
actionLine.append(button('✓ Verify person','archiveBulkPersonV32',()=>verify([...selected.values()],'person')),button('✓ Verify people','archiveBulkPeopleV32',()=>verify([...selected.values()],'people')));
const more=make('select');more.id='archiveBulkMoreV32';more.setAttribute('aria-label','More actions for selected recordings');
for(const [value,label]of [['','More actions…'],['no_people','Mark no people'],['uncertain','Mark unsure'],['clear','Remove verification'],['copy','Copy filenames']]){const o=make('option','',label);o.value=value;more.append(o)}
more.addEventListener('change',async()=>{const action=more.value;more.value='';if(action==='copy')await copySelected();else if(action)await verify([...selected.values()],action)});actionLine.append(more,button('Delete selected','archiveBulkDeleteV32',removeSelected,'danger'));
const cancel=button('Stop after this clip','archiveBulkCancelV32',()=>{cancelled=true;text(message,'Stopping after the current request…')});cancel.hidden=true;actionLine.append(cancel);
const message=make('p','','Watch a recording, then verify Person or People. Only verified recordings are used in People & faces.');message.id='archiveReviewMessageV32';message.setAttribute('role','status');
const summary=make('p');summary.id='archiveReviewSummaryV32';const results=make('pre');results.id='archiveBulkResultsV32';results.hidden=true;
bar.append(line,actionLine,message,summary,results);
const anchor=document.querySelector('.source-switch');if(anchor)anchor.after(bar);else document.querySelector('main')?.prepend(bar);
const active=()=>$('driveTab')?.getAttribute('aria-selected')==='true'?'drive':'sd';
const clipState=(s,n)=>reviews[s]?.clips?.[n];
function entry(source,name,info={}){const state=clipState(source,name);return {source,name,info,revision:state?.revision||null}}
function shown(){const source=active();const rows=window.C720PArchiveRecordsV32?.visible(source)||[];return rows.map(r=>entry(source,String(r.clip_no||r.remote_name||r.name||''),r))}
function selectShown(verifiedOnly){if(busy)return;for(const item of shown()){const state=clipState(item.source,item.name);if(!verifiedOnly||['person','people'].includes(state?.label))selected.set(key(item.source,item.name),item)}paint()}
function paint(){
 text(count,selected.size+' selected');
 for(const card of document.querySelectorAll('.archive-action-card[data-review-key-v32]')){
  const original=card.querySelector('.clip[data-archive-name]');if(!original)continue;const source=original.dataset.archiveSource,name=original.dataset.archiveName,state=clipState(source,name),on=selected.has(key(source,name));
  card.classList.toggle('is-selected-v32',on);card.classList.toggle('is-verified-v32',['person','people'].includes(state?.label));
  const checkbox=card.querySelector('input[data-select-v32]');checkbox.checked=on;checkbox.disabled=busy;
  text(card.querySelector('.archive-review-state-v32'),state?labels[state.label||'clear']:(errors[source]?'Review unavailable':'Loading review…'));
  for(const b of card.querySelectorAll('[data-verify-v32]')){b.disabled=busy||!state;b.setAttribute('aria-pressed',String(state?.label===b.dataset.verifyV32))}
 }
 for(const id of ['archiveBulkPersonV32','archiveBulkPeopleV32','archiveBulkDeleteV32','archiveBulkMoreV32'])$(id).disabled=busy||!selected.size;
 for(const id of ['archiveSelectAllV32','archiveSelectVerifiedV32','archiveClearSelectionV32'])$(id).disabled=busy;
 cancel.hidden=!busy;
 const current=reviews[active()];text(summary,current?current.verified_people_clips+' verified person/people recordings · '+current.counts.unreviewed+' not reviewed':errors[active()]||'Loading saved verification…');
}
async function load(source){
 if(loading[source])return loading[source];
 loading[source]=(async()=>{try{const a=relay();if(!a?.fetch)throw Error('Private Security connection unavailable');const response=await a.fetch('/new/api/archive-review?source='+source,{cache:'no-store'});const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'Could not load verification');reviews[source]=data;delete errors[source]}catch(error){errors[source]='Verification unavailable: '+error.message}finally{delete loading[source];paint()}})();return loading[source];
}
function enhance(){
 for(const card of document.querySelectorAll('.archive-action-card')){
  const original=card.querySelector('.clip[data-archive-name]');if(!original||card.dataset.reviewKeyV32)continue;
  const source=original.dataset.archiveSource,name=original.dataset.archiveName;if(!['sd','drive'].includes(source))continue;
  card.dataset.reviewKeyV32=key(source,name);let info={};try{info=JSON.parse(original.dataset.archiveInfo||'{}')}catch(_){}
  const row=make('div','archive-select-v32'),label=make('label'),checkbox=make('input');checkbox.type='checkbox';checkbox.dataset.selectV32='1';checkbox.setAttribute('aria-label','Select '+name);
  checkbox.addEventListener('change',()=>{const k=key(source,name);if(checkbox.checked)selected.set(k,entry(source,name,info));else selected.delete(k);paint()});label.append(checkbox,make('span','','Select'));row.append(label,make('span','archive-review-state-v32','Loading review…'));card.prepend(row);
  const actions=make('div','review-verify-v32');for(const [value,caption]of [['person','✓ Verify person'],['people','✓ Verify people']]){const b=button(caption,null,()=>verify([entry(source,name,info)],value));b.dataset.verifyV32=value;b.title=value==='person'?'I confirm this recording shows one person':'I confirm this recording shows multiple people';actions.append(b)}card.append(actions);
 }
 paint();
}
function schedule(){if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;enhance()})}
function begin(){busy=true;cancelled=false;results.hidden=true;text(results,'');paint()}
async function finish(messageText,failures=[]){busy=false;cancelled=false;text(message,messageText);if(failures.length){text(results,failures.join('\n'));results.hidden=false}paint()}
async function verify(items,label){
 if(busy||!items.length)return;
 begin();let done=0;const failures=[];
 try{
  const a=relay();if(!a?.fetch)throw Error('Private Security connection unavailable');
  for(let offset=0;offset<items.length&&!cancelled;offset+=25){
   const group=items.slice(offset,offset+25);const references=group.map(item=>{const state=clipState(item.source,item.name);if(!state||state.bytes!==Number(item.info.size))throw Error('Recording changed or verification unavailable. Refresh the archive before verifying.');return {source:item.source,name:item.name,revision:item.revision||state.revision}});
   text(message,'Saving verification '+(offset+1)+'–'+Math.min(offset+25,items.length)+' of '+items.length+'…');
   const response=await a.fetch('/new/api/archive-review/batch',{method:'POST',headers:{'Content-Type':'application/json','X-S9-Archive-Review-Intent':'human-recording-review-v32'},body:JSON.stringify({items:references,label,human_confirmed:true}),cache:'no-store'});const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'Verification not saved');
   done+=data.updated;for(const item of group){const state=clipState(item.source,item.name);if(state)state.label=label==='clear'?null:label}
  }
 }catch(error){failures.push(error.message)}
 for(const source of new Set(items.map(x=>x.source)))await load(source);
 await finish((label==='clear'?'Verification removed from ': 'Verification saved for ')+done+' recording'+(done===1?'':'s')+(cancelled?' · stopped.':'.')+' Your verified set is available in People & faces.',failures);
}
async function removeSelected(){
 if(busy||!selected.size)return;const items=[...selected.values()];
 const names=items.slice(0,10).map(i=>(i.source==='drive'?'Drive: ':'S9+: ')+i.name).join('\n');
 if(!window.confirm('Permanently delete '+items.length+' selected original recording'+(items.length===1?'':'s')+'?\n\n'+names+(items.length>10?'\n…and '+(items.length-10)+' more':'')+'\n\nThis cannot be undone. Recent or changed clips remain protected.'))return;
 begin();let done=0;const failures=[];
 const a=relay();
 if(!a?.fetch)return finish('Nothing deleted.',['Private Security connection unavailable']);
 for(let index=0;index<items.length&&!cancelled;index++){
  const item=items[index],source=item.source,name=item.name;let deleting=false;
  try{
   text(message,'Deleting '+(index+1)+' of '+items.length+' · '+done+' deleted…');
   const size=Number(item.info.size);if(source==='sd'&&(!Number.isSafeInteger(size)||size<=10000))throw Error('Unverified recording size');
   const response=await a.fetch(source==='sd'?'/new/api/sd/delete':'/new/api/saved/delete',{method:'POST',headers:{'Content-Type':'application/json','X-S9-Archive-Delete-Intent':'explicit-user-delete-v1'},body:JSON.stringify(source==='sd'?{clip_no:name,expected_bytes:size,confirm:'DELETE '+name}:{remote_name:name}),cache:'no-store'});deleting=true;
   const data=await response.json();if(!response.ok||data.ok!==true||!(data.deleted===true||Array.isArray(data.deleted)))throw Error(data.error||'Delete not confirmed');
   done++;selected.delete(key(source,name));for(const card of document.querySelectorAll('.archive-action-card'))if(card.dataset.reviewKeyV32===key(source,name))card.remove();
  }catch(error){failures.push(name+': '+error.message+(deleting?' (refresh to confirm file state)':''))}
 }
 const stopped=cancelled;for(const source of new Set(items.map(x=>x.source)))$(source==='drive'?'driveRefresh':'refresh')?.click();
 await finish(done+' deleted · '+(items.length-done)+' retained or not confirmed'+(stopped?' · stopped.':'.'),failures);
}
async function copySelected(){if(!selected.size||busy)return;try{await navigator.clipboard.writeText([...selected.values()].map(i=>i.name).join('\n'));text(message,selected.size+' filenames copied.')}catch(_){text(results,[...selected.values()].map(i=>i.name).join('\n'));results.hidden=false;text(message,'Copy these selected filenames:')}}
window.C720PArchiveReviewV32={getSelected:()=>[...selected.values()].map(i=>({...i})),reload:()=>load(active())};
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('archive-records-v32',event=>{const source=event.detail?.source;if(['sd','drive'].includes(source))load(source);schedule()});
for(const id of ['localTab','driveTab'])$(id)?.addEventListener('click',()=>{load(id==='driveTab'?'drive':'sd');paint()});
enhance();load('sd');
})();

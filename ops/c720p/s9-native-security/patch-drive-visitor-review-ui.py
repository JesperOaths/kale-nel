#!/usr/bin/env python3
"""Authenticated Security page for human-confirmed persistent visitor IDs."""
import argparse
import os
from pathlib import Path

STYLE_ID="s9-drive-person-review-style-v1"
SCRIPT_ID="s9-drive-person-review-script-v1"
SNIPPET=r'''
<style id="s9-drive-person-review-style-v1">
#s9-drive-person-review{border:1px solid #48667d;border-radius:13px;background:#10232e;color:#eef7fc;margin:16px 0;padding:14px}
#s9-drive-person-review h3{font-size:17px;margin:0 0 7px}
#s9-drive-person-review p{font-size:12px;line-height:1.55;color:#c5d9e6}
#s9-drive-person-review .s9-review-entry{padding:10px;margin:9px 0;background:#203643;border-radius:9px;border:1px solid #405767}
#s9-drive-person-review .s9-review-entry strong{font-size:13px;overflow-wrap:anywhere}
#s9-drive-person-review .s9-review-entry small{display:block;color:#bcd4e1}
#s9-drive-person-review label{display:block;font-size:12px;margin:7px 0}
#s9-drive-person-review button,#s9-drive-person-review select{font:inherit;font-size:12px;padding:7px;border-radius:6px;max-width:100%}
#s9-drive-person-review button{border:1px solid #7198a9;background:#38586d;color:#fff;cursor:pointer;margin:4px 4px 0 0}
#s9-drive-person-review button:disabled{opacity:.42;cursor:default}
#s9-drive-person-review a{color:#90d3ff}
</style>
<script id="s9-drive-person-review-script-v1">
(()=>{
'use strict';
const url='/new/api/drive-person-review',hostId='s9-drive-person-review';
let page=0;
const pageSize=30;
const txt=(tag,value,cl)=>{
 const e=document.createElement(tag);
 if(value!==undefined)e.textContent=String(value);
 if(cl)e.className=cl;
 return e;
};
function container(){
 const root=document.getElementById('list');
 if(!root)return null;
 let p=document.getElementById(hostId);
 if(!p){
  p=document.createElement('section');p.id=hostId;
  p.append(txt('h3','Historical Drive clips · Person review'));
  p.append(txt('p','AI detects person candidates, not verified people. Persistent visitor IDs are assigned ONLY after you review the original video in Drive. No automatic biometric or face matching.'));
  p.append(txt('p','Loading verified old recordings…','s9-drive-summary'));
  const details=document.createElement('details');
  details.append(txt('summary','Open clip review and visitor IDs'),txt('div','','s9-drive-records'));
  p.append(details);root.prepend(p);
 }
 return p;
}
function render(data){
 const host=container();if(!host)return;
 const progress=data.summary||{};
 host.querySelector('.s9-drive-summary').textContent=
   'Classified '+(progress.processed||0)+' / '+(progress.eligible||0)+
   ' verified old clips · '+(progress.remaining||0)+' remaining · '+
   (data.reviewed_single_person_links||0)+' human-confirmed visitor links.';
 const list=host.querySelector('.s9-drive-records');
 list.replaceChildren();
 const all=Array.isArray(data.clips)?data.clips:[];
 page=Math.min(page,Math.max(0,Math.ceil(all.length/pageSize)-1));
 const rows=all.slice(page*pageSize,(page+1)*pageSize);
 if(!rows.length){list.append(txt('p','No archived recordings classified yet.'));return;}
 for(const row of rows){
  const card=txt('div',undefined,'s9-review-entry');
  card.append(txt('strong',row.remote_name||row.clip_id.slice(0,16)));
  card.append(txt('small',(row.category||'unknown')+' · '+Math.round(Number(row.person_score||0)*100)+'% model score · '+(row.visitor_id||'No verified visitor ID')));
  const possible=Array.isArray(row.possible_same_outfit_clips)?row.possible_same_outfit_clips:[];
  if(possible.length){
   card.append(txt('small','Possible repeat outfit — NOT confirmed as the same person:'));
   for(const suggestion of possible){
    const candidate=(Array.isArray(data.clips)?data.clips:[]).find(v=>v.clip_id===suggestion.clip_id);
    if(!candidate)continue;
    const item=txt('small',String(Math.round(Number(suggestion.appearance_similarity)*100))+
      '% clothing-color similarity · '+String(candidate.remote_name||candidate.clip_id.slice(0,12)));
    card.append(item);
   }
   card.append(txt('small','Compare both original recordings manually before assigning a persistent visitor ID.'));
  }
  const folder=data.drive_folders?.[row.camera];
  if(typeof folder==='string' && /^https:\/\/drive\.google\.com\/drive\/folders\//.test(folder)){
   const a=txt('a','Open original video folder in Drive');a.href=folder;a.target='_blank';a.rel='noopener noreferrer';card.append(a);
  }
  const copy=txt('button','Copy exact filename');
  copy.type='button';copy.addEventListener('click',()=>{navigator.clipboard?.writeText(row.remote_name||'')});
  card.append(copy);
  if(row.eligible_for_one_person_link){
   const label=txt('label','');
   const check=document.createElement('input');check.type='checkbox';
   label.append(check,document.createTextNode(' I personally reviewed this exact original video and verified the individual.'));
   card.append(label);
   const select=document.createElement('select');
   const option=(value,text)=>{const o=document.createElement('option');o.value=value;o.textContent=text;select.append(o)};
   option('','Create a NEW persistent visitor ID');
   for(const id of (data.visitor_ids||[]))option(id,'Link to existing '+id);
   card.append(select);
   const button=txt('button','Confirm visitor link');button.type='button';button.disabled=true;
   check.addEventListener('change',()=>{button.disabled=!check.checked});
   button.addEventListener('click',async()=>{
    if(!check.checked)return;
    button.disabled=true;
    try{
     const visitor=select.value||null;
     const resp=await window.C720PSecureRelay.fetch(url,{
      method:'POST',
      headers:{'Content-Type':'application/json','X-S9-Visitor-Intent':'manual-confirmed-visitor-v1'},
      body:JSON.stringify({clip_id:row.clip_id,action:visitor?'link':'create',visitor_id:visitor,human_confirmed:true})
     });
     const result=await resp.json();
     if(!resp.ok||!result.ok)throw Error(result.error||'review_failed');
     await refresh();
    }catch(e){card.append(txt('small','Could not link visitor: '+String(e.message||e)))}
   });
   card.append(button);
   if(row.visitor_id){
    const unlink=txt('button','Remove confirmed link');
    unlink.type='button';unlink.addEventListener('click',async()=>{
     try{
      const resp=await window.C720PSecureRelay.fetch(url,{
       method:'POST',
       headers:{'Content-Type':'application/json','X-S9-Visitor-Intent':'manual-confirmed-visitor-v1'},
       body:JSON.stringify({clip_id:row.clip_id,action:'unlink',visitor_id:null,human_confirmed:false})
      });
      if(!resp.ok)throw Error('unlink_failed');
      await refresh();
     }catch(e){card.append(txt('small','Could not remove link: '+String(e.message||e)))}
    });card.append(unlink);
   }
  }else card.append(txt('small','Group, vehicle-only, or unresolved recordings cannot receive a single visitor ID.'));
  list.append(card);
 }
 if(all.length>pageSize){
  const control=txt('div');
  const previous=txt('button','Previous '+pageSize);previous.type='button';
  previous.disabled=page===0;
  previous.addEventListener('click',()=>{page--;render(data)});
  control.append(previous,txt('span',' Page '+(page+1)+' of '+Math.ceil(all.length/pageSize)+' '));
  const next=txt('button','Next '+pageSize);next.type='button';
  next.disabled=(page+1)*pageSize>=all.length;
  next.addEventListener('click',()=>{page++;render(data)});
  control.append(next);list.append(control);
 }
}
async function refresh(){
 if(!window.C720PSecureRelay?.fetch)return;
 try{
  const response=await window.C720PSecureRelay.fetch(url,{cache:'no-store'});
  if(!response.ok)throw Error('review_server_unavailable');
  render(await response.json());
 }catch(e){const el=container();if(el)el.querySelector('.s9-drive-summary').textContent='Drive review unavailable: '+String(e.message||e)}
}
const observer=new MutationObserver(()=>{if(!document.getElementById(hostId)&&document.getElementById('list'))container()});
if(document.getElementById('list'))observer.observe(document.getElementById('list'),{childList:true});
window.addEventListener('pageshow',refresh);
setTimeout(refresh,1200);
setInterval(()=>{if(!document.hidden)refresh()},60000);
})();
</script>
'''
def patch(html):
 if STYLE_ID in html and SCRIPT_ID in html:return html
 if html.count("</body>")!=1 or 'c720p-s9-phone-clips-ui-v1' not in html:
  raise ValueError("unknown_security_page")
 return html.replace("</body>",SNIPPET+"\n</body>",1)
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("html",type=Path)
 path=p.parse_args().html
 raw=path.read_text();new=patch(raw)
 if raw!=new:
  tmp=path.with_suffix(".html.visitor-stage")
  tmp.write_text(new);os.chmod(tmp,path.stat().st_mode&0o777);os.replace(tmp,path)
  print("S9_LEGACY_DRIVE_PERSON_REVIEW_UI_PATCHED")
 else:print("S9_LEGACY_DRIVE_PERSON_REVIEW_UI_PRESENT")

#!/usr/bin/env python3
"""Security Saved Clips: non-destructive date/category virtual folders.

Only extends Home Assistant's existing HTML. This does NOT move, relabel,
rewrite, or remove SD / Drive recordings. Classifications are explicitly
model-generated clip-scoped suggestions, not identified people.
"""
import argparse
from datetime import datetime, timezone
import os
from pathlib import Path
import re
import shutil

MARKER='id="s9-saved-virtual-folders-script-v1"'
STYLE='id="s9-saved-virtual-folders-style-v1"'

SNIPPET=r'''
<style id="s9-saved-virtual-folders-style-v1">
#s9-date-folders{margin:10px 0 14px;border:1px solid #54869e;border-radius:12px;background:#102432;padding:11px;color:#eaf8ff;min-width:0}
#s9-date-folders h3{font-size:17px;margin:0 0 5px;font-weight:850}
#s9-date-folders p{font-size:12px;color:#bbd9e9;line-height:1.45;margin:5px 0 9px}
#s9-date-folders details{border:1px solid #375569;border-radius:9px;background:#193446;margin:7px 0;padding:4px 8px}
#s9-date-folders details details{background:#203d50;border-color:#496c83;margin:7px 2px}
#s9-date-folders summary{cursor:pointer;list-style:revert;font-weight:750;font-size:13px;padding:7px 3px;line-height:1.5;overflow-wrap:anywhere}
#s9-date-folders .s9-folder-items{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,230px),1fr));gap:7px;padding-bottom:7px}
#s9-date-folders .s9-folder-clip{border:1px solid #547b91;background:#294a5b;border-radius:8px;color:#eaf9ff;cursor:pointer;text-align:left;padding:7px;display:flex;gap:8px;align-items:center;font:inherit;min-width:0}
#s9-date-folders .s9-folder-clip img{width:68px;height:48px;object-fit:contain;background:#08131d;border-radius:5px;flex:none}
#s9-date-folders .s9-folder-clip .s9-folder-copy{font-size:12px;min-width:0;overflow-wrap:anywhere}
#s9-date-folders .s9-folder-clip small{font-size:11px;color:#bdd8e7;display:block;margin-top:3px}
#s9-date-folders button:focus-visible{outline:2px solid #a8eaff;outline-offset:2px}
#s9-date-folders .s9-folder-more{font-size:12px;background:#264f66;color:#fff;border:1px solid #75a6bf;padding:8px 10px;border-radius:7px;cursor:pointer}
#s9-date-folders .s9-folder-refresh{font-size:12px;color:#c3e5f8;font-weight:700}
</style>
<script id="s9-saved-virtual-folders-script-v1">
(()=>{
 'use strict';
 const ID='s9-date-folders', BASE='/local/frontyard-security-new/';
 const native=/^(?:motion|native4k)_([0-9]{13})[.]mp4$/;
 const legacy=/^rec_([0-9]{4}-[0-9]{2}-[0-9]{2})_([0-9]{2}-[0-9]{2})[.]mp4$/;
 const safe=/^(?:(?:motion|native4k)_[0-9]{13}|rec_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2})[.]mp4$/;
 const groups=[
  ['multiple','Multiple people candidates'],
  ['person','Person detected / likely'],
  ['vehicle','Vehicle motion'],
  ['animal','Animal motion'],
  ['other','Other motion'],
  ['unreviewed','Not classified']
 ];
 const nameOf=r=>String(r.clip_no||r.name||'');
 const dayOf=r=>{
  const name=nameOf(r),m=native.exec(name),l=legacy.exec(name);
  if(l)return l[1];
  if(!m)return '';
  const n=Number(m[1]);
  if(!Number.isSafeInteger(n))return '';
  try{
   const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(n));
   const obj=Object.fromEntries(parts.map(x=>[x.type,x.value]));
   return [obj.year,obj.month,obj.day].join('-');
  }catch(_){return ''}
 };
 const category=r=>{
  const g=String(r.scene_category||r.person_status||'');
  const tags=Array.isArray(r.content_categories)?r.content_categories:[];
  if(g==='multiple_people'||String(r.person_event_category||'')==='multiple_people_candidate')return 'multiple';
  if(g==='one_person'||g==='single_person_event_candidate'||g==='single_person_repeated_candidate'||(Number(r.person_count)||0)>0)return 'person';
  if(tags.includes('vehicle'))return 'vehicle';
  if(tags.includes('animal'))return 'animal';
  if(g==='unreviewed'||g==='unknown'||g==='')return 'unreviewed';
  return 'other';
 };
 const tag=(name,klass,content)=>{
  const el=document.createElement(name);
  if(klass)el.className=klass;
  if(content!==undefined)el.textContent=content;
  return el;
 };
 const timeOf=r=>{
  const m=native.exec(nameOf(r));
  if(m)try{return new Date(Number(m[1])).toLocaleTimeString('nl-NL',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit',second:'2-digit'})}catch(_){}
  const l=legacy.exec(nameOf(r));
  return l?l[2].replace('-',':'):String(r.timestamp||'').slice(11,16);
 };
 function openClip(r){
  const name=nameOf(r);
  if(!safe.test(name))return;
  const video=document.getElementById('player');
  if(!video||!window.C720PSecureRelay?.url)return;
  const clicked=video.dataset.s9FolderRequested=name;
  const now=document.getElementById('nowName');
  if(now)now.textContent='Loading S9+ saved recording…';
  Promise.resolve(window.C720PSecureRelay.url('/new/saved/clip/'+encodeURIComponent(name))).then(url=>{
   if(video.dataset.s9FolderRequested!==clicked)return;
   video.pause();video.src=url;video.preload='metadata';
   const thumb='s9-phone-thumbs/'+name+'.thumb.jpg';
   video.poster=BASE+thumb;
   video.load();video.play().catch(()=>{});
   if(now)now.textContent='S9+ · '+dayOf(r)+' · '+timeOf(r);
   const big=document.getElementById('selectedBig');
   if(big)big.textContent='S9+ microSD · '+name;
   const small=document.getElementById('selectedSmall');
   if(small)small.textContent='Original preserved · '+groups.find(g=>g[0]===category(r))[1]+' (model-estimated)';
   for(const id of ['save','delete']){
    const btn=document.getElementById(id);if(btn)btn.disabled=true;
   }
   video.scrollIntoView({behavior:'smooth',block:'nearest'});
  }).catch(()=>{
   if(now)now.textContent='Video temporarily unavailable · '+name;
  });
 }
 function clipsInto(host,arr){
  const grid=tag('div','s9-folder-items');
  let shown=0;
  const add=()=>{
   const limit=Math.min(arr.length,shown+32);
   for(;shown<limit;shown++){
    const r=arr[shown],name=nameOf(r),button=tag('button','s9-folder-clip');
    button.type='button';
    const img=tag('img');img.loading='lazy';img.alt='Saved recording preview';
    img.src=BASE+'s9-phone-thumbs/'+name+'.thumb.jpg';
    const t=tag('span','s9-folder-copy',timeOf(r));
    t.append(tag('small','',groups.find(g=>g[0]===category(r))[1]));
    button.append(img,t);
    button.addEventListener('click',()=>openClip(r));
    grid.append(button);
   }
   more.hidden=shown>=arr.length;
   more.textContent='Show more clips · '+(arr.length-shown)+' remaining';
  };
  const more=tag('button','s9-folder-more');
  more.type='button';more.addEventListener('click',add);
  host.append(grid,more);
  add();
 }
 function render(data){
  const root=document.getElementById('list');
  if(!root)return;
  let host=document.getElementById(ID);
  if(!host){host=tag('section');host.id=ID;root.prepend(host)}
  // Do not repopulate while the user is expanding a date/category.
  const signature=data.map(x=>nameOf(x)+String(x.scene_category||'')).join('|');
  if(host.dataset.signature===signature)return;
  const open=new Set([...host.querySelectorAll('details[open]')].map(x=>x.dataset.folderKey));
  host.replaceChildren();
  host.dataset.signature=signature;
  host.append(tag('h3','', 'Saved S9+ clips · date folders'));
  host.append(tag('p','',
   'Original videos stay on microSD. Folders are a searchable view, not file moves. Detection categories are model estimates; no verified identities.'));
  host.append(tag('p','s9-folder-refresh',data.length+' playable recordings · newest dates first'));
  const byDay=new Map();
  for(const r of data){
   const day=dayOf(r);if(!day)continue;
   if(!byDay.has(day))byDay.set(day,[]);
   byDay.get(day).push(r);
  }
  for(const [day,clips] of [...byDay.entries()].sort((a,b)=>b[0].localeCompare(a[0]))){
   const date=tag('details');date.dataset.folderKey='date:'+day;
   date.open=open.has(date.dataset.folderKey);
   date.append(tag('summary','',day+' · '+clips.length+' recordings'));
   for(const [key,title] of groups){
    const selected=clips.filter(x=>category(x)===key).sort((a,b)=>nameOf(b).localeCompare(nameOf(a)));
    if(!selected.length)continue;
    const folder=tag('details');folder.dataset.folderKey='cat:'+day+':'+key;
    folder.open=open.has(folder.dataset.folderKey);
    folder.append(tag('summary','',title+' · '+selected.length));
    let populated=false;
    const load=()=>{if(populated)return;populated=true;clipsInto(folder,selected)};
    folder.addEventListener('toggle',()=>{if(folder.open)load()});
    if(folder.open)load();
    date.append(folder);
   }
   host.append(date);
  }
 }
 let current=[];
 async function reload(){
  try{
   const relay=window.C720PSecureRelay;
   if(!relay?.fetch)throw Error('relay unavailable');
   const r=await relay.fetch('/new/api/saved',{cache:'no-store'});
   if(!r.ok)throw Error('signed saved archive unavailable');
   const body=await r.json();
   const list=(Array.isArray(body.events)?body.events:[]).filter(x=>safe.test(nameOf(x)));
   if(list.length){
    current=list.sort((a,b)=>nameOf(b).localeCompare(nameOf(a)));
    render(current);
   }
  }catch(_){
   // Cached static catalog is a non-sensitive display fallback; playback
   // itself still requires signed access and does not bypass authorization.
   try{
    const r=await fetch(BASE+'s9-phone-events.json?t='+Date.now(),{cache:'no-store'});
    const j=await r.json();
    const records=(Array.isArray(j.phone_recordings)?j.phone_recordings:[]).filter(x=>safe.test(nameOf(x))&&x.sd_verified===true);
    if(records.length){current=records.sort((a,b)=>nameOf(b).localeCompare(nameOf(a)));render(current)}
   }catch(_){}
  }
 }
 const list=document.getElementById('list');
 const observer=new MutationObserver(()=>{
  if(current.length&&list&&!document.getElementById(ID))render(current);
 });
 if(list)observer.observe(list,{childList:true});
 setTimeout(reload,1100);
 window.addEventListener('pageshow',reload);
 setInterval(()=>{if(!document.hidden)reload()},45000);
})();
</script>
'''

def patch(text: str) -> str:
    if text.count('</body>')!=1 or text.count('id="list"')!=1:
        raise ValueError("unsupported_saved_clips_page")
    if "c720p-secure-relay-client.js" not in text or "s9-video-orientation-script-v1" not in text:
        raise ValueError("signed_media_or_playback_contract_missing")
    if (MARKER in text)!=(STYLE in text):
        raise ValueError("partially_installed_date_folder_widget")
    if MARKER in text:
        if text.count(MARKER)!=1 or text.count(STYLE)!=1:
            raise ValueError("duplicate_date_folder_widget")
        old_style=re.findall(r'<style id="s9-saved-virtual-folders-style-v1">[\\s\\S]*?</style>',text)
        old_script=re.findall(r'<script id="s9-saved-virtual-folders-script-v1">[\\s\\S]*?</script>',text)
        new_style=re.findall(r'<style id="s9-saved-virtual-folders-style-v1">[\\s\\S]*?</style>',SNIPPET)
        new_script=re.findall(r'<script id="s9-saved-virtual-folders-script-v1">[\\s\\S]*?</script>',SNIPPET)
        if not all(len(v)==1 for v in (old_style,old_script,new_style,new_script)):
            raise ValueError("incomplete_date_folder_widget")
        if not all(k in old_script[0] for k in
                   ('const native=', 'const safe=', 'function render(data)', 'function openClip(r)')):
            raise ValueError("unrecognized_existing_folder_widget")
        return text.replace(old_style[0],new_style[0],1).replace(old_script[0],new_script[0],1)
    return text.replace("</body>",SNIPPET+"\n</body>",1)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--page",type=Path,default=Path('/opt/homeassistant/config/www/frontyard-security-new/clips.html'))
    ap.add_argument("--apply",action="store_true")
    args=ap.parse_args()
    original=args.page.read_text()
    after=patch(original)
    if patch(after)!=after:raise RuntimeError("folder_patch_not_idempotent")
    if not args.apply:
        print("S9_DATE_CATEGORY_FOLDERS_DRY_RUN",after!=original);return
    if after==original:
        print("S9_DATE_CATEGORY_FOLDERS_ALREADY_INSTALLED");return
    back=Path('/home/jespern/c720p-home-hub/backups/s9-folders')
    back.mkdir(parents=True,exist_ok=True)
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup=back/('clips.before-folders.'+stamp+'.html')
    shutil.copy2(args.page,backup);os.chmod(backup,0o600)
    stage=args.page.with_name(args.page.name+'.folders-stage')
    try:
        stage.write_text(after);os.chmod(stage,args.page.stat().st_mode&0o777)
        if stage.read_text()!=after:raise RuntimeError("failed_to_stage_folders")
        os.replace(stage,args.page)
        if patch(args.page.read_text())!=after:raise RuntimeError("folders_post_write_mismatch")
    except Exception:
        stage.unlink(missing_ok=True)
        fallback=args.page.with_name(args.page.name+'.folders-rollback')
        shutil.copy2(backup,fallback)
        os.replace(fallback,args.page)
        raise
    print("S9_DATE_CATEGORY_FOLDERS_HTML_ONLY_DEPLOYED",str(backup),
          "original_video_modified=False phone_restarted=False")

if __name__=="__main__":
    main()

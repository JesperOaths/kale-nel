#!/usr/bin/env python3
"""Show all SD-only fallback motion stills by date and suppression reason.

This is a display-only upgrade of the existing Home Assistant Security
still-evidence gallery. Video files and original JPEGs are never changed.
"""
import argparse
from datetime import datetime, timezone
import os
from pathlib import Path
import shutil

PAGE=Path("/opt/homeassistant/config/www/frontyard-security-new/clips.html")
MARKER='id="s9-fallback-dated-style-v2"'
SCRIPT_OPEN='<script id="s9-fallback-gallery-script-v1">'
SCRIPT_CLOSE='</script>'

CSS=r'''
<style id="s9-fallback-dated-style-v2">
#s9-fallback-section details{margin:8px 0;padding:5px 8px;border:1px solid #48647a;border-radius:9px;background:#1a3040}
#s9-fallback-section details details{margin:6px 4px;background:#224258}
#s9-fallback-section summary{cursor:pointer;padding:8px 4px;font-size:13px;font-weight:700}
#s9-fallback-section .s9-fallback-more{border:1px solid #6794ae;border-radius:8px;background:#28536a;color:#fff;padding:9px 11px;cursor:pointer;margin:6px 0 9px}
#s9-fallback-section .s9-fallback-card .s9-fallback-label{overflow-wrap:anywhere}
</style>
'''

SCRIPT=r'''
<script id="s9-fallback-gallery-script-v1">
(()=>{
 'use strict';
 const ID='s9-fallback-section';
 const pattern=/^preview_motion_([0-9]{13})[.]jpg$/;
 const reasonNames={
  cooldown_motion:'During recording cooldown',
  recording_budget_rejected:'Hourly 4K budget reached',
  thermal_or_space_guard:'Thermal or storage safety',
  recording_safety_guard:'Recording safety guard',
  motion_event:'Other motion evidence'
 };
 let evidence=[],refreshing=false;
 const root=()=>document.getElementById('list');
 const relay=()=>window.C720PSecureRelay;
 const tag=(name,cls,content)=>{
  const element=document.createElement(name);
  if(cls)element.className=cls;
  if(content!==undefined)element.textContent=content;
  return element;
 };
 function dayOf(name){
  const match=pattern.exec(name);
  if(!match)return '';
  const date=new Date(Number(match[1]));
  if(!Number.isFinite(date.getTime()))return '';
  const parts=new Intl.DateTimeFormat('en-GB',{
   timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(date);
  const fields=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return fields.year+'-'+fields.month+'-'+fields.day;
 }
 function displayTime(name){
  const match=pattern.exec(name);
  if(!match)return 'Unknown time';
  return new Date(Number(match[1])).toLocaleTimeString('nl-NL',{
   timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit',second:'2-digit'
  });
 }
 function showLarge(rec,url){
  const dialog=tag('dialog');dialog.id='s9-fallback-detail';
  const button=tag('button','','Close');button.type='button';
  button.addEventListener('click',()=>dialog.close());
  const title=tag('strong','',dayOf(rec.name)+' '+displayTime(rec.name));
  const img=tag('img');
  img.src=url;img.alt='Original motion still, not a video or person identity';
  const note=tag('p','', (reasonNames[rec.reason]||'Other motion evidence')+
   ' · Still photograph only, 640 × 480 · No verified person identity');
  dialog.append(button,title,img,note);
  document.body.append(dialog);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  dialog.showModal();
 }
 function addImages(container,clips){
  let next=0;
  const grid=tag('div','s9-fallback-grid');
  const more=tag('button','s9-fallback-more');
  more.type='button';
  more.addEventListener('click',append);
  container.append(grid,more);
  function append(){
   const end=Math.min(next+16,clips.length);
   for(;next<end;next++){
    const rec=clips[next];
    const card=tag('button','s9-fallback-card');card.type='button';
    const label=tag('div','s9-fallback-label');
    label.append(tag('strong','',displayTime(rec.name)));
    label.append(tag('div','s9-fallback-muted',reasonNames[rec.reason]||'Motion evidence'));
    label.append(tag('div','s9-fallback-muted','Still JPEG · not classified as a person'));
    card.append(label);grid.append(card);
    Promise.resolve(relay()?.url('/new/saved/still/'+encodeURIComponent(rec.name))).then(url=>{
     if(!card.isConnected)return;
     const img=tag('img');img.loading='lazy';
     img.alt='Motion event still, not a video';
     img.src=url;card.insertBefore(img,label);
     card.addEventListener('click',()=>showLarge(rec,url));
    }).catch(()=>{
     card.disabled=true;
     label.append(tag('small','','Image temporarily unavailable'));
    });
   }
   more.hidden=next>=clips.length;
   if(!more.hidden)more.textContent='Show more stills · '+(clips.length-next)+' remaining';
  }
  append();
 }
 function render(){
  const parent=root();if(!parent)return;
  let section=document.getElementById(ID);
  if(!section){section=tag('section');section.id=ID;parent.append(section)}
  const signature=evidence.map(x=>x.name+'|'+x.reason).join(';');
  if(section.dataset.signature===signature)return;
  const previouslyOpen=new Set([...section.querySelectorAll('details[open]')].map(x=>x.dataset.key));
  section.replaceChildren();
  section.dataset.signature=signature;
  section.append(tag('div','s9phone-header','S9+ motion still evidence · '+evidence.length));
  section.append(tag('div','s9-fallback-muted',
   'Photos saved when a full 4K video could not start. Originals remain on microSD. Sorted by Amsterdam date and reason. Not videos or verified people.'));
  const days=new Map();
  for(const rec of evidence){
   if(rec.kind!=='preview_only_motion_evidence'||rec.person_status!=='not_evaluated'||!pattern.test(rec.name))continue;
   const day=dayOf(rec.name);
   if(!day)continue;
   if(!days.has(day))days.set(day,[]);
   days.get(day).push(rec);
  }
  for(const [day,all] of [...days.entries()].sort((a,b)=>b[0].localeCompare(a[0]))){
   const outer=tag('details');
   outer.dataset.key='date:'+day;
   outer.open=previouslyOpen.has(outer.dataset.key);
   outer.append(tag('summary','',day+' · '+all.length+' still images'));
   const reasons=[...new Set(all.map(x=>x.reason||'motion_event'))];
   for(const reason of reasons){
    const clips=all.filter(x=>(x.reason||'motion_event')===reason).sort((a,b)=>b.name.localeCompare(a.name));
    const inner=tag('details');
    inner.dataset.key='reason:'+day+':'+reason;
    inner.open=previouslyOpen.has(inner.dataset.key);
    inner.append(tag('summary','',(reasonNames[reason]||'Other motion evidence')+' · '+clips.length));
    let loaded=false;
    const start=()=>{if(loaded||!inner.open)return;loaded=true;addImages(inner,clips)};
    inner.addEventListener('toggle',start);
    if(inner.open)start();
    outer.append(inner);
   }
   section.append(outer);
  }
  if(!days.size)section.append(tag('div','s9-fallback-muted','No saved fallback photographs yet.'));
 }
 async function refresh(){
  if(refreshing||!relay()?.fetch)return;
  refreshing=true;
  try{
   const res=await relay().fetch('/new/api/saved',{cache:'no-store'});
   if(!res.ok)throw Error('archive_unavailable');
   const data=await res.json();
   if(data.archive_mode!=='S9-microSD-only')return;
   evidence=Array.isArray(data.fallback_previews)?data.fallback_previews:[];
   render();
  }catch(_){/* Preserve existing live camera and video view if still feed unavailable. */}
  finally{refreshing=false}
 }
 const observer=new MutationObserver(()=>{
  if(!document.getElementById(ID)&&root())render();
 });
 if(root())observer.observe(root(),{childList:true});
 window.addEventListener('pageshow',refresh);
 setInterval(()=>{if(!document.hidden)refresh()},45000);
 setTimeout(refresh,1500);
})();
</script>
'''

# Avoid introducing fresh blank lines on each upgrade pass.
SCRIPT=SCRIPT.strip()

def script_from(source: str) -> str:
    if source.count(SCRIPT_OPEN)!=1:
        raise ValueError("unknown_or_duplicate_fallback_widget")
    start=source.index(SCRIPT_OPEN)
    end=source.find(SCRIPT_CLOSE,start+len(SCRIPT_OPEN))
    if end<0:
        raise ValueError("unclosed_fallback_script")
    return source[start:end+len(SCRIPT_CLOSE)]

def patch(html: str) -> str:
    if html.count("</body>")!=1 or 'id="list"' not in html:
        raise ValueError("unknown_security_page")
    if html.count('id="s9-fallback-gallery-v1"')!=1:
        raise ValueError("existing_fallback_gallery_not_found")
    prior=script_from(html)
    if not all(x in prior for x in
               ("s9-fallback-section", "fallback_previews", "/new/saved/still/")):
        raise ValueError("unknown_fallback_gallery_version")
    upgraded=html.replace(prior,SCRIPT,1)
    if MARKER in upgraded:
        if upgraded.count(MARKER)!=1:
            raise ValueError("duplicate_fallback_date_style")
        return upgraded
    return upgraded.replace("</body>",CSS+"\n</body>",1)

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--page',type=Path,default=PAGE)
    p.add_argument('--apply',action='store_true')
    args=p.parse_args()
    previous=args.page.read_text()
    updated=patch(previous)
    if patch(updated)!=updated:
        raise RuntimeError("fallback_dates_not_idempotent")
    if not args.apply:
        print("S9_FALLBACK_DATE_FOLDERS_DRY_RUN",updated!=previous);return
    if previous==updated:
        print("S9_FALLBACK_DATE_FOLDERS_ALREADY_INSTALLED");return
    root=Path('/home/jespern/c720p-home-hub/backups/s9-fallback-dates')
    root.mkdir(parents=True,exist_ok=True)
    backup=root/('clips.before-fallback-dates.'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.html')
    shutil.copy2(args.page,backup)
    os.chmod(backup,0o600)
    tmp=args.page.with_name(args.page.name+'.fallback-dates-stage')
    changed=False
    try:
        tmp.write_text(updated)
        os.chmod(tmp,args.page.stat().st_mode & 0o777)
        if tmp.read_text()!=updated:raise RuntimeError("staged_fallback_content_mismatch")
        os.replace(tmp,args.page);changed=True
        if patch(args.page.read_text())!=updated:raise RuntimeError("post_install_fallback_mismatch")
    except Exception:
        tmp.unlink(missing_ok=True)
        if changed:
            dest=args.page.with_name(args.page.name+'.fallback-dates-rollback')
            shutil.copy2(backup,dest)
            os.replace(dest,args.page)
        raise
    print("S9_FALLBACK_DATE_FOLDERS_DEPLOYED",backup,
          "JPEG_modified=False","MP4_modified=False","services_restarted=False")

if __name__=='__main__':
    main()

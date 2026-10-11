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
/* V4: one date picker, colour-labelled compact rows. No nested folders. */
#s9-date-folders{margin:0;min-width:0;color:#e9f7ff;font:inherit}
#s9-date-folders *{box-sizing:border-box}
#s9-date-folders h3{font-size:16px;margin:0;font-weight:800}
#s9-date-folders .s9-v4-toolbar{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin:8px 0}
#s9-date-folders .s9-v4-toolbar select,#s9-date-folders .s9-v4-toolbar button{
  color:#eef8ff;background:#1b3749;border:1px solid #56839a;border-radius:7px;padding:7px 9px;font-size:12px;cursor:pointer}
#s9-date-folders .s9-v4-toolbar select{max-width:100%}
#s9-date-folders .s9-v4-dates{display:flex;gap:6px;overflow-x:auto;padding:4px 1px 8px;scrollbar-width:thin}
#s9-date-folders .s9-v4-date{position:relative;flex:0 0 auto;display:flex;flex-direction:column;gap:3px;min-width:106px;
  border:1px solid #36586c;border-radius:8px;color:#d9edf8;background:#182f40;padding:7px 8px;text-align:left;cursor:pointer}
#s9-date-folders .s9-v4-date[aria-pressed=true]{border-color:#9ddff8;background:#23506a;color:#fff}
#s9-date-folders .s9-v4-date small{font-size:10px;color:#b6d1e1}
#s9-date-folders .s9-v4-date-dots{display:flex;gap:3px;min-height:5px}
#s9-date-folders .s9-v4-date-dots i{height:5px;min-width:7px;max-width:32px;flex:1;border-radius:3px}
#s9-date-folders .s9-v4-legend{display:flex;flex-wrap:wrap;gap:6px 12px;margin:7px 0 10px}
#s9-date-folders .s9-v4-legend span{display:inline-flex;gap:5px;align-items:center;font-size:11px;color:#d1e9f4;white-space:nowrap}
#s9-date-folders .s9-v4-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--s9-colour);flex:none}
#s9-date-folders .s9-v4-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr));gap:8px}
#s9-date-folders .s9-v4-clip{position:relative;display:flex;align-items:center;gap:9px;min-width:0;min-height:84px;
  padding:6px 8px 6px 6px;text-align:left;border:1px solid #375a70;border-left:5px solid var(--s9-colour);
  background:#1c3545;border-radius:8px;color:#edf8ff;cursor:pointer;font:inherit}
#s9-date-folders .s9-v4-clip[aria-pressed=true]{outline:2px solid #8bd8ff;outline-offset:-2px}
#s9-date-folders .s9-v4-photo{position:relative;flex:0 0 118px;height:67px;overflow:hidden;border-radius:5px;
  background:linear-gradient(135deg,#153247,#08131c);display:flex;align-items:center;justify-content:center}
#s9-date-folders .s9-v4-photo img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center}
#s9-date-folders .s9-v4-photo .s9-v4-empty{color:#bdd4e3;font-size:10px;text-align:center;padding:5px}
#s9-date-folders .s9-v4-copy{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1}
#s9-date-folders .s9-v4-copy strong{font-size:13px;line-height:1.15}
#s9-date-folders .s9-v4-copy small{font-size:11px;color:#b5d6e7;line-height:1.25}
#s9-date-folders .s9-v4-copy .s9-v4-continuation{font-size:10px;color:#98f3cf;line-height:1.2}
#s9-date-folders .s9-v4-more{color:#e8f6ff;border:1px solid #638fa4;background:#25465c;border-radius:7px;
  padding:8px 12px;cursor:pointer;margin:8px 0}
#s9-date-folders .s9-v4-count{font-size:11px;color:#b5d6e7;margin:3px 0 8px}
#s9-date-folders button:focus-visible,#s9-date-folders select:focus-visible{outline:2px solid #ade7ff;outline-offset:2px}
@media(max-width:650px){#s9-date-folders .s9-v4-cards{grid-template-columns:1fr}
 #s9-date-folders .s9-v4-photo{flex-basis:106px;height:61px}}
@media(prefers-reduced-motion:reduce){#s9-date-folders *{scroll-behavior:auto!important}}
</style>
<script id="s9-saved-virtual-folders-script-v1">
(()=>{
'use strict';
const ID='s9-date-folders',BASE='/local/frontyard-security-new/';
const native=/^(?:motion|native4k)_([0-9]{13})[.]mp4$/;
const legacy=/^rec_([0-9]{4}-[0-9]{2}-[0-9]{2})_([0-9]{2}-[0-9]{2})[.]mp4$/;
const safe=/^(?:(?:motion|native4k)_[0-9]{13}|rec_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2})[.]mp4$/;
const CATEGORIES=[
 ['person','#16a34a','Person likely'],['possible','#f59e0b','Possible person'],
 ['animal','#8b5cf6','Animal'],['vehicle','#3b82f6','Vehicle'],
 ['other','#64748b','Other motion'],['unreviewed','#94a3b8','Unreviewed']
];
const META=Object.fromEntries(CATEGORIES.map(([id,color,label])=>[id,{color,label}]));
const nameOf=r=>String(r.clip_no||r.remote_name||r.name||'');
const tag=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e;};
let current=[],selectedDay='',selectedFilter='all',selectedClip='',limit=48;
function dayOf(r){
 const name=nameOf(r),m=native.exec(name),l=legacy.exec(name);
 if(l)return l[1];if(!m)return '';
 const n=Number(m[1]);if(!Number.isSafeInteger(n))return '';
 try{const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(n));
 const o=Object.fromEntries(p.map(x=>[x.type,x.value]));return [o.year,o.month,o.day].join('-')}catch(_){return ''}
}
function timeOf(r){
 const m=native.exec(nameOf(r));
 if(m)try{return new Date(Number(m[1])).toLocaleTimeString('nl-NL',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit',second:'2-digit'})}catch(_){}
 const l=legacy.exec(nameOf(r));return l?l[2].replace('-',':'):String(r.timestamp||'').slice(11,19);
}
function category(r){
 const g=String(r.scene_category||r.person_status||'').toLowerCase();
 const event=String(r.person_event_category||'').toLowerCase();
 const tags=Array.isArray(r.content_categories)?r.content_categories.map(String):[];
 const positives=Number(r.person_count)||0;
 // A single sampled frame, raw count, or unverified legacy label is not confirmed human presence.
 if(['single_frame_person_candidate','possible_group_needs_frame_review',
     'possible_person_below_standard_threshold'].includes(event))return 'possible';
 if(event==='single_person_repeated_candidate'||event==='multiple_people_candidate')return 'person';
 if(g==='one_person'||g==='multiple_people')return 'person';
 if(positives>0||tags.includes('person')||tags.includes('people'))return 'possible';
 if(tags.includes('animal')||g.includes('animal'))return 'animal';
 if(tags.includes('vehicle')||g.includes('vehicle'))return 'vehicle';
 if(!g||g==='unreviewed'||g==='unknown')return 'unreviewed';
 return 'other';
}
function duration(r){
 const ms=Number(r.duration_ms||0);if(!(ms>0))return '';
 const s=Math.round(ms/1000);return ' · '+String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
}
function continuityNote(r){
 if(r.capture_evidence_status!=='recording_segment_verified')return '';
 const n=Number(r.capture_segment_index);
 if(!Number.isInteger(n)||n<1||n>250)return '';
 if(n===1)return 'Event start · segment 1';
 const gap=Number(r.capture_segment_gap_ms);
 const delay=Number.isFinite(gap)&&gap>=0&&gap<=60000?' · '+(gap/1000).toFixed(1)+'s gap':'';
 return 'Same event · segment '+n+delay;
}
function openClip(r){
 const name=nameOf(r);if(!safe.test(name))return;
 const video=document.getElementById('player');
 if(!video||!window.C720PSecureRelay?.url)return;
 const ticket=video.dataset.s9FolderRequested=name;
 const now=document.getElementById('nowName');
 if(now)now.textContent='Loading S9+ saved recording…';
 Promise.resolve(window.C720PSecureRelay.url('/new/saved/clip/'+encodeURIComponent(name))).then(url=>{
  if(video.dataset.s9FolderRequested!==ticket)return;
  video.pause();video.src=url;video.preload='metadata';
  video.poster=BASE+'s9-phone-thumbs/'+name+'.thumb.jpg';
  video.load();video.play().catch(()=>{});
  selectedClip=name;render(current);
  if(now)now.textContent='S9+ · '+dayOf(r)+' · '+timeOf(r);
  const big=document.getElementById('selectedBig');if(big)big.textContent='S9+ microSD · '+name;
  const small=document.getElementById('selectedSmall');
  if(small)small.textContent='Original 4K · '+META[category(r)].label+' (AI estimate)'+(continuityNote(r)?' · '+continuityNote(r):'');
  for(const id of ['save','delete']){const b=document.getElementById(id);if(b)b.disabled=true;}
 }).catch(()=>{if(now)now.textContent='Playback temporarily unavailable · '+name;});
}
function clipCard(r){
 const name=nameOf(r),c=category(r),b=tag('button','s9-v4-clip');
 b.type='button';b.dataset.clipNo=name;b.style.setProperty('--s9-colour',META[c].color);
 b.setAttribute('aria-pressed',String(name===selectedClip));
 b.setAttribute('aria-label',timeOf(r)+' '+META[c].label);
 const photo=tag('span','s9-v4-photo');
 photo.append(tag('span','s9-v4-empty','No preview yet'));
 const img=tag('img');img.loading='lazy';img.alt='Frame from saved recording';img.decoding='async';
 img.onerror=()=>img.remove();
 img.src=BASE+'s9-phone-thumbs/'+name+'.thumb.jpg';
 photo.append(img);
 const copy=tag('span','s9-v4-copy');
 copy.append(tag('strong','',timeOf(r)+duration(r)),tag('small','',META[c].label));
 const continuity=continuityNote(r);if(continuity)copy.append(tag('small','s9-v4-continuation',continuity));
 b.append(photo,copy);b.addEventListener('click',()=>openClip(r));return b;
}
function render(data){
 const root=document.getElementById('list');if(!root)return;
 let host=document.getElementById(ID);if(!host){host=tag('section');host.id=ID;root.prepend(host);}
 const days=new Map();
 for(const r of data){const d=dayOf(r);if(!d)continue;if(!days.has(d))days.set(d,[]);days.get(d).push(r);}
 const dates=[...days.keys()].sort((a,b)=>b.localeCompare(a));
 if(!dates.includes(selectedDay))selectedDay=dates[0]||'';
 host.replaceChildren();
 const header=tag('h3','', 'Recordings');host.append(header);
 const bar=tag('div','s9-v4-toolbar');
 const datePrev=tag('button','', '‹ Earlier'),dateNext=tag('button','', 'Later ›');
 datePrev.type='button';dateNext.type='button';
 const idx=dates.indexOf(selectedDay);
 datePrev.disabled=idx<0||idx>=dates.length-1;dateNext.disabled=idx<=0;
 datePrev.onclick=()=>{selectedDay=dates[idx+1];limit=48;render(current);};
 dateNext.onclick=()=>{selectedDay=dates[idx-1];limit=48;render(current);};
 const selector=tag('select');selector.setAttribute('aria-label','Filter recordings');
 for(const [value,label] of [['all','All categories'],['person','People likely'],['possible','Possible person'],
   ['animal','Animals'],['vehicle','Vehicles'],['other','Other motion'],['unreviewed','Unreviewed']]){
  const option=tag('option','',label);option.value=value;selector.append(option);
 }
 selector.value=selectedFilter;selector.onchange=()=>{selectedFilter=selector.value;limit=48;render(current);};
 bar.append(datePrev,dateNext,selector);host.append(bar);
 const navigation=tag('nav','s9-v4-dates');navigation.setAttribute('aria-label','Recording dates');
 for(const d of dates){
  const clips=days.get(d),button=tag('button','s9-v4-date');button.type='button';
  button.setAttribute('aria-pressed',String(d===selectedDay));
  button.append(tag('strong','',d),tag('small','',clips.length+' recordings'));
  const dots=tag('span','s9-v4-date-dots');
  const found=[...new Set(clips.map(category))];
  for(const categoryId of CATEGORIES.map(x=>x[0]))if(found.includes(categoryId)){
   const dot=tag('i');dot.style.background=META[categoryId].color;dot.title=META[categoryId].label;dots.append(dot);
  }
  button.append(dots);button.onclick=()=>{selectedDay=d;limit=48;render(current);};
  navigation.append(button);
 }
 host.append(navigation);
 const legend=tag('div','s9-v4-legend');legend.setAttribute('aria-label','Recording colours legend');
 for(const [id,color,label] of CATEGORIES){
  const item=tag('span');item.style.setProperty('--s9-colour',color);
  item.append(tag('i','s9-v4-dot'),tag('span','',label));legend.append(item);
 }
 host.append(legend);
 const all=days.get(selectedDay)||[];
 const visible=all.filter(r=>selectedFilter==='all'||category(r)===selectedFilter);
 host.append(tag('p','s9-v4-count',visible.length+' matching · '+all.length+' on selected date · newest first · classifications are estimates'));
 const grid=tag('div','s9-v4-cards');host.append(grid);
 for(const r of visible.slice(0,limit))grid.append(clipCard(r));
 if(visible.length>limit){
  const more=tag('button','s9-v4-more','Show 48 more · '+(visible.length-limit)+' remaining');
  more.type='button';more.onclick=()=>{limit+=48;render(current);};host.append(more);
 }
 // Legacy cards are retained as a fallback until the signed catalog is available.
 root.classList.add('s9-curated-ready');
}
let loading=false;
async function reload(){
 if(loading)return;loading=true;
 try{
  const relay=window.C720PSecureRelay;if(!relay?.fetch)throw Error('authenticated relay unavailable');
  const r=await relay.fetch('/new/api/saved',{cache:'no-store'});
  if(!r.ok)throw Error('signed archive unavailable');
  const body=await r.json();const records=(Array.isArray(body.events)?body.events:[]).filter(x=>safe.test(nameOf(x)));
  if(!records.length)throw Error('empty signed index');
  const signature=JSON.stringify(records.map(r=>[nameOf(r),r.scene_category,r.person_event_category,r.person_count,r.content_categories,r.duration_ms,r.capture_event_id,r.capture_segment_index,r.capture_segment_gap_ms,r.thumbnail_rank_version]));
  if(signature!==reload.last){reload.last=signature;current=records.sort((a,b)=>nameOf(b).localeCompare(nameOf(a)));render(current);}
 }catch(_){
  try{
   const r=await fetch(BASE+'s9-phone-events.json?t='+Date.now(),{cache:'no-store'});
   if(!r.ok)throw Error('static catalog unavailable');
   const j=await r.json();
   const records=(Array.isArray(j.phone_recordings)?j.phone_recordings:[]).filter(x=>safe.test(nameOf(x))&&x.sd_verified===true);
   if(records.length){const signature=JSON.stringify(records.map(x=>[nameOf(x),x.scene_category,x.person_event_category]));
    if(signature!==reload.last){reload.last=signature;current=records.sort((a,b)=>nameOf(b).localeCompare(nameOf(a)));render(current);}
   }
  }catch(_){}
 }finally{loading=false;}
}
const root=document.getElementById('list');
if(root)new MutationObserver(()=>{if(current.length&&!document.getElementById(ID))render(current);}).observe(root,{childList:true});
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
        def existing(content, opening, closing):
            if content.count(opening)!=1:
                raise ValueError("unexpected_widget_opening")
            start=content.index(opening)
            end=content.find(closing,start+len(opening))
            if end<0:
                raise ValueError("widget_missing_closing")
            return content[start:end+len(closing)]
        style_open='<style id="s9-saved-virtual-folders-style-v1">'
        script_open='<script id="s9-saved-virtual-folders-script-v1">'
        old_style=existing(text,style_open,'</style>')
        old_script=existing(text,script_open,'</script>')
        new_style=existing(SNIPPET,style_open,'</style>')
        new_script=existing(SNIPPET,script_open,'</script>')
        if not all(k in old_script for k in
                   ('const native=', 'const safe=', 'function render(data)', 'function openClip(r)')):
            raise ValueError("unrecognized_existing_folder_widget")
        return text.replace(old_style,new_style,1).replace(old_script,new_script,1)
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

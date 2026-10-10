#!/usr/bin/env python3
"""Append a read-only anonymous per-recording index to the existing Security clips page."""
import argparse
import os
from pathlib import Path

STYLE_ID = 'id="s9-anonymous-clips-style-v1"'
SCRIPT_ID = 'id="s9-anonymous-clips-script-v1"'
SNIPPET = r'''
<style id="s9-anonymous-clips-style-v1">
#s9-anonymous-clips-v1{margin:16px 0;padding:14px;border:1px solid #48657a;border-radius:13px;background:#142734;color:#eef7fc}
#s9-anonymous-clips-v1 h3{margin:0 0 6px;font-size:17px}
#s9-anonymous-clips-v1 p{font-size:13px;line-height:1.5;margin:5px 0 10px;color:#c8dce8}
#s9-anonymous-clips-v1 select{font:inherit;font-size:13px;padding:6px;background:#1d3849;border:1px solid #54758b;border-radius:7px;color:#f1f8fc;max-width:100%}
#s9-anonymous-clips-v1 .s9-anon-filters{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:9px 0}
#s9-anonymous-clips-v1 .s9-anon-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:9px;margin-top:12px}
#s9-anonymous-clips-v1 .s9-anon-card{border:1px solid #3b5b71;background:#1c3443;border-radius:10px;padding:11px;min-width:0}
#s9-anonymous-clips-v1 .s9-anon-card strong{font-size:13px;overflow-wrap:anywhere}
#s9-anonymous-clips-v1 .s9-anon-muted{font-size:12px;color:#c3d7e3;margin-top:4px;overflow-wrap:anywhere}
#s9-anonymous-clips-v1 .s9-anon-people{margin:8px 0 0 16px;padding:0;color:#d6ebf5;font-size:12px;line-height:1.6}
#s9-anonymous-clips-v1 button{font:inherit;font-size:12px;border:1px solid #6b9ebd;background:#315c75;color:#fff;padding:6px 9px;border-radius:7px;margin-top:8px;cursor:pointer}
#s9-anonymous-clips-v1 button:disabled{opacity:.55;cursor:default}
#s9-anonymous-video-dialog{max-width:min(92vw,1100px);background:#102230;color:#f0f9ff;border:1px solid #66859d;border-radius:12px;padding:12px}
#s9-anonymous-video-dialog video{max-width:100%;max-height:77vh;display:block;margin:8px auto;background:#000}
#s9-anonymous-video-dialog::backdrop{background:#000d}
</style>
<script id="s9-anonymous-clips-script-v1">
(()=>{
 'use strict';
 const hostId='s9-anonymous-clips-v1';
 const colors=['black','white','gray','red','orange','yellow','green','blue','purple_or_pink','brown'];
 let lastEvents=[],filterValue='all',fetching=false;
 const relay=()=>{
  // Nested Security iframe: share ONLY the same-origin signed parent relay.
  if(window.C720PSecureRelay?.fetch)return window.C720PSecureRelay;
  try{
   if(window.parent!==window && window.parent.location.origin===location.origin &&
      window.parent.C720PSecureRelay?.fetch)return window.parent.C720PSecureRelay;
  }catch(_){}
  return null;
 };
 const parent=()=>document.getElementById('list');
 const node=(tag,text,className)=>{
  const e=document.createElement(tag);
  if(text!==undefined)e.textContent=String(text);
  if(className)e.className=className;
  return e;
 };
 const validName=name=>/^motion_[0-9]{13}[.]mp4$/.test(String(name||''));
 const displayColour=colour=>String(colour||'uncertain').replaceAll('_',' ');
 const seconds=ms=>(Math.max(0,Number(ms)||0)/1000).toFixed(1)+' s';
 function root(){
  const container=parent();if(!container)return null;
  let section=document.getElementById(hostId);
  if(!section){
   section=node('section');section.id=hostId;
   container.prepend(section);
  }
  return section;
 }
 function categoryMatches(rec,kind){
  return Array.isArray(rec.content_categories)&&rec.content_categories.includes(kind);
 }
 function include(rec){
  if(filterValue==='all')return true;
  if(filterValue==='tracked')return Number(rec.anonymous_track_count)>0;
  if(filterValue==='people')return Number(rec.person_count)>0;
  if(filterValue==='group')return rec.scene_category==='multiple_people';
  if(filterValue==='vehicle'||filterValue==='animal')return categoryMatches(rec,filterValue);
  if(filterValue.startsWith('colour:'))
   return Array.isArray(rec.anonymous_tracks) &&
    rec.anonymous_tracks.some(t=>t?.upper_clothing_colour===filterValue.slice(7));
  return true;
 }
 async function watch(name,button){
  if(!validName(name)||!relay()?.url)return;
  button.disabled=true;
  try{
   const signed=await relay().url('/new/saved/clip/'+encodeURIComponent(name));
   const dialog=node('dialog');dialog.id='s9-anonymous-video-dialog';
   const close=node('button','Close recording');
   close.type='button';close.addEventListener('click',()=>dialog.close());
   const header=node('strong',name+' · original S9+ recording');
   const video=node('video');video.controls=true;video.preload='metadata';video.playsInline=true;video.src=signed;
   const caution=node('p','Temporary IDs are estimated from sampled frames. No identity verification or continuous video annotation.');
   dialog.append(close,header,video,caution);document.body.append(dialog);
   dialog.addEventListener('close',()=>{video.pause();video.removeAttribute('src');video.load();dialog.remove()},{once:true});
   dialog.showModal();
  }catch(e){
   button.textContent='Playback unavailable';
  }finally{button.disabled=false}
 }
 function render(){
  const host=root();if(!host)return;
  const wasOpen=host.querySelector('details')?.open??true;
  host.replaceChildren();
  host.append(node('h3','S9+ anonymous tracks & clothing colours'));
  const analyzed=lastEvents.filter(e=>e.anonymous_tracking_status==='sampled_tracks_available' ||
   e.anonymous_tracking_status==='none_detected_in_sampled_frames');
  const tracked=analyzed.filter(e=>Number(e.anonymous_track_count)>0);
  host.append(node('p','Tracked clips: '+tracked.length+' · sampled without people: '+
   (analyzed.length-tracked.length)+' · not yet indexed: '+(lastEvents.length-analyzed.length)+
   '. No names, face matching or IDs carried between recordings.'));
  const details=node('details');details.open=wasOpen;
  details.append(node('summary','Browse video classifications and temporary Person IDs'));
  const filters=node('div',undefined,'s9-anon-filters');
  filters.append(node('label','Filter recordings:'));
  const sel=node('select');sel.setAttribute('aria-label','Filter S9+ anonymous recordings');
  const choices=[['all','All native clips'],['tracked','With anonymous tracks'],
   ['people','Person detected'],['group','Multiple people'],['vehicle','Vehicles'],['animal','Animals']];
  for(const colour of colors)choices.push(['colour:'+colour,'Upper clothing: '+displayColour(colour)]);
  for(const choice of choices){
   const o=node('option',choice[1]);o.value=choice[0];sel.append(o);
  }
  sel.value=filterValue;
  sel.addEventListener('change',()=>{filterValue=sel.value;render()});
  filters.append(sel);details.append(filters);
  const matched=lastEvents.filter(include);
  details.append(node('div','Showing '+Math.min(60,matched.length)+' / '+matched.length+
   ' matching recordings. Person-track totals are not counts of unique people.','s9-anon-muted'));
  const grid=node('div',undefined,'s9-anon-grid');
  for(const rec of matched.slice(0,60)){
   const name=rec.clip_no;
   if(!validName(name))continue;
   const card=node('article',undefined,'s9-anon-card');
   const score=Number(rec.person_score);
   if(rec.person_score!==null && rec.person_score!==undefined && Number.isFinite(score) &&
      score>=0 && score<=1)card.append(node('div',
       'Peak person-detector score '+Math.round(score*100)+
       '% · uncalibrated model score, not verified accuracy','s9-anon-muted'));
   const n=Number(rec.sampled_frames);
   if(Number.isInteger(n)&&n>0)card.append(node('div',
     'Reviewed '+n+' sampled frames · detection is not a continuous identity track','s9-anon-muted'));
   card.append(node('strong',rec.timestamp||'Date unavailable'));
   card.append(node('div',name,'s9-anon-muted'));
   const concurrent=Number(rec.person_count||0);
   card.append(node('div','Maximum people detected simultaneously: '+concurrent,'s9-anon-muted'));
   const status=rec.anonymous_tracking_status;
   if(status==='sampled_tracks_available'){
    card.append(node('div','Temporary tracks: '+rec.anonymous_track_count+
     ' · not necessarily distinct people','s9-anon-muted'));
    const list=node('ul',undefined,'s9-anon-people');
    for(const track of (Array.isArray(rec.anonymous_tracks)?rec.anonymous_tracks:[]).slice(0,64)){
     if(!/^Person (?:[1-9]|[1-5][0-9]|6[0-4])$/.test(String(track.id||'')))continue;
     const peak=Number(track.peak_detection_score);
     const evidence=track.peak_detection_score!==null && track.peak_detection_score!==undefined &&
       Number.isFinite(peak) && peak>=0.5 && peak<=1
       ? ' · peak model score '+peak.toFixed(3) : '';
     list.append(node('li',track.id+' · upper clothing: '+
       displayColour(track.upper_clothing_colour)+' · '+
       track.sample_count+' samples · '+seconds(track.first_sample_ms)+'–'+seconds(track.last_sample_ms)+
       evidence+' · unverified candidate'));
    }
    card.append(list);
   }else if(status==='none_detected_in_sampled_frames'){
    card.append(node('div','No people tracked in sampled frames (not proof of an empty recording).','s9-anon-muted'));
   }else{
    card.append(node('div','Anonymous tracking unavailable for this recording. Previous classifications remain intact.','s9-anon-muted'));
   }
   const btn=node('button','Watch original recording');btn.type='button';
   btn.addEventListener('click',()=>watch(name,btn));
   card.append(btn);grid.append(card);
  }
  if(!matched.length)grid.append(node('p','No matching recordings.'));
  details.append(grid);
  host.append(details);
 }
 async function refresh(){
  if(fetching)return;
  if(!relay()?.fetch){
   const section=root();
   if(section && !section.querySelector('.s9-relay-warning'))
    section.append(node('p','Signed camera relay unavailable in this frame. Open in Home Assistant.','s9-relay-warning'));
   return;
  }
  fetching=true;
  try{
   const result=await relay().fetch('/new/api/saved',{cache:'no-store'});
   if(!result.ok)throw Error('saved_clips_unavailable');
   const body=await result.json();
   if(body.archive_mode!=='S9-microSD-only'||!Array.isArray(body.events))throw Error('invalid_catalogue');
   lastEvents=body.events.filter(e=>validName(e.clip_no));
   render();
  }catch(e){
   const section=root();
   if(section && !lastEvents.length)section.replaceChildren(node('h3','S9+ anonymous tracks'),node('p','Security archive unavailable. No camera changes were made.'));
  }finally{fetching=false}
 }
 const observer=new MutationObserver(()=>{if(!document.getElementById(hostId)&&parent())render()});
 if(parent())observer.observe(parent(),{childList:true});
 window.addEventListener('pageshow',refresh);
 setTimeout(refresh,1400);
 setInterval(()=>{if(!document.hidden)refresh()},60000);
})();
</script>
'''

def patch_text(html: str) -> str:
    if STYLE_ID in html and SCRIPT_ID in html:
        return html
    if (STYLE_ID in html) != (SCRIPT_ID in html):
        raise ValueError("incomplete_anonymous_tracking_panel")
    if html.count("</body>") != 1 or 'c720p-s9-phone-clips-ui-v1' not in html:
        raise ValueError("unrecognized_security_page_layout")
    return html.replace("</body>", SNIPPET + "\n</body>", 1)

if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("html",type=Path)
    args=parser.parse_args()
    old=args.html.read_text()
    new=patch_text(old)
    if old==new:
        print("S9_ANONYMOUS_PANEL_ALREADY_PRESENT")
    else:
        temp=args.html.with_suffix(".html.anon-stage")
        temp.write_text(new)
        os.chmod(temp,args.html.stat().st_mode & 0o777)
        os.replace(temp,args.html)
        print("S9_ANONYMOUS_PANEL_PATCHED")

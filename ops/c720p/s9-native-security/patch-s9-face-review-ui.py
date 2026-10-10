#!/usr/bin/env python3
"""Idempotent Security page integration for on-device S9 face review results."""
import re

STYLE='id="s9-face-review-style-v1"'
SCRIPT='id="s9-face-review-script-v1"'
SNIPPET=r"""
<style id="s9-face-review-style-v1">
#s9-face-review{margin:15px 0;padding:15px;border:1px solid #62798b;border-radius:12px;background:#152a38;color:#ebf4f9}
#s9-face-review h3{font-size:18px;margin:0 0 8px}
#s9-face-review p{font-size:13px;line-height:1.5;color:#c7dbe6}
#s9-face-review .s9-face-list{display:grid;gap:9px;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))}
#s9-face-review article{padding:11px;background:#1c3544;border:1px solid #446273;border-radius:9px;font-size:13px}
#s9-face-review .s9-face-muted{font-size:12px;color:#bdcfdb}
</style>
<section id="s9-face-review" aria-label="S9 face review">
  <h3>S9+ face snapshots and candidate identities</h3>
  <p>Processed on the S9+ microSD. Name and recurring anonymous-ID matches are unverified similarity suggestions. The original recordings remain available above. No face embedding or cropped face image is copied to this hub.</p>
  <div id="s9-face-review-summary" aria-live="polite">Loading phone-local review metadata…</div>
  <div class="s9-face-list" id="s9-face-review-entries"></div>
</section>
<script id="s9-face-review-script-v1">
(()=>{
 'use strict';
 const el=id=>document.getElementById(id);
 const make=(tag,value,cls)=>{
   const n=document.createElement(tag);
   if(value!==undefined)n.textContent=String(value);
   if(cls)n.className=cls;
   return n;
 };
 async function refresh(){
  const relay=window.C720PSecureRelay;
  const summary=el('s9-face-review-summary'),list=el('s9-face-review-entries');
  if(!summary||!list)return;
  if(!relay||typeof relay.fetch!=='function'){
   summary.textContent='Authenticated Security archive is unavailable';return;
  }
  try{
   const response=await relay.fetch('/new/api/saved',{cache:'no-store'});
   if(!response.ok)throw Error('security_archive_unavailable');
   const json=await response.json();
   if(json.archive_mode!=='S9-microSD-only'||!Array.isArray(json.events))throw Error('invalid_archive_response');
   const clips=json.events.filter(x=>/^motion_[0-9]{13}[.]mp4$/.test(String(x.clip_no||'')));
   const reviewed=clips.filter(x=>x.face_review_status&&x.face_review_status!=='not_available_in_original_review');
   const withFaces=reviewed.filter(x=>Array.isArray(x.face_candidates)&&x.face_candidates.length);
   summary.textContent=reviewed.length+' / '+clips.length+' S9+ clips have face-review metadata; '+
     withFaces.length+' include saved frontal-face snapshots. These counts are not unique people.';
   list.replaceChildren();
   for(const rec of withFaces.slice(0,35)){
    const card=make('article');
    card.append(make('strong',String(rec.timestamp||rec.clip_no)));
    const entries=rec.face_candidates.slice(0,8);
    for(const entry of entries){
     const id=typeof entry.person_id==='string'?entry.person_id:'unnamed snapshot';
     const label=typeof entry.candidate_name==='string'?entry.candidate_name+' (candidate)':'Anonymous '+id;
     const time=Number.isFinite(Number(entry.time_ms))?(Number(entry.time_ms)/1000).toFixed(1)+'s':'';
     card.append(make('div',label+' · '+time));
     card.append(make('div',String(entry.match_status||'unverified').replaceAll('_',' '),'s9-face-muted'));
    }
    card.append(make('div','Snapshots stored on S9+ microSD · original clip retained','s9-face-muted'));
    list.append(card);
   }
   if(!withFaces.length)list.append(make('p','No frontal face snapshots indexed yet. Existing person detection and videos are unaffected.'));
  }catch(error){
   summary.textContent='Face-review metadata could not be loaded; original clip playback is unchanged.';
  }
 }
 refresh();
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
 window.setInterval(()=>{if(!document.hidden)refresh();},90000);
})();
</script>
"""

def patch_text(html):
 if '</body>' not in html or 'c720p-s9-phone-clips-ui-v1' not in html:
  raise ValueError('unrecognized_Security_clips_page')
 existing=re.findall(r'<script id="s9-face-review-script-v1">.*?</script>',html,re.S)
 expected=re.findall(r'<script id="s9-face-review-script-v1">.*?</script>',SNIPPET,re.S)
 if len(existing)>1 or len(expected)!=1:raise ValueError('multiple_or_missing_face_review_scripts')
 if existing:
  if STYLE not in html or 'id="s9-face-review"' not in html:raise ValueError('partial_face_review_install')
  old=re.findall(r'<style id="s9-face-review-style-v1">.*?</style>.*?<script id="s9-face-review-script-v1">.*?</script>',html,re.S)
  new=re.findall(r'<style id="s9-face-review-style-v1">.*?</style>.*?<script id="s9-face-review-script-v1">.*?</script>',SNIPPET,re.S)
  if len(old)!=1 or len(new)!=1:raise ValueError('invalid_face_review_block')
  return html.replace(old[0],new[0],1)
 if STYLE in html or 'id="s9-face-review"' in html:raise ValueError('partial_face_review_install')
 return html.replace('</body>',SNIPPET+'\n</body>',1)

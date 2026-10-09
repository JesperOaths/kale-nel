#!/usr/bin/env python3
"""Add a standalone, SD-only still-evidence gallery to existing HA Security clips."""
from pathlib import Path

MARKER = 'id="s9-fallback-gallery-v1"'
SNIPPET = r'''
<style id="s9-fallback-gallery-v1">
#s9-fallback-section{margin:16px 0;padding:12px;border:1px solid #344658;border-radius:14px;background:#12212c}
#s9-fallback-section .s9-fallback-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:10px;margin-top:10px}
#s9-fallback-section .s9-fallback-card{border:1px solid #375166;border-radius:10px;color:#eaf5fa;background:#162b39;overflow:hidden;cursor:pointer;text-align:left;padding:0}
#s9-fallback-section .s9-fallback-card img{width:100%;aspect-ratio:4/3;object-fit:contain;background:#050b11;display:block}
#s9-fallback-section .s9-fallback-label{padding:8px;font-size:12px;line-height:1.45}
#s9-fallback-section .s9-fallback-muted{color:#bdd0dc;font-size:12px;margin-top:5px}
#s9-fallback-detail{background:#0b1621;color:#eaf5fa;border:1px solid #56728a;border-radius:14px;max-width:min(90vw,850px);padding:12px}
#s9-fallback-detail::backdrop{background:#000c}
#s9-fallback-detail img{display:block;max-width:100%;max-height:75vh;object-fit:contain;margin:8px auto}
</style>
<script id="s9-fallback-gallery-script-v1">
(()=>{
 'use strict';
 const SECTION_ID='s9-fallback-section';
 let evidence=[],refreshing=false;
 const root=()=>document.getElementById('list');
 const relay=()=>window.C720PSecureRelay;
 const escapeName=name=>encodeURIComponent(String(name||''));
 const reasons={
  recording_budget_rejected:'4K recording budget reached',
  cooldown_motion:'Movement during recording cooldown',
  thermal_or_space_guard:'Recording prevented by thermal/storage safety',
  recording_safety_guard:'Recording prevented by safety guard',
  motion_event:'Motion evidence'
 };
 function detail(rec,url){
  const d=document.createElement('dialog');
  d.id='s9-fallback-detail';
  const close=document.createElement('button');
  close.type='button';close.textContent='Close image';close.addEventListener('click',()=>d.close());
  const h=document.createElement('strong');
  h.textContent='Still image only · '+(rec.timestamp||'');
  const img=document.createElement('img');img.alt='MicroSD-only motion preview';img.src=url;
  const note=document.createElement('p');
  note.textContent=(reasons[rec.reason]||'Motion evidence')+
   ' · 640 × 480 · Not a video · Person identity not evaluated';
  d.append(close,h,img,note);document.body.append(d);
  d.addEventListener('close',()=>d.remove(),{once:true});
  d.showModal();
 }
 async function render(){
  const list=root();if(!list)return;
  let section=document.getElementById(SECTION_ID);
  if(!section){section=document.createElement('section');section.id=SECTION_ID;list.append(section)}
  section.replaceChildren();
  const heading=document.createElement('div');
  heading.className='s9phone-header';heading.textContent='S9+ motion preview evidence · '+evidence.length;
  const info=document.createElement('div');info.className='s9-fallback-muted';
  info.textContent='Images recorded when a full 4K video could not be started. The originals remain on the S9+ microSD. Not classified as people or video.';
  section.append(heading,info);
  if(!evidence.length){
   const empty=document.createElement('div');empty.className='s9-fallback-muted';
   empty.textContent='No fallback still images have been recorded.';section.append(empty);
   return;
  }
  const grid=document.createElement('div');grid.className='s9-fallback-grid';section.append(grid);
  for(const rec of evidence.slice(0,40)){
   if(!/^preview_motion_[0-9]{13}\.jpg$/.test(String(rec.name||'')))continue;
   if(rec.kind!=='preview_only_motion_evidence'||rec.person_status!=='not_evaluated')continue;
   const card=document.createElement('button');card.type='button';card.className='s9-fallback-card';
   const label=document.createElement('div');label.className='s9-fallback-label';
   const when=document.createElement('strong');when.textContent=rec.timestamp||'Timestamp unavailable';
   const reason=document.createElement('div');reason.className='s9-fallback-muted';
   reason.textContent=reasons[rec.reason]||'Motion evidence';
   const kind=document.createElement('div');kind.className='s9-fallback-muted';
   kind.textContent='Still JPEG · not person-identified';
   label.append(when,reason,kind);card.append(label);grid.append(card);
   try{
    const signed=await relay().url('/new/saved/still/'+escapeName(rec.name));
    const image=document.createElement('img');image.alt='Motion preview (not classified)';image.loading='lazy';
    image.src=signed;card.insertBefore(image,label);
    card.addEventListener('click',()=>detail(rec,signed));
   }catch(_){card.disabled=true;kind.textContent='Preview not reachable';}
  }
  if(evidence.length>40){
   const rest=document.createElement('div');rest.className='s9-fallback-muted';
   rest.textContent='Showing the latest 40 of '+evidence.length+' preview images.';
   section.append(rest);
  }
 }
 async function refresh(){
  if(refreshing||!relay()?.fetch)return;
  refreshing=true;
  try{
   const res=await relay().fetch('/new/api/saved',{cache:'no-store'});
   if(!res.ok)throw new Error('Archive unavailable');
   const data=await res.json();
   if(data.archive_mode!=='S9-microSD-only')return;
   evidence=Array.isArray(data.fallback_previews)?data.fallback_previews:[];
   await render();
  }catch(_){/* Existing Security access and video views remain unaffected. */}
  finally{refreshing=false}
 }
 const observer=new MutationObserver(()=>{
  if(!document.getElementById(SECTION_ID)&&root()&&relay()?.fetch)render();
 });
 if(root())observer.observe(root(),{childList:true});
 window.addEventListener('pageshow',refresh);
 setInterval(()=>{if(!document.hidden)refresh()},45000);
 setTimeout(refresh,1400);
})();
</script>
'''

def patch_text(html: str) -> str:
    if MARKER in html and 'id="s9-fallback-gallery-script-v1"' in html:
        return html
    if html.count("</body>") != 1 or "c720p-s9-phone-clips-ui-v1" not in html:
        raise ValueError("Unknown Security HTML layout; refusing to patch")
    return html.replace("</body>", SNIPPET + "\n</body>", 1)

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("file", type=Path)
    args = p.parse_args()
    original = args.file.read_text()
    updated = patch_text(original)
    if updated != original:
        temp = args.file.with_suffix(".html.s9tmp")
        temp.write_text(updated)
        temp.chmod(args.file.stat().st_mode & 0o777)
        temp.replace(args.file)
        print("S9_FALLBACK_UI_PATCHED")
    else:
        print("S9_FALLBACK_UI_PRESENT")

#!/usr/bin/env python3
"""Idempotent Home Assistant Security tab patch; no camera or API changes."""
import re

MARKER="S9_SECURITY_FACES_TAB_V1"
URL="/local/frontyard-security-new/face-appearances.html"

def patch(html):
    if MARKER in html:
        if html.count('id="panel-faces"')!=1 or html.count('id="s9FacesGalleryFrame"')!=1:
            raise ValueError("partial_faces_tab")
        return html
    if html.count('</body>')!=1 or html.count('data-tab="saved"')!=1 or html.count('id="panel-saved"')!=1:
        raise ValueError("unexpected_security_tab_structure")
    button=re.search(r'<button\b[^>]*data-tab="saved"[^>]*>.*?</button>',html,re.S)
    panel=re.search(r'<section\b(?=[^>]*id="panel-saved")[^>]*>',html)
    if not button or not panel:raise ValueError("tab_structure_not_found")
    link='<button type="button" class="tab" data-tab="faces" aria-selected="false">Faces &amp; appearances</button>'
    html=html[:button.end()]+link+html[button.end():]
    panel=re.search(r'<section\b(?=[^>]*id="panel-saved")[^>]*>',html)
    frame='<section class="panel" id="panel-faces" hidden><iframe id="s9FacesGalleryFrame" title="S9+ faces and appearance sightings" data-src="'+URL+'" loading="lazy" style="width:100%;height:calc(100vh - 190px);min-height:500px;border:0"></iframe></section>'
    html=html[:panel.start()]+frame+html[panel.start():]
    script="""<script id="s9-faces-tab-nav-v1">(()=>{
const tab=document.querySelector('[data-tab="faces"]'),panel=document.getElementById('panel-faces'),frame=document.getElementById('s9FacesGalleryFrame');
if(!tab||!panel||!frame)return;
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-tab]');if(!b)return;
 const on=b.dataset.tab==='faces';
 queueMicrotask(()=>{
  const panels=[...document.querySelectorAll('section.panel')];
  if(on){
   if(!frame.src)frame.src=frame.dataset.src;
   for(const p of panels)p.style.setProperty('display',p===panel?'block':'none','important');
   panel.hidden=false;tab.classList.add('active');tab.setAttribute('aria-selected','true');
  }else{
   for(const p of panels)p.style.removeProperty('display');
   panel.style.display='none';panel.hidden=true;
   tab.classList.remove('active');tab.setAttribute('aria-selected','false');
  }
 });
});
})();</script>"""
    return html.replace('</body>','<!-- '+MARKER+' -->'+script+'</body>',1)

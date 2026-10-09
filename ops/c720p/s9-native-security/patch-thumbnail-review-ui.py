#!/usr/bin/env python3
"""Idempotent Security-page patch: private human labeling of individual thumbnails."""
from pathlib import Path

MARKER='id="s9-human-thumbnail-review-v1"'
SNIPPET=r'''
<style id="s9-human-thumbnail-review-v1">
#s9-human-review{margin:18px 0;border:1px solid #34586e;border-radius:14px;background:#10212e;padding:12px;color:#e5f5ff}
#s9-human-review summary{cursor:pointer;font-size:15px;font-weight:850;color:#e1f5ff}
#s9-human-review .review-note{color:#b7cbd6;font-size:12px;line-height:1.5;margin:9px 0}
#s9-human-review .review-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(228px,1fr));gap:12px;margin:12px 0}
#s9-human-review .review-card{border:1px solid #355367;border-radius:12px;overflow:hidden;background:#172d3c;min-width:0}
#s9-human-review .review-card img{display:block;width:100%;aspect-ratio:16/10;object-fit:contain;background:#080f16}
#s9-human-review .review-card-body{padding:11px}
#s9-human-review .review-meta{font-size:12px;color:#b5cad5;line-height:1.6;word-break:break-word}
#s9-human-review .review-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:10px}
#s9-human-review .review-actions button{padding:9px 7px;border-radius:8px;background:#26445b;color:#eaffff;border:1px solid #5c849b;font-size:12px;font-weight:750;cursor:pointer}
#s9-human-review .review-actions button[aria-pressed=true]{background:#206f73;border-color:#9cf7ec}
#s9-human-review .review-actions button:disabled{opacity:.5;cursor:not-allowed}
#s9-human-review .review-status{font-size:12px;margin-top:10px;min-height:16px;color:#d5e8f0}
#s9-human-review .review-summary{font-size:13px;margin:10px 0;padding:9px 10px;border-radius:8px;background:#183243}
#s9-human-review .review-rates{font-size:12px;margin:8px 0;line-height:1.6}
</style>
<script id="s9-human-thumbnail-review-script-v1">
(()=>{
'use strict';
const ID='s9-human-review';
const ROOT='/local/frontyard-security-new/';
let latest=null,inFlight=false;
const list=()=>document.getElementById('list');
const relay=()=>window.C720PSecureRelay;
const safeName=n=>/^motion_[0-9]{13}\.mp4$/.test(String(n||''));
const choices=[
  ['person_visible','Person visible'],
  ['no_person_visible','No person visible'],
  ['uncertain','Uncertain'],
  ['clear','Clear label']
];
function t(tag,cls,content){
 const e=document.createElement(tag);
 if(cls)e.className=cls;
 if(content!==undefined)e.textContent=content;
 return e;
}
function render(){
 const root=list();
 if(!root || !latest)return;
 let details=document.getElementById(ID);
 const wasOpen=details?.open ?? false;
 if(!details){details=document.createElement('details');details.id=ID;root.append(details);}
 details.replaceChildren();
 details.open=wasOpen;
 const stats=latest.counts||{};
 const seen=(stats.person_visible||0)+(stats.no_person_visible||0)+(stats.uncertain||0);
 details.append(t('summary','', 'Check person detection · '+seen+'/'+latest.total+' thumbnails reviewed'));
 details.append(t('p','review-note',
   'Label ONLY what is visible in each thumbnail, not what may appear elsewhere in its video. Choose Uncertain for darkness, blur or ambiguity. Review labels are independent of AI predictions and stored privately on the hub.'));
 const counters=t('div','review-summary',
   'Visible person: '+(stats.person_visible||0)+
   ' · No person: '+(stats.no_person_visible||0)+
   ' · Uncertain: '+(stats.uncertain||0)+
   ' · Pending: '+(stats.unreviewed||0));
 details.append(counters);
 const metrics=latest.metrics||{};
 const msg=t('div','review-rates');
 const s=metrics.ssd||{},l=metrics.lite0||{};
 const enough=s.sufficient_to_display_rates&&l.sufficient_to_display_rates;
 msg.textContent=enough ?
   'Preliminary comparison on human-labeled thumbnails (SSD vs Lite0, 50% threshold): '+
   'SSD recall '+Math.round((s.recall||0)*100)+'%, false positive rate '+Math.round((s.false_positive_rate||0)*100)+
   '% · Lite0 recall '+Math.round((l.recall||0)*100)+'%, false positive rate '+Math.round((l.false_positive_rate||0)*100)+
   '%. These are biased thumbnail-sample figures, NOT validated garden-wide accuracy.'
   :'Accuracy rates are withheld until at least 5 confirmed person thumbnails and 5 confirmed no-person thumbnails have matching, hash-verified model predictions.';
 details.append(msg);
 const cards=t('div','review-cards');
 for(const item of latest.images||[]){
  if(!safeName(item.name)||!/^s9-phone-thumbs\/motion_[0-9]{13}\.mp4\.thumb\.jpg$/.test(item.thumbnail||''))continue;
  const card=t('article','review-card');
  const image=document.createElement('img');
  image.src=ROOT+item.thumbnail;image.alt='Single native 4K clip thumbnail for manual review';image.loading='lazy';
  const body=t('div','review-card-body');
  body.append(t('strong','',item.timestamp||'Timestamp unknown'));
  body.append(t('div','review-meta','Original clip: '+item.name));
  const scores=item.person_scores||{};
  body.append(t('div','review-meta','AI scores, not truth: SSD '+(Number.isFinite(scores.ssd)?Math.round(scores.ssd*100)+'%':'not evaluated')+
    ' · Lite0 '+(Number.isFinite(scores.lite0)?Math.round(scores.lite0*100)+'%':'not evaluated')));
  body.append(t('div','review-meta','Human label: '+(item.human_label||'not reviewed')));
  const buttons=t('div','review-actions');
  const status=t('div','review-status');
  for(const [value,label] of choices){
   const button=t('button','',label);
   button.type='button';
   button.setAttribute('aria-pressed',item.human_label===value?'true':'false');
   button.addEventListener('click',async()=>{
    if(inFlight||!relay()?.fetch){status.textContent='Authenticated Security relay unavailable';return;}
    inFlight=true;
    for(const b of buttons.querySelectorAll('button'))b.disabled=true;
    status.textContent='Saving review label…';
    try{
     const res=await relay().fetch('/new/api/thumbnail-review',{
      method:'POST',cache:'no-store',
      headers:{'Content-Type':'application/json','X-S9-Review-Intent':'human-thumbnail-v1'},
      body:JSON.stringify({name:item.name,sha256:item.sha256,label:value})});
     const data=await res.json();
     if(!res.ok||!data.ok)throw Error(data.error||('HTTP '+res.status));
     details.open=true;
     status.textContent='Saved';
     await refresh();
    }catch(e){
     status.textContent='Not saved: '+String(e.message||e);
     for(const b of buttons.querySelectorAll('button'))b.disabled=false;
    }finally{inFlight=false;}
   });
   buttons.append(button);
  }
  body.append(buttons,status);card.append(image,body);cards.append(card);
 }
 details.append(cards);
}
async function refresh(){
 if(inFlight || !relay()?.fetch)return;
 try{
  const res=await relay().fetch('/new/api/thumbnail-review',{cache:'no-store'});
  if(!res.ok)throw Error('HTTP '+res.status);
  const data=await res.json();
  if(data.ok!==true || data.scope!=='visible_content_of_single_thumbnail_not_entire_video')return;
  latest=data;render();
 }catch(_){/* Never interfere with live preview or existing clips. */}
}
const observer=new MutationObserver(()=>{if(latest&&list()&&!document.getElementById(ID))render();});
if(list())observer.observe(list(),{childList:true});
window.addEventListener('pageshow',refresh);
setInterval(()=>{if(!document.hidden)refresh()},60000);
setTimeout(refresh,1800);
})();
</script>
'''
def patch_text(html):
    if MARKER in html and 'id="s9-human-thumbnail-review-script-v1"' in html:
        return html
    if html.count('</body>')!=1 or 'c720p-s9-phone-clips-ui-v1' not in html:
        raise ValueError("unknown_Security_clips_layout")
    return html.replace('</body>',SNIPPET+'\n</body>',1)

if __name__=="__main__":
    import argparse,os
    p=argparse.ArgumentParser();p.add_argument("file",type=Path);f=p.parse_args().file
    before=f.read_text();after=patch_text(before)
    if after!=before:
        tmp=f.with_suffix(".html.s9review-stage")
        tmp.write_text(after);os.chmod(tmp,f.stat().st_mode&0o777);os.replace(tmp,f)
        print("S9_REVIEW_UI_ADDED")
    else:print("S9_REVIEW_UI_ALREADY_PRESENT")

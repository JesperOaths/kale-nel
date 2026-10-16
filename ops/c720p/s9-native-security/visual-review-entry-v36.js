/* Shared manual-folder entry for archive and recordings; playback stays isolated. */
(()=>{'use strict';
function api(){try{return window.C720PSecureRelay||window.parent.C720PSecureRelay}catch(_){return null}}
const host=document.querySelector('.heading .controls,.panelhead .actions,header .actions,.heading')||document.body;
const label=document.createElement('label');label.textContent='Review folder ';label.style.fontSize='13px';
const select=document.createElement('select');select.setAttribute('aria-label','Filter recordings by manual review folder');select.append(new Option('All archive recordings',''),new Option('Unassigned 4K views','unreviewed'));label.append(select);
const button=document.createElement('button');button.type='button';button.textContent='Review people';button.style.marginLeft='8px';host.append(label,button);
const dialog=document.createElement('dialog');dialog.style.cssText='width:96vw;height:94vh;max-width:1500px;max-height:96vh;padding:10px;background:#10151b;color:#e7edf4;border:1px solid #607a8c;border-radius:12px';
const close=document.createElement('button');close.type='button';close.textContent='Back to recordings';close.style.cssText='padding:9px;margin-bottom:8px;background:#243746;color:inherit;border:1px solid #668296;border-radius:8px';
const iframe=document.createElement('iframe');iframe.title='Manual 4K recording review';iframe.style.cssText='display:block;width:100%;height:calc(100% - 48px);border:0';dialog.append(close,iframe);document.body.append(dialog);
function open(){iframe.src='/local/frontyard-security-new/visual-review-v36.html?v=39'+(select.value?'&folder='+encodeURIComponent(select.value):'');dialog.showModal()}
close.onclick=()=>dialog.close();dialog.onclose=()=>{iframe.src='about:blank';select.value=''};button.onclick=open;select.onchange=()=>{if(select.value)open()};
let attempts=0;const timer=setInterval(async()=>{attempts++;try{const connection=api();if(!connection)return;const response=await connection.fetch('/new/api/visual-review?limit=1',{cache:'no-store'});const data=await response.json();if(!data.ok)return;for(const folder of data.folders)select.add(new Option(folder.label,folder.id));clearInterval(timer);}catch(_){}finally{if(attempts>=20)clearInterval(timer)}},1000);
})();

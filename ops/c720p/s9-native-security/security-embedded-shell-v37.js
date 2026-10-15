/* Embedded tabs keep their filters when the outer Refresh button is used. */
(()=>{'use strict';
if(window.parent===window)return;
try{if(!window.parent.document.getElementById('s9v5-shell'))return;}catch(_){return;}
document.body.dataset.securityEmbedded='true';
const heading=document.querySelector('body > header, main > header, main > .wrap > header');
if(heading){const title=heading.querySelector('h1'),refresh=heading.querySelector('#refresh');if(title)title.hidden=true;if(refresh)refresh.hidden=true;}
window.addEventListener('message',event=>{
 if(event.source!==window.parent||event.origin!==location.origin)return;
 if(event.data?.kind==='security-tab-refresh-v37'){
  const drive=document.getElementById('driveTab')?.getAttribute('aria-selected')==='true';
  document.getElementById(drive?'driveRefresh':'refresh')?.click();
 }
 if(event.data?.kind==='security-tab-visibility-v37')window.SecurityTabActive=event.data.active===true;
});
window.parent.postMessage({kind:'security-tab-ready-v37'},location.origin);
})();

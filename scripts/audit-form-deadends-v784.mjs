#!/usr/bin/env node
import { chromium } from 'playwright';

const base='https://kalenel.nl';
const routes=[
  '/', '/scorer.html', '/klaverjas_live.html', '/klaverjas_online.html', '/toepen.html', '/beerpong.html',
  '/boerenbridge.html', '/boerenbridge_live.html', '/pikken.html', '/pikken_live.html', '/paardenrace.html',
  '/paardenrace_live.html', '/drinks.html', '/drinks_add.html', '/drinks_pending.html', '/drinks_history.html',
  '/drinks_speed.html', '/despimarkt.html', '/beurs.html', '/rad.html', '/profiles.html', '/my_profile.html',
  '/login.html', '/request.html', '/activate.html', '/familie/index.html', '/familie/login.html',
  '/familie/scorer.html', '/familie/leaderboard.html'
];
const viewports=[['phone',390,844],['desktop',1366,768]];
const browser=await chromium.launch({headless:true});
let blockedWrites=0;
const rows=[];

const normalize=s=>String(s||'').replace(/\s+/g,' ').trim();
async function audit(path,label,width,height){
  const context=await browser.newContext({viewport:{width,height},locale:'nl-NL',serviceWorkers:'block'});
  await context.addInitScript(()=>{
    const orig=EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener=function(type,listener,options){
      try{if(this instanceof Element){const existing=(this.getAttribute('data-v784-listeners')||'').split(',').filter(Boolean);if(!existing.includes(type)){existing.push(type);this.setAttribute('data-v784-listeners',existing.join(','));}}}catch{}
      return orig.call(this,type,listener,options);
    };
  });
  await context.route('**/*',async route=>{
    const req=route.request();let url;try{url=new URL(req.url());}catch{return route.continue();}
    if(url.hostname==='kalenel.nl'&&/\/gejast-home-gate\.js$/i.test(url.pathname))return route.fulfill({status:200,contentType:'application/javascript',body:"document.documentElement.classList.remove('gejast-auth-pending');document.documentElement.classList.add('gejast-auth-ready');window.GEJAST_HOME_GATE={audit:true};"});
    if(url.hostname==='kalenel.nl'&&/\/gejast-config\.js$/i.test(url.pathname)){const upstream=await route.fetch();const body=await upstream.text();return route.fulfill({response:upstream,contentType:'application/javascript',body:`${body}\n;window.GEJAST_CONFIG=window.GEJAST_CONFIG||{};window.GEJAST_CONFIG.requireMatchEntrySession=function(){return true;};window.GEJAST_CONFIG.ensurePlayerSessionOrRedirect=function(){return true;};`});}
    if(req.isNavigationRequest()&&url.hostname==='kalenel.nl'&&path!=='/login.html'&&path!=='/familie/login.html'&&(/\/login\.html$/i.test(url.pathname)||url.pathname==='/login'))return route.abort('aborted');
    if(!['GET','HEAD'].includes(req.method())){blockedWrites++;return route.fulfill({status:200,contentType:'application/json',body:'[]'});}
    return route.continue();
  });
  const page=await context.newPage();
  const pageErrors=[];page.on('pageerror',e=>pageErrors.push(normalize(e?.message||e)));
  try{await page.goto(`${base}${path}?v784_audit=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});}catch{}
  await page.waitForTimeout(1200);
  const result=await page.evaluate(()=>{
    const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0;};
    const text=el=>(el.getAttribute('aria-label')||el.textContent||el.value||'').replace(/\s+/g,' ').trim().slice(0,160);
    const hrefInfo=[...document.querySelectorAll('a[href]')].filter(visible).map(a=>({text:text(a),href:a.getAttribute('href')||'',onclick:typeof a.onclick==='function',listeners:a.getAttribute('data-v784-listeners')||'',role:a.getAttribute('role')||''}));
    const suspiciousLinks=hrefInfo.filter(x=>/^\s*(?:#|javascript:|$)/i.test(x.href));
    const buttons=[...document.querySelectorAll('button,input[type=button],input[type=submit],input[type=reset],[role=button]')].filter(visible).map(b=>({tag:b.tagName.toLowerCase(),id:b.id||'',text:text(b),disabled:!!b.disabled||b.getAttribute('aria-disabled')==='true',type:b.getAttribute('type')||'',title:b.getAttribute('title')||'',onclick:typeof b.onclick==='function',listeners:b.getAttribute('data-v784-listeners')||''}));
    const disabled=buttons.filter(b=>b.disabled);
    const potentiallyUnwired=buttons.filter(b=>!b.disabled&&b.tag!=='input'&&b.type!=='submit'&&b.type!=='reset'&&!b.onclick&&!b.listeners.includes('click'));
    const statusEls=[...document.querySelectorAll('[role=status],[role=alert],[aria-live],.status,.error,.message,.msg,.notice,.feedback')].filter(visible);
    const forms=[...document.forms].filter(visible).map(f=>{const submits=[...f.querySelectorAll('button[type=submit],input[type=submit],button:not([type])')].filter(visible);const required=[...f.querySelectorAll('[required]')].filter(visible);const localStatus=[...f.querySelectorAll('[role=status],[role=alert],[aria-live],.status,.error,.message,.msg,.notice,.feedback')].filter(visible);return{id:f.id||'',action:f.getAttribute('action')||'',method:(f.getAttribute('method')||'get').toLowerCase(),submitCount:submits.length,requiredCount:required.length,localStatusCount:localStatus.length,onsubmit:typeof f.onsubmit==='function',listeners:f.getAttribute('data-v784-listeners')||''};});
    const loading=[...document.querySelectorAll('body *')].filter(el=>visible(el)&&el.children.length===0&&/^(?:laden|loading|bezig|even geduld|ophalen|initialiseren)(?:\.{0,3}|…)?$/i.test((el.textContent||'').trim())).map(el=>({tag:el.tagName.toLowerCase(),id:el.id||'',cls:String(el.className||'').slice(0,100),text:(el.textContent||'').trim()}));
    const dialogs=[...document.querySelectorAll('dialog,[role=dialog],[aria-modal=true]')].filter(visible).map(d=>{const exits=[...d.querySelectorAll('button,a,[role=button]')].filter(visible).filter(el=>/(sluit|close|terug|annuleer|cancel|×|✕|klaar)/i.test(text(el)));return{id:d.id||'',text:text(d),exitCount:exits.length};});
    const busy=[...document.querySelectorAll('[aria-busy=true]')].filter(visible).map(el=>({tag:el.tagName.toLowerCase(),id:el.id||'',text:text(el)}));
    const usableNav=hrefInfo.filter(x=>!/^\s*(?:#|javascript:|$)/i.test(x.href)).length+buttons.filter(b=>!b.disabled).length;
    return{url:location.href,title:document.title,suspiciousLinks,disabled,potentiallyUnwired,forms,statusCount:statusEls.length,loading,dialogs,busy,usableNav,bodyText:(document.body?.innerText||'').trim().slice(0,160)};
  });
  const row={path,viewport:label,pageErrors,result};rows.push(row);console.log(`DEADEND ${label} ${path} ${JSON.stringify(row)}`);await context.close();
}
for(const [label,w,h] of viewports)for(const route of routes)await audit(route,label,w,h);
await browser.close();
const interesting=rows.filter(r=>r.pageErrors.length||r.result.suspiciousLinks.length||r.result.loading.length||r.result.dialogs.some(d=>d.exitCount===0)||r.result.busy.length||r.result.usableNav===0||r.result.forms.some(f=>f.submitCount>0&&f.localStatusCount===0&&r.result.statusCount===0)||r.result.potentiallyUnwired.length);
const summary={combinations:rows.length,interesting:interesting.length,blockedWrites,findings:interesting.map(r=>({path:r.path,viewport:r.viewport,pageErrors:r.pageErrors,suspiciousLinks:r.result.suspiciousLinks,unwired:r.result.potentiallyUnwired,forms:r.result.forms,loading:r.result.loading,dialogs:r.result.dialogs,busy:r.result.busy,usableNav:r.result.usableNav}))};
console.log('V784_DEADEND_SUMMARY='+JSON.stringify(summary));
if(blockedWrites===0)throw new Error('v784 audit did not demonstrate non-GET interception');

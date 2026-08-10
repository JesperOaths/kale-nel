#!/usr/bin/env node
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require=createRequire(import.meta.url);
const axeSource=fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8');
const base='https://kalenel.nl';
const targets=[
  {key:'home_friends',url:'/index.html',width:390,height:844},
  {key:'home_family',url:'/index.html?scope=family',width:390,height:844},
  {key:'scorer',url:'/klaverjas_scorer_v596_repo_ready.html',width:390,height:844},
  {key:'bridge_live',url:'/boerenbridge_live.html',width:390,height:844},
  {key:'race_spectator',url:'/paardenrace_spectator.html',width:390,height:844},
  {key:'drinks_add',url:'/drinks_add.html',width:390,height:844},
  {key:'activate',url:'/activate.html',width:390,height:844},
  {key:'rad',url:'/rad.html',width:390,height:844}
];
const browser=await chromium.launch({headless:true});
const out={version:'v784-live-diagnostic',pages:{},blockedWrites:0};
const trunc=(v,n=400)=>String(v||'').replace(/\s+/g,' ').trim().slice(0,n);

for(const t of targets){
  const context=await browser.newContext({viewport:{width:t.width,height:t.height},locale:'nl-NL',serviceWorkers:'block'});
  await context.route('**/*',async route=>{
    const req=route.request();let u;try{u=new URL(req.url());}catch{return route.continue();}
    if(u.hostname==='kalenel.nl'&&/\/gejast-home-gate\.js$/i.test(u.pathname))return route.fulfill({status:200,contentType:'application/javascript',body:"document.documentElement.classList.remove('gejast-auth-pending');document.documentElement.classList.add('gejast-auth-ready');window.GEJAST_HOME_GATE={audit:true};"});
    if(u.hostname==='kalenel.nl'&&/\/gejast-config\.js$/i.test(u.pathname)){const upstream=await route.fetch();const body=await upstream.text();return route.fulfill({response:upstream,contentType:'application/javascript',body:`${body}\n;window.GEJAST_CONFIG=window.GEJAST_CONFIG||{};window.GEJAST_CONFIG.requireMatchEntrySession=function(){return true;};window.GEJAST_CONFIG.ensurePlayerSessionOrRedirect=function(){return true;};`});}
    if(!['GET','HEAD'].includes(req.method())){out.blockedWrites++;return route.fulfill({status:200,contentType:'application/json',body:'[]'});}
    return route.continue();
  });
  const page=await context.newPage();
  await page.goto(`${base}${t.url}${t.url.includes('?')?'&':'?'}v785_diag=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForTimeout(1200);
  await page.addScriptTag({content:axeSource});
  const result=await page.evaluate(async()=>{
    const ax=await window.axe.run(document,{runOnly:{type:'rule',values:['color-contrast','label','select-name']},resultTypes:['violations']});
    const nodeInfo=(node)=>{
      const selector=Array.isArray(node.target)?node.target[0]:String(node.target||'');
      let el=null;try{el=document.querySelector(selector);}catch{}
      let computed=null;
      if(el){const s=getComputedStyle(el),r=el.getBoundingClientRect();computed={tag:el.tagName.toLowerCase(),id:el.id||'',className:String(el.className||''),text:(el.textContent||el.value||'').replace(/\s+/g,' ').trim().slice(0,160),color:s.color,backgroundColor:s.backgroundColor,fontSize:s.fontSize,fontWeight:s.fontWeight,width:r.width,height:r.height,left:r.left,right:r.right,display:s.display,overflowX:s.overflowX,minWidth:s.minWidth,maxWidth:s.maxWidth,whiteSpace:s.whiteSpace};}
      return{target:node.target,html:node.html.slice(0,500),failureSummary:node.failureSummary,computed};
    };
    const violations=ax.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.map(nodeInfo)}));
    const vw=innerWidth;
    const overflow=[...document.querySelectorAll('body *')].map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);const hidden=el.hasAttribute('inert')||el.getAttribute('aria-hidden')==='true'||s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0;return{el,r,s,hidden};}).filter(x=>!x.hidden&&x.r.width>0&&x.r.right>vw+2).map(x=>({tag:x.el.tagName.toLowerCase(),id:x.el.id||'',className:String(x.el.className||''),text:(x.el.textContent||'').replace(/\s+/g,' ').trim().slice(0,120),left:x.r.left,right:x.r.right,width:x.r.width,position:x.s.position,display:x.s.display,overflowX:x.s.overflowX,minWidth:x.s.minWidth,maxWidth:x.s.maxWidth,whiteSpace:x.s.whiteSpace,parent:{tag:x.el.parentElement?.tagName?.toLowerCase()||'',id:x.el.parentElement?.id||'',className:String(x.el.parentElement?.className||''),overflowX:x.el.parentElement?getComputedStyle(x.el.parentElement).overflowX:''}})).slice(0,30);
    return{docWidth:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth),viewportWidth:vw,violations,overflow};
  });
  out.pages[t.key]=result;
  await context.close();
}
await browser.close();
fs.writeFileSync('V785_DIAGNOSTIC_RESULTS.json',JSON.stringify(out,null,2)+'\n');
console.log(`V785_DIAGNOSTIC=PASS pages=${Object.keys(out.pages).length} blockedWrites=${out.blockedWrites}`);

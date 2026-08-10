#!/usr/bin/env node
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const require=createRequire(import.meta.url);
const axeSource=fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8');
const base=process.env.V786_BASE_URL||'http://127.0.0.1:4173';
const widths=[320,360,390,430,760,1366];
const browser=await chromium.launch({headless:true});
const failures=[];let blockedWrites=0;
for(const width of widths){
 const height=width===1366?768:844;
 const context=await browser.newContext({viewport:{width,height},locale:'nl-NL',serviceWorkers:'block'});
 const page=await context.newPage();
 const bad=[];const failed=[];const pageErrors=[];
 await context.route('**/*',async route=>{
   const req=route.request();
   let url;try{url=new URL(req.url());}catch{return route.continue();}
   // Candidate proof isolates Rad from the normal no-session redirect only. The actual mobile runtime stays real.
   if(['127.0.0.1','localhost'].includes(url.hostname)&&/\/gejast-home-gate\.js$/i.test(url.pathname)){
     return route.fulfill({status:200,contentType:'application/javascript',body:"document.documentElement.classList.remove('gejast-auth-pending');document.documentElement.classList.add('gejast-auth-ready');window.GEJAST_HOME_GATE={audit:true};"});
   }
   if(!['GET','HEAD'].includes(req.method())){blockedWrites++;return route.fulfill({status:200,contentType:'application/json',body:'[]'});}
   return route.continue();
 });
 page.on('pageerror',e=>pageErrors.push(String(e?.message||e)));
 page.on('response',res=>{const u=new URL(res.url());if(['127.0.0.1','localhost'].includes(u.hostname)&&['GET','HEAD'].includes(res.request().method())&&res.status()>=400)bad.push(`${res.status()} ${u.pathname}`);});
 page.on('requestfailed',req=>{try{const u=new URL(req.url());if(['127.0.0.1','localhost'].includes(u.hostname)&&['GET','HEAD'].includes(req.method()))failed.push(`${u.pathname}: ${req.failure()?.errorText||'failed'}`);}catch{}});
 let nav='';try{await page.goto(`${base}/rad.html?v786_proof=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});}catch(err){nav=String(err?.message||err);}
 await page.waitForTimeout(900);
 // Prove the non-GET interception boundary without touching any application endpoint.
 try{await page.evaluate(async()=>{await fetch('/__v786_write_probe__',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});});}catch(err){pageErrors.push(`write-probe: ${String(err?.message||err)}`);}
 const state=await page.evaluate(()=>{const wheel=document.querySelector('.wheel-box');const panel=wheel?.closest('.panel');const style=document.getElementById('gejast-mobile-rad-v583');const wr=wheel?.getBoundingClientRect();const pr=panel?.getBoundingClientRect();return{docWidth:Math.max(document.documentElement.scrollWidth,document.body?.scrollWidth||0),viewportWidth:innerWidth,wheelLeft:wr?.left??null,wheelRight:wr?.right??null,wheelWidth:wr?.width??null,panelLeft:pr?.left??null,panelRight:pr?.right??null,panelWidth:pr?.width??null,runtimeStyleInjected:!!style,runtimeStyleText:style?.textContent||'',computedWheelWidth:wheel?getComputedStyle(wheel).width:'',computedMaxWidth:wheel?getComputedStyle(wheel).maxWidth:'',boxSizing:wheel?getComputedStyle(wheel).boxSizing:''};});
 let axe=[];if(!nav){await page.addScriptTag({content:axeSource});const out=await page.evaluate(async()=>await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']},resultTypes:['violations']}));axe=out.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length}));}
 const mobile=width<=760;
 const overflow=state.docWidth>width+4;
 const wheelMissing=state.wheelRight==null||state.panelRight==null;
 const wheelOutside=state.wheelRight!=null&&state.wheelRight>width+1;
 const wheelOutsidePanel=mobile&&state.wheelRight!=null&&state.panelRight!=null&&state.wheelRight>state.panelRight+1;
 const runtimeWrong=mobile&&(!state.runtimeStyleInjected||!/width:min\(100%,460px\)\s*!important/.test(state.runtimeStyleText)||/96vw/.test(state.runtimeStyleText));
 if(nav||bad.length||failed.length||pageErrors.length||axe.length||overflow||wheelMissing||wheelOutside||wheelOutsidePanel||runtimeWrong) failures.push({width,nav,bad,failed,pageErrors,axe,state,overflow,wheelMissing,wheelOutside,wheelOutsidePanel,runtimeWrong});
 console.log(`V786_RAD width=${width} doc=${state.docWidth}/${width} wheel=${state.wheelLeft}-${state.wheelRight} panel=${state.panelLeft}-${state.panelRight} style=${state.runtimeStyleInjected?'yes':'no'} axe=${axe.length} errors=${bad.length+failed.length+pageErrors.length}`);
 await context.close();
}
await browser.close();
if(blockedWrites<widths.length) failures.push({width:'safety',reason:`expected at least ${widths.length} intercepted non-GET probes, got ${blockedWrites}`});
if(failures.length){console.error('V786_RAD_PROOF_FAILURES='+JSON.stringify(failures));process.exit(1);}
console.log(`V786_RAD_BROWSER_PROOF=PASS widths=${widths.join(',')} blockedWrites=${blockedWrites}`);

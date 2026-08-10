#!/usr/bin/env node
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const require=createRequire(import.meta.url);
const axeSource=fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8');
const base=process.env.V785_BASE_URL||'http://127.0.0.1:4173';
const pages=['index.html','klaverjas_scorer_v596_repo_ready.html','boerenbridge_live.html','paardenrace_spectator.html','drinks_add.html','activate.html','rad.html'];
const viewports=[['phone',390,844],['desktop',1366,768]];
const browser=await chromium.launch({headless:true});
const failures=[];
let blockedWrites=0;
for(const [label,width,height] of viewports){
  for(const path of pages){
    const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block',locale:'nl-NL'});
    const page=await context.newPage();
    await context.route('**/*',async route=>{
      const req=route.request();
      if(!['GET','HEAD'].includes(req.method())){blockedWrites++;return route.fulfill({status:200,contentType:'application/json',body:'[]'});}
      return route.continue();
    });
    let nav='';
    try{await page.goto(`${base}/${path}?v785_proof=1`,{waitUntil:'domcontentloaded',timeout:30000});}catch(err){nav=String(err?.message||err);}
    await page.waitForTimeout(700);
    let state={docWidth:99999,viewportWidth:width};
    let axe=[];
    if(!nav){
      state=await page.evaluate(()=>({docWidth:Math.max(document.documentElement.scrollWidth,document.body?.scrollWidth||0),viewportWidth:innerWidth,title:document.title}));
      try{
        await page.addScriptTag({content:axeSource});
        const result=await page.evaluate(async()=>await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']},resultTypes:['violations']}));
        axe=result.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length}));
      }catch(err){axe=[{id:'axe-run-failed',impact:'critical',nodes:1,error:String(err?.message||err)}];}
    }
    const overflow=state.docWidth>state.viewportWidth+4;
    if(nav||axe.length||overflow) failures.push({path,viewport:label,nav,axe,state,overflow});
    console.log(`V785 ${label} ${path} nav=${nav?'FAIL':'ok'} axe=${axe.length} width=${state.docWidth}/${state.viewportWidth}`);
    await context.close();
  }
}
await browser.close();
if(blockedWrites===0) failures.push({path:'__safety__',viewport:'n/a',reason:'browser proof did not demonstrate non-GET interception'});
if(failures.length){console.error('V785_BROWSER_PROOF_FAILURES='+JSON.stringify(failures));process.exit(1);}
console.log(`V785_BROWSER_PROOF=PASS pages=${pages.length} combinations=${pages.length*viewports.length} blockedWrites=${blockedWrites}`);

#!/usr/bin/env node
import fs from 'node:fs';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const BASE='https://kalenel.nl';
const routes=[
  '/', '/login.html', '/request.html', '/profiles.html', '/drinks.html', '/drinks_pending.html', '/drinks_speed.html',
  '/beerpong.html', '/boerenbridge.html', '/pikken.html', '/pikken_live.html', '/paardenrace.html', '/paardenrace_live.html',
  '/toepen.html', '/rad.html', '/scorer.html', '/leaderboard.html', '/despimarkt.html', '/despimarkt_create.html', '/klaverjas_live.html'
];

function staticScan(){
  const files=fs.readdirSync('.').filter(f=>/\.(?:html|css)$/i.test(f) && !/^(?:admin|familie_admin)|_vault\.html$|^vault\.html$|(?:test|debug|diagnostic|health|runtime|audit|preview|export)|_orig\.html$|_v\d+.*\.html$|_repo.*\.html$/i.test(f));
  const findings=[];
  for(const file of files){
    const text=fs.readFileSync(file,'utf8');
    for(const m of text.matchAll(/tabindex\s*=\s*["']([1-9]\d*)["']/gi)) findings.push({kind:'positive-tabindex',file,value:m[1]});
    for(const m of text.matchAll(/outline\s*:\s*(?:none|0(?:\D|$))/gi)) findings.push({kind:'outline-suppression',file,sample:text.slice(Math.max(0,(m.index||0)-90),Math.min(text.length,(m.index||0)+150)).replace(/\s+/g,' ')});
    for(const m of text.matchAll(/<(div|span|tr|td|li|section)\b[^>]*\bonclick\s*=/gi)) findings.push({kind:'inline-nonnative-click',file,tag:m[1].toLowerCase(),sample:m[0].slice(0,180)});
  }
  console.log(`STATIC_ACCESSIBILITY_FINDINGS=${findings.length}`);
  for(const f of findings) console.log('STATIC '+JSON.stringify(f));
  return findings;
}

const staticFindings=staticScan();
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},locale:'nl-NL'});
const summaries=[];
const violationMap=new Map();
const finalUrls=new Set();

for(const route of routes){
  const page=await context.newPage();
  const pageErrors=[];
  const consoleErrors=[];
  page.on('pageerror',err=>pageErrors.push(String(err.message||err)));
  page.on('console',msg=>{if(msg.type()==='error') consoleErrors.push(msg.text());});
  let response;
  try{
    response=await page.goto(`${BASE}${route}?a11y=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForTimeout(700);
    const finalUrl=page.url();
    const finalPath=new URL(finalUrl).pathname;
    finalUrls.add(finalUrl.split('?')[0]);
    const status=response?.status()||0;
    const focusable=await page.locator('a[href],button,input:not([type="hidden"]),select,textarea,[tabindex]:not([tabindex="-1"])').evaluateAll(els=>els.filter(el=>{
      const s=getComputedStyle(el); const r=el.getBoundingClientRect();
      return !el.disabled && s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0;
    }).length);
    const positiveTabindex=await page.locator('[tabindex]').evaluateAll(els=>els.map(el=>({tag:el.tagName.toLowerCase(),value:Number(el.getAttribute('tabindex')),id:el.id||'',cls:el.className||''})).filter(x=>x.value>0));
    const focusSamples=[];
    const badFocus=[];
    const tabSteps=Math.min(Math.max(focusable+2,4),30);
    for(let i=0;i<tabSteps;i++){
      await page.keyboard.press('Tab');
      const info=await page.evaluate(()=>{
        const el=document.activeElement;
        if(!el) return null;
        const s=getComputedStyle(el); const r=el.getBoundingClientRect();
        return {tag:el.tagName.toLowerCase(),id:el.id||'',text:(el.getAttribute('aria-label')||el.textContent||el.getAttribute('placeholder')||'').trim().slice(0,80),outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth,boxShadow:s.boxShadow,visible:r.width>0&&r.height>0};
      });
      if(info){focusSamples.push(info); if(info.tag!=='body' && info.visible && info.outlineStyle==='none' && (info.boxShadow==='none'||!info.boxShadow)) badFocus.push(info);}
    }
    const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
    for(const v of axe.violations){
      const key=`${finalPath}|${v.id}`;
      if(!violationMap.has(key)) violationMap.set(key,{route,finalPath,id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.slice(0,5).map(n=>({target:n.target,summary:n.failureSummary}))});
    }
    const summary={route,finalPath,status,focusable,positiveTabindex,badFocus:badFocus.slice(0,8),pageErrors:pageErrors.slice(0,5),consoleErrors:consoleErrors.slice(0,5),axeViolations:axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length}))};
    summaries.push(summary);
    console.log('PAGE '+JSON.stringify(summary));
  }catch(err){
    const summary={route,error:String(err.message||err)}; summaries.push(summary); console.log('PAGE '+JSON.stringify(summary));
  }finally{await page.close();}
}
await browser.close();

const violations=[...violationMap.values()];
const serious=violations.filter(v=>v.impact==='serious'||v.impact==='critical');
const focusProblems=summaries.reduce((n,s)=>n+(s.badFocus?.length||0),0);
const positiveTabs=summaries.reduce((n,s)=>n+(s.positiveTabindex?.length||0),0);
const pageErrorCount=summaries.reduce((n,s)=>n+(s.pageErrors?.length||0),0);
console.log(`BROWSER_UNIQUE_FINAL_URLS=${finalUrls.size}`);
console.log(`AXE_UNIQUE_VIOLATIONS=${violations.length}`);
console.log(`AXE_SERIOUS_CRITICAL=${serious.length}`);
console.log(`FOCUS_WITHOUT_VISIBLE_INDICATOR=${focusProblems}`);
console.log(`POSITIVE_TABINDEX_BROWSER=${positiveTabs}`);
console.log(`PAGE_ERRORS=${pageErrorCount}`);
for(const v of violations) console.log('AXE '+JSON.stringify(v));
console.log('AUDIT_SUMMARY='+JSON.stringify({staticFindings:staticFindings.length,uniqueFinalUrls:finalUrls.size,axeViolations:violations.length,seriousCritical:serious.length,focusProblems,positiveTabs,pageErrorCount}));

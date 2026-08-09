#!/usr/bin/env node
import { chromium } from 'playwright';
const base='https://kalenel.nl';
const cases=[
  {route:'/beerpong.html',viewports:['desktop','mobile']},
  {route:'/klaverjas_online.html',viewports:['desktop']},
  {route:'/rad.html',viewports:['mobile']},
  {route:'/index.html?scope=family',viewports:['mobile']},
  {route:'/login.html',viewports:['desktop']},
  {route:'/profiles.html',viewports:['desktop']},
  {route:'/my_profile.html',viewports:['desktop']},
  {route:'/scorer.html?scope=family',viewports:['mobile']}
];
const vp={desktop:{width:1440,height:900,isMobile:false,hasTouch:false},mobile:{width:390,height:844,isMobile:true,hasTouch:true}};
const browser=await chromium.launch({headless:true});
function msg(v){return String(v||'').replace(/\s+/g,' ').trim().slice(0,700)}
for(const item of cases){
  for(const name of item.viewports){
    const context=await browser.newContext({viewport:{width:vp[name].width,height:vp[name].height},isMobile:vp[name].isMobile,hasTouch:vp[name].hasTouch,locale:'nl-NL',timezoneId:'Europe/Amsterdam'});
    const page=await context.newPage();
    const errors=[],consoleErrors=[],badResponses=[],failed=[];
    page.on('pageerror',e=>errors.push(msg(e?.message||e)));
    page.on('console',m=>{if(m.type()==='error') consoleErrors.push(msg(m.text()));});
    page.on('response',r=>{if(r.status()>=400) badResponses.push({status:r.status(),type:r.request().resourceType(),url:r.url()});});
    page.on('requestfailed',r=>failed.push({type:r.resourceType(),url:r.url(),error:msg(r.failure()?.errorText)}));
    let navStatus=0;
    try{const r=await page.goto(new URL(item.route,base).toString(),{waitUntil:'domcontentloaded',timeout:20000});navStatus=r?.status()||0;await page.waitForTimeout(1800);}catch(e){errors.push('navigation '+msg(e?.message||e));}
    const layout=await page.evaluate(()=>{
      const vw=document.documentElement.clientWidth;
      const nodes=[];
      for(const el of document.querySelectorAll('body *')){
        const cs=getComputedStyle(el); if(cs.display==='none'||cs.visibility==='hidden') continue;
        const r=el.getBoundingClientRect(); if(r.width<1||r.height<1) continue;
        if(r.right>vw+2||r.left< -2){nodes.push({tag:el.tagName.toLowerCase(),id:el.id||'',cls:String(el.className||'').slice(0,160),text:(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,100),left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width),viewport:vw});}
      }
      return {url:location.href,title:document.title,pageVersion:String(window.GEJAST_PAGE_VERSION||window.GEJAST_CONFIG?.VERSION||''),bodyText:(document.body?.innerText||'').replace(/\s+/g,' ').trim().slice(0,240),scrollWidth:document.documentElement.scrollWidth,clientWidth:vw,overflowing:nodes.slice(0,25)};
    });
    console.log('FOCUS '+JSON.stringify({route:item.route,viewport:name,navStatus,errors,consoleErrors,badResponses,failed,layout}));
    await context.close();
  }
}
await browser.close();

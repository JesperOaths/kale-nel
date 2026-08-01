import fs from 'node:fs';
import { chromium, firefox } from 'playwright';
const cases = [
  { name:'default', options:{} },
  { name:'no-js', options:{ javaScriptEnabled:false } },
  { name:'strict-firefox-ua', options:{ userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0' } }
];
async function run(browserName, browserType){
 const out=[];
 for(const c of cases){
  const browser=await browserType.launch({headless:true});
  const context=await browser.newContext({storageState:{cookies:[],origins:[]}, ...c.options});
  const page=await context.newPage();
  const chain=[];
  page.on('request', req=>{ if(req.frame()===page.mainFrame()&&req.resourceType()==='document') chain.push({event:'request',url:req.url(),cookies:req.headers().cookie||'',redirectedFrom:req.redirectedFrom()?.url()||''}); });
  page.on('response', res=>{ const req=res.request(); if(req.frame()===page.mainFrame()&&req.resourceType()==='document') chain.push({event:'response',url:res.url(),status:res.status(),location:res.headers().location||'',setCookie:res.headers()['set-cookie']||'',fromSW:res.fromServiceWorker()}); });
  let outcome='';
  try{ const res=await page.goto('https://admin.kalenel.nl/admin.html',{waitUntil:'load',timeout:20000}); await page.waitForTimeout(2000); outcome=`status ${res?.status()}`; }
  catch(e){ outcome=e.message; }
  out.push({browser:browserName,case:c.name,outcome,finalUrl:page.url(),title:await page.title().catch(()=>''),chain});
  await browser.close();
 }
 return out;
}
const results=[...(await run('chromium',chromium)),...(await run('firefox',firefox))];
fs.writeFileSync('ADMIN_BROWSER_NAV_VARIANTS_20260801.json',JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));

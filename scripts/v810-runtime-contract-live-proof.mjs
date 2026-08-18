#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE=String(process.env.GEJAST_BASE_URL||'https://kalenel.nl/').replace(/\/+$/,'')+'/';
const chrome=String(process.env.GEJAST_SYSTEM_CHROME||'').trim();
const friendToken=String(process.env.GEJAST_PLAYER1_TOKEN||'').trim();
const familyToken=String(process.env.GEJAST_FAMILY_TOKEN||'').trim();
const friendName=String(process.env.GEJAST_PLAYER1_NAME||'').trim();
const familyName=String(process.env.GEJAST_FAMILY_NAME||'').trim();
const timeout=Number(process.env.GEJAST_WARNING_PROOF_TIMEOUT_MS||25000);
const settle=Number(process.env.GEJAST_WARNING_PROOF_SETTLE_MS||4500);
if(!chrome) throw new Error('GEJAST_SYSTEM_CHROME missing');
if(!/^[0-9a-f]{48}$/.test(friendToken)||!/^[0-9a-f]{48}$/.test(familyToken)) throw new Error('Canonical Friends + Family tokens required');
if(!friendName||!familyName) throw new Error('Fixture names required');

const outDir=path.resolve('v810-runtime-proof');
fs.rmSync(outDir,{recursive:true,force:true}); fs.mkdirSync(outDir,{recursive:true});
const responses=[]; const requestFailures=[]; const pages=[];
const diagnosticNames=new Set(['track_site_event','get_public_player_unified_scoped','get_homepage_boot_bundle_scoped','save_game_match_summary']);
function rpcName(url){const m=String(url).match(/\/rest\/v1\/rpc\/([^?/#]+)/i); return m?decodeURIComponent(m[1]):'';}
function scrub(text){let out=String(text||''); for(const token of [friendToken,familyToken]) if(token) out=out.replaceAll(token,'[TOKEN]'); return out.slice(0,1600);}
async function contextFor(browser,token,scope){
  const context=await browser.newContext({viewport:{width:1440,height:1000},geolocation:{latitude:52.3676,longitude:4.9041},permissions:['geolocation']});
  await context.addInitScript(({sessionToken,siteScope})=>{
    for(const store of [localStorage,sessionStorage]){store.setItem('jas_session_token_v11',sessionToken);store.setItem('jas_session_token_v10',sessionToken);store.setItem('jas_last_activity_at_v1',String(Date.now()));store.setItem('gejast_site_scope_v1',siteScope);}
  },{sessionToken:token,siteScope:scope});
  return context;
}
async function visit(context,route,label,{allowRedirectToIndex=false}={}){
  const page=await context.newPage(); const localErrors=[]; let response=null; let navError='';
  page.on('response',async(res)=>{
    const name=rpcName(res.url()); if(!name) return;
    let body='';
    if(diagnosticNames.has(name) || name==='get_player_runtime_bundle_v687') { try{body=scrub(await res.text());}catch{} }
    responses.push({page:label,name,status:res.status(),method:res.request().method(),url:res.url().replace(/[?].*$/,''),body});
  });
  page.on('requestfailed',(req)=>{const name=rpcName(req.url()); if(name) requestFailures.push({page:label,name,method:req.method(),error:req.failure()?.errorText||'failed'});});
  page.on('pageerror',(err)=>localErrors.push(scrub(err?.message||err)));
  try{
    response=await page.goto(new URL(route.replace(/^\/+/,''),BASE).toString(),{waitUntil:'domcontentloaded',timeout});
    const deadline=Date.now()+Math.min(timeout,12000);
    while(Date.now()<deadline){
      let current=''; try{current=new URL(page.url()).pathname;}catch{}
      const state=await page.evaluate(()=>document.documentElement.getAttribute('data-gejast-auth-state')||'').catch(()=> '');
      if(state==='authenticated') break;
      if(allowRedirectToIndex && current==='/index.html') break;
      if(current==='/login.html') break;
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(settle);
  }catch(err){navError=scrub(err?.message||err);}
  const finalUrl=page.url(); let finalPath=''; try{finalPath=new URL(finalUrl).pathname;}catch{}
  const authState=await page.evaluate(()=>document.documentElement.getAttribute('data-gejast-auth-state')||'').catch(()=> '');
  const bodyChars=(await page.locator('body').innerText().catch(()=> '')).trim().length;
  const validAlias=allowRedirectToIndex&&finalPath==='/index.html';
  pages.push({label,route,status:response?.status()||0,finalPath,authState,bodyChars,navError,pageErrors:localErrors,validAlias});
  await page.close();
}

const browser=await chromium.launch({headless:true,executablePath:chrome});
try{
  const friends=await contextFor(browser,friendToken,'friends');
  await visit(friends,'index.html','friends-index');
  await visit(friends,'home.html','friends-home-alias',{allowRedirectToIndex:true});
  await visit(friends,'drinks_pending.html','friends-drinks-pending');
  await visit(friends,'drinks_add.html','friends-drinks-add');
  await visit(friends,`player.html?player=${encodeURIComponent(friendName)}&scope=friends`,'friends-player');
  await friends.close();
  const family=await contextFor(browser,familyToken,'family');
  await visit(family,`familie/player.html?player=${encodeURIComponent(familyName)}`,'family-player-alias');
  await family.close();
}finally{await browser.close();}

const byName=(name)=>responses.filter(r=>r.name===name);
const failures=[];
for(const p of pages){
  if(p.navError) failures.push(`${p.label}: navigation ${p.navError}`);
  if(p.status>=400) failures.push(`${p.label}: document HTTP ${p.status}`);
  if(p.pageErrors.length) failures.push(`${p.label}: page errors ${p.pageErrors.join(' | ')}`);
  if(p.validAlias) continue;
  if(p.finalPath==='/login.html') failures.push(`${p.label}: unexpectedly at login`);
  if(p.authState!=='authenticated') failures.push(`${p.label}: auth state ${p.authState||'missing'}`);
  if(p.bodyChars<20) failures.push(`${p.label}: effectively empty body`);
}
for(const name of ['get_all_pending_drink_event_verifications_public','get_drink_event_vote_queue_public','get_public_state']){
  if(byName(name).length) failures.push(`${name}: expected zero active calls, observed ${byName(name).length}`);
}
for(const name of ['account_public_state_v687','get_drinks_page_public','get_player_site_announcements_scoped','get_player_runtime_bundle_v687']){
  const ok=byName(name).filter(r=>r.status>=200&&r.status<300);
  if(!ok.length) failures.push(`${name}: no successful 2xx response observed`);
}
const playerBundleStatuses=[...new Set(byName('get_player_runtime_bundle_v687').map(r=>r.status))];
if(playerBundleStatuses.some(s=>s===300||s===404||s>=400)) failures.push(`get_player_runtime_bundle_v687: bad status set ${playerBundleStatuses.join(',')}`);
const repairedNames=new Set(['get_all_pending_drink_event_verifications_public','get_drink_event_vote_queue_public','get_public_state','get_player_site_announcements_scoped','get_player_runtime_bundle_v687']);
const badReq=requestFailures.filter(r=>repairedNames.has(r.name));
if(badReq.length) failures.push(`repaired RPC request failures: ${badReq.map(r=>`${r.name}:${r.error}`).join(', ')}`);

const diagnostics={};
for(const name of diagnosticNames){diagnostics[name]=byName(name).map(({page,status,body})=>({page,status,body}));}
const report={generatedAt:new Date().toISOString(),productVersion:'v810',pages,responses,requestFailures,assertions:{zeroCalls:Object.fromEntries(['get_all_pending_drink_event_verifications_public','get_drink_event_vote_queue_public','get_public_state'].map(n=>[n,byName(n).length])),successfulObserved:Object.fromEntries(['account_public_state_v687','get_drinks_page_public','get_player_site_announcements_scoped','get_player_runtime_bundle_v687'].map(n=>[n,byName(n).filter(r=>r.status>=200&&r.status<300).length])),playerBundleStatuses,failures},diagnostics};
fs.writeFileSync(path.join(outDir,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({assertions:report.assertions,diagnostics},null,2));
if(failures.length){console.error('V810 runtime contract proof FAILED'); failures.forEach(f=>console.error(`- ${f}`)); process.exit(1);}
console.log(`RESULT=V810_RUNTIME_CONTRACT_PASS pages=${pages.length} player_bundle_2xx=${report.assertions.successfulObserved.get_player_runtime_bundle_v687}`);

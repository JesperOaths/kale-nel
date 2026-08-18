#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = String(process.env.GEJAST_BASE_URL || 'https://kalenel.nl/').replace(/\/+$/, '') + '/';
const chrome = String(process.env.GEJAST_SYSTEM_CHROME || '').trim();
const friendToken = String(process.env.GEJAST_PLAYER1_TOKEN || '').trim();
const familyToken = String(process.env.GEJAST_FAMILY_TOKEN || '').trim();
const friendName = String(process.env.GEJAST_PLAYER1_NAME || '').trim();
const familyName = String(process.env.GEJAST_FAMILY_NAME || '').trim();
const timeout = Number(process.env.GEJAST_WARNING_PROOF_TIMEOUT_MS || 25000);
const settle = Number(process.env.GEJAST_WARNING_PROOF_SETTLE_MS || 4500);
if (!chrome) throw new Error('GEJAST_SYSTEM_CHROME missing');
if (!/^[0-9a-f]{48}$/.test(friendToken) || !/^[0-9a-f]{48}$/.test(familyToken)) throw new Error('Canonical Friends + Family tokens required');
if (!friendName || !familyName) throw new Error('Fixture names required');

const outDir = path.resolve('v809-warning-proof');
fs.rmSync(outDir, { recursive:true, force:true });
fs.mkdirSync(outDir, { recursive:true });

const tracked = new Map();
const failed = [];
const pages = [];
function rpcName(url) {
  const m=String(url).match(/\/rest\/v1\/rpc\/([^?/#]+)/i);
  return m ? decodeURIComponent(m[1]) : '';
}
function addRpc(name,status,url,method) {
  if (!name) return;
  if (!tracked.has(name)) tracked.set(name,[]);
  tracked.get(name).push({status,url,method});
}
function safe(text) {
  let out=String(text||'');
  for (const token of [friendToken,familyToken]) if (token) out=out.replaceAll(token,'[TOKEN]');
  return out;
}
async function makeContext(browser, token, scope) {
  const context=await browser.newContext({
    viewport:{width:1440,height:1000},
    geolocation:{latitude:52.3676,longitude:4.9041},
    permissions:['geolocation'],
  });
  await context.addInitScript(({sessionToken,siteScope})=>{
    for (const store of [localStorage,sessionStorage]) {
      store.setItem('jas_session_token_v11',sessionToken);
      store.setItem('jas_session_token_v10',sessionToken);
      store.setItem('jas_last_activity_at_v1',String(Date.now()));
      store.setItem('gejast_site_scope_v1',siteScope);
    }
  },{sessionToken:token,siteScope:scope});
  return context;
}
async function visit(context, route, label) {
  const page=await context.newPage();
  const localConsole=[];
  const localPageErrors=[];
  page.on('response',(res)=>{
    const req=res.request();
    addRpc(rpcName(res.url()),res.status(),res.url(),req.method());
  });
  page.on('requestfailed',(req)=>{
    const name=rpcName(req.url());
    if (name) failed.push({page:label,name,url:req.url(),method:req.method(),error:req.failure()?.errorText||'failed'});
  });
  page.on('console',(msg)=>{ if(msg.type()==='error') localConsole.push(safe(msg.text())); });
  page.on('pageerror',(err)=>localPageErrors.push(safe(err?.message||err)));
  const started=Date.now();
  let response=null;
  let navError='';
  try {
    response=await page.goto(new URL(route.replace(/^\/+/,''),BASE).toString(),{waitUntil:'domcontentloaded',timeout});
    const deadline=Date.now()+Math.min(12000,timeout);
    while(Date.now()<deadline){
      const state=await page.evaluate(()=>document.documentElement.getAttribute('data-gejast-auth-state')||'').catch(()=> '');
      if(state==='authenticated') break;
      if(new URL(page.url()).pathname==='/login.html') break;
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(settle);
  } catch(err){ navError=safe(err?.message||err); }
  const finalUrl=page.url();
  const authState=await page.evaluate(()=>document.documentElement.getAttribute('data-gejast-auth-state')||'').catch(()=> '');
  const body=await page.locator('body').innerText().catch(()=> '');
  pages.push({label,route,status:response?.status()||0,finalUrl,authState,bodyChars:body.trim().length,navError,consoleErrors:localConsole,pageErrors:localPageErrors,elapsedMs:Date.now()-started});
  await page.close();
}

const browser=await chromium.launch({headless:true,executablePath:chrome});
try {
  const friends=await makeContext(browser,friendToken,'friends');
  await visit(friends,'index.html','friends-index');
  await visit(friends,'home.html','friends-home');
  await visit(friends,'drinks_pending.html','friends-drinks-pending');
  await visit(friends,'drinks_add.html','friends-drinks-add');
  await visit(friends,`player.html?player=${encodeURIComponent(friendName)}&scope=friends`,'friends-player');
  await friends.close();

  const family=await makeContext(browser,familyToken,'family');
  await visit(family,`familie/player.html?player=${encodeURIComponent(familyName)}`,'family-player-alias');
  await family.close();
} finally { await browser.close(); }

const rows=Object.fromEntries([...tracked.entries()].sort(([a],[b])=>a.localeCompare(b)));
const count=(name)=>rows[name]?.length||0;
const badStatus=(name,status)=>rows[name]?.filter(x=>x.status===status)||[];
const failures=[];
for(const p of pages){
  if(p.navError) failures.push(`${p.label}: navigation error ${p.navError}`);
  if(p.status>=400) failures.push(`${p.label}: document HTTP ${p.status}`);
  if(p.authState!=='authenticated') failures.push(`${p.label}: auth state ${p.authState||'missing'}`);
  if(p.bodyChars<20) failures.push(`${p.label}: effectively empty body`);
  if(new URL(p.finalUrl).pathname==='/login.html') failures.push(`${p.label}: unexpectedly ended at login`);
  if(p.pageErrors.length) failures.push(`${p.label}: page errors ${p.pageErrors.join(' | ')}`);
}
for(const name of ['get_all_pending_drink_event_verifications_public','get_drink_event_vote_queue_public','get_public_state']) {
  if(count(name)!==0) failures.push(`${name}: expected zero active calls, observed ${count(name)}`);
}
for(const name of ['get_player_site_announcements_scoped','get_player_runtime_bundle_v687']) {
  const bad=badStatus(name,404);
  if(bad.length) failures.push(`${name}: still emitted ${bad.length} HTTP 404 response(s)`);
}
for(const name of ['account_public_state_v687','get_drinks_page_public','get_player_site_announcements_scoped','get_player_runtime_bundle_v687']) {
  const ok=(rows[name]||[]).some(x=>x.status>=200&&x.status<300);
  if(!ok) failures.push(`${name}: no successful browser response observed`);
}
const legacyFailed=failed.filter(x=>['get_all_pending_drink_event_verifications_public','get_drink_event_vote_queue_public','get_public_state','get_player_site_announcements_scoped','get_player_runtime_bundle_v687'].includes(x.name));
if(legacyFailed.length) failures.push(`repaired RPC requestfailed events: ${legacyFailed.map(x=>`${x.name}:${x.error}`).join(', ')}`);

const report={
  generatedAt:new Date().toISOString(),
  base:BASE,
  pages,
  rpcResponses:rows,
  requestFailures:failed,
  assertions:{
    zeroCalls:{
      get_all_pending_drink_event_verifications_public:count('get_all_pending_drink_event_verifications_public'),
      get_drink_event_vote_queue_public:count('get_drink_event_vote_queue_public'),
      get_public_state:count('get_public_state'),
    },
    successfulObserved:Object.fromEntries(['account_public_state_v687','get_drinks_page_public','get_player_site_announcements_scoped','get_player_runtime_bundle_v687'].map(name=>[name,(rows[name]||[]).filter(x=>x.status>=200&&x.status<300).length])),
    failures
  }
};
fs.writeFileSync(path.join(outDir,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.assertions,null,2));
if(failures.length){
  console.error('V809 runtime warning proof FAILED');
  failures.forEach(x=>console.error(`- ${x}`));
  process.exit(1);
}
console.log(`RESULT=V809_RUNTIME_WARNING_LIVE_PASS pages=${pages.length} account_state=${report.assertions.successfulObserved.account_public_state_v687} drinks_page=${report.assertions.successfulObserved.get_drinks_page_public} announcements=${report.assertions.successfulObserved.get_player_site_announcements_scoped} player_bundle=${report.assertions.successfulObserved.get_player_runtime_bundle_v687}`);
